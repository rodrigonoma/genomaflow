-- Migration 056: habilita audit_trigger_fn em appointments
--
-- Captura toda mutação (INSERT/UPDATE/DELETE) de agendamentos.
-- Atores possíveis:
--   ui      — médico via tela de agenda (drag, click, edit dialog)
--   copilot — via Copilot (chat texto ou voz)
--   system  — jobs internos (não esperado pra agenda no V1)
--
-- Idempotente: drop + recreate caso já exista.

DROP TRIGGER IF EXISTS audit_appointments ON appointments;

CREATE TRIGGER audit_appointments
  AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_fn();
