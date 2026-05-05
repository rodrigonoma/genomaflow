-- 068_appointments_appointment_type.sql
-- Fase 1: tipo de agendamento estruturado.
--
-- Decisão de schema (revisada 2026-05-05):
-- A coluna `user_id` já é o profissional dono do slot (single-doctor V1).
-- Pra Fase 1 multi-profissional, NÃO adicionamos professional_user_id —
-- seria duplicação. Apenas:
--   1. ADD `appointment_type` enum textual (consulta/retorno/vacina/...)
--   2. Backend ramifica filtro: GET /appointments?professional_id=X
--      (default = self pra profissional, todos pra admin)
--   3. EXCLUDE constraint atual já particiona por user_id — multi-prof
--      fica isolado automaticamente (cada profissional tem sua agenda
--      sem conflito cross-prof).
--
-- 'banho_tosa' incluído como tipo (Fase 1 atende sem módulo dedicado;
-- pacotes/comissão por banhista ficam em fase futura).

-- Adiciona coluna nullable (zero risco de regressão em INSERTs existentes)
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS appointment_type TEXT;

-- Backfill: rows existentes ficam com 'consulta' como default semântico
UPDATE appointments
  SET appointment_type = CASE
    WHEN status = 'blocked' THEN 'outro'
    ELSE 'consulta'
  END
  WHERE appointment_type IS NULL;

-- NOT NULL + CHECK constraint
ALTER TABLE appointments
  ALTER COLUMN appointment_type SET NOT NULL;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_appointment_type_check CHECK (
    appointment_type IN (
      'consulta', 'retorno', 'vacina', 'procedimento',
      'banho_tosa', 'telemedicina', 'exame', 'outro'
    )
  );

-- Index novo: agenda por profissional + tipo (admin filtrar "só vacinas hoje")
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_user_type_start
  ON appointments(tenant_id, user_id, appointment_type, start_at);
