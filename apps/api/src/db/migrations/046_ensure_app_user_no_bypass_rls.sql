-- Migration 046: CRÍTICO DE SEGURANÇA — defesa em profundidade.
-- Tenta garantir que genomaflow_app NÃO tem BYPASSRLS nem SUPERUSER.
-- Se o usuário que roda migrations não tiver privilégio para alterar,
-- a migration NÃO FALHA — apenas emite NOTICE. A verificação manual
-- em prod é obrigatória nesse caso (ver check abaixo).
--
-- Contexto: incidente 2026-04-23 — usuário novo viu dados de tenant antigo.
-- Defesa em múltiplas camadas: aqui + explicit WHERE tenant_id nas queries + RLS FORCE.

DO $$
DECLARE
  has_bypass BOOLEAN;
  is_super   BOOLEAN;
BEGIN
  SELECT rolbypassrls, rolsuper INTO has_bypass, is_super
    FROM pg_roles WHERE rolname = 'genomaflow_app';

  IF has_bypass IS NULL THEN
    RAISE NOTICE '[046] genomaflow_app role not found — primeira instalação? Ok.';
    RETURN;
  END IF;

  RAISE NOTICE '[046] Estado atual: genomaflow_app BYPASSRLS=%, SUPERUSER=%', has_bypass, is_super;

  IF has_bypass THEN
    BEGIN
      ALTER ROLE genomaflow_app NOBYPASSRLS;
      RAISE NOTICE '[046] Removido BYPASSRLS de genomaflow_app.';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE WARNING '[046] SEM PRIVILÉGIO para NOBYPASSRLS. CHECAR MANUALMENTE EM PROD.';
    END;
  END IF;

  IF is_super THEN
    BEGIN
      ALTER ROLE genomaflow_app NOSUPERUSER;
      RAISE NOTICE '[046] Removido SUPERUSER de genomaflow_app.';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE WARNING '[046] SEM PRIVILÉGIO para NOSUPERUSER. CHECAR MANUALMENTE EM PROD.';
    END;
  END IF;

  -- Se estava OK desde o início, apenas confirma
  IF NOT has_bypass AND NOT is_super THEN
    RAISE NOTICE '[046] genomaflow_app já está em estado seguro (sem BYPASSRLS, sem SUPERUSER).';
  END IF;
END
$$;
