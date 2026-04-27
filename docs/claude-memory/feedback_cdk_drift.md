---
name: CDK drift — config out-of-band perde quando cdk deploy regenera
description: cdk deploy regenera task def baseado no código IaC; tudo setado via console AWS é perdido. Configs críticas SEMPRE no IaC.
type: feedback
---

**Quando o cdk deploy regenera um recurso (task def, ALB rule, etc.), ele zera tudo que estava out-of-band.** Tudo que o operador setou via console AWS, AWS CLI, ou register-task-definition manual é perdido na próxima execução do CDK.

**Why:** Em 2026-04-27, cutover split landing × app. cdk deploy regenerou task def da API. Login quebrou em prod com `no pg_hba.conf entry ... no encryption`. Causa: DATABASE_URL no command tinha `?sslmode=require` adicionado manualmente fora do CDK. CDK regenerou sem `?sslmode=require`. RDS rejeitou conexão sem SSL.

Outros lugares perdidos no mesmo deploy:
- Env vars `S3_BUCKET=genomaflow-uploads-prod` (perdida)
- Env var `AWS_REGION=us-east-1` (perdida)
- `DATABASE_URL` query string `?sslmode=require` (perdida — incidente)

Resolução: 5 minutos de produção quebrada + cdk deploy de fix com `?sslmode=require` no command de api/worker/migrate/reindex.

**How to apply:**
1. **Antes de qualquer cdk deploy**, comparar task def atual em prod (`aws ecs describe-task-definition`) com o que está no código (`infra/lib/ecs-stack.ts`). Diferença = drift = vai sumir.
2. Se houver drift: trazer pro código ANTES do cdk deploy. Não rodar deploy esperando que CFN preserve.
3. Configs críticas que não pertencem ao IaC (ex: DATABASE_URL com sslmode, certificados pinned manualmente) viram **bug latente** — registrar imediatamente em memória + adicionar ao IaC.
4. Em incidente, lembrar do drift como primeiro suspeito após qualquer cdk deploy. Diff das últimas 2-3 task defs é o caminho mais rápido (`aws ecs describe-task-definition --task-definition <family>:<rev>`).
5. CI/CD que faz `aws ecs register-task-definition` copiando da última definition AINDA preserva valores out-of-band — mas o primeiro `cdk deploy` depois disso zera tudo.

**Padrão preventivo:** todo env var, command, secret reference deve estar no `infra/lib/*.ts`. Se não está, é dívida técnica até virar incidente.
