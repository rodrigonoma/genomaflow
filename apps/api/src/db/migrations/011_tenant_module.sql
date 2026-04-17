ALTER TABLE tenants
  ADD COLUMN module TEXT NOT NULL DEFAULT 'human'
    CHECK (module IN ('human', 'veterinary'));
