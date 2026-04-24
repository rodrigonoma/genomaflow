-- Migration 050: campos de contato da clínica (email, phone, address)
-- Usados no modal de contato do chat entre tenants V1.
-- Todos nullable — preenchidos opcionalmente pelo admin no perfil da clínica.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT;
