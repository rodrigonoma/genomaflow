# GenomaFlow Aesthetic Platform — Design Spec

**Data:** 2026-05-11
**Autor:** sessão Claude + Rodrigo Noma
**Status:** Aprovado para implementação (aguarda plano de implementação)
**Cobertura:** F1 a F6 — plataforma estética completa

---

## 1. Visão geral

Construir plataforma completa de análise estética via IA dentro do GenomaFlow, expandindo o módulo `estetica` (F1 Foundation já entregue em 2026-05-06).

Cobertura: **análise facial + corporal por IA Vision**, com anotações visuais sobre as fotos, comparação evolutiva antes/depois, sugestão de protocolo de tratamento usando catálogo curado de procedimentos, orientações nutricionais/estilo de vida com disclaimer regulatório, e integração nativa com Timeline, Agenda e Prontuário existentes.

Substitui a percepção atual do marketing (`apps/landing` material de Go-to-market) de "análise facial inteligente com %" por algo entregável, defensável regulatoriamente, e construído sobre a fundação multi-tenant LGPD do projeto.

## 2. Premissas e constraints

### 2.1 Multi-módulo (não negociável)

- 3 módulos coexistem: `human`, `veterinary`, `estetica`. Nenhuma feature nova pode afetar funcionalidade existente nos outros 2 módulos.
- Todas as tabelas novas (`aesthetic_*`) são isoladas; nenhum ALTER de tabela compartilhada que possa quebrar queries existentes.
- Mudanças aditivas em `subjects` (campo `aesthetic_profile JSONB DEFAULT '{}'`) e `clinical_encounters` (campo `related_aesthetic_analysis_id UUID NULL`) preservam queries atuais (nullable + default vazio).
- Frontend: tab "Análise IA" no patient-detail renderizada com `@if (currentProfile?.module === 'estetica')`. Invisível pra human/vet.
- Endpoints `/aesthetic/*` protegidos por middleware `requireEsteticaModule` (403 pra outros módulos).

### 2.2 Defesa em profundidade multi-tenant

- Todas as tabelas novas usam padrão NULLIF + FORCE ROW LEVEL SECURITY (igual `audit_log` migration 055).
- `withTenant(pg, tid, fn, { userId, channel })` obrigatório em mutações.
- `AND tenant_id = $X` explícito em toda query SELECT/UPDATE/DELETE.
- ACL master: rotas master-only checam `role !== 'master'`, nunca `role !== 'admin'`.

### 2.3 LGPD — biometria sensível

- Foto facial e corporal são dados pessoais sensíveis (biométricos).
- Consentimento operacional do profissional confirmado 1× por paciente (modal + checkbox + nome digitado + IP + UA registrado em `aesthetic_consent`).
- Profissional declara que obteve consentimento offline do paciente.
- Fotos de regiões sensíveis (mama, glúteos, abdômen baixo) exigem consentimento reforçado adicional + auto-crop opcional.
- Criptografia at-rest via S3 (`AES-256` default + bucket `genomaflow-uploads-prod`).
- Retenção: 5 anos para regiões padrão (alinhado com prontuário CFM). 1 ano para regiões sensíveis (purga automática via job).
- Direito ao apagamento: endpoint `DELETE /aesthetic/photos/:id` (soft + purge job 30d depois).

### 2.4 Regulatório

- **Estética é diferente de medicina.** Esteticista (sem CRM) não pode prescrever procedimentos médicos. Sistema filtra recomendações por `professional_type` do user logado (já implementado em F1 Foundation — middleware `requireMedico`).
- **Estética é diferente de nutrição.** Nem esteticista nem médico estético substituem nutricionista (CRN). Orientações nutricionais geradas pela IA são gerais (estilo de vida + macros aproximados), com disclaimer obrigatório.
- **Sugestões da IA são suporte à decisão.** Disclaimer obrigatório em toda UI clínica (já é padrão do projeto, per CLAUDE.md).
- Marketing precisa refletir: "score interno GenomaFlow" e não "medição clínica validada". Materiais visuais a ajustar coletivamente.

### 2.5 Sem regressão, sem gambiarra (CLAUDE.md)

- Toda alteração validada com smoke test multi-módulo antes do merge.
- Sem `Write` em arquivo existente — `Edit` cirúrgico.
- Migrations aditivas, sem `DROP COLUMN` ou `DROP TABLE` sem plano explícito.
- LLM output sanitization defensiva (regex JSON, whitelist enums, clamp, slice).
- Erros explícitos com código (`BAD_LLM_OUTPUT`, `NO_FACE_DETECTED`, `INSUFFICIENT_CREDITS`, `CONSENT_MISSING`).
- Sem `console.log` em prod, sem `--no-verify`, sem skip de teste sem TODO.

### 2.6 Performance e custos

- Cada análise gera ~2 chamadas IA (Sonnet Vision + Opus). Custo ~$0.30-0.40/análise.
- Cobrança via `credit_ledger` (kind `aesthetic_facial_analysis` e `aesthetic_body_analysis`). Default 5 créditos por análise. Configurável via env var.
- Refund automático em falha técnica (NO_FACE_DETECTED, BAD_LLM_OUTPUT, timeout).
- BullMQ queue `aesthetic-analysis` separada, concurrency=2 (evita burst de custo).
- Indexação SQL: `(tenant_id, subject_id, analysis_type, created_at DESC)` para listagem rápida.
- Catálogo de tratamentos: ~50-100 entries — em memória pode ser cached em Redis com TTL 1h.

## 3. Arquitetura

### 3.1 Pipeline de análise (two-call)

```
[Esteticista] /aesthetic/analyses POST { region, photo_ids[], baseline_id? }
       ↓ (Backend valida: consent + créditos + photos own tenant + region válida)
       ↓ Debita créditos via credit_ledger
       ↓ INSERT aesthetic_analyses status='pending'
       ↓ Enqueue BullMQ job aesthetic-analysis
       ↓ Retorna 200 { analysis_id, status:'pending' }
       ↓
[Worker aesthetic-analysis queue]
       ↓ status='processing'
       ↓ Download fotos S3 → buffers
       ↓ Call #1: Sonnet Vision (MODELS.VISION)
       ↓   Input: fotos + idade + fitzpatrick + skin_concerns + aesthetic_profile + region
       ↓   Output: { region_data: { metric1: { score, regions[] }, ... },
       ↓             qualitative_text, regions_affected_count_low_confidence }
       ↓ Saneamento defensivo: clamp 0-100, slice strings, validate region types
       ↓ Call #2: Opus 4.7 (MODELS.CLINICAL_PREMIUM)
       ↓   Input: métricas + aesthetic_profile + catálogo de tratamentos disponíveis +
       ↓          professional_type (filtra invasivos)
       ↓   Output: { treatment_protocol[], lifestyle_recommendations, summary_for_patient,
       ↓             follow_up_protocol }
       ↓ Saneamento + match com catálogo (treatment_id se encontrar nome)
       ↓ UPDATE aesthetic_analyses SET status='done', metrics, observations, recommendations
       ↓ Redis publish 'aesthetic:event:{tenant_id}' kind='analysis_done'
       ↓
[Frontend WS] → fetch GET /aesthetic/analyses/:id → render
```

### 3.2 Modelos IA (PR10 — env-configurable)

- `MODEL_VISION` (default `claude-sonnet-4-6`) — Call #1: análise de fotos.
- `MODEL_CLINICAL_PREMIUM` (default `claude-opus-4-7`) — Call #2: recomendação de protocolo.

### 3.3 Cobrança via créditos

| Tipo de análise | Custo padrão | Env var override |
|---|---|---|
| Análise facial | 5 créditos | `AESTHETIC_FACIAL_COST=5` |
| Análise corporal | 5 créditos | `AESTHETIC_BODY_COST=5` |
| Análise de região sensível (mama) | 5 créditos + auto-crop | `AESTHETIC_SENSITIVE_COST=5` |

Pre-flight check antes de enquerar job:
```sql
SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_ledger WHERE tenant_id = $1;
```
Se `balance < cost`: 402 com `{ error: 'INSUFFICIENT_CREDITS', current: X, required: 5 }`.

Refund automático em falha técnica:
```sql
INSERT INTO credit_ledger (tenant_id, amount, kind, description, ref_id)
VALUES ($1, +5, 'aesthetic_refund', 'Refund: análise falhou (NO_FACE_DETECTED)', $2);
```

## 4. Schema do banco

### 4.1 `aesthetic_photos` — repositório genérico

```sql
CREATE TABLE aesthetic_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  photo_type   TEXT NOT NULL CHECK (photo_type IN
                 ('facial_front','facial_left','facial_right',
                  'eyelids_close','neck_front','neck_side',
                  'breast_front','breast_side',
                  'body_front','body_back','body_left','body_right',
                  'arms_front','arms_relaxed','arms_flexed',
                  'abdomen_front','abdomen_side',
                  'legs_front','legs_back','legs_side',
                  'glutes_back',
                  'full_body_front','full_body_back','full_body_side',
                  'other')),
  s3_key       TEXT NOT NULL,
  is_sensitive BOOLEAN NOT NULL DEFAULT false,
  taken_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes        TEXT,
  deleted_at   TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_aesthetic_photos_subject ON aesthetic_photos(tenant_id, subject_id, taken_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_aesthetic_photos_sensitive_retention ON aesthetic_photos(created_at)
  WHERE is_sensitive = true AND deleted_at IS NULL;

ALTER TABLE aesthetic_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY aesthetic_photos_tenant ON aesthetic_photos
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE TRIGGER aesthetic_photos_audit AFTER INSERT OR UPDATE OR DELETE ON aesthetic_photos
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

S3 path: `aesthetic-photos/{tenant_id}/{subject_id}/{photo_id}.jpg` (JPEG q=0.85).

### 4.2 `aesthetic_analyses` — análises de IA

```sql
CREATE TABLE aesthetic_analyses (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id               UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  analysis_type            TEXT NOT NULL CHECK (analysis_type IN
                             ('facial','eyelids','neck','breast','arms',
                              'abdomen','legs','glutes','full_body','other')),
  photo_ids                UUID[] NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN
                             ('pending','processing','done','error')),
  metrics                  JSONB,
  observations             JSONB,
  recommendations          JSONB,
  model_metrics            TEXT,
  model_recommendations    TEXT,
  tokens_input             INT,
  tokens_output            INT,
  error_code               TEXT,
  error_message            TEXT,
  baseline_analysis_id     UUID REFERENCES aesthetic_analyses(id) ON DELETE SET NULL,
  credits_charged          INT NOT NULL DEFAULT 5,
  credits_refunded         BOOLEAN NOT NULL DEFAULT false,
  deleted_at               TIMESTAMPTZ NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ NULL
);

CREATE INDEX idx_aesthetic_analyses_subject ON aesthetic_analyses(tenant_id, subject_id, analysis_type, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_aesthetic_analyses_pending ON aesthetic_analyses(status, created_at)
  WHERE status IN ('pending','processing');

ALTER TABLE aesthetic_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_analyses FORCE ROW LEVEL SECURITY;
CREATE POLICY aesthetic_analyses_tenant ON aesthetic_analyses
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE TRIGGER aesthetic_analyses_audit AFTER INSERT OR UPDATE OR DELETE ON aesthetic_analyses
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

Estrutura interna do `metrics` JSONB:

```json
{
  "rugas": {
    "score": 72,
    "confidence": "high",
    "regions": [
      { "type": "polyline", "points": [[0.42,0.31],[0.45,0.30]], "label": "ruga periorbital" },
      { "type": "bbox", "x": 0.55, "y": 0.42, "w": 0.08, "h": 0.02, "label": "ruga frontal" }
    ]
  },
  /* ... outras métricas da região ... */
}
```

`recommendations` JSONB:

```json
{
  "treatment_protocol": [
    {
      "treatment_id": "uuid-of-catalog-or-null",
      "treatment_name": "Criolipólise",
      "in_catalog": true,
      "target_metric": "culote_esquerdo",
      "indication_text": "Redução de gordura localizada (score 65/100)",
      "sessions_recommended": 3,
      "interval_days": 60,
      "estimated_total_cost_brl_range": [4500, 7500],
      "contraindications_flagged": [],
      "urgency": "medium",
      "expected_outcome": "Redução de ~25-30% no volume"
    }
  ],
  "lifestyle_recommendations": {
    "estimated_daily_calories_kcal": 1800,
    "macro_distribution_g": { "protein": 90, "carbs": 200, "fat": 60 },
    "hydration_ml_per_day": 2500,
    "meal_timing_suggestion": "...",
    "exercise_recommendation": { "aerobic": "...", "strength": "..." },
    "foods_to_emphasize": [...],
    "foods_to_minimize": [...],
    "supplementation_consideration": [...]
  },
  "summary_for_patient": "Plano sugerido...",
  "follow_up_protocol": {
    "next_analysis_recommended_in_days": 90,
    "checkpoint_metrics": [...]
  }
}
```

### 4.3 `aesthetic_consent` — confirmação operacional

```sql
CREATE TABLE aesthetic_consent (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id),
  ip           TEXT,
  user_agent   TEXT,
  notes        TEXT,
  reinforced_regions TEXT[],
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, subject_id)
);

ALTER TABLE aesthetic_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_consent FORCE ROW LEVEL SECURITY;
CREATE POLICY aesthetic_consent_tenant ON aesthetic_consent
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE TRIGGER aesthetic_consent_audit AFTER INSERT OR UPDATE OR DELETE ON aesthetic_consent
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

### 4.4 `aesthetic_treatments` — catálogo

```sql
CREATE TABLE aesthetic_treatments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  category               TEXT NOT NULL CHECK (category IN
                           ('corpo_modelagem','corpo_flacidez',
                            'facial_rejuvenescimento','facial_pigmentacao',
                            'facial_acne','facial_preenchimento','facial_toxina',
                            'cabelo','procedimento_cirurgico',
                            'wellness_drenagem','outro')),
  indications            TEXT[] NOT NULL,
  contraindications      TEXT[] NOT NULL,
  typical_sessions       INT,
  interval_days          INT,
  cost_estimate_brl_min  DECIMAL(10,2),
  cost_estimate_brl_max  DECIMAL(10,2),
  evidence_level         TEXT CHECK (evidence_level IN ('A','B','C','D')),
  description            TEXT,
  protocol_notes         TEXT,
  requires_medico        BOOLEAN NOT NULL DEFAULT false,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  usage_count_30d        INT NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_aesthetic_treatments_visibility ON aesthetic_treatments(tenant_id, category, is_active);
CREATE INDEX idx_aesthetic_treatments_indications ON aesthetic_treatments USING gin(indications);

ALTER TABLE aesthetic_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_treatments FORCE ROW LEVEL SECURITY;
CREATE POLICY aesthetic_treatments_visibility ON aesthetic_treatments
  USING (
    tenant_id IS NULL
    OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE TRIGGER aesthetic_treatments_audit AFTER INSERT OR UPDATE OR DELETE ON aesthetic_treatments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

Seed inicial: ~50 tratamentos (categorizado em corpo, facial, cabelo, wellness).

### 4.5 `aesthetic_treatment_suggestions` — fila pra revisão master

```sql
CREATE TABLE aesthetic_treatment_suggestions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  category               TEXT NOT NULL,
  indications            TEXT[],
  contraindications      TEXT[],
  typical_sessions       INT,
  interval_days          INT,
  cost_estimate_brl_min  DECIMAL(10,2),
  cost_estimate_brl_max  DECIMAL(10,2),
  evidence_level         TEXT,
  description            TEXT,
  protocol_notes         TEXT,
  sources                TEXT[],
  status                 TEXT NOT NULL CHECK (status IN
                           ('pending_review','approved','rejected','superseded')),
  rejected_reason        TEXT,
  reviewed_by            UUID REFERENCES users(id),
  reviewed_at            TIMESTAMPTZ,
  promoted_treatment_id  UUID REFERENCES aesthetic_treatments(id),
  source_run_id          UUID NOT NULL,
  generation_model       TEXT,
  generated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_treatment_suggestions_status ON aesthetic_treatment_suggestions(status, generated_at DESC);
CREATE UNIQUE INDEX idx_treatment_suggestions_dedup ON aesthetic_treatment_suggestions(source_run_id, LOWER(name));
```

Não tem RLS — é tabela administrativa (master-only, sem tenant scope).

### 4.6 Alterações em tabelas existentes

```sql
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS aesthetic_profile JSONB DEFAULT '{}';

ALTER TABLE clinical_encounters
  ADD COLUMN IF NOT EXISTS related_aesthetic_analysis_id UUID
  REFERENCES aesthetic_analyses(id) ON DELETE SET NULL;
```

Ambas: nullable + default — backwards-compatible. Não impacta queries existentes.

## 5. API — endpoints

### 5.1 Consent

| Método | Path | Função |
|---|---|---|
| POST | `/aesthetic/consent` | Confirma consent operacional (1×/paciente). Body: `{ subject_id, reinforced_regions[]?, notes? }` |
| GET | `/aesthetic/consent/:subject_id` | Retorna se já confirmou + data + reinforced_regions |

### 5.2 Photos

| Método | Path | Função |
|---|---|---|
| POST | `/aesthetic/photos` | Upload multipart. Body: `subject_id`, `photo_type`, file. Valida MIME, max 5MB. Retorna `{ photo_id, s3_key }` |
| GET | `/aesthetic/photos/:id/url` | Signed URL TTL 1h. Valida ownership |
| DELETE | `/aesthetic/photos/:id` | Soft delete (`deleted_at = NOW()`). Purge job apaga S3 30d depois |

### 5.3 Analyses

| Método | Path | Função |
|---|---|---|
| POST | `/aesthetic/analyses` | Body: `{ analysis_type, photo_ids[], baseline_id? }`. Pre-check consent + créditos + photos own. Enqueue. Retorna `{ analysis_id, status:'pending' }` |
| GET | `/aesthetic/analyses?subject_id=&type=&limit=` | Lista paginada |
| GET | `/aesthetic/analyses/:id` | Detalhe completo |
| DELETE | `/aesthetic/analyses/:id` | Soft delete |
| POST | `/aesthetic/analyses/:id/compare` | Body `{ baseline_id }`. Computa delta matemático (não chama IA) |

### 5.4 Treatments catalog

| Método | Path | Função |
|---|---|---|
| GET | `/aesthetic/treatments?category=&indication=` | Lista (global + tenant) |
| POST | `/aesthetic/treatments` | Cria proprietário do tenant |
| PUT | `/aesthetic/treatments/:id` | Edita (só os do próprio tenant) |
| DELETE | `/aesthetic/treatments/:id` | Soft (`is_active=false`) |

### 5.5 Master — catálogo global + revisão de sugestões

| Método | Path | Função |
|---|---|---|
| GET | `/master/aesthetic-treatments` | CRUD global completo |
| POST | `/master/aesthetic-treatments` | Cria entry global (tenant_id=NULL) |
| PUT | `/master/aesthetic-treatments/:id` | Edita |
| DELETE | `/master/aesthetic-treatments/:id` | Soft |
| GET | `/master/treatment-suggestions?status=` | Fila de sugestões IA |
| POST | `/master/treatment-suggestions/:id/approve` | Aprova → cria em aesthetic_treatments global |
| POST | `/master/treatment-suggestions/:id/reject` | Body `{ reason }` |
| POST | `/master/treatment-suggestions/:id/supersede` | Body `{ existing_treatment_id }` |
| GET | `/master/treatment-suggestions/runs` | Histórico de rodadas |

### 5.6 Aesthetic profile (do paciente)

| Método | Path | Função |
|---|---|---|
| GET | `/aesthetic/profile/:subject_id` | Retorna `subjects.aesthetic_profile` parseado |
| PUT | `/aesthetic/profile/:subject_id` | Atualiza JSONB validado contra schema |

### 5.7 Rate limits (por user)

- Upload photos: 60/hora
- Create analysis: 30/hora (custo IA controlado)
- Listar/get: 120/hora
- Compare: 60/hora
- Consent: 30/hora
- Profile update: 30/hora

## 6. Worker / agentes IA

### 6.1 Queue

`aesthetic-analysis` (separada de `exam-processing` e `video-transcription`):
- `concurrency: 2`
- `removeOnComplete: { age: 3600 }`
- `removeOnFail: { age: 86400 }`
- Retry: 3 tentativas com backoff exponencial (1s, 2s, 4s) em erros transientes (429, 5xx, ECONNRESET, ETIMEDOUT).

### 6.2 Arquivos novos

```
apps/worker/src/agents/aesthetic-facial.js         ← Call #1 facial
apps/worker/src/agents/aesthetic-body.js           ← Call #1 corporal
apps/worker/src/agents/aesthetic-recommender.js    ← Call #2 protocolo + nutrição
apps/worker/src/processors/aesthetic-analysis.js   ← orquestra
apps/worker/src/jobs/aesthetic-treatment-discovery.js  ← job mensal
apps/worker/src/jobs/aesthetic-purge-sensitive.js  ← purga fotos sensíveis >1 ano
```

E em `apps/worker/src/index.js`:

```js
const aestheticWorker = new Worker('aesthetic-analysis', async (job) => {
  await processAestheticAnalysis(job.data);
}, {
  connection: aestheticConn, concurrency: 2,
  removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 }
});
```

### 6.3 Saneamento defensivo (padrão do projeto)

Cada agente IA:
1. Validação de entrada (rejeita se prompt mal formado)
2. Call ao SDK com timeout (60s Anthropic, per PR6)
3. Parser tolerante (regex `/\{[\s\S]*\}/` pra JSON com prefixo)
4. `BAD_LLM_OUTPUT` em parse fail → 502
5. Validação de schema (arrays obrigatórios, types corretos)
6. Saneamento de cada campo:
   - Scores: clamp [0,100]
   - Coordenadas: clamp [0,1]
   - Strings: slice (label max 100, description max 500)
   - Whitelist enums (region.type, urgency, evidence_level)
   - Max items: 20 regions/metric, 50 points/region, 10 treatments/recommendation

### 6.4 System prompts (resumido — detalhe na implementação)

**aesthetic-facial.js (Call #1):**

```
Você é um assistente de análise estética. Analise [N fotos] de um
paciente [F/M, idade X, fitzpatrick Y, skin_concerns Z].

Avalie as seguintes métricas (escala 0-100, onde 0 = problema severo,
100 = pele ideal):
- rugas, firmeza, elasticidade, textura, manchas, poros, olheiras,
  vermelhidao, uniformidade_tom, acne, simetria

Para cada métrica, retorne também `regions[]` (coordenadas normalizadas
0-1) das áreas afetadas. Tipos suportados: bbox, polyline, polygon, line, point.

Marque `confidence: "low"` em métricas que dependem de medição precisa 2D
(ex: simetria).

NÃO faça diagnóstico médico. NÃO sugira tratamentos aqui.
Output JSON estrito.
```

**aesthetic-recommender.js (Call #2):**

```
Você é um assistente de protocolo estético. Com base nas métricas
analisadas, perfil do paciente e catálogo de tratamentos disponíveis,
recomende protocolo.

CONSTRAINTS:
- Profissional: [esteticista | medico | dentista]
- Se esteticista, NÃO sugira procedimentos com requires_medico=true.
- Use APENAS treatments do catálogo fornecido.
- Considere contraindicações do paciente.
- Estime sessões + intervalo + custo conforme padrão do catálogo.

PARA NUTRIÇÃO:
- Use cálculos pré-feitos (TMB + calorias ajustadas) que enviarei.
- Forneça orientações gerais de estilo de vida (não plano terapêutico).
- Inclua disclaimer "consulta com nutricionista (CRN)".

Output JSON estrito.
```

### 6.5 Erros + refund

| Erro | Trigger | Refund? |
|---|---|---|
| NO_FACE_DETECTED | Sonnet Vision flag em prompt | ✅ Sim, automático |
| IMAGE_TOO_BLURRY | Sonnet flag | ✅ Sim |
| BAD_LLM_OUTPUT (Call #1) | Parse fail após 3 retries | ✅ Sim |
| BAD_LLM_OUTPUT (Call #2) | Parse fail | ❌ Não — métricas Call #1 são úteis, retorna análise sem recommendations |
| ANTHROPIC_TIMEOUT | 60s sem resposta | Retry BullMQ; se 3× falha: refund |
| INSUFFICIENT_CREDITS | Pre-flight check | N/A — bloqueia antes de enqueue |
| CONSENT_MISSING | Pre-flight | N/A — bloqueia antes de enqueue |

### 6.6 Job mensal de descoberta de tratamentos

`apps/worker/src/jobs/aesthetic-treatment-discovery.js`:
- Schedule: 1° de cada mês, 03:00 BRT (cron equivalente em scheduler.js).
- Idempotência: `source_run_id` = `YYYY-MM`. Skip se já rodou esse mês.
- 1 chamada Opus 4.7 com prompt estruturado.
- Saneamento + INSERT em `aesthetic_treatment_suggestions` (status=pending_review).
- Limit: 30 sugestões por rodada (evita spam).

### 6.7 Job de purga de fotos sensíveis

`apps/worker/src/jobs/aesthetic-purge-sensitive.js`:
- Schedule: diário 04:00 BRT.
- Query: `SELECT id, s3_key FROM aesthetic_photos WHERE is_sensitive=true AND created_at < NOW() - INTERVAL '1 year' AND deleted_at IS NULL`.
- Pra cada: soft delete + S3 delete object + audit log entry.
- Log estruturado pra observability.

## 7. Frontend (Angular)

### 7.1 Estrutura

```
apps/web/src/app/features/aesthetic/
├── components/
│   ├── facial-analysis-tab.component.ts
│   ├── consent-modal.component.ts
│   ├── consent-reinforced-modal.component.ts
│   ├── photo-quality-guide.component.ts
│   ├── photo-uploader.component.ts
│   ├── analysis-result.component.ts
│   ├── photo-overlay.component.ts             ← SVG annotation layer
│   ├── layer-toolbar.component.ts             ← toggle visibility
│   ├── analysis-list.component.ts
│   ├── comparison-view.component.ts
│   ├── treatment-protocol-cards.component.ts
│   ├── lifestyle-recommendations.component.ts
│   ├── region-picker.component.ts             ← escolher analysis_type
│   ├── aesthetic-profile-form.component.ts
│   ├── treatment-catalog-table.component.ts   ← tenant CRUD próprio
│   └── master/
│       ├── master-treatment-catalog.component.ts
│       └── master-treatment-suggestions.component.ts
├── services/
│   ├── aesthetic-facial.service.ts
│   ├── aesthetic-treatments.service.ts
│   ├── photo-validator.service.ts
│   ├── photo-overlay.service.ts               ← scale + render SVG layers
│   └── aesthetic-ws.service.ts
├── models/
│   ├── analysis.model.ts
│   ├── metric.model.ts
│   ├── region.model.ts
│   └── treatment.model.ts
└── aesthetic.routes.ts
```

### 7.2 UX flow (resumido — detalhe em mockup F1)

1. Patient-detail aba "Análise IA" (condicional `module='estetica'`)
2. Card "Nova análise" → modal region-picker
3. Se consent pendente → consent-modal (ou consent-reinforced-modal pra sensíveis)
4. photo-quality-guide.component (orientações específicas por região)
5. photo-uploader (valida client-side: resolução ≥ 1024×1024, ≤5MB, JPEG/PNG, compressão q=0.85)
6. POST `/aesthetic/analyses` → recebe analysis_id pending
7. WS evento analysis_done → fetch + render analysis-result
8. analysis-result composta de:
   - photo-overlay (foto + SVG anotações)
   - layer-toolbar (toggles)
   - métricas barras horizontais
   - treatment-protocol-cards
   - lifestyle-recommendations
   - disclaimer obrigatório
9. comparison-view (botão "Comparar análises") → escolhe baseline + atual → render delta

### 7.3 Photo overlay (SVG inline)

```html
<div class="photo-overlay-container" #container>
  <img [src]="photoUrl()" #photo (load)="onPhotoLoaded()">
  @if (photo.naturalWidth) {
    <svg [attr.viewBox]="'0 0 ' + photo.naturalWidth + ' ' + photo.naturalHeight"
         preserveAspectRatio="xMidYMid slice">
      @for (layer of activeLayers(); track layer.key) {
        <g [attr.data-metric]="layer.key"
           [attr.fill]="layer.color"
           [attr.opacity]="layerOpacity()">
          @for (region of layer.regions; track $index) {
            @switch (region.type) {
              @case ('bbox')     { <rect [attr.x]="region.x * W()" ...> }
              @case ('polyline') { <polyline [attr.points]="scalePoints(region.points)"> }
              @case ('polygon')  { <polygon [attr.points]="scalePoints(region.points)"> }
              @case ('line')     { <line [attr.x1]="region.from[0] * W()" ...> }
              @case ('point')    { <circle [attr.cx]="region.x * W()" ...> }
            }
          }
        </g>
      }
    </svg>
  }
</div>
```

Layer toolbar com checkbox + cor + count + slider opacidade global. Cores conforme palette do § 5.

### 7.4 Antes/Depois (comparação visual corporal)

Para análises com `baseline_analysis_id`:
- Lado esquerdo: foto baseline + overlay vermelho/laranja (regiões "antes")
- Lado direito: foto atual + overlay verde (regiões "depois")
- Toggle "Mostrar contorno do antes sobreposto na foto atual" — overlay duplo
- Resumo numérico: delta por métrica + percentual de mudança
- Slider reveal (opcional — wow factor)

### 7.5 Mensagens (centralizadas)

Arquivo `apps/web/src/app/features/aesthetic/services/aesthetic-messages.ts` exporta mapa de mensagens (todos casos do § 4 frontend). Snack-bar com cores semânticas.

### 7.6 Disclaimer em todas as telas

Footer fixo:
> "⚕ Sugestões da IA são suporte à decisão. Esteticista/médico responsável valida e decide. Orientações de estilo de vida não substituem nutricionista (CRN)."

## 8. Catálogo de tratamentos

### 8.1 Seed inicial (~50 tratamentos)

Migration `088_aesthetic_treatments_seed.sql` insere catálogo global. Categorias e exemplos:

- **corpo_modelagem:** Criolipólise, Lipocavitação, HIFU corporal, Carboxiterapia, Endermologie
- **corpo_flacidez:** Radiofrequência (Indiba, Accent), Ultrassom microfocado, Bioestimuladores (Radiesse, Sculptra)
- **facial_rejuvenescimento:** Microagulhamento, RF microagulhada, Laser fracionado (CO2, Erbium), HIFU facial
- **facial_pigmentacao:** Peeling químico (TCA, glicólico, fenol), IPL, Laser Q-switched
- **facial_acne:** Limpeza de pele, Peeling salicílico, Drenagem comedônica
- **facial_preenchimento:** Ácido hialurônico (várias zonas), Bioestimuladores faciais
- **facial_toxina:** Botox terapêutico/estético
- **cabelo:** Mesoterapia capilar, PRP, Microagulhamento capilar
- **wellness_drenagem:** Drenagem linfática manual, Bambuterapia, Massagem modeladora
- **procedimento_cirurgico:** Lipoaspiração, Abdominoplastia, Mastopexia (flags `requires_medico=true`)

Cada entry: nome, category, indications (kebab-case alinhado a METRICS_CATALOG), contraindications, typical_sessions, interval_days, cost range, evidence_level, description, requires_medico.

### 8.2 Rotina de atualização

- **Mensal:** job de descoberta IA gera ~10-30 sugestões em `aesthetic_treatment_suggestions`
- **On-demand:** master adiciona manualmente via UI quando aprende de fonte externa (congresso, paper, etc.)
- **Por tenant:** clínica adiciona protocolos proprietários (não vai pro catálogo global)

## 9. Integrações com features existentes

### 9.1 Timeline

`timeline-panel.component.ts` ganha novo case `aesthetic_analysis_completed`:
- Backend timeline endpoint adiciona UNION ALL pra `aesthetic_analyses` quando `module='estetica'`.
- Frontend renderiza card com top 3 métricas + link "Ver análise".

### 9.2 Agenda

`analysis-result` mostra botões "Agendar X sessões" pros treatments sugeridos:
- Click abre `quick-create-dialog` (componente existente da agenda) pré-preenchido com `appointment_type='procedimento_estetico'`, notes contém ref ao `aesthetic_analysis_id` + `treatment_id` + `session_number`.
- Lembretes T-24h / T-2h funcionam via scheduler existente sem mudança.

### 9.3 Prontuário

`clinical_encounters.related_aesthetic_analysis_id` é o link.
- Encounter pos_procedimento: autocomplete sugere análises recentes
- UI: ao criar encounter, opção de "Adicionar foto pós" → vira nova `aesthetic_photos` (tipo `after`) + link com análise original

### 9.4 Audit log

Triggers automáticos em todas as 4 tabelas novas (`aesthetic_photos`, `aesthetic_analyses`, `aesthetic_consent`, `aesthetic_treatments`). Toda mudança fica auditável via `/master/audit-log` existente.

### 9.5 Master broadcasts

Sem alteração — master broadcasts existentes continuam funcionando.

### 9.6 Inter-tenant chat

Sem alteração — feature isolada.

## 10. Multi-módulo e rollback

### 10.1 Cada PR isolado e rollback-friendly

- 1 PR por fase (F1 a F6), revisão e merge separados.
- Cada migration numerada sequencialmente — rollback via `INSERT INTO _migrations (filename, applied_at) VALUES (X, NOW())` se precisar marcar como aplicada manualmente.
- Mudanças em código novas (tabelas, rotas, componentes) — rollback = revert do PR.
- Mudanças aditivas em tabelas existentes (`aesthetic_profile`, `related_aesthetic_analysis_id`) — não removem dados; rollback = manter coluna mas não usar.

### 10.2 Validação multi-módulo pré-merge

Pra cada PR:
1. Smoke local Docker: login tenant `human` → telas críticas funcionam.
2. Smoke: login tenant `veterinary` → telas críticas funcionam.
3. Smoke: login tenant `estetica` → feature nova funciona.
4. Tests `npm run test:unit` (api), `npm test` (worker, web) — verde.
5. Monitor deploy.yml até `Wait for services stable`.

### 10.3 Feature flag (opcional)

Considerar env var `AESTHETIC_FEATURES_ENABLED=true` no backend pra desligar feature inteira em caso de incidente sem reverter código.

## 11. Custos e cobrança

### 11.1 Custo de IA estimado

| Tipo | Vision tokens out | Opus tokens out | Custo API/análise |
|---|---|---|---|
| Facial | ~3k | ~1k | ~$0.30-0.40 |
| Corporal | ~3k | ~1k | ~$0.30-0.40 |
| Sensível (com auto-crop) | ~3k + 500 | ~1k | ~$0.40-0.50 |

### 11.2 Cobrança via credit_ledger

| kind | amount | descrição |
|---|---|---|
| `aesthetic_facial_analysis` | -5 | Análise facial IA |
| `aesthetic_body_analysis` | -5 | Análise corporal IA |
| `aesthetic_sensitive_analysis` | -5 | Análise região sensível (com auto-crop) |
| `aesthetic_refund` | +5 | Refund por falha técnica |

Override por env var:
- `AESTHETIC_FACIAL_COST=5`
- `AESTHETIC_BODY_COST=5`
- `AESTHETIC_SENSITIVE_COST=5`

### 11.3 Infra adicional

- S3 storage: ~500KB por foto JPEG q=0.85. 1000 análises/mês ≈ 500MB/mês (~$0.01/mês). Negligível.
- BullMQ queue extra: zero custo (Redis já existe).
- DB: tabelas novas + índices ≈ +10-20MB. Negligível.
- ECS/CPU: análise IA é processada pelo worker existente (concorrência adicional). Pode requerer scale up do worker se >50 análises simultâneas (não previsto pro lançamento). Monitorar.

## 12. LGPD / segurança

### 12.1 Consent

- Confirmação operacional do profissional registrada em `aesthetic_consent` 1× por paciente.
- Reforçada pra regiões sensíveis (mama, glúteos, abdômen baixo).
- IP + UA + timestamp + user_id auditáveis.

### 12.2 Criptografia

- S3 bucket `genomaflow-uploads-prod` com SSE-S3 (AES-256) default.
- Em trânsito: HTTPS no ALB (TLS 1.2+).
- Photos signed URLs com TTL 1h, validação de tenant ownership antes de gerar.

### 12.3 Retenção e purga

- Padrão: 5 anos (alinhado com CFM prontuário).
- Sensíveis: 1 ano (job diário purga via worker).
- Manual: `DELETE /aesthetic/photos/:id` (soft + S3 hard delete 30d depois).

### 12.4 Acesso a fotos sensíveis

- Endpoint que gera signed URL pra foto sensível: query parameter `reason` obrigatório (visualização registrada com motivo).
- Audit log entry com `actor_channel='ui'` + `metadata.is_sensitive_view=true`.

### 12.5 Direito ao apagamento

- Endpoint `DELETE /aesthetic/photos/:id` (esteticista) ou `DELETE /master/aesthetic-photos/:id` (master).
- Soft delete imediato (`deleted_at = NOW()`). Job de purga apaga S3 após 30d.
- Análises relacionadas: marcadas mas não apagadas (audit history preservado).

## 13. Disclaimer regulatório (obrigatório em UI)

Footer em todas as telas com sugestões da IA:

```
⚕ Análise gerada por IA com base nas fotos enviadas e perfil informado.
Sugestões de tratamento são suporte à decisão do(a) profissional habilitado(a),
não substituem avaliação clínica presencial. Orientações de estilo de vida não
substituem consulta com nutricionista (CRN). Procedimentos médicos exigem
profissional com CRM. Esteticista responsabiliza-se pela escolha final.
```

Marketing (landing page atualizada): mesmo footer + adição "Os scores numéricos são índices internos GenomaFlow e não medições clínicas validadas." Trechos com porcentagens devem ser revisados ou removidos.

## 14. Testes

### 14.1 Backend (test:unit, sem DB)

Padrão Fastify isolado com pg mocked:
- `aesthetic-consent.test.js`: idempotência, 1× por paciente, IP/UA captura
- `aesthetic-photos.test.js`: upload MIME validation, size limit, tenant ownership check
- `aesthetic-analyses.test.js`: pre-flight check (consent + créditos + photos own), enqueue, refund
- `aesthetic-treatments.test.js`: CRUD tenant + global visibility, indications array search
- `aesthetic-recommender-sanitization.test.js`: BAD_LLM_OUTPUT, clamp, slice, whitelist enums
- `aesthetic-region-validator.test.js`: bbox/polyline/polygon coords clamp, max points
- `aesthetic-module-gate.test.js`: 403 pra outros módulos
- `aesthetic-tmb.test.js`: cálculo Mifflin-St Jeor casos masc/fem/borderline

Adicionar a `package.json test:unit` glob.

### 14.2 Worker

- `aesthetic-facial-agent.test.js`: parse JSON tolerante, BAD_LLM_OUTPUT, NO_FACE_DETECTED flag
- `aesthetic-recommender-agent.test.js`: filter requires_medico por professional_type, lifestyle disclaimer presente
- `aesthetic-treatment-discovery.test.js`: idempotência via source_run_id

### 14.3 Web

- `facial-analysis-tab.spec.ts`: renderiza condicional `module='estetica'`
- `photo-validator.service.spec.ts`: resolução, tamanho, formato
- `photo-overlay.component.spec.ts`: render SVG correta pra cada region.type
- `layer-toolbar.spec.ts`: toggle on/off, opacity slider

### 14.4 Smoke E2E (manual)

Cada fase tem checklist:
- F1 facial: criar análise → upload 1 foto → ver resultado com overlay → comparar com baseline
- F2 corporal: idem + culote antes/depois
- F3 catálogo: clínica adiciona próprio + IA sugere com treatment_id válido
- F4 nutrição: aesthetic_profile preenchido + análise mostra calorias + macros + disclaimer
- F5 regiões sensíveis: consent reforçado + auto-crop visível
- F6 integrações: timeline mostra análise + agenda cria appointment + prontuário linka

## 15. Observability

### 15.1 Logs estruturados

Padrão Fastify logger:
```json
{ "level": 30, "time": ..., "msg": "[aesthetic] analysis enqueued", "analysis_id":"...", "tenant_id":"...", "region":"facial", "cost":5 }
```

### 15.2 Métricas (CloudWatch via logs)

Padrões pra filter logs:
- `[aesthetic] analysis enqueued` — count de análises iniciadas
- `[aesthetic] analysis completed` — count + duração
- `[aesthetic] analysis failed` — count por error_code
- `[aesthetic] refund issued` — count + amount

### 15.3 Métricas SQL (queries em master panel)

- Análises por tenant/mês
- Sucesso vs falha
- Distribuição por região
- Top tratamentos sugeridos
- Créditos consumidos vs refunded

## 16. Plano de release em fases

### F1: Foundation + Facial (15 dias úteis)

- Migrations: 088 (`aesthetic_photos`, `aesthetic_analyses`, `aesthetic_consent` com RLS + audit triggers)
- Backend: endpoints consent, photos, analyses POST/GET; agente facial Call #1 + Call #2 básico (sem catálogo ainda, recomendações texto livre)
- Worker: queue + processor + agente facial
- Frontend: tab "Análise Facial IA" no patient-detail, consent modal, photo-quality-guide, photo-uploader, analysis-result com 11 métricas + barras + overlay SVG simples + toolbar de camadas
- Tests: unit completo + smoke E2E facial
- Memory + spec update

**Go-to-market parcial:** marketing pode lançar facial com material adaptado.

### F2: Corporal + comparação visual (10 dias úteis)

- Migration: 089 (extensão CHECK pra analysis_type body_*; já contemplado em 088 se incluir agora)
- Backend: validações específicas pra body photos (múltiplas), endpoint compare
- Worker: agente corporal (mesmo two-call, prompt diferente)
- Frontend: region-picker, body photo guides, comparison-view, antes/depois com overlay duplo, slider reveal
- Tests: body region validation, comparison delta calculation
- Memory update

### F3: Catálogo + recomendação rica (12 dias úteis)

- Migration: 090 (`aesthetic_treatments` + `aesthetic_treatment_suggestions`) + seed migration 091
- Backend: CRUD master + CRUD tenant + treatment matching pos-IA
- Worker: job mensal de descoberta + agente recommender estendido (consome catálogo)
- Frontend: treatment-protocol-cards rica, master-treatment-catalog UI, master-treatment-suggestions queue
- Tests: catalog visibility (global vs tenant), suggestions approval flow
- Memory update

### F4: Nutrição + perfil antropométrico (8 dias úteis)

- Migration: 092 (`subjects.aesthetic_profile JSONB`)
- Backend: aesthetic-tmb service, aesthetic-profile CRUD, prompt update do recommender
- Frontend: aesthetic-profile-form component, lifestyle-recommendations rendering
- Tests: TMB cálculo edge cases, disclaimer presente
- Memory update

### F5: Regiões adicionais (10 dias úteis)

- Migration: 093 (extensão CHECK pra eyelids/neck/breast/arms; já em 088 se decidir)
- Backend: consent reinforced modal logic, auto-crop service para áreas sensíveis (Sonnet Vision identifica bbox de mamilo/genital, depois `sharp` aplica blur pixelizado nas coordenadas antes do upload S3), purge sensitive job
- Frontend: region-picker expanded, consent-reinforced-modal, photo guides por região
- Tests: sensitive region flow, purge job idempotência
- Memory update

### F6: Polish + integrações (8 dias úteis)

- Migration: 094 (`clinical_encounters.related_aesthetic_analysis_id`)
- Backend: timeline UNION ALL pra aesthetic_analyses, encounter related_id, agenda quick-create pre-fill, PDF protocol export
- Frontend: timeline rendering aesthetic events, encounter-form vínculo análise, agenda quick-create integration, layer-toolbar polish, animações
- Tests: integration E2E (análise → agendar → prontuário → próxima análise)
- Memory update final

**Total: ~63 dias úteis ≈ 13 semanas**

## 17. Atualizações de docs paralelas (cada fase)

- `apps/landing/` — atualizar com nova feature liberada (texto + screenshot conforme F1, F3, F4 entreguem)
- `docs/claude-memory/MEMORY.md` — append cada fase
- `docs/claude-memory/project_aesthetic_*.md` — atualizar progress
- `docs/user-help/aesthetic-*.md` — user-facing help docs (RAG do Copilot indexa)
- `CLAUDE.md` — se for definir nova regra durante implementação (ex: standard de prompts IA)

## 18. Decisões deferidas (não-bloqueantes)

- **Slider reveal animado antes/depois** — F2 (polish em F6 se sobrar tempo)
- **Filtro por categoria no catálogo UI** — F3 nice-to-have
- **Exportação PDF do protocolo pro paciente** — F6
- **Integração com Bling/PDV (recibo procedimento)** — fora deste escopo (memória project_phase_4)
- **API pública pra clínicas integrarem com próprio sistema** — fora deste escopo
- **App mobile específico pra esteticista (offline-first)** — fora deste escopo (existe mobile Capacitor genérico)

## 19. Plano de verificação no fim de cada fase

Antes de pedir merge da PR de cada fase:

1. `npm run test:unit` (api) verde
2. `npm test` (worker) verde
3. `npm test` (web) verde
4. `cdk synth` clean se houver mudança de infra
5. Smoke E2E manual (checklist da fase)
6. Login em 3 tenants demo (Mario Borges médica/vet/estética) e validar:
   - Tenant estética: feature nova funciona
   - Tenants human/vet: nada quebrou, telas como antes
7. Memória atualizada
8. Landing page atualizada (se feature visível pro mercado)
9. Disclaimer obrigatório presente onde aplicável

## 20. Riscos identificados

| Risco | Mitigação |
|---|---|
| Vision retornando coordenadas imprecisas | `confidence` por métrica; UI mostra warning; permite edit manual em fase posterior |
| Custo IA escalando rápido | Rate limit por user; monitorar daily cost; alarme se >$50/dia |
| Acidentalmente mostrar feature pra human/vet | Middleware `requireEsteticaModule` + UI `@if` condicional; smoke test em 3 tenants |
| Catálogo desatualizado (CFE/ANVISA muda regras) | Job mensal IA + atualização manual master; fallback "novo — não catálogo" badge |
| LGPD: foto sensível vazada | RLS + signed URLs TTL 1h + ownership check + auto-crop opcional |
| Recomendação inadequada pelo Recommender | Disclaimer + filter por professional_type + log de cada recomendação no audit_log |
| Schema JSONB sem validação | Validators backend pré-INSERT + JSON Schema validate (futuro) |
| Custo de inference em escala | Cobrança via créditos garante pareamento; monitoramento mensal de margem |

## 21. Sucesso (definição)

Esta plataforma é considerada bem-sucedida quando:

- Tenant `estetica` consegue criar análise facial completa em <60s
- Comparação evolutiva mostra delta visualmente claro
- Tratamentos sugeridos vêm do catálogo curado (match >70%)
- Zero regressão funcional em tenants `human` e `veterinary`
- LGPD: 0 incidentes de vazamento de foto entre tenants
- Custo médio de IA por análise ≤ $0.50
- Esteticistas reais (após beta) reportam "análise útil" em ≥ 70% dos casos
- Sales: ≥ 10 conversões de demo pra contrato pago em 3 meses pós-lançamento

---

**Fim do spec. Pronto pra implementação faseada (F1 → F6).**
