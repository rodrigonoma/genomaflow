ALTER TABLE rag_documents
  ADD COLUMN module TEXT NOT NULL DEFAULT 'human'
    CHECK (module IN ('human', 'veterinary', 'both')),
  ADD COLUMN species TEXT;

CREATE INDEX ON rag_documents (module, species);
