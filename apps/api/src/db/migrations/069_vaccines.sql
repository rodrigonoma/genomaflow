-- 069_vaccines.sql
-- Fase 2: vacinas (módulo veterinário).
-- Spec: docs/superpowers/specs/2026-05-05-clinical-pms-expansion-design.md
--
-- Vacinas humano (pediátrica, COVID, etc.) ficam deferidas pra Fase 4+ se ICP
-- humano pedir — a maioria das clínicas humanas pequenas terceiriza isso pro SUS
-- ou pro convênio, não pelo PMS. Por enquanto, vacinas é vet-only via
-- gating frontend (`tenant.module === 'veterinary'` mostra a aba).
-- Schema NÃO tem coluna de módulo — controle é por subject_type via subject_id FK.

-- Protocolos de vacinação (referência)
-- tenant_id NULL = protocolo global default (visível a todos os tenants).
-- tenant_id preenchido = customização por tenant.
CREATE TABLE IF NOT EXISTS vaccine_protocols (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  species TEXT NOT NULL CHECK (species IN ('dog','cat','equine','bovine','bird','reptile','other')),
  name TEXT NOT NULL,
  description TEXT,
  -- doses: lista de marcos do protocolo, ex:
  -- [{"label":"V8 inicial","age_min_days":45,"age_max_days":60},{"label":"Reforço","age_min_days":75,"age_max_days":90}]
  doses JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vaccine_protocols_species
  ON vaccine_protocols(species, active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_vaccine_protocols_tenant
  ON vaccine_protocols(tenant_id) WHERE tenant_id IS NOT NULL;

-- Vacinas aplicadas
CREATE TABLE IF NOT EXISTS vaccines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  professional_user_id UUID NOT NULL REFERENCES users(id),
  encounter_id UUID REFERENCES clinical_encounters(id) ON DELETE SET NULL,

  vaccine_name TEXT NOT NULL,
  manufacturer TEXT,
  lot_number TEXT,
  applied_at DATE NOT NULL,
  next_dose_date DATE,
  protocol_id UUID REFERENCES vaccine_protocols(id) ON DELETE SET NULL,
  protocol_dose_index INTEGER,  -- índice da dose no protocolo (0=1ª, 1=2ª…)

  notes TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
-- Listagem por subject (carteira de vacinação do animal) — mais comum
CREATE INDEX IF NOT EXISTS idx_vaccines_tenant_subject_applied
  ON vaccines(tenant_id, subject_id, applied_at DESC);

-- Vacinas vencidas / próximas (relatório)
CREATE INDEX IF NOT EXISTS idx_vaccines_tenant_next_dose
  ON vaccines(tenant_id, next_dose_date)
  WHERE next_dose_date IS NOT NULL;

-- Ligação com encounter (timeline / drilldown)
CREATE INDEX IF NOT EXISTS idx_vaccines_encounter
  ON vaccines(encounter_id) WHERE encounter_id IS NOT NULL;


-- RLS — segue padrão NULLIF (master sem contexto vê tudo; tenant scoped)
ALTER TABLE vaccine_protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaccine_protocols FORCE ROW LEVEL SECURITY;
ALTER TABLE vaccines ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaccines FORCE ROW LEVEL SECURITY;

-- vaccine_protocols: tenant_id NULL = global, visível a todos
CREATE POLICY vaccine_protocols_select ON vaccine_protocols
  FOR SELECT USING (
    tenant_id IS NULL
    OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY vaccine_protocols_insert ON vaccine_protocols
  FOR INSERT WITH CHECK (
    -- tenant pode inserir só do próprio tenant; master sem contexto pode inserir global (NULL)
    (tenant_id IS NULL AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY vaccine_protocols_update ON vaccine_protocols
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY vaccine_protocols_delete ON vaccine_protocols
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- vaccines: padrão tenant scoped
CREATE POLICY vaccines_select ON vaccines
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY vaccines_insert ON vaccines
  FOR INSERT WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY vaccines_update ON vaccines
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY vaccines_delete ON vaccines
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );


-- Audit trigger (vacina é dado clínico/LGPD)
CREATE TRIGGER audit_vaccines
  AFTER INSERT OR UPDATE OR DELETE ON vaccines
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- Atualizar updated_at automaticamente (reaproveita função existente)
CREATE TRIGGER vaccines_updated_at
  BEFORE UPDATE ON vaccines
  FOR EACH ROW EXECUTE FUNCTION trg_clinical_encounters_updated_at();

CREATE TRIGGER vaccine_protocols_updated_at
  BEFORE UPDATE ON vaccine_protocols
  FOR EACH ROW EXECUTE FUNCTION trg_clinical_encounters_updated_at();


-- Seeds básicos: protocolos default por espécie (todos com tenant_id=NULL = global)
INSERT INTO vaccine_protocols (tenant_id, species, name, description, doses) VALUES
  (NULL, 'dog', 'V8 / V10 (cães)',
   'Múltipla canina contra cinomose, parvovirose, hepatite, leptospirose e outros.',
   '[
      {"label":"1ª dose","age_min_days":45,"age_max_days":60},
      {"label":"2ª dose","age_min_days":75,"age_max_days":90},
      {"label":"3ª dose","age_min_days":105,"age_max_days":120},
      {"label":"Reforço anual","age_min_days":365,"age_max_days":730}
    ]'::jsonb),
  (NULL, 'dog', 'Antirrábica (cães)',
   'Vacina antirrábica anual.',
   '[
      {"label":"1ª dose","age_min_days":120,"age_max_days":150},
      {"label":"Reforço anual","age_min_days":365,"age_max_days":730}
    ]'::jsonb),
  (NULL, 'cat', 'Tríplice/Quádrupla felina',
   'Múltipla felina contra panleucopenia, calicivirose, rinotraqueíte e outros.',
   '[
      {"label":"1ª dose","age_min_days":60,"age_max_days":75},
      {"label":"2ª dose","age_min_days":90,"age_max_days":105},
      {"label":"Reforço anual","age_min_days":365,"age_max_days":730}
    ]'::jsonb),
  (NULL, 'cat', 'Antirrábica (gatos)',
   'Vacina antirrábica anual.',
   '[
      {"label":"1ª dose","age_min_days":120,"age_max_days":150},
      {"label":"Reforço anual","age_min_days":365,"age_max_days":730}
    ]'::jsonb)
ON CONFLICT DO NOTHING;
