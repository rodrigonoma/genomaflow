---
name: aws-cost-reduction
description: Plano de redução de custo AWS (fatura USD 268→~USD 130/mês) em 4 ondas + descoberta do auditty-staging desligado. Histórico das ondas aplicadas + valores de baseline.
metadata:
  type: project
---

# AWS Cost Reduction — Ondas 2026-06

**Baseline (fatura maio/2026):** USD 268,20 (~BRL 1.352,48 com câmbio 5,04).

**Meta:** Reduzir ~50% (~USD 130-140/mês) sem perder funcionalidade percebida pelos usuários.

**Plano completo:** `docs/superpowers/plans/2026-06-01-aws-cost-reduction.md`.

## Personas seniores que assinam o plano

Engenheiro/Arquiteto/PO/UX/Eng. Dados/DBA — trade-offs explicitados em cada onda (HA RDS, autoscaling cold-start, lock-in de RI). Ver [[senior-personas]].

## Ondas

### Onda 1 — ARM Graviton + Spot + S3 endpoint (PENDENTE)
**Branch:** `perf/cost-reduction-wave-1` (ac01fd8) — pronta mas NÃO aplicada.
**Bloqueio:** sem Docker local no momento → precisa build via GitHub Actions ou Docker Desktop.
**Mudanças:** RDS db.t3→t4g.micro, Redis cache.t3→t4g.micro, ECS runtimePlatform ARM64, Worker Fargate Spot, S3 Gateway Endpoint, SMTP password de Secrets Manager → SSM SecureString, backup retention 30d→7d.
**Economia projetada:** USD 60-65/mês.

### Onda 2 — RDS Single-AZ + autoscaling (APLICADA 2026-06-02)
**Branch:** `perf/cost-reduction-wave-2` (mergeada na main como c05f06f).
**Aplicada:** 2026-06-02 13:31 UTC.
**Como:** `aws rds modify-db-instance --no-multi-az --apply-immediately` (AWS CLI direto, in-place ~4-5min) + `cdk deploy genomaflow-ecs` (autoscaling + desiredCount 2→1 em API/Web).
**Por que CLI no RDS:** `cdk diff` flagou "may cause replacement" no MultiAZ change. Em vez de confiar no CFN, usamos `aws rds modify-db-instance` que GARANTE in-place. CDK depois detecta como "sem mudanças" porque estado bate.
**Snapshot pré-deploy:** `pre-cost-onda2-20260602-130034` (rollback disponível).
**Smoke pós-deploy:** API 401, Web 200, Landing 200; 1 task em api/worker/web; autoscaling target min=1 max=3 (CPU 70%, Mem 80%).
**Economia projetada:** USD 60/mês.

### Onda 3 — Reserved Instances + Compute Savings Plan (FUTURO)
**Quando:** após Ondas 1+2 estabilizadas por ~7 dias (pra não comprar RI do tipo errado se decidir voltar).
**Mudanças:** Compute Savings Plan 1y no-upfront (~USD 0.04/h commit), RDS RI db.t4g.micro 1y NU, ElastiCache RN cache.t4g.micro 1y NU.
**Economia projetada:** USD 22-25/mês.

### Onda 4 — Angular S3+CloudFront, deletar Web ECS (CANCELADA)
**Branch:** `perf/cost-reduction-wave-4` (7497bbf) — pronta mas NÃO aplicada.
**Status:** SUPERADA pela migração VPS Hostinger (ver seção abaixo). Branch fica
arquivada como referência caso volte pra AWS.

---

## MIGRAÇÃO COMPLETA PRA VPS HOSTINGER (2026-06-02)

**Branch:** `feat/vps-migration` (commit `73e39d0`).

A decisão de cortar 50% da AWS via Ondas 1-4 virou irrelevante quando o
usuário comprou VPS Hostinger (R$ 129/mês = ~USD 25). Migração híbrida:

- **VPS Hostinger BR** (4 vCPU EPYC, 15GB RAM, 191GB SSD, Ubuntu 24.04):
  - Caddy (TLS Let's Encrypt automático)
  - api + worker + web (Docker containers)
  - PostgreSQL 15 + pgvector
  - Redis 7 (noeviction policy pra BullMQ)
  - MinIO (S3-compatible)
- **AWS residual** (apenas pra Chime SDK Meetings):
  - IAM user com policy mínima
  - Sem ECS, RDS, ElastiCache, ALB, S3, ECR

### O que aplicado em 2026-06-02
- VPS bootstrap: swap 4GB, ufw, fail2ban, Docker, unattended-upgrades
- SSH hardening: chave ed25519, senha root nova, PasswordAuthentication desabilitado
- 17 segredos coletados do AWS SSM, RDS creds do Secrets Manager
- `.env` montado e copiado pra `/opt/genomaflow/.env`
- Stack subiu (7 containers healthy)
- pg_dump RDS via ECS task one-shot → S3 → VPS (RDS estava em PRIVATE_ISOLATED, sem rota externa)
- pg_restore: 12 tenants, 13 users, 5 subjects, pgvector ativa
- S3 → MinIO via `mc mirror`: 26MB em 45 objetos
- Route 53 cutover: A records de Alias ALB pra A simples → 2.25.163.251
- Caddy obteve certs Let's Encrypt em ~1min após DNS propagar
- AWS desligada parcial (2026-06-02): ECS desired=0, RDS stopped, snapshot
  `pre-shutdown-vps-migration-20260602` preservado

### Mudanças mínimas no código
- `apps/api/src/storage/s3-client.js` + `apps/worker/src/storage/s3-client.js`:
  novo helper com `S3_ENDPOINT` customizável (MinIO/R2/B2). Fallback AWS S3
  nativo quando ENDPOINT vazio (preserva compat com pipeline ECS).
- Refactor: 4 lugares onde S3Client era instanciado direto agora importam o
  helper (`apps/api/src/storage/s3.js`, `apps/worker/src/storage/s3.js`,
  `apps/api/src/services/aesthetic-s3.js`, `apps/api/src/routes/video.js`).
- Mailer: zero mudança (`apps/api/src/mailer/index.js` já tem branching
  automático SMTP/SES via `SMTP_HOST` env).
- `apps/web/Dockerfile.compose` (NOVO): context na raiz pra incluir
  `apps/landing/`. Dockerfile original preserva pipeline ECS.
- Infra: `docker-compose.prod.yml`, `Caddyfile`, `scripts/vps-setup.sh`,
  `scripts/migrate-data.sh`, `scripts/backup-pg.sh`, `.env.vps.template`.

### Limpeza adicional aplicada
- `auditty-staging` (projeto separado do GenomaFlow): 5 ECS services
  desired=0, RDS stopped. Economia ~USD 50-80/mês.
- 3 EFS órfãos deletados.
- IAM user `auditty-deploy` (AdministratorAccess) reusado temporariamente
  pra Chime SDK na VPS. **TODO:** criar IAM user dedicado `genomaflow-vps-chime`
  com policy mínima + rotacionar `auditty-deploy`.

### DNS
- Cutover Route 53 (zone `Z07483541PB5S8YMKZYX1`): Alias ALB → A 2.25.163.251
- TTL: 60s
- 6 records: genomaflow.com.br, www, app, api, s3, minio-console
- Hostinger DNS planejado pra fase 2 (sem pressa) — quando migrar zona
  pra Hostinger, deletar a zona Route 53. Custo Route 53 atual: USD 0.50/mês.

### Custo após migração
| Item | Mensal |
|---|---:|
| VPS Hostinger KVM 4 | R$ 129 (~USD 25) |
| AWS Chime + Route 53 (residual) | ~USD 1 |
| **Total estimado** | **~USD 26/mês** |

Comparado com AWS pré-Onda-2 (USD 268/mês): **economia de ~USD 240/mês
(BRL 1.200/mês = ~90%)**.

### Cleanup AWS final (aplicado 2026-06-02 ~17:30 UTC)

Após smoke browser OK, deletado tudo do GenomaFlow que estava ocioso:

**GenomaFlow — deletados:**
- ECS cluster + 3 services (api/worker/web) + task definitions
- ALB `genoma-Alb16-8IjuSHO6N1Ng` + 2 target groups
- ACM cert wildcard `*.genomaflow.com.br` (Caddy gera novos via Let's Encrypt)
- EFS `fs-07e76c09d3a1eb588`
- RDS instance + 25 snapshots automáticos + snapshot manual `pre-cost-onda2`
- ElastiCache replication group `strqk2w1fqk2g68`
- S3 bucket `genomaflow-uploads-prod`
- ECR repos `genomaflow/api`, `/worker`, `/web` (21 imagens)
- 3 Secrets Manager: `/genomaflow/prod/{rds-credentials,smtp-password,master-credentials}`
- 17 SSM SecureString parameters `/genomaflow/prod/*`
- CloudWatch log group `/genomaflow/prod`
- SNS topic `genomaflow-ses-events` + SES Configuration Set `genomaflow-events`
- IAM roles ECS (ExecRole, TaskRole)
- 5 CloudFormation stacks: `genomaflow-{ecs,rds,redis,vpc,ecr}`

**GenomaFlow — preservados (intencional):**
- Stack `genomaflow-dns` (Route 53 hosted zone `Z07483541PB5S8YMKZYX1`) — necessário pros A records `2.25.163.251`
- 16 records DNS: A records (genomaflow, www, app, api, s3, minio-console),
  Zoho MX/TXT/DKIM, DMARC, NS, SOA. SES DKIM CNAMEs ficaram órfãos mas inofensivos.
- Snapshot RDS `pre-shutdown-vps-migration-20260602` (20GB, available) — retido pra rollback emergencial

**Auditty — deletado (escolha do usuário: só ALB + Redis):**
- ALB `auditt-Alb16-YYOCUwtpnbGF` + 4 target groups
- ElastiCache `str143vhbl98q59y`
- Stack `auditty-staging-redis`

**Auditty — preservado (escolha do usuário):**
- ECS cluster + services (em desired=0)
- RDS `auditty-staging-rds-...` (stopped)
- Stacks `auditty-staging-{monitoring,ecs,rds,vpc}`, `auditty-ecr`
- ECR repos `auditty/{api,worker,web,admin}`
- S3 `auditty-staging-documents`
- Stack auditty-staging-ecs tem **drift** (ALB removido fora do CFN). Próximo cdk deploy do auditty vai detectar e recriar o ALB.

### Custo final (Junho 2026 em diante)

| Item | Mensal |
|---|---:|
| VPS Hostinger KVM 4 (4 vCPU, 15GB RAM, 191GB SSD) | R$ 129 (~USD 25) |
| AWS Route 53 hosted zone | USD 0,50 |
| AWS Chime SDK Meetings (per-meeting) | ~USD 0,20 |
| AWS RDS snapshot retido (20GB, USD 0,02/GB/mês) | USD 0,40 |
| AWS Auditty residual (RDS storage stopped + ECR + S3 + VPC sem ALB) | ~USD 4-5 |
| **Total mensal** | **~USD 30-32** |

Vs AWS original (USD 268,20/mês fatura maio 2026): **economia ~USD 236-238/mês (~88-89%)**.

### Pendências futuras

- [ ] Criar IAM user dedicado `genomaflow-vps-chime` (policy mínima) + rotacionar `auditty-deploy` (AdminAccess exposto no chat)
- [ ] Configurar backup automatizado pro Backblaze B2 (cron `/etc/cron.d/genomaflow-backup` já existe)
- [ ] Migrar zona Route 53 → Hostinger DNS (economia USD 0,50/mês — sem pressa)
- [ ] Decisão sobre Auditty: manter parado ou deletar tudo
- [ ] Quando Route 53 sair, deletar SES DKIM CNAMEs órfãos (3 CNAMEs + ACM validation CNAME órfão)

## Descobertas extras — não-genomaflow na conta AWS

A conta `981207388012` tem **outro projeto rodando em paralelo: `auditty-staging`** consumindo USD 70-130/mês. Estado em 2026-06-02:

- ECS cluster `auditty-staging` com 5 services: api, worker, web, admin, glitchtip
- RDS `auditty-staging-rds-postgres9dc8bb04-antvpzumwqnl` (db.t3.micro Single-AZ)
- ElastiCache `auditty-staging-redis`
- ALB `auditt-Alb16-YYOCUwtpnbGF` (internet-facing)
- 5 stacks CloudFormation: `auditty-staging-{ecs,rds,redis,vpc,monitoring}` + `auditty-ecr`
- ECR repos `auditty/{api,worker,web,admin}` com 36+ imagens

**Ação executada 2026-06-02:** stop sem deletar.
- 5 ECS services do auditty: `desiredCount=0` (tasks drenadas)
- RDS auditty: `stop-db-instance` (status `stopping` → 7 dias antes do auto-restart)
- ElastiCache, ALB e ECR mantidos (custo fixo ~$35/mês ainda, mas decisão do usuário foi "sem deletar")

**Economia parcial estimada:** USD 50-80/mês (compute parado; storage e ALB continuam cobrando).

**Pendente:** decisão definitiva sobre deletar/manter — falar com Rodrigo após confirmar com a equipe do auditty.

## Limpeza secundária aplicada 2026-06-02

- 3 EFS órfãos deletados: `fs-0e978d78dc608e145`, `fs-0663717cc9c40a6a4`, `fs-0b07564ff991fdbb2` (sobras de cdk deploys falhos durante setup inicial em abril/26). EFS ativo `fs-07e76c09d3a1eb588` mantido (Uploads do genomaflow).

## Por que isso reverte parcialmente PR1 de [[session-2026-05-10-audit-pr1]]

PR1 (2026-05-10) tinha hardenizado o RDS com Multi-AZ + backup 30d + ECS desiredCount=2 por questão de HA. Onda 2 reverte parte disso porque a fatura está pesando demais pra fase MVP. **Quando contrato com SLA de uptime de cliente justificar o custo**, reativar Multi-AZ + desiredCount=2 (1 modify-db-instance + 1 cdk deploy reverso).

## Como conferir resultado real

Aguardar fatura de junho/2026 (chegará ~2026-07-01). Comparar via Cost Explorer dividindo por SERVICE.

Se a fatura cair menos que esperado, suspeitar primeiro de:
- Reserved Instances não compradas (Onda 3 ainda pendente)
- Auditty ainda cobrando ALB + ElastiCache mesmo com compute parado
- Onda 1 (ARM) ainda não aplicada
- Onda 4 (CloudFront) ainda não aplicada
