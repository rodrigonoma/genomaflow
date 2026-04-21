ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS file_type TEXT
    CHECK (file_type IN ('pdf', 'dicom', 'image', 'unknown'))
    DEFAULT 'pdf';

ALTER TABLE clinical_results
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
