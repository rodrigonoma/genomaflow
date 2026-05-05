-- 066_subjects_clinical_extended.sql
-- Fase 1: campos clínicos expandidos em subjects.
-- Aditivo (todas colunas NULL) — zero risco de regressão.
-- Vet: microchip, allergies_text, current_weight_kg, neutered.
-- Humano: birth_date (date estruturada), sex, emergency_contact_name+phone, insurance_name (textual, sem TISS).

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS microchip TEXT;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS allergies_text TEXT;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS current_weight_kg NUMERIC(6,2);
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS neutered BOOLEAN;

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS sex TEXT
  CHECK (sex IS NULL OR sex IN ('M','F','other'));
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS insurance_name TEXT;

-- Index pra busca por microchip (vet usa muito)
CREATE INDEX IF NOT EXISTS idx_subjects_microchip
  ON subjects(microchip) WHERE microchip IS NOT NULL;
