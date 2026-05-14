# Aesthetic V2 — Fase 1: Captura Guiada + Landmarks + Métricas Geométricas

**Spec original:** `genomaflow_estetica_v_2_spec_md.md` (V2 completa — 4 fases).
**Escopo deste documento:** somente Fase 1 do roadmap V2.
**Pré-requisito:** plataforma F1-F6 entregue 2026-05-11 (`project_aesthetic_f6_integrations.md`).

---

## 1. Objetivo

Padronizar a captura de fotos da análise estética (5 poses faciais ou 4 corporais), validar qualidade em tempo real no navegador via MediaPipe Web e extrair landmarks que alimentam novas métricas geométricas (simetria, proporções, ângulos) — complementando, sem substituir, as métricas qualitativas atuais do Anthropic Vision.

Resultado para o usuário final: análise mais reprodutível, comparações antes/depois mais convincentes, base preparada para Pseudo-3D na Fase 3.

---

## 2. Princípio do produto

- Não promete diagnóstico clínico.
- "Apoio ao esteticista" — disclaimer existente preservado.
- Captura guiada é fricção a mais para o esteticista, mas a fricção é o produto: padroniza para tornar a comparação evolutiva válida.
- Fallback "pular validação" sempre disponível — UX nunca trava o usuário.

---

## 3. Decisões arquiteturais (travadas via brainstorming 2026-05-12)

| # | Decisão | Justificativa |
|---|---|---|
| D1 | Escopo Fase 1 = captura guiada + landmarks + métricas geométricas | Pseudo-3D adiado pra Fase 3 (release separado) |
| D2 | MediaPipe Web (browser/WASM) — sem container Python | Stack homogênea Node+Browser; UX live com overlay; zero custo CPU servidor |
| D3 | Anthropic Vision permanece complementar | Landmarks = geometria; Vision = textura/pigmentação |
| D4 | Evoluir schema F1-F6 (aditivo), não criar paralelo | Zero regressão; analyses legacy preservadas |
| D5 | Validação client-first com 7 heurísticas | Zero round-trip durante captura |
| D6 | Cliente envia foto + landmarks JSON; worker valida shape | Zero re-processamento; defesa via schema validation |
| D7 | 1 sessão = 1 análise multi-pose (5 facial ou 4 corporal) | Reuso máximo de aesthetic_analyses |
| D8 | Métricas geométricas no MESMO JSONB existente com flag `source: 'mediapipe'` | Zero nova RLS surface; frontend renderiza junto |
| D9 | Mobile (Capacitor) consome a mesma lib MediaPipe Web | Paridade Android/iOS mandatória |
| **D10** | **Dois tiers coexistem: `standard` (F1-F6, 5 cr) e `advanced` (V2, 10 cr)** | **Captura de valor — Premium 2x mantém F1-F6 vivo; basic vira commodity de volume** |
| **D11** | **Naming UI: "Análise Avançada — Captura Guiada" com badge "PRECISÃO"** | **Evita "Premium" saturado em SaaS BR; reserva "Premium" pro tier Pseudo-3D futuro (Fase 3)** |
| **D12** | **Endpoint /compare exige baseline e current do MESMO tier** | **Métricas geométricas só existem em advanced; cross-tier compare quebraria delta semântica** |

---

## 4. Arquitetura

### 4.1 Fluxo end-to-end

```
[Esteticista entra na aba "Análise Estética IA"]
  ↓
[Seleção de Tier — 2 cards lado-a-lado]
  ├─ [STANDARD] "Análise Rápida 2D" — 5 cr
  │    └→ Fluxo F1-F6 atual inalterado (1-3 fotos avulsas → POST /aesthetic/analyses tier=standard)
  └─ [ADVANCED] "Análise Avançada — Captura Guiada" ✨ PRECISÃO — 10 cr
       └→ Fluxo V2 NOVO ↓

[Tier ADVANCED — CaptureGuideComponent]
  ↓ Lazy-load MediaPipe FaceMesh/Pose (WASM ~10MB)
  ↓ Cycle por pose: frontal → perfil_E → perfil_D → 45_E → 45_D
  ↓ Live preview: webcam + overlay target + indicador OK/ajuste
  ↓ Validação local (7 heurísticas) — captura libera quando todas OK
  ↓ Para cada foto aprovada: upload S3 (presigned) + POST /aesthetic/photos com pose + landmarks
  ↓
[Backend POST /aesthetic/photos]
  ↓ Valida shape landmarks (468 pontos faciais ou 33 corporais, range 0-1)
  ↓ Persist aesthetic_photos com pose + landmarks JSONB
  ↓
[Esteticista confirma sessão → POST /aesthetic/sessions]
  ↓ Cria aesthetic_sessions linkando subject + N photos
  ↓ Cria aesthetic_analyses com session_id + photo_ids
  ↓ Enqueue BullMQ (mesma fila atual)
  ↓
[Worker]
  ↓ analyzeFacial/analyzeBody (Sonnet Vision — inalterado)
  ↓ Se tier === 'advanced':
  ↓   NOVO: aesthetic-landmarks-metrics agente lê photos.landmarks
  ↓          calcula simetria, proporções, ângulos
  ↓          merge no metrics JSONB com source:'mediapipe'
  ↓ Se tier === 'standard': pula direto pro recommender (fluxo F1-F6)
  ↓ recommendProtocol (inalterado)
  ↓ Persist analysis_result + WS notifyTenant aesthetic:event:*
  ↓
[Frontend analysis-result]
  ↓ Renderiza scores Vision + scores MediaPipe lado-a-lado
  ↓ photo-overlay renderiza landmarks como SVG layer
  ↓ Comparação evolutiva: baseline vs current com landmarks animados
```

### 4.2 Componentes novos

#### Backend
- `apps/api/src/routes/aesthetic-sessions.js` — POST/GET sessions
- `apps/api/src/routes/aesthetic-photos.js` (estender) — aceitar `pose` + `landmarks` no payload
- `apps/api/src/services/aesthetic-landmarks-validate.js` — schema validation (count, range, shape)

#### Worker
- `apps/worker/src/agents/aesthetic-landmarks-metrics.js` — calcula métricas geométricas
- `apps/worker/src/processors/aesthetic-analysis.js` (estender) — orquestra Vision + Landmarks merge

#### Frontend
- `apps/web/.../components/capture-guide-facial.component.ts` — wizard 5 poses
- `apps/web/.../components/capture-guide-body.component.ts` — wizard 4 poses
- `apps/web/.../services/mediapipe-loader.service.ts` — lazy-load WASM, singleton
- `apps/web/.../services/capture-validator.service.ts` — 7 heurísticas client-side
- `apps/web/.../components/photo-overlay.component.ts` (estender) — renderiza landmarks layer
- `apps/web/.../components/analysis-result.component.ts` (estender) — comparação visual

---

## 5. Modelo de dados

### 5.1 Migration 099 — aesthetic_sessions
```sql
CREATE TABLE aesthetic_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_type VARCHAR(50) NOT NULL,
  notes TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE aesthetic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY aesthetic_sessions_tenant ON aesthetic_sessions
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL
         OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX idx_aesthetic_sessions_subject ON aesthetic_sessions (tenant_id, subject_id, session_date DESC)
  WHERE deleted_at IS NULL;
CREATE TRIGGER aesthetic_sessions_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_sessions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

### 5.2 Migration 100 — aesthetic_photos pose + landmarks
```sql
ALTER TABLE aesthetic_photos
  ADD COLUMN IF NOT EXISTS pose VARCHAR(40),
  ADD COLUMN IF NOT EXISTS landmarks JSONB;

CREATE INDEX IF NOT EXISTS idx_aesthetic_photos_pose
  ON aesthetic_photos (tenant_id, subject_id, pose)
  WHERE pose IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN aesthetic_photos.pose IS
  'Pose declarada na captura V2. NULL para fotos legacy F1-F6.';
COMMENT ON COLUMN aesthetic_photos.landmarks IS
  'Landmarks faciais/corporais detectados no cliente via MediaPipe. NULL para legacy.';
```

Valores válidos de `pose` (validados em código, não enum no DB):
- Facial: `frontal`, `profile_left`, `profile_right`, `45_left`, `45_right`
- Corporal: `body_front`, `body_back`, `body_lateral_left`, `body_lateral_right`

### 5.3 Migration 101 — aesthetic_analyses link + tier
```sql
ALTER TABLE aesthetic_analyses
  ADD COLUMN IF NOT EXISTS session_id UUID NULL REFERENCES aesthetic_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'standard';

ALTER TABLE aesthetic_analyses
  ADD CONSTRAINT aesthetic_analyses_tier_check
  CHECK (tier IN ('standard', 'advanced'));

CREATE INDEX IF NOT EXISTS idx_aesthetic_analyses_session
  ON aesthetic_analyses (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aesthetic_analyses_tier
  ON aesthetic_analyses (tenant_id, tier, created_at DESC)
  WHERE deleted_at IS NULL;
```

### 5.3.1 Migration 102 — credit_ledger kinds para tier advanced
```sql
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_kind_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_kind_check
  CHECK (kind IN (
    -- existentes preservados (migration 098)
    'topup', 'adjustment', 'aesthetic_refund',
    'aesthetic_facial_analysis', 'aesthetic_eyelids_analysis', 'aesthetic_neck_analysis',
    'aesthetic_breast_analysis', 'aesthetic_arms_analysis', 'aesthetic_abdomen_analysis',
    'aesthetic_legs_analysis', 'aesthetic_glutes_analysis', 'aesthetic_full_body_analysis',
    'aesthetic_other_analysis',
    -- NOVOS para tier advanced (V2 Fase 1)
    'aesthetic_facial_analysis_advanced',
    'aesthetic_eyelids_analysis_advanced',
    'aesthetic_neck_analysis_advanced',
    'aesthetic_breast_analysis_advanced',
    'aesthetic_arms_analysis_advanced',
    'aesthetic_abdomen_analysis_advanced',
    'aesthetic_legs_analysis_advanced',
    'aesthetic_glutes_analysis_advanced',
    'aesthetic_full_body_analysis_advanced',
    'aesthetic_other_analysis_advanced'
  ));
```

### 5.4 Shape JSONB `aesthetic_photos.landmarks`

```typescript
type FaceLandmarks = {
  type: 'face';
  provider: 'mediapipe';
  provider_version: string;  // ex: '@mediapipe/tasks-vision@0.10.16'
  model: 'face_landmarker_v1';
  points: Array<{ x: number; y: number; z: number }>;  // 468 pts, range 0-1
  blendshapes?: Record<string, number>;  // opcional, futuro
  detected_at: string;  // ISO timestamp client-side
};

type BodyLandmarks = {
  type: 'body';
  provider: 'mediapipe';
  provider_version: string;
  model: 'pose_landmarker_v1';
  points: Array<{ x: number; y: number; z: number; visibility?: number }>;  // 33 pts
  detected_at: string;
};
```

**Validação server-side em `aesthetic-landmarks-validate.js`:**
- `type` ∈ {`face`, `body`}; deve casar com `pose` correspondente
- `provider` === `'mediapipe'` (whitelist)
- `points.length` === 468 (face) ou 33 (body)
- Todo ponto: `x, y, z ∈ [-1, 2]` (tolerância pra extrapolação leve fora do frame)
- Falha = 400 `INVALID_LANDMARKS` (não 500 — input do cliente)

### 5.5 Métricas geométricas (gravadas em `aesthetic_analyses.metrics`)

Métricas novas mergeadas no JSONB existente:

| Nome | Cálculo | Pose usada |
|---|---|---|
| `symmetry_horizontal` | distância média de pontos espelhados (esq vs dir) na linha mediana | frontal |
| `proportion_thirds` | proporção 1/3 testa, 1/3 nariz, 1/3 queixo (regra ouro) | frontal |
| `mandibular_angle_left` | ângulo entre tragus, gonion, mento (lado E) | 45_left ou profile_left |
| `mandibular_angle_right` | espelhado | 45_right ou profile_right |
| `head_tilt_roll` | inclinação Z entre olhos | frontal |
| `interocular_distance` | distância normalizada entre íris | frontal |
| `posture_shoulder_asymmetry` | diferença Y ombro esq vs ombro dir | body_front |
| `posture_hip_asymmetry` | idem cintura/quadril | body_front |
| `waist_hip_ratio_visual` | razão visual cintura/quadril (estimativa 2D) | body_front |
| `posture_alignment_lateral` | ângulo coluna vs vertical | body_lateral_* |

Shape mergeado:
```json
{
  "rugas": { "score": 70, "confidence": "high", "regions": [...], "source": "anthropic_vision" },
  "symmetry_horizontal": { "score": 88, "confidence": "high", "value_raw": 0.012, "source": "mediapipe", "pose_used": "frontal" }
}
```

`source` opcional aditivo — métricas Vision não precisam migration backfill, frontend trata como `'anthropic_vision'` quando ausente.

---

## 6. Captura guiada — UX detalhada

### 6.1 Wizard facial (5 passos)

Cada passo:
1. **Ilustração da pose esperada** (silueta SVG)
2. **Preview live da webcam** com overlay:
   - Moldura target alinhada com a pose
   - Indicador de cada heurística (verde/amarelo/vermelho)
3. **Checklist live:**
   - [ ] Rosto detectado
   - [ ] Pose correta (frontal/perfil/45°)
   - [ ] Centralizado
   - [ ] Olhos abertos
   - [ ] Boca fechada
   - [ ] Foco OK
   - [ ] Iluminação OK
4. **Botão "Capturar"** habilitado apenas com 7/7 OK; "Pular validação" oculto sob menu secundário com warn

### 6.2 Heurísticas client-side

| Heurística | Implementação |
|---|---|
| Face detected | MediaPipe FaceDetection — count === 1 |
| Pose correta | Face Mesh yaw angle — frontal: \|yaw\| < 10°; perfil: \|yaw\| > 60°; 45°: 30° < \|yaw\| < 50° |
| Centralização | bbox center - frame center, threshold 15% |
| Olhos abertos | EAR (eye aspect ratio) > 0.2 |
| Boca fechada | MAR (mouth aspect ratio) < 0.5 |
| Foco | Laplacian variance no canvas crop do rosto > 100 |
| Iluminação | Histogram mean ∈ [70, 180]; saturação <250 e >5 |

### 6.3 Wizard corporal (4 passos)

Análogo, mas com:
- MediaPipe Pose (33 landmarks)
- Heurísticas: full body in frame (head + ankles visible), postura neutra (yaw torso < 5°), pés alinhados, braços relaxados

---

## 7. APIs

### 7.1 POST /aesthetic/sessions
```http
POST /api/aesthetic/sessions
Authorization: Bearer <jwt>

{
  "subject_id": "uuid",
  "session_type": "facial_analysis",
  "notes": "Primeira avaliação"
}

201 Created
{ "id": "uuid", "session_date": "..." }
```

### 7.2 GET /aesthetic/sessions
```http
GET /api/aesthetic/sessions?subject_id=uuid&limit=20

200 OK
{ "items": [...] }
```

### 7.3 POST /aesthetic/photos (estender)

Adicionar campos opcionais ao payload existente:
```json
{
  "subject_id": "uuid",
  "photo_type": "facial_front",   // existente
  "is_sensitive": false,            // existente
  "pose": "frontal",                // NOVO
  "landmarks": { ... }              // NOVO
}
```

Backward compat: payload sem `pose`/`landmarks` continua aceito (fluxo F1-F6).

### 7.4 POST /aesthetic/analyses (estender)
```json
{
  "analysis_type": "facial",
  "subject_id": "uuid",
  "photo_ids": ["uuid1", "uuid2", "uuid3", "uuid4", "uuid5"],
  "session_id": "uuid",   // NOVO — opcional (obrigatório se tier='advanced')
  "tier": "advanced"      // NOVO — 'standard' (default) | 'advanced'
}
```

**Regras de validação por tier:**

| Validação | `standard` | `advanced` |
|---|---|---|
| `photo_ids` length | 1–3 | 5 (facial) ou 4 (corporal) — exato |
| `session_id` | opcional | **obrigatório** |
| `aesthetic_photos.pose` | NULL ok | **NOT NULL** em todas as fotos |
| `aesthetic_photos.landmarks` | NULL ok | **NOT NULL** em todas as fotos |
| Consent reforçado p/ regiões sensíveis | aplicável | aplicável |
| Custo (créditos) | 5 (env `AESTHETIC_FACIAL_COST`) | 10 (env `AESTHETIC_FACIAL_COST_ADVANCED`) |
| credit_ledger.kind | `aesthetic_{type}_analysis` | `aesthetic_{type}_analysis_advanced` |

Backward compat: payload sem `tier` = `standard` (fluxo F1-F6 idêntico).

### 7.5 POST /aesthetic/analyses/:id/compare (estender)

Validação adicional:
- baseline.tier deve === current.tier; senão 400 `TIER_MISMATCH` com mensagem "Compare exige análises do mesmo tier"
- Frontend filtra dropdown de baseline para mostrar só análises do mesmo tier
- Mensagem UX clara: "Você só pode comparar análises Avançadas com Avançadas (têm métricas geométricas exclusivas)"

---

## 8. Frontend — pacotes e bundle

### 8.1 Dependências novas

```json
{
  "@mediapipe/tasks-vision": "^0.10.16"
}
```

Lazy-loaded via `import('@mediapipe/tasks-vision')` dentro de `MediaPipeLoaderService`. Não vai no main bundle.

### 8.2 Lazy-load path

Rota `/aesthetic/capture` com `loadChildren` → módulo `AestheticCaptureModule` standalone. MediaPipe só importado dentro desse módulo.

### 8.3 Capacitor

- Câmera nativa: `@capacitor/camera` (já instalado para uploads atuais)
- WebAssembly funciona em Capacitor 6 (validado no spec; smoke test em V2-C step final)
- iOS: precisa permissão de câmera no `Info.plist` (provavelmente já existe)
- Android: `<uses-permission android:name="android.permission.CAMERA"/>` (já existe)

---

## 9. Worker — agente de landmarks-metrics

`apps/worker/src/agents/aesthetic-landmarks-metrics.js`

Interface:
```javascript
async function computeLandmarkMetrics({ photos, analysisType }) {
  // photos: array de { id, pose, landmarks }
  // Returns: { metrics: Record<string, MetricData> }
}
```

Métricas calculadas conforme tabela §5.5. Cada métrica:
- `score`: 0-100 (transformação documentada da medida bruta — ex: simetria perfeita = 100, desvio > 5% = 0)
- `value_raw`: medida bruta (rad, px normalized, ratio)
- `confidence`: `'high'` se pose disponível, `'low'` se pose ausente
- `pose_used`: qual pose foi consumida
- `source`: `'mediapipe'`

Integração em `apps/worker/src/processors/aesthetic-analysis.js`:
```javascript
// Após analyzeFacial/analyzeBody
const visionMetrics = visionResult.metrics;
const landmarkMetrics = await computeLandmarkMetrics({ photos, analysisType });
const mergedMetrics = { ...visionMetrics, ...landmarkMetrics };
// continua pra recommender
```

Falha do agente landmark = **não** falha a análise (analise Vision já é o produto). Loga warning + omit landmark metrics. Sem refund.

---

## 10. Multi-módulo + paridade

| Item | Regra |
|---|---|
| `requireEsteticaModule` | Todas as rotas novas |
| `module === 'estetica'` no Angular | Toda visibilidade de tab/menu |
| Human/Vet | Zero impacto — migrations NULLable, rotas gated |
| Mobile sync | Mandatório após V2-C, V2-D, V2-F |
| iOS build | Via CI ao criar tag `v*.*.*` |
| Capacitor MediaPipe smoke test | Sub-task obrigatória em V2-C step final (validação em Android low-end) |

---

## 11. LGPD + Consent

Landmarks faciais são **biometria** (LGPD Art. 11). Reforçar consent:

- Adicionar campo `aesthetic_consent.notes` automaticamente com texto: "Consentimento estendido para extração de landmarks biométricos via MediaPipe. Dados armazenados em JSONB. Purga após inatividade >1 ano (job F5.3)."
- Audit trigger em `aesthetic_sessions` registra `actor_user_id` + `channel`
- Job F5.3 (`aesthetic-purge-sensitive`) estendido para também limpar `landmarks` JSONB de fotos purgadas (NULL out)

---

## 12. Testes

### 12.1 Backend
- `apps/api/tests/routes/aesthetic-sessions.test.js` — CRUD, auth gate, RLS, multi-module gate
- `apps/api/tests/services/aesthetic-landmarks-validate.test.js` — shape validation (count, range, type)
- `apps/api/tests/integration/aesthetic-v2.integration.test.js` — fluxo end-to-end com Postgres real (Camada 2)

### 12.2 Worker
- `apps/worker/tests/agents/aesthetic-landmarks-metrics.test.js` — cálculo de cada métrica com fixtures de landmarks reais (frontal+perfil), happy path + missing pose + invalid points

### 12.3 Frontend
- `apps/web/.../components/capture-guide-facial.component.spec.ts` — wizard state machine, validação heurística mock
- `apps/web/.../services/capture-validator.service.spec.ts` — cada heurística isolada (face count, EAR, MAR, Laplacian, histogram)
- `apps/web/.../services/mediapipe-loader.service.spec.ts` — lazy-load single-flight (não duplica fetch)
- `apps/web/.../components/photo-overlay.component.spec.ts` (estender) — renderiza landmarks layer
- `apps/web/.../components/analysis-result.component.spec.ts` (estender) — comparação visual

### 12.4 Cobertura mínima da Fase 1: +60 testes (~20 API, ~10 worker, ~30 web).

---

## 13. Roadmap de sub-fases (Fase 1 completa)

| Sub-fase | Conteúdo | LOC estimado |
|---|---|---|
| **V2-A** | Migrations 099/100/101/102 + RLS + audit + repos backend + tier column + credit_ledger kinds | ~700 |
| **V2-B** | Routes sessions + photos extend (pose+landmarks) + analyses extend (tier+session_id) + compare tier-gate + validate service + cost lookup tier-aware | ~900 |
| **V2-C** | Frontend tier selector (2 cards) + captura guiada facial: 5 poses, MediaPipe FaceMesh, 7 heurísticas, lazy-load, Capacitor smoke test | ~1700 |
| **V2-D** | Frontend captura guiada corporal: 4 poses, MediaPipe Pose, heurísticas adaptadas | ~1000 |
| **V2-E** | Worker landmarks-metrics agente + integração no processor (só roda se tier='advanced') + merge no JSONB | ~700 |
| **V2-F** | Frontend resultado: landmarks overlay + comparação visual antes/depois animada + tier-gate em compare UI + PDF seção métricas geométricas | ~700 |

Cada sub-fase = 1 PR independente, ff-only, testes verdes, mobile sync, aprovação.

---

## 14. Riscos + mitigações

| Risco | Mitigação |
|---|---|
| MediaPipe bundle ~10MB infla FCP | Lazy-load por rota; code-splitting Angular natural |
| Pacientes não conseguem manter pose | Fallback "pular validação" com warn no resultado |
| Cliente envia landmarks falsos | Worker valida shape rigorosamente (count, range, type) |
| Re-build sem CACHEBUST | Já protegido nos Dockerfiles existentes |
| WS aesthetic:event:* não chega | Já assinado em pubsub.js (fix 2026-05-12) |
| Capacitor Android low-end trava com MediaPipe | Smoke test em V2-C step final; fallback "upload sem validação" se trava |
| Audit trigger esquecido em aesthetic_sessions | Test em migration suite que afirma trigger existe |
| LGPD: landmarks são biometria | Consent reforçado automático + purge job F5.3 estendido |
| Métricas Vision e MediaPipe conflitarem nome | Prefixo `mp_` opcional ou doc clara em §5.5 (escolhi nomes únicos sem colisão) |
| Frontend não distingue source | UI mostra ícone "🎯 Geometria" vs "🧪 IA Visual" por métrica |

---

## 15. Critérios de aceite

- [ ] **Tier selector UI** com 2 cards distintos, badge "✨ PRECISÃO" no advanced, custos visíveis
- [ ] Wizard captura facial funcional em desktop Chrome + Android Capacitor (somente tier advanced)
- [ ] 5 poses faciais validadas client-side com overlay live
- [ ] Foto + landmarks JSON gravados em S3 + Postgres (tier advanced)
- [ ] Session criada e vinculada à análise quando tier=advanced
- [ ] Worker calcula 10 métricas geométricas (§5.5) **APENAS** quando tier=advanced
- [ ] Frontend renderiza landmarks como SVG layer no resultado (somente advanced)
- [ ] Comparação evolutiva mostra delta de métricas geométricas (advanced↔advanced)
- [ ] Compare cross-tier retorna 400 TIER_MISMATCH
- [ ] credit_ledger.kind grava `*_advanced` quando tier=advanced
- [ ] Cost lookup retorna 10 cr para advanced, 5 cr para standard
- [ ] Refund: Vision falha → refund; landmarks-metrics falha → sem refund
- [ ] Fluxo standard (1-3 fotos avulsas) **continua idêntico** ao F1-F6 (regressão zero)
- [ ] Fallback "pular validação" disponível no tier advanced
- [ ] Mobile (Android) testado em low-end com MediaPipe
- [ ] Multi-módulo: human/vet inalterados (regressão zero)
- [ ] +60 testes verdes; pipeline de deploy verde
- [ ] LGPD: consent reforçado + audit trigger + purge estendido

---

## 16. Pricing & Tier strategy

### 16.1 Modelo de custos (env vars novas)

| Env var | Default | Aplicado quando |
|---|---|---|
| `AESTHETIC_FACIAL_COST` | 5 | tier=standard, analysis_type=facial |
| `AESTHETIC_FACIAL_COST_ADVANCED` | 10 | tier=advanced, analysis_type=facial |
| `AESTHETIC_BODY_COST` | 5 | tier=standard, analysis_type ∈ body* |
| `AESTHETIC_BODY_COST_ADVANCED` | 10 | tier=advanced, analysis_type ∈ body* |

Implementação em `apps/api/src/routes/aesthetic-analyses.js`:
```javascript
const COST_TABLE = {
  facial: {
    standard: Number(process.env.AESTHETIC_FACIAL_COST || 5),
    advanced: Number(process.env.AESTHETIC_FACIAL_COST_ADVANCED || 10),
  },
  body_measurements: {
    standard: Number(process.env.AESTHETIC_BODY_COST || 5),
    advanced: Number(process.env.AESTHETIC_BODY_COST_ADVANCED || 10),
  },
};
function costFor(analysisType, tier = 'standard') {
  return COST_TABLE[analysisType]?.[tier] ?? COST_TABLE[analysisType]?.standard ?? 5;
}
```

### 16.2 UI tier selector

Quando esteticista entra na aba "Análise Estética IA":

```
┌────────────────────────────────┬────────────────────────────────┐
│  ANÁLISE RÁPIDA 2D             │  ANÁLISE AVANÇADA              │
│                                │  ✨ CAPTURA GUIADA — PRECISÃO  │
│  • 1–3 fotos avulsas           │                                │
│  • IA Visual (40+ métricas)    │  • 5 fotos faciais padronizadas│
│  • Recomendador + PDF          │  • Landmarks + métricas geom.  │
│                                │  • Comparação evolutiva válida │
│                                │  • Base para Pseudo-3D futuro  │
│                                │                                │
│  💎 5 créditos                 │  💎 10 créditos                │
│  [ Começar análise rápida ]    │  [ Começar análise avançada ]  │
└────────────────────────────────┴────────────────────────────────┘
```

### 16.3 Refund policy por tier

| Cenário | tier=standard | tier=advanced |
|---|---|---|
| Vision falha (BAD_LLM_OUTPUT, NO_FACE_DETECTED, etc.) | Refund total | Refund total |
| Vision OK, landmarks-metrics agente falha | N/A (não roda) | **Sem refund** — basic produto entregue (Vision + recommender) |
| Vision OK, agente OK, recommender falha | Sem refund (já tem métricas) | Sem refund |
| Foto inválida no pre-flight | Não cobra (antes do debit) | Não cobra |

### 16.4 Master visibility

- Master pode override env vars de pricing via SSM Parameter Store
- Dashboard master `/master/aesthetic-stats` (futuro) — split por tier: count, revenue, conversion standard→advanced
- Toggle "habilitar tier advanced para tenant X" via flag em `tenants` (futuro — Fase 2)

---

## 17. Fora de escopo (Fase 1)

- Pseudo-3D facial (Fase 3)
- Depth estimation (Fase 3)
- Three.js viewer (Fase 3)
- Relatório paciente HTML/PDF novo (Fase 4 — PDF protocolo existente cobre)
- IA de recomendação estética avançada (Fase 4 — F3.5 catálogo + F4.4 lifestyle já cobrem)
- Timeline evolutiva visual com gráficos temporais (Fase 4)

Cada item acima vai pra spec próprio quando priorizado.
