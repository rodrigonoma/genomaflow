---
name: GenomaFlow Project Context
description: Frontend + backend em produção — stack, arquitetura, estado atual (atualizado 2026-04-23)
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
