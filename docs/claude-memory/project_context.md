---
name: GenomaFlow Project Context
description: Frontend + backend em produção — stack, arquitetura, estado atual (atualizado 2026-04-27 — pós audit log Option B)
type: project
---

GenomaFlow é uma plataforma SaaS multi-tenant de inteligência clínica (Brasil). Exames laboratoriais (PDF) e imagens médicas (DICOM, JPG, PNG) são enviados, processados de forma assíncrona por agentes de IA (Claude + RAG) e os resultados exibidos em dashboard em tempo real.

**Stack:** Fastify 4 (API) + BullMQ/Redis (queue) + PostgreSQL 15 + pgvector + Node 20 Alpine + Angular 18 standalone + Docker + WSL + AWS ECS Fargate.

**Razão social da contratada:** RODRIGO TAVARES NOMA TECNOLOGIA DA INFORMACAO LTDA · CNPJ 64.052.716/0001-15 · São Paulo/SP.

---

## Backend: COMPLETO (main branch)

- **45 migrations aplicadas** (042 terms_acceptance, 043 patient_consent, 044 professional_info, 045 prescription_templates)
- RLS com FORCE ROW LEVEL SECURITY em todas as tabelas tenant-scoped
- Fastify plugins: postgres, redis, JWT auth (com **jti** para sessão única), WebSocket pubsub
- Redis pub/sub do worker escuta `subject:upserted:*` e `billing:updated:*` para re-indexação RAG
- `publishSubjectUpserted` em patients.js dispara re-indexação ao criar/editar paciente

**Rotas principais:**
- `/auth/login` (gera jti, grava Redis `session:{user_id}`) + `/auth/register` + `/auth/me` + `/auth/professional-info`
- `/patients`, `/patients/:id/treatments`, `/patients/owners`, `/patients/search`
- `/exams` (multipart + WS `/subscribe`)
- `/alerts`, `/users`, `/billing/*`, `/chat/*`, `/feedback`, `/error-log`
- `/prescriptions`, `/prescriptions/subjects/:id`, `/prescriptions/exams/:id`, `/prescriptions/:id/pdf`
- `/prescription-templates` (CRUD, por tenant com RLS)
- `/terms/documents`, `/terms/status`, `/terms/accept`
- `/dashboard/insights` (4 agregados: alertas recentes 30d, revisão pendente, top marcadores, risco da carteira)
- `/clinic/profile`, `/integrations/*`, `/master/*`

**BullMQ worker:** PDF parse → OCR fallback (claude-haiku) → PII scrub → RAG → Claude agents → persist → Redis notify.

**Agentes IA:**
- Fase 1 human: metabolic, cardiovascular, hematology
- Fase 1 veterinary: small_animals, equine, bovine
- Fase 2 human: therapeutic, nutrition, clinical_correlation
- Fase 2 veterinary: therapeutic, nutrition
- Imagem: imaging_rx, imaging_ecg, imaging_ultrasound, imaging_mri

**Pipeline de imagem:** DICOM → PNG (jimp) → Vision classifier → agente específico → resultado com bounding boxes.

**Single-session por usuário:** login gera jti (UUID v4), armazena em Redis `session:{user_id}` com TTL de 90d. `fastify.authenticate` compara jti do token com jti ativo no Redis — se divergir, retorna 401 `session_replaced`. Frontend `jwt.interceptor` trata 401 deste tipo com snackbar antes de deslogar.

---

## Frontend Angular: COMPLETO (main branch)

**Módulos human e veterinary** — label/ícone dinâmico (pacientes/animais, person/pets).

**Rotas principais:**
- `/login`, `/master`, `/results/:examId`
- `/doctor/*` (patients, review-queue), `/clinic/*` (dashboard, users, billing)
- `/onboarding/terms` (aceite dos 5 documentos legais)
- `/onboarding/professional-info` (CRM/CRMV + UF + declaração de veracidade)
- `/onboarding/specialty` (médico humano — escolha de especialidade)

**Cadeia de guards nas rotas protegidas:**
```
authGuard → termsGuard → professionalInfoGuard → rota
```
- `termsGuard`: bloqueia até aceitar os 5 documentos legais (contrato_saas, dpa, politica_incidentes, politica_seguranca, politica_uso_aceitavel)
- `professionalInfoGuard`: bloqueia até preencher CRM/CRMV + UF + checkbox de veracidade. Master role bypass em ambos

**Componentes principais:**
- `app.component`: sidebar, topbar com **QuickSearchComponent** (busca rápida por nome, atalho `/`, placeholder módulo-aware)
- `exam-upload`: PDF/DICOM/JPG/PNG com auto-update via WS + polling 8s
- `result-panel`: back button, identity chip linkável, bounding boxes (imaging_mri), **botão "Exportar análise" gera PDF via jsPDF**
- `exam-card`: exibe error_message real da API; chip **EX-xxxxxx** (short ID) + chip de tipo clínico (HEMATOLOGIA, RX, RESSONÂNCIA…); retry via `/reprocess`
- `patient-list` (veterinary): form de dono com máscaras CPF/telefone/CEP + ViaCEP lookup; autocomplete de dono ao cadastrar animal
- `patient-detail`:
  - Aba Perfil: dono editável via autocomplete, checkbox consentimento LGPD
  - Aba Exames: upload, polling, card com tipo clínico
  - Aba Análises IA: chips + cards por agente, prescrições via modal
  - Aba Evolução (2 modos): "Comparar exames" (existente) + **"Por marcador"** (novo — até 3 marcadores numéricos com line chart)
  - Aba Tratamentos: 2 seções — Prescrições da IA (chip PR-xxxxxx) + Planos Manuais
- `prescription-modal`: items editáveis + **templates** (aplicar/salvar/excluir por tenant)
- `dashboard` (clinic): KPIs + bar chart 14d + donut de status + **donut de risco da carteira** + **top 5 marcadores alterados** + **alertas críticos com link** + **exames aguardando revisão**

**WsService:** detecta eventos por `msg['event'] ?? msg['type']`; billing events separados de exam events; heartbeat 30s.

---

## Papel único: `admin`

- Não existem mais perfis doctor/lab_tech — migration 037 converteu todos para admin
- Role `master` preservado para superusuário rodrigonoma (bypass em termsGuard e professionalInfoGuard)

---

## Compliance LGPD

- **5 documentos legais versionados** (v1.2 atual) com aceite registrado em `terms_acceptance` (user_id, version, content_hash SHA-256, IP, user-agent, timestamp)
- **Consentimento do paciente:** checkbox no cadastro + template PDF gerado client-side via jsPDF com dados da clínica pré-preenchidos
- **Declaração de veracidade profissional:** obrigatória no onboarding, gravada com IP + UA em `users`
- **SLAs contratuais:** primeiro contato em incidente (operação parada) 24h corridas / resolução de bug crítico 48h úteis / melhorias sem SLA / treinamento não incluído

---

## Copilot de ajuda de produto (entregue 2026-04-24)

Ajuda contextual in-app via AI (Haiku 4.5) com RAG sobre `docs/superpowers/plans`, `docs/superpowers/specs`, `docs/claude-memory`, e `CLAUDE.md`.

- **Schema:** `rag_documents.namespace` (`clinical_guideline` vs `product_help`) + tabela `help_questions` (analytics).
- **Backend:** `POST /api/product-help/ask` com SSE streaming. Rate-limit 30/h/user. Sem dado clínico no contexto (só rota + componente + role + módulo). System prompt bloqueia perguntas clínicas e redireciona pro chatbot médico existente.
- **Frontend:** botão `help_outline` no topbar (ao lado do `smart_toy` clínico — UIs e namespaces completamente separados); `ProductHelpPanelComponent` é side panel com streaming visível + botões de ação clicáveis + exibição de fontes.
- **Master panel** ganhou aba "Ajuda" com top rotas (revela UX ruim) + últimas 100 perguntas.
- **Hesitation detector** (`HesitationDetectorService`) detecta padrão A→B→A→B em <15s e oferece snackbar "ABRIR COPILOT" proativamente.
- **Reindex automático via CI:** worker image tem `docs/` + `CLAUDE.md` baked in. Task ECS Fargate `genomaflow-prod-reindex-help` (família criada via CDK) roda `node src/rag/reindex-product-help.js`. Deploy.yml detecta mudança em `docs/` ou `CLAUDE.md` via `git diff HEAD~1 HEAD` e dispara o task; falha não derruba deploy (Copilot segue com docs anteriores).
- **Último estado em prod**: 162 chunks indexados (primeiro reindex 2026-04-24). Custo: ~$0.001 por reindex completo (embedding) + fração de centavo Fargate.

**Não confundir:** chatbot clínico (`smart_toy`) usa `chat_embeddings` + diretrizes médicas, cobra créditos. Copilot de ajuda usa `rag_documents` com namespace novo, gratuito.

## Email verification + password reset (entregue 2026-04-24)

Obrigatório verificar email antes de logar. Reset de senha via link single-use 1h.

- **Schema:** colunas em `users` (`email_verified_at`, tokens com hash SHA-256, expiration, last_sent_at). Migration 051 faz backfill retroativo (usuários existentes marcados como verificados).
- **Backend:** `/auth/email-verification/{send,verify,send-by-email}` + `/auth/password-reset/{request,confirm}`. Rate limits agressivos. Sempre 204 em endpoints públicos pra evitar enumeration.
- **Email delivery:** AWS SES v2 (us-east-1). Domínio `genomaflow.com.br` verificado (DKIM + SPF + DMARC via Route53). `SES_MOCK=1` em dev loga o email ao invés de mandar.
- **Env vars prod** (injetadas no task def via CI): `SES_FROM_EMAIL=noreply@genomaflow.com.br`, `FRONTEND_URL=https://genomaflow.com.br`.
- **SES sandbox status**: pedido de production access enviado 2026-04-24 (análise de ~24h). Enquanto no sandbox, só manda pra emails pré-verificados via `aws sesv2 create-email-identity`.

## Chat entre Clínicas (V1 + Phases 2–7 entregues 2026-04-23 a 2026-04-25)

Comunicação 1:1 admin↔admin entre tenants do mesmo módulo (human↔human, vet↔vet). Convite + aceite obrigatórios; diretório opt-in default OFF.

- **Schema (migrations 053–062, todas RLS ENABLE+FORCE):** `tenant_chat_settings`, `tenant_directory_listing`, `tenant_invitations`, `tenant_blocks`, `tenant_conversations`, `tenant_messages` (com `body_tsv` GIN tsvector pt), `tenant_message_attachments`, `tenant_message_pii_checks`, `tenant_message_reactions`, `tenant_conversation_reads`, `tenant_chat_reports`.
- **Rotas** (`/inter-tenant-chat/*`, todas admin-only — role≠admin → 403):
  - Convites: POST `/invitations` (rate 20/dia/tenant; cooldown 3 rejeições=429), POST `/invitations/:id/accept`, POST `/invitations/:id/reject`
  - Blocos: POST `/blocks`, DELETE `/blocks/:tenant_id` (bilateral, mensagem genérica)
  - Diretório: GET `/directory?q=` (filtra por módulo, last_active_month preserva privacidade)
  - Conversas: GET `/conversations` (com `unread_count` por conversa), GET `/conversations/:id`, POST `/conversations/:id/messages` (rate 200/dia/tenant), GET `/conversations/:id/search?q=` (ts_headline pt com `<mark>`)
  - Reações: POST `/messages/:id/reactions` (whitelist `['👍','❤️','🤔','✅','🚨','📌']`, toggle)
  - Anexos PII: POST `/images/redact` (Tesseract+Haiku, retorna regions+signed URLs), POST `/images/redact-pdf-text-layer` (V2 — pdfjs-dist+pd-lib, retorna `has_text_layer:bool`)
  - Anexos download: GET `/attachments/:id/url` (signed URL TTL 1h)
  - Reads: POST `/conversations/:id/read` (atualiza `last_read_at`, emite `chat:unread_change`)
  - Denúncias: POST `/reports`, GET `/reports/mine`; master: GET `/master/reports`, POST `/reports/:id/resolve`. Suspensão automática: 3+ denúncias pending de reporters distintos em 30d → tenant suspenso (POST /messages e /invitations retornam 403)
- **WS events (via Redis pub/sub `chat:event:{tenant_id}`):** `chat:invitation_received`, `chat:invitation_accepted`, `chat:message_received`, `chat:reaction_changed`, `chat:unread_change`. Frontend `WsService` expõe Subjects correspondentes
- **Frontend:** rota `/chat` com guard auth+terms+professional. Sidebar agrega badge `chatUnreadTotal` somando `unread_count` de todas as conversas (`reduce`), refresca via REST a cada WS event. Componentes principais: `ChatListComponent`, `ThreadComponent`, `DirectoryModalComponent`, `RedactImageDialogComponent` (canvas editor), `RedactPdfPreviewDialogComponent` (V2 com chips de summary + iframe), `PdfScannedConfirmDialogComponent` (LGPD checkbox), `ReportDialogComponent`, `CounterpartContactDialogComponent`
- **Anexos PII pipeline V2 (2026-04-25):**
  - **PDF text-layer** (`pdf-text-redactor.js`): pdfjs-dist extrai texto+posições, regex+Haiku classifica PII, pd-lib desenha retângulos pretos. Mantém text layer e tamanho original (1–3s pra PDFs típicos)
  - **PDF escaneado**: detecção via heurística `totalChars < numPages*30` → modal LGPD com checkbox de responsabilidade do usuário; backend aceita `pdf.user_confirmed_scanned: true` pra pular hard-block (audit row marca `user_confirmed_scanned`)
  - **Imagens** (canvas editor): exporta JPEG q=0.85 (não PNG) → reduz upload típico 3MB→300KB
  - V1.5 (rasterização via pdf-to-png-converter + Tesseract por página) **removida** — era 100x mais lenta e gerava payloads >10MB
- **Documentação user-facing:** `docs/user-help/chat-*.md` — overview, anexar PDF, anexar imagem, anexar análise IA, reações/busca/denúncias, convites/diretório. Indexada no Copilot de Ajuda

## Agenda — agendamento de exames/consultas (entregue 2026-04-26)

Médico/veterinário gerencia sua própria agenda. V1 single-doctor (cada user vê só sua agenda). Spec: `docs/superpowers/specs/2026-04-26-scheduling-design.md`.

- **Schema (migration 053):** extensão `btree_gist` + função IMMUTABLE `appointment_range(start, minutes)` + `tenants.timezone` (default `America/Sao_Paulo`) + tabelas `schedule_settings` (1:1 com user, default_slot_minutes IN (30,45,60,75,90,105,120), business_hours JSONB) e `appointments` (status enum, EXCLUDE constraint impede overlap no DB com cancelled/no_show liberando slot). RLS ENABLE+FORCE em ambas.
- **Princípio core (D1 da spec):** `appointments.duration_minutes` capturado na criação, imutável. Mudar config só afeta novos; passado preserva original. Zero data migration ao trocar duração padrão.
- **Rotas (`/agenda/*`, todas authenticate):**
  - GET/PUT `/settings` (defaults se sem linha; PUT valida slot enum + business_hours shape)
  - GET `/appointments?from=&to=` (default semana atual, max 90 dias)
  - POST `/appointments` (409 OVERLAP via 23P01)
  - PATCH `/appointments/:id` (partial; auto-cancelled_at se status=cancelled)
  - POST `/appointments/:id/cancel` (idempotente)
  - DELETE `/appointments/:id` (só status=blocked; outros usam cancel)
  - GET `/appointments/free-slots?date=YYYY-MM-DD` (deriva business_hours - active_appointments em incrementos de default_slot_minutes)
- **Defesa em profundidade:** `withTenant` em escritas; `AND tenant_id` + `AND user_id` explícito em SELECTs/UPDATEs/DELETEs; subject_id validado contra mesmo tenant antes de inserir; WS pub/sub via Redis (`appointment:event:{tenant_id}`).
- **Frontend:** `/agenda` lazy route (guards auth+terms+professional). Componentes em `apps/web/src/app/features/agenda/`:
  - `agenda-page` (week grid 7 col × 15h, business hours overlay, cores por status)
  - `quick-create-dialog` (toggle consulta/bloqueio, autocomplete subject multi-módulo)
  - `edit-appointment-dialog` (status + duration + quick actions)
  - `settings-dialog` (slot dropdown + horários por dia)
  - Mobile: media query 768px troca grid pra 1 dia, prev/next vira navegação dia-a-dia
  - Drag-to-reschedule HTML5 native (desktop) com optimistic update + revert em 409
- **Testes:** 55 unit (validators + Fastify isolado validation) + 12 ACL/multi-módulo guards + 8 DB (RLS + EXCLUDE + check) = 75 testes scheduling. CI gate: 243+ verdes.
- **Multi-módulo:** schema agnóstico. Labels UI: "Consulta"/"Buscar paciente" (human) vs "Atendimento"/"Buscar animal" (vet). Mesmo backend.
- **Docs user-facing:** `docs/user-help/agenda-{overview,configuracao,bloqueios}.md` (RAG do Copilot).

## Copilot — ações na agenda (entregue 2026-04-26)

Estende o Copilot de Ajuda existente (`/product-help/ask`) com tool use do Anthropic SDK + Web Speech API browser native pra voz. Spec: `docs/superpowers/specs/2026-04-26-agenda-chat-actions-design.md`.

- **Migration 054**: ALTER help_questions ADD tool_calls JSONB + actions_taken JSONB (audit trail completo).
- **5 tools** em `apps/api/src/services/agenda-chat-tools.js`:
  - `find_subject` (resolução de paciente antes de criar)
  - `list_my_agenda` (preset today/tomorrow/this_week ou ISO range)
  - `get_appointment_details` (pra confirmação antes de cancel)
  - `create_appointment` (status scheduled ou blocked)
  - `cancel_appointment` (description menciona "SEMPRE confirme antes")
- **Defesa em profundidade**: tools SEMPRE usam tenant_id/user_id do JWT (context), nunca do input do LLM. Tests específicos garantem que args maliciosos como `{tenant_id: 'OUTRO'}` são ignorados.
- **Endpoint estendido**: `POST /product-help/ask` aceita `enable_agenda_tools: bool` + `conversation_history: Message[]`. Default `false` preserva comportamento atual byte-a-byte. Quando `true`, loop de tool use com hard cap MAX_TOOL_ITERATIONS=5.
- **System prompt** ganha bloco "AÇÕES NA AGENDA" só quando tools ativas. Inclui regra crítica "SEMPRE confirme antes de cancel" + data atual injetada pra resolver "amanhã".
- **SSE events**: além de delta/done/error, agora emite `tool_call_started`, `tool_call_completed` durante a execução.
- **Frontend** (Copilot panel): histórico de conversa preservado no state (`signal<Msg[]>`); cap 10 mensagens enviadas como `conversation_history`. Tool events visíveis em cada mensagem do assistant (spinner + label pt-BR + check verde / error vermelho). Quick suggestions chips no estado vazio. Botão refresh pra nova conversa.
- **Voz**: `voice-input.service.ts` wraps Web Speech API (SpeechRecognition / webkitSpeechRecognition), lang=pt-BR. Botão de mic ao lado do textarea, vermelho pulsante quando gravando. Áudio nunca sai do browser — só o texto final. Hide do botão se !supported (Firefox). Permissão negada → mensagem amigável.
- **Cobertura testes**: 31 unit + 9 integration mockando Anthropic SDK = 40 testes novos. Total CI gate: 283 verdes (era 243).
- **Docs user-facing**: `docs/user-help/copilot-agenda-acoes.md` (RAG do Copilot indexa).

## Audit log (Option B) — entregue 2026-04-27

Trail genérico de toda mutação em tabelas críticas pra compliance LGPD + investigação de incidentes (cancelamento, alteração não-autorizada, atribuição UI vs Copilot). Spec interna executada em 5 fases (branches separadas, cada qual mergeada em main com smoke test).

- **Migrations 055–057**:
  - 055: tabela `audit_log` (append-only) + função `audit_trigger_fn()` SECURITY DEFINER + RLS NULLIF (master vê tudo, tenant só o próprio) + GRANT só SELECT/INSERT
  - 056: trigger em `appointments`
  - 057: triggers em `subjects`, `prescriptions`, `exams`
- **Helper estendido** (`apps/api/src/db/tenant.js`): `withTenant(pg, tenantId, fn, opts)` agora aceita 4º arg `{ userId, channel }` que vira `SELECT set_config('app.user_id', ...)` + `set_config('app.actor_channel', ...)`. Channel whitelist: `ui`, `copilot`, `system`, `worker`. Backwards-compatible (sem opts → `actor_user_id` fica NULL e channel cai no default 'ui').
- **Rotas/services com canal correto**:
  - `apps/api/src/routes/agenda.js`, `patients.js`, `prescriptions.js`, `exams.js` → `{ channel: 'ui' }`
  - `apps/api/src/services/agenda-chat-tools.js`, `patient-chat-tools.js` → `{ channel: 'copilot' }` (diferenciar UI de IA é o ponto core do Option B)
- **Master panel `/master/audit-log`**: tab "Auditoria" com filtros (entity_type, actor_channel, action, tenant_id) + drill-down modal com diff side-by-side (`old_data` vs `new_data` via JsonPipe). Endpoints: `GET /master/audit-log` (paginado, clamps 30d/100 default, max 180/200) + `GET /master/audit-log/:id` (detalhe).
- **Trade-off explícito** (vs Option A — colunas pontuais `cancelled_by`/`updated_by`): +cobertura genérica de toda mutação +zero overhead de instrumentar cada handler -1 trigger por tabela (mais boilerplate em migration). Escolhido B porque captura também `delete` e `insert` (não só update), atribui canal (UI vs Copilot) e a tabela única simplifica master panel.
- **Cobertura testes**: `tests/routes/master-audit-log.test.js` (11 verdes — clamp, filtros parametrizados, JOIN tenants+users, 404, drill-down) + ACL guards em `tests/security/master-acl.test.js` (37 verdes). Adicionado ao `test:unit` (CI gate). Total atual: **355 verdes / 3 skipped / 17 suites**.
- **Red flag**: INSERT/UPDATE/DELETE em tabela com trigger fora de `withTenant({userId, channel})` → atribuição perdida (NULL/'ui' default). Toda nova rota de mutação em tabela auditada DEVE passar `userId` + `channel`.

## Master Broadcasts (Comunicados) — entregue 2026-04-27

Canal oficial "Administrador do GenomaFlow" → tenants pra promoções, features, bug fixes, e respostas a solicitações de melhoria. Demanda do usuário em 2026-04-27. Entregue em 6 fases (~migrations 058–061).

- **Reaproveita inter-tenant chat** com nova coluna `kind` em `tenant_conversations` (default `'tenant_to_tenant'` preserva existente). `kind='master_broadcast'` é o canal master.
- **Schema (migrations 058–061)**: tabelas `master_broadcasts` (canonical), `master_broadcast_attachments`, `master_broadcast_deliveries` master-only via RLS NULLIF; coluna kind + skip cross-module no trigger; policies tc/tcr/tm/tma extendidas pra master sem contexto cross-tenant.
- **Fan-out síncrono**: master → N tenants via `withTenant(MASTER_TENANT_ID, ..., { channel: 'system' })`. Master é sempre `tenant_a_id` (menor UUID). UPSERT conversation → INSERT message → INSERT attachments (s3_key compartilhado) → INSERT delivery → Redis publish `chat:event:{tenant}` com event `master_broadcast_received`. Sync até ~500 tenants.
- **Endpoints master**: POST /broadcasts (rate 20/dia, 80MB body p/ até 5 anexos × 10MB), GET /broadcasts (histórico com read_count), GET /broadcasts/:id (drill-down + read_by_tenant flag), GET /conversations (inbox de master_broadcast convs com unread_count), GET /conversations/:id/messages, POST /conversations/:id/reply (rate 100/dia).
- **Anexos**: imagem JPG/PNG ou PDF, max 10MB, max 5 por broadcast. Upload S3 prefix `master-broadcasts/{broadcast_id}/{uuid}.{ext}`. S3 obj compartilhado entre tenants (1 upload pra N entregas). IAM atualizado em `infra/lib/ecs-stack.ts` (PutObject/GetObject/DeleteObject em master-broadcasts/*).
- **Segmentação**: `all` / `module=human|veterinary` / `tenant=<uuid>`.
- **Frontend tenant**: conversa pinned no topo da sidebar com branding "Administrador GenomaFlow" (ícone admin_panel_settings + push_pin); thread renderiza markdown sanitizado (marked + DOMPurify whitelist conservadora) APENAS pra mensagens do master; sem botão "reportar"/"ver contato"; tenant pode responder via endpoint normal (suspension gate skipado pra master_broadcast — tenant suspenso precisa poder falar com admin).
- **Frontend master**: tab "Comunicados" no /master com composer (segment selector, markdown body, attachment picker), histórico com X/Y leram, inbox de respostas com unread badge, conversation viewer com reply box.
- **Garantias contra regressão**: zero impacto em inter-tenant chat tenant↔tenant (132 testes integração verdes); cross-module skip só pra kind=master_broadcast; suspension gate só skipa em master_broadcast.

## Test gate no CI (entregue 2026-04-25)

`.github/workflows/deploy.yml` ganhou job `test` que precede `deploy` (`needs: test`). Falha em qualquer teste bloqueia o build/push de imagens e o update de ECS.

- **API**: `npm run test:unit` (subset declarado em `apps/api/package.json` — sem DB). 176 testes verdes, 3 skipped (integração ESM em pdfjs-dist). Cobertura: PII patterns (PDF V2 + image V1), classifyByRegex/classifyByRegexInItems, drawRedaction (Sharp), ACL master-only (master.js + feedback.js + error-log.js — regression guard pro bug de 2026-04-23 com `role !== 'admin'`), anonymizeAiAnalysis com allowlist de chaves do output, messages.js validation (strict equality em `user_confirmed_scanned` / `user_confirmed_anonymized`), billing admin-gate + VALID_CREDIT_PACKAGES, prescriptions agent_type whitelist (só therapeutic + nutrition emitem receita) + items shape, constants.js whitelists.
- **Worker**: `npm test` completo. 30 verdes, 1 skipped (`processExam` — dynamic import ESM em dep transitiva). `jest.setup.js` seta env vars dummy (OPENAI_API_KEY, ANTHROPIC_API_KEY, DATABASE_URL, REDIS_URL) pra módulos com SDK instanciado em top-level carregarem em teste.
- **Web**: `npm test` (Jest + jsdom, `jest-preset-angular`). 10 verdes, 3 skipped em 2 suites (`LoginComponent` + `PatientListComponent` — refatoração pra `inject()` + ReactiveFormsModule). 4 specs verdes: jwt.interceptor, auth.service, ws.service, alert-badge.

**Padrão de mock Fastify isolado** (sem DB): build `Fastify({logger:false})`, `decorate('authenticate', stubFn)` que lê role de header, `decorate('pg', { query: jest.fn(...) })`. Stub joga erro se chamado em request rejeitada — sinal de regressão silenciosa do gate. Modelos vivos: `tests/security/master-acl.test.js`, `tests/routes/billing-validation.test.js`.

**Test debt registrado**: 4 suites com `describe.skip` + comentário TODO claro pra reabilitar quando alguém tocar no componente. Não silencioso, não esquecido.

**Áreas SEM cobertura unitária (precisam DB ou são UI complexa)**: auth/login, exams, patients, users, alerts, integrations, dashboard, prescription PDF generation, master credit grant, e a grande maioria das telas Angular além dos 4 services básicos.

## Infra em git (versionada 2026-04-24)

`infra/` passou a ser versionada (antes vivia só no WSL do mantenedor).

- **Stacks CDK**: `genomaflow-{vpc,rds,redis,ecr,dns,ecs}`.
- **Task defs ECS one-shot** (executadas via `aws ecs run-task` pelo CI):
  - `genomaflow-prod-migrate`: aplica migrations SQL em `apps/api/src/db/migrations/`
  - `genomaflow-prod-reindex-help`: reindexa docs/ do Copilot
- **Deploy CDK ainda é manual**: `cd infra && npx cdk deploy <stack>`. Workflow do GitHub Actions só gerencia container deploys (build + register-task-definition + update-service). Mudanças em stacks precisam de `cdk deploy` local + commit na mesma PR.
- **Padrão de one-shot task**: task def com `family: genomaflow-prod-<name>` + container image (api pra operações de DB, worker pra jobs com docs); CI detecta condição (`git diff HEAD~1 HEAD`) → `aws ecs run-task` com config de subnet/SG da VPC → `aws ecs wait tasks-stopped` → puxa exit code. Modelo do `genomaflow-prod-migrate`.

## ICP e Filosofia

**ICP:** Clínicas de médio porte no Brasil. Médico é dono do negócio e usuário direto.

**Why:** LGPD + multi-tenant from day one; AI é suporte à decisão, nunca diagnóstico.

**How to apply:** Qualquer nova feature usa `withTenant`; nunca bypass RLS; sempre disclaimer em PT-BR em clinical_results. Só existe role admin (e master para super). Rotas apontam para `/doctor/*` (pacientes, review-queue, results) e `/clinic/*` (dashboard, users, billing). Qualquer mudança em documentos legais requer bump de versão no catálogo de `routes/terms.js` + recompute de hash.
