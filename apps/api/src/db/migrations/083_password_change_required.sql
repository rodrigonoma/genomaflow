-- 083_password_change_required.sql
-- Flag para forçar troca de senha no próximo login (uso típico: master cria conta
-- com senha temporária e marca esta flag, usuário troca no primeiro login).
-- Default FALSE — não afeta usuários existentes.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_change_required BOOLEAN NOT NULL DEFAULT FALSE;
