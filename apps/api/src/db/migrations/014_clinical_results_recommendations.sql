ALTER TABLE clinical_results
  ADD COLUMN recommendations JSONB NOT NULL DEFAULT '[]';
