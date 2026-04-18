-- apps/api/src/db/migrations/025_chat_embeddings.sql
CREATE TABLE IF NOT EXISTS chat_embeddings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id   UUID REFERENCES subjects(id) ON DELETE CASCADE,
  exam_id      UUID REFERENCES exams(id) ON DELETE CASCADE,
  result_id    UUID REFERENCES clinical_results(id) ON DELETE CASCADE,
  chunk_type   TEXT NOT NULL CHECK (chunk_type IN ('interpretation','alert','recommendation','patient_profile')),
  content      TEXT NOT NULL,
  content_tsv  TSVECTOR,
  embedding    vector(1536) NOT NULL,
  source_label TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW: melhor para dados dinâmicos (insertions frequentes)
CREATE INDEX IF NOT EXISTS chat_embeddings_hnsw_idx
  ON chat_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- IVFFlat: alternativo, partições menores
CREATE INDEX IF NOT EXISTS chat_embeddings_ivfflat_idx
  ON chat_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- GIN: busca léxica BM25
CREATE INDEX IF NOT EXISTS chat_embeddings_tsv_idx
  ON chat_embeddings USING gin (content_tsv);

-- Filtro rápido por tenant
CREATE INDEX IF NOT EXISTS chat_embeddings_tenant_idx
  ON chat_embeddings (tenant_id);

-- Row Level Security (tenant isolation)
ALTER TABLE chat_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_embeddings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON chat_embeddings
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_write ON chat_embeddings
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_update ON chat_embeddings
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_delete ON chat_embeddings
  FOR DELETE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Composite index for subject-scoped queries (e.g. DELETE patient_profile by subject)
CREATE INDEX IF NOT EXISTS chat_embeddings_tenant_subject_idx
  ON chat_embeddings (tenant_id, subject_id);

-- Grant access to app user
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_embeddings TO genomaflow_app;
