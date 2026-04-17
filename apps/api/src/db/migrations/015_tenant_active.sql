-- Migration 015: add active column to tenants
ALTER TABLE tenants
  ADD COLUMN active BOOLEAN NOT NULL DEFAULT false;

-- Existing tenants are already considered active
UPDATE tenants SET active = true;
