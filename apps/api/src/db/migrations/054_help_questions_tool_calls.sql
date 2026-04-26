-- Migration 054: audit de tool calls do Copilot (agenda actions)
-- Spec: docs/superpowers/specs/2026-04-26-agenda-chat-actions-design.md
-- Backward compatible: ambas colunas nullable, default NULL.

ALTER TABLE help_questions
  ADD COLUMN IF NOT EXISTS tool_calls JSONB,
  ADD COLUMN IF NOT EXISTS actions_taken JSONB;

-- Index pra analytics futura (queries do tipo "qual tool é mais chamada?")
CREATE INDEX IF NOT EXISTS help_questions_with_tools_idx
  ON help_questions(created_at DESC)
  WHERE tool_calls IS NOT NULL;
