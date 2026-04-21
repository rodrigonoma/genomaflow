# Agente de Análise de Imagens Médicas (DICOM + PDF com imagem)

**Data:** 2026-04-15  
**Status:** Aprovada  
**Autor:** Sessão de brainstorm CEO/CTO + Eng Sênior IA + PO Sênior

---

## Objetivo

Expandir o pipeline de análise do GenomaFlow para suportar exames por imagem — não apenas laudos laboratoriais em texto. Radiografias, tomografias, ultrassons, ECGs digitalizados e patologias compõem a maioria dos exames clínicos de alto valor. Análise de imagem via IA é o próximo salto de valor do produto.

O modelo Claude claude-sonnet-4-6 (já em uso) tem capacidade de visão nativa — este spec documenta como integrá-lo ao pipeline existente, adicionando suporte a DICOM, PNG/JPG médico e PDFs com imagens incorporadas.

---

## Casos de Uso Prioritários

| Modalidade | Formato de entrada | Agente |
|---|---|---|
| Radiografia (RX) tórax/ossos | DICOM, JPG, PNG | `imaging_radiology` |
| Tomografia computadorizada | DICOM série | `imaging_ct` |
| Ultrassom (laudo PDF + imagem) | PDF, JPG | `imaging_ultrasound` |
| ECG digitalizado | JPG, PNG, PDF | `imaging_ecg` |
| Anatomia patológica (histologia) | JPG, DICOM | `imaging_pathology` |
| Fundo de olho / retinografia | JPG, DICOM | `imaging_ophthalmology` |

**Fase 1 (prioridade):** RX tórax, ECG, Ultrassom — maior volume, maior impacto clínico, casos mais bem suportados pelo modelo.

---

## Arquitetura

```
Upload (DICOM / JPG / PNG / PDF)
        │
        ▼
┌────────────────────────┐
│  Ingestion Layer       │
│  Detecta tipo de arquivo│
│  DICOM → converter      │
│  PDF   → extrai imagens │
│  JPG/PNG → pass-through │
└──────────┬─────────────┘
           │ imagem normalizada (PNG/JPG base64 ou URL)
           ▼
┌────────────────────────┐
│  Image Classifier      │
│  Detecta modalidade:   │
│  rx | ct | us | ecg   │
│  patho | ophtho | other│
└──────────┬─────────────┘
           │ modalidade detectada
           ▼
┌────────────────────────┐
│  Agent Router          │
│  Seleciona agente(s)   │
│  imaging_* por         │
│  modalidade            │
└──────────┬─────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
imaging_rx    imaging_ecg  (etc.)
    │
    ▼
┌────────────────────────┐
│  Claude claude-sonnet-4-6       │
│  (vision) + RAG        │
│  guidelines            │
└──────────┬─────────────┘
           │ resultado estruturado
           ▼
┌────────────────────────┐
│  clinical_results      │
│  (mesma tabela atual)  │
└────────────────────────┘
```

---

## Conversão DICOM

DICOM é o padrão universal para imagens médicas. Antes de enviar ao modelo, precisamos converter para PNG/JPG.

### Biblioteca: `dcmjs` + `cornerstone-wado-image-loader`
Alternativa server-side mais simples: `pydicom` via script Python, ou `dicom-parser` + canvas no Node.js.

**Decisão para Fase 1:** usar `dcmjs` no Node.js (sem dependência de Python).

### Processo de conversão:
```javascript
const dcmjs = require('dcmjs');
const Jimp = require('jimp'); // para pixel manipulation

async function dicomToImage(buffer) {
  const dataSet = dcmjs.data.DicomMessage.readFile(buffer.buffer);
  const dataset = dataSet.dict;

  // Extrair metadados clínicos do header DICOM
  const meta = {
    modality:      dataset['00080060']?.Value?.[0],  // CT, MR, RX, US, etc.
    bodyPart:      dataset['00180015']?.Value?.[0],  // CHEST, ABDOMEN, etc.
    patientAge:    dataset['00101010']?.Value?.[0],
    studyDesc:     dataset['00081030']?.Value?.[0],
    seriesDesc:    dataset['0008103E']?.Value?.[0],
    institution:   dataset['00080080']?.Value?.[0],
    rows:          dataset['00280010']?.Value?.[0],
    cols:          dataset['00280011']?.Value?.[0],
    bitsAllocated: dataset['00280100']?.Value?.[0],
    windowCenter:  dataset['00281050']?.Value?.[0],
    windowWidth:   dataset['00281051']?.Value?.[0],
  };

  // Extrair pixel data e converter para PNG
  const pixelData = new Uint16Array(
    dataset['7FE00010'].Value[0].buffer
  );

  // Aplicar windowing (window center/width) para visualização diagnóstica
  const image = applyWindowLevel(pixelData, meta.windowCenter, meta.windowWidth, meta.rows, meta.cols);
  const pngBuffer = await toPng(image, meta.rows, meta.cols);

  return { pngBuffer, meta };
}
```

### Windowing (crítico para diagnóstico):
Imagens DICOM têm 12-16 bits de profundidade. A janela (window center/width) define o intervalo de Hounsfield Units visível. Aplicar a janela errada = imagem ilegível para o modelo. Usar sempre os valores do header DICOM ou defaults por modalidade:

```javascript
const WINDOW_DEFAULTS = {
  CT:   { center:  40, width: 400 },  // tecidos moles
  CR:   { center: 128, width: 256 },  // radiografia
  MR:   { center: 512, width: 1024 }, // ressonância
  US:   { center: 128, width: 256 },  // ultrassom
};
```

---

## Extração de Imagens de PDF

Muitos laudos chegam como PDF com imagens incorporadas (ultrassom, ECG em papel digitalizado, etc.).

```javascript
const { getDocument } = require('pdfjs-dist'); // já instalado

async function extractImagesFromPdf(buffer) {
  const pdf = await getDocument({ data: buffer }).promise;
  const images = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const ops = await page.getOperatorList();
    // Renderizar cada página como imagem PNG (fallback simples e confiável)
    const viewport = page.getViewport({ scale: 2.0 }); // 2x para qualidade
    // usar canvas (node-canvas) para renderizar
    images.push(await renderPageToBuffer(page, viewport));
  }

  return images; // Array de PNG buffers
}
```

---

## Classificador de Modalidade

Antes de rotear para o agente correto, classificamos a modalidade. Duas estratégias:

**Estratégia 1 — Header DICOM** (quando disponível):
- Campo `Modality (0008,0060)`: `CR`/`DX` = RX, `CT`, `MR`, `US`, `ECG`, `SM` (patologia)

**Estratégia 2 — Visual classifier via Claude** (PDF/JPG sem metadata):
```javascript
async function classifyModalidade(imageBase64) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 }},
        { type: 'text', text: 'Classify this medical image. Respond ONLY with one word: rx | ct | mri | ultrasound | ecg | pathology | ophthalmology | other' }
      ]
    }]
  });
  return response.content[0].text.trim().toLowerCase();
}
```

---

## Anotação Visual de Achados (ROI — Region of Interest)

### Objetivo

Após a análise de imagem, o worker gera uma cópia anotada da imagem com marcações numeradas sobre cada achado. O texto de interpretação referencia cada marcação por número (`[1]`, `[2]`, etc.), permitindo que o médico/veterinário localize exatamente onde a IA encontrou o achado e valide se a marcação faz sentido clínico.

**Exemplo de output:**

> "Observa-se consolidação lobar inferior direita **(marcação [1])**, com padrão sugestivo de processo pneumônico bacteriano. Aumento da silhueta cardíaca **(marcação [2])**, índice cardiotorácico estimado em 0,58."

### Formato de coordenadas retornado pelo Claude

Os agentes de imagem devem retornar coordenadas em **percentual da dimensão da imagem** (`0.0` a `1.0`) para cada achado com localização definida:

```json
"findings": [
  {
    "id": 1,
    "label": "Consolidação lobar inferior direita",
    "box": [0.55, 0.60, 0.82, 0.90],
    "severity": "high",
    "description": "Opacidade heterogênea com broncograma aéreo"
  },
  {
    "id": 2,
    "label": "Aumento da silhueta cardíaca",
    "box": [0.30, 0.25, 0.70, 0.75],
    "severity": "medium",
    "description": "Índice cardiotorácico estimado 0,58"
  }
]
```

O campo `box` segue o padrão `[x1, y1, x2, y2]` em percentual. Achados sem localização precisa (ex: achados globais, qualidade de imagem) não incluem `box`.

### Limitações e disclaimer obrigatório

As coordenadas são **aproximações**. Claude Vision retorna regiões com boa precisão para achados grandes e visualmente distintos (consolidações, cardiomegalia, derrames), mas pode imprecisa para achados sutis (nódulos < 5mm, microfraturas). O bounding box deve ser exibido com **borda tracejada** (não sólida) para comunicar visualmente que é uma região aproximada.

Texto de disclaimer a exibir junto à imagem anotada:
> "As marcações indicam regiões aproximadas identificadas pela IA. Achados sutis podem não estar marcados ou estar levemente deslocados. Validação profissional obrigatória."

### Processo de anotação no worker

```javascript
const { createCanvas, loadImage } = require('canvas'); // node-canvas

async function annotateImage(pngBuffer, findings) {
  const img = await loadImage(pngBuffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');

  // Desenha imagem original
  ctx.drawImage(img, 0, 0);

  findings.forEach((finding) => {
    if (!finding.box) return; // sem coordenada, pula
    const [x1p, y1p, x2p, y2p] = finding.box;
    const x  = x1p * img.width;
    const y  = y1p * img.height;
    const w  = (x2p - x1p) * img.width;
    const h  = (y2p - y1p) * img.height;

    // Cor por severidade
    const color = { critical: '#FF4444', high: '#FF8800', medium: '#FFDD00', low: '#44BB44' }[finding.severity] ?? '#FFFFFF';

    // Bounding box tracejado
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, w, h);

    // Background semitransparente para o label
    ctx.fillStyle = color + '33'; // 20% opacity
    ctx.fillRect(x, y, w, h);

    // Label numerado
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 18, 22, 18);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 12px Arial';
    ctx.fillText(`[${finding.id}]`, x + 3, y - 4);
  });

  return canvas.toBuffer('image/png');
}
```

### Armazenamento

| Arquivo | Path no S3 | TTL |
|---|---|---|
| Imagem original normalizada (PNG) | `uploads/{tenant_id}/{exam_id}/original.png` | 7 dias |
| Imagem anotada | `uploads/{tenant_id}/{exam_id}/annotated.png` | 7 dias |

Ambas as URLs são salvas em `clinical_results.metadata` (JSONB):
```json
{
  "original_image_url": "https://cdn.../original.png",
  "annotated_image_url": "https://cdn.../annotated.png",
  "findings": [...]
}
```

---

## Agentes de Imagem

### Estrutura comum

Todos os agentes de imagem seguem o mesmo padrão dos agentes textuais, com adição de `image` no contexto. O prompt exige `findings` com coordenadas e referências numeradas no texto de interpretação:

```javascript
async function runImagingAgent(agentName, { imageBase64, imageMeta, patient, guidelines }) {
  const systemPrompt = SYSTEM_PROMPTS[agentName];
  const guidelinesText = guidelines.map(g => `## ${g.title}\n${g.content}`).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: imageBase64 }
        },
        {
          type: 'text',
          text: `Patient: sex=${patient.sex}, age_range=${patient.age_range}
DICOM metadata: ${JSON.stringify(imageMeta)}

Guidelines:
${guidelinesText}

Analyze this medical image. For each finding with a locatable region, include a "box" with [x1%, y1%, x2%, y2%] coordinates (0.0-1.0 range). Reference each finding by its [N] number in the interpretation text.`
        }
      ]
    }]
  });

  const rawText = response.content?.[0]?.text ?? '';
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;
  return JSON.parse(jsonText);
}
```

### System Prompts por modalidade

O JSON de saída de todos os agentes agora inclui `findings` com `id`, `label`, `box` (coordenadas opcionais) e `description`. O campo `interpretation` deve referenciar cada achado pelo número `[N]`.

**imaging_rx (Radiografia):**
```
You are a specialized radiologist AI assistant analyzing chest/bone X-ray images.
Evaluate: lung fields, cardiac silhouette, mediastinum, pleural spaces, bony structures, soft tissues.
Look for: pneumonia, effusions, pneumothorax, cardiomegaly, nodules, consolidations, fractures.
Respond ONLY with valid JSON:
{
  "interpretation": "<detailed findings in Brazilian Portuguese — reference each finding as [N] e.g. 'Consolidação observada [1]...'>",
  "risk_scores": { "pulmonary": "<LOW|MEDIUM|HIGH|CRITICAL>", "cardiac": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "findings": [
    {
      "id": 1,
      "label": "<short finding name>",
      "box": [x1, y1, x2, y2],
      "severity": "<low|medium|high|critical>",
      "description": "<detailed finding description in Brazilian Portuguese>"
    }
  ],
  "alerts": [{ "marker": "<finding>", "value": "<description>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "Esta análise é um suporte à decisão clínica e não substitui avaliação radiológica profissional."
}
box coordinates: [x1, y1, x2, y2] as fraction of image dimensions (0.0 to 1.0). Omit box if finding has no specific localizable region.
Never diagnose. Provide clinical decision support only. If image quality is insufficient, state so in interpretation.
```

**imaging_ecg (ECG):**
```
You are a specialized cardiologist AI assistant analyzing ECG/electrocardiogram tracings.
Evaluate: rhythm, rate, P waves, PR interval, QRS complex, ST segment, T waves, QT interval, axis.
Look for: arrhythmias, blocks, ischemia, infarction patterns, hypertrophy, electrolyte abnormalities.
Respond ONLY with valid JSON:
{
  "interpretation": "<detailed analysis in Brazilian Portuguese — reference each finding as [N]>",
  "risk_scores": { "cardiac_rhythm": "<LOW|MEDIUM|HIGH|CRITICAL>", "ischemia": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "measurements": { "rate": "<bpm>", "pr_interval": "<ms>", "qrs_duration": "<ms>", "qt_interval": "<ms>" },
  "findings": [
    {
      "id": 1,
      "label": "<short finding name, e.g. Supradesnivelamento ST V1-V3>",
      "box": [x1, y1, x2, y2],
      "severity": "<low|medium|high|critical>",
      "description": "<description in Brazilian Portuguese>"
    }
  ],
  "alerts": [{ "marker": "<finding>", "value": "<description>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "Esta análise é um suporte à decisão clínica e não substitui avaliação cardiológica profissional."
}
box: region of the ECG strip where the finding is visible, as fraction of image (0.0-1.0). Omit if global finding.
```

**imaging_ultrasound (Ultrassom):**
```
You are a specialized sonographer AI assistant analyzing ultrasound images.
Evaluate visible structures based on anatomical region shown.
Look for: abnormal echogenicity, masses, fluid collections, organ size alterations, vascular abnormalities.
Respond ONLY with valid JSON:
{
  "interpretation": "<detailed findings in Brazilian Portuguese — reference each finding as [N]>",
  "risk_scores": { "structural": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "findings": [
    {
      "id": 1,
      "label": "<short finding name>",
      "box": [x1, y1, x2, y2],
      "severity": "<low|medium|high|critical>",
      "description": "<description in Brazilian Portuguese>"
    }
  ],
  "alerts": [{ "marker": "<structure>", "value": "<finding>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "Esta análise é um suporte à decisão clínica e não substitui avaliação ultrassonográfica profissional."
}
box: region where the finding is visible, as fraction of image (0.0-1.0). Omit if finding has no specific region.
```

---

## Mudanças no Pipeline (exam.js)

### Detecção de tipo de arquivo

```javascript
const mime = require('mime-types');

function detectFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.dcm' || ext === '.dicom') return 'dicom';
  if (ext === '.pdf') return 'pdf';
  if (['.jpg', '.jpeg', '.png', '.tiff', '.tif'].includes(ext)) return 'image';
  return 'unknown';
}
```

### Integração no processExam

```javascript
async function processExam({ exam_id, tenant_id, file_path }) {
  const fileType = detectFileType(file_path);
  const buffer = fs.readFileSync(file_path);

  let examText = '';
  let examImages = []; // Array de { base64: string, meta: object }

  if (fileType === 'dicom') {
    const { pngBuffer, meta } = await dicomToImage(buffer);
    examImages.push({ base64: pngBuffer.toString('base64'), meta });
    examText = formatDicomMeta(meta); // texto do header para RAG
  } else if (fileType === 'pdf') {
    examText = await extractText(buffer);
    // Tenta extrair imagens do PDF (ultrassom, ECG em PDF, etc.)
    const pdfImages = await extractImagesFromPdf(buffer);
    for (const img of pdfImages) {
      examImages.push({ base64: img.toString('base64'), meta: {} });
    }
  } else if (fileType === 'image') {
    examImages.push({ base64: buffer.toString('base64'), meta: {} });
  }

  // Classificar agentes necessários
  const textAgents = examText ? classifyAgents(examText) : [];
  const imageAgents = examImages.length > 0
    ? await classifyImagingAgents(examImages[0]) // usa primeiro frame para classificar
    : [];

  const allAgents = [...new Set([...textAgents, ...imageAgents])];

  // ... restante do pipeline igual ao atual
}
```

---

## Mudanças no Frontend

### Upload — novos tipos aceitos

```html
<!-- uploads.component.ts -->
<input #singleFile type="file"
  accept=".pdf,.jpg,.jpeg,.png,.dcm,.dicom"
  (change)="onSingleFile($event)" />
```

### Exibição de resultados — novos campos

O `ResultPanelComponent` deve exibir:
- `findings` (lista de achados por imagem)
- `measurements` (quando disponível — ECG)
- Ícone de câmera para agentes de imagem (`imaging_*`)
- Preview da imagem analisada (thumbnail do arquivo de upload)

---

## Armazenamento de Imagens

### Estratégia:
- Imagens convertidas de DICOM são salvas temporariamente em `/tmp/uploads/converted/`
- Não persistir imagens convertidas a longo prazo (privacidade LGPD)
- O arquivo original (DICOM/JPG) permanece em storage por período configurável
- Nas chamadas ao Claude: enviar como base64 inline (< 5MB por imagem) ou via URL temporária (> 5MB)

### Limite de tamanho:
- Claude aceita imagens até 5MB em base64
- Para DICOM de alta resolução (CT séries): converter, comprimir para JPEG 85%, redimensionar para max 2048px
- Para séries CT multiplas: analisar frame representativo (slice central), não todos os frames

---

## RAG — Novos Guidelines de Imagem

Adicionar ao seed de RAG:

| Documento | Fonte | Modalidade |
|---|---|---|
| Diretriz Brasileira de Radiologia (CBR) | CFM/CBR | RX, CT |
| Consenso de Ecocardiografia | SBC | ECG/Echo |
| Manual de Ultrassonografia Obstétrica | FEBRASGO | US |
| Critérios de Interpretação de ECG | SBC/ACC | ECG |
| Classificação ACR-TIRADS | ACR | US tireoide |
| Lung-RADS | ACR | RX/CT pulmão |

---

## Banco de Dados — Alterações

Nenhuma alteração na tabela `clinical_results` — o campo `agent_type` já suporta strings arbitrárias (`imaging_rx`, `imaging_ecg`, etc.). O campo `interpretation` e `alerts` já são TEXT/JSONB.

O campo `metadata` (JSONB) em `clinical_results` armazena as URLs de imagem e os `findings` estruturados:
```json
{
  "original_image_url": "https://cdn.genomaflow.com/uploads/.../original.png",
  "annotated_image_url": "https://cdn.genomaflow.com/uploads/.../annotated.png",
  "findings": [
    { "id": 1, "label": "Consolidação inferior D", "box": [0.55, 0.60, 0.82, 0.90], "severity": "high", "description": "..." }
  ]
}
```

**Novo campo em `exams`:**
```sql
ALTER TABLE exams ADD COLUMN IF NOT EXISTS file_type TEXT
  CHECK (file_type IN ('pdf', 'dicom', 'image', 'unknown'))
  DEFAULT 'pdf';
```

---

## Novos Arquivos no Worker

```
apps/worker/src/
├── converters/
│   ├── dicom.js          → dicomToImage(), formatDicomMeta()
│   └── pdf-images.js     → extractImagesFromPdf() (imagens embutidas)
├── classifiers/
│   ├── markers.js        → (existente — agentes textuais)
│   └── imaging.js        → classifyImagingAgents() — DICOM meta + visual
├── annotators/
│   └── image-annotator.js → annotateImage(pngBuffer, findings) → Buffer PNG anotado
└── agents/
    ├── metabolic.js       → (existente)
    ├── cardiovascular.js  → (existente)
    ├── hematology.js      → (existente)
    ├── imaging-rx.js      → runImagingRxAgent()
    ├── imaging-ecg.js     → runImagingEcgAgent()
    └── imaging-ultrasound.js → runImagingUltrasoundAgent()
```

### Fluxo completo com anotação

```
Upload de imagem
      │
      ▼
Converter para PNG normalizado (dicom → png, pdf → frames)
      │
      ▼
Enviar PNG ao agente Claude Vision
      │
      ▼
Receber { interpretation, findings: [{id, label, box, severity}], alerts }
      │
      ├── Salvar original.png → S3
      │
      ├── annotateImage(pngBuffer, findings) → annotated.png
      │
      ├── Salvar annotated.png → S3
      │
      └── Salvar clinical_result com:
            interpretation (texto com [N] refs)
            findings[]
            metadata.original_image_url
            metadata.annotated_image_url
```

---

## Dependências Novas

```json
{
  "dcmjs": "^0.29.0",
  "node-canvas": "^2.11.2",
  "jimp": "^0.22.12"
}
```

`pdfjs-dist` já está instalado no worker.

---

## Frontend — Exibição de Imagem Anotada

O `ResultPanelComponent` exibe para agentes `imaging_*`:

1. **Imagem anotada** (`annotated_image_url`) como principal — com os bounding boxes numerados visíveis
2. **Toggle "Ver original"** — troca para `original_image_url` sem anotações
3. **Lista de achados numerados** abaixo da imagem — clicável para destacar o marcador correspondente na imagem (highlight visual temporário)
4. **Disclaimer fixo** abaixo da imagem: "Marcações aproximadas — validação profissional obrigatória"
5. Para ECG: exibir também `measurements` (frequência, PR, QRS, QT) em formato tabular

```html
<!-- resultado de imagem no result-panel -->
<div class="image-result">
  <div class="image-viewer">
    <img [src]="showAnnotated ? result.metadata.annotated_image_url : result.metadata.original_image_url" />
    <button (click)="showAnnotated = !showAnnotated">
      {{ showAnnotated ? 'Ver original' : 'Ver anotado' }}
    </button>
  </div>
  <p class="disclaimer">⚠ Marcações aproximadas — validação profissional obrigatória</p>
  <ul class="findings-list">
    @for (f of result.metadata.findings; track f.id) {
      <li [class]="'severity-' + f.severity">
        <strong>[{{ f.id }}]</strong> {{ f.label }} — {{ f.description }}
      </li>
    }
  </ul>
</div>
```

---

## Critérios de Sucesso — Fase 1

- Upload de DICOM funciona end-to-end em < 90s
- Upload de JPG/PNG de ECG ou RX funciona end-to-end em < 60s
- Interpretação correta em > 85% dos casos de RX tórax normais (validação interna)
- Alertas críticos (pneumotórax, STEMI em ECG) detectados com recall > 90%
- Imagem anotada gerada e exibida para todo resultado `imaging_*`
- Achados com `box` sempre têm marcação numerada na imagem anotada
- Toggle original/anotado funciona em < 200ms (troca de src local, sem request)
- Disclaimer de "suporte à decisão" sempre presente — nunca diagnóstico conclusivo
- Imagens de baixa qualidade detectadas e reportadas (não falham silenciosamente)

---

## Considerações Regulatórias

- **CFM Resolução 2.314/2022:** sistemas de IA em diagnóstico por imagem devem ter médico responsável pela validação final. O disclaimer é obrigatório e deve ser inequívoco.
- **ANVISA RDC 657/2022:** softwares de auxílio diagnóstico por imagem são dispositivos médicos de software (SaMD) — regularização progressiva conforme escala.
- **LGPD:** imagens médicas são dados sensíveis de saúde. Não armazenar imagens processadas além do necessário. Log de acesso a imagens obrigatório.

---

## Plano de Implementação

Ver: `docs/superpowers/plans/2026-04-15-dicom-image-agent.md` (a ser criado após aprovação desta spec)

### Estimativa por fase:
- **Fase 1** (RX + ECG + US + anotação visual de achados): 3–4 semanas
- **Fase 2** (CT séries + Patologia): 2 semanas adicionais
- **Fase 3** (PACS integration via DICOM network): roadmap futuro
