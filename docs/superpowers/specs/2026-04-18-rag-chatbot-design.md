# RAG Chatbot — Design Spec
**Data:** 2026-04-18  
**Status:** Aprovado

---

## Visão Geral

Chatbot clínico global integrado ao GenomaFlow. Responde perguntas sobre pacientes, exames e análises usando os próprios dados do tenant indexados via RAG (Retrieval-Augmented Generation). Acessível de qualquer tela via painel lateral deslizante.

**Princípios:**
- Isolamento total por tenant — nenhum dado de outro tenant entra no pipeline
- Sem base de conhecimento externa — o RAG indexa os dados clínicos já existentes no banco
- Baixa latência via Redis (cache de embeddings, resultados e sessão)
- Hybrid search (semântico + léxico) com reranking via LLM-as-judge

---

## 1. Modelo de Dados

### `chat_embeddings`

```sql
CREATE TABLE chat_embeddings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id   UUID REFERENCES subjects(id) ON DELETE CASCADE,
  exam_id      UUID REFERENCES exams(id) ON DELETE CASCADE,
  result_id    UUID REFERENCES clinical_results(id) ON DELETE CASCADE,
  chunk_type   TEXT NOT NULL, -- 'interpretation' | 'alert' | 'recommendation' | 'patient_profile'
  content      TEXT NOT NULL,
  content_tsv  TSVECTOR,
  embedding    vector(1536) NOT NULL,
  source_label TEXT,          -- ex: "Exame 12/03 · João Silva · Metabólico"
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Busca semântica (ANN via HNSW — melhor para dados dinâmicos)
CREATE INDEX ON chat_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Índice alternativo IVFFlat (partições menores por tenant)
CREATE INDEX ON chat_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- Busca léxica BM25
CREATE INDEX ON chat_embeddings USING gin (content_tsv);

-- Filtro por tenant
CREATE INDEX ON chat_embeddings (tenant_id);
```

### Estratégia de Chunking

| Fonte | Tipo de Chunk | Tamanho | Overlap |
|---|---|---|---|
| `clinical_results.interpretation` | `interpretation` | 500 tokens | 100 tokens (20%) |
| `clinical_results.alerts` (por item) | `alert` | Atômico | Sem overlap |
| `clinical_results.recommendations` (por item) | `recommendation` | Atômico | Sem overlap |
| `subjects` (perfil demográfico + clínico) | `patient_profile` | Único por paciente | Sem overlap |

### Sessão de Chat (Redis only)

Sem tabela no banco. Sessão vive no Redis:
- `chat:session:{session_id}` → lista de até 10 mensagens (LPUSH + LTRIM), TTL 2h
- `chat:embedding:{hash(question)}` → vetor 1536d, TTL 1h
- `chat:result:{tenant_id}:{hash(question)}` → chunks retornados, TTL 5 min

---

## 2. Pipeline de Indexação

Acionado pelo evento `exam:done` no Redis pub/sub (já existente).

```
exam:done
    → apps/worker/src/rag/indexer.js
        1. busca clinical_results WHERE exam_id = $id
        2. chunking com overlap (500t / 100t) para interpretações
        3. embed em batch (lotes de 100) via OpenAI text-embedding-3-small
        4. gera content_tsv = to_tsvector('portuguese', content)
        5. upsert em chat_embeddings (DELETE WHERE exam_id + INSERT)
        6. indexa patient_profile do subject (se ainda não existir ou dados mudaram)
```

**Reindexação:** ao reprocessar um exame, chunks antigos do `exam_id` são deletados antes do insert.

**Perfil do paciente:** indexado uma vez por `subject_id`. Re-indexado se `subjects` for atualizado (trigger ou chamada explícita na rota PATCH /patients/:id).

---

## 3. Hybrid Search + LLM-as-Judge

### Busca Dual (paralela)

```
query do usuário
    ├── [semântico]  embed(query) → cosine via HNSW  → top-20 chunks
    └── [léxico]     plainto_tsquery('pt') → ts_rank  → top-20 chunks
```

Ambas as buscas aplicam `WHERE tenant_id = $tenant_id` como primeiro filtro.

### Fusão via RRF (Reciprocal Rank Fusion)

```
score(chunk) = 1/(60 + rank_semântico) + 1/(60 + rank_léxico)
```

Produz top-40 normalizado sem depender das escalas de score de cada canal.

### LLM-as-Judge (reranking)

Chamada ao **Claude Haiku** (rápido, baixo custo):

```
Pergunta: "{question}"
Chunks: [{id, source_label, content}...] (top-40 do RRF)
Retorne os 5 chunks mais relevantes em ordem:
{"ranked_ids": ["id1", "id2", "id3", "id4", "id5"]}
```

### Geração da Resposta

Chamada ao **Claude Sonnet** com os 5 chunks aprovados + últimas 10 msgs da sessão:
- Resposta narrativa em linguagem clínica objetiva
- Citações inline: `[Exame 12/03 · João Silva]`
- Bloco de fontes ao final: tipo, paciente, data, trecho

---

## 4. API

### Endpoints

```
POST /chat/message
  Body:  { session_id?: string, question: string }
  Auth:  JWT obrigatório
  Resp:  { session_id, answer, sources: Source[] }

DELETE /chat/session/:session_id
  Auth:  JWT obrigatório
  Resp:  204
```

```typescript
interface Source {
  type: 'interpretation' | 'alert' | 'recommendation' | 'patient_profile';
  subject_name: string;
  exam_date: string | null;
  chunk_excerpt: string;
}
```

### Fluxo Interno

```
POST /chat/message
    1. verifica cache Redis: embedding + resultado
    2. embed da query (OpenAI ou cache)
    3. busca dual paralela (semântico + léxico) WHERE tenant_id
    4. RRF → top-40
    5. LLM-as-judge (Haiku) → top-5
    6. recupera histórico: LRANGE chat:session:{id} 0 9
    7. LLM gerador (Sonnet) → { answer, sources }
    8. cacheia resultado, atualiza sessão Redis
    9. retorna resposta
```

---

## 5. Frontend

**Ponto de entrada:** ícone de chat fixo no topbar (direita), ao lado do menu do usuário.

**Componente:** `ChatPanelComponent` — painel lateral `<aside>` de 420px, slide-in pela direita, sem bloquear a tela.

**Comportamento:**
- `session_id` gerado no primeiro envio e armazenado em memória local
- Enter envia, Shift+Enter quebra linha
- Indicador de digitação (loading dots) durante requisição
- Chips de fonte clicáveis abaixo de cada resposta do assistente
- Botão "Nova conversa": chama `DELETE /chat/session/:id` e reseta estado local

---

## 6. Dependências Técnicas

| Componente | Tecnologia |
|---|---|
| Vector store | PostgreSQL + pgvector (já instalado) |
| Embeddings | OpenAI text-embedding-3-small (já usado) |
| Busca semântica | HNSW (novo index) |
| Busca léxica | PostgreSQL tsvector + GIN (nativo) |
| Fusão | RRF implementado em JS no API |
| Reranker | Claude Haiku (LLM-as-judge) |
| Gerador | Claude Sonnet |
| Cache / Sessão | Redis (já instalado) |
| Frontend | Angular standalone component |

---

## 7. Arquivos a Criar

**Backend (API):**
- `apps/api/src/db/migrations/025_chat_embeddings.sql`
- `apps/api/src/routes/chat.js`

**Worker:**
- `apps/worker/src/rag/indexer.js` (pipeline de indexação)
- `apps/worker/src/rag/chunker.js` (chunking com overlap)
- Acoplar `indexer.js` ao evento `exam:done` em `apps/worker/src/index.js`

**Frontend:**
- `apps/web/src/app/features/chat/chat-panel.component.ts`
- `apps/web/src/app/features/chat/chat.service.ts`
- Adicionar ícone de chat ao topbar em `app.component.ts`

---

## 8. Fora de Escopo (por ora)

- Upload de documentos externos pelo tenant
- Histórico persistido de conversas
- Streaming de tokens (resposta em lote)
- Chatbot por contexto de exame ou paciente específico (global apenas)
