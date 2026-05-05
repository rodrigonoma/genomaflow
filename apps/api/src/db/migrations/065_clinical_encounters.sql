-- 065_clinical_encounters.sql
-- Fase 1 do PMS expansion: registro estruturado de consulta/evolução clínica.
-- Universal pra humano + vet com colunas opcionais por módulo.
-- Vincula opcionalmente a um appointment (slot agendado).

CREATE TABLE IF NOT EXISTS clinical_encounters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  professional_user_id UUID NOT NULL REFERENCES users(id),
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,

  -- Tipo do encontro: consulta inicial, retorno, evolução, procedimento, telemedicina, outro
  encounter_type TEXT NOT NULL DEFAULT 'consulta'
    CHECK (encounter_type IN ('consulta','retorno','evolucao','procedimento','telemedicina','outro')),

  -- Conteúdo clínico universal (humano + vet)
  chief_complaint TEXT,        -- queixa principal
  anamnesis TEXT,              -- história clínica (vet) / HDA (humano)
  physical_exam TEXT,          -- exame físico
  hypothesis TEXT,             -- hipótese / suspeita diagnóstica
  conduct TEXT,                -- conduta tomada
  return_recommendation TEXT,  -- "retornar em 7 dias"

  -- Campos humano-only (NULL pra vet)
  medical_history TEXT,        -- antecedentes pessoais/familiares
  medications_in_use TEXT,     -- medicamentos em uso
  allergies TEXT,              -- alergias (texto livre, complementa o subjects.allergies_text)

  -- Anexos: lista pequena com S3 keys
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Imutabilidade
  signed_at TIMESTAMPTZ,                                       -- assinado = imutável
  signed_by_user_id UUID REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
-- Index principal: timeline do paciente (mais comum)
CREATE INDEX IF NOT EXISTS idx_encounters_tenant_subject_created
  ON clinical_encounters(tenant_id, subject_id, created_at DESC, id DESC);

-- Index secundário: agenda do profissional (encontros do profissional)
CREATE INDEX IF NOT EXISTS idx_encounters_tenant_professional_created
  ON clinical_encounters(tenant_id, professional_user_id, created_at DESC);

-- Index pra ligação com appointment (pra abrir consulta a partir do slot)
CREATE INDEX IF NOT EXISTS idx_encounters_appointment
  ON clinical_encounters(appointment_id) WHERE appointment_id IS NOT NULL;


-- Sinais vitais (1:1 com encounter, separado pra normalizar e facilitar
-- gráfico longitudinal de marcadores no futuro)
CREATE TABLE IF NOT EXISTS vital_signs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  encounter_id UUID NOT NULL UNIQUE REFERENCES clinical_encounters(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,

  -- Universal humano + vet
  weight_kg NUMERIC(6,2),
  temperature_c NUMERIC(4,1),
  heart_rate_bpm INTEGER,
  respiratory_rate_rpm INTEGER,
  pain_score SMALLINT CHECK (pain_score IS NULL OR pain_score BETWEEN 0 AND 10),

  -- Humano-only
  blood_pressure_systolic INTEGER,
  blood_pressure_diastolic INTEGER,

  -- Vet-only
  hydration TEXT
    CHECK (hydration IS NULL OR hydration IN ('normal','leve','moderada','severa')),
  mucosa TEXT
    CHECK (mucosa IS NULL OR mucosa IN ('normocoradas','hipocoradas','cianoticas','ictericas','congestas')),

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pra busca de sinais vitais por subject (gráfico longitudinal de peso, etc.)
CREATE INDEX IF NOT EXISTS idx_vital_signs_tenant_subject_created
  ON vital_signs(tenant_id, subject_id, created_at DESC);


-- RLS — segue padrão NULLIF (master sem contexto vê tudo; tenant scoped no resto)
ALTER TABLE clinical_encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_encounters FORCE ROW LEVEL SECURITY;
ALTER TABLE vital_signs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vital_signs FORCE ROW LEVEL SECURITY;

CREATE POLICY clinical_encounters_select ON clinical_encounters
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY clinical_encounters_insert ON clinical_encounters
  FOR INSERT WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY clinical_encounters_update ON clinical_encounters
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ) WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY clinical_encounters_delete ON clinical_encounters
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY vital_signs_select ON vital_signs
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY vital_signs_insert ON vital_signs
  FOR INSERT WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY vital_signs_update ON vital_signs
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY vital_signs_delete ON vital_signs
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );


-- Audit trigger (LGPD + compliance médico — evolução clínica é dado sensível)
CREATE TRIGGER audit_clinical_encounters
  AFTER INSERT OR UPDATE OR DELETE ON clinical_encounters
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_vital_signs
  AFTER INSERT OR UPDATE OR DELETE ON vital_signs
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();


-- Trigger pra atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION trg_clinical_encounters_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinical_encounters_updated_at
  BEFORE UPDATE ON clinical_encounters
  FOR EACH ROW EXECUTE FUNCTION trg_clinical_encounters_updated_at();
