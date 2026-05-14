# Red Flags — Comportamentos NÃO Esperados

Sintomas de armadilhas únicas que **não saltam aos olhos** ao ler a documentação geral. Quando bater algum desses, suspeitar primeiro destes itens antes de investigar mais fundo.

Movido do CLAUDE.md em 2026-05-09 para reduzir contexto carregado em toda sessão.

---

## RLS / Multi-tenant

- **`rag_documents` com RLS** → quebra chatbot pra TODOS os tenants. Tabela é propositalmente global (sem `tenant_id`)
- **Indexar `docs/superpowers/{plans,specs}/` no RAG do Copilot de Ajuda** → vazamento de detalhes internos pro usuário final. Indexador em `apps/worker/src/rag/indexer-product-help.js` lista APENAS `docs/claude-memory/`, `docs/user-help/`, `CLAUDE.md` — mudar essa lista exige revisão de segurança (incidente 2026-04-24)

## Storage / Filesystem

- **Worker lendo arquivo de `/tmp`** → `ENOENT` em prod. Containers ECS não compartilham filesystem — passar pelo S3
- **Rasterizar PDF digital pra OCR/redigir PII** → ~100x mais lento e perde text layer. Sempre `pdfjs+pdf-lib` primeiro; rasterização só pra escaneados (e hoje resolvido com modal LGPD)
- **Canvas exportando como `image/png` em upload anonimizado** → 5–10x mais bytes sem ganho visível. Default JPEG q=0.85

## Auth / Email

- **Email salvo com case misto + login com comparação exata** → usuário existe no banco mas falha silenciosamente no login. Sempre `.toLowerCase().trim()` no INSERT/UPDATE e `LOWER(email)` no SELECT

## Deploy / ECS

- **`force-new-deployment` sem registrar nova task definition** → ECS reinicia com imagem antiga, código novo nunca sobe
- **Remover `ARG CACHEBUST` dos Dockerfiles** → Docker reutiliza camada antiga silenciosamente, bundle não reflete o commit
- **Código correto no repo mas prod não reflete** → auditar bundle minificado ANTES de refazer deploy (`grep production:! chunk-*.js`); pode ser `fileReplacements` faltando, task def antiga, CACHEBUST sumido

## Frontend / Angular

- **HTTP em construtor + UI dependente de `BehaviorSubject(null)`** → flicker/sumiço no F5. Persistir shape mínimo em `localStorage`, hidratar no construtor antes do fetch
- **Sintoma de WS quebrado:** badge/notificação real-time com latência ~60s ou exigindo F5 → suspeitar de WS URL sem `/api/` ou `notifyTenant()` direto

## Mobile / Capacitor

- **`@capawesome-team/capacitor-biometrics` não existe no npm** — pacote fictício da spec original. O correto pra Capacitor 6 é `@capgo/capacitor-native-biometric@6.0.4` (API: `isAvailable()` + `verifyIdentity()`)
- **`npx cap add ios` exige macOS** — não funciona em WSL/Linux. iOS project inicializado pelo CI `macos-latest` via `cap add ios || true` antes do `cap sync ios`
- **Push mobile NUNCA pode derrubar flow principal** — toda chamada a `push.sendToUser` ou `push.sendToTenant` DEVE estar em try/catch; falha de FCM é best-effort
- **`device_tokens` NÃO tem RLS** (intencional) — é infra de entrega, não dado clínico. Sem `tenant_id` obrigatório nas queries dessa tabela
- **Interceptor HTTP Angular é síncrono** — não pode usar `await` em `getToken()`. Solução: dual-write do JWT em `@capacitor/preferences` (secure) + `localStorage` (sync read-cache). Nunca refatorar o interceptor para async sem análise profunda
- **`deploy-mobile.yml` nunca dispara em push** — só em tags `v*.*.*`. Nenhum push para `main` dispara build de app store
- **AndroidManifest.xml sem CAMERA + RECORD_AUDIO** → `getUserMedia({audio,video})` falha silenciosamente em WebView Capacitor. Adicionar essas permissões + `MODIFY_AUDIO_SETTINGS` quando feature usar WebRTC (incidente 2026-05-09 vídeo)

## Vídeo / Chime SDK

- **Chime SDK sem IAM** → `POST /video/consultations` retorna 502 silencioso em prod. Permissões `chime:CreateMeeting/DeleteMeeting/CreateAttendee/DeleteAttendee` DEVEM estar na task role ECS antes de testar em produção (análogo ao incidente S3 2026-04-25)
- **Chime `ExternalMeetingId` > 64 chars** → `ValidationException` silencioso. UUID (36) é seguro; `${tenant_id}-${appointment_id}` (73) explode
- **Chime SDK v3 `CreateAttendeeCommand`** → `ExternalUserId` é campo **raiz** do input, não aninhado em `Attendee: {}`. `Attendee.ExternalUserId` retorna null e Chime rejeita com ValidationException
- **`getUserMedia` sem `startAudioInput/startVideoInput` do Chime SDK** → vídeo local aparece, mas remoto fica preto (Chime não recebe o stream). Sempre usar `deviceController.list*Devices()` + `meetingSession.audioVideo.startVideoInput(deviceId)` antes do `start()` (incidente 2026-05-09)
- **Fastify `maxParamLength: 100` (default)** → rota `/video/join/:token` retorna "Route not found" porque JWT tem ~290 chars. Setar `Fastify({ maxParamLength: 500 })` no init (incidente 2026-05-09)
- **Two-step INSERT+UPDATE para join_token** → race condition: se UPDATE falha, DB fica com 'placeholder' mas URL tem token real → 404 silencioso. Pre-gerar UUID + sign token + INSERT atômico em uma operação (incidente 2026-05-09)
- **Pubsub.js sem `psubscribe` no canal novo** → mesmo se a rota faz `redis.publish`, nenhum cliente WS recebe. Adicionar pattern (ex: `'video:event:*'`) no array do `subscriber.psubscribe(...)` E o branch correspondente no `pmessage` handler. Frontend (`WsService`) também precisa de Subject + listener pelo `kind` (incidente 2026-05-09 — anexo do paciente não chegava ao médico)
- **Endpoint só de upload sem download equivalente** → arquivo enviado fica inacessível pelo outro lado. Sempre criar par `upload-url` + `download-url` (presigned PUT + presigned GET com `ResponseContentDisposition: inline`) com mesma matriz de auth (médico autenticado OU paciente via `join_token`)
- **WS não é entregue pra paciente público** → paciente da consulta de vídeo entra sem auth (rota pública), não tem JWT, não está conectado ao WS. Mesmo se publish em `video:event:{tenantId}` funciona, paciente não recebe. Para notificar o paciente em tempo real: use polling autenticado por `join_token` (interval 5s) ou criar canal SSE/WS dedicado por consultation. Padrão atual: paciente faz polling em `GET /files?join_token=...`
- **Worker tentando require de módulo do API** → `apps/worker/src/video/transcription.js` tinha `require('../notifications/push')` mas worker não tinha o arquivo (existia só em `apps/api/src/services/push.js`). Resultado: worker crashava no boot do job de transcrição → encounter de vídeo IA nunca era gerado. Fix: copiar push.js para `apps/worker/src/notifications/push.js` + adicionar `firebase-admin` ao `apps/worker/package.json`. Lição: cada serviço (api/worker) tem seu próprio módulo node — não dá pra cross-require entre eles
- **Chime SDK `audioVideo.stop()` sozinho não libera mic/cam** → bolinha vermelha do Chrome continua mesmo após encerrar a sala. Sempre chamar `stopAudioInput()` + `stopVideoInput()` ANTES do `stop()` para liberar as devices. Aplicar tanto em endCall (botão encerrar) quanto em ngOnDestroy (navegação)
- **`enumerateDevices()` antes de permissão de mic** → retorna devices com `deviceId` vazio. `startAudioInput('')` aceita o input mas Chime não captura áudio (silencioso, sem erro). Sintoma: vídeo OK, áudio nem chega ao outro lado. Fix: chamar `getUserMedia({audio:true, video:true}); stream.getTracks().forEach(t=>t.stop())` ANTES do `deviceController.listAudioInputDevices()` — força navegador a pedir permissão e libera enumeração de IDs reais
- **`getUserMedia({audio:true})` paralelo após `startAudioInput` do Chime** → conflita com a captura do Chime SDK e cortava áudio entre os participantes. Solução adotada: **1 único `getUserMedia({audio:true,video:true})`** no início do `joinMeeting`; o `MediaStream` resultante é passado **diretamente** pra `audioVideo.startAudioInput(stream)` e `audioVideo.startVideoInput(stream)` (Chime aceita MediaStream — não chama getUserMedia interno) E é reusado pelo MediaRecorder (`new MediaStream(stream.getAudioTracks())`). Múltiplos consumers do mesmo MediaStream não conflitam. Para gravar mix local+remoto (whisper transcrever ambos lados), usar Web Audio API com `createMediaStreamSource` no localStream + `createMediaStreamSource(remoteAudioEl.srcObject)` + `createMediaStreamDestination` — TODO. Hoje grava só fala do médico (suficiente para pré-preencher prontuário; médico documenta verbalmente)
- **Chime SDK sem `<audio>` element bound em navegadores com autoplay restrito** → pode não tocar áudio remoto mesmo com sessão estabelecida (depende de política de autoplay). Adicionar `<audio autoplay>` escondido + `meetingSession.audioVideo.bindAudioElement(audioEl)` antes do `start()` é defesa em profundidade
- **`getUserMedia` SEM constraints de áudio** → Chime SDK não aplica echoCancellation/noiseSuppression sozinho quando recebe MediaStream cru. Sintoma: microfonia (mic captura saída do alto-falante) mesmo o paciente em outro local. Fix: passar `audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }` (incidente 2026-05-09)
- **`getUserMedia` SEM constraints de vídeo** → webcam captura na resolução nativa (1080p/4K). Upload satura → packet loss → vídeo "digitalizado/pixelado" no outro lado, e tile remoto cai depois de N segundos. Fix: `video: { width: { ideal:1280, max:1280 }, height: { ideal:720, max:720 }, frameRate: { ideal:24, max:30 } }`. Telemedicina usa 720p/24fps consagrado (incidente 2026-05-09)
- **Observer `videoTileDidUpdate` chamando `bindVideoElement` em tile pausado** → ao reconectar (rede caiu e voltou), Chime emite update com `paused:true` antes de retomar. Bind nesse estado pode deixar o `<video>` em estado inválido até o próximo update. Fix: ignorar updates com `tileState.paused === true`
- **`<video>` com `object-fit: cover` em sala de telemedicina** → corta a imagem (ex: cabeça do paciente). Em UI clínica, **`object-fit: contain` é o correto** mesmo que gere letterbox preto — médico precisa ver paciente inteiro, não decorativo
- **`endCall` com `await uploadRecording()` antes de cleanup de mídia** → usuário clica encerrar e fica sem feedback até upload terminar (pode levar 3–10s). Fix: feedback imediato (snack "Encerrando…") + cleanup de mídia imediato + upload + endConsultation em background
- **Mesmo MediaStream passado pra `startAudioInput` E `startVideoInput`** → ao chamar `realtimeMuteLocalAudio()`, o stream inteiro é afetado e o vídeo local também cai (paciente para de ver médico). Fix: SEPARAR tracks em MediaStreams DISTINTOS: `new MediaStream(fullStream.getAudioTracks())` pro audio input e `new MediaStream(fullStream.getVideoTracks())` pro video input. As tracks são as mesmas (mesmo objeto), só os MediaStream containers são distintos — Chime trata cada um isoladamente (incidente 2026-05-09)
- **`<audio>` element sem `volume = 1.0` explícito** → áudio remoto pode tocar baixo. Browser pode iniciar o elemento com volume default não-1.0 dependendo da política de autoplay/contexto. Fix: após `bindAudioElement`, setar `audioEl.volume = 1.0` e `audioEl.muted = false`

## Angular Material / CDK Overlay

- **Componente com `:host { z-index: alto }` esconde dialogs Material** → o `cdk-overlay-container` do CDK tem z-index padrão **1000**. Se um componente standalone (ex: MasterComponent) usa `:host { position: fixed; inset: 0; z-index: 9999 }` pra ocupar toda viewport, **TODOS os dialogs abertos a partir desse componente ficam invisíveis** — são criados (referência válida em `dialog.open().afterClosed()`) mas renderizam ATRÁS do host. Sintoma: `dialog.open()` retorna ref normal, log "dialog ref criado: k {...}" aparece, mas nada visual. Fix: adicionar regra global `.cdk-overlay-container { z-index: 100000 !important; }` no `styles.scss` (cobre dialogs, menus, tooltips, snackbars). Não derruba o z-index do host pra preservar o bloqueio de interação. Incidente 2026-05-09 — 5 prompts de debug pra achar a causa
- **Standalone component sem `MatDialogModule` nos imports** → `inject(MatDialog)` funciona (DI providedIn: root), mas `dialog.open()` falha silenciosamente. SEMPRE adicionar `MatDialogModule` ao array `imports:` do `@Component({ standalone: true })` que abre dialog

## Schema legado / Tabelas renomeadas

- **Migration 012_patients_to_subjects renomeou `patients` → `subjects` + `exams.patient_id` → `exams.subject_id`** mas vários endpoints ainda têm SQL antigo (`FROM patients`, `JOIN patients`, etc) que retornam `relation "patients" does not exist` (Postgres 42P01). Pegou em produção 2026-05-09: `GET /master/tenants/:id/exams`. Quando criar/auditar query nova, **NUNCA escrever `patients`** — sempre `subjects`. FK column é `subject_id`, não `patient_id`. Mesma regra para owners/users/etc — sempre conferir com `git grep "patients\|patient_id" apps/api/src/routes/`

## Schema / SQL

- **`owners` não tem `subject_id`** → FK é `subjects.owner_id → owners.id`. JOIN errado: `ON o.subject_id = s.id`; correto: `ON o.id = s.owner_id`
- **`users` não tem `display_name` nem `name`** → coluna disponível: `email`. Para mostrar o médico numa query, usar `u.email AS doctor_name`
- **JOIN `users ON u.role = 'admin'` para pegar médico** → retorna todos os admins do tenant (múltiplas rows). Para pegar o médico de um agendamento: `JOIN users u ON u.id = a.user_id`
- **`video_consultation_files` sem RLS própria** (intencional) — isolamento garantido pela FK em `video_consultations` (que tem RLS). Não adicionar RLS dupla
- **CSS `<video>` em flex container sem `min-height: 0`** → quando recebe srcObject, cresce baseado no aspect ratio do stream e empurra elementos vizinhos para fora da viewport. Em sala de vídeo: `flex:1; min-height:0; width:100%; object-fit:cover` é a receita correta (incidente 2026-05-09)
- **S3 CORS sem origem `app.genomaflow.com.br`** → upload direto via presigned PUT do navegador falha com 403/CORS. Bucket `genomaflow-uploads-prod` deve permitir PUT/POST/GET/HEAD para `https://app.genomaflow.com.br`, `localhost:4200`, `capacitor://localhost`
