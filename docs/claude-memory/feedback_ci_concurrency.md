---
name: CI/CD — concurrency cap obrigatório em workflows de deploy
description: Workflow sem concurrency.group satura runners + race condition no ECS update-service. Pushes consecutivos para main acumulam runs simultâneos que travam mutuamente. Incidente 2026-05-12 — 20 runs em paralelo por 10h, 0 chegou em prod.
type: feedback
---

# CI/CD — concurrency cap em deploy workflows (OBRIGATÓRIO)

**Regra:** todo workflow `.github/workflows/*.yml` que faz deploy/update-service/migrations DEVE ter o bloco abaixo logo após `on:`:

```yaml
concurrency:
  group: deploy-<env>     # 'deploy-production' pra deploy.yml, 'deploy-mobile' pra deploy-mobile.yml, etc.
  cancel-in-progress: true
```

**Why:**
GitHub Actions sem `concurrency` permite runs paralelos ilimitados. Para deploys, isso é catastrófico:
1. **Saturação de runners** — free tier limita runners simultâneos; o resto fica `in_progress` aguardando, mas no UI parece estar rodando.
2. **Race condition no ECS update-service** — múltiplos `aws ecs update-service` paralelos podem registrar task definitions em ordem não-determinística, deployar imagens antigas por cima de novas.
3. **Race condition em migrations** — `genomaflow-prod-migrate` task pode rodar 2x simultaneamente, tentar aplicar a mesma migration em paralelo, falhar com erro de duplicate key.
4. **Worker tests travam** — observado: API tests passam, mas Worker tests ficam `in_progress` indefinidamente quando muitos jobs concorrem ao mesmo runner.

**How to apply:**
- Em criação de novo workflow de deploy: adicionar concurrency desde o primeiro commit.
- Em workflow existente sem concurrency: adicionar via PR de prioridade alta. O CI fica "incoerente" enquanto não tiver isso.
- Para workflows de teste/lint (que rodam por PR, não por merge), concurrency é opcional — não há risco de race em recurso compartilhado.

## Incidente 2026-05-12 — referência forense

Cenário: 30+ pushes consecutivos para `main` durante implementação de F1-F6 + 13 TODOs polish em ~9 horas. `deploy.yml` não tinha `concurrency`.

Sintomas observados:
- `gh run list --workflow=deploy.yml --status=in_progress --limit=50` retornou **20 runs in_progress** simultâneos.
- Run mais antigo (F5.2, 00:52 UTC) ainda travado em "Worker — install + unit tests" às 11:00 UTC — 10 horas depois.
- API tests passavam em segundos; Worker tests nunca completavam.
- 0 commits dos 30 atingiram produção real (todos travados antes do step `update-service`).

Resolução aplicada:
1. `gh run cancel <id>` em loop para os 20 in_progress.
2. Commit + push do `concurrency` config (commit `b246192`).
3. Próximo push (do fix patient-create) entrou na fila e completou normalmente.

**Hora-perdida**: ~10h de "achar que estava deployando" enquanto a fila se acumulava silenciosamente.

## Detecção precoce

Sintomas a observar:
- `gh run list` mostra >3 runs `in_progress` simultâneos no mesmo workflow de deploy.
- Run individual com >30min no mesmo step (especialmente test step que deveria ser segundos).
- Push novo termina em "queued" indefinidamente.

Se qualquer um aparecer, rodar `gh run cancel` em todos exceto o mais recente + verificar o workflow tem `concurrency`.

## Workflows GenomaFlow

- `.github/workflows/deploy.yml` — `concurrency: deploy-production / cancel-in-progress: true` (adicionado 2026-05-12)
- `.github/workflows/deploy-mobile.yml` — pendente verificação (tag-triggered, raramente paralelo, baixa prioridade)
- Outros workflows (caso existam): auditar individualmente.

## Anti-pattern

❌ NÃO usar `cancel-in-progress: false` — pra deploy isso é exatamente o problema (acumula).
❌ NÃO usar `group: ${{ github.ref }}` em deploy de main — só faz cancel se mesma branch, o que é ok porém menos explícito.
✅ USAR `group: deploy-<env>` (literal) — torna óbvio que é por ambiente, não por branch/PR.
