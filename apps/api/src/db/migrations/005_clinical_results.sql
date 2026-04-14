CREATE TABLE clinical_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  interpretation TEXT NOT NULL,
  risk_scores JSONB NOT NULL DEFAULT '{}',
  alerts JSONB NOT NULL DEFAULT '[]',
  disclaimer TEXT NOT NULL DEFAULT 'Esta análise é um suporte à decisão clínica e não substitui avaliação médica profissional.',
  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
