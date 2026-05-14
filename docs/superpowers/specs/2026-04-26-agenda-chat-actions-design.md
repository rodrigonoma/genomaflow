---
title: "Copilot — ações na agenda por texto/voz (V1)"
date: 2026-04-26
status: spec aprovada (opção A — estender Copilot existente)
owners: [backend, frontend, ux]
related: [docs/superpowers/specs/2026-04-26-scheduling-design.md]
---

## 1. Resumo executivo

Estende o Copilot de Ajuda existente (`/product-help`) com **tool use do Anthropic SDK** pra permitir que o usuário **execute ações na agenda** via chat — texto ou voz. Tools são wrappers finos sobre as rotas `/agenda/*` já existentes; nada de nova lógica de negócio.

Duas modalidades de input:
- **Texto** (já existe): "agenda Maria Silva amanhã 14h"
- **Voz** (V1 desta feature): botão de microfone usa Web Speech API nativa do browser (pt-BR, sem custo de API), transcreve no client antes de enviar como texto

Ações destrutivas (cancel, delete) sempre passam por **confirmação multi-turn** — o LLM pergunta antes de executar, garantindo defesa contra ambiguidade ou alucinação.

## 2. Personas e casos de uso

### Casos típicos
- **Caso A — Criar consulta por texto**: Médico digita "marca consulta da Maria Silva amanhã às 14h, 30 minutos". LLM identifica intent `create_appointment`, chama `find_subject` (encontra Maria Silva), chama `create_appointment` com args resolvidos. Result card aparece: "✓ Consulta criada — Maria Silva, 27/04 14:00, 30min".
- **Caso B — Cancelar com confirmação**: "cancela meu próximo atendimento". LLM chama `list_my_agenda(today)`, identifica próximo, **não chama** cancel_appointment ainda. Responde: "Vou cancelar o atendimento de Trovão (Souza) hoje 16h. Confirma?" + botões [Sim] [Não]. Usuário clica Sim ou diz "sim". LLM chama `cancel_appointment(id)`. Card: "✓ Cancelado — Trovão (Souza), 26/04 16:00".
- **Caso C — Disambiguation**: "agenda João pra terça 10h". `find_subject('João')` retorna 3 resultados. LLM responde: "Encontrei 3 pacientes chamados João. Qual: João Silva, João Santos ou João Pereira?" + botões clicáveis pra cada. Click no nome resolve.
- **Caso D — Listar agenda do dia por voz**: Usuário clica mic, fala "o que eu tenho hoje?". Browser transcreve. LLM chama `list_my_agenda(today)` e retorna cards resumidos: "Hoje: 4 atendimentos. 09:00 Maria Silva (consulta), 10:30 João Santos (retorno), 14:00 Bloqueado (almoço), 16:00 Trovão (Souza, atendimento vet)".
- **Caso E — Pergunta informativa permanece igual**: "como configuro horário de almoço?" → LLM responde com texto explicando os passos (sem chamar tool, comportamento atual).

### Não-objetivos do V1
- Edit de agendamento existente via chat (mover horário, mudar duração) — V2
- Bloquear horário via chat — V2 (criar com status=blocked é simples mas exige UX cuidadosa pra reason)
- Configurar settings da agenda via chat — V2
- Agendar pra outros médicos da clínica — V2 (depende de multi-doctor)
- Tools pra outras áreas: chat entre clínicas, prescrição — futuras features
- Streaming de resposta DURANTE tool execution — V1 mostra "pensando..." e revela resposta após tools concluírem
- Reconhecimento de voz no servidor (Whisper, Deepgram) — V1 usa Web Speech API browser-only
- Suporte a Firefox pra voz — Web Speech API tem suporte limitado; V1 esconde botão se não disponível

## 3. Decisões de design e rationale

| # | Decisão | Rationale |
|---|---|---|
| D1 | Estender Copilot de Ajuda existente (não criar 3º chatbot) | Mental model unificado; reusa SSE, side panel, audit, hesitation detector |
| D2 | Tools chamam funções diretas dos handlers (não HTTP self-loop) | Menor latência (~5ms vs ~50ms), mesmo código path, sem overhead de serialization JSON+rede |
| D3 | Confirmação destrutiva via instrução no system prompt + UI buttons | LLM "decide" pedir confirmação; backend não enforce "token de confirmação" (evita arquitetura complexa). Defesa real: tools sempre executam com user JWT — não há escalada de privilégio |
| D4 | `find_subject(name)` é tool separada de `create_appointment` | LLM chama find primeiro; se múltiplos matches, pergunta antes de criar. Evita criar com subject_id errado |
| D5 | Voz só client-side (Web Speech API) | Zero custo de API, latência mínima, áudio nunca sai do browser, privacidade-by-default |
| D6 | Esconder mic em browsers sem Web Speech (Firefox) | Não tentar polyfill; melhor UX consistente do que voz parcial |
| D7 | Tool execution NUNCA exposta a iteração externa do client | Client envia mensagem → backend faz loop completo até LLM parar de chamar tools → backend devolve resposta final via SSE |
| D8 | Hard cap de 5 iterações de tool loop | Defesa contra LLM em loop infinito; log warning se atingir |
| D9 | `help_questions` ganha `tool_calls JSONB` + `actions_taken JSONB` | Audit trail completo sem nova tabela; dados rastreáveis pra investigation futura |
| D10 | LLM recebe lista de tools via SDK (não no system prompt textual) | API-native, schema validado pelo SDK, sem risco de drift entre prompt e implementação |
| D11 | Tool descriptions em pt-BR | LLM responde em pt-BR melhor quando tool descs são pt-BR; consistência |
| D12 | Idempotency key opcional em create_appointment | Evita duplicação em retry de rede do client (não é V1 obrigatório, mas reservado no schema da tool) |

## 4. Multi-módulo

Tools são módulo-agnósticas — `subject_id` polimórfico. System prompt recebe `module` do user e instrui o LLM a usar terminologia correta:
- module=human: "consulta", "paciente"
- module=veterinary: "atendimento", "animal"

Validação multi-módulo nos tests (paridade): "marca consulta de Maria amanhã 14h" (human) vs "marca atendimento de Rex amanhã 14h" (vet) ambos funcionam idênticos backend, com labels diferentes nas mensagens do LLM.

## 5. Schema (mudança mínima)

### 5.1 Migration 054

```sql
-- Migration 054: audit de tool calls no Copilot
ALTER TABLE help_questions
  ADD COLUMN IF NOT EXISTS tool_calls JSONB,
  ADD COLUMN IF NOT EXISTS actions_taken JSONB;

-- Index pra analytics futura: "qual tool é mais chamada?"
CREATE INDEX IF NOT EXISTS help_questions_with_tools_idx
  ON help_questions(created_at DESC)
  WHERE tool_calls IS NOT NULL;
```

- Ambas colunas nullable, default NULL — backward compatible
- `tool_calls`: array de `{tool_name, input, started_at_ms}`
- `actions_taken`: array de `{tool_name, result, ok, latency_ms, error?}`
- Sem RLS nova (`help_questions` já tem isolation por user via `user_id` nas queries do master analytics)

## 6. Tools (V1)

Definidas em `apps/api/src/services/agenda-chat-tools.js`. Cada tool tem:
- JSON Schema validado pelo Anthropic SDK (input shape)
- Função executor `(input, context) → Promise<result>` onde `context = { tenant_id, user_id, module, fastify }`
- Erro lançado vira mensagem de erro pro LLM (que pode tentar recuperar)

### 6.1 `find_subject`
**Descrição:** "Busca pacientes/animais pelo nome. Retorna até 5 matches. Use isto antes de criar um agendamento pra resolver ambiguidade."

**Input:** `{ name: string (min 2 chars) }`

**Output:** `{ matches: [{ id, name, subject_type, species?, breed?, owner_name? }] }`

**Implementação:** chama `subjects` table com `WHERE name ILIKE '%name%' AND tenant_id = $1 AND deleted_at IS NULL LIMIT 5`. Tenant scoped via withTenant.

### 6.2 `list_my_agenda`
**Descrição:** "Lista os agendamentos do médico logado num período. Use 'today', 'tomorrow', 'this_week', ou datas explícitas."

**Input:** `{ from?: string (ISO date), to?: string (ISO date), preset?: 'today'|'tomorrow'|'this_week' }`

**Output:** `{ appointments: [{ id, start_at, duration_minutes, status, subject_name?, reason? }] }`

**Implementação:** chama o handler de `GET /agenda/appointments` diretamente.

### 6.3 `create_appointment`
**Descrição:** "Cria um novo agendamento. Use somente após resolver o subject_id via find_subject."

**Input:**
```json
{
  "start_at": "ISO datetime",
  "duration_minutes": "30|45|60|75|90|105|120",
  "subject_id": "UUID (obrigatório se status=scheduled/confirmed)",
  "status": "scheduled|blocked",
  "reason": "string (obrigatório se status=blocked)",
  "notes": "string opcional"
}
```

**Output:** `{ id, start_at, duration_minutes, status, subject_name? }` ou `{ error: 'overlap'|'subject_not_found'|... }`

**Implementação:** mesma validação e fluxo de `POST /agenda/appointments`. 409 OVERLAP é capturado e retornado como erro inteligível pro LLM.

### 6.4 `cancel_appointment`
**Descrição:** "Cancela um agendamento existente. SEMPRE confirme com o usuário antes de chamar esta tool — apresente os detalhes do agendamento e pergunte 'Confirma?' em uma mensagem de texto. Só chame esta tool depois que o usuário responder afirmativamente (ex: 'sim', 'confirmo', 'pode cancelar')."

**Input:** `{ appointment_id: UUID }`

**Output:** `{ id, status: 'cancelled', cancelled_at }` ou `{ error }`

**Implementação:** chama handler de `POST /agenda/appointments/:id/cancel` (idempotente).

### 6.5 `get_appointment_details`
**Descrição:** "Retorna detalhes completos de um agendamento por id. Use pra confirmar com o usuário antes de cancel/edit."

**Input:** `{ appointment_id: UUID }`

**Output:** `{ id, start_at, duration_minutes, status, subject_id, subject_name?, notes, reason? }`

### 6.6 Tools NÃO incluídas no V1 (reservadas pra V2)
- `update_appointment` (mover, mudar duração)
- `update_settings` (mudar default_slot_minutes, business_hours)
- `find_free_slots` (calcular slots livres pra propor opções)

## 7. Backend — fluxo da request

### 7.1 Endpoint estendido

`POST /product-help/ask` ganha campo opcional no body:
```json
{
  "question": "...",
  "context": { "route": "...", "component": "...", "module": "..." },
  "enable_agenda_tools": true,
  "conversation_history": [{ "role": "user|assistant", "content": "..." }]
}
```

- `enable_agenda_tools` default false → comportamento atual mantido
- `conversation_history` permite multi-turn (confirmação destrutiva, disambiguation). Limite: 10 mensagens (ou ~4000 tokens). Client gerencia.

### 7.2 System prompt — extensão condicional

Quando `enable_agenda_tools=true`, system prompt ganha bloco extra:

```
## AÇÕES NA AGENDA (DISPONÍVEIS VIA TOOLS)

Você TAMBÉM pode executar ações na agenda do usuário usando as tools fornecidas.

REGRAS DE AÇÃO:
1. Para criar agendamento: SEMPRE chame `find_subject` primeiro pra resolver o nome do paciente. Se múltiplos matches, PERGUNTE qual antes de criar.
2. Para cancelar/excluir: NUNCA execute direto. Primeiro use `get_appointment_details` ou `list_my_agenda` pra encontrar o item, apresente os detalhes ao usuário em mensagem de texto, e PEÇA CONFIRMAÇÃO ("Confirma cancelar X às Y? [Sim/Não]"). Só chame a tool de cancel quando o usuário responder afirmativamente.
3. Após executar com sucesso, confirme em uma frase curta: "✓ Consulta criada — Maria Silva, 28/04 14:00, 30min".
4. Se a tool retornar erro, explique em linguagem simples e ofereça alternativa quando possível.
5. Datas/horas em pt-BR: aceite "amanhã", "hoje", "próxima segunda", "14h", "duas da tarde", "meia-noite". Converta pra ISO ao chamar tools.
6. Duração default é 30 minutos quando o usuário não especifica. Se especificar valor fora da whitelist [30,45,60,75,90,105,120], use o mais próximo e mencione.
7. Você é o assistente desse médico/veterinário específico — todas as ações executam na agenda DELE. Não há como agendar pra outro profissional.
```

### 7.3 Tool loop

```
1. Anthropic.messages.create({ model, system, messages, tools, max_tokens, stream: true })
2. Acumula response (text deltas + tool_use blocks)
3. Se response tem tool_use:
   a. Execute cada tool em paralelo (Promise.all)
   b. Adiciona assistant message + tool_result messages ao conversation_history
   c. Cap de iterações: 5. Se atingir, log warning + termina com "Não consegui completar — tente reformular".
   d. Volta pro passo 1 com history atualizada
4. Se response não tem tool_use: termina, devolve resposta final pro client via SSE
```

### 7.4 SSE events emitidos

Mantém compat com client atual + adiciona novos:
- `event: delta` — texto incremental (já existe)
- `event: tool_call_started` — `{ tool_name, input }` — opcional, mostra "Buscando paciente..." na UI
- `event: tool_call_completed` — `{ tool_name, ok }` — opcional
- `event: action_card` — `{ kind: 'created'|'cancelled'|'list', payload }` — gera card visual no chat
- `event: confirmation_request` — `{ message, suggested_yes, suggested_no }` — mostra botões Sim/Não
- `event: done` — `{ sources, actions, tool_calls_summary }` (já existe, estendido)
- `event: error` — `{ error }` (já existe)

### 7.5 Audit

Cada request grava em `help_questions`:
- `tool_calls`: lista completa de `{tool_name, input, started_at_ms}`
- `actions_taken`: lista completa de `{tool_name, result, ok, latency_ms, error?}` — sem PII pesada (nomes ficam, mas não dados clínicos)

## 8. Frontend — extensões no Copilot

### 8.1 ProductHelpPanelComponent

Mudanças no panel existente:
- Mantém histórico da conversa (`signal<Message[]>`) em vez de só última pergunta/resposta
- Cada mensagem tem `role: user|assistant` + `content` + `cards?: ActionCard[]` + `confirmation?: ConfirmationPrompt`
- Renderiza cards de resultado de ação (verde/vermelho/amarelo)
- Botões de confirmação Sim/Não viram mensagens automáticas no histórico ao serem clicados
- `enable_agenda_tools=true` sempre ativado (system prompt cuida de quando usar)

### 8.2 Mic button (Web Speech API)

```ts
// Disponibilidade
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const supported = !!SpeechRecognition;

// Uso (no click do mic):
const rec = new SpeechRecognition();
rec.lang = 'pt-BR';
rec.continuous = false;
rec.interimResults = true; // mostra texto enquanto fala
rec.onresult = (e) => { this.input = e.results[0][0].transcript; };
rec.onend = () => { this.recording = false; };
rec.start();
```

- Botão `mic` ao lado do botão enviar
- Estado normal: ícone cinza
- Gravando: ícone vermelho pulsando + onda animada (CSS)
- Click novamente: `rec.stop()`
- Resultado vai pro input (editável antes de enviar)
- Hide do botão se `!supported`

### 8.3 Action cards na conversa

3 tipos:
- **Sucesso (verde)**: `{ icon: 'check_circle', title, subtitle, optional_link }`
- **Confirmação (amarelo)**: `{ icon: 'help_outline', message, yes_label, no_label }` — botões disparam mensagem auto
- **Erro (vermelho)**: `{ icon: 'error_outline', message, optional_retry_action }`

Estilo segue dark theme padrão do projeto. Cards são parte da mensagem `assistant` (não substituem texto, complementam).

## 9. Migration & rollback

### 9.1 Migration 054

Conteúdo: ver §5.1.

### 9.2 Rollback

**Pré-merge**: deletar branches.

**Pós-merge** (qualquer fase):
- Reverter merge commit no main → CI deploy reverte código
- Pra schema: `ALTER TABLE help_questions DROP COLUMN tool_calls; DROP COLUMN actions_taken;` em migration 055
- Cada fase mergeable sozinha permite rollback granular

## 10. Plano de fases

| Fase | Branch | Entregável | Mergeável sozinho |
|---|---|---|---|
| 1 | `feat/agenda-chat-tools-backend` | Migration 054 + tool definitions + executor + integração com /product-help/ask + tests unit | ✅ testável via curl, UI atual mantida |
| 2 | `feat/agenda-chat-ui-results` | ProductHelpPanel multi-turn + action cards + confirmation buttons + history | ✅ feature visível no chat (texto only) |
| 3 | `feat/agenda-chat-voice` | Mic button + Web Speech integration + estados visuais | ✅ polish da experiência |
| 4 | `feat/agenda-chat-tests-docs` | Cobertura ACL + multi-módulo + docs/user-help | ✅ documentação final |

## 11. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Anthropic SDK 0.88 sem suporte streaming + tools | Fallback pra non-streaming se necessário; verificar na implementação |
| LLM em loop infinito de tool calls | Hard cap 5 iterações + log warning + fallback message |
| Web Speech API inconsistente entre browsers | V1 só Chrome/Edge/Safari (95%+ market share); Firefox vê apenas input texto |
| Confirmação "esquecida" pra cancel | System prompt explícito + tests garantem que cancel sem confirmação prévia gera mensagem ao usuário, não execução |
| Custo de tokens (~2x por tool roundtrip) | Rate limit 30/h/user já existe; aumentar pra 60/h se virar bloqueador |
| Privilege escalation via tool args injetadas | Tool execution SEMPRE usa request.user do JWT — args do LLM não controlam tenant_id nem user_id |
| LLM chama tool de cancel com appointment_id de outro user | Tool executor valida que appointment pertence ao user logado antes de cancelar (já é o comportamento da rota) |
| Voz transcreve erro grave ("agenda Tom Cruise" em vez de "Maria Cruz") | Texto vai pro input editável antes de enviar — usuário revisa |
| Datas ambíguas ("próxima quinta") | LLM resolve no contexto do prompt (data atual injetada) |

## 12. Cobertura de testes (CI gate)

V1 obrigatório:

- **`tests/services/agenda-chat-tools.test.js`** — cada tool (find_subject, list_my_agenda, create_appointment, cancel_appointment, get_appointment_details) com mock de fastify.pg + validação de input/output shape
- **`tests/security/agenda-chat-tools-acl.test.js`** — tools sempre usam tenant_id/user_id do contexto, ignoram args maliciosos tentando override
- **`tests/routes/product-help-tools.test.js`** — endpoint `/ask` com `enable_agenda_tools=true` integra tools corretamente; cap de iterações respeitado; comportamento atual sem tools preservado
- **`tests/routes/product-help-multi-module.test.js`** — paridade human/vet (mesma rota, system prompt ajusta)

Adicionar paths em `apps/api/package.json` `test:unit`. Falha bloqueia deploy.

## 13. Próximos passos

1. ✅ Spec aprovada (este documento)
2. **Plano detalhado da Fase 1** em `docs/superpowers/plans/2026-04-26-agenda-chat-phase1-backend.md`
3. Implementação Fase 1 → validação local → aprovação → merge → deploy
4. Sequência das próximas fases após cada deploy validado
