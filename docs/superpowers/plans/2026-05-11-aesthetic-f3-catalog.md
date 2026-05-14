# Aesthetic F3 — Treatment Catalog + Rich Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catálogo curado de tratamentos estéticos (~50 entries seed) + job mensal de descoberta IA + recomendações ricas com `treatment_id` referenciando catálogo + master panel pra revisar sugestões.

**Architecture:** 2 tabelas novas (`aesthetic_treatments` com RLS NULLIF + `aesthetic_treatment_suggestions` admin-only sem RLS). Job mensal Opus gera ~20-30 sugestões; master revisa via panel. Backend endpoints CRUD tenant (catálogo proprietário) + master (catálogo global). Worker recommender estende prompt pra consumir catálogo + treatment matching pos-IA (LOWER(name) match).

**Tech Stack:** Igual F1/F2.

**Spec de referência:** `docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md` §16 F3.

**Estimativa:** ~12 dias úteis em 11 tarefas.

**Princípios de execução:**
- Reusar padrão de migration F1 (RLS NULLIF + audit trigger + gen_random_uuid)
- TDD em backend + worker
- Sem stash, sem --no-verify
- Branch protocol obrigatório

---

## Task 1: Migration 091 — `aesthetic_treatments` table

**Files:**
- Create: `apps/api/src/db/migrations/091_aesthetic_treatments.sql`

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull && git checkout -b feat/aesthetic-f3-task-01-migration-treatments
```

- [ ] **Step 2: SQL**

`apps/api/src/db/migrations/091_aesthetic_treatments.sql`:

```sql
-- 091_aesthetic_treatments.sql
-- Catálogo curado de tratamentos estéticos.
-- tenant_id NULL = catálogo global GenomaFlow (master gerencia)
-- tenant_id setado = tratamento proprietário da clínica
-- RLS visibility: NULL (global) OR same tenant.
-- Spec §4.4

CREATE TABLE IF NOT EXISTS aesthetic_treatments (
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

CREATE INDEX IF NOT EXISTS idx_aesthetic_treatments_visibility
  ON aesthetic_treatments(tenant_id, category, is_active);

CREATE INDEX IF NOT EXISTS idx_aesthetic_treatments_indications
  ON aesthetic_treatments USING gin(indications);

ALTER TABLE aesthetic_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_treatments FORCE ROW LEVEL SECURITY;

-- RLS: global OR same tenant
CREATE POLICY aesthetic_treatments_visibility ON aesthetic_treatments
  USING (
    tenant_id IS NULL
    OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE TRIGGER aesthetic_treatments_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_treatments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

- [ ] **Step 3: Apply + verify**

```bash
docker compose exec api node src/db/migrate.js
docker compose exec db psql -U postgres -d genomaflow -c "\d aesthetic_treatments"
```

Expected: 17 colunas, 2 índices (1 btree composto + 1 GIN), RLS ENABLE+FORCE, trigger.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/091_aesthetic_treatments.sql
git commit -m "feat(aesthetic): migration 091 aesthetic_treatments com RLS+audit (F3.1)

Catálogo curado. tenant_id NULL = global GenomaFlow.
RLS policy: global OR same tenant.
GIN index em indications pra busca rápida.
Spec §4.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migration 092 — `aesthetic_treatment_suggestions` + seed inicial

**Files:**
- Create: `apps/api/src/db/migrations/092_aesthetic_treatment_suggestions.sql`
- Create: `apps/api/src/db/migrations/093_aesthetic_treatments_seed.sql`

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull && git checkout -b feat/aesthetic-f3-task-02-suggestions-seed
```

- [ ] **Step 2: Migration 092 — suggestions table (admin-only, sem RLS)**

`apps/api/src/db/migrations/092_aesthetic_treatment_suggestions.sql`:

```sql
-- 092_aesthetic_treatment_suggestions.sql
-- Fila de revisão de tratamentos sugeridos pela IA mensalmente.
-- Master revisa, aprova/rejeita, aprovado vira row em aesthetic_treatments.
-- Admin-only (acessada via /master/treatment-suggestions, master role).
-- Sem RLS — tabela administrativa não tenant-scoped.
-- Spec §4.5

CREATE TABLE IF NOT EXISTS aesthetic_treatment_suggestions (
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

CREATE INDEX IF NOT EXISTS idx_treatment_suggestions_status
  ON aesthetic_treatment_suggestions(status, generated_at DESC);

-- Idempotência: 1 sugestão por (run_id, LOWER(name)) — evita duplicação cross-runs
CREATE UNIQUE INDEX IF NOT EXISTS idx_treatment_suggestions_dedup
  ON aesthetic_treatment_suggestions(source_run_id, LOWER(name));
```

- [ ] **Step 3: Migration 093 — seed catálogo global (~50 entries)**

`apps/api/src/db/migrations/093_aesthetic_treatments_seed.sql`:

```sql
-- 093_aesthetic_treatments_seed.sql
-- Catálogo inicial GenomaFlow (~50 tratamentos comuns no mercado BR 2026).
-- tenant_id = NULL (global).
-- Re-runs são idempotentes via WHERE NOT EXISTS.
-- Spec §8.1

DO $$
BEGIN
  -- Corpo modelagem
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Criolipólise', 'corpo_modelagem',
    ARRAY['culote_esquerdo','culote_direito','flacidez_abdominal','volume_aparente_abdomen'],
    ARRAY['gravidez','hernia_incisional','crioglobulinemia','doenca_raynaud'],
    3, 60, 1500.00, 3500.00, 'B',
    'Lipólise por resfriamento controlado. Reduz adipócitos em áreas localizadas.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Criolipólise') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Lipocavitação', 'corpo_modelagem',
    ARRAY['culote_esquerdo','culote_direito','celulite_coxas','flacidez_abdominal'],
    ARRAY['gravidez','marcapasso','tumor_ativo'],
    8, 7, 150.00, 350.00, 'C',
    'Ultrassom de baixa frequência pra rompimento de adipócitos.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Lipocavitação') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Radiofrequência Corporal', 'corpo_flacidez',
    ARRAY['flacidez_abdominal','flacidez_triceps','flacidez_interna_coxa','firmeza_gluteos'],
    ARRAY['gravidez','marcapasso','metal_implant'],
    10, 7, 200.00, 500.00, 'B',
    'RF estética pra estímulo de colágeno e melhora de flacidez.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Radiofrequência Corporal') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'HIFU Corporal', 'corpo_modelagem',
    ARRAY['flacidez_abdominal','flacidez_triceps','volume_aparente_abdomen'],
    ARRAY['gravidez','tumor_ativo'],
    1, 180, 2500.00, 5000.00, 'B',
    'Ultrassom microfocado de alta intensidade pra flacidez profunda.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('HIFU Corporal') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Carboxiterapia', 'corpo_modelagem',
    ARRAY['celulite_coxas','celulite_gluteos','estrias_abdominais','estrias_coxas'],
    ARRAY['gravidez','insuficiencia_cardiaca','dpoc'],
    10, 7, 100.00, 250.00, 'C',
    'Infiltração subcutânea de CO2 medicinal pra microcirculação.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Carboxiterapia') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Endermologie', 'corpo_modelagem',
    ARRAY['celulite_coxas','celulite_gluteos','flacidez_triceps'],
    ARRAY['gravidez','varizes_severas','feridas_abertas'],
    14, 7, 120.00, 300.00, 'C',
    'Massagem mecanizada com sucção pra mobilização tecidual.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Endermologie') AND tenant_id IS NULL);

  -- Facial rejuvenescimento
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Microagulhamento', 'facial_rejuvenescimento',
    ARRAY['rugas','firmeza','elasticidade','textura','poros','acne'],
    ARRAY['gravidez','herpes_ativo','acne_inflamada_severa','dermatite_ativa'],
    4, 30, 300.00, 800.00, 'A',
    'Indução percutânea de colágeno via micro-agulhas. Trata rugas finas, cicatrizes e textura.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Microagulhamento') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Radiofrequência Microagulhada', 'facial_rejuvenescimento',
    ARRAY['rugas','firmeza','elasticidade','textura','poros'],
    ARRAY['gravidez','marcapasso','herpes_ativo'],
    3, 45, 800.00, 2500.00, 'A',
    'RF associada a micro-agulhas (Morpheus8, Vivace, etc) pra remodelação profunda.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Radiofrequência Microagulhada') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Laser Fracionado CO2', 'facial_rejuvenescimento',
    ARRAY['rugas','textura','manchas','uniformidade_tom'],
    ARRAY['gravidez','herpes_ativo','fototipo_5_6','queloide'],
    2, 90, 1500.00, 4000.00, 'A',
    'Laser CO2 ablativo fracionado pra resurfacing facial.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Laser Fracionado CO2') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'HIFU Facial', 'facial_rejuvenescimento',
    ARRAY['firmeza','elasticidade','rugas','simetria'],
    ARRAY['gravidez','metal_implant_facial'],
    1, 180, 1800.00, 5500.00, 'B',
    'Ultraformer/Ulthera — ultrassom microfocado pra lifting não-invasivo.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('HIFU Facial') AND tenant_id IS NULL);

  -- Facial pigmentação
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Peeling Químico Glicólico', 'facial_pigmentacao',
    ARRAY['manchas','uniformidade_tom','textura','rugas'],
    ARRAY['gravidez','dermatite_ativa','herpes_ativo'],
    6, 21, 150.00, 400.00, 'A',
    'Ácido glicólico em concentrações graduais. Trata fotoenvelhecimento leve a moderado.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Peeling Químico Glicólico') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Peeling Químico TCA', 'facial_pigmentacao',
    ARRAY['manchas','rugas','textura','uniformidade_tom'],
    ARRAY['gravidez','fototipo_5_6_alto_risco','dermatite_ativa'],
    1, 90, 600.00, 1800.00, 'A',
    'Ácido tricloroacético em concentrações 10-35%. Profundidade variável.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Peeling Químico TCA') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Luz Pulsada (IPL)', 'facial_pigmentacao',
    ARRAY['manchas','vermelhidao','uniformidade_tom','poros'],
    ARRAY['gravidez','bronzeamento_recente','medicacao_fotossensibilizante'],
    5, 30, 300.00, 900.00, 'A',
    'Luz intensa pulsada pra fotorrejuvenescimento e tratamento de manchas/vasinhos.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Luz Pulsada (IPL)') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Laser Q-Switched', 'facial_pigmentacao',
    ARRAY['manchas','melasma','tatuagem','pigmentacao_pos_inflamatoria'],
    ARRAY['gravidez','melasma_severo_indicacao_relativa'],
    4, 45, 400.00, 1200.00, 'A',
    'Laser de pulso curto pra fragmentação de pigmentos dérmicos.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Laser Q-Switched') AND tenant_id IS NULL);

  -- Facial acne
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Limpeza de Pele Profunda', 'facial_acne',
    ARRAY['acne','poros','textura','uniformidade_tom'],
    ARRAY['acne_inflamada_severa','dermatite_ativa','rosacea_ativa'],
    6, 30, 100.00, 250.00, 'B',
    'Limpeza com extração comedônica + tônicos. Manutenção mensal.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Limpeza de Pele Profunda') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Peeling Salicílico', 'facial_acne',
    ARRAY['acne','poros','textura','vermelhidao'],
    ARRAY['gravidez','alergia_salicilato'],
    6, 21, 180.00, 400.00, 'A',
    'Ácido salicílico 20-30% — anti-inflamatório e comedolítico.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Peeling Salicílico') AND tenant_id IS NULL);

  -- Facial preenchimento
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Ácido Hialurônico Facial', 'facial_preenchimento',
    ARRAY['rugas','firmeza','simetria','elasticidade'],
    ARRAY['gravidez','infeccao_local','autoimune_grave'],
    1, 365, 1500.00, 4500.00, 'A',
    'Preenchimento dérmico — sulcos, lábios, malar, mento. Validade 6-18 meses.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Ácido Hialurônico Facial') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Bioestimulador de Colágeno', 'facial_preenchimento',
    ARRAY['rugas','firmeza','elasticidade','textura'],
    ARRAY['gravidez','queloide','infeccao_local'],
    2, 60, 1800.00, 4000.00, 'B',
    'Sculptra (PLLA) ou Radiesse (HA-CaHA) — estimulam neocolagênese.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Bioestimulador de Colágeno') AND tenant_id IS NULL);

  -- Facial toxina
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Toxina Botulínica', 'facial_toxina',
    ARRAY['rugas','simetria','flacidez_palpebra_superior'],
    ARRAY['gravidez','miastenia_gravis','infeccao_local','alergia_albumina'],
    1, 120, 800.00, 2500.00, 'A',
    'Botox/Dysport/Xeomin pra rugas dinâmicas (glabela, frontal, periorbitais).',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Toxina Botulínica') AND tenant_id IS NULL);

  -- Cabelo
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Mesoterapia Capilar', 'cabelo',
    ARRAY['alopecia','queda_capilar','espessamento_fio'],
    ARRAY['gravidez','infeccao_couro_cabeludo','dermatite_ativa'],
    8, 14, 200.00, 600.00, 'B',
    'Injeção intradérmica de vitaminas/minoxidil/finasterida no couro cabeludo.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Mesoterapia Capilar') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'PRP Capilar', 'cabelo',
    ARRAY['alopecia','queda_capilar','espessamento_fio'],
    ARRAY['gravidez','infeccao_local','plaquetopenia'],
    4, 30, 400.00, 1500.00, 'B',
    'Plasma rico em plaquetas autólogo pra estímulo folicular.',
    true
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('PRP Capilar') AND tenant_id IS NULL);

  -- Wellness
  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Drenagem Linfática Manual', 'wellness_drenagem',
    ARRAY['celulite_coxas','celulite_gluteos','flacidez_abdominal','volume_aparente_abdomen'],
    ARRAY['trombose_ativa','infeccao_local','feridas_abertas','tumor_metastatico'],
    10, 7, 80.00, 200.00, 'B',
    'Massagem específica que estimula drenagem linfática e melhora retenção.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Drenagem Linfática Manual') AND tenant_id IS NULL);

  INSERT INTO aesthetic_treatments (tenant_id, name, category, indications, contraindications,
    typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
    evidence_level, description, requires_medico)
  SELECT NULL, 'Massagem Modeladora', 'wellness_drenagem',
    ARRAY['culote_esquerdo','culote_direito','celulite_coxas','firmeza_gluteos'],
    ARRAY['trombose_ativa','feridas_abertas','tumor_metastatico'],
    10, 7, 100.00, 250.00, 'C',
    'Massagem manual intensa pra remodelar tecidos.',
    false
  WHERE NOT EXISTS (SELECT 1 FROM aesthetic_treatments WHERE LOWER(name) = LOWER('Massagem Modeladora') AND tenant_id IS NULL);
END $$;
```

Total ~22 treatments seed (manageable em 1 migration). Master pode adicionar mais via UI futuramente.

- [ ] **Step 4: Apply + verify**

```bash
docker compose exec api node src/db/migrate.js
docker compose exec db psql -U postgres -d genomaflow -c "SELECT COUNT(*) FROM aesthetic_treatments WHERE tenant_id IS NULL;"
```

Expected: count ≥ 22.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/migrations/092_aesthetic_treatment_suggestions.sql \
        apps/api/src/db/migrations/093_aesthetic_treatments_seed.sql
git commit -m "feat(aesthetic): migrations 092+093 suggestions + seed catálogo (F3.2)

- 092: aesthetic_treatment_suggestions admin-only (sem RLS, master-scoped via route).
- 093: seed ~22 tratamentos comuns no catálogo global (tenant_id NULL).
  Categorias: corpo_modelagem, corpo_flacidez, facial_*, cabelo, wellness_drenagem.
  Idempotente via WHERE NOT EXISTS por LOWER(name).
Spec §4.5, §8.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Backend service + routes `/aesthetic/treatments` (tenant CRUD)

**Files:**
- Create: `apps/api/src/services/aesthetic-treatments.js`
- Create: `apps/api/src/routes/aesthetic-treatments.js`
- Create: `apps/api/tests/routes/aesthetic-treatments.test.js`

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull && git checkout -b feat/aesthetic-f3-task-03-treatments-routes
```

- [ ] **Step 2: Service**

`apps/api/src/services/aesthetic-treatments.js`:

```js
'use strict';

const { withTenant } = require('../db/tenant');

const VALID_CATEGORIES = new Set([
  'corpo_modelagem','corpo_flacidez',
  'facial_rejuvenescimento','facial_pigmentacao',
  'facial_acne','facial_preenchimento','facial_toxina',
  'cabelo','procedimento_cirurgico','wellness_drenagem','outro',
]);
const VALID_EVIDENCE = new Set(['A','B','C','D']);

function validate(body) {
  if (!body) return 'body obrigatório';
  if (!body.name || typeof body.name !== 'string') return 'name obrigatório';
  if (!body.category || !VALID_CATEGORIES.has(body.category)) return 'category inválido';
  if (!Array.isArray(body.indications)) return 'indications deve ser array';
  if (!Array.isArray(body.contraindications)) return 'contraindications deve ser array';
  if (body.evidence_level && !VALID_EVIDENCE.has(body.evidence_level)) return 'evidence_level inválido (A|B|C|D)';
  return null;
}

async function list(pg, tenantId, { category, indication, limit = 100 } = {}) {
  // Retorna global (tenant_id NULL) + tenant próprio
  const params = [tenantId];
  let where = `(tenant_id IS NULL OR tenant_id = $1) AND is_active = true`;
  if (category) {
    params.push(category);
    where += ` AND category = $${params.length}`;
  }
  if (indication) {
    params.push(indication);
    where += ` AND $${params.length} = ANY(indications)`;
  }
  const { rows } = await pg.query(
    `SELECT id, tenant_id, name, category, indications, contraindications,
            typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
            evidence_level, description, protocol_notes, requires_medico, usage_count_30d,
            created_at, updated_at
     FROM aesthetic_treatments
     WHERE ${where}
     ORDER BY tenant_id NULLS FIRST, name ASC
     LIMIT ${Math.min(500, parseInt(limit) || 100)}`,
    params
  );
  return rows;
}

async function getById(pg, tenantId, id) {
  const { rows } = await pg.query(
    `SELECT * FROM aesthetic_treatments
     WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2) AND is_active = true`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function create(pg, tenantId, userId, body) {
  return withTenant(pg, tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO aesthetic_treatments
         (tenant_id, name, category, indications, contraindications,
          typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
          evidence_level, description, protocol_notes, requires_medico)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        tenantId, body.name.slice(0, 200), body.category,
        body.indications || [], body.contraindications || [],
        body.typical_sessions || null, body.interval_days || null,
        body.cost_estimate_brl_min || null, body.cost_estimate_brl_max || null,
        body.evidence_level || null,
        body.description ? body.description.slice(0, 2000) : null,
        body.protocol_notes ? body.protocol_notes.slice(0, 2000) : null,
        !!body.requires_medico,
      ]
    );
    return rows[0];
  }, { userId, channel: 'ui' });
}

async function update(pg, tenantId, userId, id, body) {
  return withTenant(pg, tenantId, async (client) => {
    // Só edita os próprios (tenant_id = current)
    const { rows } = await client.query(
      `UPDATE aesthetic_treatments SET
         name = COALESCE($3, name),
         category = COALESCE($4, category),
         indications = COALESCE($5, indications),
         contraindications = COALESCE($6, contraindications),
         typical_sessions = COALESCE($7, typical_sessions),
         interval_days = COALESCE($8, interval_days),
         cost_estimate_brl_min = COALESCE($9, cost_estimate_brl_min),
         cost_estimate_brl_max = COALESCE($10, cost_estimate_brl_max),
         evidence_level = COALESCE($11, evidence_level),
         description = COALESCE($12, description),
         protocol_notes = COALESCE($13, protocol_notes),
         requires_medico = COALESCE($14, requires_medico),
         updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [
        id, tenantId,
        body.name ? body.name.slice(0, 200) : null,
        body.category && VALID_CATEGORIES.has(body.category) ? body.category : null,
        Array.isArray(body.indications) ? body.indications : null,
        Array.isArray(body.contraindications) ? body.contraindications : null,
        body.typical_sessions ?? null, body.interval_days ?? null,
        body.cost_estimate_brl_min ?? null, body.cost_estimate_brl_max ?? null,
        body.evidence_level && VALID_EVIDENCE.has(body.evidence_level) ? body.evidence_level : null,
        body.description ? body.description.slice(0, 2000) : null,
        body.protocol_notes ? body.protocol_notes.slice(0, 2000) : null,
        typeof body.requires_medico === 'boolean' ? body.requires_medico : null,
      ]
    );
    return rows[0] || null;
  }, { userId, channel: 'ui' });
}

async function softDelete(pg, tenantId, userId, id) {
  return withTenant(pg, tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE aesthetic_treatments SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
      [id, tenantId]
    );
    return rowCount > 0;
  }, { userId, channel: 'ui' });
}

module.exports = { validate, list, getById, create, update, softDelete, VALID_CATEGORIES, VALID_EVIDENCE };
```

- [ ] **Step 3: Route**

`apps/api/src/routes/aesthetic-treatments.js`:

```js
'use strict';

const { requireEsteticaModule } = require('../middleware/aesthetic-module-gate');
const { validate, list, getById, create, update, softDelete } = require('../services/aesthetic-treatments');

module.exports = async function (fastify) {
  fastify.get('/treatments', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { category, indication, limit } = request.query;
    const items = await list(fastify.pg, request.user.tenant_id, { category, indication, limit });
    return reply.send({ items });
  });

  fastify.post('/treatments', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    if (request.user.role !== 'admin' && request.user.role !== 'master') {
      return reply.status(403).send({ error: 'Apenas admin pode criar tratamentos proprietários' });
    }
    const err = validate(request.body);
    if (err) return reply.status(400).send({ error: err });
    const tx = await create(fastify.pg, request.user.tenant_id, request.user.user_id, request.body);
    return reply.status(201).send(tx);
  });

  fastify.put('/treatments/:id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    if (request.user.role !== 'admin' && request.user.role !== 'master') {
      return reply.status(403).send({ error: 'Apenas admin pode editar tratamentos proprietários' });
    }
    const tx = await update(fastify.pg, request.user.tenant_id, request.user.user_id, request.params.id, request.body || {});
    if (!tx) return reply.status(404).send({ error: 'Tratamento não encontrado ou não pertence ao tenant' });
    return reply.send(tx);
  });

  fastify.delete('/treatments/:id', {
    preHandler: [fastify.authenticate, requireEsteticaModule],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    if (request.user.role !== 'admin' && request.user.role !== 'master') {
      return reply.status(403).send({ error: 'Apenas admin pode remover tratamentos proprietários' });
    }
    const ok = await softDelete(fastify.pg, request.user.tenant_id, request.user.user_id, request.params.id);
    if (!ok) return reply.status(404).send({ error: 'Tratamento não encontrado' });
    return reply.status(204).send();
  });
};
```

- [ ] **Step 4: Test** (segue pattern Fastify isolado dos tests F1)

`apps/api/tests/routes/aesthetic-treatments.test.js`:

```js
'use strict';

const { describe, test, expect } = require('@jest/globals');
const Fastify = require('fastify');

jest.mock('../../src/db/tenant', () => ({ withTenant: (pg, tid, fn) => fn(pg) }));

async function buildApp({ role = 'admin', module = 'estetica' } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'u1', tenant_id: 't1', role, module };
  });
  app.decorate('pg', {
    query: jest.fn(async (sql, params) => {
      if (/SELECT .* FROM aesthetic_treatments/i.test(sql) && /WHERE \(tenant_id IS NULL OR tenant_id/i.test(sql)) {
        return { rows: [
          { id: 'g1', tenant_id: null, name: 'Criolipólise', category: 'corpo_modelagem', indications: ['culote_esquerdo'], is_active: true },
          { id: 't1-own', tenant_id: 't1', name: 'Tratamento próprio', category: 'outro', indications: [], is_active: true },
        ] };
      }
      if (/INSERT INTO aesthetic_treatments/i.test(sql)) {
        return { rows: [{ id: 'new-1', tenant_id: params[0], name: params[1] }] };
      }
      if (/UPDATE aesthetic_treatments SET/i.test(sql) && /is_active = false/i.test(sql)) {
        return { rowCount: 1 };
      }
      if (/UPDATE aesthetic_treatments SET/i.test(sql)) {
        return { rows: [{ id: params[0], tenant_id: params[1], name: 'Updated' }] };
      }
      return { rows: [] };
    }),
  });
  app.register(require('../../src/routes/aesthetic-treatments'), { prefix: '/api/aesthetic' });
  return app;
}

describe('GET /aesthetic/treatments', () => {
  test('lista global + tenant próprios', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/treatments' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(2);
  });

  test('403 pra módulo human', async () => {
    const app = await buildApp({ module: 'human' });
    const res = await app.inject({ method: 'GET', url: '/api/aesthetic/treatments' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /aesthetic/treatments', () => {
  test('cria tratamento próprio do tenant', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/treatments',
      payload: { name: 'Meu tratamento', category: 'outro', indications: [], contraindications: [] },
    });
    expect(res.statusCode).toBe(201);
  });

  test('400 sem name', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/treatments',
      payload: { category: 'outro', indications: [], contraindications: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 category inválido', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/aesthetic/treatments',
      payload: { name: 'X', category: 'invalid', indications: [], contraindications: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /aesthetic/treatments/:id', () => {
  test('soft delete + 204', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/aesthetic/treatments/own-1' });
    expect(res.statusCode).toBe(204);
  });
});
```

- [ ] **Step 5: Register em server.js**

```js
fastify.register(require('./routes/aesthetic-treatments'), { prefix: API_PREFIX + '/aesthetic' });
```

- [ ] **Step 6: Add path to test:unit + commit**

```bash
cd apps/api && npm test -- tests/routes/aesthetic-treatments.test.js
# Expected: 6 PASS

# Add path to test:unit glob in package.json

git add apps/api/src/services/aesthetic-treatments.js \
        apps/api/src/routes/aesthetic-treatments.js \
        apps/api/src/server.js \
        apps/api/tests/routes/aesthetic-treatments.test.js \
        apps/api/package.json
git commit -m "feat(aesthetic): tenant CRUD treatments routes (F3.3)

GET /aesthetic/treatments — list global + tenant próprios (filter category/indication).
POST /aesthetic/treatments — admin/master cria proprietário do tenant.
PUT /aesthetic/treatments/:id — edita só do próprio tenant.
DELETE /aesthetic/treatments/:id — soft via is_active=false.
RLS policy + AND tenant_id explícito em queries.
Spec §5.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Backend `/master/aesthetic-treatments` (catalog global CRUD)

**Files:**
- Modify: `apps/api/src/routes/master.js` — append routes
- Create: `apps/api/tests/routes/master-aesthetic-treatments.test.js`

Routes pra master:
- GET `/master/aesthetic-treatments` (filter category/active)
- POST `/master/aesthetic-treatments` (tenant_id=NULL hardcoded)
- PUT `/master/aesthetic-treatments/:id`
- DELETE `/master/aesthetic-treatments/:id` (soft)

Service reuses `aesthetic-treatments.js` validate function. Inserts/updates passam `tenant_id=null` explicitamente.

Pattern do `master.js` existing (consultar arquivo) — use `auth = masterOnly(fastify)` middleware.

Test 4 cases — pattern similar a Task 3.

Commit: `feat(aesthetic): master CRUD catálogo global treatments (F3.4)`.

---

## Task 5: Worker recommender estendido — consume catálogo + matching

**Files:**
- Modify: `apps/worker/src/agents/aesthetic-recommender.js` — recebe `availableTreatments` no input + prompt update
- Modify: `apps/worker/src/processors/aesthetic-analysis.js` — fetcha catálogo antes do Call #2
- Modify: `apps/worker/tests/agents/aesthetic-recommender.test.js` — adicionar 2 tests

Changes:

1. **Recommender prompt** ganha bloco "CATÁLOGO DISPONÍVEL":
   ```
   TRATAMENTOS DISPONÍVEIS NO CATÁLOGO (use APENAS esses):
   - <name> (indications: <a, b>, contraindications: <x>, sessions: N, interval: D dias, evidence: A/B/C/D, requires_medico: true/false, cost: X-Y BRL)
   - ...
   ```
   IA deve escolher entre as opções (ou recomendar tratamento NOVO marcado com `in_catalog: false` se nada bater bem).

2. **Recommender pos-call** — match treatment_name contra catálogo:
   ```js
   for (const tx of recommendations.treatment_protocol) {
     const match = availableTreatments.find(t => t.name.toLowerCase() === tx.treatment_name.toLowerCase());
     if (match) {
       tx.treatment_id = match.id;
       tx.in_catalog = true;
       tx.requires_medico = match.requires_medico;  // overrides IA com source-of-truth do catálogo
     } else {
       tx.in_catalog = false;
     }
   }
   ```

3. **Processor** fetches treatments antes de chamar recommender:
   ```js
   const { rows: catalogRows } = await client.query(
     `SELECT id, name, category, indications, contraindications, typical_sessions,
             interval_days, cost_estimate_brl_min, cost_estimate_brl_max, evidence_level,
             requires_medico
      FROM aesthetic_treatments
      WHERE (tenant_id IS NULL OR tenant_id = $1) AND is_active = true
      ORDER BY tenant_id NULLS FIRST, usage_count_30d DESC
      LIMIT 50`,
     [tenant_id]
   );
   const recResult = await recommendProtocol({
     metrics: visionResult.metrics, subject, professionalType: professional_type,
     availableTreatments: catalogRows,
   });
   ```

Tests (2):
- Treatment matching: nome no catálogo → `in_catalog: true` + `treatment_id` populado
- Treatment fora do catálogo → `in_catalog: false`, sem treatment_id

Commit: `feat(aesthetic): recommender consome catálogo + treatment matching (F3.5)`.

---

## Task 6: Worker job mensal `aesthetic-treatment-discovery`

**Files:**
- Create: `apps/worker/src/jobs/aesthetic-treatment-discovery.js`
- Create: `apps/worker/tests/jobs/aesthetic-treatment-discovery.test.js`
- Modify: `apps/worker/src/notifications/scheduler.js` — adicionar tick mensal

Responsibility:
- 1× por mês (1º dia 03:00 BRT)
- Idempotência via `source_run_id = YYYY-MM`
- Skip se já rodou esse mês
- Chama Opus 4.7 com prompt:
  ```
  Liste 10-20 tratamentos estéticos surgidos ou popularizados no Brasil nos últimos 6 meses,
  EXCLUINDO os que já estão no catálogo: <lista de nomes do catálogo atual>.
  
  Para cada, retorne JSON:
  { name, category (do enum), indications, contraindications, typical_sessions, interval_days,
    cost_estimate_brl_min, cost_estimate_brl_max, evidence_level (A/B/C/D),
    description, protocol_notes, sources: [fontes/papers/congressos] }
  
  Output: { suggestions: [...] }
  ```
- Saneamento defensivo (max 30 sugestões, slice strings, validate enums)
- INSERT em `aesthetic_treatment_suggestions` com `source_run_id = $YYYY-MM`, `status='pending_review'`
- UNIQUE INDEX em (source_run_id, LOWER(name)) garante idempotência

Tests (3):
- Idempotência via source_run_id
- Sanitização defensiva (BAD_LLM_OUTPUT)
- INSERT correto com status pending_review

Commit: `feat(aesthetic): job mensal aesthetic-treatment-discovery (F3.6)`.

---

## Task 7: Backend `/master/treatment-suggestions` (review queue)

**Files:**
- Modify: `apps/api/src/routes/master.js` — append rotas
- Create: `apps/api/tests/routes/master-treatment-suggestions.test.js`

Routes:
- GET `/master/treatment-suggestions?status=pending_review`
- POST `/master/treatment-suggestions/:id/approve { fields_overrides? }` → INSERT em aesthetic_treatments + UPDATE suggestion status=approved
- POST `/master/treatment-suggestions/:id/reject { reason }` → UPDATE status=rejected
- POST `/master/treatment-suggestions/:id/supersede { existing_treatment_id }` → UPDATE status=superseded
- GET `/master/treatment-suggestions/runs` — histórico de rodadas

Pattern Fastify isolado + 5 tests.

Commit: `feat(aesthetic): master review queue treatment-suggestions (F3.7)`.

---

## Task 8: Frontend `treatment-protocol-cards.component`

**Files:**
- Create: `apps/web/src/app/features/aesthetic/components/treatment-protocol-cards.component.ts`
- Create: spec file

Renderiza `treatment_protocol[]` array como cards visuais:
- Nome treatment (badge "Em breve catálogo" se !in_catalog)
- Indication (texto)
- Sessions × intervalo
- Cost range
- Urgency badge (low/medium/high color)
- Outcome expected
- Botão "Agendar agora" (F6 vai conectar com agenda)

Standalone Angular 18 + signals.

Tests (3):
- Renderiza cards
- Mostra badge "Em breve catálogo"
- Click "Agendar agora" emit event

Integrar em `analysis-result.component.ts` (substituir/melhorar treatment listing existente).

Commit: `feat(aesthetic): treatment-protocol-cards rica (F3.8)`.

---

## Task 9: Frontend `master-treatment-catalog.component`

**Files:**
- Create: `apps/web/src/app/features/aesthetic/components/master/master-treatment-catalog.component.ts`
- Create: spec file

Master panel — list + CRUD do catálogo global.
- Tabela com filtro por categoria
- Botão "Novo tratamento"
- Modal de edit (form completo: name, category, indications array editor, contraindications, sessions, interval, costs, evidence, description, requires_medico)
- Delete soft

Standalone. Lazy-loaded sob rota `/master/aesthetic-catalog`.

Tests (3) — render lista, abre modal de edição, submit cria/edita.

Commit: `feat(aesthetic): master-treatment-catalog UI (F3.9)`.

---

## Task 10: Frontend `master-treatment-suggestions.component`

**Files:**
- Create: `apps/web/src/app/features/aesthetic/components/master/master-treatment-suggestions.component.ts`
- Create: spec file

Master panel — fila de revisão.
- Lista paginada de pending_review
- Botões: "Aprovar" (abre modal de overrides), "Rejeitar" (input motivo), "Já existe" (autocomplete catálogo)
- Histórico de rodadas em sub-tab

Tests (3) — render fila, approve flow, reject flow.

Commit: `feat(aesthetic): master-treatment-suggestions queue UI (F3.10)`.

---

## Task 11: Smoke + memory + landing

- `docs/claude-memory/project_aesthetic_f3_catalog.md` — F3 entregue
- Update `MEMORY.md` index
- Update `apps/landing/index.html` — mention "sugestão automática de tratamentos"

Commit: `docs(aesthetic-f3): memory + landing update (F3.11)`.

---

## Self-Review

**Spec coverage (§16 F3):**
- ✅ Migration `aesthetic_treatments` (Task 1)
- ✅ Migration `aesthetic_treatment_suggestions` + seed (Task 2)
- ✅ Backend tenant CRUD (Task 3)
- ✅ Backend master CRUD global (Task 4)
- ✅ Recommender consume catálogo + matching (Task 5)
- ✅ Job mensal de descoberta (Task 6)
- ✅ Backend master review queue (Task 7)
- ✅ Frontend treatment cards (Task 8)
- ✅ Master catalog UI (Task 9)
- ✅ Master suggestions queue UI (Task 10)
- ✅ Smoke + docs (Task 11)

**Multi-módulo:** Tabelas novas isoladas. Routes só sob `/aesthetic/*` e `/master/aesthetic-*`. Tab patient-detail genérica (F2). Zero quebra.

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-aesthetic-f3-catalog.md`.**

Two execution options:
1. Subagent-Driven (recomendado) — Tasks dispatched fresh subagent per task
2. Inline Execution

(F1+F2 já confirmaram Subagent-Driven — continuando esse pattern.)
