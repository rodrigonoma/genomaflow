-- 072_notifications_and_portal.sql
-- Fase 3: WhatsApp + lembretes + portal do tutor/paciente.
-- Spec: docs/superpowers/specs/2026-05-05-clinical-pms-expansion-design.md
--
-- Decisões tomadas:
-- - Provider WhatsApp = Z-API (mais barato). Mock em dev via ZAPI_MOCK=1
-- - Lembretes T-24h e T-2h por padrão (configurável por tenant)
-- - Token portal = 32 hex random, TTL 90 dias, scope subject_id OU owner_id
-- - whatsapp_messages = log de envio + recebimento (rastreabilidade + dedup)

-- ── Notification preferences (1 linha por tenant) ─────────────────────────
CREATE TABLE IF NOT EXISTS notification_preferences (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

  -- Lembretes de agendamento
  appointment_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reminder_hours_before INTEGER[] NOT NULL DEFAULT ARRAY[24, 2],
  reminder_via TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (reminder_via IN ('whatsapp','email','both')),

  -- Janela permitida pra envio (formato HH:MM, fuso do tenant)
  send_window_start TEXT NOT NULL DEFAULT '08:00',
  send_window_end TEXT NOT NULL DEFAULT '20:00',

  -- NPS automático pós-encontro
  nps_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  nps_via TEXT NOT NULL DEFAULT 'email' CHECK (nps_via IN ('email','whatsapp')),
  nps_delay_hours INTEGER NOT NULL DEFAULT 4,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Notificações agendadas (BullMQ-backed) ────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Tipo + alvo
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('appointment_reminder','vaccine_reminder','nps_request','custom')),
  appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
  vaccine_id UUID REFERENCES vaccines(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES clinical_encounters(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,

  -- Canal e destino
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email','sms')),
  send_to TEXT NOT NULL,  -- phone E.164 ou email
  body TEXT NOT NULL,     -- mensagem renderizada (placeholders já substituídos)

  -- Timing
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','cancelled')),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_notif_pending
  ON scheduled_notifications(scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_scheduled_notif_appointment
  ON scheduled_notifications(appointment_id) WHERE appointment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_notif_tenant_type
  ON scheduled_notifications(tenant_id, notification_type, scheduled_for DESC);


-- ── Log de mensagens WhatsApp (envio + recebimento) ───────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Direção
  direction TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),

  -- Identificação Z-API
  zapi_message_id TEXT,  -- pode ser NULL no momento do INSERT, atualizado pós-envio
  phone_e164 TEXT NOT NULL,  -- número (ex: 5511999999999)

  -- Conteúdo
  body TEXT NOT NULL,
  media_url TEXT,
  message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text','image','audio','video','document','location','interactive')),

  -- Vínculo opcional
  scheduled_notification_id UUID REFERENCES scheduled_notifications(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,

  -- Status (pra outbound)
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','delivered','read','failed','received')),
  error_message TEXT,

  -- Processamento (pra inbound — confirmação 1/2)
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processed_action TEXT,  -- 'confirmed', 'cancelled', 'unrecognized'

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_tenant_phone_created
  ON whatsapp_messages(tenant_id, phone_e164, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_zapi_id
  ON whatsapp_messages(zapi_message_id) WHERE zapi_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_unprocessed
  ON whatsapp_messages(created_at)
  WHERE direction = 'inbound' AND processed = FALSE;


-- ── Portal tokens (acesso público read-only) ──────────────────────────────
CREATE TABLE IF NOT EXISTS portal_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Scope: subject (paciente humano) OU owner (tutor vet com múltiplos animais)
  -- XOR via CHECK constraint
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES owners(id) ON DELETE CASCADE,
  CONSTRAINT portal_tokens_scope_xor CHECK (
    (subject_id IS NOT NULL AND owner_id IS NULL) OR
    (subject_id IS NULL AND owner_id IS NOT NULL)
  ),

  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,

  -- Auditoria
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_portal_tokens_tenant_active
  ON portal_tokens(tenant_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_portal_tokens_subject
  ON portal_tokens(subject_id) WHERE subject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_portal_tokens_owner
  ON portal_tokens(owner_id) WHERE owner_id IS NOT NULL;


-- ── RLS NULLIF padrão ────────────────────────────────────────────────────
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE scheduled_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_tokens FORCE ROW LEVEL SECURITY;

-- notification_preferences
CREATE POLICY notif_pref_select ON notification_preferences
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY notif_pref_insert ON notification_preferences
  FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY notif_pref_update ON notification_preferences
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY notif_pref_delete ON notification_preferences
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- scheduled_notifications (worker precisa SELECT/UPDATE sem context — NULL OK)
CREATE POLICY sched_notif_select ON scheduled_notifications
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY sched_notif_insert ON scheduled_notifications
  FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sched_notif_update ON scheduled_notifications
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY sched_notif_delete ON scheduled_notifications
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- whatsapp_messages (webhook inbound entra sem context — NULL OK)
CREATE POLICY wa_msg_select ON whatsapp_messages
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY wa_msg_insert ON whatsapp_messages
  FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY wa_msg_update ON whatsapp_messages
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- portal_tokens (rota /portal/:token entra sem context — NULL OK)
CREATE POLICY portal_token_select ON portal_tokens
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY portal_token_insert ON portal_tokens
  FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY portal_token_update ON portal_tokens
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY portal_token_delete ON portal_tokens
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );


-- ── Audit triggers (notificações + WhatsApp são compliance-relevant) ─────
CREATE TRIGGER audit_scheduled_notifications
  AFTER INSERT OR UPDATE OR DELETE ON scheduled_notifications
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_portal_tokens
  AFTER INSERT OR UPDATE OR DELETE ON portal_tokens
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- whatsapp_messages NÃO tem audit trigger (volume alto, conteúdo já no row)


-- updated_at
CREATE TRIGGER notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION trg_clinical_encounters_updated_at();
