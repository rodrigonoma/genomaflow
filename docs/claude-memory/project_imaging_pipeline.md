---
name: Pipeline de Imagens Médicas — estado atual
description: Suporte a DICOM, JPG, PNG, MRI — classificação por Vision, agentes por modalidade, bounding boxes
type: project
originSessionId: 70201c53-e120-4e84-a6d1-e96d8946598d
---
Pipeline de imagem implementado e em produção (merged 2026-04-21, branch feat/imaging-analysis + fix/imaging-ws-report-bugs).

## Fluxo

1. Upload aceita: PDF, DICOM (.dcm), JPG, PNG
2. API detecta `file_type`: `pdf | dicom | image`
3. S3: `uploads/{tenant_id}/{timestamp}-{filename}`
4. Worker recebe job com `file_type`
5. `processImagingExam` em `apps/worker/src/processors/exam.js`:
   - DICOM → converte para PNG via jimp → `imageMimeType = 'image/png'`
   - image (JPG/PNG) → detecta MIME real por magic bytes via `detectImageMime(buffer)` → pode ser `image/jpeg` ou `image/png`
   - PDF → fluxo separado (não passa pelo imaging pipeline)
6. `classifyModality` (Vision API) classifica: `rx | ecg | ultrasound | mri | other`
7. Agente chamado conforme modalidade: `imaging_rx`, `imaging_ecg`, `imaging_ultrasound`, `imaging_mri`
8. Cada agente retorna: `interpretation`, `risk_scores`, `findings[]` com bounding boxes `[x1,y1,x2,y2]`, `alerts[]`, `disclaimer`

## Arquivo de detecção de MIME

`apps/worker/src/classifiers/imaging.js` → função `detectImageMime(buffer)`:
- `0xFF 0xD8 0xFF` → `image/jpeg`
- `0x89 0x50 0x4E 0x47` → `image/png`
- `52 49 46 46` → `image/webp`
- fallback → `image/png`

## Mapa DICOM → modalidade

`MR, PT → mri` | `CR, DX, MG, IO → rx` | `ECG, HD → ecg` | `US, OT → ultrasound`

## Agente MRI

`apps/worker/src/agents/imaging-mri.js` — neuroradiology + body MRI.
- risk_scores: `{ structural: LOW|MEDIUM|HIGH|CRITICAL }`
- findings com box como fração de dimensões da imagem (0.0–1.0, origem top-left)
- Retorna `imaging_mri` como agent_type em clinical_results

## result-panel

`apps/web/src/app/features/doctor/results/result-panel.component.ts`
- Suporte a `imaging_mri` com label "RESSONÂNCIA (IA)"
- Exibe bounding boxes sobre a imagem original (endpoint `GET /exams/:id/image`)
- Back button para perfil do paciente

## Erros conhecidos corrigidos

- MIME hardcoded `image/png` nos 4 agentes → Anthropic 400 para JPEG → corrigido passando `imageMimeType` do processador
- Vision classifier não tinha `mri` como opção válida → corrigido
- DICOM com Modality=MR mapeava para `rx` → corrigido para `mri`
- Regex `valid.includes(text)` falhava em "mri." → corrigido para `text.match(/\b(rx|ecg|ultrasound|mri)\b/)`
- Endpoint de retry era `/retry` (404) → corrigido para `/reprocess`
- `/reprocess` não passava `file_type` → exames de imagem reprocessavam como PDF → corrigido

**Why:** Serve para não repetir os mesmos erros de MIME e classificação ao adicionar novas modalidades.
**How to apply:** Ao adicionar nova modalidade: (1) adicionar à lista do Vision prompt, (2) adicionar ao DICOM map, (3) criar agente, (4) adicionar ao IMAGING_AGENT_MAP em exam.js, (5) garantir que o agente aceita `imageMimeType` no destructuring.
