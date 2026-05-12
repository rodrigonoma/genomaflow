-- 098_credit_ledger_aesthetic_kinds.sql
-- Adiciona os 9 kinds aesthetic (facial, eyelids, neck, breast, arms, abdomen,
-- legs, glutes, full_body) + aesthetic_refund ao CHECK constraint de credit_ledger.
--
-- Bug em prod 2026-05-12 (CloudWatch req-3s): POST /aesthetic/analyses 500
-- 'new row for relation "credit_ledger" violates check constraint "credit_ledger_kind_check"'
-- ao tentar inserir kind='aesthetic_facial_analysis'.
--
-- Mesma família dos bugs do dia (ref_id em credit_ledger, updated_at em subjects):
-- migration esperada não foi criada quando F1/F2 introduziram esses kinds via
-- aesthetic-analyses.js:86 `kind: aesthetic_${analysis_type}_analysis`.

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_kind_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_kind_check
  CHECK (kind = ANY (ARRAY[
    -- Históricos (até migration 082)
    'subscription_bonus','topup','topup_recurring','agent_usage','adjustment',
    'purchase','chat_query',
    'ocr_usage',
    'ai_suggestion',
    'encounter_copilot',
    'video_simple','video_complete','video_transcription_refund',
    -- Aesthetic F1+F2 (9 regiões × debit + 1 refund)
    'aesthetic_facial_analysis',
    'aesthetic_eyelids_analysis',
    'aesthetic_neck_analysis',
    'aesthetic_breast_analysis',
    'aesthetic_arms_analysis',
    'aesthetic_abdomen_analysis',
    'aesthetic_legs_analysis',
    'aesthetic_glutes_analysis',
    'aesthetic_full_body_analysis',
    'aesthetic_refund'
  ]));
