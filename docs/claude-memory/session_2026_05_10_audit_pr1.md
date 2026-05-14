---
name: Session 2026-05-10 — Auditoria 360° + PR1 entregue
description: Auditoria técnica completa por 6 agentes em paralelo + PR1 da remediação (RDS Multi-AZ + backup 30d + ECS desiredCount=2 + IAM Chime/video drift catch-up + .gitignore secrets) entregue em produção
type: project
---

# Auditoria 360° + PR1 da remediação (2026-05-10)

## Auditoria

Despachados 6 agentes Explore em paralelo, um por domínio (Backend Fastify, DB+migrations, Worker BullMQ, Frontend Angular, Tests/CI, Infra Docker/CDK). Saída consolidada por 6 personas seniores.

### Score por camada

- **Banco** 8.5/10 (faltam 2 RLS, alguns índices FK, idempotência em migrations 001-015)
- **Backend** 8/10 (ACL `role !== 'admin'` em 5 rotas precisa virar `master`, SNS sem signature)
- **Worker** 7/10 (sem removeOnComplete, sem SIGTERM graceful, SDK sem timeout)
- **Frontend** 7.5/10 (componentes gigantes 2904 linhas, 75 sem OnPush)
- **Infra** 6.5/10 (RDS sem backup, Redis sem TLS, AWS via access key, desiredCount=1)
- **Tests** 7/10 (test:unit subset hardcoded, gaps em rate-limit/tenant isolation deep)

### 10 ações críticas priorizadas

Detalhes na história de mensagens. Itens #1-#10 cobrem RDS backup, Redis TLS, OIDC, ACL fix, BullMQ retention, SIGTERM, SNS signature, RLS em help_questions, NODE_TLS_REJECT, test:unit glob.

## PR1 entregue (zero-risco infra)

Branches: `feat/infra-zero-risk-hardening` + `chore/gitignore-secrets`. Mergeadas em main.

### Mudanças aplicadas em prod via `cdk deploy`

**`infra/lib/rds-stack.ts`:**
- `multiAz: false` → `true` (failover automático em queda de AZ)
- `backupRetention: cdk.Duration.days(0)` → `days(30)` (PITR habilitado, LGPD compliance)

**`infra/lib/ecs-stack.ts`:**
- `ApiService.desiredCount: 1` → `2` (zero-downtime deploy)
- `WebService.desiredCount: 1` → `2`
- `WorkerService` permanece em 1 (scheduler `setInterval` ainda não cluster-safe)

**`.gitignore`:**
- Adicionado: `aws/`, `env`, `**/aws/credentials`, `**/aws/config`, `*.pem`, `*.key`
- Pré-existia: secrets em `aws/credentials` e `env` (raiz) untracked mas vulneráveis a `git add .`

### Drift catch-up (não planejado, descoberto pelo `cdk diff`)

IAM TaskRole tinha mudanças no código nunca aplicadas em prod:
- `s3:Put/Get/Delete` em prefix `video-consultations/*`
- `chime:CreateMeeting/DeleteMeeting/CreateAttendee/DeleteAttendee/GetMeeting`

Provavelmente explica red flag de "Chime SDK sem IAM → 502 silencioso em prod". Aplicado junto.

### Tempos de deploy

- Stack `genomaflow-rds`: 877s (~14.7min) — modificação Multi-AZ é o longo
- Stack `genomaflow-redis`: 16s (no-op)
- Stack `genomaflow-ecs`: 197s (~3.3min)
- Total cdk: ~18min (bem-sucedido, exit 0)

### Smoke test pós-deploy

- `https://app.genomaflow.com.br/api/auth/me` → 401 (correto)
- `https://app.genomaflow.com.br/api/auth/login` → 401 (correto)
- Landing 200, App SPA 200
- Sem regressão visível

### Custo adicional estimado

~R$ 110-140/mês: RDS Multi-AZ standby + 1 task extra api/web. Aceitável pra clínica regulada (LGPD).

## Próximas PRs planejadas

- **PR2** Worker zero-risco: BullMQ removeOnComplete/Fail, SIGTERM graceful, timeouts SDK, pmessage try/catch, embedBatch retry exponencial
- **PR3** Backend zero-risco: error_log cleanup cron, chat.js embedding parametrizado
- **PR4** DB índices: FK em `exams.patient_id/uploaded_by` + `audit_log(entity_id)`
- **PR5** Frontend zero-risco: trackBy, dialog maxWidth: 95vw
- **PR6** OIDC AWS (substituir access key)
- **PR7+** Itens médios/altos isolados, um por vez (Redis TLS, ACL fix por rota, refator componentes, schema Zod)

## Lições registradas

- `feedback_monitor_deploys.md` — sempre ativar Monitor em deploys
- `feedback_no_regression_no_gambiarra.md` — regra inviolável (já existia, reforçada)
- `feedback_cdk_drift.md` — append do drift catch-up de hoje
