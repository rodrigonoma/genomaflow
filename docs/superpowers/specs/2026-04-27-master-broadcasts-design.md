# Master Broadcasts (Comunicados do Administrador) — Design Spec

**Data:** 2026-04-27
**Status:** Spec aprovada (decisões abaixo confirmadas pelo PO)
**Autor:** rodrigo.noma — pareamento com Claude Opus 4.7

## Contexto e motivação

Hoje GenomaFlow não tem canal oficial pra comunicar tenants sobre:
- Promoções e ofertas
- Lançamento de features
- Avisos de bug fix / janela de manutenção
- Resposta a solicitações de melhoria que chegam via UI

Tudo é ad-hoc (email manual, suporte fora da plataforma). O resultado: tenants ficam desinformados, suporte vira gargalo, melhorias entregues passam despercebidas.

Demanda do usuário em 2026-04-27: **canal oficial "Administrador do GenomaFlow"** que aparece pra cada tenant no chat com mensagens enviadas pelo master, com suporte a anexos (imagem/PDF) e capacidade de o tenant responder pra solicitar melhorias.

## Decisões de produto (confirmadas)

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Arquitetura | **A** — Reaproveitar `tenant_messages` + flag |
| 2 | Segmentação no MVP | **(b)** — Todos / por módulo / tenant específico |
| 3 | Anexos | **Imagem + PDF** (sem vídeo no MVP) |
| 4 | Markdown | **Sim** (sanitizado com DOMPurify) |
| 5 | Notificação | **Só badge** (sem email/push browser) |
| 6 | Read receipts | **Sim** — master vê "X de Y leram" |

**Restrição crítica:** *"não deve quebrar nenhuma funcionalidade existente"* (inter-tenant chat tenant↔tenant, anti-abuse, rate limits, RLS). Toda mudança em policy/trigger/coluna existente exige análise de impacto.

## Alternativas consideradas

### Arquitetura A — reaproveitar `tenant_messages` (escolhida)
Adiciona coluna `kind` em `tenant_conversations`. Master broadcast cria/usa uma conversação por tenant alvo (par master↔tenant) com `kind='master_broadcast'`. Mensagens entram em `tenant_messages` normalmente.

**Prós:** UI/WS reaproveita 80%, replies "de graça", search full-text já funciona, audit_log automático, badge unread no painel já lê de `tenant_conversation_reads`.
**Contras:** precisa de coluna nova + ajuste em 2 triggers + 4 policies RLS. Análise cuidadosa requerida.

### Arquitetura B — tabela separada `master_broadcasts` + UI dedicada (rejeitada)
Toda mensagem master/reply em tabela isolada. Sidebar do chat mostra "Sistema" como entrada à parte.

**Prós:** isolamento total, zero risco de mexer em policies existentes.
**Contras:** duplica componentes (sidebar, thread, attachment upload, WS, search), masterUI dois canais (broadcasts vs replies do tenant), tenant precisa abrir UI separada.

Escolhido **A**: o ganho de UX (uma única caixa de chat) e reuso de infraestrutura supera a complexidade de schema (uma migration cuidadosa).

## Arquitetura

### Identidade do remetente
- Master tenant existe: `id='00000000-0000-0000-0000-000000000001'`, `module='human'` (já em migration 031)
- Master user existe: `email='rodrigonoma@genomaflow.com.br'`, `role='master'`, `tenant_id=00...001`
- `tenant_a_id < tenant_b_id` (CHECK existente em 047): como `00...001` é o menor UUID possível, master sempre vai ser `tenant_a_id` em conversações master_broadcast — sem conflito.

### Schema novo (migration 058)

```sql
-- 058_master_broadcasts.sql

-- 1. Coluna `kind` em tenant_conversations (default preserva comportamento atual)
ALTER TABLE tenant_conversations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'tenant_to_tenant'
  CHECK (kind IN ('tenant_to_tenant', 'master_broadcast'));

CREATE INDEX IF NOT EXISTS tenant_conversations_kind_idx
  ON tenant_conversations(kind) WHERE kind = 'master_broadcast';

-- 2. Tabela canônica de broadcasts (auditoria + métricas)
CREATE TABLE IF NOT EXISTS master_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  segment_kind TEXT NOT NULL CHECK (segment_kind IN ('all', 'module', 'tenant')),
  segment_value TEXT, -- 'human'|'veterinary' p/module, tenant_id p/tenant, NULL p/all
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Anexos do broadcast (1 broadcast → N anexos compartilhados entre tenants)
CREATE TABLE IF NOT EXISTS master_broadcast_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES master_broadcasts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'pdf')),
  filename TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tracking de delivery por tenant — pra metrics + rastreabilidade
CREATE TABLE IF NOT EXISTS master_broadcast_deliveries (
  broadcast_id UUID NOT NULL REFERENCES master_broadcasts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES tenant_conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES tenant_messages(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (broadcast_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS master_broadcast_deliveries_tenant_idx
  ON master_broadcast_deliveries(tenant_id, delivered_at DESC);
```

### Ajustes em triggers existentes

```sql
-- enforce_chat_same_module: skip quando kind='master_broadcast'
CREATE OR REPLACE FUNCTION enforce_chat_same_module() RETURNS trigger AS $$
DECLARE
  module_a TEXT; module_b TEXT;
BEGIN
  -- Master broadcasts são cross-module by design
  IF TG_TABLE_NAME = 'tenant_conversations' AND NEW.kind = 'master_broadcast' THEN
    RETURN NEW;
  END IF;
  -- (resto do código existente preservado byte-a-byte)
  ...
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### RLS — análise de impacto

Policies em `tenant_conversations`, `tenant_messages`, `tenant_message_attachments`, `tenant_conversation_reads` usam `app_is_conversation_member(conv_id)` que checa `tenant_a_id = ctx OR tenant_b_id = ctx`. Master tenant (`00...001`) nunca é `app.tenant_id` em request normal — **policies funcionam sem alteração** pra master broadcasts:
- Tenant alvo (`tenant_b_id`) é membro → vê mensagens, lê, reage.
- Master vê via `withTenant(master_tenant_id)` ou via fastify.pg sem RLS context (já é o padrão de rotas master).

**Não precisa alterar policies.** A tabela canônica `master_broadcasts` é master-only e não recebe RLS (similar a `audit_log`):
```sql
ALTER TABLE master_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_broadcasts FORCE ROW LEVEL SECURITY;
CREATE POLICY mb_master_only ON master_broadcasts USING (
  NULLIF(current_setting('app.tenant_id', true), '') IS NULL
);
```
(Master sem `app.tenant_id` → vê tudo. Tenant com `app.tenant_id` → vê nada.)

### Flow: master envia broadcast

`POST /master/broadcasts`
```json
{
  "body": "Texto markdown...",
  "segment": { "kind": "all" } | { "kind": "module", "value": "human" } | { "kind": "tenant", "value": "<tenant_uuid>" },
  "attachments": [{ "kind": "image", "filename": "...", "data_base64": "...", "mime_type": "image/jpeg" }]
}
```

Backend:
1. ACL `role === 'master'` (helper `masterOnly` existente)
2. Validação body (1..2000 chars), markdown será renderizado client-side com sanitização
3. Anexos: imagem (JPEG/PNG) ou PDF, até 10MB. Upload S3 prefix `master-broadcasts/{broadcast_id}/{filename}`. **Skip de PII checks** (master sabe o que envia)
4. Resolve target tenants:
   - `all`: SELECT id FROM tenants WHERE active=true AND id != master_tenant
   - `module`: + AND module=$1
   - `tenant`: SELECT id FROM tenants WHERE id=$1 AND active=true (deve retornar 1)
5. INSERT `master_broadcasts` (canonical) + INSERT `master_broadcast_attachments`
6. Pra cada tenant alvo (loop síncrono — viável até ~500 tenants):
   - UPSERT em `tenant_conversations`: `(tenant_a=master, tenant_b=tenant, kind='master_broadcast', module=tenant.module)`. Se já existe, reusa.
   - INSERT `tenant_messages` (sender_tenant=master, sender_user=master_user, body=broadcast.body, has_attachment=true se houver anexo)
   - Pra cada anexo: INSERT `tenant_message_attachments` (message_id, kind, s3_key=mesmo s3_key do master_broadcast_attachments — **evita duplicar arquivo no S3**)
   - INSERT `master_broadcast_deliveries`
   - Redis publish `chat:event:{tenant}` com `{ event: 'master_broadcast_received', conversation_id, message_id }`
7. UPDATE `master_broadcasts.recipient_count`
8. Retorna `{ broadcast_id, recipient_count }`

**Rate limit:** 20 broadcasts/dia por master user.

### Flow: tenant vê + responde

- Existing `GET /inter-tenant-chat/conversations` retorna conversas — adicionar suporte pra `kind='master_broadcast'` no response (campo já vai estar no SELECT).
- Sidebar (apps/web): conversation com `kind='master_broadcast'` é pinned no topo, label "Administrador GenomaFlow", ícone `admin_panel_settings` (ou logo), sem botão de bloquear/sair.
- Thread: render markdown sanitizado (DOMPurify) só pra mensagens onde `sender_tenant_id = master_tenant_id` (segurança — markdown só do sender confiável).
- Reply: `POST /inter-tenant-chat/conversations/:id/messages` existente. **Single change:** validação atual checa `tenant_blocks` e cooldown — ambos são contra peer-to-peer; quando `conversation.kind='master_broadcast'`, **skip dessas validações**. Mantém PII checks (tenant pode enviar dado clínico em reply, regra normal aplica).

### Flow: master vê replies + responde

- `GET /master/broadcasts` — histórico paginado com `recipient_count`, `read_count` (computado), data
- `GET /master/broadcasts/:id` — detalhe + lista de tenants que leram + breakdown por status
- `GET /master/conversations` — inbox de conversas master_broadcast com unread (replies de tenants pendentes)
- `GET /master/conversations/:id/messages` — thread (master vê de fora do RLS context, só via auth master)
- `POST /master/conversations/:id/reply` — INSERT em `tenant_messages` direto (sem criar broadcast row), Redis publish notify recipient. Validação: `conversation.kind='master_broadcast'`. Anexos opcionais. Rate limit 100/dia.

### UI master panel — nova tab "Comunicados"

```
┌─ Comunicados ─────────────────────────────┐
│ ┌─ Composer ───────────────────────────┐  │
│ │ Segmento: [Todos ▾]                 │  │
│ │ ┌──────────────────────────────────┐ │  │
│ │ │ # Markdown editor                │ │  │
│ │ │                                  │ │  │
│ │ └──────────────────────────────────┘ │  │
│ │ [📎 Anexar]    [Enviar p/ N tenants]│  │
│ └─────────────────────────────────────┘  │
│                                           │
│ ┌─ Histórico ──────────────────────────┐  │
│ │ 27/04 14:33 · 12 enviados · 8 leram  │  │
│ │ "Bug do exam-card corrigido..."      │  │
│ │ ───                                   │  │
│ │ ...                                   │  │
│ └─────────────────────────────────────┘  │
│                                           │
│ ┌─ Caixa de respostas ─────────────────┐  │
│ │ • Clínica X — "obrigado, mas ainda…" │ ●│
│ │ • Vet Y     — "vocês podem adicionar"│ ●│
│ └─────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

## Cobertura testes

- `tests/security/master-acl.test.js` — adicionar todas as rotas novas master-only
- `tests/routes/master-broadcasts.test.js` — validation: segment_kind whitelist, body length, attachments shape, rate limit; ACL master-only; fan-out: sem alvos válidos → 400; quando segment=tenant inativo → 404; happy path retorna recipient_count correto
- `tests/routes/inter-tenant-chat-master.test.js` — tenant respondendo em master_broadcast conversation: skip de tenant_blocks check; validação que `messages.js` não quebra fluxo tenant↔tenant existente
- `apps/web/.../master-broadcasts.component.spec.ts` — composer validation, segment selector, attachment preview
- E2E manual:
  - Master envia "all" sem anexo → todos os tenants ativos recebem na sidebar
  - Master envia "module=human" com imagem → só tenants human recebem; vet não vê
  - Tenant clica conversation, vê markdown renderizado com sanitização
  - Tenant responde → master vê na inbox em tempo real
  - Bloqueio entre tenants existentes: tenant A bloqueia tenant B, master broadcast pra ambos chega normalmente (não afetado por block)

## Trade-offs e limitações conhecidas

- **Fan-out síncrono**: até ~500 tenants OK. Acima disso, mover pra BullMQ. Documentado no plano de execução.
- **Markdown injection**: master é trusted, mas DOMPurify é obrigatório no client por defesa em profundidade. Whitelist de tags: p, strong, em, a (rel=noopener), ul/ol/li, code, pre, h2/h3, br.
- **Read receipts**: master vê count, não lista nominal de tenants. UI agregada no MVP.
- **Anexos**: imagem JPEG/PNG até 10MB, PDF até 10MB. Sem vídeo (V2). MIME type validado backend.
- **S3 prefix novo**: `master-broadcasts/*` precisa de IAM update na task ECS — ver `feedback_iam_s3_prefixes.md` (incidente 2026-04-25).

## Branches/commits previstos

| Fase | Branch | Conteúdo |
|---|---|---|
| 1 | `feat/master-broadcasts-schema` | Migration 058 + ajuste de trigger + helpers backend (sem UI) |
| 2 | `feat/master-broadcasts-api` | POST /master/broadcasts (texto-only, all/module/tenant) + fan-out + WS event |
| 3 | `feat/master-broadcasts-tenant-ui` | Sidebar pinned + thread render markdown + reply guard skip blocks |
| 4 | `feat/master-broadcasts-attachments` | Upload imagem/PDF + IAM S3 + UI anexar |
| 5 | `feat/master-broadcasts-master-ui` | Tab "Comunicados" no /master + inbox + reply + métricas |
| 6 | `docs/master-broadcasts-tests-and-memory` | Tests adicionais + CLAUDE.md + memória + spec final |

Cada fase: branch própria → testes locais → smoke → push → aguardar OK → merge.
