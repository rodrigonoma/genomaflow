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
