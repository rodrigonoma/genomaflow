# Comportamentos Esperados por Feature

Este arquivo consolida os "comportamentos esperados" detalhados de features pré-existentes. Antes era inline no CLAUDE.md, mas cresceu demais — movido aqui em 2026-05-09 para reduzir contexto carregado em toda sessão sem perder informação.

**Quando ler:** ao trabalhar em uma feature listada abaixo. Buscar pela seção correspondente.

---

## Auth & Login

- Login com usuário inativo retorna `403 { error: 'Conta desativada.' }` (distinto de tenant inativo)
- Login com tenant inativo retorna `403 { error: 'Tenant inativo.' }`
- Rate limit excedido retorna `429 { error: 'Muitas tentativas. Tente novamente em X.' }`
- Claim `module` no JWT nunca é `null` — fallback para `'human'` no sign

## Chat (paciente, geral)

- Cache hit no chat bypassa verificação de saldo no banco (intencional — reduz round-trips)
- Embedding model é configurável via `EMBEDDING_MODEL` env var (fallback: `text-embedding-3-small`)

## Chat entre tenants (Inter-tenant chat)

- Chat entre tenants é **admin-only** (V1): role diferente de `admin` cai em 403 em todo endpoint `/inter-tenant-chat/*`
- Convite cross-module retorna **400** (human só conversa com human, vet só com vet)
- Rate limit `POST /inter-tenant-chat/invitations`: 20/dia por tenant
- Rate limit `POST /inter-tenant-chat/conversations/:id/messages`: 200/dia por tenant
- Cooldown de convite: 3 rejeições consecutivas de um mesmo destinatário nos últimos 30 dias resultam em 429 até expirar
- Bloqueio bilateral (`tenant_blocks`): convite de qualquer direção retorna 429 quando existe bloqueio — mensagem genérica para não revelar quem bloqueou
- WS events emitidos pelo chat entre tenants: `chat:invitation_received` (pra destinatário ao POST /invitations), `chat:invitation_accepted` (pra sender ao POST /accept), `chat:message_received` (pra counterpart ao POST /messages), `chat:unread_change` (pra counterpart no POST /messages e pra self no POST /read). Best-effort (try/catch) — falha de notify não derruba a request
- Frontend: rota `/chat` com guard de auth/terms/professional, sidebar agrega `unread_total` de todas as conversas e atualiza em tempo real via WS

### Anexos (Phase 5A + V2 2026-04-25)

**PDF:** POST /messages aceita `pdf: {filename, data_base64, mime_type, user_confirmed_scanned?}` max 10MB. Front primeiro chama `POST /inter-tenant-chat/images/redact-pdf-text-layer` (pdfjs-dist + pd-lib desenha retângulos pretos sobre PII detectada via regex+Haiku — não rasteriza). Retorno tem dois ramos:
- `{has_text_layer:true, redacted_data_base64, summary, total_regions, ...}` (front mostra preview com chips de summary + iframe)
- `{has_text_layer:false, page_count, reasoning}` (front mostra modal LGPD com checkbox de responsabilidade do usuário)

No POST /messages, `pdf.user_confirmed_scanned===true` pula `extractPdfText/checkPii` (audit row marca `['user_confirmed_scanned']`); sem essa flag, PII detectada gera hard-block 400 como antes. PDF redigido sobe ao S3 em `inter-tenant-chat/{conv}/`. Signed URL via GET /attachments/:id/url (TTL 1h). V1.5 (rasterização via `pdf-to-png-converter` + Tesseract por página) **removida** — era 100x mais lenta e gerava payloads >10MB.

**Imagem:** POST /messages aceita `image: {filename, data_base64, mime_type, user_confirmed_anonymized: true}` — `user_confirmed_anonymized` deve ser literal `true` (strict equality). Frontend usa canvas editor com auto-detecção via Tesseract+Haiku + edição manual; saída é JPEG q=0.85 (não PNG) — reduz upload típico 3MB→300KB sem perda visível em exames anonimizados. Audit em `tenant_message_pii_checks` com marker `user_manual_confirm`.

### Reações (Phase 6)
Whitelist `['👍','❤️','🤔','✅','🚨','📌']`. POST /messages/:id/reactions toggle. Outros emojis retornam 400.

### Search full-text (Phase 6)
GET /conversations/:id/search?q= usa ts_headline português com `<mark>` nos highlights.

### Denúncias (Phase 7)
POST /reports (reason mín 10, max 2000 chars). UNIQUE constraint: 1 denúncia pending por par reporter/reported.

### Suspensão automática (Phase 7)
Tenant com 3+ denúncias pending de reporters distintos nos últimos 30 dias é suspenso — POST /messages e POST /invitations retornam 403 com mensagem de suspensão. Master pode dismiss/action via POST /reports/:id/resolve.

### Anexo análise IA
POST /messages aceita `ai_analysis_card: {exam_id, agent_types[]}` — snapshot anonimizado (sem name/cpf/phone/microchip/birth_date, com age_range em bucket de 10 anos) via helper `anonymizeAiAnalysis`.

---

## Aesthetic module F1 (entregue 2026-05-06)

3º module `'estetica'` adicionado a `tenants.module` (additive — não quebra human/vet). Migration 079 adicionou `users.professional_type` (`medico`/`esteticista`/`dentista`/`biomedico`/`outro`) com backfill 'medico' + default 'medico'. Esteticista bloqueado de mutar prescriptions via middleware `requireMedico` em POST/PUT/PDF/send-email (GETs livres — pode VER). Onboarding 3º card + sub-step de tipo profissional; esteticista pula step de especialidades. `subjects.fitzpatrick_type` (1-6) e `subjects.skin_concerns` (jsonb) renderizados em patient-detail só quando module='estetica' E subject_type='human'. Sidebar "Pacientes" → "Clientes" condicional via helpers `subjectLabelForModule/IconForModule`. Frontend hide botões "Nova prescrição" pra non-medico (gate UI consistente com gate backend). Onboarding pago: `professional_type` propaga via Stripe Session metadata → webhook handler usa no INSERT user. 3 camadas fail-closed (default 'medico'). Spec: `docs/superpowers/specs/2026-05-05-aesthetic-clinic-module-design.md`. Próximas fases F2-F5 não entregues ainda.

---

## Onboarding pago (Stripe checkout)

Onboarding pago é via `/onboarding/checkout` (Stripe single-shot), NÃO `/auth/register` — tenant + user só são criados pelo webhook após pagamento confirmado. Toda feature nova de onboarding precisa atualizar 3 lugares (checkout handler body+metadata, webhook handler INSERT, /register legacy compat) + 3 camadas fail-closed em campos sensíveis (body/metadata/DB default). Detalhes em `docs/claude-memory/feedback_onboarding_checkout_flow.md`.

---

## IA Pró-ativa (Phase 4.3, entregue 2026-05-05)

Card "Sugestões da IA" no topo da aba Perfil do patient-detail. `GET /patients/:id/ai-suggestions` retorna cache+`expired`. `POST /patients/:id/ai-suggestions/refresh` (admin only, rate limit 10/min) regenera via Claude Opus 4.7 com contexto do histórico (comorbidities + exames + prescrições + encontros). Cache 24h por subject (UPSERT em `ai_suggestions`). `POST /patients/:id/ai-suggestions/dismiss` adiciona ao array `dismissed_ids` (sugestão fica oculta sem refazer LLM call). Disclaimer obrigatório: "⚕ Sugestões da IA. Médico decide."

## Co-piloto durante consulta (Phase 4.4, entregue 2026-05-05)

`POST /encounters/copilot` (rate limit 30/min) recebe rascunho do prontuário (`chief_complaint, anamnesis, physical_exam, hypothesis, vital_signs`) + carrega contexto demográfico do subject + Claude Opus 4.7 retorna `{hypotheses[], recommended_exams[], red_flags[], needs_more_info[]}`. NÃO persiste — só análise on-demand. Rejeita input curto (< 30 chars total) com 400 `INPUT_TOO_SHORT`. Frontend: sidebar 320px lateral no encounter-form com toggle "Ativar co-piloto IA".

## OCR foto de laudo impresso (Phase 4.1, entregue 2026-05-05)

Worker pré-classifica imagens (`apps/worker/src/parsers/image.js` `classifyImageContent` → `medical_image | document | unknown`). Se `document`, faz OCR Vision (`ocrLabReport` via Claude Sonnet 4.6) e roteia pra `processTextExam` (compartilhado com PDF). Fallback pra imaging se OCR retornar < 50 chars. `credit_ledger` marca `ocr_usage` com kind `OCR: foto de laudo impresso (Vision)`.

## Follow-up automatizado (Phase 4.2, entregue 2026-05-05)

Worker scheduler gera 3 tipos novos com idempotência via UNIQUE INDEX partial — `post_consultation_followup` (encounter `signed_at` + 7d), `exam_alert_followup` (exam `done` com alerta `high`/`critical` + 30d), `vaccine_dose_reminder` (vaccine `next_dose_date` − 168h e − 24h). Migration 076. Opt-in granular em `notification_preferences` (default TRUE).

---

## Copilot ações na agenda (entregue 2026-04-26)

`POST /product-help/ask` aceita `enable_agenda_tools: boolean` + `conversation_history: Message[]`. Quando `true`, LLM ganha 5 tools (find_subject, list_my_agenda, get_appointment_details, create_appointment, cancel_appointment) que executam server-side com `tenant_id`/`user_id` do JWT (nunca do input do LLM — defesa contra prompt injection). Cancel exige confirmação prévia em mensagem de texto (instruída no system prompt). Hard cap 5 iterações de tool loop. SSE events: `tool_call_started`, `tool_call_completed` além dos existentes. Audit em `help_questions.tool_calls` + `actions_taken` (migration 054). Modo `enable_agenda_tools=false` (default) preserva streaming texto-puro original.

## Agenda (entregue 2026-04-26)

Rotas `/agenda/*` (todas authenticate). `default_slot_minutes` whitelist `[30,45,60,75,90,105,120]`. `appointments` com status enum `[scheduled,confirmed,completed,cancelled,no_show,blocked]` + EXCLUDE constraint impede overlap no DB (cancelled/no_show liberam slot). Princípio core: `duration_minutes` imutável após criação — mudar config só afeta novos. POST conflitante retorna 409 com `code:'OVERLAP'`. DELETE só pra status=blocked; outros usam POST `/cancel`. WS via `fastify.redis.publish('appointment:event:{tenant}')`. Schema na migration 053 com extensão `btree_gist` + função IMMUTABLE `appointment_range(start, minutes)` (wrapper pra `timestamptz + interval` que é STABLE).

---

## Consulta por vídeo (entregue 2026-05-08, v1.1.0; iterações 2026-05-09)

Dois modos: simples (2 créditos, só vídeo) e completa (6 créditos, vídeo + Whisper transcrição + Claude análise + encounter pré-preenchido). Chime SDK Meetings na API (`@aws-sdk/client-chime-sdk-meetings`) + `amazon-chime-sdk-js` no Angular. Migration 081: `video_consultations` (RLS habilitado), `video_consultation_files` (arquivos trocados na consulta), `clinical_encounters.source` ('manual'|'video_ai'). Worker queue `video-transcription` (BullMQ): poll S3 → Whisper → Claude Opus 4.7 → INSERT clinical_encounters (source='video_ai') → Redis pub/sub + push mobile.

**Rotas API:**
- `POST /video/consultations` (cria meeting + envia email+WhatsApp; INSERT atômico com UUID pre-gerado + token signado)
- `GET /video/join/:token` (PÚBLICA, paciente entra sem login; validação dividida em 2 passos: busca por vc.id, depois valida token na app layer)
- `POST /video/consultations/:id/end` (encerra + debita créditos + enfileira job)
- `POST /video/consultations/:id/files/upload-url` (presigned PUT — médico autenticado OU paciente via join_token)
- `POST /video/consultations/:id/files/notify` (registra arquivo + publica WS event `video:file_shared`)
- `GET /video/consultations/:id/files` (lista arquivos da sala)
- `GET /video/consultations/:id/files/:fileId/download-url` (presigned GET — TTL 1h, médico autenticado OU paciente via join_token)

**Angular:**
- `/clinic/video/:id` (cockpit médico: vídeo + painel 3 abas Perfil/Exames/Arquivos + PiP + recording)
- `/video/join/:token` (sala pública do paciente — controles incluem mute, video toggle, upload, sair)

**WebSocket events:**
- `video:file_shared` em `video:event:{tenantId}` — emitido após `POST /files/notify`. Payload: `{ consultation_id, file: { id, filename, mime_type, uploaded_by, created_at } }`. Pubsub.js está psubscribed em `video:event:*` (junto com chat:event:*, appointment:event:* etc). WsService.videoFileShared$ Subject. Doctor-room recebe, recarrega lista, marca arquivo como "novo" (badge verde), mostra snackbar com botão "Abrir".

**Cockpit do médico — UX dos arquivos:**
- Card de arquivo é clicável (abre signed URL em nova aba)
- Arquivos recebidos durante a consulta ganham badge verde "novo" + borda destacada até serem clicados
- Snackbar "📎 paciente enviou: filename" com botão Abrir aparece em real-time

Botão "📹 Iniciar vídeo" no edit-appointment-dialog ao appointment_type='telemedicina'. IAM Chime obrigatório em prod: `chime:CreateMeeting/DeleteMeeting/CreateAttendee/DeleteAttendee` na task role ECS. Créditos: `video_simple` -2, `video_complete` -6, `video_transcription_refund` +4 (estorno em falha).

**Pegadinhas críticas (incidentes 2026-05-09):**
- `Fastify({ maxParamLength: 500 })` é OBRIGATÓRIO no init — JWT tem ~290 chars e o default 100 rejeita a rota com "Route not found" antes do handler rodar
- Chime SDK NÃO captura mídia automaticamente — sempre chamar `deviceController.listAudioInputDevices/listVideoInputDevices` + `meetingSession.audioVideo.startAudioInput/startVideoInput(deviceId)` ANTES do `start()`. `getUserMedia` direto só serve pra preview local OU pra MediaRecorder, não roteia até o outro participante
- `<video>` em flex container PRECISA de `min-height: 0` + `width: 100%` — sem isso, quando recebe srcObject cresce pelo aspect ratio do stream e empurra elementos vizinhos pra fora da viewport
- AndroidManifest.xml deve ter `CAMERA` + `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS` — sem isso `getUserMedia` falha silenciosamente no WebView Capacitor
- S3 CORS deve incluir `app.genomaflow.com.br` com PUT/POST/GET/HEAD
- Email/WhatsApp do POST /consultations devem ser fire-and-forget (não awaited) — sendEmail/sendText sem timeout pendurariam a resposta indefinidamente
- INSERT do video_consultation deve ser atômico (UUID pre-gerado + sign token + INSERT único). Two-step INSERT+UPDATE tem race condition que deixa DB com 'placeholder' enquanto URL tem token real → 404
- Pubsub.js precisa `psubscribe('video:event:*')` — sem isso o publish nunca chega ao WsService

Spec: `docs/superpowers/specs/2026-05-08-video-consultation-design.md`.

---

## Aba Prontuário (patient-detail) — refatorada 2026-05-09

A aba **Prontuário** do `patient-detail.component.ts` mostra **somente lista de evoluções clínicas (clinical_encounters)** — encounters do paciente em ordem cronológica, com cards expandíveis.

**NÃO tem mais:** `<app-timeline>` (timeline unificada). Foi removida porque já existe a aba dedicada `🕐 Timeline` (PatientTimelineComponent). Duplicação eliminada.

**EncounterListComponent (`apps/web/src/app/features/encounters/encounter-list.component.ts`):**
- Toolbar com contador (`X evoluções`) + filtros chip por tipo (`Consulta`, `Retorno`, `Evolução`, `Procedimento`, `Telemedicina`, `Outro`, `🎥 Vídeo IA` quando há encounters com `source='video_ai'`)
- Cards compactos: header sempre visível com badge de tipo (roxo se IA), data/hora, status (`assinado` verde com cadeado / `rascunho` amarelo), chevron pra expandir, snippet de queixa principal (até 120 chars)
- Click no header faz toggle expand/collapse inline (signal `expandedId`)
- Detalhes expandidos: linha do médico (email), grid de vital signs (peso/temp/FC/FR/PA/dor/hidratação/mucosa quando disponíveis), seções estruturadas (queixa, anamnese, exame físico, hipótese, conduta, retorno, histórico médico, medicações, alergias em vermelho), chips de anexos
- Botão "Carregar mais" no rodapé quando `hasMore`

**Por que essa estrutura:**
- Card compacto = visão rápida de "o que aconteceu" sem abrir cada um
- Click expand = profissional decide qual encounter aprofundar
- Filtros = paciente com 50+ encounters consegue achar rapidamente o tipo certo
- Distinção visual entre encounter manual e gerado por IA (vídeo) — médico sabe a origem do registro
- Estado vazio bem desenhado com ícone + descrição

**Aba "Evolução" (separada)** continua mostrando comparação de exames + gráficos de marcadores ao longo do tempo. NÃO confundir com "evolução clínica" (que vai pro Prontuário). Nome da aba mantido por compatibilidade visual com fluxo do médico.

---

## Mobile app GenomaFlow (entregue 2026-05-07, mergeado; v1.1.0 inclui feature de vídeo)

Capacitor 6 empacota Angular 18 em shells nativas Android (Play Store) + iOS (App Store). Isolamento total do build web. `environment.mobile.ts` (`mobile: true`). Plugins: `@capacitor/push-notifications`, `@capacitor/camera`, `@capacitor/preferences`, `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capgo/capacitor-native-biometric@6.0.4` (biometria Face ID / Touch ID). Migration 080 criou tabela `device_tokens` (sem RLS — infra de entrega, não dado clínico). Endpoints novos: `POST /auth/device-token`, `DELETE /auth/device-token`, `POST /auth/refresh`. Push via Firebase Cloud Messaging (`firebase-admin` no worker + API). Push em 5 eventos: exam:done, alerta clínico crítico/high, mensagem chat inter-clínica, appointment reminder, master broadcast. Sempre best-effort (try/catch — push nunca derruba o flow principal). JWT armazenado no Keychain / EncryptedSharedPreferences via `@capacitor/preferences` + dual-write em localStorage (interceptor HTTP precisa de acesso síncrono). Back button Android via `@capacitor/app`. Safe area iOS via `body.capacitor-native { padding: env(safe-area-inset-*) }`. Câmera nativa: `NativeCameraService` → base64 → File → reusa path de upload existente. CI/CD: `deploy-mobile.yml` disparado por tags `v*.*.*`, jobs paralelos Android (ubuntu + Gradle + Fastlane supply → Play Store internal) + iOS (macos-latest + CocoaPods + Fastlane beta → TestFlight). Task 20 (manual): criar contas lojas + Firebase + gerar keystore + 9 GitHub Secrets + `git tag v1.0.0 && git push origin v1.0.0`. Spec: `docs/superpowers/specs/2026-05-07-mobile-app-design.md`.
