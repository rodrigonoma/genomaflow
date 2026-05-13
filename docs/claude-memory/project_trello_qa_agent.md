---
name: Trello QA Agent
description: Agente IA que pega cards da coluna QA do Trello (webhook), faz triagem crítica (análise + impact + test plan + risco), e sob /fix aprovado edita codebase + roda testes + abre PR. Entregue 2026-05-13. Single-tenant interno.
type: project
---

# Trello QA Agent

Pipeline completo Trello → webhook → BullMQ → Claude Tool Use → triagem ou fix.

Spec: `docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md`.
Plan: `docs/superpowers/plans/2026-05-13-trello-qa-agent.md`.

## Componentes entregues

### Backend (apps/api)

| Arquivo | Função |
|---|---|
| `db/migrations/105_trello_fix_attempts.sql` | Audit table (trigger_type/status state machine, attempt counter, tokens/custo) |
| `services/trello-fix-attempts.js` | CRUD audit (createAttempt, markRunning/Completed/Failed, getLastAttempt, countCompletedAttempts) + enums + MAX_ATTEMPTS=5 |
| `services/trello-client.js` | REST wrap (fetch direto, sem lib oficial) + HMAC-SHA1 verify + 16384 char truncate em comentário + encodeURIComponent defensivo em cardId/labelId/boardId |
| `queues/trello-qa-queue.js` | BullMQ producer singleton (queue `trello-qa`, attempts=1, removeOnComplete age 1h) |
| `routes/webhooks/trello.js` | GET/HEAD healthcheck + POST com HMAC + dispatch (updateCard→triage / commentCard `/fix`→fix). Rate limit 600/h. **Usa request.rawBody (bytes originais) para HMAC** — não JSON.stringify(request.body) |
| `server.js` | Registro de rota em `/api/webhooks/trello` |

### Worker (apps/worker)

| Arquivo | Função |
|---|---|
| `lib/codebase-tools.js` | Tools Claude: read_file/list_files/grep (read-only) + edit_file/create_file/run_tests/run_lint. Allowlist `EDITABLE_PREFIXES` (apps/{api,worker,web}/src/, docs/, tests/) + `BLOCKED_PATTERNS` (infra/, .github/, migrations/*.sql, package.json root, Dockerfile, aws/, node_modules/). MAX_FILE_SIZE=50KB. Anti-traversal `..` |
| `lib/github-pr.js` | Octokit wrapper (createBranchAndPR + commitAndPushBranch via git CLI nativo — não Contents API porque tem limite ~1MB/commit) |
| `agents/trello-triage.js` | Claude Tool Use loop READ-ONLY. MAX_ITERATIONS=20. System prompt gera JSON estruturado {type, makes_sense, opinion, technical_details[], impact[], test_plan[], risk}. buildAnalysisComment renderiza markdown PT-BR |
| `agents/trello-fix.js` | Claude Tool Use loop FULL (edit_file + create_file + run_tests). MAX_ITERATIONS=30. **Gate de testes obrigatório antes do PR** — se npm test falha, retorna `tests_failed` sem criar branch/PR. Branch pattern `trello/<idShort>/fix-<attempt>` |
| `processors/trello-qa.js` | Orquestra triage/fix. Cross-app require de apps/api/src/services (válido em CI Docker context=repo root). Slash commands handled: aprovado, retry, retry: hint, detalhe (stub), cancel. MAX_ATTEMPTS=5 enforced |
| `index.js` | Worker `trello-qa` registrado, concurrency=1 (fix é caro: LLM + tests + git) |

### Infra

| Arquivo | Função |
|---|---|
| `infra/lib/ecs-stack.ts` | 6 SSM secrets em backendSecrets (compartilhado API+Worker): TRELLO_API_KEY, TRELLO_API_TOKEN, TRELLO_WEBHOOK_SECRET, TRELLO_BOARD_ID, TRELLO_QA_LIST_ID, GITHUB_BOT_TOKEN. 4 env vars em backendEnv: WEBHOOK_CALLBACK_URL, TRELLO_TRIAGE_MODEL, TRELLO_FIX_MODEL, TRELLO_REPO_ROOT |

## Pipeline

```
Trello (card move/comment) 
  → POST /api/webhooks/trello (HMAC SHA1 sobre rawBody+callbackUrl)
  → BullMQ enqueue { event: triage|fix, card_id, slash_command?, hint? }
  → Worker trello-qa
     IF event=triage:
        createAttempt(attempt=0, trigger=triage) → markRunning
        triageCard (Claude loop read-only, MAX 20 iter)
        addComment markdown (🤖 Análise Automática)
        markCompleted
     IF event=fix:
        ▸ detalhe → comentário stub
        ▸ cancel  → createAttempt(trigger=cancel) + comentário
        ▸ aprovado|retry:
             se countCompleted >= 5 → comentário limite atingido (sem attempt)
             senão: createAttempt(attempt=N+1, trigger=fix|retry, hint?) → markRunning
                fixCard (Claude loop full, MAX 30 iter)
                runTests → SE FAIL: markCompleted(status=tests_failed) + comentário ❌ + stdout
                                SE PASS: commitAndPushBranch + createBranchAndPR
                                          markCompleted(status=pr_opened, pr_url) + comentário ✅
```

## Slash commands

| Comando | Trigger | Comportamento |
|---|---|---|
| `/fix aprovado` | comentário em qualquer card | Cria fix attempt, edita, testa, abre PR (se passa) |
| `/fix retry` | mesmo | Como aprovado mas trigger_type=retry (incrementa attempt) |
| `/fix retry: <hint>` | mesmo | Como retry mas injeta hint humano no prompt do agente |
| `/fix detalhe` | mesmo | Stub MVP — comentário informando feature futura |
| `/fix cancel` | mesmo | Marca card pra dev humano, agente para de responder |

## Secrets

6 SSM Parameter Store params em `/genomaflow/prod/trello-*` + `/genomaflow/prod/github-bot-token`. CDK ecs-stack.ts injeta via `ecs.Secret.fromSsmParameter` em containerDefinitions[].secrets (API + Worker, via backendSecrets shared).

**Operator manual antes do cdk deploy:**

```bash
aws ssm put-parameter --name /genomaflow/prod/trello-api-key       --type SecureString --value "<KEY>"
aws ssm put-parameter --name /genomaflow/prod/trello-api-token     --type SecureString --value "<TOKEN>"
aws ssm put-parameter --name /genomaflow/prod/trello-webhook-secret --type SecureString --value "$(openssl rand -hex 32)"
aws ssm put-parameter --name /genomaflow/prod/trello-board-id      --type String       --value "<BOARD_ID>"
aws ssm put-parameter --name /genomaflow/prod/trello-qa-list-id    --type String       --value "<QA_LIST_ID>"
aws ssm put-parameter --name /genomaflow/prod/github-bot-token     --type SecureString --value "<GH_PAT_repo_scope>"
```

**Operator manual após cdk deploy:**

```bash
curl -X POST "https://api.trello.com/1/webhooks/?key=<KEY>&token=<TOKEN>" \
  -d 'description=GenomaFlow QA Agent' \
  -d 'callbackURL=https://app.genomaflow.com.br/api/webhooks/trello' \
  -d 'idModel=<BOARD_ID>'
```

Trello chama HEAD/GET no callbackURL na criação — endpoint já responde 200.

## Limites operacionais

- MAX_ATTEMPTS=5 por card (depois força `/fix cancel`)
- MAX_ITERATIONS=20 no loop triagem (read-only)
- MAX_ITERATIONS=30 no loop fix (full)
- Rate limit webhook 600/h (Trello fan-out tipicamente <50/h)
- Concurrency BullMQ trello-qa = 1 (fix é caro)
- Test gate obrigatório antes do PR (`r.status === 'tests_failed'` curto-circuita)
- Allowlist explícita de paths editáveis (não pode editar infra/, migrations/, .github/, package.json root)
- Cost estimate inline: $3/1M input + $15/1M output (Claude Sonnet 4.6)

## Cobertura de testes (61 testes novos)

- T1: migration only
- T2: 12 testes trello-fix-attempts (CRUD + state machine + truncate 500 chars error_message)
- T3: 9 testes trello-client (HMAC valid/invalid/empty + REST wrap + truncate 16384 chars + status non-OK)
- T4: 9 testes webhook (GET/HEAD healthcheck + 401 signature + dispatch triage/fix/no-op + slash command regex hint extraction)
- T5: 24 testes codebase-tools (allowlist 9 + readFile 3 + listFiles 1 + grep 2 + editFile 4 + createFile 3 + schemas 2)
- T6: 2 testes github-pr (happy path Octokit + missing GITHUB_BOT_TOKEN throws)
- T7: 7 testes trello-triage (1-shot + multi-turn + 20 iter breaker + BAD_LLM_OUTPUT + markdown render yes/partial/no)
- T8: 4 testes trello-fix (happy path PR + tests_failed sem PR + hint injection + branch naming)
- T9: processor (cobertura indireta via T7+T8)

Total: 61 testes verdes na branch. `npm test` worker reportou 272/272 com 0 regressões em outras suites.

## Decisões críticas (D1-D10 do spec)

- **D1** Triagem AGORA (no card-move) + fix SOB DEMANDA (slash command)
- **D2** Webhook Trello (não polling)
- **D3** Slash command no comentário (recomendado vs label move)
- **D4** Família completa `/fix aprovado | retry | retry: hint | detalhe | cancel`
- **D5** Tests_failed comenta NO CARD (stdout truncado) — dev decide retry com hint
- **D6** Single tenant interno (1 board), no RLS, no withTenant
- **D7** Qualquer membro do board pode aprovar (small team)
- **D8** PR nunca auto-merge (revisão humana obrigatória)
- **D9** MAX_ATTEMPTS=5 / card (cost cap)
- **D10** PR + comentário no card linkado (não direct merge)

## Auditoria & cost tracking

Tabela `trello_fix_attempts` grava per attempt:
- tokens_input/output, llm_cost_usd estimado
- pr_url, branch_name (quando aplicável)
- test_summary jsonb (passed/failed/skipped)
- processing_ms
- error_code, error_message (truncate 500 chars)

Audit append-only — sem trigger automático (single-tenant interno, sem PII).

## Pendências conhecidas

- `/fix detalhe` é stub MVP — implementar análise profunda do último erro (re-prompt com test stdout)
- Scope hard-coded `api` no `fixCard` — auto-detect baseado em files editados seria melhor
- Sem multi-tenant — fora de escopo MVP (board único do time interno)
- Cross-app require `apps/worker/.../../../api/src/services/...` funciona no CI (Docker context=repo root, todos os apps copiados) MAS quebra em local docker-compose isolado (mesmo padrão pré-existente do aestheticDepth processor)

## Não regredir

❌ Não desabilitar gate de testes antes do PR (`runTests` é mandatório)
❌ Não permitir agente editar `infra/`, `migrations/*.sql`, `.github/`, root `package.json`, `Dockerfile` (BLOCKED_PATTERNS em codebase-tools.js)
❌ Não auto-mergear PR (Octokit nunca chama `merge`)
❌ Não passar attempt > 5 (countCompletedAttempts gate em processor)
❌ Não usar JSON.stringify(request.body) para HMAC (re-serialização quebra signature em prod com Trello bytes)
❌ Não remover encodeURIComponent dos IDs em trello-client (defense em depth contra path injection)
❌ Não rodar git stash em qualquer fluxo do agente — WIP vira commit `WIP:` na branch dele

✅ HMAC SEMPRE sobre `request.rawBody` (server.js já expõe via addContentTypeParser parseAs=buffer)
✅ Allowlist `EDITABLE_PREFIXES` é a primeira linha de defesa — toda edit/create checa via `isEditableAllowed`
✅ PR sempre referenciado pelo card via "Closes Trello card https://trello.com/c/<short>" no body
✅ Comentário no card sempre quando attempt termina (sucesso ou falha) — usuário não fica no escuro

## Smoke prod (operator)

1. Confirmar deploy verde no GitHub Actions
2. Aplicar `cdk deploy genomaflow-ecs --require-approval never`
3. Mover card de teste pra coluna QA → aguardar ~30s
4. Verificar comentário "🤖 Análise Automática"
5. Conferir row em `trello_fix_attempts` com `attempt=0, status=completed`
6. Comentar `/fix aprovado` → aguardar ~2-5min
7. Conferir worker CloudWatch logs + PR no GitHub + comentário ✅/❌ no card
