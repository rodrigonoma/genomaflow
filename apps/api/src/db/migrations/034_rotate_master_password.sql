-- Migration 034: Rotate master user password hash.
-- The previous hash (from migration 031) is exposed in git history.
-- The new password must be stored in a secure vault (e.g., AWS Secrets Manager), never in this repo.

UPDATE users
SET password_hash = '$2b$12$ie7bxMvhU9X8Gu.hRU1x8eAe0tBzDhK55E6hDDVi/OSDMaHq34A4S'
WHERE email = 'rodrigonoma@genomaflow.com.br'
  AND role = 'master';
