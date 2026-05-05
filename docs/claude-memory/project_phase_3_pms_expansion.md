---
name: Phase 3 PMS Expansion — WhatsApp + Lembretes + Portal (entregue 2026-05-05)
description: WhatsApp via Z-API com webhook inbound (1=confirma, 2=cancela), scheduler de lembretes T-24h/T-2h via worker BullMQ-style, portal público read-only do tutor/paciente com TTL 90d
type: project
---

Terceiro passo do plano PMS expansion (Caminho A). Fecha o gap competitivo crítico vs simples.vet: WhatsApp + portal do cliente.

## Decisões tomadas (autorizadas pelo usuário 2026-05-05)

1. **Provider WhatsApp:** Z-API (intermediário, ~R$60/mês/conta). Sem aprovação Meta + sem templates pré-aprovados obrigatórios. Migração futura pra Meta Cloud API direto quando volume >5k msg/mês
2. **ENV vars Z-API:** `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`. Mock em dev via `ZAPI_MOCK=1`
3. **Lembretes:** T-24h + T-2h por padrão. Configurável por tenant via `notification_preferences.reminder_hours_before` (array, max 5 valores 1-168h)
4. **Templates:** simples — replace `{{placeholder}}` (sem libs). Lista fechada de 7 templates pré-definidos (`appointment_reminder_24h`, `appointment_reminder_2h`, `nps_request`, `vaccine_reminder`, etc.)
5. **Scheduler:** worker existente ganhou `notifications/scheduler.js` que roda a cada 5min. Dois passos: (1) gera scheduled_notifications pra appointments futuros 48h sem reminder ainda; (2) envia pendentes cujo scheduled_for já passou. Idempotente (skip se já existe row pra mesmo appointment+timing)
6. **Inbound webhook:** público em `/notifications/whatsapp/inbound`. Auth via header `X-Token = ZAPI_CLIENT_TOKEN`. Match `1|sim|confirmar` → confirm; `2|cancelar|não` → cancel. Outros = log com `processed_action='unrecognized'`
7. **Resposta automática inbound:** após processar 1/2, envia confirmação/cancelamento de volta automaticamente (best-effort)
8. **NPS via WhatsApp:** habilitado nesta fase (Fase 2 rejeitava). `/nps/send sent_via=whatsapp` aceita telefone em `sent_to`
9. **Portal scope XOR:** subject_id (1 paciente humano OU 1 animal) **OU** owner_id (todos animais do tutor — útil quando tutor tem 3 cães). CHECK constraint força XOR
10. **Portal token:** 32 hex random + TTL 90 dias + `revoked_at` pra revogação. Cada acesso atualiza `last_accessed_at`/`access_count`
11. **Portal scope read-only:** decisão por segurança. Tutor não pode agendar/cancelar pelo portal (Fase 4+ pode evoluir)
12. **Portal frontend:** rota lazy `/portal/:token`, mobile-first, **sem Material** (carrega rápido), 5 abas: Agenda, Exames, Prescrições, Documentos, Vacinas (vet only). Sem login

## Migration 072

Single migration cobrindo 4 tabelas + RLS + audit:

- `notification_preferences` (1 row por tenant) — config de lembretes + janela de envio + NPS auto
- `scheduled_notifications` — outbox/queue pattern. Status: pending|sent|failed|cancelled. retry_count max 3
- `whatsapp_messages` — log direção (outbound/inbound) + zapi_message_id + processed flag pra inbound
- `portal_tokens` — XOR subject_id/owner_id + TTL + revoked_at + access tracking

RLS NULLIF em todas (worker/webhook precisam SELECT/INSERT sem context). Audit triggers em `scheduled_notifications` e `portal_tokens` (compliance/forense). `whatsapp_messages` SEM trigger (volume alto, conteúdo já no row).

## Backend novos

### Service (`apps/api/src/services/`)

- `whatsapp-client.js` — wrapper Z-API com `sendText()` + `verifyWebhook()` + `normalizePhone()`. Mock mode via `ZAPI_MOCK=1`. Aceita formatos BR (11 digits → adiciona 55, formato com pontuação, etc.)
- `notification-templates.js` — `render(tpl, vars)` + `build(key, vars)` + 7 templates pré-definidos. Sem libs externas

### Routes (`apps/api/src/routes/`)

**`/notifications/*`:**
| Path | Método | Auth | Notas |
|---|---|---|---|
| `/notifications/preferences` | GET | authenticate | Defaults se não existe (sem criar) |
| `/notifications/preferences` | PUT | admin | UPSERT com defaults explícitos no INSERT (evita NOT NULL violation) |
| `/notifications/scheduled` | GET | admin | Lista 200 últimos pendentes/recentes |
| `/notifications/whatsapp/status` | GET | admin | Health check Z-API config |
| `/notifications/whatsapp/inbound` | POST | **público** | Webhook Z-API. Header `X-Token` valida. Match 1/2 → confirma/cancela appointment. Best-effort reply automático |

**`/portal/*`:**
| Path | Método | Auth | Notas |
|---|---|---|---|
| `/portal/tokens` | POST | admin | XOR subject_id/owner_id. Retorna `{token, link}` |
| `/portal/tokens` | GET | admin | Lista tokens do tenant (200 últimos) |
| `/portal/tokens/:id` | DELETE | admin | Revoga (`revoked_at = NOW()`) |
| `/portal/:token` | GET | **público** | Info inicial: tenant + subject/owner + lista de subjects (se owner). Rate limit 60/min/token |
| `/portal/:token/agenda` | GET | **público** | Próximas consultas (T-7d a futuro) |
| `/portal/:token/exams` | GET | **público** | Exames recentes |
| `/portal/:token/prescriptions` | GET | **público** | Prescrições |
| `/portal/:token/documents` | GET | **público** | Atestados/encaminhamentos |
| `/portal/:token/vaccines` | GET | **público** | Carteira (vet) |

### Worker (`apps/worker/src/notifications/scheduler.js`)

- `startScheduler({intervalMs = 5min})` chamado em `index.js`
- Tick:
  1. `generateRemindersForUpcoming()` — busca appointments scheduled/confirmed nas próximas 48h, junta phone do owner ou subject, cria scheduled_notifications conforme `reminder_hours_before` da prefs do tenant
  2. `sendPendingNotifications()` — envia status='pending' cujo scheduled_for já passou. WhatsApp via fetch nativo (Node 20). Atualiza status=sent ou retry_count++. Max 3 retries → status='failed'
- Idempotente: re-execução não duplica reminders (busca existing antes de inserir)
- Loga em `whatsapp_messages` cada envio

## Frontend

`apps/web/src/app/features/portal/portal.component.ts`:
- Lazy-loaded route `/portal/:token` (não precisa de auth)
- Mobile-first design (max-width 480px, touch targets, scroll horizontal nas tabs)
- Standalone component, **zero Material** (carrega ~50KB inicial vs 200KB+ com Material)
- 5 tabs: Agenda / Exames / Prescrições / Documentos / Vacinas (gated por `tenant.module === 'veterinary'`)
- Estados: loading / error (mensagem amigável pra link expirado) / sucesso

NPS update: `/nps/send` aceita `sent_via=whatsapp` agora, com validação de phone format.

## Tests (CI gate +38 = 488 verdes)

- `whatsapp-client.test.js` — 8 cases: normalizePhone (4 formatos), isMock, sendText em mock, verifyWebhook (mock/sem-token/com-token)
- `notification-templates.test.js` — 4 cases: render basic, placeholder ausente, build com erro, todos templates expostos
- `notifications-validation.test.js` — 12 cases: GET defaults, PUT ACL, reminder_via whitelist, hours_before range, send_window formato, nps_via whitelist, inbound signature, mock mode, mensagem vazia, fromMe skipped, status endpoint
- `portal-validation.test.js` — 8 cases: XOR scope (sem ambos OR ambos), ACL admin (POST/GET/DELETE tokens), token formato (404 inválido), 404 inexistente

**Total acumulado:** 488 passed / 20 skipped / 29 suites

## Smoke local validado

- ✅ `GET /notifications/preferences` retorna defaults se não existe (is_default: true)
- ✅ `PUT /notifications/preferences` cria/atualiza com COALESCE explícito (fix do bug NOT NULL inicial)
- ✅ `POST /portal/tokens {subject_id}` cria token + retorna link público
- ✅ `GET /portal/:token` (sem auth) retorna info do paciente humano + tenant
- ✅ `GET /portal/:token/agenda` lista appointments
- ✅ `GET /notifications/whatsapp/status` retorna `{mock: false, configured: false}` (esperado em local sem ZAPI env vars)
- ✅ Worker scheduler iniciado sem erro

## Arquivos alterados

**Backend (10 arquivos):**
- `apps/api/src/db/migrations/072_notifications_and_portal.sql` (NEW, ~200 linhas)
- `apps/api/src/services/whatsapp-client.js` (NEW)
- `apps/api/src/services/notification-templates.js` (NEW)
- `apps/api/src/routes/notifications.js` (NEW, ~250 linhas)
- `apps/api/src/routes/portal.js` (NEW, ~280 linhas)
- `apps/api/src/routes/nps.js` — NPS via WhatsApp habilitado
- `apps/api/src/server.js` — registra `/notifications` e `/portal`
- `apps/api/package.json` — 2 paths novos no test:unit
- `apps/api/tests/services/whatsapp-client.test.js` (NEW)
- `apps/api/tests/services/notification-templates.test.js` (NEW)
- `apps/api/tests/routes/notifications-validation.test.js` (NEW)
- `apps/api/tests/routes/portal-validation.test.js` (NEW)
- `apps/api/tests/routes/nps-validation.test.js` — atualizado pra aceitar whatsapp

**Worker (2 arquivos):**
- `apps/worker/src/notifications/scheduler.js` (NEW, ~200 linhas)
- `apps/worker/src/index.js` — chama `startScheduler()` no boot

**Frontend (2 arquivos):**
- `apps/web/src/app/features/portal/portal.component.ts` (NEW, ~270 linhas)
- `apps/web/src/app/app.routes.ts` — rota `/portal/:token` lazy

## Premissas P1/P2/P3 cumpridas

- **P1 (não quebrar):** schema 100% aditivo. Worker scheduler não bloqueia outras filas (BullMQ separado). NPS estendeu sem quebrar contrato existente. Tests existentes 450 → 488 (apenas crescimento)
- **P2 (humano/vet sem emaranhado):** Portal aba "Vacinas" gated por `tenant.module='veterinary'`. WhatsApp/NPS/Lembretes shared (mesma regra pra ambos). Templates não dividem por módulo (mensagem é universal)
- **P3 (performance/custo):** indexes em `scheduled_notifications` (`status='pending'` partial), `whatsapp_messages` (composto tenant+phone+created), `portal_tokens` (composto tenant+expires). RLS NULLIF pra rotas públicas. Worker tick 5min (não 1min — economia). Mock mode em dev evita custo Z-API. Z-API ~R$60/mês/conta vs Meta ~R$0,15/msg outbound. Portal frontend SEM Material (50KB vs 200KB)

## Configuração de prod (manual antes do uso real)

```bash
# Z-API: criar conta, conectar WhatsApp, pegar credenciais
aws ssm put-parameter --name /genomaflow/prod/zapi-instance-id --value "..." --type SecureString
aws ssm put-parameter --name /genomaflow/prod/zapi-token --value "..." --type SecureString
aws ssm put-parameter --name /genomaflow/prod/zapi-client-token --value "..." --type SecureString

# Adicionar no infra/lib/ecs-stack.ts:
# - ssmParam('zapi-instance-id') em api+worker secrets
# - ssmParam('zapi-token')
# - ssmParam('zapi-client-token')
# Depois: cd infra && npx cdk deploy genomaflow-ecs

# No painel Z-API, configurar webhook receiver URL:
#   https://app.genomaflow.com.br/api/notifications/whatsapp/inbound
# Header X-Token = mesmo valor que ZAPI_CLIENT_TOKEN
```

Antes de configurar Z-API real, scheduler roda em modo silencioso (sem ZAPI_MOCK=1, falha graceful no send).

## Estado em prod (deploy 2026-05-05)

A preencher após pipeline rodar.

## Próximos passos (Fase 4+)

- **Fase 4 condicional:** PDV+estoque+financeiro. Decisão depende de feedback de clientes Fase 1-3
- **Cleanup eventual:** documentos UI + NPS dashboard (frontend) — backends prontos, faltam só telas admin
- **Z-API → Meta direto:** quando volume >5k msg/mês, vale migração (custo unitário cai)
- **Portal evolution (Fase 5+):** permitir agendar/cancelar pelo portal (hoje read-only); confirmação 2FA antes de mutações
- **Lembretes via SMS:** Fase 5+ (WhatsApp tem maior penetração no Brasil; SMS = nicho de tutores idosos)
