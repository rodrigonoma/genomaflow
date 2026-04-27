-- Migration 055: audit_log genérico + função de trigger reutilizável
--
-- Captura toda mutação (INSERT/UPDATE/DELETE) em tabelas auditadas com:
--  - actor_user_id (de current_setting('app.user_id'))
--  - actor_channel (ui|copilot|system|worker, default 'ui')
--  - tenant_id (já existe na linha)
--  - old_data + new_data (jsonb completos)
--  - changed_fields (diff dos campos pra UPDATEs)
--
-- Triggers serão habilitados em fases (esta migration só cria a fundação).

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,                   -- 'appointments', 'subjects', etc.
  entity_id UUID NOT NULL,                     -- PK da row alterada
  action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  actor_user_id UUID,                          -- pode ser NULL (jobs do sistema/worker)
  actor_channel TEXT NOT NULL DEFAULT 'ui'
    CHECK (actor_channel IN ('ui', 'copilot', 'system', 'worker')),
  old_data JSONB,                              -- to_jsonb(OLD) em UPDATE/DELETE
  new_data JSONB,                              -- to_jsonb(NEW) em INSERT/UPDATE
  changed_fields TEXT[],                       -- diff pra UPDATE; vazio em INSERT/DELETE
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes pra queries comuns no painel master
CREATE INDEX IF NOT EXISTS audit_log_tenant_created_idx
  ON audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON audit_log (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_channel_idx
  ON audit_log (actor_channel, created_at DESC);

-- RLS: tenant isolation. Master panel reads cross-tenant via session sem app.tenant_id (NULLIF pattern).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_tenant ON audit_log
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- audit_log é APPEND-ONLY: nenhum role pode UPDATE ou DELETE.
-- (Compliance: registros de auditoria devem ser imutáveis.)
-- INSERT é via trigger SECURITY DEFINER, então o role da app pode inserir
-- mesmo sem GRANT INSERT direto.
GRANT SELECT ON audit_log TO genomaflow_app;
-- Sem GRANT INSERT/UPDATE/DELETE: tudo via trigger.

-- ── Função genérica de trigger ─────────────────────────────────────
-- Reutilizável pra qualquer tabela com colunas: id (UUID) e tenant_id (UUID).
-- Roda como SECURITY DEFINER pra inserir em audit_log mesmo sem GRANT INSERT
-- pro role da app.

CREATE OR REPLACE FUNCTION audit_trigger_fn() RETURNS TRIGGER AS $$
DECLARE
  v_actor_user_id UUID;
  v_actor_channel TEXT;
  v_tenant_id UUID;
  v_entity_id UUID;
  v_old JSONB;
  v_new JSONB;
  v_changed TEXT[];
  v_action TEXT;
BEGIN
  -- Capta session vars (silently default se não setadas)
  v_actor_user_id := NULLIF(current_setting('app.user_id', true), '')::UUID;
  v_actor_channel := COALESCE(NULLIF(current_setting('app.actor_channel', true), ''), 'ui');

  -- Determina action + payload conforme tipo do trigger
  IF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_tenant_id := OLD.tenant_id;
    v_entity_id := OLD.id;
    v_old := to_jsonb(OLD);
    v_new := NULL;
    v_changed := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_action := 'insert';
    v_tenant_id := NEW.tenant_id;
    v_entity_id := NEW.id;
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_changed := NULL;
  ELSE -- UPDATE
    v_action := 'update';
    v_tenant_id := NEW.tenant_id;
    v_entity_id := NEW.id;
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    -- Diff: campos cuja key→value mudou entre OLD e NEW
    SELECT ARRAY_AGG(key)
      INTO v_changed
      FROM jsonb_each(v_new) n
      WHERE NOT (v_old ? key) OR v_old -> key IS DISTINCT FROM n.value;
    -- Se nada mudou (UPDATE no-op), skip pra não poluir log
    IF v_changed IS NULL OR array_length(v_changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO audit_log
    (tenant_id, entity_type, entity_id, action,
     actor_user_id, actor_channel,
     old_data, new_data, changed_fields)
  VALUES
    (v_tenant_id, TG_TABLE_NAME, v_entity_id, v_action,
     v_actor_user_id, v_actor_channel,
     v_old, v_new, v_changed);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A função roda como o owner (postgres). genomaflow_app pode chamar via trigger.
GRANT EXECUTE ON FUNCTION audit_trigger_fn() TO genomaflow_app;
