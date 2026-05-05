-- 067_owners_observations.sql
-- Fase 1: campo de observações do tutor (aditivo, NULL).

ALTER TABLE owners ADD COLUMN IF NOT EXISTS observations TEXT;
