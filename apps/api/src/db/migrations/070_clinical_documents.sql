-- 070_clinical_documents.sql
-- Fase 2: documentos clínicos com templates por tenant.
-- Tipos: atestado, pedido_exame, encaminhamento, relatorio, termo_consentimento.
-- Multi-módulo: humano usa principalmente atestado/pedido_exame/encaminhamento;
-- vet usa principalmente relatorio/termo_consentimento (ex: termo de eutanásia).
-- Mesma tabela serve aos dois — diferenciação por subject (subject_type).

-- Templates reutilizáveis por clínica
CREATE TABLE IF NOT EXISTS clinical_document_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN
    ('atestado','pedido_exame','encaminhamento','relatorio','termo_consentimento')),
  name TEXT NOT NULL,
  body TEXT NOT NULL,  -- markdown/HTML simples; placeholders {{patient_name}}, {{date}}, {{doctor_name}}, {{crm}}
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Documentos emitidos (1 row por documento gerado)
CREATE TABLE IF NOT EXISTS clinical_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  professional_user_id UUID NOT NULL REFERENCES users(id),
  encounter_id UUID REFERENCES clinical_encounters(id) ON DELETE SET NULL,

  doc_type TEXT NOT NULL CHECK (doc_type IN
    ('atestado','pedido_exame','encaminhamento','relatorio','termo_consentimento')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  template_id UUID REFERENCES clinical_document_templates(id) ON DELETE SET NULL,

  -- PDF gerado client-side via jsPDF + opcionalmente subido pra S3
  pdf_s3_key TEXT,

  -- Imutabilidade após assinatura digital
  signed_at TIMESTAMPTZ,
  signed_by_user_id UUID REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clinical_documents_tenant_subject_created
  ON clinical_documents(tenant_id, subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinical_documents_tenant_type
  ON clinical_documents(tenant_id, doc_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinical_documents_encounter
  ON clinical_documents(encounter_id) WHERE encounter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clinical_document_templates_tenant_type
  ON clinical_document_templates(tenant_id, doc_type) WHERE active = TRUE;


-- RLS NULLIF
ALTER TABLE clinical_document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_document_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY clinical_document_templates_select ON clinical_document_templates
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY clinical_document_templates_insert ON clinical_document_templates
  FOR INSERT WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY clinical_document_templates_update ON clinical_document_templates
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY clinical_document_templates_delete ON clinical_document_templates
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY clinical_documents_select ON clinical_documents
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY clinical_documents_insert ON clinical_documents
  FOR INSERT WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY clinical_documents_update ON clinical_documents
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY clinical_documents_delete ON clinical_documents
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );


-- Audit trigger (documento clínico = LGPD/forense)
CREATE TRIGGER audit_clinical_documents
  AFTER INSERT OR UPDATE OR DELETE ON clinical_documents
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- Triggers updated_at
CREATE TRIGGER clinical_document_templates_updated_at
  BEFORE UPDATE ON clinical_document_templates
  FOR EACH ROW EXECUTE FUNCTION trg_clinical_encounters_updated_at();

CREATE TRIGGER clinical_documents_updated_at
  BEFORE UPDATE ON clinical_documents
  FOR EACH ROW EXECUTE FUNCTION trg_clinical_encounters_updated_at();
