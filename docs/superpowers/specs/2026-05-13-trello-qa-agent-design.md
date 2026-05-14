# Trello QA Agent — Design

**Topic:** Integração Trello board interno do GenomaFlow + agente IA que enriquece cards na coluna QA e, sob aprovação humana, abre PR com fix.

**Branch:** `feat/trello-qa-agent` (ainda não criada).

---

## 1. Objetivo

Reduzir tempo entre "QA reporta problema" e "PR pronto pra review". Hoje, dev tem que ler card, entender, achar arquivo, escrever fix, criar PR. Agente faz:

- **Automaticamente** (quando card chega na QA): análise crítica + spec de implementação + impact analysis + plano de testes — tudo comentado no card pro dev/PO revisar.
- **Sob aprovação humana** (após `/fix aprovado`): edita código no codebase, roda testes locais, e SE testes passam, abre PR no GitHub e linka no card. Nunca auto-merge.

Não substitui dev — acelera o fluxo de triage→fix mantendo controle humano em todos os pontos críticos.

---

## 2. Decisões travadas

| # | Decisão | Justificativa |
|---|---|---|
| D1 | Triagem automática + auto-fix on-demand | Risco controlado: análise sempre, edição só com aprovação |
| D2 | Webhook Trello (real-time) com cron fallback opcional futuro | Latência segundos vs minutos do polling |
| D3 | Agente faz enriquecimento profundo: tipo + opinião + detalhes + impact + testes | Pedido explícito do usuário; valor agregado pra dev/PO |
| D4 | Trigger fix via comentário `/fix aprovado` (slash commands) | Auditável via histórico de comentários, fluxo natural Trello |
| D5 | Família completa de slash commands (`aprovado | retry | retry:hint | detalhe | cancel`) | Permite iteração humana sobre falhas sem perder contexto |
| D6 | Testes locais no worker antes de criar PR; falha = nunca PR | "Jamais quebrar funcionalidade" — premissa crítica do usuário |
| D7 | 1 board interno (não multi-tenant) | Ferramenta de dev/PO, não produto B2B |
| D8 | Qualquer membro do board pode aprovar `/fix` | Confiança no controle Trello + auditoria nossa |
| D9 | Max 5 attempts/card | Evitar loop infinito + cost cap |
| D10 | PR nunca auto-merge | Humano sempre revisa |

---

## 3. Arquitetura

```
┌──────────────┐  webhook   ┌──────────────┐  enqueue   ┌──────────────┐
│ Trello board │ ─────────▶ │ apps/api     │ ─────────▶ │ apps/worker  │
│ (coluna QA)  │            │ /webhooks/   │            │ trello-qa    │
│              │            │ trello       │            │ (bullmq)     │
└──────────────┘            └──────────────┘            └──────┬───────┘
       ▲                                                       │
       │                          comments / labels            │
       └───────────────────────────────────────────────────────┘
                                                               │
       ┌───────────────────────────────────────────────────────┤
       │                                                       │
   ┌───┴────┐                                       ┌──────────┴───────┐
   │ Trello │◀──── PR url linkado                   │ Claude API       │
   │ Card   │                                       │ + Tool Use loop  │
   └────────┘                                       └──────────┬───────┘
                                                               │
                                                          ┌────┴────┐
                                                          │ GitHub  │
                                                          │ create  │
                                                          │ PR via  │
                                                          │ Octokit │
                                                          └─────────┘
```

### 3.1 Fluxo Triagem (automático)

1. Card movido pra coluna QA → Trello envia `POST /webhooks/trello` com `action.type=updateCard`
2. API valida HMAC signature (`X-Trello-Webhook` header) + parse event
3. Enqueue BullMQ job `trello-qa` com `{ event: 'triage', card_id, board_id }`
4. Worker pega job:
   - Fetch card via Trello API (name + desc + attachments + comments anteriores)
   - Claude Agent loop com tools read-only: `read_file`, `list_files`, `grep`, `get_card_history`
   - Agente produz output estruturado: tipo (bug/feature/copy/etc) + análise crítica + detalhes técnicos + impact list + test plan
5. Worker atualiza card via Trello API:
   - Aplica labels apropriadas
   - Adiciona checklist com itens do test plan
   - Comenta análise completa em markdown
6. Registra audit: `trello_fix_attempts(card_id, attempt=0, trigger_type='triage', status='completed')`

### 3.2 Fluxo Fix (sob aprovação)

1. Dev/PO comenta `/fix aprovado` (ou variantes) no card
2. Trello webhook `action.type=commentCard` → API
3. API valida que comment começa com `/fix` + identifica subcommando + member é do board
4. Enqueue `trello-qa` com `{ event: 'fix', card_id, comment_text, member_username, attempt: N }`
5. Worker:
   - Verifica `attempt <= 5`, senão comenta "limite atingido" e desiste
   - Claude Agent loop com tools full: `read_file`, `list_files`, `grep`, `edit_file`, `run_tests`
   - Agente edita arquivos necessários no codebase clonado
   - Roda `npm test --runInBand` na pasta afetada (api/worker/web)
   - Se passou:
     - Cria branch `trello/<short_id>/fix-<attempt>`
     - Commit com mensagem `fix(<scope>): <card name>\n\nTrello #<short_id>\nApproved by @<member>`
     - Push + criar PR via Octokit, target `main`
     - Comenta no card: `✅ PR aberto: <url>. Aguardando review humano.`
   - Se falhou:
     - NÃO cria PR
     - Comenta no card com lista de testes falhados + análise + sugestões de retry
6. Registra audit completo: tokens LLM, custo USD, tempo, status

### 3.3 Subcomandos `/fix`

| Comando | Effect | Validação |
|---|---|---|
| `/fix aprovado` | Triggers attempt 1 | `attempt = 0` (não houve fix antes) ou prévio falhou |
| `/fix retry` | Re-tenta mesma análise | `attempt > 0` e prévio falhou |
| `/fix retry: <hint>` | Re-tenta com hint humano injetado no prompt | mesmo de retry; hint sanitizado (max 500 chars) |
| `/fix detalhe` | Agente comenta análise profunda do último erro | qualquer status |
| `/fix cancel` | Marca card "ai-cancelled", ignora futuros `/fix` | qualquer status |

Max 5 attempts/card. 6º `/fix retry` recebe resposta `Limite atingido, dev humano necessário`.

---

## 4. Stack & dependências

| Item | Versão | Justificativa |
|---|---|---|
| `@anthropic-ai/sdk` | já instalado | Claude Messages API + Tool Use |
| `@octokit/rest` | a instalar | GitHub API |
| Trello REST API direto via `fetch` | nativo | Sem lib oficial Trello pra Node estável |
| `bullmq` | já instalado | Queue isolation, concurrency 1 |
| `simple-git` (opcional) | a avaliar | Pode usar `child_process` shell git direto |

### 4.1 Estrutura de arquivos

```
apps/api/
├── src/routes/webhooks/trello.js       (NOVO)  webhook receiver
├── src/services/trello-client.js       (NOVO)  REST wrap

apps/worker/
├── src/queues/trello-qa-queue.js       (NOVO)  bullmq producer/consumer
├── src/agents/trello-triage.js         (NOVO)  Claude loop triage
├── src/agents/trello-fix.js            (NOVO)  Claude loop fix
├── src/lib/codebase-tools.js           (NOVO)  read/list/grep/edit/test tools
├── src/lib/github-pr.js                (NOVO)  Octokit wrapper

apps/api/src/db/migrations/
└── 105_trello_fix_attempts.sql         (NOVO)  audit trail

docs/claude-memory/
└── project_trello_qa_agent.md          (depois da entrega)
```

---

## 5. Migration 105 `trello_fix_attempts`

```sql
CREATE TABLE IF NOT EXISTS trello_fix_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id         TEXT NOT NULL,
  card_short_id   TEXT NOT NULL,
  attempt         INT NOT NULL,                              -- 0 = triagem; 1,2... = fix attempts
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN
                    ('triage','fix','retry','detalhe','cancel')),
  triggered_by    TEXT NOT NULL,                              -- username Trello
  hint            TEXT,                                       -- /fix retry: <hint>
  status          TEXT NOT NULL CHECK (status IN
                    ('queued','running','pr_opened','tests_failed','llm_failed',
                     'cancelled','limit_reached','completed')),
  pr_url          TEXT,
  branch_name     TEXT,
  test_summary    JSONB,                                      -- { passed, failed, skipped, failures: [...] }
  llm_tokens_input   INT,
  llm_tokens_output  INT,
  llm_cost_usd    NUMERIC(10, 4),
  processing_ms   INT,
  error_code      TEXT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_trello_attempts_card ON trello_fix_attempts (card_id, attempt DESC);
CREATE INDEX idx_trello_attempts_status ON trello_fix_attempts (status, created_at)
  WHERE status IN ('queued','running');
```

Sem RLS — feature interna single-tenant. Audit trigger genérico não aplicado (sem `tenant_id`).

---

## 6. Credenciais (SSM Parameter Store, prod)

| Parameter | Conteúdo |
|---|---|
| `/genomaflow/prod/trello-api-key` | API key da conta admin |
| `/genomaflow/prod/trello-api-token` | Token OAuth Trello (perpetual) |
| `/genomaflow/prod/trello-webhook-secret` | HMAC secret pra validar webhook |
| `/genomaflow/prod/trello-board-id` | ID do board QA interno |
| `/genomaflow/prod/trello-qa-list-id` | ID específico da coluna "QA" |
| `/genomaflow/prod/github-bot-token` | PAT scopo `repo` no genomaflow |
| `/genomaflow/prod/anthropic-api-key` | já existe; reusa |

Task definition ECS atualizada via CDK (`infra/lib/ecs-stack.ts`) com `secrets` apontando pra cada.

---

## 7. Tool definitions (Claude Tool Use)

### 7.1 Triagem (read-only)

| Tool | Args | Returns |
|---|---|---|
| `read_file` | path | Conteúdo do arquivo (max 50KB) |
| `list_files` | dir, glob? | Lista de paths |
| `grep` | pattern, path? | Matches com line numbers |
| `get_card_comments` | card_id | Histórico de comentários do card |

### 7.2 Fix (read + write + test)

| Tool | Args | Returns |
|---|---|---|
| `read_file` | path | mesmo |
| `list_files` | dir | mesmo |
| `grep` | pattern | mesmo |
| `edit_file` | path, old_string, new_string | OK ou erro |
| `create_file` | path, content | OK ou erro |
| `run_tests` | scope (api/worker/web) | { passed, failed, output } |
| `run_lint` | scope | OK ou warnings |

Allowlist de paths editáveis: `apps/api/src/**`, `apps/worker/src/**`, `apps/web/src/**`, `docs/**`. Bloqueia `infra/`, `migrations/*.sql`, `package.json` root, `.github/`, `aws/`, `node_modules/`.

---

## 8. Análise da triagem — formato comentário

Comentário em markdown que o agente adiciona ao card:

```markdown
## 🤖 Análise Automática (GenomaFlow Agent)

**Tipo:** Bug / Feature / Copy / UX / Documentação / Configuração
**Faz sentido?** ✅ Sim — alinhado com [tal princípio do CLAUDE.md / da feature X]
                ⚠️ Parcialmente — preciso esclarecimento sobre [...]
                ❌ Não recomendado — entra em conflito com [...]

### Detalhes técnicos
- Arquivo principal afetado: `apps/web/.../foo.ts:123`
- Mudança necessária: [descrição precisa]
- Aproveita helpers existentes: `bar()`, `baz()`

### Impacto cross-feature
- ⚠️ Afeta também: Componente X (porque depende da função Y)
- ⚠️ Pode quebrar: caso de uso Z se o input vier vazio

### Plano de testes
- [ ] Test unit em `foo.spec.ts` cobrindo caso A
- [ ] Test unit cobrindo caso B (edge case)
- [ ] Smoke manual: navegar → clicar → ver

### Risco
Baixo / Médio / Alto — [justificativa]

### Próximos passos
- `/fix aprovado` → eu tento implementar e abrir PR
- `/fix cancel` → marcar pra dev humano
- Editar a descrição do card e comentar `/fix aprovado` se quiser ajustar requisitos
```

---

## 9. Garantias & guardrails

| Garantia | Implementação |
|---|---|
| Não quebra funcionalidade | `run_tests` obrigatório antes de PR; falha = sem PR |
| Allowlist paths editáveis | Tool `edit_file` valida path contra allowlist |
| Bloqueia migrações destrutivas | Bloqueio explícito em `*/migrations/*.sql` |
| Cost cap LLM | Max 200k tokens/attempt; depois aborta com erro |
| Loop limit | Max 5 attempts/card |
| Webhook abuse | HMAC signature + dedup `action.id` |
| GitHub PAT escopado | Scopo `repo` apenas no `genomaflow/genomaflow` |
| PR nunca auto-merge | branch protection main exige 1 review humano |
| Auditoria | tabela `trello_fix_attempts` com tokens/custo/erro |

---

## 10. Sub-fases (implementação)

| Sub-fase | Conteúdo | LOC estimado |
|---|---|---|
| **T-A** | Migration 105 + service `trello-client.js` + audit repo | ~400 |
| **T-B** | Webhook receiver `/webhooks/trello` + HMAC + enqueue BullMQ | ~300 |
| **T-C** | Worker queue + `codebase-tools.js` (read/list/grep só) | ~400 |
| **T-D** | Agente `trello-triage.js` (loop Claude read-only) + comentário no card | ~500 |
| **T-E** | Agente `trello-fix.js` + `edit_file`/`run_tests` + GitHub Octokit PR | ~700 |
| **T-F** | Slash commands parser + retry hint injection + cancel | ~300 |
| **T-G** | CDK IAM/Secrets + task def env vars | ~100 |
| **T-H** | Memória `docs/claude-memory/project_trello_qa_agent.md` + smoke prod | — |

Total ~2700 LOC, ~40 testes novos, 1 migration, 7 secrets SSM.

Estimativa: 3-5 dias de implementação ativa.

---

## 11. Fora de escopo (MVP)

- Multi-tenant / multi-board
- Power-Up Trello customizado
- Auto-merge de PR
- Aprovação via Slack/Discord
- Análise de cards em outras colunas que não QA
- Integração com Linear / Jira / GitHub Issues
- Re-triagem automática quando card é editado (única triagem por entrada na QA)
- Auto-deploy: agente nunca chega a apertar merge

---

## 12. Riscos residuais

| Risco | Mitigação | Severidade residual |
|---|---|---|
| Agente edita arquivo crítico fora de allowlist | Allowlist enforced na tool | Baixo |
| Tests passam local mas falham CI (ambiente diferente) | CI ainda roda como redundância; humano vê na review | Baixo |
| Custo LLM descontrolado | Cap por attempt + limite 5 attempts/card | Médio (visibilidade via audit) |
| Webhook spam por bot Trello | HMAC + dedup action.id | Muito baixo |
| Agente cria PR ruim que humano merge sem revisar bem | Disciplina humana + branch protection 1-approval | Médio (humano-dependente) |
| Loops `/fix retry` desperdiçando token | Max 5 attempts hard limit | Baixo |
