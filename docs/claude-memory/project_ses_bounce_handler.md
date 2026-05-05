---
name: SES bounce/complaint handler — SNS + suppression list (entregue 2026-05-05)
description: Handler completo de bounce e complaint do SES via SNS HTTPS subscription. Suppression list cross-tenant. Mailer checa antes de SES SendEmail. Ativo em prod
type: project
originSessionId: 77d452f4-2c27-4cf7-9b25-4d53aa31e410
---
Pra responder hardening de bounce/complaint quando AWS perguntar no case de production access SES (177706434000216). Mantém bounce rate <5% e complaint rate <0.1%.

## Arquitetura

```
SES envia email → mailer.js (api)
                 ↓
        Hard bounce / Spam complaint
                 ↓
SES Configuration Set "genomaflow-events"
        publica em
SNS Topic "genomaflow-ses-events"
        envia POST HTTPS pra
/api/webhooks/ses (Fastify)
        registra em
email_suppressions (Postgres)
        ↓
Próxima tentativa do mailer pro mesmo email = skip silencioso
```

## Migration 075

`email_suppressions` (cross-tenant — sem `tenant_id`):
- email TEXT UNIQUE (LOWER)
- reason: `bounce_permanent | bounce_transient | complaint | manual`
- bounce_subtype: subtipo do bounce (NoEmail, MailboxFull, etc.)
- raw_payload JSONB (audit/debug)
- source: `ses_webhook | manual | admin`
- RLS: master vê tudo; tenant não vê (mailer usa pool admin sem context)

## Backend componentes

`apps/api/src/services/email-suppressions.js`:
- `isSuppressed(pg, email)` — checa antes de enviar
- `add(pg, email, reason, opts)` — idempotente (ON CONFLICT updates reason)
- `remove(pg, email)` — admin manual

`apps/api/src/routes/webhooks/ses.js`:
- POST `/api/webhooks/ses` (público — validado via SNS path token futuro se quiser)
- Handles 3 tipos de message SNS:
  - **SubscriptionConfirmation**: chama SubscribeURL automaticamente (handshake)
  - **Notification**: parse body.Message JSON; processa Bounce/Complaint/Delivery
  - **UnsubscribeConfirmation**: log apenas
- Bounces: **só permanent** suprime (transient pode resolver sozinho — mailbox cheia)
- Complaints: **sempre** suprime (proteção reputação)
- Delivery/Open/Click: log apenas

`apps/api/src/mailer/index.js`:
- `sendEmail({to, subject, html, text, pg, log})` agora aceita pg + log opcional
- Antes de SES SendEmail, se `pg` fornecido, checa `email_suppressions`
- Se suprimido, retorna `{suppressed: true, MessageId: null}` sem erro
- Best-effort: se check falhar, prossegue envio (não bloqueia transacional)
- Suporta `SES_CONFIGURATION_SET` env var (CDK injeta `genomaflow-events`)

Call sites atualizados:
- `mailer/verification.js`: passa `pg` no sendEmail
- `routes/auth-email.js` (password reset): passa `pg` + `log`

## CDK (infra/lib/ecs-stack.ts)

```typescript
const sesEventsTopic = new sns.Topic(this, 'SesEventsTopic', {
  topicName: 'genomaflow-ses-events',
});

const sesConfigSet = new sesv2.CfnConfigurationSet(this, 'SesConfigSet', {
  name: 'genomaflow-events',
  reputationOptions: { reputationMetricsEnabled: true },
});

const sesEventDest = new sesv2.CfnConfigurationSetEventDestination(...) {
  configurationSetName: sesConfigSet.ref,  // ref garante CFN dependency
  eventDestination: {
    name: 'sns-events',                    // nome estável dentro do destination
    enabled: true,
    matchingEventTypes: ['BOUNCE', 'COMPLAINT', 'DELIVERY', 'REJECT'],
    snsDestination: { topicArn: sesEventsTopic.topicArn },
  },
});
sesEventDest.addDependency(sesConfigSet);  // fix race condition CFN

sesEventsTopic.addSubscription(new snsSubs.UrlSubscription(
  'https://app.genomaflow.com.br/api/webhooks/ses',
  { protocol: sns.SubscriptionProtocol.HTTPS },
));
```

env var `SES_CONFIGURATION_SET=genomaflow-events` adicionada em backendEnv.

## Pegadinhas que pegamos

1. **SNS posta com Content-Type `text/plain`** (não JSON), Fastify rejeitava com 415.
   Fix: `app.addContentTypeParser('text/plain', ...)` no `server.js` que tenta JSON.parse.

2. **AWS::SES::ConfigurationSetEventDestination race condition** — primeiro `cdk deploy` falhou com "resource not found".
   Fix: `configurationSetName: sesConfigSet.ref` (CFN dependency implícita) +
   `name: 'sns-events'` dentro do eventDestination (ID estável) +
   `addDependency(sesConfigSet)` explícito.

3. **CLI AWS `aws sns subscribe --endpoint <url>`** = override do AWS API endpoint (faz CLI mandar request pro endpoint do user!). Parâmetro correto é `--notification-endpoint`. Lição: ler `--help` antes de usar flags óbvias.

4. **Subscription PendingConfirmation** — se endpoint não confirmar handshake (ex: estava deployado bug), AWS retenta automaticamente. Pra forçar imediato, criar nova subscription via CLI (`aws sns subscribe --notification-endpoint`).

## Validation pendente

Quando AWS aprovar production access (case 177706434000216), validar end-to-end:
1. Mandar email pra fake address → bounce → SNS → endpoint → `email_suppressions`
2. Confirmar via `SELECT * FROM email_suppressions ORDER BY created_at DESC`
3. Próxima tentativa pro mesmo email = skip

Ver `feedback_ses_production_access_pending.md` pro plano de validação.

## Commits relevantes

- `e85753fd` feat: handler completo
- `844025da` fix: parser text/plain + dependsOn EventDestination
- HEAD em main pós-deploy: `9d2308e1`

## Tests

`apps/api/tests/routes/webhooks-ses.test.js` — 9 cases:
- SubscriptionConfirmation com/sem SubscribeURL
- Bounce permanent → suprime
- Bounce transient → não suprime
- Complaint → sempre suprime
- Delivery → log only
- Message inválido (não-JSON) → 400
- messageType desconhecido → 400
