-- 075_email_suppressions.sql
-- Lista de emails que NÃO devem mais receber mensagens via SES.
-- Populada pelo webhook /webhooks/ses quando AWS notifica:
--   - Bounce permanente (hard bounce — email não existe, mailbox cheia, etc.)
--   - Complaint (destinatário marcou email como spam)
-- Mailer (auth-email, nps) checa essa tabela ANTES de chamar SES — evita
-- mandar pra emails ruins → mantém bounce rate <5% e complaint rate <0.1%
-- (limites exigidos pra continuar com production access da AWS).
--
-- LGPD nota: tabela é cross-tenant (sem tenant_id). Mesmo email pode estar
-- cadastrado em vários tenants — se 1 marcou spam, suprimimos pra todos
-- (proteger reputação SES da conta inteira). Tem auditoria via reason+raw.

CREATE TABLE IF NOT EXISTS email_suppressions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,                                       -- lowercased no INSERT
  reason TEXT NOT NULL CHECK (reason IN ('bounce_permanent','bounce_transient','complaint','manual')),
  bounce_subtype TEXT,                                        -- General | NoEmail | Suppressed | OnAccountSuppressionList | etc.
  raw_payload JSONB,                                          -- payload SNS pra debug/audit
  source TEXT NOT NULL DEFAULT 'ses_webhook' CHECK (source IN ('ses_webhook','manual','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_suppressions
  ON email_suppressions(LOWER(email));

CREATE INDEX IF NOT EXISTS idx_email_suppressions_created
  ON email_suppressions(created_at DESC);

-- RLS — sem tenant_id, é tabela global. Master vê tudo; tenant não vê nada
-- (nenhuma rota de tenant lê essa tabela diretamente; mailer faz a query
-- com pool admin).
ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppressions FORCE ROW LEVEL SECURITY;

-- Master bypass (sem contexto OU sem tenant_id na tabela = mestres veem)
CREATE POLICY email_suppressions_select ON email_suppressions
  FOR SELECT USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  );

-- INSERT/UPDATE/DELETE só sem tenant context (apenas master/system)
CREATE POLICY email_suppressions_insert ON email_suppressions
  FOR INSERT WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  );
CREATE POLICY email_suppressions_update ON email_suppressions
  FOR UPDATE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  );
CREATE POLICY email_suppressions_delete ON email_suppressions
  FOR DELETE USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  );
