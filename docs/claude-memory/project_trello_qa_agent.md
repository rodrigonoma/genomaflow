---
name: Trello QA Agent (3 colunas / 3 prefixos)
description: Agente IA Trello — triagem read-only ao mover card pra QA/Ideias/Roadmap, /fix /ideia /roadmap aprovado edita codebase + push direto em main + deploy auto. Operacional 2026-05-14. Single-tenant interno.
type: project
---

# Trello QA Agent — Estado de Produção (3 colunas, 3 prefixos)

Pipeline completo Trello → webhook → BullMQ → Claude Tool Use → triagem ou fix.
**Operacional desde 2026-05-14.** Primeiro fix end-to-end: commit `7cea565`
(card #21 "Validação CPF"). Expandido pra 3 colunas no mesmo dia.

Spec: `docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md`.
Plan: `docs/superpowers/plans/2026-05-13-trello-qa-agent.md`.

## Mapeamento coluna → comando → kind

| Coluna Trello | List ID | Slash command | kind (job data) |
|---|---|---|---|
| **QA** | `69faa165e4236ac4b664c3c5` | `/fix` | `qa` |
| **Ideias** | `69faa0c0aaef882151345799` | `/ideia` | `ideia` |
| **Roadmap** | `69faa0c0aaef88215134579b` | `/roadmap` | `roadmap` |

Webhook detecta `listAfter.id` contra os 3 IDs (via `TRELLO_QA_LIST_ID` /
`TRELLO_IDEIAS_LIST_ID` / `TRELLO_ROADMAP_LIST_ID` envs). Slash command
regex `^/(fix|ideia|roadmap)\s+(aprovado|retry|detalhe|cancel)` aceita
os 3 prefixos com os mesmos 4 subcomandos.

**Comportamento idêntico pros 3 kinds atualmente** — mesmo system prompt
de triagem, mesma lógica de fix. Campo `kind` + `command_prefix` no job
data permite especializar prompts no futuro (ex: avaliar ROI de ideia vs
fazer fix de bug) sem refactor estrutural.

## Semântica dos slash commands

| Comando | O que faz | Mexe em código? |
|---|---|---|
| `<prefix> aprovado` | edita + `npm run test:unit` + **push DIRETO em main** + CI deploy auto | ✅ |
| `<prefix> retry` | RE-ANALISA (triagem nova, ignora análise anterior) | ❌ |
| `<prefix> retry: <hint>` | re-analisa com dica humana | ❌ |
| `<prefix> detalhe` | stub (análise extra futura) | ❌ |
| `<prefix> cancel` | marca card pra dev humano | ❌ |

`prefix` ∈ {fix, ideia, roadmap}. Mensagens de retorno do processor usam
o `command_prefix` correto pra orientar o usuário (ex: `/ideia retry`).

**User override do D10 ("PR nunca auto-merge"):** fluxo final pula PR e
pushea direto em main. CI deploy.yml dispara automaticamente. SEM human
review intermediário. Cap MAX_ATTEMPTS=5 por card protege contra custo
runaway.

## Componentes em produção

### Backend (apps/api)
| Arquivo | Responsabilidade |
|---|---|
| `db/migrations/105_trello_fix_attempts.sql` | Audit table append-only |
| `services/trello-fix-attempts.js` | CRUD audit. `countCompletedAttempts` conta SÓ `trigger_type='fix' AND status IN ('pr_opened','tests_failed')` — falhas de infra (`llm_failed`) NÃO contam |
| `services/trello-client.js` | REST wrap fetch + HMAC-SHA1 verify + 16384c truncate + encodeURIComponent defensivo |
| `queues/trello-qa-queue.js` | BullMQ producer (queue `trello-qa` — única pra 3 kinds, diferencia por job data) |
| `routes/webhooks/trello.js` | GET/HEAD healthcheck + POST. **HMAC sobre `request.rawBody`** (bytes originais). 3 listas + 3 prefixos. `kind` + `command_prefix` no job data |

### Worker (apps/worker)
| Arquivo | Responsabilidade |
|---|---|
| `lib/codebase-tools.js` | Tools Claude. `runTests` usa `npm run test:unit` pra scope=api (sem DB no container), `npm test` pros outros |
| `lib/github-pr.js` | `commitAndPushToMain`: unset extraheader cached → `git add` com allowlist explícito (sem `docs`) → commit → URL-embedded auth push direto em main. `GIT_TERMINAL_PROMPT=0` + 60s timeout. `_redactSecrets` em error msgs |
| `agents/trello-triage.js` | Claude loop READ-ONLY, aceita `hint` opcional pra re-análise. Timeout 180s por iter |
| `agents/trello-fix.js` | Claude loop FULL. Após loop: runTests gate → `commitAndPushToMain` se passa. Timeout 180s por iter |
| `services/trello-fix-attempts.js` | Duplicata controlada do mesmo arquivo em api (containers Docker isolados) |
| `services/trello-client.js` | Duplicata controlada do mesmo arquivo em api |
| `processors/trello-qa.js` | Orquestra 3 kinds. `_handleFix` lê `command_prefix` pra montar comments com prefix certo. `<prefix> aprovado` → fixCard; `<prefix> retry` → triageCard (read-only); cancel/detalhe → comment only |
| `index.js` | Worker `trello-qa` registrado, concurrency=1 |

### Worker Dockerfile (CRÍTICO)
```dockerfile
FROM node:20-slim                # NÃO Alpine (onnxruntime-node precisa glibc)
RUN apt-get install curl ca-certificates git
COPY apps/worker/package.json ./
RUN npm ci --production
RUN curl ... model.onnx
COPY apps/worker/src ./src
# Repo completo pra fix agent (working tree alinhado com HEAD):
COPY apps /app/repo/apps
COPY infra /app/repo/infra
COPY .github /app/repo/.github
COPY docs /app/repo/docs          # CRÍTICO: sem isso, git status mostra docs/* como deleted
COPY CLAUDE.md /app/repo/CLAUDE.md
COPY .git /app/repo/.git
# CRÍTICO: unset extraheader cached do actions/checkout
RUN cd /app/repo && git config --unset-all http.https://github.com/.extraheader 2>/dev/null || true
# npm ci em api+worker pra run_tests funcionar
WORKDIR /app/repo/apps/api && RUN npm ci ...
WORKDIR /app/repo/apps/worker && RUN npm ci ...
WORKDIR /app
CMD ["node", "src/index.js"]
```

### Infra
- 8 SSM secrets: `/genomaflow/prod/trello-*` (api-key, api-token, webhook-secret, board-id, qa-list-id, ideias-list-id, roadmap-list-id) + `github-bot-token`
- 4 env vars no task def: `WEBHOOK_CALLBACK_URL`, `TRELLO_TRIAGE_MODEL`, `TRELLO_FIX_MODEL`, `TRELLO_REPO_ROOT=/app/repo`
- Webhook Trello ID: `6a050cf2ae95e0d60c7cc7cc` (active)

## Pipeline `<prefix> aprovado` end-to-end

```
1. Trello → POST /api/webhooks/trello (HMAC sobre rawBody)
2. API valida HMAC + identifica kind (regex prefix + list ID match) + enfileira BullMQ trello-qa
3. Worker pega job → _handleFix
4. createAttempt(trigger='fix', attempt=N) → markRunning
5. trelloClient.getCard
6. fixCard agent:
   - Claude Tool Use loop (até MAX_ITERATIONS=30, timeout 180s/iter)
   - Tools: read_file, list_files, grep, edit_file, create_file (em /app/repo)
   - Loop sai quando agent diz FIX_DONE ou esgota iters
7. runTests({ scope: 'api', repoRoot: '/app/repo' }) → `npm run test:unit` no /app/repo/apps/api
   - SE falha → markCompleted(status='tests_failed'), comment ❌, FIM
8. commitAndPushToMain:
   - git config --unset-all http.extraheader (defensivo)
   - git config user.name/email
   - git add -- apps/{api,worker,web}/src apps/{api,worker}/tests  (allowlist SEM docs)
   - git commit -m "fix(trello-N): <card name>"
   - git push https://x-access-token:$PAT@github.com/.../HEAD:main
9. markCompleted(status='pr_opened', prUrl=commitUrl)
10. trelloClient.addComment "✅ Mergeado direto em main: <commit>"
11. CI deploy.yml dispara em push pra main → builda imagens → ECS update
```

## Limites operacionais

- **MAX_ATTEMPTS=5** por card (só conta `pr_opened`+`tests_failed`)
- **MAX_ITERATIONS** triage=20, fix=30
- **Timeout Anthropic** 180s por iter (Promise.race)
- **Timeout git ops** 60s por comando (`GIT_TERMINAL_PROMPT=0`)
- **Rate limit webhook** 600/h
- **Concurrency BullMQ** trello-qa = 1
- **Working tree** `/app/repo` (~150MB com node_modules de api+worker)

## Bugs encontrados e resolvidos pós-deploy (2026-05-13/14)

| # | Sintoma | Causa real | Fix |
|---|---|---|---|
| 1 | Worker crasha `ERR_DLOPEN_FAILED` em tasks novas | onnxruntime-node prebuild precisa glibc, Alpine usa musl | `FROM node:20-slim` |
| 2 | Processor crasha `Cannot find module ../../../api/src/services/...` | Worker container só tem `/app/src`, cross-app require resolve em `/api/...` inexistente | Duplicar services em `apps/worker/src/services/` |
| 3 | `pool.connect()` trava indefinidamente após "Job N event=triage" | Task def só tem DB_HOST/USER/PASSWORD secrets, não DATABASE_URL → pg tenta localhost | `poolConfig()` fallback igual `apps/api/src/plugins/postgres.js` |
| 4 | Anthropic SDK timeout não dispara | SDK 0.88 nem sempre honra config | `Promise.race` explícito 180s |
| 5 | Anthropic API "credit balance too low" 400 | Conta sem créditos | User adicionou créditos |
| 6 | `npm test` hang | API `npm test` precisa DB, container worker não tem | `runTests` usa `npm run test:unit` pra scope=api |
| 7 | Limite 5 attempts atinge cedo demais | Conta `llm_failed` (falhas de infra) | `WHERE status IN ('pr_opened','tests_failed')` |
| 8 | `git add -A` TIMEOUT 60s | Walk inclui node_modules (milhões de arquivos) | `git add -- <paths>` com allowlist explícito |
| 9 | Push falha "denied to github-actions[bot]" + "Duplicate Authorization" | `actions/checkout` carimba `http.extraheader` em `.git/config` com GITHUB_TOKEN do runner, vaza pro container | Dockerfile + runtime `git config --unset-all http.https://github.com/.extraheader` |
| 10 | PAT vazado em comment de erro no Trello | `git push` URL com `x-access-token:TOKEN` aparece em err.message | `_redactSecrets` regex no github-pr.js E no processor |
| 11 | Agente deletou 173 arquivos `docs/` em commit | Dockerfile copiava docs/ pra `/app/docs` (Copilot RAG), NÃO `/app/repo/docs` → working tree via docs como "deleted" → git add docs (allowlist) stage delete | (1) Dockerfile `COPY docs /app/repo/docs` (2) Remove `docs` do allowlist do git add |

## Não regredir

❌ Não voltar `git add -A` em `/app/repo` (timeout garantido com node_modules)
❌ Não remover `git config --unset-all http.extraheader` do Dockerfile ou runtime — extraheader cached do actions/checkout vai contaminar de novo
❌ Não voltar a usar `npm test` em scope=api no fix agent (precisa DB que container não tem)
❌ Não contar `llm_failed` em `countCompletedAttempts` — só `pr_opened` + `tests_failed`
❌ Não usar `request.body` re-serializado pra HMAC — sempre `request.rawBody`
❌ Não usar `node:20-alpine` no worker — onnxruntime-node sem prebuild musl
❌ Não voltar processor pra cross-app require `../../../api/src/services/...` — duplicar
❌ Não logar/comentar `err.message` no Trello sem passar por `_redactSecrets`
❌ Não remover `COPY docs /app/repo/docs` do Dockerfile — working tree desalinha com HEAD, agente comita deleções
❌ Não incluir `docs` no allowlist do `git add` em github-pr.js — agente de FIX DE CÓDIGO não deve mexer em docs

✅ Sempre `git config --unset-all http.https://github.com/.extraheader` em qualquer container que COPYa `.git` de workspace GitHub Actions
✅ Sempre `_redactSecrets()` em mensagens de erro que vão pra UI (Trello, Slack, e-mail, audit log público)
✅ Sempre fallback `DB_HOST`/`DB_PORT` em pg.Pool quando `DATABASE_URL` não está no ambiente
✅ Sempre `Promise.race` com timeout explícito ao chamar Anthropic SDK
✅ Sempre `git add` com allowlist em working trees que tenham node_modules baked-in
✅ Working tree do agente DEVE estar 1:1 com HEAD (sem arquivos missing) pra evitar deleções acidentais

## Smoke prod confirmado 2026-05-14

- Cards #22, #23 (QA): triagem IA real com análise estruturada
- Card #21 (QA): fix end-to-end completo — commit `7cea565` em main, CI deploy.yml dispara
- 3 colunas (QA/Ideias/Roadmap) operacionais com prefixos `/fix`, `/ideia`, `/roadmap`
