# Análise de Exames por Imagem (Fase 1) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar suporte a exames por imagem (DICOM, JPG, PNG) com análise via Claude Vision, achados estruturados com coordenadas percentuais e exibição interativa no frontend com overlay canvas desenhando bounding boxes numerados.

**Architecture:** O worker detecta o tipo de arquivo pelo campo `file_type` no job e rota para o pipeline de imagem (separado do pipeline de texto existente, sem interferência). DICOM é convertido para PNG via `dcmjs` + `jimp`. Claude Vision analisa a imagem e retorna `findings[]` com `box` percentual. Os findings são armazenados em `clinical_results.metadata` (JSONB). O frontend exibe a imagem original via proxy API + canvas overlay desenhando bounding boxes coloridos numerados. Cada `[N]` no texto de interpretação corresponde ao marcador visual `[N]` na imagem.

**Tech Stack:** Worker: `dcmjs` (parsing DICOM), `jimp` (windowing pixel data → PNG, puro JS sem deps nativas). API: stream S3 via proxy HTTP. Angular 18: `<canvas>` overlay com signals, `ViewChild`, `ElementRef`.

---

## Mapa de Arquivos

| Ação | Arquivo | Responsabilidade |
|---|---|---|
| Criar | `apps/api/src/db/migrations/040_imaging_columns.sql` | `file_type` em exams, `metadata` em clinical_results |
| Modificar | `apps/worker/package.json` | Add dcmjs, jimp |
| Modificar | `apps/worker/src/storage/s3.js` | Add uploadFile |
| Criar | `apps/worker/src/converters/dicom.js` | DICOM → PNG com windowing |
| Criar | `apps/worker/src/classifiers/imaging.js` | Detectar modalidade (DICOM header ou Claude) |
| Criar | `apps/worker/src/agents/imaging-rx.js` | Agente RX/radiografia |
| Criar | `apps/worker/src/agents/imaging-ecg.js` | Agente ECG |
| Criar | `apps/worker/src/agents/imaging-ultrasound.js` | Agente ultrassom |
| Modificar | `apps/worker/src/processors/exam.js` | Rota para imaging pipeline + persistImagingResult |
| Modificar | `apps/api/src/routes/exams.js` | Aceitar DICOM/JPG/PNG + proxy de imagem |
| Modificar | `apps/web/src/app/shared/models/api.models.ts` | ImagingFinding, ImagingMetadata, extend ClinicalResult/Exam |
| Modificar | `apps/web/src/app/features/doctor/exams/exam-upload.component.ts` | Aceitar novos tipos de arquivo |
| Criar | `apps/web/src/app/features/doctor/results/imaging-result.component.ts` | Viewer com canvas overlay e findings list |
| Modificar | `apps/web/src/app/features/doctor/results/result-panel.component.ts` | Detectar imaging_* e renderizar imaging component |

---

## Task 1: Migration 040 — colunas de imagem

**Files:**
- Create: `apps/api/src/db/migrations/040_imaging_columns.sql`

- [ ] **Step 1: Criar o arquivo de migration**

```sql
-- apps/api/src/db/migrations/040_imaging_columns.sql
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS file_type TEXT
    CHECK (file_type IN ('pdf', 'dicom', 'image', 'unknown'))
    DEFAULT 'pdf';

ALTER TABLE clinical_results
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
```

- [ ] **Step 2: Aplicar migration no banco Docker**

```bash
docker compose exec -T db psql -U postgres -d genomaflow < apps/api/src/db/migrations/040_imaging_columns.sql
```

Expected: sem erros. Se aparecer "already exists", a coluna já foi adicionada — ok.

- [ ] **Step 3: Registrar migration na tabela de controle**

```bash
docker compose exec -T db psql -U postgres -d genomaflow -c \
  "INSERT INTO _migrations (name) VALUES ('040_imaging_columns.sql') ON CONFLICT DO NOTHING;"
```

- [ ] **Step 4: Commit**

```bash
git checkout -b feat/imaging-analysis
git add apps/api/src/db/migrations/040_imaging_columns.sql
git commit -m "feat(db): migration 040 — file_type em exams, metadata em clinical_results"
```

---

## Task 2: Worker — dependências e uploadFile

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/src/storage/s3.js`

- [ ] **Step 1: Adicionar dependências ao package.json do worker**

No arquivo `apps/worker/package.json`, adicione dentro de `"dependencies"`:

```json
"dcmjs": "^0.29.0",
"jimp": "^0.22.12"
```

O bloco `dependencies` deve ficar assim:
```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.88.0",
  "@aws-sdk/client-s3": "^3.1033.0",
  "bullmq": "^5.7.0",
  "dcmjs": "^0.29.0",
  "dotenv": "^16.0.0",
  "ioredis": "^5.3.2",
  "jimp": "^0.22.12",
  "openai": "^4.52.0",
  "pdf-parse": "^1.1.1",
  "pg": "^8.12.0"
}
```

- [ ] **Step 2: Instalar no container worker**

```bash
docker compose exec worker npm install --save dcmjs jimp
```

Se o container não tiver npm disponível ou falhar, instalar localmente e rebuild:

```bash
cd apps/worker && npm install --save dcmjs jimp && cd ../..
docker compose build worker
docker compose up -d worker
```

- [ ] **Step 3: Verificar instalação**

```bash
docker compose exec worker node -e "require('dcmjs'); require('jimp'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 4: Adicionar uploadFile ao s3.js do worker**

No arquivo `apps/worker/src/storage/s3.js`, adicionar após `const client = ...`:

```javascript
const { PutObjectCommand } = require('@aws-sdk/client-s3');
```

E adicionar a função antes de `module.exports`:

```javascript
async function uploadFile(key, buffer, contentType) {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));
  return `s3://${BUCKET}/${key}`;
}
```

E adicionar `uploadFile` ao `module.exports`:

```javascript
module.exports = { downloadFile, deleteFile, keyFromPath, uploadFile, BUCKET };
```

O arquivo final `apps/worker/src/storage/s3.js` fica:

```javascript
const { S3Client, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET = process.env.S3_BUCKET || 'genomaflow-uploads-prod';
const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

async function downloadFile(key) {
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function uploadFile(key, buffer, contentType) {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));
  return `s3://${BUCKET}/${key}`;
}

async function deleteFile(key) {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {});
}

function keyFromPath(s3Path) {
  if (s3Path.startsWith('s3://')) return s3Path.split('/').slice(3).join('/');
  return s3Path;
}

module.exports = { downloadFile, uploadFile, deleteFile, keyFromPath, BUCKET };
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/package.json apps/worker/src/storage/s3.js
git commit -m "feat(worker): add dcmjs/jimp deps + uploadFile to s3 helper"
```

---

## Task 3: Conversor DICOM → PNG

**Files:**
- Create: `apps/worker/src/converters/dicom.js`

- [ ] **Step 1: Criar o arquivo do conversor**

```javascript
// apps/worker/src/converters/dicom.js
const dcmjs = require('dcmjs');
const Jimp = require('jimp');

// Windowing defaults por modalidade DICOM
const WINDOW_DEFAULTS = {
  CT:  { center: 40,  width: 400  },
  CR:  { center: 128, width: 256  },
  DX:  { center: 128, width: 256  },
  MR:  { center: 512, width: 1024 },
  US:  { center: 128, width: 256  },
};

function getTag(dict, tag) {
  return dict[tag]?.Value?.[0] ?? null;
}

/**
 * Converte buffer DICOM para PNG com windowing diagnóstico.
 * Suporta DICOM 16-bit e 8-bit não comprimidos.
 * @param {Buffer} buffer
 * @returns {Promise<{ pngBuffer: Buffer, meta: object }>}
 */
async function dicomToImage(buffer) {
  // dcmjs espera ArrayBuffer
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const dataSet = dcmjs.data.DicomMessage.readFile(arrayBuffer);
  const dict = dataSet.dict;

  const modality     = getTag(dict, '00080060');
  const rows         = getTag(dict, '00280010');
  const cols         = getTag(dict, '00280011');
  const bitsAlloc    = getTag(dict, '00280100') ?? 16;
  const windowCenter = getTag(dict, '00281050');
  const windowWidth  = getTag(dict, '00281051');

  if (!rows || !cols) throw new Error('DICOM: dimensões de imagem ausentes no header');

  const pixelDataElem = dict['7FE00010'];
  if (!pixelDataElem?.Value?.[0]) throw new Error('DICOM: pixel data ausente ou comprimido — use JPG/PNG para imagens comprimidas');

  const defaults = WINDOW_DEFAULTS[modality] ?? WINDOW_DEFAULTS.CR;
  const wc = Number(windowCenter ?? defaults.center);
  const ww = Number(windowWidth  ?? defaults.width);
  const lo = wc - ww / 2;
  const hi = wc + ww / 2;

  const rawBuf    = pixelDataElem.Value[0].buffer;
  const pixelData = bitsAlloc === 8
    ? new Uint8Array(rawBuf)
    : new Uint16Array(rawBuf);

  const img = new Jimp(cols, rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const raw = pixelData[r * cols + c];
      let v = Math.round(((raw - lo) / (hi - lo)) * 255);
      v = Math.max(0, Math.min(255, v));
      const hex = Jimp.rgbaToInt(v, v, v, 255);
      img.setPixelColor(hex, c, r);
    }
  }

  const pngBuffer = await img.getBufferAsync(Jimp.MIME_PNG);

  const meta = {
    modality,
    bodyPart:  getTag(dict, '00180015'),
    studyDesc: getTag(dict, '00081030'),
    seriesDesc: getTag(dict, '0008103E'),
    rows,
    cols,
    windowCenter: wc,
    windowWidth:  ww,
  };

  return { pngBuffer, meta };
}

function formatDicomMeta(meta) {
  return [
    meta.modality  && `Modality: ${meta.modality}`,
    meta.bodyPart  && `Body Part: ${meta.bodyPart}`,
    meta.studyDesc && `Study: ${meta.studyDesc}`,
    meta.seriesDesc && `Series: ${meta.seriesDesc}`,
  ].filter(Boolean).join('\n');
}

module.exports = { dicomToImage, formatDicomMeta };
```

- [ ] **Step 2: Verificar que o módulo carrega sem erros**

```bash
docker compose exec worker node -e "const {dicomToImage} = require('./src/converters/dicom'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/converters/dicom.js
git commit -m "feat(worker): conversor DICOM → PNG com windowing diagnóstico (dcmjs + jimp)"
```

---

## Task 4: Classificador de modalidade

**Files:**
- Create: `apps/worker/src/classifiers/imaging.js`

- [ ] **Step 1: Criar o classificador**

```javascript
// apps/worker/src/classifiers/imaging.js
const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Mapeamento DICOM modality tag → agente GenomaFlow
const DICOM_MODALITY_MAP = {
  CR: 'rx',   // Computed Radiography
  DX: 'rx',   // Digital X-Ray
  RG: 'rx',   // Radiographic imaging
  CT: 'rx',   // CT (mapped to rx para Fase 1)
  MR: 'rx',   // MRI (mapped to rx para Fase 1)
  US: 'ultrasound',
  ECG: 'ecg',
  EG:  'ecg',
};

/**
 * Detecta o tipo de arquivo pelo nome/extensão e MIME type.
 * @param {string} filename
 * @param {string} mimetype
 * @returns {'dicom' | 'image' | 'pdf' | 'unknown'}
 */
function detectFileType(filename, mimetype) {
  const ext = (filename ?? '').toLowerCase().split('.').pop();
  if (ext === 'dcm' || ext === 'dicom' || mimetype === 'application/dicom') return 'dicom';
  if (['jpg', 'jpeg', 'png', 'tiff', 'tif'].includes(ext)) return 'image';
  if (ext === 'pdf' || mimetype === 'application/pdf') return 'pdf';
  return 'unknown';
}

/**
 * Classifica a modalidade de imagem médica.
 * Usa o header DICOM se disponível; caso contrário, chama Claude Vision.
 * @param {string|null} imageBase64 - PNG em base64 (null para PDF)
 * @param {object} imageMeta - metadados do header DICOM (pode ser {})
 * @returns {Promise<'rx'|'ecg'|'ultrasound'|null>}
 */
async function classifyModality(imageBase64, imageMeta) {
  // 1. Usar header DICOM se disponível
  if (imageMeta?.modality) {
    const mapped = DICOM_MODALITY_MAP[imageMeta.modality];
    if (mapped) return mapped;
  }

  // 2. Fallback: Claude Vision
  if (!imageBase64) return null;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: imageBase64 }
          },
          {
            type: 'text',
            text: 'Classify this medical image type. Respond with ONLY one word: rx | ecg | ultrasound | other'
          }
        ]
      }]
    });
    const text = response.content[0]?.text?.trim().toLowerCase() ?? '';
    const valid = ['rx', 'ecg', 'ultrasound'];
    return valid.includes(text) ? text : null;
  } catch (_) {
    return null;
  }
}

module.exports = { detectFileType, classifyModality };
```

- [ ] **Step 2: Verificar carga do módulo**

```bash
docker compose exec worker node -e "const {detectFileType, classifyModality} = require('./src/classifiers/imaging'); console.log(detectFileType('chest.dcm', 'application/octet-stream'))"
```

Expected: `dicom`

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/classifiers/imaging.js
git commit -m "feat(worker): classificador de modalidade de imagem (DICOM header + Claude fallback)"
```

---

## Task 5: Agentes de imagem (RX, ECG, Ultrassom)

**Files:**
- Create: `apps/worker/src/agents/imaging-rx.js`
- Create: `apps/worker/src/agents/imaging-ecg.js`
- Create: `apps/worker/src/agents/imaging-ultrasound.js`

- [ ] **Step 1: Criar imaging-rx.js**

```javascript
// apps/worker/src/agents/imaging-rx.js
const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica e não substitui avaliação radiológica profissional. As marcações indicam regiões aproximadas identificadas pela IA — validação profissional obrigatória.';

const SYSTEM_PROMPT = `You are a specialized radiologist AI assistant analyzing X-ray and CT images.
Evaluate: lung fields, cardiac silhouette, mediastinum, pleural spaces, bony structures, soft tissues, diaphragm.
Look for: pneumonia, consolidations, effusions, pneumothorax, cardiomegaly, nodules, masses, fractures, infiltrates.

Respond ONLY with valid JSON:
{
  "interpretation": "<detailed findings in Brazilian Portuguese — reference each finding as [N] exactly where it appears in text, e.g. 'Observa-se consolidação lobar inferior direita [1], compatível com...'>",
  "risk_scores": {
    "pulmonary": "<LOW|MEDIUM|HIGH|CRITICAL>",
    "cardiac": "<LOW|MEDIUM|HIGH|CRITICAL>"
  },
  "findings": [
    {
      "id": 1,
      "label": "<short finding name in Portuguese, e.g. Consolidação inf. D>",
      "box": [0.55, 0.60, 0.82, 0.90],
      "severity": "<low|medium|high|critical>",
      "description": "<detailed description in Brazilian Portuguese>"
    }
  ],
  "alerts": [
    { "marker": "<finding name>", "value": "<brief description>", "severity": "<low|medium|high|critical>" }
  ],
  "disclaimer": "${DISCLAIMER}"
}
Rules:
- box coordinates: [x1, y1, x2, y2] as fraction of image dimensions (0.0 to 1.0, origin top-left).
- Omit box if the finding has no specific localizable region (e.g., global image quality comment).
- findings[].id must match the [N] reference used in interpretation text.
- If image quality is insufficient for analysis, state so clearly in interpretation and return empty findings[].
- Never provide a definitive diagnosis — provide clinical decision support only.
- Always respond in Brazilian Portuguese for text fields.`;

/**
 * @param {{ imageBase64: string, imageMeta: object, pdfBuffer?: Buffer, patient: object, guidelines: Array }} ctx
 */
async function runImagingRxAgent({ imageBase64, imageMeta, pdfBuffer, patient, guidelines }) {
  const guidelinesText = (guidelines || []).map(g => `## ${g.title}\n${g.content}`).join('\n\n');
  const metaText = Object.entries(imageMeta || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');

  const content = [];

  if (imageBase64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } });
  } else if (pdfBuffer) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') } });
  }

  content.push({
    type: 'text',
    text: `Patient: sex=${patient.sex || 'unknown'}${patient.species ? ', species=' + patient.species : ''}
${metaText ? 'DICOM metadata: ' + metaText : ''}
${guidelinesText ? '\nGuidelines:\n' + guidelinesText : ''}

Analyze this radiograph and provide structured clinical interpretation with numbered findings and coordinates.`
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }]
  });

  const rawText = response.content?.[0]?.text ?? '';
  const start = rawText.indexOf('{');
  const end   = rawText.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;

  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[imaging-rx] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }

  result.disclaimer = DISCLAIMER;
  result.findings = result.findings || [];
  result.alerts   = result.alerts   || [];
  return { result, usage: response.usage };
}

module.exports = { runImagingRxAgent };
```

- [ ] **Step 2: Criar imaging-ecg.js**

```javascript
// apps/worker/src/agents/imaging-ecg.js
const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica e não substitui avaliação cardiológica profissional. As marcações indicam regiões aproximadas no traçado — validação profissional obrigatória.';

const SYSTEM_PROMPT = `You are a specialized cardiologist AI assistant analyzing ECG/electrocardiogram tracings.
Evaluate: rhythm, heart rate, P waves, PR interval, QRS complex morphology, ST segment, T waves, QT interval, electrical axis.
Look for: arrhythmias (AF, flutter, blocks), ischemia patterns, STEMI, NSTEMI, hypertrophy, electrolyte abnormalities, QT prolongation.

Respond ONLY with valid JSON:
{
  "interpretation": "<detailed analysis in Brazilian Portuguese — reference each finding as [N] in text>",
  "risk_scores": {
    "cardiac_rhythm": "<LOW|MEDIUM|HIGH|CRITICAL>",
    "ischemia": "<LOW|MEDIUM|HIGH|CRITICAL>"
  },
  "measurements": {
    "rate":        "<bpm or null>",
    "pr_interval": "<ms or null>",
    "qrs_duration": "<ms or null>",
    "qt_interval": "<ms or null>",
    "axis":        "<degrees or null>"
  },
  "findings": [
    {
      "id": 1,
      "label": "<finding name, e.g. Supradesnivelamento ST V1-V3>",
      "box": [0.10, 0.30, 0.50, 0.70],
      "severity": "<low|medium|high|critical>",
      "description": "<description in Brazilian Portuguese>"
    }
  ],
  "alerts": [
    { "marker": "<finding>", "value": "<description>", "severity": "<low|medium|high|critical>" }
  ],
  "disclaimer": "${DISCLAIMER}"
}
Rules:
- box: region of the ECG strip where the finding is visible, as fraction of image (0.0-1.0). Omit if global finding.
- findings[].id must match [N] references in interpretation.
- measurements: use null for values not clearly visible in the tracing.
- Never diagnose. Provide clinical decision support only.
- Always respond in Brazilian Portuguese for text fields.`;

/**
 * @param {{ imageBase64: string, imageMeta: object, pdfBuffer?: Buffer, patient: object, guidelines: Array }} ctx
 */
async function runImagingEcgAgent({ imageBase64, imageMeta, pdfBuffer, patient, guidelines }) {
  const guidelinesText = (guidelines || []).map(g => `## ${g.title}\n${g.content}`).join('\n\n');

  const content = [];

  if (imageBase64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } });
  } else if (pdfBuffer) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') } });
  }

  content.push({
    type: 'text',
    text: `Patient: sex=${patient.sex || 'unknown'}${patient.species ? ', species=' + patient.species : ''}
${guidelinesText ? '\nGuidelines:\n' + guidelinesText : ''}

Analyze this ECG tracing and provide structured clinical interpretation with numbered findings and coordinates.`
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }]
  });

  const rawText = response.content?.[0]?.text ?? '';
  const start = rawText.indexOf('{');
  const end   = rawText.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;

  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[imaging-ecg] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }

  result.disclaimer = DISCLAIMER;
  result.findings   = result.findings   || [];
  result.alerts     = result.alerts     || [];
  result.measurements = result.measurements || {};
  return { result, usage: response.usage };
}

module.exports = { runImagingEcgAgent };
```

- [ ] **Step 3: Criar imaging-ultrasound.js**

```javascript
// apps/worker/src/agents/imaging-ultrasound.js
const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise é um suporte à decisão clínica e não substitui avaliação ultrassonográfica profissional. As marcações indicam regiões aproximadas — validação profissional obrigatória.';

const SYSTEM_PROMPT = `You are a specialized sonographer AI assistant analyzing ultrasound images.
Evaluate visible structures based on the anatomical region shown.
Look for: abnormal echogenicity, masses, fluid collections, cysts, organ enlargement or atrophy, vascular abnormalities, free fluid.

Respond ONLY with valid JSON:
{
  "interpretation": "<detailed findings in Brazilian Portuguese — reference each finding as [N] in text>",
  "risk_scores": {
    "structural": "<LOW|MEDIUM|HIGH|CRITICAL>"
  },
  "findings": [
    {
      "id": 1,
      "label": "<finding name in Portuguese, e.g. Coleção anecóica hepática>",
      "box": [0.30, 0.25, 0.65, 0.70],
      "severity": "<low|medium|high|critical>",
      "description": "<description in Brazilian Portuguese>"
    }
  ],
  "alerts": [
    { "marker": "<structure>", "value": "<finding>", "severity": "<low|medium|high|critical>" }
  ],
  "disclaimer": "${DISCLAIMER}"
}
Rules:
- box: region where the finding is visible, as fraction of image (0.0-1.0). Omit if no specific localizable region.
- findings[].id must match [N] references in interpretation.
- For veterinary images: note species-specific anatomy when relevant.
- Never diagnose. Provide clinical decision support only.
- Always respond in Brazilian Portuguese for text fields.`;

/**
 * @param {{ imageBase64: string, imageMeta: object, pdfBuffer?: Buffer, patient: object, guidelines: Array }} ctx
 */
async function runImagingUltrasoundAgent({ imageBase64, imageMeta, pdfBuffer, patient, guidelines }) {
  const guidelinesText = (guidelines || []).map(g => `## ${g.title}\n${g.content}`).join('\n\n');

  const content = [];

  if (imageBase64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } });
  } else if (pdfBuffer) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') } });
  }

  content.push({
    type: 'text',
    text: `Patient: sex=${patient.sex || 'unknown'}${patient.species ? ', species=' + patient.species : ''}
${guidelinesText ? '\nGuidelines:\n' + guidelinesText : ''}

Analyze this ultrasound image and provide structured clinical interpretation with numbered findings and coordinates.`
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }]
  });

  const rawText = response.content?.[0]?.text ?? '';
  const start = rawText.indexOf('{');
  const end   = rawText.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;

  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[imaging-ultrasound] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }

  result.disclaimer = DISCLAIMER;
  result.findings   = result.findings || [];
  result.alerts     = result.alerts   || [];
  return { result, usage: response.usage };
}

module.exports = { runImagingUltrasoundAgent };
```

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/agents/imaging-rx.js apps/worker/src/agents/imaging-ecg.js apps/worker/src/agents/imaging-ultrasound.js
git commit -m "feat(worker): agentes de imagem — imaging-rx, imaging-ecg, imaging-ultrasound"
```

---

## Task 6: Pipeline de imagem no exam.js

**Files:**
- Modify: `apps/worker/src/processors/exam.js`

O pipeline de texto existente não é tocado. Apenas adicionamos imports e uma nova função `processImagingExam` + roteamento no `processExam`.

- [ ] **Step 1: Adicionar imports ao topo de exam.js**

Após as imports existentes, adicionar:

```javascript
const { dicomToImage, formatDicomMeta } = require('../converters/dicom');
const { classifyModality } = require('../classifiers/imaging');
const { runImagingRxAgent } = require('../agents/imaging-rx');
const { runImagingEcgAgent } = require('../agents/imaging-ecg');
const { runImagingUltrasoundAgent } = require('../agents/imaging-ultrasound');
const { uploadFile, BUCKET } = require('../storage/s3');
```

- [ ] **Step 2: Adicionar persistImagingResult após a função persistResult existente**

Logo após a função `persistResult` existente (linha ~73), adicionar:

```javascript
async function persistImagingResult(client, examId, tenantId, agentType, result, usage, imageMetadata) {
  await client.query(
    `INSERT INTO clinical_results
       (exam_id, tenant_id, agent_type, interpretation, risk_scores, alerts,
        recommendations, disclaimer, model_version, input_tokens, output_tokens, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      examId, tenantId, agentType,
      result.interpretation,
      JSON.stringify(result.risk_scores || {}),
      JSON.stringify(result.alerts || []),
      JSON.stringify([]),
      result.disclaimer,
      'claude-sonnet-4-6',
      usage?.input_tokens || 0,
      usage?.output_tokens || 0,
      JSON.stringify({
        original_image_url: imageMetadata.original_image_url,
        findings:           result.findings || [],
        measurements:       result.measurements || null,
      })
    ]
  );
}
```

- [ ] **Step 3: Adicionar função processImagingExam antes de processExam**

Inserir antes da função `processExam` existente:

```javascript
const IMAGING_AGENT_MAP = {
  rx:         { type: 'imaging_rx',         runner: runImagingRxAgent },
  ecg:        { type: 'imaging_ecg',        runner: runImagingEcgAgent },
  ultrasound: { type: 'imaging_ultrasound', runner: runImagingUltrasoundAgent },
};

async function processImagingExam({ exam_id, tenant_id, file_path, file_type }) {
  const client = await pool.connect();
  let processingError = null;

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant_id]);
    await client.query(
      `UPDATE exams SET status = 'processing', updated_at = NOW() WHERE id = $1`, [exam_id]
    );

    // Fetch subject + module
    const { rows } = await client.query(
      `SELECT s.name, s.sex, s.subject_type, s.species, t.module
       FROM exams e
       JOIN subjects s ON s.id = e.subject_id
       JOIN tenants  t ON t.id = e.tenant_id
       WHERE e.id = $1`,
      [exam_id]
    );
    const subject = rows[0];
    const tenantModule = subject.module;

    // Credit check — 1 credit for imaging agent
    const balance = await getBalance(tenant_id, client);
    if (balance < 1) {
      await client.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        ['Saldo de créditos insuficiente — recarregue seus créditos e envie novamente', exam_id]
      );
      await client.query('COMMIT');
      return;
    }

    // Download file
    const buffer = await downloadFile(keyFromPath(file_path));

    // Convert to image + determine metadata
    let imageBase64 = null;
    let pdfBuffer   = null;
    let imageMeta   = {};
    let imageS3Key  = null;

    if (file_type === 'dicom') {
      const { pngBuffer, meta } = await dicomToImage(buffer);
      imageMeta = meta;
      imageBase64 = pngBuffer.toString('base64');
      imageS3Key = `uploads/${tenant_id}/${exam_id}/image.png`;
      await uploadFile(imageS3Key, pngBuffer, 'image/png');
    } else if (file_type === 'image') {
      imageBase64 = buffer.toString('base64');
      imageS3Key = keyFromPath(file_path); // usar original
    } else if (file_type === 'pdf') {
      pdfBuffer = buffer; // Pass PDF directly to Claude as document
      // Sem imagem para exibir no frontend nesta versão
    }

    const original_image_url = imageS3Key ? `s3://${BUCKET}/${imageS3Key}` : null;

    // Classify modality
    const modality = await classifyModality(imageBase64, imageMeta);
    if (!modality) {
      await client.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        ['Não foi possível identificar a modalidade da imagem. Verifique se é RX, ECG ou Ultrassom.', exam_id]
      );
      await client.query('COMMIT');
      return;
    }

    const agentConfig = IMAGING_AGENT_MAP[modality];
    if (!agentConfig) {
      await client.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [`Modalidade "${modality}" não suportada na Fase 1`, exam_id]
      );
      await client.query('COMMIT');
      return;
    }

    // RAG guidelines (best-effort)
    let guidelines = [];
    try {
      const searchText = imageMeta.studyDesc || imageMeta.modality || modality;
      guidelines = await retrieveGuidelines(client, searchText, 3, tenantModule, subject.species || null);
    } catch (_) {}

    // Run imaging agent
    const patientContext = { sex: subject.sex, species: subject.species || null };
    const { result, usage } = await agentConfig.runner({ imageBase64, imageMeta, pdfBuffer, patient: patientContext, guidelines });

    // Persist
    await persistImagingResult(client, exam_id, tenant_id, agentConfig.type, result, usage, { original_image_url });
    await debitCredit(tenant_id, exam_id, agentConfig.type, client);

    await client.query(
      `UPDATE exams SET status = 'done', updated_at = NOW() WHERE id = $1`, [exam_id]
    );
    await client.query('COMMIT');

  } catch (err) {
    processingError = err;
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
  }

  if (processingError) {
    const errClient = await pool.connect();
    try {
      await errClient.query('BEGIN');
      await errClient.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant_id]);
      await errClient.query(
        `UPDATE exams SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [processingError.message, exam_id]
      );
      await errClient.query('COMMIT');
    } catch (_) {
      await errClient.query('ROLLBACK').catch(() => {});
    } finally {
      errClient.release();
    }

    try {
      const pub = new Redis(process.env.REDIS_URL);
      await pub.publish(`exam:error:${tenant_id}`, JSON.stringify({ exam_id, error_message: processingError.message }));
      await pub.quit();
    } catch (_) {}
    throw processingError;
  }

  try {
    const pub = new Redis(process.env.REDIS_URL);
    await pub.publish(`exam:done:${tenant_id}`, JSON.stringify({ exam_id }));
    await pub.quit();
  } catch (_) {}
}
```

- [ ] **Step 4: Adicionar roteamento no início de processExam**

Dentro da função `processExam`, logo após a declaração da função (antes do `const client = await pool.connect()`), adicionar:

```javascript
async function processExam({ exam_id, tenant_id, file_path, file_type = 'pdf', selected_agents, chief_complaint, current_symptoms }) {
  // Rota para pipeline de imagem se não for PDF de laudo
  if (file_type === 'dicom' || file_type === 'image') {
    return processImagingExam({ exam_id, tenant_id, file_path, file_type });
  }
  // ... restante do código existente sem alteração
```

Atenção: a assinatura atual de `processExam` é:
```javascript
async function processExam({ exam_id, tenant_id, file_path, selected_agents, chief_complaint, current_symptoms }) {
```
Adicione apenas `file_type = 'pdf'` ao destructuring e o bloco de roteamento no início. Todo o corpo existente permanece intacto.

- [ ] **Step 5: Rebuild worker e verificar**

```bash
docker compose build worker
docker compose up -d worker
docker compose logs worker --tail=20
```

Expected: worker inicia sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/processors/exam.js
git commit -m "feat(worker): pipeline de imagem — roteamento file_type + processImagingExam"
```

---

## Task 7: API — aceitar uploads de imagem + proxy de imagem

**Files:**
- Modify: `apps/api/src/routes/exams.js`

- [ ] **Step 1: Atualizar validação de MIME type no POST /exams**

Localizar a linha:
```javascript
if (fileData.mimetype !== 'application/pdf') {
  return reply.status(400).send({ error: 'Only PDF files are accepted' });
}
```

Substituir por:

```javascript
const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/tiff',
  'application/dicom', 'application/octet-stream',
];
const fileExt = (fileData.filename || '').toLowerCase().split('.').pop();
const isDicom = fileExt === 'dcm' || fileExt === 'dicom' || fileData.mimetype === 'application/dicom';
const isImage = ['jpg', 'jpeg', 'png', 'tiff', 'tif'].includes(fileExt);
const isPdf   = fileData.mimetype === 'application/pdf' || fileExt === 'pdf';

if (!isDicom && !isImage && !isPdf) {
  return reply.status(400).send({ error: 'Formato não suportado. Envie PDF, DICOM (.dcm), JPG ou PNG.' });
}

const file_type = isDicom ? 'dicom' : isImage ? 'image' : 'pdf';
const contentType = isPdf ? 'application/pdf' : isDicom ? 'application/octet-stream' : fileData.mimetype;
```

- [ ] **Step 2: Passar file_type para o INSERT e para o job**

Localizar a query de INSERT:
```javascript
const { rows } = await client.query(
  `INSERT INTO exams (tenant_id, subject_id, uploaded_by, file_path, status, source)
   VALUES ($1, $2, $3, $4, 'pending', 'upload')
   RETURNING id, status`,
  [tenant_id, subject_id, user_id, s3Path]
);
```

Substituir por:

```javascript
const { rows } = await client.query(
  `INSERT INTO exams (tenant_id, subject_id, uploaded_by, file_path, status, source, file_type)
   VALUES ($1, $2, $3, $4, 'pending', 'upload', $5)
   RETURNING id, status`,
  [tenant_id, subject_id, user_id, s3Path, file_type]
);
```

Localizar o `examQueue.add`:
```javascript
await examQueue.add('process', { exam_id, tenant_id, file_path: s3Path, selected_agents, chief_complaint, current_symptoms });
```

Substituir por:

```javascript
await examQueue.add('process', { exam_id, tenant_id, file_path: s3Path, file_type, selected_agents, chief_complaint, current_symptoms });
```

- [ ] **Step 3: Atualizar também o contentType no uploadFile**

Localizar:
```javascript
const s3Path = await uploadFile(key, fileData._buffer, 'application/pdf');
```

Substituir por:

```javascript
const s3Path = await uploadFile(key, fileData._buffer, contentType);
```

(A variável `contentType` foi definida no Step 1.)

- [ ] **Step 4: Adicionar rota de proxy de imagem ao final do arquivo**

Após a última rota existente e antes do `}` que fecha o `module.exports = async function (fastify)`, adicionar:

```javascript
// GET /exams/:id/image — proxy S3 para exibição de imagem no browser
fastify.get('/:id/image', { preHandler: [fastify.authenticate] }, async (request, reply) => {
  const { tenant_id } = request.user;
  const { id } = request.params;

  const result = await withTenant(fastify.pg, tenant_id, async (client) => {
    const { rows } = await client.query(
      `SELECT cr.metadata
       FROM clinical_results cr
       JOIN exams e ON e.id = cr.exam_id
       WHERE e.id = $1
         AND cr.agent_type LIKE 'imaging_%'
         AND cr.metadata->>'original_image_url' IS NOT NULL
       LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  });

  if (!result?.metadata?.original_image_url) {
    return reply.status(404).send({ error: 'Imagem não encontrada para este exame' });
  }

  const s3Path = result.metadata.original_image_url;
  const { downloadFile, keyFromPath } = require('../storage/s3');
  const buffer = await downloadFile(keyFromPath(s3Path));

  reply.header('Content-Type', 'image/png');
  reply.header('Cache-Control', 'private, max-age=3600');
  return reply.send(buffer);
});
```

- [ ] **Step 5: Rebuild API e testar**

```bash
docker compose build api
docker compose up -d api
docker compose logs api --tail=20
```

Expected: API inicia sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/exams.js
git commit -m "feat(api): aceitar DICOM/JPG/PNG no upload + proxy GET /exams/:id/image"
```

---

## Task 8: Angular — modelos de dados para imagem

**Files:**
- Modify: `apps/web/src/app/shared/models/api.models.ts`

- [ ] **Step 1: Adicionar interfaces de imaging ao final do arquivo (antes das constantes)**

Localizar o bloco das constantes `HUMAN_SPECIALTIES` e `SPECIALTY_AGENTS` e inserir antes delas:

```typescript
export interface ImagingFinding {
  id: number;
  label: string;
  box?: [number, number, number, number]; // [x1%, y1%, x2%, y2%]
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface ImagingMetadata {
  original_image_url?: string;
  findings: ImagingFinding[];
  measurements?: {
    rate?: string;
    pr_interval?: string;
    qrs_duration?: string;
    qt_interval?: string;
    axis?: string;
  } | null;
}
```

- [ ] **Step 2: Estender ClinicalResult com metadata opcional**

Localizar:
```typescript
export interface ClinicalResult {
  agent_type: string;
  interpretation: string;
  risk_scores: Record<string, string>;
  alerts: Alert[];
  recommendations: Recommendation[];
  disclaimer: string;
}
```

Substituir por:

```typescript
export interface ClinicalResult {
  agent_type: string;
  interpretation: string;
  risk_scores: Record<string, string>;
  alerts: Alert[];
  recommendations: Recommendation[];
  disclaimer: string;
  metadata?: ImagingMetadata;
}
```

- [ ] **Step 3: Estender Exam com file_type**

Localizar:
```typescript
export interface Exam {
  id: string;
  subject_id?: string;
  /** @deprecated use subject_id */
  patient_id?: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  source: string;
  file_path: string;
  created_at: string;
  updated_at: string;
  results: ClinicalResult[] | null;
  review_status?: 'pending' | 'viewed' | 'reviewed';
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  max_severity_score?: number;
}
```

Substituir por:

```typescript
export interface Exam {
  id: string;
  subject_id?: string;
  /** @deprecated use subject_id */
  patient_id?: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  source: string;
  file_path: string;
  file_type?: 'pdf' | 'dicom' | 'image' | 'unknown';
  created_at: string;
  updated_at: string;
  results: ClinicalResult[] | null;
  review_status?: 'pending' | 'viewed' | 'reviewed';
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  max_severity_score?: number;
}
```

- [ ] **Step 4: Build para verificar tipos**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -E "error|warning" | head -20
```

Expected: sem erros de tipo nas interfaces.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/shared/models/api.models.ts
git commit -m "feat(web): tipos ImagingFinding, ImagingMetadata, estender ClinicalResult e Exam"
```

---

## Task 9: Angular upload — aceitar novos tipos de arquivo

**Files:**
- Modify: `apps/web/src/app/features/doctor/exams/exam-upload.component.ts`

- [ ] **Step 1: Atualizar o input file e validação**

Localizar:
```html
<input #fileInput type="file" accept=".pdf" class="hidden-input" (change)="onFileSelected($event)" />
```

Substituir por:
```html
<input #fileInput type="file" accept=".pdf,.dcm,.dicom,.jpg,.jpeg,.png" class="hidden-input" (change)="onFileSelected($event)" />
```

- [ ] **Step 2: Atualizar texto do drop zone**

Localizar:
```html
<p class="drop-title">Arraste o PDF aqui</p>
<p class="drop-sub">ou clique para selecionar o arquivo</p>
<span class="browse-hint">Selecionar PDF</span>
```

Substituir por:
```html
<p class="drop-title">Arraste o arquivo aqui</p>
<p class="drop-sub">PDF, DICOM (.dcm), JPG ou PNG</p>
<span class="browse-hint">Selecionar arquivo</span>
```

E o subtítulo da página:
```html
<span class="page-sub">Upload de laudo laboratorial · PDF</span>
```
Substituir por:
```html
<span class="page-sub">Laudo laboratorial (PDF) · Imagem médica (DICOM, JPG, PNG)</span>
```

- [ ] **Step 3: Atualizar validação em onFileSelected e onDrop**

Localizar em `onFileSelected`:
```typescript
if (file && file.type !== 'application/pdf') {
  this.snackBar.open('Apenas arquivos PDF são aceitos.', '', { duration: 3000 });
  return;
}
```

Substituir por:
```typescript
if (file && !this.isAllowedFile(file)) {
  this.snackBar.open('Formato não suportado. Use PDF, DICOM (.dcm), JPG ou PNG.', '', { duration: 4000 });
  return;
}
```

Localizar em `onDrop`:
```typescript
if (file && file.type !== 'application/pdf') {
  this.snackBar.open('Apenas arquivos PDF são aceitos.', '', { duration: 3000 });
  return;
}
```

Substituir por:
```typescript
if (file && !this.isAllowedFile(file)) {
  this.snackBar.open('Formato não suportado. Use PDF, DICOM (.dcm), JPG ou PNG.', '', { duration: 4000 });
  return;
}
```

- [ ] **Step 4: Adicionar método isAllowedFile na classe**

Na classe `ExamUploadComponent`, adicionar após a declaração das propriedades:

```typescript
private isAllowedFile(file: File): boolean {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff', 'application/dicom', 'application/octet-stream'];
  const allowedExts  = ['pdf', 'dcm', 'dicom', 'jpg', 'jpeg', 'png', 'tiff'];
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  return allowedTypes.includes(file.type) || allowedExts.includes(ext);
}
```

- [ ] **Step 5: Build e verificar**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -E "error" | head -10
```

Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/doctor/exams/exam-upload.component.ts
git commit -m "feat(web): upload aceita DICOM, JPG, PNG além de PDF"
```

---

## Task 10: Angular — componente de resultado de imagem

**Files:**
- Create: `apps/web/src/app/features/doctor/results/imaging-result.component.ts`

- [ ] **Step 1: Criar o componente**

```typescript
// apps/web/src/app/features/doctor/results/imaging-result.component.ts
import {
  Component, Input, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit, inject
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { environment } from '../../../../environments/environment';
import { ClinicalResult, ImagingFinding } from '../../../shared/models/api.models';

@Component({
  selector: 'app-imaging-result',
  standalone: true,
  imports: [MatIconModule, MatButtonModule],
  styles: [`
    :host { display: block; }
    .viewer-container { position: relative; display: inline-block; max-width: 100%; }
    .exam-image { max-width: 100%; display: block; border-radius: 6px; border: 1px solid rgba(70,69,84,0.25); }
    .overlay-canvas { position: absolute; top: 0; left: 0; pointer-events: none; }
    .image-controls { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; }
    .disclaimer-box {
      margin-top: 0.75rem; padding: 0.5rem 0.75rem;
      background: rgba(255,183,0,0.08); border: 1px solid rgba(255,183,0,0.2); border-radius: 4px;
      font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #ffdd88;
    }
    .findings-list { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .finding-item {
      display: flex; align-items: flex-start; gap: 0.75rem;
      padding: 0.625rem 0.75rem;
      background: #0b1326; border-radius: 4px; border: 1px solid rgba(70,69,84,0.2);
      cursor: pointer; transition: border-color 150ms ease;
    }
    .finding-item:hover { border-color: rgba(192,193,255,0.3); }
    .finding-badge {
      flex-shrink: 0; width: 28px; height: 28px; border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; color: #000;
    }
    .finding-body { flex: 1; min-width: 0; }
    .finding-label { font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600; color: #dae2fd; }
    .finding-desc { font-family: 'Inter', sans-serif; font-size: 12px; color: #a09fb2; margin-top: 2px; }
    .severity-critical { border-color: rgba(255,68,68,0.3); }
    .severity-high     { border-color: rgba(255,136,0,0.3); }
    .severity-medium   { border-color: rgba(255,221,0,0.25); }
    .severity-low      { border-color: rgba(68,187,68,0.25); }
    .measurements-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .measurement-cell {
      background: #0b1326; border: 1px solid rgba(70,69,84,0.2); border-radius: 4px;
      padding: 0.5rem 0.625rem; text-align: center;
    }
    .meas-label { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #6e6d80; display: block; margin-bottom: 2px; }
    .meas-value { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; color: #c0c1ff; }
    .no-image-msg { padding: 1rem; background: rgba(70,69,84,0.08); border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #6e6d80; }
    .loading-img { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #6e6d80; padding: 1rem 0; }
  `],
  template: `
    <!-- ECG Measurements -->
    @if (measurements && hasMeasurements()) {
      <div class="measurements-grid">
        @if (measurements.rate) {
          <div class="measurement-cell">
            <span class="meas-label">FC</span>
            <span class="meas-value">{{ measurements.rate }}</span>
          </div>
        }
        @if (measurements.pr_interval) {
          <div class="measurement-cell">
            <span class="meas-label">PR</span>
            <span class="meas-value">{{ measurements.pr_interval }}</span>
          </div>
        }
        @if (measurements.qrs_duration) {
          <div class="measurement-cell">
            <span class="meas-label">QRS</span>
            <span class="meas-value">{{ measurements.qrs_duration }}</span>
          </div>
        }
        @if (measurements.qt_interval) {
          <div class="measurement-cell">
            <span class="meas-label">QT</span>
            <span class="meas-value">{{ measurements.qt_interval }}</span>
          </div>
        }
        @if (measurements.axis) {
          <div class="measurement-cell">
            <span class="meas-label">Eixo</span>
            <span class="meas-value">{{ measurements.axis }}</span>
          </div>
        }
      </div>
    }

    <!-- Image viewer -->
    @if (imageUrl) {
      <div class="image-controls">
        <button mat-stroked-button style="font-size:11px;" (click)="toggleAnnotations()">
          <mat-icon style="font-size:15px">{{ showAnnotations ? 'visibility_off' : 'visibility' }}</mat-icon>
          {{ showAnnotations ? 'Ocultar marcações' : 'Mostrar marcações' }}
        </button>
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#6e6d80;">
          {{ findings.length }} achado{{ findings.length !== 1 ? 's' : '' }} identificado{{ findings.length !== 1 ? 's' : '' }}
        </span>
      </div>
      <div class="viewer-container">
        <img #imageEl class="exam-image" [src]="imageUrl" alt="Imagem do exame"
             (load)="onImageLoad()" (error)="onImageError()" />
        <canvas #overlayCanvas class="overlay-canvas"></canvas>
      </div>
      <div class="disclaimer-box">
        ⚠ Marcações aproximadas identificadas pela IA — validação profissional obrigatória.
        Achados sutis podem não estar marcados ou estar levemente deslocados.
      </div>
    } @else if (loadingImage) {
      <p class="loading-img">Carregando imagem...</p>
    } @else if (noImage) {
      <div class="no-image-msg">
        Análise de PDF por imagem — visualização da imagem não disponível nesta versão.
        Os achados abaixo foram identificados via análise do documento.
      </div>
    }

    <!-- Findings list -->
    @if (findings.length > 0) {
      <div class="findings-list">
        @for (f of findings; track f.id) {
          <div class="finding-item" [class]="'severity-' + f.severity" (click)="highlightFinding(f)">
            <div class="finding-badge" [style.background]="severityColor(f.severity)">
              [{{ f.id }}]
            </div>
            <div class="finding-body">
              <div class="finding-label">{{ f.label }}</div>
              @if (f.description) {
                <div class="finding-desc">{{ f.description }}</div>
              }
            </div>
          </div>
        }
      </div>
    }
  `
})
export class ImagingResultComponent implements OnChanges, AfterViewInit {
  @Input({ required: true }) result!: ClinicalResult;
  @Input({ required: true }) examId!: string;

  @ViewChild('imageEl')      imageRef!: ElementRef<HTMLImageElement>;
  @ViewChild('overlayCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  private http = inject(HttpClient);

  imageUrl: string | null = null;
  loadingImage = false;
  noImage = false;
  showAnnotations = true;
  findings: ImagingFinding[] = [];
  measurements: ClinicalResult['metadata']['measurements'] = null;

  private highlightedId: number | null = null;
  private imageLoaded = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['result']) {
      this.findings     = this.result.metadata?.findings     ?? [];
      this.measurements = this.result.metadata?.measurements ?? null;
      const imageUrl    = this.result.metadata?.original_image_url;

      if (imageUrl) {
        this.loadImage();
      } else {
        this.noImage = true;
      }
    }
  }

  ngAfterViewInit(): void {
    if (this.imageLoaded) this.drawFindings();
  }

  private loadImage(): void {
    this.loadingImage = true;
    this.http.get(`${environment.apiUrl}/exams/${this.examId}/image`, { responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          this.imageUrl     = URL.createObjectURL(blob);
          this.loadingImage = false;
        },
        error: () => {
          this.loadingImage = false;
          this.noImage = true;
        }
      });
  }

  onImageLoad(): void {
    this.imageLoaded = true;
    this.syncCanvasSize();
    this.drawFindings();
  }

  onImageError(): void {
    this.noImage = true;
    this.imageUrl = null;
  }

  private syncCanvasSize(): void {
    const img    = this.imageRef?.nativeElement;
    const canvas = this.canvasRef?.nativeElement;
    if (!img || !canvas) return;
    canvas.width  = img.clientWidth;
    canvas.height = img.clientHeight;
    canvas.style.width  = img.clientWidth  + 'px';
    canvas.style.height = img.clientHeight + 'px';
  }

  toggleAnnotations(): void {
    this.showAnnotations = !this.showAnnotations;
    this.drawFindings();
  }

  highlightFinding(finding: ImagingFinding): void {
    this.highlightedId = finding.id === this.highlightedId ? null : finding.id;
    this.drawFindings();
  }

  drawFindings(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!this.showAnnotations) return;

    this.findings.forEach(f => {
      if (!f.box) return;
      const [x1p, y1p, x2p, y2p] = f.box;
      const x = x1p * canvas.width;
      const y = y1p * canvas.height;
      const w = (x2p - x1p) * canvas.width;
      const h = (y2p - y1p) * canvas.height;

      const color     = this.severityColor(f.severity);
      const isHighlit = this.highlightedId === f.id;

      // Fill
      ctx.fillStyle = color + (isHighlit ? '44' : '18');
      ctx.fillRect(x, y, w, h);

      // Dashed border (solid when highlighted)
      ctx.strokeStyle = color;
      ctx.lineWidth   = isHighlit ? 3 : 2;
      ctx.setLineDash(isHighlit ? [] : [6, 3]);
      ctx.strokeRect(x, y, w, h);

      // Label badge [N]
      ctx.setLineDash([]);
      const badgeW = 28, badgeH = 20;
      ctx.fillStyle = color;
      ctx.fillRect(x, y - badgeH, badgeW, badgeH);
      ctx.fillStyle = '#000000';
      ctx.font = `bold ${isHighlit ? 13 : 11}px monospace`;
      ctx.fillText(`[${f.id}]`, x + 3, y - 5);
    });
  }

  severityColor(severity: string): string {
    const map: Record<string, string> = {
      critical: '#FF4444',
      high:     '#FF8800',
      medium:   '#FFDD00',
      low:      '#44BB44',
    };
    return map[severity] ?? '#C0C1FF';
  }

  hasMeasurements(): boolean {
    const m = this.measurements;
    if (!m) return false;
    return !!(m.rate || m.pr_interval || m.qrs_duration || m.qt_interval || m.axis);
  }
}
```

- [ ] **Step 2: Build para verificar componente**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -E "error" | head -20
```

Expected: sem erros. Warnings de budget são aceitáveis se dentro dos limites configurados.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/features/doctor/results/imaging-result.component.ts
git commit -m "feat(web): ImagingResultComponent com viewer de imagem + canvas overlay de achados"
```

---

## Task 11: Angular result-panel — integrar imaging component

**Files:**
- Modify: `apps/web/src/app/features/doctor/results/result-panel.component.ts`

- [ ] **Step 1: Adicionar import do ImagingResultComponent**

No bloco de imports TypeScript no topo do arquivo, adicionar:

```typescript
import { ImagingResultComponent } from './imaging-result.component';
```

- [ ] **Step 2: Adicionar ImagingResultComponent ao array imports do @Component**

Localizar o array `imports` do decorator `@Component` e adicionar `ImagingResultComponent`:

```typescript
imports: [
  DatePipe, FormsModule, NgTemplateOutlet, UpperCasePipe,
  MatCardModule, MatSelectModule, MatDividerModule, MatButtonModule, MatIconModule, MatDialogModule,
  AlertBadgeComponent, RiskMeterComponent, DisclaimerComponent, PrescriptionModalComponent,
  ImagingResultComponent   // ← adicionar aqui
],
```

- [ ] **Step 3: Adicionar helper isImagingAgent na classe**

Na classe `ResultPanelComponent`, adicionar após os métodos existentes:

```typescript
isImagingAgent(agentType: string): boolean {
  return agentType.startsWith('imaging_');
}

agentLabel(agentType: string): string {
  const labels: Record<string, string> = {
    metabolic:            'Metabólico',
    cardiovascular:       'Cardiovascular',
    hematology:           'Hematologia',
    small_animals:        'Pequenos Animais',
    equine:               'Equinos',
    bovine:               'Bovinos',
    therapeutic:          'Terapêutico',
    nutrition:            'Nutrição',
    clinical_correlation: 'Correlação Clínica',
    imaging_rx:           'Radiografia (IA)',
    imaging_ecg:          'ECG (IA)',
    imaging_ultrasound:   'Ultrassom (IA)',
  };
  return labels[agentType] ?? agentType;
}
```

**Nota:** se já existe um método `agentLabel`, apenas adicione as três entradas de imaging ao objeto de labels existente.

- [ ] **Step 4: Adicionar bloco de imaging dentro do #resultTpl**

Dentro do `<ng-template #resultTpl let-e>`, localizar o bloco do `agent-card`:

```html
<div class="agent-card" [class]="'severity-' + getTopSeverity(result.alerts)">
  <div class="agent-header">
    ...
  </div>
```

Após o fechamento de `.agent-header` e antes de `@if (result.alerts?.length)`, inserir o bloco condicional de imagem:

```html
<!-- Viewer de imagem para agentes imaging_* -->
@if (isImagingAgent(result.agent_type) && result.metadata?.original_image_url && e === exam) {
  <div style="margin: 1rem 0;">
    <app-imaging-result [result]="result" [examId]="e.id" />
  </div>
}
```

Ficará assim (trecho resumido):
```html
<div class="agent-card" [class]="'severity-' + getTopSeverity(result.alerts)">
  <div class="agent-header">
    <span class="agent-badge">{{ agentLabel(result.agent_type) }}</span>
    ...
  </div>

  <!-- Viewer de imagem para agentes imaging_* -->
  @if (isImagingAgent(result.agent_type) && result.metadata?.original_image_url && e === exam) {
    <div style="margin: 1rem 0;">
      <app-imaging-result [result]="result" [examId]="e.id" />
    </div>
  }

  @if (result.alerts?.length) {
    ...
```

- [ ] **Step 5: Adicionar ícone de câmera no agentLabel do template**

No template, localizar onde o `agent-badge` é exibido:
```html
<span class="agent-badge">{{ agentLabel(result.agent_type) }}</span>
```

Substituir por:
```html
<span class="agent-badge">
  @if (isImagingAgent(result.agent_type)) {
    <mat-icon style="font-size:14px;width:14px;height:14px;vertical-align:middle;margin-right:4px;">camera_alt</mat-icon>
  }
  {{ agentLabel(result.agent_type) }}
</span>
```

- [ ] **Step 6: Build final**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -E "error" | head -20
```

Expected: sem erros de compilação.

- [ ] **Step 7: Verificar que o build de produção passa os budget limits**

```bash
cd apps/web && npx ng build 2>&1 | tail -30
```

Expected: sem budget errors. Se aparecer, aumentar `maximumError` em `angular.json` (initial budget) para `2MB`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/features/doctor/results/result-panel.component.ts
git commit -m "feat(web): result-panel exibe ImagingResultComponent para agentes imaging_*"
```

---

## Verificação End-to-End

Após todas as tasks, testar o fluxo completo:

- [ ] **Smoke test — upload de JPG**

1. Abrir `http://localhost:4200`
2. Login como admin
3. Selecionar um paciente (ou animal)
4. Em "Enviar Exame", fazer upload de uma imagem JPG de RX (qualquer imagem PNG/JPG funciona para teste)
5. Aguardar processamento (WebSocket notifica quando concluir)
6. Acessar o resultado do exame
7. Verificar:
   - Resultado `imaging_rx` aparece com ícone de câmera
   - Imagem é exibida
   - Bounding boxes aparecem sobre a imagem
   - Lista de achados aparece abaixo
   - Toggle "Ocultar/Mostrar marcações" funciona
   - Clicar em um achado destaca o bounding box correspondente

- [ ] **Smoke test — DICOM** (se disponível arquivo `.dcm` de teste)

```bash
# Baixar DICOM de teste público
wget https://www.dicomlibrary.com/mex/dicom-download/?accessionNumber=a114e7e6-7e3b-4bf0-a6ee-5af97a640ef7 -O test.dcm
```

Upload do `.dcm` e verificar mesmo fluxo acima.

- [ ] **Verificar logs do worker**

```bash
docker compose logs worker --tail=50
```

Verificar que não há erros de processamento.

---

## Notas de Deploy

- **Fase 1 não requer alterações no Dockerfile do worker** — `dcmjs` e `jimp` são puro JavaScript, sem dependências nativas.
- Migration 040 deve ser aplicada antes do deploy via `genomaflow-prod-migrate` ECS task (já no pipeline CI/CD).
- Rebuild dos containers `api` e `worker` é necessário para incluir as novas dependências e código.
- O campo `file_type` default `'pdf'` garante retrocompatibilidade com exames existentes.
