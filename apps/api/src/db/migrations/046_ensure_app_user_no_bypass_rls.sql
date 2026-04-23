-- Migration 046: CRÍTICO DE SEGURANÇA — garante que genomaflow_app NÃO tem
-- BYPASSRLS nem SUPERUSER. Defesa contra configuração incorreta de prod
-- que poderia fazer queries ignorarem RLS e vazarem dados cross-tenant.
--
-- Contexto: incidente 2026-04-23 — usuário novo viu dados de tenant antigo.
-- Hipótese investigada: genomaflow_app em prod poderia estar com BYPASSRLS=true.
-- Esta migration remove essas flags se existirem e garante o estado seguro.

-- Se o role existir, força NO BYPASSRLS e NOSUPERUSER.
-- Usa DO block para não falhar se o role ainda não existe (edge case de primeira instalação).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'genomaflow_app') THEN
    ALTER ROLE genomaflow_app NOBYPASSRLS;
    ALTER ROLE genomaflow_app NOSUPERUSER;
  END IF;
END
$$;
