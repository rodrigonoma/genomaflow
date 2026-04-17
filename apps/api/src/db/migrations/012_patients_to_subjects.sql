ALTER TABLE patients RENAME TO subjects;

ALTER TABLE subjects
  ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'human'
    CHECK (subject_type IN ('human', 'animal')),
  ADD COLUMN species TEXT,
  ADD COLUMN owner_cpf_hash TEXT;

ALTER TABLE exams RENAME COLUMN patient_id TO subject_id;
