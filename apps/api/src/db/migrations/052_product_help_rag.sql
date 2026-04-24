-- Migration 052: Copilot de ajuda de produto — namespace em rag_documents + analytics
--
-- Reutiliza rag_documents com coluna namespace (default 'clinical_guideline'
-- pra backfill dos docs clínicos existentes; novos docs de ajuda usam 'product_help').
--
-- help_questions registra cada pergunta do Copilot pra analytics. Sem dado clínico.

ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS namespace TEXT NOT NULL DEFAULT 'clinical_guideline'
  CHECK (namespace IN ('clinical_guideline', 'product_help'));

-- Backfill: todos os docs existentes são diretrizes clínicas
UPDATE rag_documents SET namespace = 'clinical_guideline' WHERE namespace IS NULL OR namespace = '';

-- Índice pra filtrar namespace nas queries
CREATE INDEX IF NOT EXISTS rag_documents_namespace_idx ON rag_documents(namespace);

-- Tabela de analytics do Copilot
CREATE TABLE IF NOT EXISTS help_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  route TEXT NOT NULL,
  component TEXT,
  user_role TEXT,
  question TEXT NOT NULL,
  answer_preview TEXT,
  tokens_input INT,
  tokens_output INT,
  latency_ms INT,
  was_helpful BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS help_questions_route_idx ON help_questions(route, created_at DESC);
CREATE INDEX IF NOT EXISTS help_questions_tenant_idx ON help_questions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS help_questions_created_idx ON help_questions(created_at DESC);
