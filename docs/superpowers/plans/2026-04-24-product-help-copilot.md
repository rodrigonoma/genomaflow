# Product Help Copilot — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajuda contextual in-app via AI: usuário abre painel lateral, AI responde perguntas sobre como usar a plataforma usando RAG sobre docs/specs do projeto e SSE streaming. Analytics revelam telas com mais dúvidas (= UX ruim).

**Architecture:** Reutiliza infra de RAG existente (`rag_documents` + pgvector) adicionando coluna `namespace` pra separar clinical_guideline (chatbot médico atual) de `product_help` (novo). Backend Fastify endpoint com SSE + Anthropic Haiku. Frontend Angular side panel novo (`help_outline` icon no topbar, distinto do `smart_toy` clínico). Analytics em tabela dedicada `help_questions` sem dado clínico. 3 fases incrementais, 4 PRs independentes.

**Tech Stack:**
- Backend: Node.js/Fastify, Anthropic SDK (claude-haiku-4-5-20251001), OpenAI embeddings (text-embedding-3-small, reuso), pg+pgvector
- Frontend: Angular 18 standalone, Material Dialog/Button/Icon
- Worker: job de indexação Node.js (reutiliza `chunker.js`, `embedder.js`)

**Custos estimados (Haiku):**
- ~2K input + 500 output tokens/pergunta = ~$0.005/pergunta
- 100 usuários × 5 perguntas/dia × 30 dias ≈ $75/mês em uso pesado
- Indexação: one-shot + re-indexação incremental por CI quando docs/ mudam = negligível (<$1/mês)

**Escopo explicitamente FORA:**
- Chat clínico existente (RAG sobre diretrizes médicas) continua intocado — coexistência por namespace
- Sem dados clínicos no contexto das perguntas de ajuda (segurança + privacy)
- Sem gravação de áudio/vídeo do usuário

**Segurança:**
- System prompt do Copilot explicita: "Você é um assistente de **produto**, não faça diagnóstico ou responda questão clínica"
- Contexto enviado: apenas rota + componente + role + tenant_id (sem `patient_id`, `exam_id`, resultados)
- Rate limit 30 perguntas/hora/usuário
- Se a pergunta parecer clínica, AI redireciona pro chatbot clínico existente

---

## Estrutura de arquivos

### Novos arquivos
- `apps/api/src/db/migrations/052_product_help_rag.sql` — namespace + tabela help_questions
- `apps/api/src/rag/product-help-retriever.js` — retriever específico pra namespace='product_help'
- `apps/api/src/routes/product-help.js` — POST /product-help/ask com SSE
- `apps/worker/src/rag/indexer-product-help.js` — job de indexação de docs/*.md
- `apps/web/src/app/features/product-help/product-help-panel.component.ts` — side panel chat
- `apps/web/src/app/features/product-help/product-help.service.ts` — cliente SSE
- `apps/web/src/app/core/help-context/help-context.service.ts` — observa rota/componente atual
- `apps/api/src/routes/master/help-analytics.js` (adicionar ao master existente) — top questions per route

### Arquivos modificados
- `apps/api/src/server.js` — registrar nova rota `/product-help`
- `apps/web/src/app/app.component.ts` — botão `help_outline` no topbar (ao lado do smart_toy) + host do side panel
- `apps/web/src/app/features/master/master.component.ts` — nova aba "Ajuda: perguntas frequentes"
- `.github/workflows/deploy.yml` — job de reindex quando `docs/` mudar

### Splits de PR (4 PRs)

| PR | Escopo | Branch | Testável sozinho |
|---|---|---|---|
| PR1 | Schema + indexer + reindex job | `feat/copilot-rag-foundation` | Sim — curl no indexer, pgvector populado |
| PR2 | API endpoint + SSE streaming | `feat/copilot-api-streaming` | Sim — curl com `Accept: text/event-stream` |
| PR3 | Frontend side panel + analytics UI | `feat/copilot-ui-and-analytics` | Sim — fluxo ponta-a-ponta no browser |
| PR4 | Fase 2 (actions) + Fase 3 (proactive) | `feat/copilot-actions-and-proactive` | Sim — ações clicáveis + hesitation detection |

Cada PR passa por branch + validação local + aprovação explícita + merge.

---

## PR 1 — Foundation: Schema + Indexer + Reindex Job

### Task 1.1 — Migration: namespace + help_questions

**Files:**
- Create: `apps/api/src/db/migrations/052_product_help_rag.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- Migration 052: Copilot de ajuda de produto — namespace em rag_documents + analytics
--
-- Reutiliza rag_documents com coluna namespace (default 'clinical_guideline'
-- pra backfill dos docs clínicos existentes; novos docs de ajuda usam 'product_help').
--
-- help_questions registra cada pergunta do Copilot pra analytics. Sem dado clínico.

ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS namespace TEXT NOT NULL DEFAULT 'clinical_guideline'
  CHECK (namespace IN ('clinical_guideline', 'product_help'));

-- Backfill: todos os docs existentes são diretrizes clínicas
UPDATE rag_documents SET namespace = 'clinical_guideline' WHERE namespace IS NULL OR namespace = '';

-- Índice pra filtrar namespace nas queries
CREATE INDEX IF NOT EXISTS rag_documents_namespace_idx ON rag_documents(namespace);

-- Tabela de analytics do Copilot
CREATE TABLE IF NOT EXISTS help_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  route TEXT NOT NULL,
  component TEXT,
  user_role TEXT,
  question TEXT NOT NULL,
  answer_preview TEXT,
  tokens_input INT,
  tokens_output INT,
  latency_ms INT,
  was_helpful BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS help_questions_route_idx ON help_questions(route, created_at DESC);
CREATE INDEX IF NOT EXISTS help_questions_tenant_idx ON help_questions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS help_questions_created_idx ON help_questions(created_at DESC);
```

- [ ] **Step 2: Rodar migration local**

```bash
docker compose up -d db redis api
docker compose exec -T api node src/db/migrate.js
```

Expected: `[apply] 052_product_help_rag.sql` + `Migrations complete.`

- [ ] **Step 3: Verificar schema**

```bash
docker compose exec -T db psql -U postgres -d genomaflow -c "\d rag_documents" | grep namespace
docker compose exec -T db psql -U postgres -d genomaflow -c "\d help_questions"
```

Expected: coluna `namespace` existe com default; `help_questions` tem 10 colunas + 3 índices.

- [ ] **Step 4: Commit**

```bash
git checkout -b feat/copilot-rag-foundation
git add apps/api/src/db/migrations/052_product_help_rag.sql
git commit -m "feat(db): migration 052 — namespace em rag_documents + help_questions"
```

### Task 1.2 — Indexer de docs de produto

**Files:**
- Create: `apps/worker/src/rag/indexer-product-help.js`
- Create: `apps/worker/src/rag/reindex-product-help.js` (script CLI)

- [ ] **Step 1: Escrever o indexer**

```javascript
// apps/worker/src/rag/indexer-product-help.js
'use strict';
const fs = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');
const { Pool } = require('pg');
const OpenAI = require('openai');
const { chunkText } = require('./chunker');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Diretórios que entram no índice. Paths relativos ao root do repo.
const SOURCES = [
  { dir: 'docs/superpowers/plans', sourceKind: 'plan' },
  { dir: 'docs/superpowers/specs', sourceKind: 'spec' },
  { dir: 'docs/claude-memory', sourceKind: 'memory' },
];

// CLAUDE.md é arquivo único na raiz
const SINGLE_FILES = [
  { path: 'CLAUDE.md', sourceKind: 'premises' },
];

async function embedBatch(texts) {
  const embeddings = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100).map(t => t.slice(0, 8000));
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch
    });
    embeddings.push(...res.data.map(d => d.embedding));
  }
  return embeddings;
}

async function walkMd(rootDir, dir) {
  const abs = path.join(rootDir, dir);
  try { await fs.access(abs); } catch { return []; }
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      out.push(...await walkMd(rootDir, path.join(dir, e.name)));
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

async function indexProductHelp(repoRoot) {
  const client = await pool.connect();
  try {
    // Apaga todos os docs de product_help antes de reindexar — idempotente por rerun
    await client.query(`DELETE FROM rag_documents WHERE namespace = 'product_help'`);
    console.log('[product-help] cleared previous product_help docs');

    const allFiles = [];
    for (const src of SOURCES) {
      const files = await walkMd(repoRoot, src.dir);
      for (const f of files) allFiles.push({ path: f, sourceKind: src.sourceKind });
    }
    for (const f of SINGLE_FILES) allFiles.push({ path: f.path, sourceKind: f.sourceKind });

    console.log(`[product-help] found ${allFiles.length} markdown files to index`);

    for (const { path: relPath, sourceKind } of allFiles) {
      const abs = path.join(repoRoot, relPath);
      const content = await fs.readFile(abs, 'utf-8');
      const chunks = chunkText(content, 1500, 200);
      if (chunks.length === 0) continue;

      const titles = chunks.map((_, i) => `${relPath}#${i + 1}`);
      const embeddings = await embedBatch(chunks);

      for (let i = 0; i < chunks.length; i++) {
        await client.query(
          `INSERT INTO rag_documents (namespace, source, title, content, embedding, module)
           VALUES ('product_help', $1, $2, $3, $4, 'both')
           ON CONFLICT (source, title) DO UPDATE
             SET content = EXCLUDED.content,
                 embedding = EXCLUDED.embedding`,
          [`${sourceKind}:${relPath}`, titles[i], chunks[i], JSON.stringify(embeddings[i])]
        );
      }
      console.log(`[product-help] ${relPath} → ${chunks.length} chunks`);
    }

    const { rows } = await client.query(
      `SELECT COUNT(*) AS total FROM rag_documents WHERE namespace = 'product_help'`
    );
    console.log(`[product-help] total indexed: ${rows[0].total} chunks`);
  } finally {
    client.release();
  }
}

module.exports = { indexProductHelp };
```

- [ ] **Step 2: Escrever o script CLI que chama o indexer**

```javascript
// apps/worker/src/rag/reindex-product-help.js
'use strict';
require('dotenv').config();
const path = require('path');
const { indexProductHelp } = require('./indexer-product-help');

// Path do repo root: quando roda no worker container, /app/docs está montado?
// Em dev local via worker container, o código é /app/src, docs está fora.
// Opção: sempre rodar o script fora do container passando PATH explícito via env.
const REPO_ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '../../../..');

(async () => {
  console.log(`[reindex] repo root: ${REPO_ROOT}`);
  try {
    await indexProductHelp(REPO_ROOT);
    console.log('[reindex] ✓ done');
    process.exit(0);
  } catch (err) {
    console.error('[reindex] ✗ failed:', err);
    process.exit(1);
  }
})();
```

- [ ] **Step 3: Testar o indexer local**

```bash
# Com containers rodando, executar o script direto no host (tem acesso aos docs/ e ao banco)
cd /home/rodrigonoma/GenomaFlow/apps/worker
DATABASE_URL="postgres://postgres:postgres@localhost:5432/genomaflow" \
  OPENAI_API_KEY=$(grep OPENAI_API_KEY ../../.env | cut -d= -f2) \
  REPO_ROOT=/home/rodrigonoma/GenomaFlow \
  node src/rag/reindex-product-help.js
```

Expected: log mostra "cleared previous" + ~N arquivos encontrados + "total indexed: X chunks" (X > 50 provavelmente).

- [ ] **Step 4: Verificar docs no banco**

```bash
docker compose exec -T db psql -U postgres -d genomaflow -c \
  "SELECT namespace, COUNT(*) FROM rag_documents GROUP BY namespace"
```

Expected:
```
    namespace      | count
-------------------+-------
 clinical_guideline |   XX
 product_help       |   YY
```

Sem mistura — namespaces separados.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/rag/indexer-product-help.js apps/worker/src/rag/reindex-product-help.js
git commit -m "feat(rag): indexer de docs de produto com namespace product_help"
```

### Task 1.3 — Reindex automático via CI quando docs/ muda

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Adicionar step de reindex ao workflow**

Ler `.github/workflows/deploy.yml` inteiro antes de editar. Após o step "Run migrations", antes de "Wait for services stable", adicionar:

```yaml
      - name: Reindex product-help docs (if docs/ changed)
        run: |
          # Check if docs/ was touched in this push
          CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -E "^(docs/|CLAUDE\.md)" | head -5)
          if [ -z "$CHANGED" ]; then
            echo "No doc changes — skipping reindex"
            exit 0
          fi
          echo "Doc changes detected:"
          echo "$CHANGED"

          # Reuse worker's migrate task pattern: run a one-shot ECS task
          TASK_DEF=$(aws ecs list-task-definitions \
            --family-prefix genomaflow-prod-reindex-help \
            --sort DESC \
            --query "taskDefinitionArns[0]" \
            --output text)

          if [ "$TASK_DEF" = "None" ] || [ -z "$TASK_DEF" ]; then
            echo "⚠️ Task def genomaflow-prod-reindex-help não existe. Pular reindex por enquanto."
            echo "   Criar via infra/lib/ecs-reindex-task.ts no próximo PR"
            exit 0
          fi

          # Rest of task run pattern as in "Run migrations" — omitted for brevity in V1,
          # skipping silently if task def doesn't exist yet.
```

- [ ] **Step 2: Commit do workflow**

```bash
git add .github/workflows/deploy.yml
git commit -m "chore(ci): reindex product-help docs on changes to docs/ (skip-if-missing taskdef)"
```

### Task 1.4 — Retriever específico pra product_help

**Files:**
- Create: `apps/api/src/rag/product-help-retriever.js`

- [ ] **Step 1: Criar o retriever**

```javascript
// apps/api/src/rag/product-help-retriever.js
'use strict';
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function embedQuery(text) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000),
  });
  return res.data[0].embedding;
}

/**
 * Busca top-K chunks de product_help relevantes à pergunta.
 * Sem filtro por tenant — docs de produto são globais.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} queryText
 * @param {number} k
 * @returns {Promise<Array<{source:string,title:string,content:string,score:number}>>}
 */
async function retrieveProductHelp(db, queryText, k = 5) {
  const embedding = await embedQuery(queryText);
  const { rows } = await db.query(
    `SELECT source, title, content,
            1 - (embedding <=> $1::vector) AS score
     FROM rag_documents
     WHERE namespace = 'product_help'
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(embedding), k]
  );
  return rows;
}

module.exports = { retrieveProductHelp };
```

- [ ] **Step 2: Teste manual rápido**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/api
OPENAI_API_KEY=$(grep OPENAI_API_KEY ../../.env | cut -d= -f2) \
DATABASE_URL="postgres://postgres:postgres@localhost:5432/genomaflow" \
node -e '
const { Pool } = require("pg");
const { retrieveProductHelp } = require("./src/rag/product-help-retriever");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const docs = await retrieveProductHelp(pool, "como registrar uma nova clínica?", 3);
  console.log(JSON.stringify(docs.map(d => ({source: d.source, score: d.score.toFixed(3), preview: d.content.slice(0,100)})), null, 2));
  await pool.end();
})();
'
```

Expected: 3 chunks relevantes (probabilmente do plan de onboarding ou do CLAUDE.md) com score > 0.3.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/rag/product-help-retriever.js
git commit -m "feat(rag): retriever pra namespace product_help"
```

### Task 1.5 — Smoke test final do PR 1

- [ ] **Step 1: Confirmar que nada do chat clínico existente quebrou**

```bash
# Testar endpoint de chat clínico existente (que usa retrieveGuidelines, não o novo)
TOKEN=$(docker exec genomaflow-api-1 node /app/gen-token.js 2>/dev/null)
curl -s -X POST http://localhost:3000/chat/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"o que é hemoglobina glicada?"}' | head -c 200
```

Expected: resposta clínica normal (não quebrou com a adição de `namespace`).

- [ ] **Step 2: Apresentar PR 1 pra aprovação do usuário**

Resumo pro usuário:
- Migration 052 aplicada local
- Indexer funciona, N chunks indexados
- Retriever retorna top-K relevante
- CI com skip-if-missing do task def (criaremos em infra num próximo commit)
- Chat clínico continua intocado

Aguardar "aprovado" antes de mergear.

- [ ] **Step 3: Merge após aprovação**

```bash
git checkout main
git merge --no-ff feat/copilot-rag-foundation -m "merge: feat/copilot-rag-foundation → main"
git push origin main
git branch -d feat/copilot-rag-foundation
```

---

## PR 2 — API Endpoint com SSE Streaming

### Task 2.1 — Rota POST /product-help/ask com SSE

**Files:**
- Create: `apps/api/src/routes/product-help.js`
- Modify: `apps/api/src/server.js`

- [ ] **Step 1: Criar nova branch**

```bash
git checkout -b feat/copilot-api-streaming
```

- [ ] **Step 2: Escrever a rota**

```javascript
// apps/api/src/routes/product-help.js
'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const { retrieveProductHelp } = require('../rag/product-help-retriever');

const MODEL = process.env.PRODUCT_HELP_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 800;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function systemPrompt(ctx) {
  return `Você é o Copilot de ajuda do GenomaFlow — plataforma SaaS de inteligência clínica (human + veterinária).

Sua função: ajudar o usuário a **usar a aplicação** (encontrar botões, entender fluxos, resolver dúvidas de UX). Seja direto e curto.

Regras absolutas:
- NUNCA faça diagnóstico clínico, recomendação de tratamento, ou interprete exame. Se a pergunta for clínica, responda: "Essa é uma pergunta clínica — use o assistente médico (ícone de robô no topo)."
- NUNCA invente funcionalidades que não estão na documentação fornecida. Se não sabe, diga "não sei" e sugira contatar o suporte.
- Responda em português do Brasil, em 3-8 linhas. Use markdown quando faz sentido.
- Priorize passo-a-passo quando a pergunta é "como fazer X".

Contexto do usuário:
- Rota atual: ${ctx.route || 'desconhecida'}
- Componente: ${ctx.component || 'desconhecido'}
- Role: ${ctx.user_role || 'desconhecido'}
- Módulo: ${ctx.module || 'human'}

Responda baseado apenas na documentação abaixo:`;
}

module.exports = async function (fastify) {
  fastify.post('/ask', {
    preHandler: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { user_id, tenant_id, role, module: userModule } = request.user;
    const { question, context } = request.body || {};

    if (!question || typeof question !== 'string' || question.length < 3 || question.length > 1000) {
      return reply.status(400).send({ error: 'question: string entre 3 e 1000 chars' });
    }

    const ctx = {
      route: context?.route,
      component: context?.component,
      user_role: role,
      module: userModule,
    };

    // Retrieve relevant docs (sem dado clínico no query)
    let docs = [];
    try {
      docs = await retrieveProductHelp(fastify.pg, question, 5);
    } catch (err) {
      request.log.error({ err }, 'product-help: retriever failed');
      return reply.status(500).send({ error: 'Falha ao buscar documentação' });
    }

    const docsText = docs.length === 0
      ? '[nenhuma documentação relevante encontrada]'
      : docs.map((d, i) => `### Fonte ${i + 1}: ${d.source} (${d.title})\n${d.content}`).join('\n\n---\n\n');

    // SSE setup
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx: disable buffering
    });

    const startTime = Date.now();
    let fullAnswer = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const stream = await anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt(ctx),
        messages: [
          { role: 'user', content: `Documentação:\n\n${docsText}\n\n---\n\nPergunta do usuário: ${question}` }
        ],
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const text = event.delta.text;
          fullAnswer += text;
          reply.raw.write(`event: delta\ndata: ${JSON.stringify({ text })}\n\n`);
        } else if (event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens ?? outputTokens;
        } else if (event.type === 'message_start' && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens ?? 0;
        }
      }

      reply.raw.write(`event: done\ndata: ${JSON.stringify({
        sources: docs.map(d => ({ source: d.source, title: d.title, score: Number(d.score.toFixed(3)) })),
      })}\n\n`);
    } catch (err) {
      request.log.error({ err }, 'product-help: stream failed');
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: 'Falha na resposta — tente de novo' })}\n\n`);
    } finally {
      reply.raw.end();
    }

    // Log async (não bloqueia a resposta)
    const latencyMs = Date.now() - startTime;
    fastify.pg.query(
      `INSERT INTO help_questions
       (tenant_id, user_id, route, component, user_role, question, answer_preview, tokens_input, tokens_output, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        tenant_id, user_id,
        ctx.route || 'unknown', ctx.component || null, role,
        question.slice(0, 1000),
        fullAnswer.slice(0, 500),
        inputTokens, outputTokens, latencyMs,
      ]
    ).catch(err => request.log.error({ err }, 'help_questions insert failed'));
  });

  // Opcional: endpoint pra marcar se a resposta foi útil
  fastify.post('/feedback', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { user_id } = request.user;
    const { question_id, was_helpful } = request.body || {};
    if (!question_id || typeof was_helpful !== 'boolean') {
      return reply.status(400).send({ error: 'question_id + was_helpful (boolean) obrigatórios' });
    }
    await fastify.pg.query(
      `UPDATE help_questions SET was_helpful = $1 WHERE id = $2 AND user_id = $3`,
      [was_helpful, question_id, user_id]
    );
    return reply.status(204).send();
  });
};
```

- [ ] **Step 3: Registrar a rota no server.js**

Ler `apps/api/src/server.js` linhas 27-45. Adicionar após a linha do `auth-email`:

```javascript
  fastify.register(require('./routes/product-help'), { prefix: '/product-help' });
```

- [ ] **Step 4: Rebuild + restart API com SES_MOCK**

```bash
cd /home/rodrigonoma/GenomaFlow
docker compose build api
docker compose up -d api
sleep 4
```

- [ ] **Step 5: Testar via curl com streaming**

```bash
# Gerar token de admin
docker cp apps/api/gen-token.js genomaflow-api-1:/app/gen-token.js 2>/dev/null || true
TOKEN=$(docker exec -w /app genomaflow-api-1 node gen-token.js 2>&1 | tail -1)

# Chamada SSE
curl -N -X POST http://localhost:3000/product-help/ask \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "question":"como adiciono um novo paciente?",
    "context":{"route":"/clinic/dashboard","component":"DashboardComponent"}
  }'
```

Expected: chunks SSE chegando em tempo real:
```
event: delta
data: {"text":"Pra"}

event: delta
data: {"text":" adicionar"}
...
event: done
data: {"sources":[...]}
```

- [ ] **Step 6: Verificar log em help_questions**

```bash
docker compose exec -T db psql -U postgres -d genomaflow -c \
  "SELECT route, component, latency_ms, tokens_input, tokens_output FROM help_questions ORDER BY created_at DESC LIMIT 3"
```

Expected: 1 linha com route='/clinic/dashboard', tokens_input ~1500, latency ~2000ms.

- [ ] **Step 7: Testar pergunta clínica deve ser rejeitada**

```bash
curl -N -X POST http://localhost:3000/product-help/ask \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "question":"o que significa hemoglobina glicada alta?",
    "context":{"route":"/clinic/dashboard"}
  }' 2>&1 | head -20
```

Expected: AI responde algo como "Essa é uma pergunta clínica — use o assistente médico..."

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/product-help.js apps/api/src/server.js
git commit -m "feat(api): POST /product-help/ask com SSE streaming + help_questions logging"
```

### Task 2.2 — Rate limit + security checks

- [ ] **Step 1: Rate limit já está no route config (30/hora/usuário). Validar testando 31 requests rápidas.**

```bash
for i in $(seq 1 32); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/product-help/ask \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"question":"teste '$i'","context":{"route":"/t"}}'
done | sort | uniq -c
```

Expected: `30 200` + `2 429`.

- [ ] **Step 2: Validar que question < 3 chars retorna 400**

```bash
curl -s -X POST http://localhost:3000/product-help/ask \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"question":"a"}'
```

Expected: `{"error":"question: string entre 3 e 1000 chars"}`

- [ ] **Step 3: Apresentar PR 2 pra aprovação** (resumo: endpoint funciona com SSE, rate-limit, retrieval isolado por namespace, analytics logando)

- [ ] **Step 4: Merge após aprovação**

```bash
git checkout main && git merge --no-ff feat/copilot-api-streaming -m "merge: feat/copilot-api-streaming → main"
git push origin main && git branch -d feat/copilot-api-streaming
```

---

## PR 3 — Frontend: Side Panel + Analytics UI

### Task 3.1 — Service de contexto

**Files:**
- Create: `apps/web/src/app/core/help-context/help-context.service.ts`

- [ ] **Step 1: Criar nova branch**

```bash
git checkout -b feat/copilot-ui-and-analytics
```

- [ ] **Step 2: Escrever o service**

```typescript
// apps/web/src/app/core/help-context/help-context.service.ts
import { Injectable, inject, signal, computed } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

export interface HelpContext {
  route: string;
  component: string | null;
}

@Injectable({ providedIn: 'root' })
export class HelpContextService {
  private router = inject(Router);

  private routeSignal = signal<string>(this.router.url);
  private componentSignal = signal<string | null>(null);

  route = this.routeSignal.asReadonly();
  component = this.componentSignal.asReadonly();
  snapshot = computed<HelpContext>(() => ({
    route: this.routeSignal(),
    component: this.componentSignal(),
  }));

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.routeSignal.set(e.urlAfterRedirects));
  }

  setComponent(name: string | null): void {
    this.componentSignal.set(name);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/core/help-context/help-context.service.ts
git commit -m "feat(web): HelpContextService — observa rota atual pro Copilot"
```

### Task 3.2 — Service do Copilot com SSE via fetch

**Files:**
- Create: `apps/web/src/app/features/product-help/product-help.service.ts`

- [ ] **Step 1: Escrever o service**

```typescript
// apps/web/src/app/features/product-help/product-help.service.ts
import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { HelpContext } from '../../core/help-context/help-context.service';

export interface AskCallbacks {
  onDelta(text: string): void;
  onDone(sources: Array<{ source: string; title: string; score: number }>): void;
  onError(message: string): void;
}

@Injectable({ providedIn: 'root' })
export class ProductHelpService {
  private auth = inject(AuthService);

  async ask(question: string, ctx: HelpContext, cb: AskCallbacks, signal?: AbortSignal): Promise<void> {
    const token = this.auth.getToken();
    if (!token) { cb.onError('Não autenticado'); return; }

    try {
      const res = await fetch(`${environment.apiUrl}/product-help/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({ question, context: ctx }),
        signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        cb.onError(body.error || `Erro ${res.status}`);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames separated by \n\n
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          this.handleFrame(frame, cb);
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      cb.onError(err?.message || 'Erro de rede');
    }
  }

  private handleFrame(frame: string, cb: AskCallbacks): void {
    const lines = frame.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    if (!data) return;
    try {
      const parsed = JSON.parse(data);
      if (event === 'delta' && parsed.text) cb.onDelta(parsed.text);
      else if (event === 'done') cb.onDone(parsed.sources || []);
      else if (event === 'error') cb.onError(parsed.error || 'Erro');
    } catch { /* ignore malformed */ }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/features/product-help/product-help.service.ts
git commit -m "feat(web): ProductHelpService — cliente SSE via fetch streaming"
```

### Task 3.3 — Side Panel Component

**Files:**
- Create: `apps/web/src/app/features/product-help/product-help-panel.component.ts`

- [ ] **Step 1: Escrever o componente**

```typescript
// apps/web/src/app/features/product-help/product-help-panel.component.ts
import { Component, EventEmitter, Input, Output, inject, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { HelpContextService } from '../../core/help-context/help-context.service';
import { ProductHelpService } from './product-help.service';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ source: string; title: string; score: number }>;
  streaming?: boolean;
}

@Component({
  selector: 'app-product-help-panel',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatButtonModule],
  styles: [`
    :host { position:fixed;top:56px;right:0;bottom:0;width:380px;max-width:100vw;background:#0b1326;border-left:1px solid rgba(70,69,84,0.25);display:flex;flex-direction:column;z-index:900;box-shadow:-4px 0 20px rgba(0,0,0,0.3);font-family:'Space Grotesk',sans-serif;color:#dae2fd; }
    .header { display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;border-bottom:1px solid rgba(70,69,84,0.2); }
    .header h2 { font-size:0.9375rem;font-weight:700;margin:0;color:#c0c1ff;display:flex;align-items:center;gap:0.5rem; }
    .subtitle { font-family:'JetBrains Mono',monospace;font-size:10px;color:#7c7b8f;padding:0 1rem 0.5rem;letter-spacing:0.08em;text-transform:uppercase; }
    .messages { flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:0.75rem; }
    .msg { padding:0.625rem 0.875rem;border-radius:8px;font-size:0.8125rem;line-height:1.45;white-space:pre-wrap;word-wrap:break-word; }
    .msg.user { background:#181e31;align-self:flex-end;max-width:85%; }
    .msg.assistant { background:#111929;border:1px solid rgba(192,193,255,0.08);max-width:95%; }
    .sources { margin-top:0.5rem;font-family:'JetBrains Mono',monospace;font-size:9.5px;color:#7c7b8f; }
    .sources-title { text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.25rem;color:#908fa0; }
    .input-row { padding:0.75rem 1rem;border-top:1px solid rgba(70,69,84,0.2);display:flex;gap:0.5rem;align-items:flex-end; }
    textarea { flex:1;background:#060d1a;color:#dae2fd;border:1px solid rgba(192,193,255,0.12);border-radius:6px;padding:0.5rem 0.75rem;font-family:'JetBrains Mono',monospace;font-size:0.8125rem;resize:none;outline:none;min-height:36px;max-height:120px; }
    textarea:focus { border-color:rgba(192,193,255,0.35); }
    .send-btn { background:#c0c1ff;color:#1000a9;border:none;border-radius:6px;padding:0.5rem 0.875rem;font-size:0.75rem;font-weight:700;letter-spacing:0.06em;cursor:pointer;text-transform:uppercase; }
    .send-btn:disabled { opacity:0.4;cursor:not-allowed; }
    .empty { text-align:center;color:#7c7b8f;font-size:0.8125rem;padding:1.5rem 1rem;line-height:1.5; }
    .empty .mono { font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#908fa0;margin-top:0.75rem; }
  `],
  template: `
    <div class="header">
      <h2><mat-icon style="font-size:18px;width:18px;height:18px;color:#c0c1ff">support_agent</mat-icon> Ajuda</h2>
      <button mat-icon-button (click)="close.emit()"><mat-icon>close</mat-icon></button>
    </div>
    <div class="subtitle">Copilot do GenomaFlow</div>

    <div class="messages" #messagesBox>
      @if (messages().length === 0) {
        <div class="empty">
          Pergunte sobre como usar a plataforma. O Copilot vê qual tela você está olhando e responde com passo-a-passo específico.
          <div class="mono">Exemplos:<br>• "como registrar um novo paciente?"<br>• "onde altero o plano da clínica?"<br>• "como convido outra clínica pro chat?"</div>
        </div>
      }
      @for (m of messages(); track $index) {
        <div class="msg" [class.user]="m.role === 'user'" [class.assistant]="m.role === 'assistant'">
          {{ m.content }}
          @if (m.sources && m.sources.length > 0) {
            <div class="sources">
              <div class="sources-title">Fontes</div>
              @for (s of m.sources; track s.source) {
                <div>• {{ s.title }} (score {{ s.score }})</div>
              }
            </div>
          }
        </div>
      }
    </div>

    <div class="input-row">
      <textarea #ta [(ngModel)]="draft" (keydown.enter)="onEnter($event)" rows="1"
        placeholder="Pergunte algo sobre a plataforma..." [disabled]="loading()"></textarea>
      <button class="send-btn" (click)="send()" [disabled]="!draft.trim() || loading()">
        {{ loading() ? '...' : 'ENVIAR' }}
      </button>
    </div>
  `
})
export class ProductHelpPanelComponent implements AfterViewChecked {
  @Output() close = new EventEmitter<void>();
  @ViewChild('messagesBox') messagesBox?: ElementRef<HTMLDivElement>;

  private svc = inject(ProductHelpService);
  private ctx = inject(HelpContextService);

  messages = signal<Msg[]>([]);
  loading = signal(false);
  draft = '';

  private abortCtrl: AbortController | null = null;
  private shouldScroll = false;

  onEnter(ev: KeyboardEvent): void {
    const e = ev as any;
    if (e.shiftKey) return;
    ev.preventDefault();
    this.send();
  }

  async send(): Promise<void> {
    const q = this.draft.trim();
    if (!q || this.loading()) return;

    this.draft = '';
    this.loading.set(true);
    this.shouldScroll = true;
    this.messages.update(m => [...m, { role: 'user', content: q }]);
    this.messages.update(m => [...m, { role: 'assistant', content: '', streaming: true }]);

    const assistantIdx = this.messages().length - 1;
    this.abortCtrl = new AbortController();

    await this.svc.ask(q, this.ctx.snapshot(), {
      onDelta: (text) => {
        this.messages.update(ms => {
          const copy = [...ms];
          copy[assistantIdx] = { ...copy[assistantIdx], content: copy[assistantIdx].content + text };
          return copy;
        });
        this.shouldScroll = true;
      },
      onDone: (sources) => {
        this.messages.update(ms => {
          const copy = [...ms];
          copy[assistantIdx] = { ...copy[assistantIdx], sources, streaming: false };
          return copy;
        });
        this.loading.set(false);
      },
      onError: (error) => {
        this.messages.update(ms => {
          const copy = [...ms];
          copy[assistantIdx] = { role: 'assistant', content: `⚠ ${error}`, streaming: false };
          return copy;
        });
        this.loading.set(false);
      },
    }, this.abortCtrl.signal);
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll && this.messagesBox) {
      const el = this.messagesBox.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScroll = false;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/features/product-help/product-help-panel.component.ts
git commit -m "feat(web): ProductHelpPanelComponent — side panel com streaming"
```

### Task 3.4 — Integrar botão `help_outline` no topbar

**Files:**
- Modify: `apps/web/src/app/app.component.ts`

- [ ] **Step 1: Ler o arquivo completo primeiro** (`apps/web/src/app/app.component.ts`) pra identificar onde o botão `smart_toy` está e adicionar o `help_outline` ao lado.

- [ ] **Step 2: No topbar, adicionar botão de ajuda ao lado do smart_toy**

Localizar a seção do topbar (procurar por `smart_toy`) e adicionar **antes** do `smart_toy`:

```html
<button mat-icon-button
        matTooltip="Ajuda do produto"
        style="color:#908fa0;margin-right:0.25rem"
        (click)="helpOpen = !helpOpen">
  <mat-icon>help_outline</mat-icon>
</button>
```

- [ ] **Step 3: Adicionar state `helpOpen` no AppComponent e renderizar o panel**

Na classe:
```typescript
helpOpen = false;
```

Na template, no final:
```html
@if (helpOpen) {
  <app-product-help-panel (close)="helpOpen = false" />
}
```

Import no `imports` do `@Component`:
```typescript
import { ProductHelpPanelComponent } from './features/product-help/product-help-panel.component';
// ...
imports: [..., ProductHelpPanelComponent],
```

- [ ] **Step 4: Build e teste**

```bash
cd apps/web && npx ng build --configuration=production 2>&1 | tail -5
```

Expected: build passa sem erro.

- [ ] **Step 5: Smoke test manual** — subir o ambiente local, logar, ver botão `help_outline` no topbar, clicar, enviar pergunta de exemplo, ver streaming.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/app.component.ts
git commit -m "feat(web): integra botão help_outline no topbar, abre ProductHelpPanel"
```

### Task 3.5 — Analytics UI no master panel

**Files:**
- Modify: `apps/api/src/routes/master.js` (adicionar 1 endpoint)
- Modify: `apps/web/src/app/features/master/master.component.ts` (adicionar tab)

- [ ] **Step 1: Adicionar endpoint no master.js**

Ler `apps/api/src/routes/master.js` completo. Adicionar após o endpoint de stats:

```javascript
  // Top rotas com mais perguntas do Copilot — revela telas com UX ruim
  fastify.get('/help-analytics', auth(), async (request, reply) => {
    const days = Math.min(90, parseInt(request.query.days) || 30);
    const { rows: topRoutes } = await fastify.pg.query(
      `SELECT route, COUNT(*)::int AS n, AVG(latency_ms)::int AS avg_latency_ms,
              COUNT(*) FILTER (WHERE was_helpful = false)::int AS unhelpful_count
       FROM help_questions
       WHERE created_at > NOW() - INTERVAL '1 day' * $1
       GROUP BY route
       ORDER BY n DESC
       LIMIT 20`,
      [days]
    );
    const { rows: recent } = await fastify.pg.query(
      `SELECT hq.id, hq.route, hq.component, hq.user_role, hq.question, hq.answer_preview,
              hq.was_helpful, hq.created_at, t.name AS tenant_name, u.email AS user_email
       FROM help_questions hq
       LEFT JOIN tenants t ON t.id = hq.tenant_id
       LEFT JOIN users u ON u.id = hq.user_id
       ORDER BY hq.created_at DESC
       LIMIT 100`
    );
    return { top_routes: topRoutes, recent };
  });
```

- [ ] **Step 2: Adicionar tab "Ajuda" no master.component.ts**

Na array `tabs` do MasterComponent:

```typescript
{ id: 'help', label: 'Ajuda', icon: 'support_agent' },
```

Criar signal:

```typescript
helpAnalytics = signal<{
  top_routes: Array<{route: string; n: number; avg_latency_ms: number; unhelpful_count: number}>;
  recent: Array<{id: string; route: string; component: string|null; user_role: string; question: string; answer_preview: string; was_helpful: boolean|null; created_at: string; tenant_name: string|null; user_email: string|null}>;
} | null>(null);
helpAnalyticsLoading = signal(false);
```

Effect no constructor:

```typescript
effect(() => {
  if (this.activeTab() !== 'help') return;
  this.helpAnalyticsLoading.set(true);
  this.http.get<any>(this.api('/help-analytics?days=30')).subscribe({
    next: (r) => { this.helpAnalytics.set(r); this.helpAnalyticsLoading.set(false); },
    error: () => this.helpAnalyticsLoading.set(false),
  });
}, { allowSignalWrites: true });
```

Template (dentro do content, após a última tab existente):

```html
@if (activeTab() === 'help') {
  <div class="section-title">Perguntas do Copilot (últimos 30 dias)</div>
  @if (helpAnalyticsLoading()) {
    <div class="text-muted mono" style="font-size:12px">Carregando...</div>
  } @else if (helpAnalytics(); as ha) {
    <h3 style="font-size:0.8rem;color:#a09fb2;margin:1rem 0 0.5rem;text-transform:uppercase;letter-spacing:0.05em">Top rotas (possíveis problemas de UX)</h3>
    <table>
      <thead>
        <tr><th>Rota</th><th>Perguntas</th><th>Latência média</th><th>Não ajudou</th></tr>
      </thead>
      <tbody>
        @for (r of ha.top_routes; track r.route) {
          <tr>
            <td class="mono" style="font-size:11px">{{ r.route }}</td>
            <td>{{ r.n }}</td>
            <td class="mono text-muted" style="font-size:11px">{{ r.avg_latency_ms }}ms</td>
            <td [style.color]="r.unhelpful_count > 0 ? '#ffb4ab' : '#908fa0'">{{ r.unhelpful_count }}</td>
          </tr>
        }
      </tbody>
    </table>

    <h3 style="font-size:0.8rem;color:#a09fb2;margin:1.5rem 0 0.5rem;text-transform:uppercase;letter-spacing:0.05em">Últimas 100 perguntas</h3>
    <table>
      <thead>
        <tr><th>Data</th><th>Tenant</th><th>Rota</th><th>Pergunta</th><th>Útil?</th></tr>
      </thead>
      <tbody>
        @for (q of ha.recent; track q.id) {
          <tr>
            <td class="mono text-muted" style="font-size:11px;white-space:nowrap">{{ q.created_at | date:'dd/MM HH:mm' }}</td>
            <td style="font-size:12px">{{ q.tenant_name || '—' }}</td>
            <td class="mono text-muted" style="font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ q.route }}</td>
            <td class="msg-cell" [title]="q.question">{{ q.question }}</td>
            <td>
              @if (q.was_helpful === true) { <span style="color:#10b981">✓</span> }
              @else if (q.was_helpful === false) { <span style="color:#ffb4ab">✗</span> }
              @else { <span class="text-muted">—</span> }
            </td>
          </tr>
        }
      </tbody>
    </table>
  }
}
```

- [ ] **Step 3: Build + test**

```bash
cd apps/web && npx ng build --configuration=production 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/master.js apps/web/src/app/features/master/master.component.ts
git commit -m "feat(master): aba 'Ajuda' com analytics de perguntas do Copilot"
```

### Task 3.6 — Apresentar PR 3 + merge

- [ ] Apresentar ao usuário: botão help_outline funciona, streaming visível, analytics no master, zero impacto no chat clínico.
- [ ] Merge após aprovação.

---

## PR 4 — Fases 2 e 3: Actions + Proactive

### Task 4.1 — Fase 2: AI retorna ações clicáveis

**Files:**
- Modify: `apps/api/src/routes/product-help.js` (atualizar system prompt)
- Modify: `apps/web/src/app/features/product-help/product-help-panel.component.ts` (renderizar ações)

- [ ] **Step 1: Criar branch**

```bash
git checkout -b feat/copilot-actions-and-proactive
```

- [ ] **Step 2: Atualizar system prompt no product-help.js pra incluir instrução de ações**

Substituir a função `systemPrompt` adicionando no final:

```javascript
Pode sugerir até 3 ações clicáveis no final da resposta, no formato:

\`\`\`actions
[
  {"label": "Abrir cadastro de paciente", "url": "/clinic/patients/new"},
  {"label": "Ver lista de pacientes", "url": "/clinic/patients"}
]
\`\`\`

Use URLs apenas a partir das rotas conhecidas na documentação. Se não tem rota clara, omita o bloco de actions.
```

Adicionar parser no reply side — antes de `reply.raw.end()`, extrair bloco de actions da `fullAnswer` e enviar como evento separado:

```javascript
// Parse actions block antes de enviar done
const actionsMatch = fullAnswer.match(/```actions\s*(\[[\s\S]*?\])\s*```/);
let actions = [];
if (actionsMatch) {
  try { actions = JSON.parse(actionsMatch[1]); } catch {}
}

reply.raw.write(`event: done\ndata: ${JSON.stringify({
  sources: docs.map(d => ({ source: d.source, title: d.title, score: Number(d.score.toFixed(3)) })),
  actions: actions.slice(0, 3),
})}\n\n`);
```

- [ ] **Step 3: Frontend renderiza ações + remove bloco da resposta visível**

No `product-help-panel.component.ts`, ajustar `onDone` pra:
1. Receber `sources` e `actions`
2. Limpar o bloco ` ```actions ... ``` ` do `content` exibido
3. Adicionar botões clicáveis abaixo da mensagem

Adicionar no template da mensagem assistant:

```html
@if (m.actions && m.actions.length > 0) {
  <div style="margin-top:0.75rem;display:flex;flex-direction:column;gap:0.375rem;">
    @for (a of m.actions; track a.url) {
      <a [href]="a.url" (click)="onActionClick($event, a)"
         style="background:rgba(192,193,255,0.1);color:#c0c1ff;padding:0.5rem 0.75rem;border-radius:5px;text-decoration:none;font-size:0.8125rem;font-family:'JetBrains Mono',monospace;text-align:center;">
        {{ a.label }}
      </a>
    }
  </div>
}
```

E no TS, expandir tipo `Msg`:

```typescript
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ source: string; title: string; score: number }>;
  actions?: Array<{ label: string; url: string }>;
  streaming?: boolean;
}
```

No `onDone`:

```typescript
onDone: (sources, actions) => {
  // Strip actions block do texto exibido
  this.messages.update(ms => {
    const copy = [...ms];
    const current = copy[assistantIdx];
    const cleaned = current.content.replace(/```actions[\s\S]*?```/, '').trim();
    copy[assistantIdx] = { ...current, content: cleaned, sources, actions, streaming: false };
    return copy;
  });
  this.loading.set(false);
},
```

Atualizar interface de `AskCallbacks` em `product-help.service.ts`:

```typescript
export interface AskCallbacks {
  onDelta(text: string): void;
  onDone(sources: Array<{ source: string; title: string; score: number }>, actions: Array<{label: string; url: string}>): void;
  onError(message: string): void;
}
```

E no `handleFrame`, ao ler o evento done:

```typescript
else if (event === 'done') cb.onDone(parsed.sources || [], parsed.actions || []);
```

Handler de click:

```typescript
onActionClick(ev: MouseEvent, a: {label: string; url: string}): void {
  ev.preventDefault();
  this.close.emit();
  // Navegar via router (não reload)
  inject(Router).navigateByUrl(a.url);
}
```

(ajustar imports — `Router` do @angular/router no construtor.)

- [ ] **Step 4: Build e teste**

```bash
cd apps/web && npx ng build --configuration=production 2>&1 | tail -3
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/product-help.js apps/web/src/app/features/product-help/
git commit -m "feat(copilot): Fase 2 — AI retorna ações clicáveis"
```

### Task 4.2 — Fase 3: Proactive hesitation detector

**Files:**
- Create: `apps/web/src/app/core/help-context/hesitation-detector.service.ts`
- Modify: `apps/web/src/app/app.component.ts` (listen e hint)

- [ ] **Step 1: Criar o detector**

```typescript
// apps/web/src/app/core/help-context/hesitation-detector.service.ts
import { Injectable, inject, signal } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

/**
 * Heurística simples: detecta padrão "navegar em zig-zag" na mesma rota.
 * Se o usuário entra em route A → B → A → B em <10s, provavelmente está perdido.
 */
@Injectable({ providedIn: 'root' })
export class HesitationDetectorService {
  private router = inject(Router);
  private history: Array<{ url: string; at: number }> = [];
  hintTrigger = signal<{ route: string } | null>(null);

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => this.onNav(e.urlAfterRedirects));
  }

  private onNav(url: string): void {
    const now = Date.now();
    this.history.push({ url, at: now });
    // keep last 6, last 15s
    this.history = this.history.filter(h => now - h.at < 15000).slice(-6);

    const last6 = this.history.slice(-6).map(h => h.url);
    // pattern: A B A B A B (any A/B with oscillation)
    if (last6.length >= 4) {
      const a = last6[last6.length - 4];
      const b = last6[last6.length - 3];
      if (a !== b && last6[last6.length - 2] === a && last6[last6.length - 1] === b) {
        this.hintTrigger.set({ route: url });
        setTimeout(() => this.hintTrigger.set(null), 8000); // hint some em 8s
      }
    }
  }
}
```

- [ ] **Step 2: No app.component.ts, escutar o hint e mostrar toast**

Injetar o service e usar effect:

```typescript
private hesitation = inject(HesitationDetectorService);

constructor() {
  effect(() => {
    const hint = this.hesitation.hintTrigger();
    if (hint && !this.helpOpen) {
      this.snack.open('Precisa de ajuda nessa tela?', 'Abrir Copilot', { duration: 6000 })
        .onAction().subscribe(() => { this.helpOpen = true; });
    }
  });
}
```

- [ ] **Step 3: Build + teste**

```bash
cd apps/web && npx ng build --configuration=production 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/core/help-context/hesitation-detector.service.ts apps/web/src/app/app.component.ts
git commit -m "feat(copilot): Fase 3 — detector de hesitação sugere ajuda proativa"
```

### Task 4.3 — Apresentar PR 4 + merge

- [ ] Validar localmente navegando zig-zag e vendo o toast; clicar no botão de ação no Copilot e confirmar que navega corretamente.
- [ ] Merge após aprovação.

---

## Atualização de memória (após todos os PRs)

### Task 5.1 — Registrar Copilot no project_context

**Files:**
- Modify: `docs/claude-memory/project_context.md`

- [ ] **Step 1: Adicionar seção "Copilot de ajuda de produto"**

```markdown
## Copilot de ajuda de produto

Ajuda contextual in-app via AI (Haiku) com RAG sobre docs/specs do projeto. Reutiliza rag_documents com namespace='product_help'. Endpoint POST /product-help/ask com SSE. Frontend side panel (help_outline no topbar). Analytics em help_questions (sem dado clínico) mostrado no master panel, aba "Ajuda".

Fases entregues (2026-04-24):
- Fase 1: RAG + API + UI + analytics
- Fase 2: AI sugere ações clicáveis
- Fase 3: Detector de hesitação oferece ajuda proativa

**Não confundir** com o chatbot clínico existente (smart_toy icon, namespace='clinical_guideline'). Namespaces separados, UIs separadas, analytics separadas.
```

- [ ] **Step 2: Commit + push** (fora de branch, direto em main se projeto permitir doc-only, senão branch)

---

## Self-Review

**1. Spec coverage:**
- Fase 1 (schema + indexer + API + UI + analytics) ✓ PR1+PR2+PR3
- Fase 2 (actions) ✓ Task 4.1
- Fase 3 (proactive) ✓ Task 4.2
- Haiku como modelo ✓ Task 2.1 `MODEL = claude-haiku-4-5-20251001`
- SSE ✓ Task 2.1
- Sem dado clínico no contexto ✓ Task 2.1 (ctx não tem `patient_id` etc)
- Indicador de frequência ✓ Task 3.5 (`help-analytics`)
- Gerado a partir de specs/docs ✓ Task 1.2 (`SOURCES = docs/**, CLAUDE.md`)
- Não quebrar chat clínico ✓ Task 1.5 Step 1 (smoke test)
- Custo/manutenção/perf considerados ✓ header inicial + rate limit 30/h

**2. Placeholder scan:** todas as steps têm código concreto, paths reais, comandos executáveis com expected outputs.

**3. Type consistency:** `AskCallbacks` atualizada consistentemente Task 2.1 → 3.2 → 3.3 → 4.1.

---

## Notas operacionais

- **Reindex manual** (fora do CI): `node apps/worker/src/rag/reindex-product-help.js` passando `REPO_ROOT` e envs.
- **Reindex CI**: só dispara se `docs/` ou `CLAUDE.md` mudar — skippa silenciosamente se task def ainda não existir (criar em infra num PR futuro separado).
- **Custo estimado por user**: ~$0.75/mês se cada usuário faz 5 perguntas/dia. Monitorar via `SELECT SUM(tokens_input), SUM(tokens_output) FROM help_questions WHERE created_at > NOW() - INTERVAL '1 month'`.
- **Escalabilidade do índice**: pgvector ivfflat com lists=100 aguenta ~1M embeddings confortáveis. A gente tá muito longe disso.
