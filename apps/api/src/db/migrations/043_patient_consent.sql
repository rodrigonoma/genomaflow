-- Migration 043: registro de consentimento LGPD do paciente
-- Clínica é a controladora dos dados do paciente. Este flag apenas registra
-- no sistema que o consentimento por escrito foi obtido (via formulário físico
-- assinado pelo paciente/responsável). A guarda do documento físico é
-- responsabilidade da clínica.

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMPTZ;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS consent_given_by UUID REFERENCES users(id);
