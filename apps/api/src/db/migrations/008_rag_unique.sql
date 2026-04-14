ALTER TABLE rag_documents ADD CONSTRAINT rag_documents_source_title_unique UNIQUE (source, title);
