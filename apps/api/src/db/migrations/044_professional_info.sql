-- Migration 044: dados profissionais obrigatórios + declaração de veracidade
-- CRM (médicos) ou CRMV (veterinários). Declaração de veracidade é obrigatória e
-- bloqueia navegação na aplicação enquanto não preenchida (mesmo padrão do aceite de termos).

ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_uf    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_data_confirmed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_data_confirmed_ip TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_data_user_agent   TEXT;
