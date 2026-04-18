# RAG Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar um chatbot clínico global com RAG sobre dados do tenant (pacientes, exames, análises), usando hybrid search (semântico + léxico), HNSW, IVFFlat, RRF e LLM-as-judge.

**Architecture:** Chunks dos dados clínicos são indexados em `chat_embeddings` após cada exame processado. O chatbot faz busca dual paralela (pgvector HNSW + tsvector BM25), funde via RRF, rerankeia com LLM-as-judge (Haiku) e gera resposta com citações via LLM gerador (Sonnet). Sessão e cache vivem no Redis.

**Tech Stack:** PostgreSQL + pgvector (HNSW + IVFFlat + GIN), OpenAI text-embedding-3-small, Claude Haiku (judge), Claude Sonnet (generator), Redis (cache + sessão), Fastify (API), Angular 17 (frontend).

---

## Mapa de Arquivos

| Ação | Arquivo |
|---|---|
| Criar | `apps/api/src/db/migrations/025_chat_embeddings.sql` |
| Criar | `apps/worker/src/rag/chunker.js` |
| Criar | `apps/worker/src/rag/indexer.js` |
| Modificar | `apps/worker/src/processors/exam.js` |
| Modificar | `apps/api/package.json` |
| Criar | `apps/api/src/routes/chat.js` |
| Modificar | `apps/api/src/server.js` |
| Criar | `apps/web/src/app/features/chat/chat.service.ts` |
| Criar | `apps/web/src/app/features/chat/chat-panel.component.ts` |
| Modificar | `apps/web/src/app/app.component.ts` |

---

## Task 1: Migration — tabela chat_embeddings

**Files:**
- Create: `apps/api/src/db/migrations/025_chat_embeddings.sql`

- [ ] **Step 1: Criar migration**

```sql
-- apps/api/src/db/migrations/025_chat_embeddings.sql
CREATE TABLE IF NOT EXISTS chat_embeddings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id   UUID REFERENCES subjects(id) ON DELETE CASCADE,
  exam_id      UUID REFERENCES exams(id) ON DELETE CASCADE,
  result_id    UUID REFERENCES clinical_results(id) ON DELETE CASCADE,
  chunk_type   TEXT NOT NULL CHECK (chunk_type IN ('interpretation','alert','recommendation','patient_profile')),
  content      TEXT NOT NULL,
  content_tsv  TSVECTOR,
  embedding    vector(1536) NOT NULL,
  source_label TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW: melhor para dados dinâmicos (insertions frequentes)
CREATE INDEX IF NOT EXISTS chat_embeddings_hnsw_idx
  ON chat_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- IVFFlat: alternativo, partições menores
CREATE INDEX IF NOT EXISTS chat_embeddings_ivfflat_idx
  ON chat_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- GIN: busca léxica BM25
CREATE INDEX IF NOT EXISTS chat_embeddings_tsv_idx
  ON chat_embeddings USING gin (content_tsv);

-- Filtro rápido por tenant
CREATE INDEX IF NOT EXISTS chat_embeddings_tenant_idx
  ON chat_embeddings (tenant_id);
```

- [ ] **Step 2: Aplicar migration no container**

```bash
docker compose exec api node src/db/migrate.js
```

Saída esperada:
```
[apply] 025_chat_embeddings.sql
Migrations complete.
```

- [ ] **Step 3: Verificar tabela criada**

```bash
docker compose exec db psql -U postgres -d genomaflow -c "\d chat_embeddings"
```

Deve listar as colunas: id, tenant_id, subject_id, exam_id, result_id, chunk_type, content, content_tsv, embedding, source_label, created_at.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/025_chat_embeddings.sql
git commit -m "feat: add chat_embeddings table with HNSW, IVFFlat, GIN indexes"
```

---

## Task 2: Worker — chunker.js

**Files:**
- Create: `apps/worker/src/rag/chunker.js`

- [ ] **Step 1: Criar chunker com overlap**

```javascript
// apps/worker/src/rag/chunker.js

const CHARS_PER_TOKEN = 4;
const DEFAULT_CHUNK_SIZE = 500;   // tokens
const DEFAULT_OVERLAP    = 100;   // tokens

/**
 * Splits text into overlapping chunks.
 * @param {string} text
 * @param {number} chunkSize tokens
 * @param {number} overlapSize tokens
 * @returns {string[]}
 */
function chunkText(text, chunkSize = DEFAULT_CHUNK_SIZE, overlapSize = DEFAULT_OVERLAP) {
  const chunkChars   = chunkSize   * CHARS_PER_TOKEN;
  const overlapChars = overlapSize * CHARS_PER_TOKEN;
  const step         = chunkChars - overlapChars;

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end   = Math.min(start + chunkChars, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) chunks.push(chunk);
    if (end >= text.length) break;
    start += step;
  }

  return chunks;
}

module.exports = { chunkText };
```

- [ ] **Step 2: Testar chunker manualmente**

```bash
docker compose exec worker node -e "
const { chunkText } = require('./src/rag/chunker');
const text = 'A'.repeat(3000);
const chunks = chunkText(text);
console.log('Total chunks:', chunks.length);
console.log('Chunk 0 length:', chunks[0].length);
console.log('Chunk 1 length:', chunks[1]?.length);
// chunk size = 2000 chars, overlap = 400 chars, step = 1600 chars
// text 3000 chars: chunk[0] = 0..2000, chunk[1] = 1600..3000 (400 chars overlap)
"
```

Esperado: `Total chunks: 2`, cada chunk com 2000 ou menos chars.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/rag/chunker.js
git commit -m "feat: add text chunker with 500t/100t overlap"
```

---

## Task 3: Worker — indexer.js

**Files:**
- Create: `apps/worker/src/rag/indexer.js`

- [ ] **Step 1: Criar indexer**

```javascript
// apps/worker/src/rag/indexer.js
const { Pool }     = require('pg');
const OpenAI       = require('openai');
const { chunkText } = require('./chunker');

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Embeds an array of texts in batches of 100.
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts) {
  const embeddings = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100).map(t => t.slice(0, 8000));
    const res   = await openai.embeddings.create({ model: 'text-embedding-3-small', input: batch });
    embeddings.push(...res.data.map(d => d.embedding));
  }
  return embeddings;
}

/**
 * Builds a single text summary of a subject's clinical profile.
 * @param {object} s
 * @returns {string}
 */
function buildProfileContent(s) {
  const parts = [`Paciente: ${s.name || 'N/A'}`];
  if (s.sex)              parts.push(`Sexo: ${s.sex}`);
  if (s.birth_date)       parts.push(`Nascimento: ${new Date(s.birth_date).toLocaleDateString('pt-BR')}`);
  if (s.weight)           parts.push(`Peso: ${s.weight}kg`);
  if (s.species)          parts.push(`Espécie: ${s.species}`);
  if (s.medications)      parts.push(`Medicamentos: ${s.medications}`);
  if (s.comorbidities)    parts.push(`Comorbidades: ${s.comorbidities}`);
  if (s.allergies)        parts.push(`Alergias: ${s.allergies}`);
  if (s.family_history)   parts.push(`Histórico familiar: ${s.family_history}`);
  return parts.join(' | ');
}

/**
 * Indexes all clinical chunks for an exam into chat_embeddings.
 * Called after exam processing succeeds.
 * @param {string} exam_id
 * @param {string} tenant_id
 */
async function indexExam(exam_id, tenant_id) {
  const client = await pool.connect();
  try {
    // Fetch clinical results
    const { rows: results } = await client.query(
      `SELECT id, agent_type, interpretation, alerts, recommendations
       FROM clinical_results
       WHERE exam_id = $1 AND tenant_id = $2`,
      [exam_id, tenant_id]
    );

    // Fetch subject + exam date
    const { rows: examRows } = await client.query(
      `SELECT s.id AS subject_id, s.name, s.birth_date, s.sex, s.weight,
              s.species, s.medications, s.comorbidities, s.allergies,
              s.family_history, e.created_at AS exam_date
       FROM exams e
       JOIN subjects s ON s.id = e.subject_id
       WHERE e.id = $1`,
      [exam_id]
    );
    if (!examRows.length) return;

    const row         = examRows[0];
    const subject_id  = row.subject_id;
    const examDateStr = new Date(row.exam_date).toLocaleDateString('pt-BR');
    const subjectName = row.name || 'Paciente';

    const chunks = [];

    for (const result of results) {
      const baseLabel = `${examDateStr} · ${subjectName} · ${result.agent_type}`;

      // Interpretation — chunk with overlap
      if (result.interpretation) {
        chunkText(result.interpretation).forEach(content => {
          chunks.push({
            tenant_id, subject_id,
            exam_id,   result_id: result.id,
            chunk_type: 'interpretation',
            content,
            source_label: baseLabel
          });
        });
      }

      // Alerts — atomic chunks
      const alerts = Array.isArray(result.alerts) ? result.alerts : [];
      alerts.forEach(alert => {
        const content = `Alerta ${(alert.severity || '').toUpperCase()}: ${alert.marker} = ${alert.value}`;
        chunks.push({
          tenant_id, subject_id,
          exam_id,   result_id: result.id,
          chunk_type: 'alert',
          content,
          source_label: `${baseLabel} [alerta]`
        });
      });

      // Recommendations — atomic chunks
      const recs = Array.isArray(result.recommendations) ? result.recommendations : [];
      recs.forEach(rec => {
        const content = rec.description || JSON.stringify(rec);
        chunks.push({
          tenant_id, subject_id,
          exam_id,   result_id: result.id,
          chunk_type: 'recommendation',
          content,
          source_label: `${baseLabel} [recomendação]`
        });
      });
    }

    // Patient profile — one chunk per subject (no exam_id/result_id)
    const profileContent = buildProfileContent(row);
    chunks.push({
      tenant_id, subject_id,
      exam_id:   null, result_id: null,
      chunk_type: 'patient_profile',
      content:    profileContent,
      source_label: `Perfil · ${subjectName}`
    });

    if (chunks.length === 0) return;

    // Embed all chunks in batches of 100
    const texts      = chunks.map(c => c.content);
    const embeddings = await embedBatch(texts);

    // Remove old exam chunks + old patient profile (will be replaced)
    await client.query(
      `DELETE FROM chat_embeddings WHERE exam_id = $1 AND tenant_id = $2`,
      [exam_id, tenant_id]
    );
    await client.query(
      `DELETE FROM chat_embeddings
       WHERE subject_id = $1 AND chunk_type = 'patient_profile' AND tenant_id = $2`,
      [subject_id, tenant_id]
    );

    // Insert new chunks
    for (let i = 0; i < chunks.length; i++) {
      const c   = chunks[i];
      const vec = `[${embeddings[i].join(',')}]`;
      await client.query(
        `INSERT INTO chat_embeddings
           (tenant_id, subject_id, exam_id, result_id, chunk_type,
            content, content_tsv, embedding, source_label)
         VALUES ($1, $2, $3, $4, $5, $6,
                 to_tsvector('portuguese', $6),
                 $7::vector, $8)`,
        [c.tenant_id, c.subject_id, c.exam_id, c.result_id, c.chunk_type,
         c.content, vec, c.source_label]
      );
    }

    console.log(`[indexer] Indexed ${chunks.length} chunks for exam ${exam_id}`);
  } finally {
    client.release();
  }
}

module.exports = { indexExam };
```

- [ ] **Step 2: Commit**

```bash
git add apps/worker/src/rag/indexer.js
git commit -m "feat: add RAG indexer — chunking, batch embed, upsert to chat_embeddings"
```

---

## Task 4: Worker — acoplar indexer ao exam.js

**Files:**
- Modify: `apps/worker/src/processors/exam.js`

- [ ] **Step 1: Adicionar import do indexer no topo do arquivo**

Após a linha `const { runClinicalCorrelationAgent } = require('../agents/clinical_correlation');`, adicionar:

```javascript
const { indexExam } = require('../rag/indexer');
```

- [ ] **Step 2: Chamar indexExam após o publish de exam:done**

Localizar o bloco que publica `exam:done` no final de `processExam` (por volta da linha 291):

```javascript
  try {
    const pub = new Redis(process.env.REDIS_URL);
    await pub.publish(`exam:done:${tenant_id}`, JSON.stringify({ exam_id }));
    await pub.quit();
  } catch (redisErr) {
    console.error(`[processor] Redis notify failed for exam ${exam_id}:`, redisErr.message);
  }
```

Adicionar chamada ao indexer **depois** desse bloco (indexação é não-fatal):

```javascript
  // Index clinical chunks for the chatbot RAG (non-fatal)
  try {
    await indexExam(exam_id, tenant_id);
  } catch (indexErr) {
    console.error(`[processor] RAG indexing failed for exam ${exam_id}:`, indexErr.message);
  }
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/processors/exam.js
git commit -m "feat: trigger RAG indexer after exam:done"
```

---

## Task 5: API — adicionar dependências AI

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Adicionar openai e @anthropic-ai/sdk ao package.json da API**

Em `apps/api/package.json`, adicionar dentro de `"dependencies"`:

```json
"@anthropic-ai/sdk": "^0.88.0",
"openai": "^4.52.0"
```

Resultado final de `"dependencies"`:

```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.88.0",
  "@fastify/jwt": "^8.0.1",
  "@fastify/multipart": "^8.3.0",
  "@fastify/websocket": "^8.3.1",
  "bcrypt": "^5.1.1",
  "bullmq": "^5.7.0",
  "dotenv": "^17.4.2",
  "fastify": "^4.27.0",
  "fastify-plugin": "^4.5.1",
  "ioredis": "^5.3.2",
  "openai": "^4.52.0",
  "pg": "^8.12.0"
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/package.json
git commit -m "feat: add openai and anthropic-ai/sdk to api dependencies"
```

---

## Task 6: API — rota de chat

**Files:**
- Create: `apps/api/src/routes/chat.js`

- [ ] **Step 1: Criar rota de chat completa**

```javascript
// apps/api/src/routes/chat.js
const crypto    = require('crypto');
const OpenAI    = require('openai');
const Anthropic = require('@anthropic-ai/sdk').default;

const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SESSION_TTL = 7200;  // 2h em segundos
const RESULT_TTL  = 300;   // 5min em segundos
const EMBED_TTL   = 3600;  // 1h em segundos

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Reciprocal Rank Fusion: funde listas de resultados semânticos e léxicos.
 * k=60 é o valor padrão da literatura.
 */
function rrf(semanticRows, lexicalRows, k = 60) {
  const scores = new Map();
  const all    = new Map();

  [...semanticRows, ...lexicalRows].forEach(r => all.set(r.id, r));

  semanticRows.forEach((r, i) => {
    scores.set(r.id, (scores.get(r.id) || 0) + 1 / (k + i + 1));
  });
  lexicalRows.forEach((r, i) => {
    scores.set(r.id, (scores.get(r.id) || 0) + 1 / (k + i + 1));
  });

  return [...all.values()]
    .sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0))
    .slice(0, 40);
}

module.exports = async function (fastify) {

  // POST /chat/message
  fastify.post('/message', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { question, session_id: incomingSessionId } = request.body || {};

    if (!question?.trim()) {
      return reply.status(400).send({ error: 'question é obrigatório' });
    }

    const session_id = incomingSessionId || crypto.randomUUID();
    const qHash      = hashText(question.trim());
    const resultKey  = `chat:result:${tenant_id}:${qHash}`;
    const embedKey   = `chat:embedding:${qHash}`;
    const sessionKey = `chat:session:${session_id}`;

    // --- Cache de resultado ---
    const cachedResult = await fastify.redis.get(resultKey);
    if (cachedResult) {
      const parsed = JSON.parse(cachedResult);
      await fastify.redis.lpush(sessionKey,
        JSON.stringify({ role: 'user',      content: question }),
        JSON.stringify({ role: 'assistant', content: parsed.answer })
      );
      await fastify.redis.ltrim(sessionKey, 0, 19);
      await fastify.redis.expire(sessionKey, SESSION_TTL);
      return { session_id, ...parsed };
    }

    // --- Embedding da query (com cache) ---
    let embedding;
    const cachedEmbed = await fastify.redis.get(embedKey);
    if (cachedEmbed) {
      embedding = JSON.parse(cachedEmbed);
    } else {
      const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: question.trim().slice(0, 8000)
      });
      embedding = res.data[0].embedding;
      await fastify.redis.setex(embedKey, EMBED_TTL, JSON.stringify(embedding));
    }

    const vecStr = `[${embedding.join(',')}]`;

    // --- Busca dual paralela ---
    const [semanticRes, lexicalRes] = await Promise.all([
      fastify.pg.query(
        `SELECT id, source_label, content, chunk_type
         FROM chat_embeddings
         WHERE tenant_id = $1
         ORDER BY embedding <=> $2::vector
         LIMIT 20`,
        [tenant_id, vecStr]
      ),
      fastify.pg.query(
        `SELECT id, source_label, content, chunk_type
         FROM chat_embeddings
         WHERE tenant_id = $1
           AND content_tsv @@ plainto_tsquery('portuguese', $2)
         ORDER BY ts_rank(content_tsv, plainto_tsquery('portuguese', $2)) DESC
         LIMIT 20`,
        [tenant_id, question]
      )
    ]);

    const top40 = rrf(semanticRes.rows, lexicalRes.rows);

    if (top40.length === 0) {
      return reply.status(200).send({
        session_id,
        answer: 'Não encontrei dados clínicos relevantes no sistema para responder essa pergunta.',
        sources: []
      });
    }

    // --- LLM-as-judge: Haiku seleciona top-5 ---
    let top5 = top40.slice(0, 5); // fallback se o judge falhar
    try {
      const judgeMsg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content:
            `Pergunta: "${question}"\n\n` +
            `Chunks disponíveis:\n` +
            top40.map((c, i) =>
              `[${i}] ID:${c.id}\nFonte: ${c.source_label}\n${c.content.slice(0, 400)}`
            ).join('\n\n') +
            `\n\nSelecione os 5 chunks mais relevantes para responder a pergunta.\n` +
            `Responda APENAS com JSON válido: {"ranked_ids":["id1","id2","id3","id4","id5"]}`
        }]
      });

      const parsed = JSON.parse(judgeMsg.content[0].text);
      const idMap  = new Map(top40.map(c => [c.id, c]));
      const ranked = (parsed.ranked_ids || []).map(id => idMap.get(id)).filter(Boolean);
      if (ranked.length > 0) top5 = ranked;
    } catch (_) {
      // judge falhou — usa top-5 do RRF
    }

    // --- Histórico da sessão (últimas 10 msgs) ---
    const rawHistory = await fastify.redis.lrange(sessionKey, 0, 9);
    const history    = rawHistory.reverse().map(h => JSON.parse(h));

    // --- LLM gerador: Sonnet produz resposta com citações ---
    const contextText = top5
      .map(c => `[${c.source_label}]\n${c.content}`)
      .join('\n\n');

    const genMsg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system:
        'Você é um assistente clínico do GenomaFlow. ' +
        'Responda perguntas sobre pacientes, exames e análises usando APENAS os dados fornecidos. ' +
        'Use linguagem clínica objetiva em português. ' +
        'Cite as fontes inline no formato [Fonte]. ' +
        'Nunca invente dados que não estejam no contexto.',
      messages: [
        ...history,
        {
          role: 'user',
          content: `Contexto clínico:\n${contextText}\n\nPergunta: ${question}`
        }
      ]
    });

    const answer  = genMsg.content[0].text;
    const sources = top5.map(c => ({
      type:          c.chunk_type,
      source_label:  c.source_label,
      chunk_excerpt: c.content.slice(0, 200)
    }));

    // --- Cacheia resultado + atualiza sessão ---
    await fastify.redis.setex(resultKey, RESULT_TTL, JSON.stringify({ answer, sources }));
    await fastify.redis.lpush(sessionKey,
      JSON.stringify({ role: 'user',      content: question }),
      JSON.stringify({ role: 'assistant', content: answer })
    );
    await fastify.redis.ltrim(sessionKey, 0, 19);
    await fastify.redis.expire(sessionKey, SESSION_TTL);

    return { session_id, answer, sources };
  });

  // DELETE /chat/session/:session_id
  fastify.delete('/session/:session_id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { session_id } = request.params;
    await fastify.redis.del(`chat:session:${session_id}`);
    return reply.status(204).send();
  });
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/chat.js
git commit -m "feat: chat route — hybrid search, RRF, LLM-as-judge, Redis session cache"
```

---

## Task 7: API — registrar rota no server.js

**Files:**
- Modify: `apps/api/src/server.js`

- [ ] **Step 1: Adicionar registro da rota chat**

Em `apps/api/src/server.js`, após a linha de registro do feedback e error-log:

```javascript
app.register(require('./routes/error-log'), { prefix: '/error-log' });
app.register(require('./routes/chat'), { prefix: '/chat' });
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/server.js
git commit -m "feat: register /chat route in server"
```

---

## Task 8: Angular — ChatService

**Files:**
- Create: `apps/web/src/app/features/chat/chat.service.ts`

- [ ] **Step 1: Criar serviço de chat**

```typescript
// apps/web/src/app/features/chat/chat.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface ChatSource {
  type: 'interpretation' | 'alert' | 'recommendation' | 'patient_profile';
  source_label: string;
  chunk_excerpt: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
}

export interface ChatResponse {
  session_id: string;
  answer: string;
  sources: ChatSource[];
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/chat`;

  sendMessage(question: string, sessionId?: string): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(`${this.base}/message`, {
      question,
      session_id: sessionId
    });
  }

  clearSession(sessionId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/session/${sessionId}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/features/chat/chat.service.ts
git commit -m "feat: add ChatService"
```

---

## Task 9: Angular — ChatPanelComponent

**Files:**
- Create: `apps/web/src/app/features/chat/chat-panel.component.ts`

- [ ] **Step 1: Criar componente do painel de chat**

```typescript
// apps/web/src/app/features/chat/chat-panel.component.ts
import { Component, inject, ViewChild, ElementRef, AfterViewChecked, Output, EventEmitter } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChatService, ChatMessage, ChatSource } from './chat.service';

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatButtonModule, MatTooltipModule],
  styles: [`
    :host { display: contents; }

    .chat-panel {
      position: fixed; top: 56px; right: 0; bottom: 0;
      width: 420px;
      background: #0f1729;
      border-left: 1px solid rgba(70,69,84,0.25);
      display: flex; flex-direction: column;
      z-index: 200;
      animation: slideIn 180ms cubic-bezier(0.4,0,0.2,1);
    }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }

    .panel-header {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(70,69,84,0.2);
      flex-shrink: 0;
    }
    .panel-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 0.9rem; color: #c0c1ff;
      flex: 1;
    }

    .messages {
      flex: 1; overflow-y: auto;
      padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;
    }

    .msg {
      max-width: 90%;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 0.8rem; line-height: 1.5;
      border-radius: 8px; padding: 0.625rem 0.875rem;
    }
    .msg-user {
      align-self: flex-end;
      background: #494bd6; color: #fff;
    }
    .msg-assistant {
      align-self: flex-start;
      background: #131b2e; color: #dae2fd;
      border: 1px solid rgba(70,69,84,0.2);
    }

    .sources {
      margin-top: 0.5rem;
      display: flex; flex-wrap: wrap; gap: 0.375rem;
    }
    .source-chip {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; color: #908fa0;
      background: rgba(73,75,214,0.12);
      border: 1px solid rgba(73,75,214,0.25);
      border-radius: 4px; padding: 2px 6px;
      cursor: default;
    }

    .loading-dots {
      align-self: flex-start;
      padding: 0.5rem 0.875rem;
      color: #464554;
      font-size: 1.2rem; letter-spacing: 2px;
    }

    .input-area {
      padding: 0.75rem 1rem;
      border-top: 1px solid rgba(70,69,84,0.2);
      display: flex; gap: 0.5rem; align-items: flex-end;
      flex-shrink: 0;
    }
    textarea {
      flex: 1; resize: none;
      background: #131b2e;
      border: 1px solid rgba(70,69,84,0.3);
      border-radius: 6px; color: #dae2fd;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 0.8rem; padding: 0.5rem 0.75rem;
      outline: none; min-height: 38px; max-height: 120px;
    }
    textarea:focus { border-color: #494bd6; }
    textarea::placeholder { color: #464554; }
  `],
  template: `
    <aside class="chat-panel">
      <div class="panel-header">
        <mat-icon style="color:#c0c1ff;font-size:18px;width:18px;height:18px">smart_toy</mat-icon>
        <span class="panel-title">Assistente Clínico</span>
        <button mat-icon-button
                matTooltip="Nova conversa"
                style="color:#908fa0"
                (click)="newSession()">
          <mat-icon style="font-size:16px;width:16px;height:16px">refresh</mat-icon>
        </button>
        <button mat-icon-button
                style="color:#908fa0"
                (click)="closed.emit()">
          <mat-icon style="font-size:16px;width:16px;height:16px">close</mat-icon>
        </button>
      </div>

      <div class="messages" #messagesContainer>
        @for (msg of messages; track $index) {
          <div [class]="'msg ' + (msg.role === 'user' ? 'msg-user' : 'msg-assistant')">
            {{ msg.content }}
            @if (msg.role === 'assistant' && msg.sources?.length) {
              <div class="sources">
                @for (s of msg.sources!; track $index) {
                  <span class="source-chip"
                        [matTooltip]="s.chunk_excerpt"
                        matTooltipPosition="above">
                    {{ s.source_label }}
                  </span>
                }
              </div>
            }
          </div>
        }
        @if (loading) {
          <div class="loading-dots">···</div>
        }
      </div>

      <div class="input-area">
        <textarea
          [(ngModel)]="input"
          placeholder="Pergunte sobre pacientes, exames ou análises…"
          rows="1"
          (keydown.enter)="onEnter($event)">
        </textarea>
        <button mat-icon-button
                [disabled]="!input.trim() || loading"
                style="color:#c0c1ff"
                (click)="send()">
          <mat-icon>send</mat-icon>
        </button>
      </div>
    </aside>
  `
})
export class ChatPanelComponent implements AfterViewChecked {
  @ViewChild('messagesContainer') private messagesEl!: ElementRef<HTMLDivElement>;

  private chatService = inject(ChatService);

  messages: ChatMessage[] = [];
  input    = '';
  loading  = false;
  sessionId: string | undefined;

  @Output() closed = new EventEmitter<void>();

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  private scrollToBottom() {
    try {
      const el = this.messagesEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    } catch (_) {}
  }

  onEnter(event: Event) {
    const ke = event as KeyboardEvent;
    if (!ke.shiftKey) {
      ke.preventDefault();
      this.send();
    }
  }

  send() {
    const question = this.input.trim();
    if (!question || this.loading) return;

    this.messages.push({ role: 'user', content: question });
    this.input   = '';
    this.loading = true;

    this.chatService.sendMessage(question, this.sessionId).subscribe({
      next: (res) => {
        this.sessionId = res.session_id;
        this.messages.push({
          role: 'assistant',
          content: res.answer,
          sources: res.sources
        });
        this.loading = false;
      },
      error: () => {
        this.messages.push({
          role: 'assistant',
          content: 'Ocorreu um erro ao processar sua pergunta. Tente novamente.'
        });
        this.loading = false;
      }
    });
  }

  newSession() {
    if (this.sessionId) {
      this.chatService.clearSession(this.sessionId).subscribe({ error: () => {} });
    }
    this.sessionId = undefined;
    this.messages  = [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/features/chat/chat-panel.component.ts
git commit -m "feat: add ChatPanelComponent — slide-in panel with hybrid sources"
```

---

## Task 10: Angular — integrar painel no AppComponent

**Files:**
- Modify: `apps/web/src/app/app.component.ts`

- [ ] **Step 1: Adicionar import do ChatPanelComponent e EventEmitter**

No topo do `AppComponent`, adicionar ao array `imports`:

```typescript
import { ChatPanelComponent } from './features/chat/chat-panel.component';
```

E no `imports` do `@Component`:
```typescript
imports: [RouterOutlet, RouterLink, RouterLinkActive, AsyncPipe,
          MatIconModule, MatMenuModule, MatButtonModule, MatTooltipModule,
          MatSnackBarModule, MatDialogModule, ChatPanelComponent],
```

- [ ] **Step 2: Adicionar estado do painel à classe**

Na classe `AppComponent`, adicionar:

```typescript
chatOpen = false;
```

- [ ] **Step 3: Adicionar ícone de chat no topbar**

Dentro da `<header class="topbar">`, antes do `<div class="user-chip"...>`:

```html
<button mat-icon-button
        matTooltip="Assistente clínico"
        style="color:#908fa0;margin-right:0.5rem"
        (click)="chatOpen = !chatOpen">
  <mat-icon>smart_toy</mat-icon>
</button>
```

- [ ] **Step 4: Adicionar painel ao template**

Dentro do `@if (auth.currentUser$ | async; as user)`, após `</header>`, adicionar:

```html
@if (chatOpen) {
  <app-chat-panel (closed)="chatOpen = false" />
}
```

- [ ] **Step 5: Ajustar `main-content` quando o painel está aberto**

Adicionar estilo condicional ao `<main>`:

```html
<main class="main-content" [style.margin-right]="chatOpen ? '420px' : '0'">
```

- [ ] **Step 6: Adicionar estilo de transição ao main-content**

No objeto de `styles`, localizar `.main-content` e adicionar `transition`:

```
.main-content {
  margin-left: 240px;
  margin-top: 56px;
  min-height: calc(100vh - 56px);
  background: #0b1326;
  transition: margin-right 180ms cubic-bezier(0.4,0,0.2,1);
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/app.component.ts
git commit -m "feat: add chat panel toggle to topbar"
```

---

## Task 11: Rebuild Docker e smoke test

**Files:** nenhum novo

- [ ] **Step 1: Rebuild api e worker (novas dependências + novo código)**

```bash
docker compose build api worker web
```

Esperado: build sem erros.

- [ ] **Step 2: Subir containers**

```bash
docker compose up -d
```

- [ ] **Step 3: Aplicar migration**

```bash
docker compose exec api node src/db/migrate.js
```

Esperado: `[apply] 025_chat_embeddings.sql` ou `[skip]` se já aplicada.

- [ ] **Step 4: Smoke test — POST /chat/message**

```bash
# Substitua TOKEN pelo JWT de um usuário válido
TOKEN="<jwt_aqui>"

curl -s -X POST http://localhost:3000/chat/message \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"Quais pacientes estão cadastrados?"}' | jq .
```

Resposta esperada (com dados indexados):
```json
{
  "session_id": "uuid-aqui",
  "answer": "...",
  "sources": [...]
}
```

Resposta esperada (sem dados indexados ainda):
```json
{
  "session_id": "uuid-aqui",
  "answer": "Não encontrei dados clínicos relevantes...",
  "sources": []
}
```

- [ ] **Step 5: Verificar indexação ao processar exame**

Enviar um novo exame via UI e verificar nos logs do worker:

```bash
docker compose logs worker --tail=20
```

Esperado: `[indexer] Indexed N chunks for exam <id>`

- [ ] **Step 6: Verificar painel no browser**

Abrir http://localhost:4200, logar e clicar no ícone `smart_toy` no topbar. O painel deve deslizar pela direita. Enviar uma pergunta e verificar resposta com chips de fonte.

- [ ] **Step 7: Commit final**

```bash
git add .
git commit -m "feat: RAG chatbot — full pipeline (indexer, hybrid search, LLM-as-judge, Angular panel)"
```
