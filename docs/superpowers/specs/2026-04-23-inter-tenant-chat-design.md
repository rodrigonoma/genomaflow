---
title: "Chat entre tenants — V1"
date: 2026-04-23
status: spec aprovado, aguardando plano de implementação
owners: [backend, frontend, platform]
related: []
---

## 1. Resumo executivo

Comunicação 1:1 entre clínicas (tenants) da plataforma, separada por módulo (`human` ↔ `human`, `veterinary` ↔ `veterinary`), com convite + aceite obrigatórios. Suporta:

- **F1 — Segunda opinião anonimizada**: médico de uma clínica discute caso com médico de outra, podendo anexar análises da IA, PDFs e imagens **sem trafegar nenhum dado pessoal de paciente** (filtro PII obrigatório).
- **F3 — Operacional**: dúvida comercial entre clínicas (estoque de remédios, disponibilidade de procedimentos, parceria).

Encaminhamento formal de paciente (F2) **fora do escopo** — só será considerado se houver demanda recorrente de várias clínicas. Quando entrar, será spec/feature separada.

## 2. Personas e casos de uso

### Casos típicos
- **Caso A** (F1): Dr. Silva (Clínica do Coração SP, human) tem ECG complexo. Convida Dr. Costa (Cardio Avançada RJ). Após aceite, abre conversa, anexa **análise IA cardiovascular anonimizada** + texto livre. Dr. Costa responde com sugestão. Sem nome de paciente em momento algum.
- **Caso B** (F3): Vet Pet Care (veterinary) precisa saber se Vet Equinos do Sul tem disponibilidade de anestesia para equino de grande porte. Texto puro, sem dado clínico de animal específico.

### Não-objetivos
- Chat aberto/social (sem aceite)
- Grupos / chat com 3+ tenants
- Conversa entre user-user (a unidade de comunicação é o tenant, não o usuário individual)
- Cross-module (human falando com veterinary)
- Voice/video, edição de mensagem, threads

## 3. Decisões de design e rationale

| # | Decisão | Rationale |
|---|---|---|
| D1 | Apenas role `admin` envia/recebe (V1) | Não temos múltiplos perfis de user dentro do tenant ainda; revisão de pricing multi-user fora do escopo |
| D2 | Conversa = par (`tenant_a, tenant_b`), só 1:1 | YAGNI; grupos exigem moderação que não temos |
| D3 | Convite **irrevogável** após aceite | Revogar = exclusão de dados, complexidade de UX e LGPD desnecessária pra V1 |
| D4 | Cross-module proibido | Discutir caso humano com veterinário não faz sentido clínico |
| D5 | Anonimização **obrigatória** em anexos | Único modo de evitar consentimento explícito do paciente para essa finalidade (LGPD Art. 11) |
| D6 | Diretório opt-in default OFF | Privacidade-by-default; clínica decide ativar |
| D7 | Sem cobrança de crédito por análise PII | Custo de infra (~R$ 0,03/anexo) absorvido; cobrar por compliance é frágil juridicamente |
| D8 | Auto-redação de PII com **aprovação humana** explícita | Mantém médico como agente responsável (LGPD); reduz risco de auto-redação falhar silenciosamente |
| D9 | Mensagens **sem expiração** no V1 (delete manual) | YAGNI; política de retenção configurável vira V2 quando houver dado real de uso |
| D10 | Sem push mobile no V1 | Requer PWA + service worker (3-5 dias separados); WebSocket in-app + email cobrem o uso esperado |
| D11 | Zero ALTER em tabelas existentes | Chat é feature apartada; mantém blast radius mínimo, evita migrations conflitantes |
| D12 | DICOM fora do V1 | Anonimização exige stripping de tags + possivelmente OCR de "burned-in" PII; trabalho separado |

## 4. Multi-módulo

A regra `human ↔ human / veterinary ↔ veterinary` é aplicada em **três camadas**:

1. **DB**: `tenant_conversations.module CHECK` + trigger valida que `tenant_a.module = tenant_b.module = conversation.module`
2. **API**: ao criar convite, valida `from_tenant.module = to_tenant.module`; ao listar diretório, filtra por `module = current_user.module`
3. **UI**: diretório só mostra tenants do mesmo módulo

Defesa em profundidade conforme `CLAUDE.md`.

## 5. Schema (todas tabelas novas — zero ALTER)

### 5.1 `tenant_chat_settings`
Preferências de chat por tenant. Existência da linha = chat habilitado.

```sql
CREATE TABLE tenant_chat_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  visible_in_directory BOOLEAN NOT NULL DEFAULT false,
  notify_on_invite_email BOOLEAN NOT NULL DEFAULT true,
  notify_on_message_email BOOLEAN NOT NULL DEFAULT false,
  message_email_quiet_after_minutes INT NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.2 `tenant_directory_listing`
**Tabela física** (não view materializada) sincronizada via trigger em `tenant_chat_settings`. Decisão: tabela física é mais simples para indexar (GIN trigram em `name`), mais barato refresh por evento (insere/deleta linha) que `REFRESH MATERIALIZED VIEW` periódico, e permite invariantes (ex: `last_active_month` mensal preserva privacidade). Derivada de `tenant_chat_settings + tenants + tenant_specialties`. Exposta na busca pública do diretório.

```sql
CREATE TABLE tenant_directory_listing (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  module TEXT NOT NULL CHECK (module IN ('human', 'veterinary')),
  region_uf CHAR(2),
  region_city TEXT,
  specialties TEXT[] NOT NULL DEFAULT '{}',
  last_active_month DATE,  -- mês arredondado pra preservar privacidade
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tenant_directory_module_uf_idx ON tenant_directory_listing(module, region_uf);
CREATE INDEX tenant_directory_specialties_gin ON tenant_directory_listing USING GIN (specialties);
CREATE INDEX tenant_directory_name_trgm ON tenant_directory_listing USING GIN (name gin_trgm_ops);
```

População: trigger em `tenant_chat_settings` (insere/remove conforme `visible_in_directory`).

### 5.3 `tenant_invitations`

```sql
CREATE TABLE tenant_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  to_tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('human', 'veterinary')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  message TEXT,  -- mensagem opcional do remetente
  sent_by_user_id UUID NOT NULL REFERENCES users(id),
  responded_by_user_id UUID REFERENCES users(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CHECK (from_tenant_id <> to_tenant_id)
);

CREATE INDEX tenant_invitations_to_status_idx   ON tenant_invitations(to_tenant_id, status);
CREATE INDEX tenant_invitations_from_status_idx ON tenant_invitations(from_tenant_id, status);
-- Anti-spam: 1 convite pendente por par direcionado
CREATE UNIQUE INDEX tenant_invitations_pending_unique
  ON tenant_invitations(from_tenant_id, to_tenant_id) WHERE status = 'pending';
```

### 5.4 `tenant_blocks`
Bloqueio bilateral: se A bloqueou B, B nem aparece pra A nem pode mandar convite.

```sql
CREATE TABLE tenant_blocks (
  blocker_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  blocked_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_tenant_id, blocked_tenant_id),
  CHECK (blocker_tenant_id <> blocked_tenant_id)
);
```

### 5.5 `tenant_conversations`

```sql
CREATE TABLE tenant_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_a_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_b_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('human', 'veterinary')),
  created_from_invitation_id UUID REFERENCES tenant_invitations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  archived_by_a BOOLEAN NOT NULL DEFAULT false,
  archived_by_b BOOLEAN NOT NULL DEFAULT false,
  CHECK (tenant_a_id < tenant_b_id)  -- ordem canônica evita duplicata (a,b) e (b,a)
);

CREATE UNIQUE INDEX tenant_conversations_pair_idx ON tenant_conversations(tenant_a_id, tenant_b_id);
CREATE INDEX tenant_conversations_lookup_idx ON tenant_conversations(tenant_a_id, last_message_at DESC);
CREATE INDEX tenant_conversations_lookup_b_idx ON tenant_conversations(tenant_b_id, last_message_at DESC);
```

`tenant_a_id < tenant_b_id` garante 1 conversa única por par independente da ordem do convite.

### 5.6 `tenant_messages`

```sql
CREATE TABLE tenant_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES tenant_conversations(id) ON DELETE CASCADE,
  sender_tenant_id UUID NOT NULL REFERENCES tenants(id),
  sender_user_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL DEFAULT '',
  body_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('portuguese', body)) STORED,
  has_attachment BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,  -- soft delete (admin pode apagar conversa)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tenant_messages_conv_created_idx ON tenant_messages(conversation_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX tenant_messages_search_gin ON tenant_messages USING GIN (body_tsv);
```

### 5.7 `tenant_message_attachments`

```sql
CREATE TABLE tenant_message_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES tenant_messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ai_analysis_card', 'pdf', 'image')),
  s3_key TEXT,                  -- pdf/image; null para ai_analysis_card
  payload JSONB,                -- ai_analysis_card → snapshot anonimizado
  original_size_bytes BIGINT,
  redacted_regions_count INT NOT NULL DEFAULT 0,
  original_hash TEXT,           -- sha256 do upload original (audit; original NÃO é guardado)
  redacted_hash TEXT,           -- sha256 do arquivo final salvo no S3
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tenant_attachments_message_idx ON tenant_message_attachments(message_id);
```

### 5.8 `tenant_message_pii_checks`

```sql
CREATE TABLE tenant_message_pii_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attachment_id UUID NOT NULL REFERENCES tenant_message_attachments(id) ON DELETE CASCADE,
  detected_kinds TEXT[] NOT NULL DEFAULT '{}',  -- ex: {cpf, name, email}
  region_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('clean', 'auto_redacted_confirmed', 'cancelled_by_user')),
  confirmed_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.9 `tenant_message_reactions`

```sql
CREATE TABLE tenant_message_reactions (
  message_id UUID NOT NULL REFERENCES tenant_messages(id) ON DELETE CASCADE,
  reactor_tenant_id UUID NOT NULL REFERENCES tenants(id),
  reactor_user_id UUID NOT NULL REFERENCES users(id),
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, reactor_user_id, emoji)
);

CREATE INDEX tenant_message_reactions_msg_idx ON tenant_message_reactions(message_id);
```

Set curado V1: `👍 ❤ 🤔 ✅ 🚨 📌`. Validação no backend (lista whitelist).

### 5.10 `tenant_conversation_reads`

```sql
CREATE TABLE tenant_conversation_reads (
  conversation_id UUID NOT NULL REFERENCES tenant_conversations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  last_read_message_id UUID REFERENCES tenant_messages(id),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, tenant_id)
);
```

## 6. RLS — defesa em profundidade

Todas as 10 tabelas: `ENABLE + FORCE` RLS.

### Padrão para tabelas de tenant único (settings, directory, blocks)

```sql
CREATE POLICY tenant_chat_settings_isolation ON tenant_chat_settings
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

### Padrão para tabelas de par (conversations, messages, attachments, reactions, reads, invitations)

```sql
CREATE POLICY tenant_conversations_member ON tenant_conversations
  FOR ALL USING (
    tenant_a_id = current_setting('app.tenant_id', true)::uuid OR
    tenant_b_id = current_setting('app.tenant_id', true)::uuid
  );
```

### Helper backend novo

```js
// apps/api/src/db/conversation.js
async function withConversationAccess(pool, conversationId, tenantId, fn) {
  return withTenant(pool, tenantId, async (client) => {
    // valida explicitamente — RLS é última camada
    const { rows } = await client.query(
      `SELECT id FROM tenant_conversations
       WHERE id = $1 AND (tenant_a_id = $2 OR tenant_b_id = $2)`,
      [conversationId, tenantId]
    );
    if (!rows[0]) throw new Error('conversation_access_denied');
    return fn(client, rows[0]);
  });
}
```

### Defesa em profundidade

Toda query no chat **deve** ter filtro explícito `(tenant_a_id = $X OR tenant_b_id = $X)` ou `sender_tenant_id = $X`, mesmo dentro do helper. Conforme `CLAUDE.md > Arquitetura Multi-tenant > Defesa em profundidade`.

## 7. API endpoints

Prefixo: `/inter-tenant-chat`. Todos com `preHandler: [fastify.authenticate]` + check `role === 'admin'`.

### Configuração
- `GET    /settings`
- `PUT    /settings` — toggle visibility, email prefs

### Diretório
- `GET    /directory?module=&uf=&specialty=&q=&page=` — search com filtros (module forçado para o módulo do user)

### Convites
- `GET    /invitations?direction=incoming|outgoing`
- `POST   /invitations` — `{ to_tenant_id, message? }` — rate limit 20/dia
- `POST   /invitations/:id/accept`
- `POST   /invitations/:id/reject`
- `DELETE /invitations/:id` — cancelar (só sender, só pending)

### Bloqueios
- `GET    /blocks`
- `POST   /blocks` — `{ blocked_tenant_id, reason? }`
- `DELETE /blocks/:tenant_id`

### Conversas
- `GET    /conversations` — lista com unread por conv + tenant counterpart info
- `GET    /conversations/:id`
- `POST   /conversations/:id/archive`
- `POST   /conversations/:id/unarchive`
- `DELETE /conversations/:id` — soft delete (anonimiza body, mantém metadata)

### Mensagens
- `GET    /conversations/:id/messages?before=&limit=` — paginação por cursor
- `POST   /conversations/:id/messages` — `{ body, attachments? }`
- `POST   /conversations/:id/read` — atualiza `last_read_at`
- `GET    /conversations/:id/search?q=` — full-text

### Anexos
- `POST   /attachments/upload` — multipart; rate limit 30/dia. Pipeline:
  1. Recebe arquivo
  2. OCR (Textract para imagem; pdf-parse + Textract para PDF)
  3. Filtro PII (regex + LLM)
  4. Se limpo → salva no S3, retorna `{ attachment_id, status: 'clean' }`
  5. Se PII detectado → gera preview redigido in-memory, retorna `{ attachment_id, status: 'pending_confirmation', preview_url, redacted_regions }`
- `POST   /attachments/:id/confirm` — médico aprova versão redigida; persiste no S3
- `DELETE /attachments/:id` — cancela (descarta)
- `POST   /attachments/ai-analysis-card` — `{ exam_id, agent_types[] }` — gera snapshot anonimizado da análise IA (sem `subject_id`, sem `subject_name`, mantém faixas etárias e clínicas)

### Reações
- `POST   /messages/:id/reactions` — `{ emoji }` — toggle
- `DELETE /messages/:id/reactions/:emoji`

### Total
~24 endpoints. Tamanho razoável.

## 8. WebSocket events

Reuso do `WsService` existente. Novo namespace: `chat:`

| Evento | Direção | Payload |
|---|---|---|
| `chat:invitation_received` | server → recipient tenant | `{ invitation_id, from_tenant_name }` |
| `chat:invitation_accepted` | server → sender tenant | `{ invitation_id, conversation_id }` |
| `chat:message_received` | server → counterpart tenant | `{ conversation_id, message_id, preview }` |
| `chat:reaction_changed` | server → counterpart tenant | `{ message_id, emoji, count, action: 'added'\|'removed' }` |
| `chat:unread_change` | server → recipient tenant | `{ conversation_id, unread_count, total_unread }` |
| `chat:typing` | bidirectional | `{ conversation_id }` (debounced 3s; opcional V1.1) |

Heartbeat de 30s já existente continua valendo.

## 9. UI/UX

### Sidebar
Novo item "Chat" entre "Análises IA" e "Suporte", com badge de unread em vermelho (ponto + número).

### Tela /chat (lista de conversas)
- Esquerda: lista de conversas (avatar com inicial da clínica, nome, última mensagem, badge unread, data)
- Direita: thread aberta (vazio quando nenhuma selecionada)
- Topo direito: botão "+ Nova conversa" → modal de diretório

### Modal "Nova conversa" (diretório)
- Filtros: UF (dropdown), especialidade (chips multi-select), busca por nome
- Cards com: nome da clínica, cidade/UF, especialidades (chips), botão "Convidar"
- Empty state com CTA "Tornar minha clínica visível" se settings desativado
- Aviso "Você ainda não está visível no diretório. As clínicas que você convidar verão seu nome e UF" quando settings.visible_in_directory = false (educa o usuário)

### Modal "Convites recebidos"
- Acessível por badge no topbar ou item no sidebar
- Cada convite: nome remetente, mensagem opcional, botões "Aceitar" / "Recusar" / "Bloquear"

### Thread de conversa
- Header: nome da clínica counterpart + módulo + ações (arquivar, deletar, bloquear)
- Mensagens em bolhas (eu à direita, contraparte à esquerda)
- Cards de anexo embutidos (visual definido na seção 10)
- Input no rodapé:
  - Textarea expansível
  - Botão `+` (anexar) → menu (📊 Análise IA / 📄 PDF / 🖼 Imagem)
  - Botão `😊` (emoji rápido para reagir à última mensagem)
  - Enter envia, Shift+Enter quebra linha
- Barra de busca no topo (lupa) → input full-text com snippets clicáveis

### Notificação visual
- Toast no canto superior direito ao receber mensagem nova (3s)
- Badge persistente no sidebar até abrir a conversa

## 10. Cards de anexo (visual)

### Análise IA anonimizada
```
┌─ 📊 Cardiovascular · Crítica ──────────────────────┐
│ Equino · 8 anos · Macho · 450kg                    │
│ Risk score: 8.2/10  ·  3 alertas críticos          │
│ [Ver análise completa ▾]                           │
└────────────────────────────────────────────────────┘
```
Expansível inline (acordeão) ou abre modal com risk scores, alertas e recomendações.

### PDF
```
┌─ 📄 ECG_anonimizado.pdf · 1.2MB ──────────────────┐
│ 🛡 Verificado LGPD · 4 páginas                     │
│ [Visualizar]                                        │
└────────────────────────────────────────────────────┘
```
Visualizar abre PDF em nova aba via signed URL S3 (expire 1h).

### Imagem
```
┌─ 🖼 imagem.jpg · 480KB ────────────────────────────┐
│ [thumbnail 200x200]                                │
│ 🛡 Verificado LGPD                                 │
└────────────────────────────────────────────────────┘
```

### Cor do selo
- 🛡 verde = limpo na primeira passagem
- 🛡 amarelo = passou por auto-redação (mostra contagem de regiões redigidas no tooltip)

## 11. Pipeline de filtro PII

### Etapas
1. **Recebe arquivo** no endpoint `POST /attachments/upload`
2. **OCR** (Textract para imagem; `pdf-parse` + Textract para PDF se imagem-puro)
3. **Análise PII em 2 camadas:**
   - Regex determinístico: CPF (`\d{3}\.?\d{3}\.?\d{3}-?\d{2}`), CNPJ, telefone BR, email, CEP, RG, data nascimento `dd/mm/yyyy`
   - LLM (haiku-4-5): prompt curto "Identifique nomes próprios, endereços, números de prontuário ou outras informações pessoais identificáveis no texto a seguir. Responda JSON com lista de spans `[{ start, end, kind }]`"
4. **Decisão:**
   - **Sem detecção (clean)** → arquivo original sobe ao S3 inalterado (não há PII a redigir); status `clean`. `original_hash = redacted_hash` (mesmo arquivo).
   - **Com detecção** → arquivo original mantém-se em buffer temporário; gera preview com regiões marcadas (Sharp para imagem, pdf-lib para PDF); retorna `pending_confirmation`. Buffer expira em 10min se não confirmado.
5. **Médico revisa** preview no frontend (overlay com retângulos vermelhos/borrados sobre as regiões detectadas)
6. **Confirma:**
   - Aprovou → renderiza versão final redigida (retângulos pretos sólidos sobre regiões PII), salva no S3, descarta buffer com original; status `auto_redacted_confirmed`
   - Cancelou → descarta buffer com original, nada vai pro S3; status `cancelled_by_user`
7. **Quando há PII detectado, o arquivo original NUNCA é persistido em S3.** O `original_hash` é registrado em `tenant_message_attachments` apenas como prova criptográfica para audit (sem permitir reconstrução do conteúdo).

### Bibliotecas
- Backend: `sharp` (imagem), `pdf-lib` (PDF), `@aws-sdk/client-textract`, `@anthropic-ai/sdk`
- Frontend: canvas overlay sobre preview, `<canvas>` API

### Custos por análise
- Textract: ~$0.0015 / página
- LLM (haiku): ~$0.0001 / mensagem
- Total: <R$ 0,03 — **absorvido**

### Audit
Toda análise gera linha em `tenant_message_pii_checks` (independente de detectar ou não):
- `clean` → 1 linha com `detected_kinds=[]`, `region_count=0`
- `auto_redacted_confirmed` → 1 linha com `detected_kinds=[...]`, `region_count=N`, `confirmed_by_user_id`
- `cancelled_by_user` → 1 linha com `detected_kinds=[...]`, `confirmed_by_user_id` null

## 12. Anti-abuso

- **Rate limit envio de convite**: 20/dia por tenant (`@fastify/rate-limit` com `keyGenerator` por `tenant_id`)
- **Rate limit upload anexo**: 30/dia por tenant
- **Rate limit envio mensagem**: 200/dia por conversa (proteção anti-spam)
- **Auto-cooldown**: se mesmo `to_tenant_id` rejeitar 3 convites consecutivos do mesmo `from_tenant_id`, bloqueia novos convites por 30 dias
- **Bloqueio bilateral**: clínica pode bloquear outra (UI visível no header da conversa); some do diretório pra ela e impede convite
- **Denúncia**: botão "Reportar" no header. 3 denúncias diferentes → row em `tenant_chat_reports`, suspensão automática do tenant denunciado no chat (não no GenomaFlow inteiro), notifica master via dashboard

## 13. LGPD — base legal e responsabilidades

- **Anonimização obrigatória de anexos** = base legal **dispensa consentimento específico** (dado anonimizado escapa da LGPD por definição, Art. 5º III)
- **Texto livre** entre médicos = responsabilidade do médico não digitar dado pessoal; filtro client-side educa em tempo real, gate server-side bloqueia hard
- **Confirmação humana da auto-redação** = transfere agência ao médico (controlador prático), GenomaFlow é operador da ferramenta
- **Direito do titular**: como anexos são anonimizados, não há "titular dos dados" identificável → direito de acesso/exclusão não se aplica aos anexos. Mensagens texto: titular pode pedir exclusão se ainda houver PII por engano (não bloqueado pelo filtro); fluxo manual pelo suporte master
- **Audit**: 5 anos retenção de `tenant_message_pii_checks` (compliance LGPD demanda registro de tratamento de dado sensível)
- **DPO/Encarregado**: ao habilitar o chat, exibir aviso "Esta funcionalidade compartilha dados com outras clínicas. É proibido digitar nome, CPF ou outros dados pessoais de pacientes. Anexos são analisados automaticamente e dados pessoais detectados são removidos antes do envio."

## 14. Notificações de mensagens

### V1
- WebSocket in-app (já existe) → toast + badge atualiza em tempo real
- Email opcional para mensagem recebida se aba do user fechada > `message_email_quiet_after_minutes` (default 30min). Configurável em `tenant_chat_settings`
- Email para convite recebido (default ON)

### V2 (spec separada — fora do escopo)
- PWA + Web Push (Service Worker + VAPID keys, ~3-5 dias de trabalho)
- Habilita push em Android/Desktop e iOS 16.4+

### V3 (se demanda)
- App nativo via Capacitor

## 15. Custos AWS estimados (mensal, para 100 tenants ativos no chat)

| Item | Estimativa | Notas |
|---|---|---|
| Textract OCR | ~$5 | 30 anexos/dia × 100 tenants × 30 dias = 90k páginas. $1.5/1k = $135 — provavelmente bem menor na prática |
| LLM PII check (haiku) | ~$3 | 90k mensagens × ~50 tokens × $0.0001 |
| Postgres storage (mensagens + tsvector + reads) | ~$1 | RDS já existente, marginal |
| S3 anexos | ~$2 | ~10MB × 100 tenants/dia × 30 dias = 30GB; lifecycle 1 ano |
| WebSocket overhead | $0 | já existente |
| **Total** | **~$11/mês** | escalável linearmente |

Sem cobrança de crédito; custo absorvido.

## 16. Migração

Migration única `047_inter_tenant_chat.sql`:
- Cria 10 tabelas com RLS ENABLE + FORCE
- Cria índices (incluindo trigram para name search)
- Cria policies
- Cria função trigger para sincronizar `tenant_directory_listing` com `tenant_chat_settings`
- Cria extensão `pg_trgm` (se não existir)

Migration aditiva (sem ALTER em tabela existente). Reversível (DROP TABLE em ordem inversa).

## 17. Compatibilidade multi-módulo

Conforme `CLAUDE.md > Compatibilidade Multi-módulo`:

- **human**: clínicas humanas conversam entre si; cards de análise IA mostram "Pacientes" / agentes humanos (metabolic, cardiovascular, hematology, etc.)
- **veterinary**: clínicas vet conversam entre si; cards mostram "Animais" / agentes vet (small_animals, equine, bovine), com espécie/raça/peso
- Constraint de DB + check de API + filtro de UI garantem isolamento

Nenhuma regressão no módulo: chat é feature aditiva.

## 18. Plano de testes

- **Backend (Jest + supertest)**:
  - Convite: criar, aceitar, rejeitar, cancelar; rate limit; cross-module bloqueado; auto-cooldown
  - Conversa: criação após aceite; isolamento (tenant C não vê conversa A↔B)
  - Mensagem: enviar, receber via WS, soft delete; busca full-text
  - Anexos: pipeline PII (clean / detected / confirmed / cancelled); rate limit
  - Bloqueio: bilateral funciona; convite bloqueado retorna 403
  - Reads: badge correto após enviar/ler

- **RLS (testes SQL diretos)**:
  - Tenant A não vê conversa B↔C nem mensagens nem reactions nem reads
  - User com `app.tenant_id` errado retorna 0 linhas

- **Frontend (Cypress / manual)**:
  - Fluxo completo: opt-in → buscar → convidar → aceitar → mensagem → anexar análise IA → reagir → ler → badge zera
  - PII detectado em PDF: preview marcado, confirma, anexa
  - PII detectado: cancela, anexo descartado
  - Tentativa de cross-module: erro UI

## 19. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| OCR não detecta PII em imagem com letra cursiva | média | alto (vazamento) | Confirmação humana é fallback; texto extra "Anexar imagem com manuscrito requer atenção redobrada" no upload |
| LLM PII check falsos positivos frustram médicos | média | médio (fricção) | Tooling pra usuário ver razão da detecção e cancelar/corrigir; telemetria de override pra ajustar prompt |
| Spam de convite mesmo com rate limit | baixa | médio | Auto-cooldown + denúncia + suspensão master |
| Conversa cresce muito (100k+ mensagens) | baixa V1, alta V3 | médio (perf) | Paginação por cursor + GIN tsvector aguenta milhões; reavaliar particionamento se passar 10M |
| LGPD: paciente reclama de mensagem que vazou nome dele | baixa | crítico | Filtro híbrido em 2 camadas + audit completo + delete manual via suporte master |
| WebSocket cai e usuário não vê mensagem | média | baixo | Badge é polled também ao abrir página; reconnect já existente |

## 20. Out of scope V1 — recap

- Encaminhamento formal de paciente (F2)
- DICOM como anexo
- Push notification mobile (PWA + Web Push)
- App nativo
- Grupos / chat com 3+ tenants
- Multi-user (não-admin) chat
- Threads / replies
- Edição de mensagem
- Voice / video
- Política de retenção configurável (mensagens ficam pra sempre, delete manual)
- Tradução automática
- Integração com email externo

## 21. Próximos passos

1. Spec aprovado → invocar `writing-plans` para gerar plano detalhado de implementação
2. Plano dividido em fases (sugestão):
   - **Fase 1**: schema + RLS + helper backend
   - **Fase 2**: API endpoints (settings, directory, invitations, blocks, conversations, messages, reads)
   - **Fase 3**: WebSocket events + frontend Chat shell + lista + thread + envio de texto
   - **Fase 4**: Anexo análise IA (cards anonimizados)
   - **Fase 5**: Pipeline PII + anexo PDF + anexo imagem
   - **Fase 6**: Reações + busca full-text + badge unread
   - **Fase 7**: Anti-abuso (rate limit, auto-cooldown, denúncia) + email notifications
   - **Fase 8**: Smoke test E2E + audit log + ajuste de UX

3. Cada fase entra em branch separada conforme regra "uma concern por branch" (`CLAUDE.md`).

---

## Changelog

### 2026-04-25 — V2 PDF redaction (substituiu V1.5 da Fase 5A)

**Contexto:** A primeira implementação do anexo PDF (Fase 5A V1) hard-blocava com 400 quando detectava PII via regex+Haiku, exigindo que o usuário removesse os dados na origem antes de tentar de novo. Em 2026-04-25 entregamos V1.5 que **rasterizava** cada página do PDF (via `pdf-to-png-converter`), rodava Tesseract por página, classificava PII e regenerava o PDF redigido. Funcionalmente correto, mas **inviável**: ~3min pra um PDF de 9 páginas e payload de saída >10MB (413 errors).

**Decisão:** V1.5 foi descartada e substituída por V2 (text-layer redaction).

**Implementação V2:**

- Novo módulo `apps/api/src/imaging/pdf-text-redactor.js`:
  - `pdfjs-dist` extrai itens de texto com posições (`transform[4]`, `transform[5]`, `width`, `height`) — sem renderizar imagens
  - Mesmos `PII_PATTERNS` do redactor de imagens (regex pra cpf/cnpj/rg/phone/email/cep/date) + Haiku conservador pra nomes próprios (prompt explícito com exclusões de termos médicos: ACL, T1, T2, FLAIR, AVC, RM, TC, ECG etc.)
  - `pd-lib` desenha `drawRectangle` preto sobre cada item identificado, com PAD=1.5 — preserva o text layer original e o tamanho do PDF
  - Heurística `totalChars < numPages * MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER (30)` detecta PDFs escaneados → retorna `{has_text_layer: false, page_count, reasoning}` em vez de redigir

- Novo endpoint `POST /inter-tenant-chat/images/redact-pdf-text-layer` (`image-redact.js`) — substitui o endpoint `/redact-pdf` da V1.5. Returna:
  - PDFs digitais: `{has_text_layer: true, redact_id, original_url, redacted_url, redacted_data_base64, summary, total_regions, page_count}`
  - PDFs escaneados: `{has_text_layer: false, page_count, reasoning}`

- Frontend (`thread.component.ts onPdfPicked`):
  - Chama `/redact-pdf-text-layer` antes de qualquer dialog
  - `has_text_layer && total_regions > 0` → abre `RedactPdfPreviewDialogComponent` (chips de summary "3 nomes · 1 CPF" + iframe com PDF redigido + link pro original + checkbox de confirmação)
  - `has_text_layer && total_regions === 0` → envia direto sem fricção (não há PII a revisar)
  - `!has_text_layer` → abre `PdfScannedConfirmDialogComponent` (aviso LGPD + checkbox de responsabilidade do usuário)

- Backend (`messages.js POST /conversations/:id/messages`):
  - Aceita novo campo `pdf.user_confirmed_scanned: true` (strict equality)
  - Quando presente, pula `extractPdfText` + `checkPii` (audit row em `tenant_message_pii_checks` marca `detected_kinds: ['user_confirmed_scanned']`)
  - Sem a flag, mantém o hard-block 400 do fluxo legado

- Imagens (`redact-image-dialog.component.ts submit()`): canvas exporta JPEG q=0.85 em vez de PNG q=0.92. Reduz upload típico de ~3MB pra ~300KB sem perda visível pra exames anonimizados (texto preto sobre fundo claro). Filename ganha sufixo `.jpg` automaticamente; `mime_type` enviado é `image/jpeg`.

**Removidos:**
- `apps/api/src/imaging/pdf-redactor.js` (V1.5 com `redactPiiFromPdf`)
- Dependência `pdf-to-png-converter` em `apps/api/package.json`
- `apps/web/src/app/features/chat-inter-tenant/redact-pdf-dialog.component.ts` (modal paginado V1.5 que rodava editor canvas por página)

**Performance:**
- PDF digital típico (até 10 páginas): 1–3 segundos (vs ~3 minutos da V1.5)
- PDF redigido mantém o tamanho original (sem rasterização) — antes inflava 3–10x
- Imagens: ~300KB (q=0.85) vs ~3MB (PNG)

**Trade-offs aceitos:**
- O texto continua na camada de texto do PDF redigido, apenas oculto pelos retângulos pretos. Ferramentas avançadas conseguem extrair o texto coberto. Isso é **redação visual**, não criptografia. Documentado nos docs user-facing (`docs/user-help/chat-anexar-pdf.md`).
- PDFs escaneados não passam por OCR no backend — a anonimização é responsabilidade do usuário via checkbox LGPD. Decisão pesada pelo argumento custo/tempo: rodar Tesseract num PDF escaneado de 10 páginas é o mesmo problema da V1.5 que rejeitamos. Se passar a haver demanda, criar fila assíncrona dedicada.

**Commits:**
- Feature: `feat(chat-pdf): redação por text layer + JPEG q=0.85 nas imagens` (`20b532d7`)
- Merge: `merge: feat/pdf-text-redaction-with-preview → main` (`33620ab5`)
- Validado em prod 2026-04-25 com PDF digital real (testado pelo product owner). PDF escaneado ainda não testado em prod até o momento desta atualização.
