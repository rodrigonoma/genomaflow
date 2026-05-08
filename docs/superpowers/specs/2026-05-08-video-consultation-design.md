# Video Consultation — Design Spec
**Data:** 2026-05-08  
**Status:** Aprovado — implementação autorizada  
**Autor:** GenomaFlow Dev + Claude Sonnet 4.6

---

## 1. Visão Geral

Adiciona consulta por vídeo ao GenomaFlow com dois modos:

| Modalidade | Créditos | Inclui |
|---|---|---|
| **Simples** | 2 | Vídeo WebRTC via Amazon Chime SDK |
| **Completa** | 6 | Vídeo + Transcrição (Whisper) + Análise IA (Claude) + Prontuário pré-preenchido |

**Providers decididos:**
- Vídeo: Amazon Chime SDK Meetings (HIPAA eligible, mesma conta AWS)
- Transcrição: OpenAI Whisper API (`whisper-1`, PT-BR)
- IA clínica: Claude Opus 4.7

**Custo estimado por consulta de 30min:**
- Chime: ~R$0,58/consulta
- Whisper: ~R$1,03/consulta (só modalidade completa)
- Claude: ~R$0,30/consulta (só modalidade completa)
- Total modalidade simples: ~R$0,58 → margem 1,42 crédito
- Total modalidade completa: ~R$1,91 → margem 4,09 créditos

---

## 2. Arquitetura — Fluxo End-to-End

```
Agendamento (appointment_type = 'telemedicina')
       │
       ▼  Médico escolhe modalidade simples/completa
[API] POST /video/consultations
       ├─ Cria Chime Meeting + 2 Attendees
       ├─ Grava video_consultations row (status: waiting)
       ├─ Gera JWT join_token (24h, role: patient)
       ├─ Envia email ao paciente/tutor/cliente
       └─ Envia WhatsApp (Z-API)
              │
              ▼
       Médico: /clinic/video/:consultationId  (autenticado)
       Paciente: /video/join/:token           (público, sem login)
              │
       ┌───── Sala Chime SDK (WebRTC) ─────┐
       │  amazon-chime-sdk-js no Angular   │
       │  Cockpit lateral: histórico,      │
       │  exames, evolução, arquivos       │
       │  PiP ao navegar no painel         │
       └───────────────────────────────────┘
              │ Médico encerra
              ▼
       POST /video/consultations/:id/end
       ├─ Debita créditos (2 ou 6)
       └─ Se completa → enfileira job BullMQ

       [Worker] video-transcription queue
       ① Aguarda gravação S3 (poll com backoff)
       ② Baixa áudio → Whisper (PT-BR)
       ③ Transcript → Claude Opus 4.7
          extrai SOAP estruturado + alertas
       ④ Cria encounter (source='video_ai')
       ⑤ Notifica médico (WS + push mobile)
```

---

## 3. Schema do Banco (migration 081)

### Tabela `video_consultations`
```sql
CREATE TABLE video_consultations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  appointment_id      uuid NOT NULL REFERENCES appointments(id),
  meeting_id          text NOT NULL,
  doctor_attendee_id  text NOT NULL,
  patient_attendee_id text NOT NULL,
  join_token          text NOT NULL UNIQUE,
  modality            text NOT NULL CHECK (modality IN ('simple','complete')),
  status              text NOT NULL DEFAULT 'waiting'
                      CHECK (status IN ('waiting','active','ended','transcribing','done','failed')),
  started_at          timestamptz,
  ended_at            timestamptz,
  duration_seconds    int,
  recording_s3_key    text,
  transcript_text     text,
  ai_extraction       jsonb,
  encounter_id        uuid REFERENCES encounters(id),
  credits_debited     int,
  created_at          timestamptz DEFAULT NOW()
);
-- RLS: ENABLE + FORCE (dado clínico)
```

### Tabela `video_consultation_files`
Arquivos trocados durante a consulta (exames, fotos, RX, ECG):
```sql
CREATE TABLE video_consultation_files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL REFERENCES video_consultations(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL,
  uploaded_by      text NOT NULL CHECK (uploaded_by IN ('doctor','patient')),
  s3_key           text NOT NULL,
  filename         text NOT NULL,
  mime_type        text,
  created_at       timestamptz DEFAULT NOW()
);
```

### Alterações em tabelas existentes
```sql
-- encounters: marcar prontuários pré-preenchidos por IA
ALTER TABLE encounters ADD COLUMN source text DEFAULT 'manual'
  CHECK (source IN ('manual','video_ai'));
```

`appointments.appointment_type` já tem `'telemedicina'` na check constraint (migration 068 + 079).

---

## 4. Endpoints API (`apps/api/src/routes/video.js`)

```
POST /video/consultations              (authenticate)
  Body: { appointment_id, modality }
  → Chime Meeting + Attendees
  → video_consultations row
  → JWT join_token (24h)
  → email + WhatsApp ao paciente
  → { consultation_id, join_url, doctor_token, meeting_id }

GET  /video/consultations/:id/tokens   (authenticate)
  → { doctor_token, meeting_id, join_url, status }

GET  /video/join/:token                (público)
  → valida JWT → { patient_token, meeting_id, clinic_name, doctor_name }

POST /video/consultations/:id/start    (authenticate)
  → status: waiting → active, started_at = NOW()

POST /video/consultations/:id/end      (authenticate)
  → duration_seconds, ended_at
  → debita credit_ledger
  → se complete → Queue job

GET  /video/consultations/:id          (authenticate)
  → estado atual, transcript, ai_extraction, encounter_id

POST /video/consultations/:id/files/upload-url  (authenticate ou público com join_token)
  → S3 presigned PUT URL (5min TTL)

POST /video/consultations/:id/files/notify      (authenticate ou público com join_token)
  → salva video_consultation_files row
  → Redis publish 'video:file_shared:{tenant_id}'
```

---

## 5. Worker (`apps/worker/src/video/`)

### Queue `video-transcription`

**Job payload:** `{ consultation_id, tenant_id, modality }`

**Pipeline:**
1. Poll S3 para gravação (max 10 tentativas, backoff 30s)
2. Download áudio → buffer em memória (nunca /tmp — ECS isolado)
3. Whisper API: `openai.audio.transcriptions.create({ model: 'whisper-1', language: 'pt' })`
4. Claude Opus 4.7: extrai JSON estruturado com sanitização defensiva:
   ```json
   {
     "chief_complaint": "string",
     "anamnesis": "string",
     "physical_exam_notes": "string",
     "hypotheses": [{ "description": "string", "confidence": "high|medium|low" }],
     "exam_suggestions": ["string"],
     "prescription_hints": ["string"],
     "red_flags": ["string"],
     "follow_up_notes": "string",
     "summary_3lines": "string"
   }
   ```
5. `withTenant` → INSERT encounter (source='video_ai', encounter_type='telemedicina')
6. UPDATE video_consultations: transcript, ai_extraction, encounter_id, status='done'
7. Redis publish `video:transcription_done:{tenant_id}`
8. Push mobile best-effort

**Em falha:** status='failed', estornar créditos de transcrição+IA (manter 2 do vídeo base).

---

## 6. Frontend Angular

### Cockpit do Médico (`/clinic/video/:consultationId`)
- Layout: vídeo (esquerda, ~65%) + painel clínico (direita, ~35%)
- Painel 4 abas: 📋 Perfil, 📊 Exames, 📈 Evolução, 📁 Arquivos
- Picture-in-Picture (browser PiP API) ao navegar no painel
- Controles: mute, câmera, encerrar
- Poll status a cada 10s após encerrar (modalidade completa)

### Sala do Paciente (`/video/join/:token`) — PÚBLICA
- Layout simplificado: vídeo + controles básicos
- Botão "Enviar exame ou foto" → S3 presigned upload direto
- Sem acesso a dados clínicos

### Agenda — `appointment-form`
- Toggle presencial/online ao selecionar `appointment_type = 'telemedicina'`
- Modal de confirmação: escolher modalidade simples (2 créditos) ou completa (6 créditos)
- Feedback: "Link enviado por email e WhatsApp para o paciente"

### Patient-detail
- Timeline: card "Consulta por vídeo" com duração + link ao encounter
- Encounter pré-preenchido: badge "Rascunho IA" + disclaimer `⚕ Sugestões da IA. Médico decide.`
- Red flags do Claude em card laranja no topo

---

## 7. Gravação de Áudio

**Abordagem:** Client-side recording no browser do médico via `MediaRecorder API`:
- Captura do mixed audio stream do Chime SDK (`audioMixController`)
- Chunks enviados ao S3 durante a chamada via presigned URL multipart-like
- Consolidação após `end` → arquivo único `.webm` no S3
- Worker acessa `recording_s3_key` para processamento Whisper

---

## 8. Email + WhatsApp

**Email:** template `videoConsultationLink` em `apps/api/src/mailer/templates.js`
- Contém link público, nome do médico, data/hora, instruções de acesso

**WhatsApp (Z-API):** mensagem via `sendText()` existente em `whatsapp-client.js`
- Número: `subjects.phone` ou `owners.phone` (veterinário)

---

## 9. IAM (ECS Task Role)

Adicionar permissions:
```json
{
  "Effect": "Allow",
  "Action": [
    "chime:CreateMeeting",
    "chime:DeleteMeeting",
    "chime:CreateAttendee",
    "chime:DeleteAttendee",
    "chime:CreateMediaCapturePipeline",
    "chime:DeleteMediaCapturePipeline"
  ],
  "Resource": "*"
}
```
S3: prefixo `video-consultations/*` já coberto por `uploads/*`.

---

## 10. Créditos

| Evento | Kind | Amount |
|---|---|---|
| Consulta simples (vídeo) | `video_simple` | -2 |
| Consulta completa (vídeo+IA) | `video_complete` | -6 |
| Estorno por falha no processamento | `video_transcription_refund` | +4 |

---

## 11. Compatibilidade Multi-módulo

- `human`: paciente → `subjects.phone` + `subjects.email`
- `veterinary`: tutor → `owners.phone` + `owners.email`
- `estetica`: cliente → `subjects.phone` + `subjects.email`
- Todos os módulos: `telemedicina` já válido em `appointment_type`

---

## 12. Paridade Mobile

- Sala de vídeo usa WebRTC nativo do browser embutido no Capacitor (sem plugin extra)
- Permissões câmera/microfone já declaradas em AndroidManifest.xml
- Após implementação: `ng build --configuration=mobile && npx cap sync android`
- iOS via CI ao criar tag `v1.1.0`
