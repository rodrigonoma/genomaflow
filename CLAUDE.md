# GenomaFlow — Premissas do Projeto

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

`patients`, `exams`, `clinical_results`, `integration_connectors`, `integration_logs`, `review_audit_log`, `owners`, `treatment_plans`, `chat_embeddings`, `users`, `treatment_items`

- `rag_documents` **não tem RLS** — armazena diretrizes clínicas compartilhadas entre tenants (sem `tenant_id` por design)
- Adicionar RLS a uma nova tabela de dados clínicos = sempre ENABLE + FORCE; nunca apenas ENABLE

### Padrão NULLIF para login cross-tenant (tabela `users`)

Login precisa buscar usuários pelo email sem contexto de tenant. A policy usa:
```sql
NULLIF(current_setting('app.tenant_id', true), '') IS NULL
OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
```
Quando nenhum tenant está configurado, o SELECT é livre. Com `withTenant`, restringe ao tenant. **Nunca simplificar para comparação direta** — quebra o login.

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
- O deploy automaticamente: build Docker → push ECR → run migrations → force-deploy ECS → wait stable
- **Nunca assumir que o código em produção é o mais recente sem verificar** — checar timestamp da imagem no ECR:
  ```bash
  aws ecr describe-images --repository-name genomaflow/api \
    --query 'sort_by(imageDetails,&imagePushedAt)[-1].imagePushedAt'
  ```
- Após um push para main, aguardar o pipeline completar (~10-15 min) antes de testar em produção

### Variáveis de ambiente em novos task definitions

- Ao registrar nova revisão de task definition no ECS, incluir **todas** as env vars necessárias — ECS não herda do container anterior automaticamente
- Variáveis secretas (API keys, passwords) devem estar em SSM Parameter Store ou Secrets Manager, referenciadas via `secrets` na task definition

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
- Assumir que código em produção é o mais recente sem verificar timestamp no ECR → debug em código errado

---

## Chatbot RAG

- Indexação automática via evento `exam:done` no worker
- Backfill manual necessário para exames históricos (ver comando acima)
- Sessões de chat vivem no Redis (TTL 2h), sem persistência em banco
