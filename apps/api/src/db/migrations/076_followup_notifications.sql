-- 076_followup_notifications.sql
-- Phase 4.2: Follow-up automatizado pós-consulta, pós-exame com alerta,
-- e lembrete de próxima dose de vacina.
--
-- Adiciona 3 tipos novos a scheduled_notifications:
--   - post_consultation_followup: 7d após encounter completed com prescription
--   - exam_alert_followup:        30d após exam done com alerta high/critical
--   - vaccine_dose_reminder:      T-7d e T-1d antes de next_dose_date
--
-- Idempotência via UNIQUE INDEX partial — cada follow-up só pode ser criado 1x
-- por par (alvo, hours_before quando aplicável). Re-execução do worker tick não
-- duplica.

-- ── Atualiza CHECK pra incluir novos tipos ─────────────────────────────────
ALTER TABLE scheduled_notifications
  DROP CONSTRAINT IF EXISTS scheduled_notifications_notification_type_check;

ALTER TABLE scheduled_notifications
  ADD CONSTRAINT scheduled_notifications_notification_type_check
  CHECK (notification_type IN (
    'appointment_reminder',
    'vaccine_reminder',
    'vaccine_dose_reminder',
    'nps_request',
    'post_consultation_followup',
    'exam_alert_followup',
    'custom'
  ));

-- ── Coluna exam_id (FK pra exams) ──────────────────────────────────────────
ALTER TABLE scheduled_notifications
  ADD COLUMN IF NOT EXISTS exam_id UUID REFERENCES exams(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_scheduled_notif_exam
  ON scheduled_notifications(exam_id) WHERE exam_id IS NOT NULL;

-- ── UNIQUE INDEXES partial pra idempotência ───────────────────────────────
-- post_consultation_followup: 1 por encounter
CREATE UNIQUE INDEX IF NOT EXISTS uniq_post_consult_followup
  ON scheduled_notifications(encounter_id)
  WHERE notification_type = 'post_consultation_followup'
    AND encounter_id IS NOT NULL
    AND status IN ('pending', 'sent');

-- exam_alert_followup: 1 por exam
CREATE UNIQUE INDEX IF NOT EXISTS uniq_exam_alert_followup
  ON scheduled_notifications(exam_id)
  WHERE notification_type = 'exam_alert_followup'
    AND exam_id IS NOT NULL
    AND status IN ('pending', 'sent');

-- vaccine_dose_reminder: 1 por (vaccine_id, hours_before)
-- (T-7d = 168h e T-1d = 24h são valores típicos)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_vaccine_dose_reminder
  ON scheduled_notifications(vaccine_id, hours_before)
  WHERE notification_type = 'vaccine_dose_reminder'
    AND vaccine_id IS NOT NULL
    AND hours_before IS NOT NULL
    AND status IN ('pending', 'sent');

-- ── Notification preferences: opt-in granular ─────────────────────────────
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS post_consultation_followup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS post_consultation_followup_days INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS exam_alert_followup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS exam_alert_followup_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS vaccine_dose_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS vaccine_dose_reminder_hours_before INTEGER[] NOT NULL DEFAULT ARRAY[168, 24];
