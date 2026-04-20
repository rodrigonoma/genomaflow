-- Migration 033: Tighten users_insert RLS policy now that /register uses withTenant.
-- Previously open without context (needed for registration). Now context is always set.

DROP POLICY IF EXISTS users_insert ON users;

CREATE POLICY users_insert ON users
  FOR INSERT WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
