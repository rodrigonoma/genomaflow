-- 074_scheduled_notifications_idempotency.sql
-- Phase 3 hotfix: idempotência baseada em (appointment_id, hours_before)
-- em vez de janela de 60s do scheduled_for (que falhava quando código
-- recomputava scheduled_for=now pra reminders cujo T-h já passou).
--
-- Bug 2026-05-05: reminder gerava duplicata cada tick enquanto status=pending,
-- porque scheduled_for variava (recomputação pra now). User recebeu mesma
-- mensagem 3x.
--
-- Fix: coluna hours_before + UNIQUE INDEX partial em (appointment_id,
-- hours_before) pra rows do tipo appointment_reminder.

ALTER TABLE scheduled_notifications
  ADD COLUMN IF NOT EXISTS hours_before INTEGER;

-- Backfill best-effort: calcula hours_before pra rows existentes baseado
-- na diferença entre appointment.start_at e scheduled_for. Pros que não
-- conseguir calcular (appointment deletado, status já cancelado, etc.),
-- deixa NULL.
UPDATE scheduled_notifications sn
SET hours_before = ROUND(EXTRACT(EPOCH FROM (a.start_at - sn.scheduled_for)) / 3600)::INT
FROM appointments a
WHERE sn.appointment_id = a.id
  AND sn.notification_type = 'appointment_reminder'
  AND sn.hours_before IS NULL;

-- Antes de criar UNIQUE INDEX, descancela duplicatas (manter só a mais
-- recente por (appointment_id, hours_before)). Status='cancelled' nas
-- duplicatas mais antigas pra histórico.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY appointment_id, hours_before
           ORDER BY created_at DESC
         ) AS rn
  FROM scheduled_notifications
  WHERE notification_type = 'appointment_reminder'
    AND appointment_id IS NOT NULL
    AND hours_before IS NOT NULL
)
UPDATE scheduled_notifications sn
SET status = 'cancelled',
    error_message = COALESCE(sn.error_message || ' | ', '') || 'duplicata removida pela migration 074'
FROM ranked r
WHERE sn.id = r.id AND r.rn > 1 AND sn.status IN ('pending', 'sent');

-- UNIQUE INDEX partial — só aplica em appointment_reminder ATIVO
-- (status IN pending/sent). Cancelled/failed NÃO conta — preserva histórico
-- de duplicatas que foram cancelled pela query acima sem violar a constraint.
-- Permite também recriar reminder se appointment foi reagendado após
-- cancelamento prévio.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_appt_reminder_hours
  ON scheduled_notifications(appointment_id, hours_before)
  WHERE notification_type = 'appointment_reminder'
    AND appointment_id IS NOT NULL
    AND hours_before IS NOT NULL
    AND status IN ('pending', 'sent');
