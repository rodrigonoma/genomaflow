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

### Onda 4 — Angular S3+CloudFront, deletar Web ECS (PENDENTE)
**Branch:** `perf/cost-reduction-wave-4` (7497bbf) — pronta mas NÃO aplicada.
**Mudanças:** Novo `static-site-stack.ts` (S3 + CloudFront com /api/* origin pro ALB), deploy-web reescrito (build Angular + sync S3 + CF invalidate), ARecord app.* migrado de ALB pro CloudFront.
**Economia projetada:** USD 25/mês.

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
