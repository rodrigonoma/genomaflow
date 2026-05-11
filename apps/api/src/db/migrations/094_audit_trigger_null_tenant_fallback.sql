-- Migration 094: audit_trigger_fn — fallback pra rows com tenant_id NULL
--
-- Context: aesthetic_treatments tem tenant_id NULL pra catálogo global.
-- Quando master faz INSERT/UPDATE/DELETE nessa tabela, o trigger lê NEW.tenant_id
-- que é NULL, mas audit_log.tenant_id é NOT NULL — causaria constraint violation.
--
-- Solução: substituir audit_trigger_fn pra usar MASTER_TENANT_ID
-- ('00000000-0000-0000-0000-000000000001') como fallback quando v_tenant_id IS NULL.
-- Isso mantém o audit trail de operações master no catálogo global sem violar NOT NULL.
--
-- Backward compat: todos os triggers existentes continuam funcionando inalterados
-- (tenant_id de tabelas normais nunca é NULL).

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
  -- Sentinel UUID do tenant master (migration 031)
  MASTER_TENANT UUID := '00000000-0000-0000-0000-000000000001'::uuid;
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

  -- Fallback: catálogo global (tenant_id IS NULL) → atribui ao tenant master
  -- pra não violar NOT NULL de audit_log.tenant_id.
  IF v_tenant_id IS NULL THEN
    v_tenant_id := MASTER_TENANT;
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
