-- 102_credit_ledger_advanced_kinds.sql
-- Adiciona os 9 kinds aesthetic_*_advanced (V2 tier advanced) ao CHECK constraint.
-- Drop+recreate é a única forma de estender CHECK em Postgres.
-- Espelha a lista completa de migration 098 + 9 novos kinds *_advanced.
-- Spec §5.3.1.

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
    -- Aesthetic F1+F2 standard tier (migration 098)
    'aesthetic_facial_analysis',
    'aesthetic_eyelids_analysis',
    'aesthetic_neck_analysis',
    'aesthetic_breast_analysis',
    'aesthetic_arms_analysis',
    'aesthetic_abdomen_analysis',
    'aesthetic_legs_analysis',
    'aesthetic_glutes_analysis',
    'aesthetic_full_body_analysis',
    'aesthetic_refund',
    -- V2 Fase 1 advanced tier (10cr cada — captura guiada + landmarks)
    'aesthetic_facial_analysis_advanced',
    'aesthetic_eyelids_analysis_advanced',
    'aesthetic_neck_analysis_advanced',
    'aesthetic_breast_analysis_advanced',
    'aesthetic_arms_analysis_advanced',
    'aesthetic_abdomen_analysis_advanced',
    'aesthetic_legs_analysis_advanced',
    'aesthetic_glutes_analysis_advanced',
    'aesthetic_full_body_analysis_advanced'
  ]));
