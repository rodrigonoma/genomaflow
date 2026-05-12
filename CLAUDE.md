# GenomaFlow — Premissas do Projeto

## Memória do Projeto (OBRIGATÓRIO)

Os arquivos em `docs/claude-memory/` são a memória persistente do projeto — decisões, lições aprendidas, erros cometidos e contexto acumulado. **Ler obrigatoriamente no início de cada sessão**:

- `docs/claude-memory/MEMORY.md` — índice de todos os arquivos
- `docs/claude-memory/project_context.md` — estado atual do projeto
- `docs/claude-memory/feedback_code_editing_rules.md` — erros que já aconteceram
- `docs/claude-memory/feedback_red_flags.md` — armadilhas conhecidas (consultar quando bater sintoma)
- `docs/claude-memory/project_feature_behaviors.md` — comportamentos esperados por feature
- `docs/claude-memory/project_stash_recovery_history.md` — stashes WIP

Após qualquer mudança significativa (feature entregue, bug corrigido, decisão arquitetural), **atualizar os arquivos relevantes em `docs/claude-memory/`** e commitar junto com o código.

Backup completo do CLAUDE.md original (~48k chars, antes da refatoração 2026-05-09) está em `docs/claude-memory/CLAUDE_full_archive_2026-05-09.md`.

---

## Personas de Especialistas (OBRIGATÓRIO)

Em toda análise, brainstorm, desenvolvimento, arquitetura, modelagem de dados, design ou decisão técnica, o raciocínio deve ser conduzido **simultaneamente sob a ótica dos seguintes perfis seniores**:

| Persona | Responsabilidade principal |
|---|---|
| **Engenheiro de Software Sênior** | Qualidade de código, padrões, segurança, testabilidade, manutenibilidade |
| **Arquiteto Sênior** | Decisões de arquitetura, escalabilidade, integração entre serviços, trade-offs |
| **Product Owner Sênior** | Valor de negócio, priorização, impacto para o usuário final, escopo correto |
| **Especialista em Design e UX Sênior** | Usabilidade, fluxos, consistência visual, experiência do usuário |
| **Engenheiro de Dados Sênior** | Pipelines, qualidade de dados, performance de queries, modelagem analítica |
| **DBA Sênior** | Schema, índices, RLS, integridade referencial, performance de banco, migrations |

Cada persona deve levantar seus próprios pontos de atenção antes de qualquer decisão. Trade-offs entre personas devem ser explicitados. Nenhuma feature/migration/endpoint/componente é entregue sem ter passado pelo crivo de todas as personas relevantes.

Detalhes: `docs/claude-memory/feedback_senior_personas.md`.

---

## Paridade Web ↔ Android ↔ iOS (OBRIGATÓRIO)

**Toda feature nova, ajuste, correção de bug ou melhoria feita para a web DEVE ser aplicada também ao Android e iOS.**

- O app mobile (Capacitor) embute o bundle Angular dentro do APK/IPA — deploys web **não** atualizam o app instalado no celular automaticamente
- A cada mudança em `apps/web/`, após o commit/push da web, executar obrigatoriamente:
  ```bash
  cd apps/web
  ng build --configuration=mobile
  npx cap sync android
  npx cap sync ios   # somente em macOS/CI
  ```
- O build mobile usa `environment.mobile.ts` — toda flag nova em `environment.ts` deve estar em `environment.prod.ts` E `environment.mobile.ts`
- Mudanças puramente de **backend** (API, worker, banco) propagam automaticamente para todos os clientes — não precisam de rebuild do APK
- Mudanças de **frontend** (componentes Angular, rotas, templates, estilos) requerem rebuild do APK/IPA para refletir no app instalado
- Ao entregar qualquer tarefa com mudança de frontend: commitar o sync Android junto (o iOS via CI ao criar tag `v*.*.*`)
- Nunca declarar uma tarefa de UI como "concluída" sem ter feito o sync do Android

Detalhes: `docs/claude-memory/feedback_web_android_ios_parity.md`.

---

## Compatibilidade Multi-módulo (OBRIGATÓRIO)

**Todo ajuste, correção de bug ou nova feature deve ser desenvolvido considerando os três módulos existentes: `human`, `veterinary` e `estetica`.**

- Os mundos são diferentes — terminologia, fluxos, agentes de IA, espécies, campos de paciente e contexto clínico variam entre módulos — mas nenhum pode ser negligenciado
- Ao implementar qualquer mudança, perguntar explicitamente: *"isso funciona igualmente para os três módulos?"*
- Se a implementação correta para um módulo não for óbvia (ex: campo sem equivalente no outro módulo, comportamento ambíguo), **questionar o usuário antes de prosseguir** — nunca assumir
- **Premissa universal: nenhum ajuste pode quebrar ou impactar funcionalidade pré-existente** em nenhum dos três módulos

Tabela completa de diferenças relevantes (sujeito, owner, agentes IA, campos clínicos extras, ícone, label, prescrições, professional_type) em `docs/claude-memory/feedback_multi_module.md`.

**Condicional `module === 'human'` DEVE incluir `'estetica'`** — estetica usa `subject_type='human'`. Bugfix 2026-05-12: form cadastro paciente rendia vazio + backend exigia species. Detalhes: `docs/claude-memory/feedback_multi_module_estetica.md`.

---

## Sem Regressão e Sem Gambiarra (OBRIGATÓRIO)

Toda feature nova, ajuste ou correção de bug DEVE ser entregue sem quebrar funcionalidade existente E utilizando as melhores práticas/técnicas. Gambiarra é proibida.

- **Sem regressão**: mapear impacto antes de mudar, smoke test (login admin/master + telas críticas), `npm run test:unit` (api) + `npm test` (worker/web) localmente, multi-módulo (human/vet/estetica) preservado, defesa em profundidade preservada (RLS, `withTenant`, `AND tenant_id`, ACL master), migrations sempre aditivas, sync mobile junto.
- **Sem gambiarra**: causa raiz sempre, padrões consagrados do projeto, SDK oficial vence solução caseira, idempotência onde repete, erros explícitos com código + status correto, sem `console.log`/debug em prod, sem TODO sem issue, sem skip de teste/`--no-verify`/bypass de RLS pra contornar problema, sem código duplicado por preguiça.
- **Red flags de gambiarra**: "por enquanto", "depois eu refatoro", "funciona aqui deve funcionar lá", "vou ignorar esse erro/teste", "RLS já cobre, não preciso filtrar".
- **Trade-off legítimo é documentado** no commit/memória (alternativa considerada + por que descartada).

Detalhes: `docs/claude-memory/feedback_no_regression_no_gambiarra.md`.

---

## Fluxo de Desenvolvimento (OBRIGATÓRIO)

1. **Branch de desenvolvimento**: todo trabalho começa em uma branch criada a partir da `main`. Nunca commitar direto na main.
2. **Validação local primeiro**: todas as alterações devem ser testadas e funcionar corretamente no ambiente local antes de qualquer aprovação.
3. **Aprovação humana antes do merge**: após validação local, apresentar o resultado ao usuário. Só avançar após aprovação explícita.
4. **Atualizar specs de memória**: após aprovação, atualizar os arquivos relevantes em `docs/claude-memory/`.
5. **Pedir antes de pushar para main**: `git push origin main` dispara o deploy via GitHub Actions. Sempre perguntar antes de pushar, exceto se o usuário pedir explicitamente. Detalhes em `docs/claude-memory/feedback_ask_before_push.md`.
6. **Deploy via GitHub Actions**: o deploy para a AWS é automático no merge na `main`. Não fazer deploy manual sem antes passar pelo processo acima.
7. **Monitor obrigatório após todo push**: usar a ferramenta `Monitor` para acompanhar o workflow `deploy.yml`. Nunca declarar deploy concluído sem confirmação do Monitor.

Detalhes: `docs/claude-memory/feedback_dev_workflow.md`.

---

## Stack

- **API**: Node.js + Fastify (`apps/api`, porta 3000) — `Fastify({ maxParamLength: 500 })` (default 100 quebra rotas com JWT path param)
- **Worker**: Node.js standalone (`apps/worker`)
- **Web**: Angular 18 standalone (`apps/web`, porta 4200)
- **Mobile**: Angular 18 + Ionic Capacitor 6 empacotando o mesmo `apps/web`
- **Landing**: HTML estático (`apps/landing`)
- **DB**: PostgreSQL 15 + pgvector (`db`, porta 5432)
- **Cache**: Redis 7.2 (`redis`, porta 6379)
- **Storage**: S3 (`genomaflow-uploads-prod`, `us-east-1`) — único storage persistente entre containers

---

## Roteamento de URLs

**Split de subdomínios:**
- `genomaflow.com.br` / `www.genomaflow.com.br` → **somente landing page**
- `app.genomaflow.com.br` → aplicação Angular (login, onboarding, doctor/clinic/master)
- Botão **Entrar/Registrar** na landing → `https://app.genomaflow.com.br/login` ou `/onboarding`
- Bookmarks antigos no apex/www recebem **301 → app.genomaflow.com.br$request_uri** pelo nginx
- Email links (verificação, reset de senha) usam `FRONTEND_URL=https://app.genomaflow.com.br` no task def ECS — sempre `app.`, nunca apex
- localStorage NÃO atravessa subdomínios

Detalhes (cert ACM, ALB rules, cutover): `docs/claude-memory/project_url_routing.md`.

---

## Banco de Dados

**Fonte da verdade:** banco Docker (`db:5432`). API e worker conectam exclusivamente ao Docker DB em dev. Nunca usar `localhost:5432` como referência. Detalhes: `docs/claude-memory/project_docker_source_of_truth.md`.

**Comandos:**
```bash
# Backfill RAG:
docker compose exec worker node src/rag/backfill.js
# Migrations:
docker compose exec api node src/db/migrate.js
```

**Sincronização de schema (OBRIGATÓRIO):**
- Toda alteração de schema via migration SQL numerada em `apps/api/src/db/migrations/`
- Aplicada primeiro no banco local (Docker) durante desenvolvimento
- Após merge na main, CI/CD aplica em produção via `genomaflow-prod-migrate` (ECS task)
- **Proibido aplicar alterações de schema diretamente em produção** sem migration no código
- Dev e prod devem ter sempre a mesma estrutura. Divergência = bug crítico

Detalhes: `docs/claude-memory/feedback_db_migrations.md`.

---

## Arquitetura Multi-tenant

Isolamento via RLS em todas as tabelas de dados clínicos. `set_config('app.tenant_id', tenant_id, true)` deve ser chamado dentro de uma transação antes de qualquer query em tabela com RLS. Usar o helper `withTenant(pool, tenant_id, async (client) => {...})` em `apps/api/src/db/tenant.js`.

**Tabelas com RLS ativo (ENABLE + FORCE):**
`patients`, `exams`, `clinical_results`, `integration_connectors`, `integration_logs`, `review_audit_log`, `owners`, `treatment_plans`, `chat_embeddings`, `users`, `treatment_items`, `tenant_chat_settings`, `tenant_blocks`, `tenant_directory_listing`, `tenant_invitations`, `tenant_conversations`, `tenant_messages`, `tenant_message_attachments`, `tenant_message_pii_checks`, `tenant_message_reactions`, `tenant_conversation_reads`, `schedule_settings`, `appointments`, `video_consultations`.

Exceções intencionais (sem RLS): `rag_documents` (diretrizes globais), `device_tokens` (infra de entrega), `video_consultation_files` (isolamento via FK em video_consultations).

**Padrão NULLIF para endpoints públicos / login cross-tenant:**
```sql
NULLIF(current_setting('app.tenant_id', true), '') IS NULL
OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
```
Quando nenhum tenant está configurado, o SELECT é livre. Com `withTenant`, restringe ao tenant. **Nunca simplificar para comparação direta** — quebra login e endpoints públicos (ex: `/video/join/:token`).

**Defesa em profundidade — `AND tenant_id = $X` explícito em TODA query (OBRIGATÓRIO):**
RLS é a ÚLTIMA camada, nunca a ÚNICA. Toda query SELECT/UPDATE/DELETE em tabela com RLS deve ter `AND tenant_id = $X` explícito na cláusula WHERE, mesmo dentro de `withTenant`. Tenant_id vem do `request.user.tenant_id` (JWT verificado). Mesma regra para o worker. Interpolação direta em SQL é proibida — sempre `set_config` parametrizado.

**ACL de rotas cross-tenant:** endpoints que retornam dados de múltiplos tenants devem checar `role !== 'master'`, **nunca** `role !== 'admin'`. Admin de clínica tem role `'admin'` — checar por admin = vazamento cross-tenant.

**`withTenant` é obrigatório para escritas em tabelas com RLS** — incluindo `users` (ex: `/register`).

**UX:** UI sempre mostra tenant_name + módulo em local visível (topbar). Ao navegar para `/onboarding`, limpar sessão ativa.

Detalhes completos (incidentes, auditoria, padrões): `docs/claude-memory/project_security_hardening.md`.

---

## Segurança da API

- **Nenhum endpoint que modifica dados pode ser público** — toda rota de mutação exige `preHandler: [fastify.authenticate]` (ou `fastify.authenticateMaster` para rotas master)
- **`POST /auth/activate` foi removido** — ativação de tenants só via `PATCH /master/tenants/:id/activate` (auth master)
- **Sempre usar queries parametrizadas** (`$1`, `$2`, ...). Interpolação de string em SQL = SQL Injection
- **Rate Limiting:** `@fastify/rate-limit` com `global: false`, cada rota define seu limite. `trustProxy: true` é obrigatório atrás do AWS ALB (sem isso, todos compartilham o mesmo bucket de rate limit)
- **Constantes de domínio** em `apps/api/src/constants.js`: `VALID_DOCTOR_SPECIALTIES`, `VALID_AGENT_TYPES`, `VALID_CREDIT_PACKAGES`, `VALID_MODULES`. Nunca duplicar inline
- **Senha master:** hash NUNCA em código/migrations legíveis. Rotacionar via migration numerada e armazenar nova senha apenas no vault

---

## Infraestrutura e Rede

**nginx + ALB (HTTPS):** TLS termina no ALB. Redirect HTTP→HTTPS deve usar `X-Forwarded-Proto`, não `$scheme`. Em ambos server blocks (landing e app).

**WebSocket:**
- Heartbeat de 30s (ping/pong); conexões mortas terminadas com `socket.terminate()`. `setInterval` limpo em `onClose`
- **WS URL DEVE incluir API_PREFIX em produção** — ALB de prod só tem rule `/api/* → API target`. URL WS sem prefix cai em 404 silencioso (incidente 2026-04-24)
- **Eventos via Redis pub/sub, nunca direto** — rotas publicam em `fastify.redis.publish('chat:event:' + tenantId, ...)`. `notifyTenant()` direto quebra multi-instância ECS
- Detalhes: `docs/claude-memory/feedback_websocket_prod.md`

**Angular: build de produção (OBRIGATÓRIO):**
- `apps/web/angular.json` DEVE ter `fileReplacements` no `production` substituindo `environment.ts` por `environment.prod.ts`
- Toda flag nova em `environment.ts` deve ter equivalente em `environment.prod.ts` E `environment.mobile.ts` — shapes sempre sincronizados
- **Validação obrigatória após build:** `grep -oE 'production:![01]|apiUrl:"[^"]*"' apps/web/dist/genomaflow-web/browser/chunk-*.js` → deve sair `production:!0` e `apiUrl:"/api"`
- Build mobile isolado: `ng build --configuration=mobile && npx cap sync` — usa `environment.mobile.ts` (`mobile: true, production: true`)
- Detalhes: `docs/claude-memory/feedback_angular_prod_build.md`

**Angular: AuthService e hidratação de profile (OBRIGATÓRIO):**
Persistir profile em `localStorage` sob chave `profile` e hidratar `currentProfileSubject` no construtor antes do fetch `/auth/me`. Sem cache, chip do tenant no topbar some/flicka no F5. Detalhes: `docs/claude-memory/feedback_auth_profile_hydration.md`.

---

## Comportamentos Esperados por Feature

Detalhes de comportamentos específicos (auth, chat, chat inter-tenant, anexos, reações, search, denúncias, suspensão, aesthetic F1, onboarding pago, IA pró-ativa, co-piloto, OCR, follow-up, copilot agenda, agenda, vídeo, mobile) em `docs/claude-memory/project_feature_behaviors.md`.

Buscar pela seção correspondente quando trabalhar em uma feature.

---

## Dados de Usuário — Normalização (OBRIGATÓRIO)

- **Emails sempre em lowercase** — aplicar `.toLowerCase().trim()` antes de qualquer INSERT ou UPDATE em `email`
- **Login deve usar `LOWER(u.email) = $1`** com input já lowercased — nunca comparação direta case-sensitive
- **Nunca confiar no input do usuário como veio** — campos de identidade (email, CPF, código) devem ser normalizados na camada de aplicação antes de persistir
- Violação causa falha silenciosa de login

Detalhes: `docs/claude-memory/feedback_phone_validation.md`, `docs/claude-memory/feedback_document_validation.md`.

---

## Infraestrutura de Produção (OBRIGATÓRIO)

**Isolamento de containers ECS:**
- API e Worker são containers separados — nunca compartilham filesystem
- Arquivos lidos por mais de um container vão obrigatoriamente para S3
- `/tmp` e qualquer path local são efêmeros
- Bucket: `genomaflow-uploads-prod` (us-east-1, privado, sem lifecycle desde 2026-05-04)
- Path padrão: `uploads/{tenant_id}/{timestamp}-{filename}`

**Permissões IAM:** ao adicionar qualquer novo serviço AWS (S3, SQS, Chime, etc.), a task role do ECS (`genomaflow-ecs-TaskRole*`) precisa receber permissão explícita. Sem ela, falha silenciosa ou `AccessDenied` em produção.

**S3 CORS:** bucket precisa permitir as origens do frontend (`https://app.genomaflow.com.br`, `localhost:4200`, `capacitor://localhost`) com métodos PUT/POST/GET/HEAD para uploads diretos via presigned URL.

**CI/CD e deploys:**
- `.github/workflows/deploy.yml` deve estar sempre commitado
- Sem o workflow no git, nenhum push dispara pipeline → código local nunca chega a prod
- Pipeline: build Docker → push ECR → registra task definition → update-service → run migrations → wait stable
- Nunca assumir que código em produção é o mais recente sem verificar
- Após push, aguardar pipeline completar (~10-15 min) antes de testar em produção

**`force-new-deployment` NÃO troca a imagem:**
- `update-service --force-new-deployment` reinicia com mesma task definition — imagem pinada não muda
- Para trocar imagem é obrigatório: registrar nova task definition + `update-service --task-definition <novo-arn>`
- Workflow `.github/workflows/deploy.yml` já implementa correto — nunca simplificar

**Docker layer cache — CACHEBUST (OBRIGATÓRIO):**
- Todos os Dockerfiles têm `ARG CACHEBUST` antes do `COPY src`
- CI passa `--build-arg CACHEBUST=<git-sha>` em cada build
- Nunca remover CACHEBUST — sem ele, builds podem reutilizar código antigo silenciosamente

**Variáveis de ambiente:** ao registrar nova revisão de task definition, incluir todas as env vars necessárias (ECS não herda). Variáveis secretas em SSM Parameter Store ou Secrets Manager.

Detalhes completos (CDK drift, one-shot tasks, IAM patterns): `docs/claude-memory/feedback_ecs_s3_deploy.md`, `docs/claude-memory/feedback_cdk_drift.md`, `docs/claude-memory/feedback_ecs_one_shot_tasks.md`, `docs/claude-memory/feedback_iam_s3_prefixes.md`.

---

## Auditoria (audit_log) — OBRIGATÓRIO

Trail append-only via trigger Postgres genérico em tabelas críticas (LGPD + forense). Tabelas com trigger: `appointments`, `subjects`, `prescriptions`, `exams`. Master panel em `/master/audit-log`.

- **`withTenant(pg, tid, fn, { userId, channel })` é OBRIGATÓRIO** em toda rota de mutação em tabela com trigger — sem `userId`+`channel`, `actor_user_id` fica NULL e perde rastreabilidade
- **`channel` whitelist:** `ui`, `copilot`, `system`, `worker`. Tools do Copilot DEVEM passar `'copilot'` — diferenciar UI de IA é o ponto da feature
- **Append-only:** GRANT só `SELECT`/`INSERT` em `audit_log`. Nunca expor UPDATE/DELETE
- **Nova tabela com PII/billing/compliance** → criar trigger `AFTER INSERT OR UPDATE OR DELETE ... EXECUTE FUNCTION audit_trigger_fn()` em migration nova

Detalhes: `docs/claude-memory/project_audit_log.md`.

---

## Comunicados (Master Broadcasts) — OBRIGATÓRIO

Canal "Administrador do GenomaFlow" → tenants reusando inter-tenant chat com `kind='master_broadcast'`. Migrations 058–061. Tenants veem conversa pinned + replies vão pra inbox master.

Pontos críticos:
- **Fan-out usa MASTER_TENANT_ID, não target** — `withTenant(fastify.pg, MASTER_TENANT_ID, fn, { userId, channel: 'system' })`
- **Markdown render só pra mensagem do master** (XSS aberto se renderizar de tenant)
- **Trigger compartilhado com tabela sem coluna `kind`** deve usar `to_jsonb(NEW) ->> 'kind'`
- **Replies do tenant em master_broadcast pulam suspension gate** (intencional)
- **WS event:** `master_broadcast_received` via `fastify.redis.publish('chat:event:{tenant}', ...)`
- **Rate limits:** broadcasts 20/dia, replies 100/dia
- **IAM S3:** task role precisa cobrir prefix `master-broadcasts/*`

Arquitetura completa: `docs/claude-memory/project_master_broadcasts.md`.

---

## Testes e CI gate (OBRIGATÓRIO)

CI gate em `.github/workflows/deploy.yml` roda job `test` antes do `deploy` (`needs: test`). Falha bloqueia build/push/update de ECS. Não confundir com `.github/workflows/deploy-mobile.yml` (workflow separado, só em tags `v*.*.*`).

**Concurrency cap obrigatório**: workflow tem `concurrency: { group: deploy-production, cancel-in-progress: true }`. Pushes consecutivos para main cancelam runs antigas. Sem isso, runners saturam e nenhum deploy chega em prod (incidente 2026-05-12 — 20 runs travados por 10h). Detalhes: `docs/claude-memory/feedback_ci_concurrency.md`.

- `apps/api` → `npm run test:unit` (subset sem DB)
- `apps/worker` → `npm test`
- `apps/web` → `npm test` (Jest + jsdom)

**Nunca remover o gate** — único filtro automatizado entre commit e prod.

**`test:unit` vs `test` na API:** `test` = completa DB-dependent (dev local). `test:unit` = lista explícita sem DB (CI). Teste novo sem DB → appendar em `test:unit`. Com DB → vai pro `test`.

**Áreas que DEVEM ter teste novo no mesmo PR:**
- Rota com auth/role gate → teste de ACL
- Flag de segurança LGPD/consent/suspended → strict equality (`=== true`)
- Pattern PII / validação → matriz match/noMatch
- Função de anonimização → allowlist de chaves do output
- Whitelist de valor → válidos aceitos + inválidos rejeitados

**Skip honesto:** `describe.skip` + `// TODO(test-debt): <causa>. Reabilitar quando <condição>.`. Nunca deletar — dívida tem que ficar visível.

Modelos vivos, mocks de SDKs, ESM/Jest, cobertura: `docs/claude-memory/feedback_testing_standards.md`.

---

## Regras de Edição de Código (OBRIGATÓRIO)

- **`Write` proibido em arquivo existente** — usar `Edit` cirúrgico
- **`git stash` proibido** — WIP vira commit `WIP:` na branch
- **Uma concern por branch**
- **Ler o arquivo completo antes de qualquer `Edit`**
- **Smoke test antes de pedir aprovação** — login admin/master, telas principais
- **Verificar migrations pendentes antes de mergear**
- **Verificar stash + WIP no início de toda sessão** — `git stash list` e `git log --all --oneline | grep -i "wip\|stash"`
- **Nunca afirmações categóricas sem verificar**
- **Vibe coding proibido** — fluxo: ler todos os arquivos relevantes → causa raiz → propor → executar de uma vez
- **Auditoria SQL obrigatória antes do primeiro commit** — para query nova com FK entre tabelas, abrir as migrations e listar colunas reais antes de escrever SQL
- **SDK de terceiros: verificar assinatura antes de usar**
- **Angular `computed()` só reage a signals lidos** — propriedades comuns NÃO invalidam o cache
- **Toda query tenant-scoped precisa de `AND tenant_id = $X` explícito**
- **Output do LLM nunca é confiável** — saneamento defensivo (regex extrair JSON, whitelist enums, clamp numérico, slice strings, throw `BAD_LLM_OUTPUT` em parse fail → 502, não 500). Modelo: `apps/api/src/services/ai-suggestions.js`. Pattern: `docs/claude-memory/feedback_llm_output_sanitization.md`
- **UI de IA clínica DEVE ter disclaimer** — "⚕ Sugestões da IA. Médico decide."

Histórico de incidentes que originaram cada regra + protocolo de higienização: `docs/claude-memory/feedback_code_editing_rules.md`.

---

## Comportamentos NÃO Esperados (Red Flags)

Sintomas de armadilhas únicas — quando bater algum desses, suspeitar primeiro antes de investigar mais fundo. Lista completa por categoria (RLS, storage, auth, deploy, frontend, mobile, vídeo, schema): `docs/claude-memory/feedback_red_flags.md`.

---

## Chatbot RAG

- Indexação automática via evento `exam:done` no worker
- Backfill manual necessário para exames históricos (`docker compose exec worker node src/rag/backfill.js`)
- Sessões de chat vivem no Redis (TTL 2h), sem persistência em banco
