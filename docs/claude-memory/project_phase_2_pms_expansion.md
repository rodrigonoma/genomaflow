---
name: Phase 2 PMS Expansion — Vacinas + Documentos clínicos + NPS (entregue 2026-05-05)
description: Vacinas (vet) com protocolos default + carteira por animal; documentos clínicos (atestado/pedido_exame/encaminhamento/relatório/termo) com templates por tenant; NPS pós-encontro via SES
type: project
---

Segundo passo do plano de transformar o GenomaFlow em PMS clínico completo (Caminho A). Spec: `docs/superpowers/specs/2026-05-05-clinical-pms-expansion-design.md`. Plano: `docs/superpowers/plans/2026-05-05-phase-1-prontuario-agenda.md` (Phase 2 segue mesma estrutura).

## Decisões tomadas (autorizadas pelo usuário 2026-05-05)

1. **Vacinas humano:** OUT — fica deferida pra Fase 4+ se ICP humano específico pedir
2. **5 tipos de documento:** atestado, pedido_exame, encaminhamento, relatorio, **termo_consentimento** (extra — relevante pra anestesia, eutanásia, procedimentos)
3. **Templates por tenant:** mesmo modelo de prescription_templates. Body com placeholders `{{patient_name}}`, `{{date}}`, `{{doctor_name}}`, `{{crm}}` (interpolação client-side)
4. **PDF gen:** client-side via jsPDF (já temos pra prescriptions); endpoint `/clinical-documents/:id/upload-pdf` registra s3_key se cliente quiser persistir
5. **vaccine_protocols com tenant_id NULL:** = protocolo global default. Tenant pode customizar criando próprio. Seeds incluem V8/V10, Antirrábica cães; Tríplice/Antirrábica gatos
6. **NPS simples:** score 0-10 + feedback texto. Token público 32 hex (crypto.randomBytes). TTL 30 dias. Idempotente (UPDATE WHERE responded_at IS NULL)
7. **Envio NPS:** Fase 2 = email via SES (já configurado, `SES_MOCK=1` em dev); WhatsApp deferido pra Fase 3 (rejeita com 400 explícito)
8. **NPS dashboard agregado por profissional/período:** Fase 4+ — Fase 2 só lista respostas + NPS score consolidado simples

## Migrations 069-071

- **069** `vaccines.sql` — `vaccine_protocols` (tenant_id NULL = global) + `vaccines` (FK encounter, protocol). RLS NULLIF padrão; protocols policy permite tenant_id IS NULL globally. Audit trigger em vacines (LGPD). 4 protocolos seed (V8/Antirrábica cães; Tríplice/Antirrábica gatos)
- **070** `clinical_documents.sql` — `clinical_document_templates` (por tenant) + `clinical_documents`. CHECK constraint nos 5 doc_types. signed_at imutabilidade (mesmo padrão de encounters). Audit trigger em documents
- **071** `nps_surveys.sql` — token UNIQUE, expires_at, responded_at NULL inicial, score 0-10 + feedback. RLS NULLIF (público GET/POST sem context). Audit trigger

## Backend — endpoints novos

### Vacinas (`/vaccines/*`)

| Path | Método | Notas |
|---|---|---|
| `/vaccines/protocols?species=` | GET | Lista globais (tenant_id NULL) + tenant. Filtra por species opcional |
| `/vaccines/protocols` | POST | Cria protocolo do tenant. Admin only |
| `/vaccines/protocols/:id` | PUT | Edita. Admin only. 404 se for global (não editável) |
| `/vaccines/protocols/:id` | DELETE | Remove. Admin only. 404 se global |
| `/vaccines?subject_id=` | GET | Carteira de vacinação do animal |
| `/vaccines` | POST | Registra vacina (vincula a encounter opcional + protocol opcional). Snapshot de current_weight nada — Vacinas não tocam em peso |
| `/vaccines/:id` | GET/PATCH/DELETE | CRUD padrão |
| `/vaccines/upcoming?days=30` | GET | Vacinas com next_dose_date entre hoje e hoje+N. Default 30, max 180 |
| `/vaccines/overdue` | GET | Vacinas vencidas (next_dose_date < CURRENT_DATE) com `days_overdue` calculado |

### Documentos (`/clinical-documents/*`)

| Path | Método | Notas |
|---|---|---|
| `/clinical-documents/templates?doc_type=` | GET | Templates ativos do tenant |
| `/clinical-documents/templates` | POST/PUT/DELETE | CRUD admin only. Soft delete via `active=false` ou hard delete |
| `/clinical-documents?subject_id=&doc_type=` | GET | Documentos do paciente (filtra tipo opcional) |
| `/clinical-documents` | POST | Emite documento. Aceita `template_id` opcional |
| `/clinical-documents/:id` | GET/PATCH | 24h pra autor editar; após signed_at = 409 |
| `/clinical-documents/:id/sign` | POST | Marca signed_at, vira imutável |
| `/clinical-documents/:id/upload-pdf` | POST | Body `{s3_key}`. Valida prefix `clinical-documents/` |

### NPS (`/nps/*`)

| Path | Método | Auth | Notas |
|---|---|---|---|
| `/nps/send` | POST | admin | Cria token + envia email via SES. Body `{subject_id, sent_to, encounter_id?, appointment_id?}`. WhatsApp = 400 (Fase 3) |
| `/nps/responses?period=` | GET | admin | Lista respostas + agregação (NPS score, promoters/passives/detractors). Wrapper `withTenant` pra JOIN com subjects |
| `/nps/:token` | GET | **público** | Retorna `{subject_name, already_responded, expires_at}`. 410 se expirado, 404 se não existe |
| `/nps/:token/respond` | POST | **público** | Body `{score 0-10, feedback?}`. 409 se já respondida ou expirada (mensagem genérica, não vaza qual) |

## Frontend — componentes novos

Em `apps/web/src/app/features/vaccines/`:
- `VaccinesService` — HTTP service (list, create, delete, listProtocols, upcoming, overdue)
- `VaccinesTabComponent` — aba do patient-detail: form de registro + carteira de vacinação. Highlights overdue em vermelho. Selector de protocolo populado por `species` do subject

Patient-detail integration:
- Nova aba **"Vacinas"** entre "Prontuário" e "Exames", **gated por `moduleHint() === 'veterinary'`** (não aparece pra clínica humana)

**Documentos clínicos UI** e **NPS panel** (admin) — backend completo, frontend mínimo deferido pra próxima sessão (escopo realista pra fase). Endpoints podem ser consumidos via Postman/curl agora.

## Tests (CI gate +26 = 450 verdes)

- `vaccines-validation.test.js` — 8 cases: subject_id obrigatório, vaccine_name, applied_at formato, next_dose_date formato, attachments max 10, ACL admin protocols, species whitelist
- `clinical-documents-validation.test.js` — 7 cases: subject_id, doc_type whitelist, title obrigatório, GET sem subject_id, upload-pdf prefix, ACL templates, doc_type template
- `nps-validation.test.js` — 11 cases: ACL send, sent_to email format, whatsapp deferido, token formato (32 hex), 404 token inexistente, score 0-10, score string, idempotência (409 mock), feedback >5000 chars

**Total acumulado:** 450 passed / 20 skipped / 25 suites (Phase 1 deixou em 424; +26 = 450)

## Smoke local validado

- ✅ `GET /vaccines/protocols?species=dog` retorna seeds globais (V8/V10 + Antirrábica)
- ✅ `POST /clinical-documents/templates` cria template "Atestado padrão"
- ✅ `POST /clinical-documents` cria atestado vinculado a subject_id
- ✅ `POST /nps/send` cria token + envia email (mocked SES)
- ✅ `GET /nps/:token` (público) retorna `{subject_name, already_responded, expires_at}`
- ✅ `POST /nps/:token/respond` aceita score+feedback uma vez
- ✅ Idempotência: segunda call de respond → 409 com mensagem genérica
- ✅ `GET /nps/responses` (admin com withTenant) retorna NPS score 100 + lista com `subject_name` populado

## Arquivos alterados

**Backend (8 arquivos):**
- `apps/api/src/db/migrations/069_vaccines.sql` (NEW)
- `apps/api/src/db/migrations/070_clinical_documents.sql` (NEW)
- `apps/api/src/db/migrations/071_nps_surveys.sql` (NEW)
- `apps/api/src/routes/vaccines.js` (NEW, ~330 linhas)
- `apps/api/src/routes/clinical-documents.js` (NEW, ~280 linhas)
- `apps/api/src/routes/nps.js` (NEW, ~220 linhas)
- `apps/api/src/server.js` — registra 3 rotas novas
- `apps/api/package.json` — adiciona 3 paths em test:unit
- `apps/api/tests/routes/vaccines-validation.test.js` (NEW)
- `apps/api/tests/routes/clinical-documents-validation.test.js` (NEW)
- `apps/api/tests/routes/nps-validation.test.js` (NEW)

**Frontend (3 arquivos):**
- `apps/web/src/app/features/vaccines/vaccines.service.ts` (NEW)
- `apps/web/src/app/features/vaccines/vaccines-tab.component.ts` (NEW)
- `apps/web/src/app/features/doctor/patients/patient-detail.component.ts` — import + nova aba "Vacinas" gated por module=vet

## Premissas P1/P2/P3 cumpridas

- **P1 (não quebrar):** schema 100% aditivo. Novos endpoints sem alterar contratos existentes. Tab "Vacinas" condicional (vet only). Tests existentes 424 → 450 (apenas crescimento)
- **P2 (humano/vet sem emaranhado):** vaccines tem código separado em `routes/vaccines.js` + `features/vaccines/` (vet-specific). Documents é shared (mesma rota humano+vet). NPS é shared. **Aba Vacinas só renderiza se `moduleHint() === 'veterinary'`** — humano nem vê
- **P3 (performance/custo):** indexes compostos com tenant_id primeiro. Audit trigger em vaccines+documents+nps. Sem chamada de IA. SES é o canal default (já tinha; sem custo adicional). Public NPS endpoint é leve (sem JOIN, valida token formato antes)

## Estado em prod (deploy 2026-05-05)

A preencher após pipeline rodar.

## Próximos passos (Fase 3+)

- **Fase 3:** WhatsApp via Z-API (lembretes de agendamento, confirmação, NPS via WhatsApp) + portal do tutor/paciente (read-only)
- **Fase 3 nice-to-have:** Frontend pra documentos clínicos (form com template selector + jsPDF render) e NPS dashboard (gráfico de score over time)
- **Fase 4 condicional:** PDV+estoque+financeiro via Bling/Conta Azul OU integração Focus NFE pra NF-e
