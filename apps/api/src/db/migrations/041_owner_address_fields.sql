-- Migration 041: structured address fields in owners
-- Replaces/complements the single `address TEXT` column with CEP-lookup friendly fields.
-- Keeps `address` column for backwards compatibility with legacy rows.

ALTER TABLE owners ADD COLUMN IF NOT EXISTS cep          TEXT;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS street       TEXT;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS number       TEXT;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS complement   TEXT;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS neighborhood TEXT;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS city         TEXT;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS state        TEXT;
