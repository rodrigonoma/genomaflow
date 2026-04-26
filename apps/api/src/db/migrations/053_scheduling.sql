-- Migration 053: Agendamento de exames/consultas
-- Spec: docs/superpowers/specs/2026-04-26-scheduling-design.md
-- Tabelas: schedule_settings (1:1 com user) + appointments (eventos)
-- Garantia DB: EXCLUDE constraint impede agendamentos sobrepostos do mesmo médico

-- Extension necessária pra EXCLUDE multi-coluna (btree + gist)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Função wrapper IMMUTABLE pro range do appointment.
-- `timestamptz + interval` é STABLE (depende de TZ pra DST), e EXCLUDE/index
-- exigem expressão IMMUTABLE. Pra "minutos exatos" o resultado é determinístico
-- independente de TZ, então marcamos IMMUTABLE com segurança. Servidor sempre UTC.
CREATE OR REPLACE FUNCTION appointment_range(p_start timestamptz, p_minutes int)
RETURNS tstzrange LANGUAGE sql IMMUTABLE AS $$
  SELECT tstzrange(p_start, p_start + (p_minutes || ' minutes')::interval, '[)');
$$;

-- Timezone da clínica (UTC → local time na render). IANA string.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- ── schedule_settings ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  default_slot_minutes INT NOT NULL DEFAULT 30
    CHECK (default_slot_minutes IN (30, 45, 60, 75, 90, 105, 120)),
  business_hours JSONB NOT NULL DEFAULT '{
    "mon": [["09:00","12:00"],["14:00","18:00"]],
    "tue": [["09:00","12:00"],["14:00","18:00"]],
    "wed": [["09:00","12:00"],["14:00","18:00"]],
    "thu": [["09:00","12:00"],["14:00","18:00"]],
    "fri": [["09:00","12:00"],["14:00","18:00"]],
    "sat": [],
    "sun": []
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE schedule_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY schedule_settings_tenant ON schedule_settings
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- ── appointments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  series_id UUID,
  start_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  status TEXT NOT NULL CHECK (status IN (
    'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'blocked'
  )),
  reason TEXT,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,

  -- Não-sobreposição garantida no DB (race-condition-proof)
  -- cancelled e no_show liberam o slot
  EXCLUDE USING gist (
    user_id WITH =,
    appointment_range(start_at, duration_minutes) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'))
);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;

CREATE POLICY appointments_tenant ON appointments
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- Índices
CREATE INDEX IF NOT EXISTS appointments_user_start_idx
  ON appointments (user_id, start_at)
  WHERE status NOT IN ('cancelled', 'no_show');

CREATE INDEX IF NOT EXISTS appointments_tenant_idx
  ON appointments (tenant_id);

CREATE INDEX IF NOT EXISTS appointments_subject_idx
  ON appointments (subject_id) WHERE subject_id IS NOT NULL;

-- Grants pro role da aplicação
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_settings TO genomaflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON appointments TO genomaflow_app;
