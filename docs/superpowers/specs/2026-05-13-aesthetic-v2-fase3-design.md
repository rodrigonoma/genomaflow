# Aesthetic V2 — Fase 3: Pseudo-3D facial multi-view

**Spec V2 original:** `genomaflow_estetica_v_2_spec_md.md` §7 (Pseudo-3D Facial).
**Pré-requisitos:** V2 Fase 1 (captura guiada + landmarks) + Fase 2 (scores agregados) em produção.
**Escopo:** modelo 3D do rosto a partir das 5 fotos da análise advanced, viewer Three.js no browser com rotação 360°.

---

## 1. Objetivo

Transformar análise advanced (5 fotos faciais + landmarks MediaPipe) em **mesh 3D do rosto**, visualizável no browser via Three.js com rotação livre. Diferencial visual "WOW" que motiva o tier advanced.

Pipeline:
```
5 fotos (frontal/perfil_L/R/45_L/R) + landmarks já gravados
  ↓ Worker (sob demanda)
  ↓ Depth estimation por foto (Depth-Anything-V2-Small ONNX)
  ↓ Multi-view fusion: combina depth maps usando landmarks como correspondências
  ↓ Mesh GLTF/GLB com textura UV (foto frontal)
  ↓ Salva S3 (~500KB-1MB) + URL no aesthetic_analyses
  ↓ Notifica via WS aesthetic:event:* { kind: 'depth_ready' }
[Frontend]
  ↓ Botão "Visualizar 3D" aparece em análise advanced
  ↓ Carrega Three.js lazy (já era candidato)
  ↓ GLTFLoader → cena → OrbitControls (rotação/zoom/pan)
```

---

## 2. Princípio do produto

- **Sob demanda.** Esteticista clica "Gerar 3D", worker processa (~30-60s), notifica via WS.
- **Sem custo extra de créditos.** Incluído no advanced — não vira tier 3.
- **Falha graciosa.** 3D opcional; análise advanced sem 3D continua íntegra.
- **Somente facial advanced.** Body e standard fora de escopo.
- **Backward compat absoluta.** Análises antigas sem depth map → botão "Gerar 3D" disponível, on-click cria.

---

## 3. Decisões arquiteturais (travadas via brainstorming 2026-05-13)

| # | Decisão |
|---|---|
| F3-D1 | Depth estimation no worker Node.js via `onnxruntime-node` + Depth-Anything-V2-Small (~25MB ONNX) |
| F3-D2 | Multi-view fusion usando landmarks MediaPipe como correspondências cross-view (sem SolvePnP/ICP) |
| F3-D3 | Sob demanda — botão "Gerar 3D" no resultado dispara worker; não roda durante análise |
| F3-D4 | Tier advanced exclusivo — standard não tem |
| F3-D5 | Sem custo extra de créditos (incluído nos 10cr do advanced) |
| F3-D6 | Saída em GLTF binário (`.glb`); carrega no Three.js via GLTFLoader |
| F3-D7 | Foto frontal serve de textura UV; demais poses só contribuem com geometria |
| F3-D8 | Execução em 2 ondas: **F3.1 heightmap MVP** primeiro (1-2 semanas) → **F3.2 multi-view fusion** (2-3 semanas) |

---

## 4. Plano de execução em 2 ondas

### F3.1 — Heightmap MVP (primeira onda)

Destrava o pipeline completo de depth + Three.js + storage:
1. Worker: ONNX Runtime + Depth-Anything-V2-Small + endpoint POST /aesthetic/analyses/:id/depth
2. Pipeline simples: usa SÓ foto frontal, gera depth map, salva PNG no S3
3. Frontend: lazy Three.js + viewer que carrega foto + depth, render como plano deformado (heightmap)
4. WS notifica `depth_ready`
5. Push pra prod → valida UX e tempos reais

**Resultado:** "viewer 3D" que permite rotação ±30°, suficiente pra impressão "WOW" sem fusão multi-view.

### F3.2 — Multi-view fusion (segunda onda)

Sobre o pipeline F3.1, adiciona:
1. Worker: gera depth maps das 5 poses (não só frontal)
2. Worker: fusion via landmarks — usa MediaPipe 468 pts como correspondência cross-view
3. Reconstrução topológica usando triangulação MediaPipe canonical (oficial Google)
4. Refina Z dos landmarks combinando depth de múltiplas views (média ponderada por pose/visibility)
5. Exporta GLTF binário com mesh + UV
6. Frontend: troca heightmap por GLTF mesh real (Three.js GLTFLoader)
7. OrbitControls rotação 360°

Esse spec cobre AMBAS as ondas. Implementação começa em F3.1.

---

## 5. Tabela `aesthetic_depth_models` (NOVA)

Migration **103**:

```sql
CREATE TABLE IF NOT EXISTS aesthetic_depth_models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  analysis_id     UUID NOT NULL REFERENCES aesthetic_analyses(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'error')),
  model_type      VARCHAR(40) NOT NULL DEFAULT 'heightmap',
                  -- 'heightmap' (F3.1) | 'multiview_fusion' (F3.2)
  s3_key_glb      TEXT,           -- F3.2: GLTF binário (.glb)
  s3_key_depth    TEXT,           -- F3.1+: depth map PNG (foto frontal)
  s3_key_texture  TEXT,           -- F3.1+: textura mapeada (geralmente = foto frontal s3_key)
  provider        VARCHAR(40) NOT NULL DEFAULT 'depth-anything-v2-small',
  provider_version VARCHAR(40),
  metadata        JSONB,           -- ex: { vertex_count, processing_ms, photo_used }
  error_code      TEXT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

ALTER TABLE aesthetic_depth_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_depth_models FORCE ROW LEVEL SECURITY;

CREATE POLICY aesthetic_depth_tenant ON aesthetic_depth_models
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE INDEX idx_aesthetic_depth_analysis ON aesthetic_depth_models (analysis_id);

CREATE TRIGGER aesthetic_depth_models_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_depth_models
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

---

## 6. Backend APIs

### 6.1 POST /aesthetic/analyses/:id/depth (gerar)

```http
POST /api/aesthetic/analyses/{analysis_id}/depth
Authorization: Bearer <jwt>

200 OK   { id: "depth-uuid", status: "pending" }       -- enqueued
200 OK   { id: "depth-uuid", status: "done", glb_url: "..." }  -- já existe
400      { error: "TIER_NOT_ADVANCED", message: "..." }
404      { error: "Análise não encontrada" }
402      { error: "INSUFFICIENT_CREDITS" }              -- não aplica (sem cobrança)
```

Idempotente: se já existe depth model com status done, retorna URL. Senão enfileira novo job e retorna pending.

### 6.2 GET /aesthetic/analyses/:id/depth

```http
GET /api/aesthetic/analyses/{analysis_id}/depth

200 OK { id, status, glb_url?, depth_url?, error_code?, completed_at? }
404
```

Frontend usa pra polling fallback (caso WS perdido).

### 6.3 Limites

- Rate limit: 10/h por tenant (compute pesado)
- Tier: advanced only — standard retorna 400 TIER_NOT_ADVANCED
- Foto deve ter `pose: 'frontal'` (F3.1); F3.2 valida que 5 poses presentes

---

## 7. Worker — pipeline de depth

### 7.1 Nova fila / job type

`apps/worker/src/queues/aesthetic-depth-queue.js` (espelho do aesthetic-analysis-queue):
```javascript
const Queue = require('bullmq').Queue;
const queue = new Queue('aesthetic-depth', { connection: redisConfig });
async function enqueue(data) { return queue.add('process', data); }
module.exports = { enqueue };
```

Worker:
```javascript
const { Worker } = require('bullmq');
new Worker('aesthetic-depth', async (job) => {
  return processDepthGeneration(job.data);
}, { connection: redisConfig });
```

### 7.2 ONNX model loading

`apps/worker/src/lib/depth-anything.js`:
```javascript
const ort = require('onnxruntime-node');
let session;
async function getSession() {
  if (session) return session;
  // Modelo baixado durante Docker build ou ao primeiro uso
  const modelPath = '/app/models/depth-anything-v2-small.onnx';
  session = await ort.InferenceSession.create(modelPath);
  return session;
}
async function inferDepth(rgbBuffer, width, height) {
  // Preprocess: resize → 518x518, normalize, NCHW float32
  // Run inference
  // Postprocess: resize back, normalize 0-1
  return { depthMap: Float32Array, width, height };
}
module.exports = { inferDepth };
```

### 7.3 Dockerfile worker — incluir modelo ONNX

```dockerfile
# Download model durante build
RUN curl -L -o /app/models/depth-anything-v2-small.onnx \
    https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx
```

Modelo ~25MB. Adiciona ~25MB ao image size.

### 7.4 F3.1 processor — heightmap pipeline

`apps/worker/src/processors/aesthetic-depth.js`:
```javascript
async function processDepthGeneration({ depth_id, tenant_id, analysis_id }) {
  // 1. UPDATE depth status = processing
  // 2. Fetch análise + frontal photo (s3_key, landmarks)
  // 3. Download frontal photo do S3
  // 4. inferDepth(photoBuffer) → depth map Float32Array
  // 5. Render depth map como PNG grayscale (sharp ou jimp)
  // 6. Upload PNG no S3: aesthetic-depth/{tenant_id}/{analysis_id}.png
  // 7. UPDATE depth status = done, s3_key_depth, completed_at
  // 8. Redis publish aesthetic:event:{tenant_id} { kind: 'depth_ready', depth_id, analysis_id, glb_url? }
}
```

### 7.5 F3.2 processor — multi-view fusion

Adicional ao F3.1:
- Fetch das 5 photos (frontal + 4 outras)
- inferDepth em cada uma
- Pra cada landmark MediaPipe (468), busca depth em cada pose disponível
- Calibra Z combinando depths (média ponderada pela "visibilidade" do landmark naquela pose)
- Usa triangulação canonical MediaPipe FaceMesh (lista de triangles oficial Google) → mesh
- UV map: foto frontal como textura, landmarks como pivots de UV
- Exporta GLTF binário com `@gltf-transform/core` ou `gltf-pipeline`
- Upload .glb no S3
- UPDATE s3_key_glb

---

## 8. Frontend — viewer Three.js

### 8.1 Dependências novas

```json
{
  "three": "^0.165.0"
}
```

Lazy-load via `import('three')` dentro do componente viewer. Não vai no main bundle.

### 8.2 Componente `DepthViewerComponent`

`apps/web/src/app/features/aesthetic/components/depth-viewer.component.ts`:
```typescript
// Inputs:
//   depthUrl: string   // PNG depth (F3.1) OU glbUrl pra F3.2
//   textureUrl: string // foto frontal pra textura
//   mode: 'heightmap' | 'gltf' (default 'heightmap')
//
// State:
//   loading, error
//   threeScene + camera + renderer
//
// Lifecycle ngAfterViewInit:
//   1. Lazy import('three') + import('three/examples/jsm/controls/OrbitControls')
//   2. F3.1: cria PlaneGeometry, aplica heightmap shader com depth como displacement
//      F3.2: GLTFLoader carrega .glb
//   3. Adiciona OrbitControls (rotação, zoom, pan)
//   4. requestAnimationFrame loop
//
// ngOnDestroy:
//   1. dispose geometry/material/textures
//   2. cancelAnimationFrame
//   3. remove renderer.domElement
```

### 8.3 Integração `analysis-result.component.ts`

Adiciona botão "Visualizar 3D" quando `analysis.tier === 'advanced'`:
```html
@if (isAdvanced()) {
  <button (click)="onGenerate3D()">
    @if (depthStatus() === 'done') { 🎭 Visualizar 3D }
    @else if (depthStatus() === 'pending' || depthStatus() === 'processing') { Gerando 3D... }
    @else { 🎭 Gerar 3D }
  </button>
}
@if (depthStatus() === 'done' && depthUrl()) {
  <app-depth-viewer
    [depthUrl]="depthUrl()!"
    [textureUrl]="frontalPhotoUrl()!"
    mode="heightmap" />
}
```

State: `depthStatus = signal<'idle' | 'pending' | 'processing' | 'done' | 'error'>('idle')`.

Ao clicar:
1. POST /aesthetic/analyses/:id/depth → recebe `{ status }`
2. Se `done` → carrega viewer direto
3. Se `pending/processing` → mostra spinner, aguarda WS `depth_ready`
4. WS handler atualiza signal → carrega viewer

### 8.4 WS event handling

`aesthetic-ws.service.ts` ganha novo `AestheticEvent.kind = 'depth_ready'`:
```typescript
type AestheticEvent =
  | { kind: 'analysis_done'; analysis_id; subject_id }
  | { kind: 'analysis_failed'; analysis_id; error_code }
  | { kind: 'depth_ready'; depth_id; analysis_id; glb_url?; depth_url? };
```

`analysis-result` escuta + atualiza state quando event do mesmo analysis_id chega.

---

## 9. Sub-fases F3.1

| Sub-fase | Conteúdo | LOC estimado |
|---|---|---|
| **F3.1-A** | Migration 103 `aesthetic_depth_models` + RLS + audit + service repo | ~250 |
| **F3.1-B** | Worker: queue + processor + ONNX lib + Dockerfile model download | ~400 |
| **F3.1-C** | API: POST/GET /aesthetic/analyses/:id/depth + tier=advanced gate + 402/400 codes | ~250 |
| **F3.1-D** | Frontend: DepthViewerComponent (heightmap Three.js + OrbitControls) + lazy three | ~400 |
| **F3.1-E** | Frontend: integração analysis-result botão "Gerar 3D" + WS event handling | ~200 |
| **F3.1-F** | IAM policy S3 prefix `aesthetic-depth/*` + monitoring CloudWatch alarm |  ~50 |

Total F3.1 ~1550 LOC, ~25 testes novos. **Tempo ~1.5-2 semanas.**

## Sub-fases F3.2 (após F3.1 em prod + feedback)

| Sub-fase | Conteúdo | LOC estimado |
|---|---|---|
| **F3.2-A** | Worker: pipeline multi-view fusion (5 depths + landmark correspondences) | ~600 |
| **F3.2-B** | Worker: triangulação canonical MediaPipe + GLTF export | ~400 |
| **F3.2-C** | Frontend: DepthViewer aceita `mode='gltf'` + GLTFLoader | ~150 |
| **F3.2-D** | Migration `model_type='multiview_fusion'` upgrade path + UI badge | ~100 |

Total F3.2 ~1250 LOC, ~15 testes novos. **Tempo ~2-3 semanas.**

---

## 10. Riscos

| Risco | Mitigação |
|---|---|
| ONNX inference lento em CPU Fargate (>60s) | Modelo Small (25MB) + pré-resize 518x518 fixo. Worker timeout 5min. Considerar c6i/c7i (Intel AVX512) |
| Image worker fica >2GB com modelo ONNX | Multi-stage Dockerfile + only essential deps. Modelo download lazy se imagem ficar grande |
| Three.js bundle ~600KB | Lazy load por rota, já candidato. Tree-shake (só GLTFLoader + OrbitControls) |
| Heightmap parece "papelão" em rotação >40° | Limit OrbitControls maxPolarAngle pra ±40° em F3.1; remove em F3.2 |
| Multi-view fusion produz mesh quebrada | F3.2 só sai com testes visuais; F3.1 já valida pipeline |
| LGPD: modelo 3D = biometria reforçada | Audit trigger em aesthetic_depth_models. Purge alinhada a aesthetic_photos (>1y se sensitive). Consent reforçado já cobre |
| Custo S3 cresce | Lifecycle: depth maps após análise inativa >1y. Já temos pipeline F5.3 |

---

## 11. Critérios de aceite F3.1

- [ ] Migration 103 aplicada em prod sem regressão
- [ ] Worker `aesthetic-depth` consome jobs, processa em <90s pra foto 1024x1024
- [ ] POST /aesthetic/analyses/:id/depth gera + WS depth_ready chega
- [ ] Tier=standard recebe 400 TIER_NOT_ADVANCED
- [ ] Rate limit 10/h funciona
- [ ] Frontend: botão "Gerar 3D" aparece só em advanced + heightmap renderiza
- [ ] OrbitControls rotaciona (clamped ±40°) + zoom funciona
- [ ] WS event atualiza state automaticamente
- [ ] Análises legacy F1-F6 e standard NÃO mostram botão
- [ ] +25 testes verdes, deploy verde

---

## 12. Fora de escopo (Fase 3)

- 3D body (corporal) — out
- Multi-view fusion antes do MVP heightmap (intencional)
- 3DMM (DECA/EMOCA/MICA) — Python + GPU, fora
- API externa Replicate/HF — não queremos lock-in
- Cobrança extra (Premium tier separado) — incluído no advanced
- Compartilhamento social do 3D — futuro

---

## 13. Backward compat

- Análises F1-F6 (legacy, sem tier ou tier=standard) → botão 3D oculto
- Análises advanced pré-F3 → botão "Gerar 3D" aparece, on-click cria depth model novo
- aesthetic_depth_models é tabela nova, sem migration de dados
- API novas rotas, não tocam endpoints existentes
- Frontend: componente novo, integração aditiva no analysis-result
