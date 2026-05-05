-- 071_nps_surveys.sql
-- Fase 2: pesquisa de satisfação NPS pós-encontro.
-- Cliente recebe email com link único (token) e responde sem precisar logar.
-- Score 0-10 + texto livre opcional. TTL 30 dias.
-- Agregação dashboard fica pra Fase 4+ (master panel ou dashboard tenant).

CREATE TABLE IF NOT EXISTS nps_surveys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES clinical_encounters(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,

  -- Token público de resposta (sem auth). 32 chars hex random.
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,

  -- Resposta
  score SMALLINT CHECK (score IS NULL OR (score >= 0 AND score <= 10)),
  feedback TEXT,
  responded_at TIMESTAMPTZ,
  responded_ip TEXT,

  -- Auditoria de envio
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_via TEXT NOT NULL CHECK (sent_via IN ('email','whatsapp','manual')),
  sent_to TEXT NOT NULL,  -- email destinatário ou phone (whatsapp futuro)

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_nps_tenant_responded
  ON nps_surveys(tenant_id, responded_at DESC NULLS LAST, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_nps_subject
  ON nps_surveys(tenant_id, subject_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_nps_token_unresp
  ON nps_surveys(token) WHERE responded_at IS NULL;

-- RLS NULLIF — endpoint público /nps/:token roda SEM contexto de tenant
-- (precisa NULL pra ler). Resposta segue mesmo padrão.
ALTER TABLE nps_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE nps_surveys FORCE ROW LEVEL SECURITY;

CREATE POLICY nps_surveys_select ON nps_surveys
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY nps_surveys_insert ON nps_surveys
  FOR INSERT WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- Update sem context = resposta pública via token (precisa permitir).
-- Endpoint protege via WHERE token = $1 + token único.
CREATE POLICY nps_surveys_update ON nps_surveys
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY nps_surveys_delete ON nps_surveys
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- Audit trigger (NPS = feedback do cliente, vale rastrear quem mudou)
CREATE TRIGGER audit_nps_surveys
  AFTER INSERT OR UPDATE OR DELETE ON nps_surveys
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
