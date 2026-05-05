-- 078_credit_ledger_ai_kinds.sql
-- Phase 4 polish: adicionar kinds que faltam ao CHECK do credit_ledger.
--
-- Bug pré-existente: 'ocr_usage' era inserido em apps/worker/src/processors/exam.js
-- mas NUNCA esteve no CHECK constraint — então qualquer PDF que precisava de
-- OCR fallback rollback a transação inteira do exame.
--
-- Phase 4 adiciona:
--   - ai_suggestion: debit por POST /patients/:id/ai-suggestions/refresh (4.3)
--   - encounter_copilot: debit por POST /encounters/copilot (4.4)
--   - ocr_usage: fix do bug pré-existente

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_kind_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_kind_check
  CHECK (kind = ANY (ARRAY[
    'subscription_bonus','topup','topup_recurring','agent_usage','adjustment',
    'purchase','chat_query',
    'ocr_usage',          -- fix bug pré-existente (4.1 + PDF OCR fallback)
    'ai_suggestion',      -- 4.3 IA pró-ativa
    'encounter_copilot'   -- 4.4 co-piloto durante consulta
  ]));
