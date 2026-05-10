-- 086_indexes_exams_audit.sql
-- Índices em FKs e drill-down de auditoria.
--
-- Contexto: auditoria 2026-05-10 detectou que `exams.subject_id` (FK) e
-- `exams.uploaded_by` (FK) não tinham índices. Queries em paciente-detail
-- ("listar exames do subject X") e bulk exports faziam seq scan.
--
-- audit_log_entity_idx (migration 055) é compound (entity_type, entity_id,
-- created_at). Quando usuário filtra audit-log por entity_id SEM entity_type
-- (drill-down "todas mudanças no subject X"), o índice composto exige scan de
-- todos os entity_type buckets. Índice adicional em (entity_id, created_at)
-- cobre esse caso.
--
-- CREATE INDEX (não CONCURRENTLY) — migrate.js wrappa migrations em
-- BEGIN/COMMIT, e CONCURRENTLY exige fora de transação. Tabelas pequenas em
-- prod hoje (lock breve aceitável). Para tabelas grandes no futuro, aplicar
-- ad-hoc via psql com CONCURRENTLY.

CREATE INDEX IF NOT EXISTS idx_exams_subject_id
  ON exams (subject_id);

CREATE INDEX IF NOT EXISTS idx_exams_uploaded_by
  ON exams (uploaded_by);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity_id_created
  ON audit_log (entity_id, created_at DESC);
