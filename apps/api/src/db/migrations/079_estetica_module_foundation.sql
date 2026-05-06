-- 079_estetica_module_foundation.sql
-- Phase F1: Foundation pra módulo de Estética.
-- Spec: docs/superpowers/specs/2026-05-05-aesthetic-clinic-module-design.md
--
-- Tudo additive. Zero break em human/veterinary:
-- - Estende CHECK de tenants.module pra incluir 'estetica'
-- - Adiciona users.professional_type com backfill 'medico' pros existentes
-- - Adiciona subjects.fitzpatrick_type, subjects.skin_concerns (NULL pra human/vet)
-- - Estende CHECK de appointments.appointment_type e clinical_encounters.encounter_type

-- ── tenants.module: estende enum ──────────────────────────────────────────
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_module_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_module_check
  CHECK (module IN ('human','veterinary','estetica'));

-- ── users.professional_type: gate de features (prescription só medico/dentista) ──
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS professional_type TEXT
  CHECK (professional_type IN ('medico','esteticista','dentista','biomedico','outro'));

-- Backfill: usuários existentes (human/vet) viram 'medico' (sem mudar comportamento)
UPDATE users SET professional_type = 'medico' WHERE professional_type IS NULL;

ALTER TABLE users
  ALTER COLUMN professional_type SET NOT NULL,
  ALTER COLUMN professional_type SET DEFAULT 'medico';

-- ── subjects: campos estéticos opcionais ──────────────────────────────────
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS fitzpatrick_type INTEGER
    CHECK (fitzpatrick_type BETWEEN 1 AND 6);
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS skin_concerns JSONB DEFAULT '[]'::jsonb;

-- ── appointments.appointment_type: estende enum ───────────────────────────
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_appointment_type_check;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_appointment_type_check
  CHECK (appointment_type IN (
    'consulta','retorno','exame','procedimento','telemedicina','banho_tosa',
    'avaliacao_estetica','procedimento_estetico','retorno_estetica',
    'outro'
  ));

-- ── clinical_encounters.encounter_type: estende enum ──────────────────────
ALTER TABLE clinical_encounters
  DROP CONSTRAINT IF EXISTS clinical_encounters_encounter_type_check;
ALTER TABLE clinical_encounters
  ADD CONSTRAINT clinical_encounters_encounter_type_check
  CHECK (encounter_type IN (
    'consulta','retorno','evolucao','procedimento','telemedicina',
    'avaliacao_estetica','pos_procedimento',
    'outro'
  ));
