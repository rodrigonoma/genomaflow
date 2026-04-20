-- Migration 031: master role + master user + user active flag

-- Extend role enum to include 'master'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('doctor', 'lab_tech', 'admin', 'master'));

-- Add active flag to users (default true = not disabled)
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- Add module column to tenants if not exists
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS module TEXT;

-- Create a master tenant (GenomaFlow internal)
INSERT INTO tenants (id, name, type, plan, active, module)
VALUES ('00000000-0000-0000-0000-000000000001', 'GenomaFlow', 'clinic', 'master', true, 'human')
ON CONFLICT (id) DO NOTHING;

-- Create master user
INSERT INTO users (tenant_id, email, password_hash, role, active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'rodrigonoma@genomaflow.com.br',
  '$2b$12$dQypCZ31X354a9hi0Xpb9u2G4haeUI3oPjmaRkvaY7KdYt742h9yq',
  'master',
  true
)
ON CONFLICT (email) DO UPDATE SET
  role = 'master',
  active = true;

-- Extend kind enum for manual credit adjustments (already has 'adjustment')
-- Already in 030_credit_ledger_kinds, nothing to do

-- Add screenshot column to feedback if not exists (from 026)
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS screenshot_url TEXT;
