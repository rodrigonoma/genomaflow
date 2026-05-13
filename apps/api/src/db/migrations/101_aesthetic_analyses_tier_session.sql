-- 101_aesthetic_analyses_tier_session.sql
-- tier='standard' (default) preserva F1-F6. tier='advanced' = V2 com captura guiada.
-- Backward compat: rows existentes ganham 'standard' automaticamente (DEFAULT).
-- Spec §5.3.

ALTER TABLE aesthetic_analyses
  ADD COLUMN IF NOT EXISTS session_id UUID NULL
    REFERENCES aesthetic_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'standard';

-- CHECK separado pra deixar nome estável + rollback fácil
ALTER TABLE aesthetic_analyses
  DROP CONSTRAINT IF EXISTS aesthetic_analyses_tier_check;
ALTER TABLE aesthetic_analyses
  ADD CONSTRAINT aesthetic_analyses_tier_check
  CHECK (tier IN ('standard', 'advanced'));

CREATE INDEX IF NOT EXISTS idx_aesthetic_analyses_session
  ON aesthetic_analyses (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aesthetic_analyses_tier
  ON aesthetic_analyses (tenant_id, tier, created_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN aesthetic_analyses.tier IS
  'standard (F1-F6 legacy, 5cr, 1-3 fotos avulsas) | advanced (V2 captura guiada, 10cr, 5 fotos faciais ou 4 corporais + landmarks).';

COMMENT ON COLUMN aesthetic_analyses.session_id IS
  'Obrigatório quando tier=advanced (validado em rota POST /aesthetic/analyses). NULL para tier=standard (legacy F1-F6).';
