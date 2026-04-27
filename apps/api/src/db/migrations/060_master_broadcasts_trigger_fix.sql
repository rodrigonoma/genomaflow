-- 060_master_broadcasts_trigger_fix.sql
-- Bug fix descoberto na suite de testes integration: a função
-- enforce_chat_same_module é compartilhada entre tenant_conversations
-- (que tem kind) e tenant_invitations (que não tem). Acessar NEW.kind
-- diretamente faz a função quebrar quando rodada em tenant_invitations
-- com erro "record NEW has no field kind".
--
-- Fix: usar to_jsonb(NEW)->>'kind' que é safe pra colunas ausentes
-- (retorna NULL em vez de jogar). Comportamento preservado:
--   - tenant_conversations com kind=master_broadcast → skip
--   - tenant_invitations sempre → não skipa (NEW.kind via jsonb retorna
--     NULL, não bate com 'master_broadcast', cai no fluxo normal)

CREATE OR REPLACE FUNCTION enforce_chat_same_module() RETURNS trigger AS $$
DECLARE
  module_a TEXT;
  module_b TEXT;
  conv_kind TEXT;
BEGIN
  -- Master broadcasts são cross-module by design — skip a validação.
  -- to_jsonb(NEW)->>'kind' é safe pra tenant_invitations (sem coluna kind).
  IF TG_TABLE_NAME = 'tenant_conversations' THEN
    conv_kind := to_jsonb(NEW) ->> 'kind';
    IF conv_kind = 'master_broadcast' THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'tenant_conversations' THEN
    SELECT module INTO module_a FROM tenants WHERE id = NEW.tenant_a_id;
    SELECT module INTO module_b FROM tenants WHERE id = NEW.tenant_b_id;
  ELSIF TG_TABLE_NAME = 'tenant_invitations' THEN
    SELECT module INTO module_a FROM tenants WHERE id = NEW.from_tenant_id;
    SELECT module INTO module_b FROM tenants WHERE id = NEW.to_tenant_id;
  END IF;

  IF module_a IS NULL OR module_b IS NULL THEN
    RAISE EXCEPTION 'tenant não encontrado ao validar cross-module em %', TG_TABLE_NAME;
  END IF;

  IF module_a <> NEW.module OR module_b <> NEW.module THEN
    RAISE EXCEPTION 'cross-module proibido: tenants devem ser do módulo % (got % e %)',
      NEW.module, module_a, module_b;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
