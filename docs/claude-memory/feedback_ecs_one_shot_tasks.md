---
name: Padrão de ECS one-shot tasks (migrate, reindex, jobs on-demand)
description: Como adicionar tasks Fargate disparadas pelo CI quando algo muda (migrations, reindex de RAG, qualquer job condicional)
type: feedback
---

Padrão para jobs one-shot disparados por mudança no repo — rodam em ECS Fargate sob demanda, sem ficar permanentemente no ar. Atualmente usado por:

- `genomaflow-prod-migrate`: aplica migrations SQL quando há arquivo novo em `apps/api/src/db/migrations/`
- `genomaflow-prod-reindex-help`: reindexa docs/ do Copilot quando há mudança em `docs/` ou `CLAUDE.md`

## Receita completa (3 arquivos)

### 1. Task definition no CDK (`infra/lib/ecs-stack.ts`)

```typescript
const myJobTask = new ecs.FargateTaskDefinition(this, 'MyJobTask', {
  family:         'genomaflow-prod-myjob',  // CI procura por esse family name
  memoryLimitMiB: 512,   // ajustar se o job precisar
  cpu:            256,
  executionRole,
  taskRole,
});

myJobTask.addContainer('myjob', {
  // Usar apiRepo pra jobs de DB (tem migrations); workerRepo pra jobs que precisam de docs/
  image:       ecs.ContainerImage.fromEcrRepository(apiRepo, 'latest'),
  // ⚠️ SEMPRE spreadar backendEnv. Carrega NODE_TLS_REJECT_UNAUTHORIZED=0
  // que é necessário pra pg aceitar a cert chain do RDS via ?sslmode=require.
  // Sem isso, o job falha com SELF_SIGNED_CERT_IN_CHAIN ao conectar no banco
  // (incidente 2026-04-30: migrate/reindex tinham só { NODE_ENV: 'production' }).
  // Pra adicionar env vars específicas do job: { ...backendEnv, MINHA_VAR: 'x' }
  environment: backendEnv,
  secrets:     backendSecrets,
  command: [
    'sh', '-c',
    'export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" && node src/path/to/job.js'
  ],
  logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'myjob', logGroup }),
});
```

Deploy da task def: `cd infra && npx cdk deploy genomaflow-ecs`. Uma vez aplicado, o task existe na conta AWS indefinidamente (novas imagens são auto-referenciadas via `:latest`).

### 2. Step no CI (`.github/workflows/deploy.yml`)

```yaml
      - name: Run my job (condicional)
        run: |
          CLUSTER="genomaflow"

          # Condição: só roda se o arquivo X mudou neste push
          CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -E "^path/to/watch" | head -5 || true)
          if [ -z "$CHANGED" ]; then
            echo "Sem mudanças — skip"
            exit 0
          fi

          TASK_DEF=$(aws ecs list-task-definitions \
            --family-prefix genomaflow-prod-myjob \
            --sort DESC \
            --query "taskDefinitionArns[0]" --output text)

          if [ "$TASK_DEF" = "None" ] || [ -z "$TASK_DEF" ]; then
            echo "⚠️ Task def não existe. Rodar: cd infra && npx cdk deploy genomaflow-ecs"
            exit 0   # não derrubar deploy
          fi

          SUBNET=$(aws cloudformation describe-stacks --stack-name genomaflow-vpc \
            --query 'Stacks[0].Outputs[?OutputKey==`PublicSubnet1`].OutputValue' --output text)
          SG=$(aws cloudformation describe-stacks --stack-name genomaflow-vpc \
            --query 'Stacks[0].Outputs[?OutputKey==`SgEcsId`].OutputValue' --output text)

          TASK_ARN=$(aws ecs run-task --cluster "$CLUSTER" \
            --task-definition "$TASK_DEF" --launch-type FARGATE \
            --network-configuration \
              "awsvpcConfiguration={subnets=[$SUBNET],securityGroups=[$SG],assignPublicIp=ENABLED}" \
            --query "tasks[0].taskArn" --output text)

          aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"

          EXIT_CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
            --query "tasks[0].containers[0].exitCode" --output text)

          if [ "$EXIT_CODE" != "0" ]; then
            echo "⚠️ Job falhou (exit $EXIT_CODE)"
            TASK_ID=$(echo "$TASK_ARN" | awk -F'/' '{print $NF}')
            aws logs get-log-events --log-group-name /genomaflow/prod \
              --log-stream-name "myjob/myjob/$TASK_ID" \
              --query 'events[*].message' --output text || true
            exit 0   # decida: falhar deploy (exit 1) ou continuar
          fi
          echo "✅ Job concluído"
```

### 3. Script do job (onde for apropriado)

Se é job de DB (migration-like), colocar em `apps/api/src/...` e usar a imagem do `apiRepo`. Se precisa de recursos fora do código (docs, assets), considerar colocar no `workerRepo` e adicionar os recursos ao Dockerfile via `COPY` com context raiz.

## Decisões que já tomamos

- **API repo vs Worker repo**: jobs de DB puro (migrate) usam `apiRepo`. Jobs que precisam de arquivos do repo fora de `apps/` (docs, CLAUDE.md) usam `workerRepo` com Dockerfile que faz `COPY docs /app/docs`.
- **Falha não derruba deploy**: se o job é de valor mas não crítico (reindex), logar erro e `exit 0`. Se é crítico (migrate), `exit 1` trava o pipeline.
- **`:latest` tag**: CDK referencia `:latest` do ECR. Como o deploy workflow faz `register-task-definition` explícito pras services, o task def de one-shot resolve `:latest` dinamicamente — pega sempre a imagem mais recente sem precisar re-registrar.

## Armadilhas conhecidas

- **`PubliclyAccessible=false` no RDS**: task precisa rodar em subnet da VPC do banco. CI usa `cloudformation describe-stacks` pra pegar subnet/SG corretos. Não tente rodar o job do runner do GitHub diretamente — não tem acesso à VPC.
- **Task def criada via CDK não aparece sem `cdk deploy`**: se só editar o `.ts` e fazer push, o CI vai skipar com "⚠️ Task def não existe". Fluxo correto: editar CDK → `cdk deploy` (aplica na AWS) → commit na mesma PR (versiona em git).
- **`assignPublicIp=ENABLED`**: necessário pra task pegar imagem do ECR e acessar APIs externas (OpenAI no caso do reindex). Em subnet privada com NAT gateway, `DISABLED` funciona também mas custa mais.

**Why:** 2026-04-24 — implementação do reindex do Copilot. O plano inicial tinha `skip-if-missing` mas isso escondia o fato de que o task def não existia. Lição: se vai adicionar task CDK nova, fazer os 2 passos (CDK + CI) no mesmo PR e rodar `cdk deploy` **antes** do merge, pra CI já encontrar o task def na primeira execução.

**How to apply:** Toda vez que precisar de um job condicional (backfill, cleanup, reindex), seguir a receita acima. Copiar estrutura do `genomaflow-prod-migrate` ou `genomaflow-prod-reindex-help` como modelo vivo.
