-- Migration 057: estende audit_trigger_fn pra mais tabelas críticas
-- subjects, prescriptions, exams.
-- Idempotente.

DROP TRIGGER IF EXISTS audit_subjects ON subjects;
CREATE TRIGGER audit_subjects
  AFTER INSERT OR UPDATE OR DELETE ON subjects
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_prescriptions ON prescriptions;
CREATE TRIGGER audit_prescriptions
  AFTER INSERT OR UPDATE OR DELETE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_exams ON exams;
CREATE TRIGGER audit_exams
  AFTER INSERT OR UPDATE OR DELETE ON exams
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
