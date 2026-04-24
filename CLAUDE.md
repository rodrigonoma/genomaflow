# GenomaFlow — Premissas do Projeto

## Memória do Projeto (OBRIGATÓRIO)

Os arquivos em `docs/claude-memory/` são a memória persistente do projeto — decisões, lições aprendidas, erros cometidos e contexto acumulado. **Ler obrigatoriamente no início de cada sessão**, especialmente:

- `MEMORY.md` — índice de todos os arquivos
- `project_context.md` — estado atual do projeto
- `feedback_code_editing_rules.md` — erros que já aconteceram e não podem se repetir
- `project_stash_recovery_history.md` — stashes WIP e código recuperado

Após qualquer mudança significativa (feature entregue, bug corrigido, decisão arquitetural), **atualizar os arquivos relevantes em `docs/claude-memory/`** e commitar junto com o código.

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

- Cada persona deve levantar seus próprios pontos de atenção antes de qualquer decisão ser tomada
- Se uma decisão favorece uma persona em detrimento de outra (ex: performance vs. legibilidade), o trade-off deve ser explicitado
- Nenhuma feature, migration, endpoint ou componente deve ser entregue sem ter passado pelo crivo de todas as personas relevantes

---

## Compatibilidade Multi-módulo (OBRIGATÓRIO)

**Todo ajuste, correção de bug ou nova feature deve ser desenvolvido considerando os dois módulos existentes: `human` e `veterinary`.**

- Os mundos são diferentes — terminologia, fluxos, agentes de IA, espécies, campos de paciente e contexto clínico variam entre módulos — mas nenhum pode ser negligenciado
- Ao implementar qualquer mudança, perguntar explicitamente: *"isso funciona igualmente para o módulo human e veterinary?"*
- Se a implementação correta para um módulo não for óbvia (ex: campo sem equivalente no outro módulo, comportamento ambíguo), **questionar o usuário antes de prosseguir** — nunca assumir
- **Premissa universal: nenhum ajuste pode quebrar ou impactar funcionalidade pré-existente** em nenhum dos dois módulos
- Mudanças de schema, API ou componente que afetem apenas um módulo devem ser explicitamente marcadas como intencionais e não devem causar regressão no outro

### Diferenças relevantes entre módulos

| Aspecto | `human` | `veterinary` |
|---|---|---|
| Sujeito | Paciente (humano) | Animal (cão, gato, equino, bovino…) |
| Proprietário | N/A | Owner (dono do animal) |
| Agentes IA Fase 1 | metabolic, cardiovascular, hematology | small_animals, equine, bovine |
| Agentes IA Fase 2 | therapeutic, nutrition, clinical_correlation | therapeutic, nutrition (sem clinical_correlation) |
| Campos clínicos extras | especialidade médica do usuário | espécie, raça, peso do animal |
| Ícone na UI | `people` | `pets` |
| Label na UI | "Pacientes" | "Animais" |

---

## Fluxo de Desenvolvimento (OBRIGATÓRIO)

1. **Branch de desenvolvimento**: todo trabalho começa em uma branch criada a partir da `main`. Nunca commitar direto na main.
2. **Validação local primeiro**: todas as alterações, ajustes e features novas devem ser testadas e funcionar corretamente no ambiente local antes de qualquer aprovação.
3. **Aprovação humana antes do merge**: após validação local, apresentar o resultado ao usuário. Só avançar após aprovação explícita.
4. **Atualizar specs de memória**: após aprovação, atualizar os arquivos de memória do Claude (`/home/rodrigonoma/.claude/projects/...`) com o contexto relevante da mudança.
5. **Commit e push**: commitar na branch de desenvolvimento e fazer push.
6. **Deploy via GitHub Actions**: o deploy para a AWS é feito automaticamente pelo pipeline de CI/CD ao fazer merge na `main`. Não fazer deploy manual na AWS sem antes passar pelo processo acima.

---

## Roteamento de URLs (OBRIGATÓRIO)

- `www.genomaflow.com.br` e `genomaflow.com.br` → sempre exibem a **landing page**
- Na landing, o botão **Entrar** redireciona para:
  - Se já estiver logado → aplicação (`/doctor/patients`, `/clinic/dashboard`, etc. conforme role)
  - Se não estiver logado → tela de login (`/login`)
- Na landing, o botão **Registrar** redireciona para:
  - Se já estiver logado → aplicação
  - Se não estiver logado → onboarding (`/onboarding`)
- A aplicação Angular (`app.genomaflow.com.br` ou subpath) nunca deve ser acessível diretamente em `www` ou no domínio raiz

---

## Fonte da Verdade: Docker DB

**O banco de dados Docker é a única fonte de verdade do projeto.**

- Todos os dados (tenants, usuários, pacientes, exames, embeddings) vivem no container `db` (PostgreSQL em `db:5432`)
- O banco local `localhost:5432` não deve ser usado como referência para dados
- A API (`apps/api`) conecta exclusivamente ao banco Docker via `DATABASE_URL=postgres://...@db:5432/genomaflow`
- O worker (`apps/worker`) deve igualmente apontar para o banco Docker em desenvolvimento
- Scripts de backfill, seed e migração devem ser executados dentro do contexto Docker (ou apontar para o Docker DB)

### Como rodar o backfill de RAG

```bash
# Indexar todos os exames done no banco Docker:
docker compose exec worker node src/rag/backfill.js
```

### Como rodar migrations

```bash
docker compose exec api node src/db/migrate.js
```

## Sincronização de Schema (OBRIGATÓRIO)

- **Qualquer alteração de banco** (nova tabela, nova coluna, índice, policy RLS, constraint, etc.) **deve ser feita via migration SQL** numerada em `apps/api/src/db/migrations/`
- A migration é aplicada primeiro no banco local (Docker) durante o desenvolvimento na branch
- Após aprovação e merge na main, o pipeline CI/CD aplica a mesma migration em produção via `genomaflow-prod-migrate` (ECS task)
- **É proibido aplicar alterações de schema diretamente em produção** sem a migration correspondente estar no código
- Dev e prod devem ter sempre a mesma estrutura de banco. Qualquer divergência é um bug crítico

---

## Stack

- **API**: Node.js + Fastify (`apps/api`, porta 3000)
- **Worker**: Node.js standalone (`apps/worker`)
- **Web**: Angular 18 standalone (`apps/web`, porta 4200)
- **Landing**: HTML estático (`apps/landing`)
- **DB**: PostgreSQL 15 + pgvector (`db`, porta 5432)
- **Cache**: Redis 7.2 (`redis`, porta 6379)
- **Storage**: S3 (`genomaflow-uploads-prod`, `us-east-1`) — único storage persistente entre containers

## Arquitetura Multi-tenant

- Isolamento via RLS (Row Level Security) em todas as tabelas de dados clínicos
- `set_config('app.tenant_id', tenant_id, true)` deve ser chamado dentro de uma transação antes de qualquer query em tabela com RLS
- Usar o helper `withTenant(pool, tenant_id, async (client) => {...})` em `apps/api/src/db/tenant.js`

### Tabelas com RLS ativo (ENABLE + FORCE)

`patients`, `exams`, `clinical_results`, `integration_connectors`, `integration_logs`, `review_audit_log`, `owners`, `treatment_plans`, `chat_embeddings`, `users`, `treatment_items`, `tenant_chat_settings`, `tenant_blocks`, `tenant_directory_listing`, `tenant_invitations`, `tenant_conversations`, `tenant_messages`, `tenant_message_attachments`, `tenant_message_pii_checks`, `tenant_message_reactions`, `tenant_conversation_reads`

- `rag_documents` **não tem RLS** — armazena diretrizes clínicas compartilhadas entre tenants (sem `tenant_id` por design)
- Adicionar RLS a uma nova tabela de dados clínicos = sempre ENABLE + FORCE; nunca apenas ENABLE

### Padrão NULLIF para login cross-tenant (tabela `users`)

Login precisa buscar usuários pelo email sem contexto de tenant. A policy usa:
```sql
NULLIF(current_setting('app.tenant_id', true), '') IS NULL
OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
```
Quando nenhum tenant está configurado, o SELECT é livre. Com `withTenant`, restringe ao tenant. **Nunca simplificar para comparação direta** — quebra o login.

### Defesa em profundidade: `AND tenant_id = $X` explícito em TODA query (OBRIGATÓRIO)

RLS é a ÚLTIMA camada de defesa, nunca a ÚNICA. Toda query SELECT/UPDATE/DELETE em tabela com RLS **deve** ter `AND tenant_id = $X` explícito na cláusula WHERE, mesmo dentro de `withTenant`.

- Tenant_id do `request.user.tenant_id` (JWT verificado) é a fonte de verdade — passar explicitamente nas queries
- RLS pode falhar (BYPASSRLS acidental no role, migration mal aplicada, política quebrada) — filtro explícito garante que mesmo nesse caso nenhum dado vaza
- Mesma regra vale para o `worker`: queries em `patients`, `exams`, `clinical_results`, `treatment_plans`, etc. devem incluir `AND tenant_id = $X`
- Interpolação de tenant_id em SQL (`` `...app.tenant_id = '${tenant_id}'` ``) = proibido. Sempre `SELECT set_config('app.tenant_id', $1, true)` parametrizado
- Incidente 2026-04-23: auditoria completa aplicou esta regra em `patients.js`, `exams.js`, `prescriptions.js`, `dashboard.js`, `alerts.js`, `integrations.js`, `worker/rag/indexer.js`; ver `docs/superpowers/specs/2026-04-23-tenant-isolation-defense-in-depth.md`

### ACL de rotas cross-tenant: só `role === 'master'`

Endpoints que retornam dados de múltiplos tenants (feedback, error-log, tenants, audit-log) **devem** checar `role !== 'master'`, **nunca** `role !== 'admin'`. Todo admin de clínica tem role `'admin'` — checar por `admin` = vazamento cross-tenant.

### UX: tenant_name sempre visível

A UI deve sempre mostrar tenant_name + módulo em local visível (topbar). Confusão visual sobre "em qual tenant estou logado" gera falsos reports de vazamento e mascara bugs reais. Ao navegar para `/onboarding` (registro de novo tenant), limpar sessão ativa — JWT antigo não pode persistir durante criação de novo tenant.

### `withTenant` é obrigatório para escritas em tabelas de dados

- Toda rota que faz INSERT/UPDATE/DELETE em tabela com RLS **deve usar `withTenant`**
- Isso inclui `users` (ex: `/register`) — não apenas tabelas de dados clínicos
- Query sem `withTenant` em tabela FORCE RLS resulta em erro de policy ou retorno vazio silencioso

---

## Segurança da API

### Endpoints e autenticação

- **Nenhum endpoint que modifica dados pode ser público** — toda rota de mutação exige `preHandler: [fastify.authenticate]` (ou `fastify.authenticateMaster` para rotas master)
- **`POST /auth/activate` foi removido** — ativação de tenants só via `PATCH /master/tenants/:id/activate` (auth master)
- Se uma nova rota não exige auth, documentar explicitamente o motivo; o padrão é sempre autenticado

### Queries SQL

- **Sempre usar queries parametrizadas** (`$1`, `$2`, ...) — nunca interpolação de string em SQL, mesmo quando o valor parece "seguro"
- Interpolação de string em SQL = vulnerabilidade de SQL Injection, mesmo em valores vindos de constantes internas

### Rate Limiting

- `@fastify/rate-limit` está ativo com `global: false` — cada rota define seu próprio limite via `config.rateLimit`
- Limites atuais: `/auth/login` (10/min), `/auth/register` (5/10min), `/chat/message` (30/min)
- `trustProxy: true` é **obrigatório** no Fastify quando a API roda atrás do AWS ALB — sem isso, todos os usuários compartilham o mesmo bucket de rate limit (o IP do ALB)
- `keyGenerator` usa `X-Forwarded-For` explicitamente para garantir o IP real do cliente

### Constantes de domínio

- **`apps/api/src/constants.js`** é a fonte única de verdade para: `VALID_DOCTOR_SPECIALTIES`, `VALID_AGENT_TYPES`, `VALID_CREDIT_PACKAGES`, `VALID_MODULES`
- Nunca duplicar essas listas inline em rotas — importar de `constants.js`

### Senha master

- O hash da senha master **nunca deve estar em código ou migrations** legíveis no repositório
- Rotacionar via migration numerada (`034_rotate_master_password.sql`, etc.) e armazenar a nova senha **exclusivamente no vault** (AWS Secrets Manager / 1Password)
- Se uma migration antiga contém o hash antigo, criar nova migration para rotacionar imediatamente

---

## Infraestrutura e Rede

### nginx + ALB (HTTPS)

- O nginx serve atrás do AWS ALB — o TLS termina no ALB, não no nginx
- Redirecionamento HTTP→HTTPS deve usar `X-Forwarded-Proto`, **não** `$scheme` direto:
  ```nginx
  if ($http_x_forwarded_proto = "http") { return 301 https://$host$request_uri; }
  ```
- Esse bloco deve existir em **ambos** os server blocks do nginx.conf (landing e app)

### WebSocket Heartbeat

- Conexões WebSocket têm heartbeat de 30s (ping/pong)
- Conexões sem resposta (`isAlive = false`) são terminadas automaticamente com `socket.terminate()`
- O `setInterval` do heartbeat deve ser limpo no hook `onClose` para evitar leak de memória

---

## Comportamentos Esperados

- Login com usuário inativo retorna `403 { error: 'Conta desativada.' }` (distinto de tenant inativo)
- Login com tenant inativo retorna `403 { error: 'Tenant inativo.' }`
- Cache hit no chat bypassa verificação de saldo no banco (intencional — reduz round-trips)
- Rate limit excedido retorna `429 { error: 'Muitas tentativas. Tente novamente em X.' }`
- Embedding model é configurável via `EMBEDDING_MODEL` env var (fallback: `text-embedding-3-small`)
- Claim `module` no JWT nunca é `null` — fallback para `'human'` no sign
- Chat entre tenants é **admin-only** (V1): role diferente de `admin` cai em 403 em todo endpoint `/inter-tenant-chat/*`
- Convite cross-module retorna **400** (human só conversa com human, vet só com vet)
- Rate limit `POST /inter-tenant-chat/invitations`: 20/dia por tenant
- Rate limit `POST /inter-tenant-chat/conversations/:id/messages`: 200/dia por tenant
- Cooldown de convite: 3 rejeições consecutivas de um mesmo destinatário nos últimos 30 dias resultam em 429 até expirar
- Bloqueio bilateral (`tenant_blocks`): convite de qualquer direção retorna 429 quando existe bloqueio — mensagem genérica para não revelar quem bloqueou
- WS events emitidos pelo chat entre tenants: `chat:invitation_received` (pra destinatário ao POST /invitations), `chat:invitation_accepted` (pra sender ao POST /accept), `chat:message_received` (pra counterpart ao POST /messages), `chat:unread_change` (pra counterpart no POST /messages e pra self no POST /read). Best-effort (try/catch) — falha de notify não derruba a request
- Frontend: rota `/chat` com guard de auth/terms/professional, sidebar agrega `unread_total` de todas as conversas e atualiza em tempo real via WS
- Anexo análise IA (Phase 4): POST /messages aceita `ai_analysis_card: {exam_id, agent_types[]}` — snapshot anonimizado (sem name/cpf/phone/microchip/birth_date, com age_range em bucket de 10 anos) via helper `anonymizeAiAnalysis`
- Anexo PDF (Phase 5A): POST /messages aceita `pdf: {filename, data_base64, mime_type}` max 10MB — pipeline PII (regex + Claude Haiku fail-open) hard-block 400 com `detected_kinds[]` se detectar. PDF limpo sobe ao S3 em `inter-tenant-chat/{conv}/`. Signed URL via GET /attachments/:id/url (TTL 1h)
- Anexo imagem (Phase 5B): POST /messages aceita `image: {filename, data_base64, mime_type, user_confirmed_anonymized: true}` — `user_confirmed_anonymized` deve ser literal `true` (strict equality). Sem OCR nesta fase — responsabilidade de anonimização do usuário, registrada em `tenant_message_pii_checks` com marker `user_manual_confirm`
- Reações (Phase 6): whitelist `['👍','❤️','🤔','✅','🚨','📌']`. POST /messages/:id/reactions toggle. Outros emojis retornam 400
- Search full-text (Phase 6): GET /conversations/:id/search?q= usa ts_headline português com `<mark>` nos highlights
- Denúncias (Phase 7): POST /reports (reason mín 10, max 2000 chars). UNIQUE constraint: 1 denúncia pending por par reporter/reported
- Suspensão automática (Phase 7): tenant com 3+ denúncias pending de reporters distintos nos últimos 30 dias é suspenso — POST /messages e POST /invitations retornam 403 com mensagem de suspensão. Master pode dismiss/action via POST /reports/:id/resolve

## Dados de Usuário — Normalização (OBRIGATÓRIO)

- **Emails devem ser sempre salvos em lowercase** — aplicar `.toLowerCase().trim()` antes de qualquer INSERT ou UPDATE em `email`
- **Login deve usar `LOWER(u.email) = $1`** com o input já lowercased — nunca comparação direta case-sensitive
- **Nunca confiar no input do usuário como veio** — campos de identidade (email, CPF, código) devem ser normalizados na camada de aplicação antes de persistir
- Violação causa falha silenciosa de login: usuário existe no banco mas não consegue autenticar

---

## Infraestrutura de Produção (OBRIGATÓRIO)

### Isolamento de containers ECS

- **API e Worker são containers separados no ECS — nunca compartilham filesystem**
- Qualquer arquivo que precise ser lido por mais de um container (ex: PDF de exame) **obrigatoriamente vai para o S3**
- `/tmp` e qualquer path local são efêmeros: somem ao reiniciar o container ou em novo deploy
- Bucket de uploads: `genomaflow-uploads-prod` (região `us-east-1`, privado, lifecycle 7 dias)
- Path padrão de uploads: `uploads/{tenant_id}/{timestamp}-{filename}`
- IAM: task role do ECS tem `s3:PutObject + GetObject + DeleteObject` em `uploads/*`

### Permissões IAM para novos serviços AWS

- **Ao adicionar qualquer novo serviço AWS** (S3, SQS, SNS, Secrets Manager, etc.), a task role do ECS (`genomaflow-ecs-TaskRole*`) precisa receber permissão explícita
- Sem a permissão IAM o container falha silenciosamente ou com erro de `AccessDenied` em produção
- Verificar sempre: task role → inline policies → escopo mínimo necessário

### CI/CD e deploys

- **O arquivo `.github/workflows/deploy.yml` deve estar sempre commitado no repositório**
- Sem o workflow no git, nenhum push dispara o pipeline — código local nunca chega a produção
- O deploy automaticamente: build Docker → push ECR → registra nova task definition → update-service → run migrations → wait stable
- **Nunca assumir que o código em produção é o mais recente sem verificar** — checar imagem da task definition ativa:
  ```bash
  aws ecs describe-services --cluster genomaflow --services genomaflow-web \
    --query 'services[0].deployments[0].taskDefinition'
  aws ecs describe-task-definition --task-definition <arn> \
    --query 'taskDefinition.containerDefinitions[0].image'
  ```
- Após um push para main, aguardar o pipeline completar (~10-15 min) antes de testar em produção

### `force-new-deployment` NÃO troca a imagem (OBRIGATÓRIO)

- `aws ecs update-service --force-new-deployment` reinicia o serviço com a **mesma task definition** — a imagem pinada no digest antigo **não muda**
- Para trocar a imagem é obrigatório o fluxo completo:
  1. `aws ecs register-task-definition` com o novo image tag → obtém novo ARN
  2. `aws ecs update-service --task-definition <novo-arn>` → agora o ECS usa a imagem nova
- O workflow `.github/workflows/deploy.yml` já implementa esse fluxo corretamente — nunca simplificá-lo para apenas `force-new-deployment`

### Docker layer cache — CACHEBUST (OBRIGATÓRIO)

- Todos os Dockerfiles (`apps/api`, `apps/worker`, `apps/web`) têm `ARG CACHEBUST` posicionado **antes do `COPY src`**
- O CI passa `--build-arg CACHEBUST=<git-sha>` em cada build
- Isso garante que a camada de código fonte e todas as camadas posteriores (compilação, etc.) sejam sempre reconstruídas a cada commit, mesmo que o Docker daemon reutilize o cache do `npm ci`
- **Nunca remover o `ARG CACHEBUST` dos Dockerfiles** — sem ele, builds podem silenciosamente reutilizar código antigo

### Verificar imagem deployada na dúvida

```bash
# Login no ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com

# Confirmar que o bundle tem o código novo
docker run --rm <image:tag> grep -rl "termo_do_novo_código" /usr/share/nginx/html/
```

### Variáveis de ambiente em novos task definitions

- Ao registrar nova revisão de task definition no ECS, incluir **todas** as env vars necessárias — ECS não herda do container anterior automaticamente
- Variáveis secretas (API keys, passwords) devem estar em SSM Parameter Store ou Secrets Manager, referenciadas via `secrets` na task definition

---

## Regras de Edição de Código (OBRIGATÓRIO)

- **`Write` é proibido em arquivos existentes** — usar sempre `Edit` cirúrgico. `Write` apaga conteúdo que não foi lido, causando regressões silenciosas
- **`git stash` é proibido** — qualquer trabalho em progresso vira commit `WIP:` na branch e é empurrado. Stash não tem histórico, não vai para o remoto, é código perdido esperando acontecer
- **Uma concern por branch** — branch de routing não toca em auth; branch de auth não toca em UI. Se duas coisas precisam mudar, dois PRs separados e aprovados separadamente
- **Smoke test obrigatório antes de pedir aprovação** — testar localmente as rotas críticas (login admin → dashboard, login master → painel master, telas principais carregam) antes de apresentar resultado para aprovação. Se não for possível testar algo, declarar explicitamente o que não foi testado
- **Verificar migrations pendentes antes de mergear** — comparar arquivos em `migrations/` com `_migrations` table. Migration inesperadamente pendente em produção = parar e investigar antes de prosseguir
- **Ler o arquivo completo antes de qualquer `Edit`** — nunca editar sem ter lido o estado atual. `Edit` em conteúdo desatualizado causa regressões silenciosas
- **Nunca fazer afirmações categóricas sem verificar com ferramentas** — "nunca existiu", "não há stash", "não há branch" só podem ser ditas após `git log --all`, `git stash list` e leitura efetiva do histórico. Dizer sem verificar = mentira
- **Verificar stash e histórico WIP antes de qualquer sessão de trabalho** — rodar `git stash list` e `git log --all --oneline | grep -i "wip\|stash"` no início de cada sessão para detectar código perdido
- **Vibe coding é proibido** — nunca fazer múltiplas correções sequenciais pequenas sem diagnóstico completo primeiro. O fluxo obrigatório é: ler todos os arquivos relevantes → diagnosticar a causa raiz → propor solução → executar de uma vez
- **Angular `computed()` só reage a signals lidos** — se um valor é consumido dentro de `computed()` ou `effect()`, ele **precisa** ser `signal()`. Propriedades string/boolean/object comuns NÃO invalidam o cache do computed. Para `[(ngModel)]` sobre signals, usar `[ngModel]="x()"` + `(ngModelChange)="x.set($event)"`. Bug real de 2026-04-23: busca rápida retornava sempre `[]` porque `query` era string enquanto `filtered` era computed — só saiu em produção
- **Toda query tenant-scoped precisa de `AND tenant_id = $X` explícito** — RLS é a última camada, nunca a única. Confiar só em RLS = vazamento quando role tem BYPASSRLS por engano, policy quebra, ou query escapa de `withTenant`. Incidente 2026-04-23 motivou auditoria completa; regra detalhada em `## Arquitetura Multi-tenant` acima

---

## Comportamentos NÃO Esperados (Red Flags)

- Query em tabela com FORCE RLS **fora** de `withTenant` → resultado vazio ou erro de policy (não é bug do banco, é falta de contexto)
- `trustProxy: false` com rate limiting atrás de load balancer → todos os clientes no mesmo bucket
- Endpoint sem `preHandler` que aceita body com dados de outro tenant → vazamento cross-tenant
- SQL com template literal (``` `SELECT ... WHERE id = ${req.params.id}` ```) → SQL Injection
- Hash de senha hardcoded em migration → credencial exposta no git history
- `rag_documents` com RLS → quebra o chatbot para todos os tenants (tabela é propositalmente global)
- Email salvo com case misto + login com comparação exata → usuário não consegue autenticar mesmo com credenciais corretas
- Worker lendo arquivo de `/tmp` → `ENOENT` em produção porque containers ECS não compartilham filesystem
- `.github/workflows/deploy.yml` não commitado → push para main não dispara CI/CD, produção nunca atualiza
- Assumir que código em produção é o mais recente sem verificar imagem da task definition → debug em código errado
- Usar `force-new-deployment` sem registrar nova task definition → ECS reinicia com imagem antiga, mudanças nunca chegam a produção
- Remover `ARG CACHEBUST` dos Dockerfiles → Docker reutiliza camadas antigas silenciosamente, bundle deployado não reflete o código do commit
- Mergar branch para main sem aprovação explícita do usuário → viola o fluxo de desenvolvimento obrigatório do projeto
- Afirmar que código "nunca existiu" ou "não há stash" sem verificar o histórico completo → mentira que causa perda de código
- Fazer correções em cadeia sem diagnóstico completo (vibe coding) → regressões acumuladas e raiz do problema não resolvida
- Propriedade comum (string/boolean/object) lida dentro de `computed()` Angular → computed nunca reavalia ao mudar o valor, UI mostra cache da primeira execução (bug 2026-04-23 na busca rápida)
- Query em tabela tenant-scoped sem filtro explícito `AND tenant_id = $X` → se RLS falhar (BYPASSRLS, policy quebrada), vazamento cross-tenant silencioso (auditoria 2026-04-23)
- `SET LOCAL app.tenant_id = '${tenant_id}'` com template literal → SQL Injection + potencial bypass de RLS via payload malicioso no tenant_id. Sempre `SELECT set_config('app.tenant_id', $1, true)` parametrizado
- ACL master usando `role !== 'admin'` → todo admin de clínica tem role `'admin'`, portanto qualquer admin vê dados cross-tenant. Correto é `role !== 'master'` (bug 2026-04-23 em `feedback.js` e `error-log.js`)
- UI sem indicador visível de tenant_name atual → usuário confunde contas e reporta falso vazamento; JWT antigo em localStorage após registro de novo tenant só piora a confusão

---

## Chatbot RAG

- Indexação automática via evento `exam:done` no worker
- Backfill manual necessário para exames históricos (ver comando acima)
- Sessões de chat vivem no Redis (TTL 2h), sem persistência em banco
