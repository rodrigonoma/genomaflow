ALTER TABLE chat_embeddings DROP CONSTRAINT IF EXISTS chat_embeddings_chunk_type_check;
ALTER TABLE chat_embeddings ADD CONSTRAINT chat_embeddings_chunk_type_check
  CHECK (chunk_type IN ('interpretation','alert','recommendation','patient_profile','aggregate_stats'));
