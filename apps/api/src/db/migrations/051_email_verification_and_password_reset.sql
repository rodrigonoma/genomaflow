-- Migration 051: validação de email + reset de senha
--
-- Adiciona campos em users para:
-- 1. Verificação de email (obrigatória para novos usuários — bloqueia login até verificar)
-- 2. Reset de senha via email
--
-- Tokens são armazenados apenas como hash SHA-256 — plain token só existe no email.
-- Tokens expiram em 48h (verification) / 1h (password reset), single-use.
--
-- Backfill: usuários existentes são marcados como verificados retroativamente
-- (email_verified_at = NOW()) pra não quebrar login de quem já está no sistema.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_last_sent_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_last_sent_at TIMESTAMPTZ;

-- Backfill retroativo: todos os usuários que existem agora ficam verificados.
-- Novos usuários (criados depois desta migration) terão email_verified_at = NULL por default
-- e precisam verificar o email antes de conseguir logar.
UPDATE users SET email_verified_at = NOW() WHERE email_verified_at IS NULL;

-- Índice parcial pra busca rápida por token (lookup no confirm)
CREATE INDEX IF NOT EXISTS users_email_verification_token_idx
  ON users(email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_password_reset_token_idx
  ON users(password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;
