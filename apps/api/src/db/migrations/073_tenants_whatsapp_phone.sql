-- 073_tenants_whatsapp_phone.sql
-- Phase 3.5: campo dedicado pra número WhatsApp da clínica (botão "Falar no WhatsApp"
-- no portal do tutor/paciente + dentro do app).
--
-- Existe `tenants.phone` desde migration 050 (telefone fixo). Adicionamos
-- `whatsapp_phone` separado porque na prática:
--   - Clínica geralmente tem (a) telefone fixo da recepção e (b) celular
--     WhatsApp da atendente — números diferentes
--   - Frontend faz fallback: se whatsapp_phone IS NULL, usa phone como WhatsApp
--   - Validação no app (não na constraint) — formato é flexível em settings,
--     normalização (E.164) acontece no momento de gerar wa.me

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT;
