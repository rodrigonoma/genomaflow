-- 097_credit_ledger_ref_id.sql
-- Adiciona coluna ref_id em credit_ledger para suportar refunds idempotentes
-- de análises estéticas (aesthetic-credits.debit/refund).
--
-- Bug reportado em prod 2026-05-12: POST /aesthetic/analyses retornava 500
-- com 'column "ref_id" of relation "credit_ledger" does not exist'.
-- Código (apps/api/src/services/aesthetic-credits.js + apps/worker/src/
-- processors/aesthetic-analysis.js) tentava INSERT em ref_id mas a coluna
-- nunca foi criada — schema original (migration 016) só tem exam_id.
--
-- Aditivo, nullable, backward-compat. Index parcial pra dedup idempotente
-- de refunds (WHERE NOT EXISTS pattern do worker).

ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS ref_id UUID NULL;

-- Idempotência de refund: 1 entry por (ref_id, kind='aesthetic_refund')
-- Index parcial pra não impactar rows legacy sem ref_id.
CREATE INDEX IF NOT EXISTS idx_credit_ledger_ref_id_refund
  ON credit_ledger (ref_id, kind)
  WHERE ref_id IS NOT NULL;
