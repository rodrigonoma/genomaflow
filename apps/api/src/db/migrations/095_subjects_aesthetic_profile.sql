-- 095_subjects_aesthetic_profile.sql
-- Adiciona aesthetic_profile JSONB em subjects pra perfil antropométrico/nutricional
-- usado por F4 (nutrição) do módulo estética.
-- Aditivo: nullable + DEFAULT '{}' — zero impacto em queries multi-módulo existentes.
-- Schema esperado do JSONB (validado na camada de aplicação):
--   {
--     height_cm: number (140-220),
--     weight_kg: number (35-200),
--     age: number (12-100),
--     sex: 'F' | 'M',
--     activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active',
--     goals: string[] (max 5, ex: 'fat_loss','tone','wellness'),
--     allergies: string[] (max 20),
--     medical_conditions: string[] (max 20),
--     dietary_restrictions: string[] (max 10, ex: 'vegetarian','vegan','lactose','gluten'),
--     updated_at: ISO date string
--   }
-- Spec §4.6, §17 F4.

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS aesthetic_profile JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Index parcial pra acesso rápido só quando preenchido (não-vazio)
CREATE INDEX IF NOT EXISTS idx_subjects_aesthetic_profile_filled
  ON subjects ((aesthetic_profile != '{}'::jsonb))
  WHERE aesthetic_profile != '{}'::jsonb;
