# Aesthetic Clinic Module — Design Spec

**Data:** 2026-05-05
**Status:** Aprovado em brainstorming (decisões cross-cutting + F1-F5)
**Estimativa:** ~11-12 sprints (5 fases entregues incrementalmente)
**Branch strategy:** uma branch por fase (`feat/aesthetic-fN-<topic>`)

## Contexto e motivação

GenomaFlow atende clínicas humanas e veterinárias com 2 modules. Decisão estratégica de **adicionar 3º module `'estetica'`** cobrindo:

- **Tipo A (dermatologia médica):** dermatologista com prescrição farmacológica, IA clínica em fotos de lesões, CID-10
- **Tipo B (estética avançada não-médica):** esteticista (técnico) com procedimentos como peeling, microagulhamento, drenagem, limpeza de pele, sem prescrição

Restrições não-negociáveis levantadas pelo usuário:
- **Manutenibilidade:** code novo isolado, sem poluir modules existentes
- **Zero break:** human/veterinary continuam funcionando idênticos
- **Entrega incremental:** cada fase deployável independente

## Decisões arquiteturais cross-cutting

### 1. Module enum extension (additive)

```sql
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_module_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_module_check
  CHECK (module IN ('human','veterinary','estetica'));
```

`apps/api/src/constants.js`:
```js
const VALID_MODULES = ['human','veterinary','estetica'];
```

**Por que additive funciona:** todo código atual usa `IN ('human','veterinary')` ou switch sobre os 2 valores. Adicionar 3º valor não quebra — só novos branches em features estéticas processam tenants module=estetica.

### 2. Professional types

```sql
ALTER TABLE users ADD COLUMN professional_type TEXT
  CHECK (professional_type IN ('medico','esteticista','dentista','biomedico','outro'));
-- Backfill: tenants existentes (human/vet) → 'medico'
UPDATE users SET professional_type = 'medico' WHERE professional_type IS NULL;
ALTER TABLE users ALTER COLUMN professional_type SET NOT NULL;
```

`apps/api/src/constants.js`:
```js
const VALID_PROFESSIONAL_TYPES = ['medico','esteticista','dentista','biomedico','outro'];
```

**Feature gating:**
- Endpoints que escrevem `prescriptions` exigem `professional_type IN ('medico','dentista')` → 403 caso contrário
- Procedures `requires_doctor=true` (ex: toxina botulínica) só executáveis por medico/dentista
- Frontend esconde botões/menus baseado em `currentUser.professional_type`

### 3. Terminologia por module

| Conceito | Human | Vet | Estética |
|---|---|---|---|
| Sujeito | Paciente | Animal | Cliente |
| Profissional | Médico | Veterinário | Médico ou Esteticista |
| Encontro | Consulta | Atendimento | Avaliação / Sessão |
| Tratamento | Prescrição | Receita vet | Protocolo / Procedimento |

Implementação: maps em `app.component.ts` por `tenant.module`. Sem framework i18n.

### 4. Princípios de manutenção (não-negociáveis)

1. **Code novo prefixado** — `apps/api/src/routes/aesthetic/*`, `apps/web/src/app/features/aesthetic/*`, `apps/worker/src/agents/aesthetic/*`. Nunca em routes de human.
2. **Reuse aggressive** — `subjects`, `clinical_encounters`, `prescriptions`, `documents`, `portal_tokens`, `nps_surveys`, `whatsapp_messages`, `appointments` ficam idênticas. Algumas ganham colunas opcionais NULL pra human/vet.
3. **Tabelas novas só pra estética** — 9 ao todo (procedures, packages, package_sales, procedure_sessions, aesthetic_protocols, aesthetic_photos, photo_comparisons, aesthetic_photo_consents, facial_analyses). Todas com `tenant_id` + RLS NULLIF + audit triggers críticos.
4. **Feature gating por professional_type** — backend retorna 403 onde estiver fora do escopo, frontend hide UI.
5. **Zero break em human/vet** — todo schema change é additive (novas colunas opcionais NULL, novos enum values, novas tabelas).

### 5. IA pipeline — extensão (não substituição)

`worker/src/parsers/image.js` `classifyImageContent` ganha 4ª categoria: `'aesthetic_photo'`. Branch novo em `processors/exam.js`:

- `aesthetic_photo` + `tenant.module='estetica'` → `processAestheticPhoto` (novo, F4)
- `aesthetic_photo` + outros modules → fallback `processImagingExam` (legado intacto)
- `medical_image` → imaging existente
- `document` → OCR + texto (F4.1 atual)

Sem código novo no worker pra F1-F3. Só F4 mexe no pipeline.

---

## F1 — Foundation (~2 sprints)

**Objetivo:** tenant escolhe `'estetica'` no onboarding, equipe usa agenda + prontuário + portal **reusando 100% do existente**. Zero feature nova de estética. Zero break.

### Schema

`079_estetica_module_foundation.sql`:
- Estende CHECK de `tenants.module` pra incluir `'estetica'`
- Adiciona `users.professional_type TEXT NOT NULL` com backfill = 'medico' pros existentes
- Adiciona `subjects.fitzpatrick_type INTEGER CHECK (1..6)` (NULL pra human/vet)
- Adiciona `subjects.skin_concerns JSONB` (NULL pra human/vet) — ex: `['melasma','rugas']`
- Estende CHECK de `appointments.appointment_type` pra incluir: `'avaliacao_estetica'`, `'procedimento_estetico'`, `'retorno_estetica'`
- Estende CHECK de `clinical_encounters.encounter_type` pra incluir: `'avaliacao_estetica'`, `'pos_procedimento'`

### Onboarding

Step "tipo de clínica" passa de 2 → 3 cards:
- 👤 Médica (humano)
- 🐾 Veterinária
- ✨ Estética

Se estética → sub-step "tipo de profissional":
- 🩺 Médico (dermatologista, harmonização orofacial) → exige CRM + UF
- 💆 Esteticista (técnico em estética) → registro CFT opcional

### Frontend changes (mínimas)

- Sidebar: "Pacientes" → "Clientes" se `module='estetica'`
- Patient-detail: 2 campos extras (`fitzpatrick_type`, `skin_concerns`) renderizados só se `module='estetica'`
- Encounter form: novos `encounter_type` valores no dropdown
- Agenda: novos `appointment_type` valores

### Permissions

Backend (`apps/api/src/middleware/professional-gate.js` novo):
```js
function requireMedico(handler) {
  return async (request, reply) => {
    const ptype = request.user.professional_type;
    if (ptype !== 'medico' && ptype !== 'dentista') {
      return reply.status(403).send({
        error: 'Apenas profissional médico/dentista pode prescrever.'
      });
    }
    return handler(request, reply);
  };
}
```

Aplicado em rotas que criam `prescriptions`. Frontend lê `currentProfile.professional_type` e esconde botões.

### Tests F1

- Onboarding cria tenant 'estetica' + user 'esteticista' → sucesso
- Esteticista de tenant estetica POST /prescriptions → 403
- Médico de tenant estetica POST /prescriptions → 201 (existing flow)
- Tenant human NÃO renderiza campos `fitzpatrick_type` no patient-detail
- Backfill migration deixa users existentes com `professional_type='medico'`

---

## F2 — Procedures + Packages (~2-3 sprints)

**Objetivo:** clínica cadastra catálogo, vende pacotes, trackea sessões. **A feature commercial-chave** — diferencia GenomaFlow de Belezinha/ClinikR pela integração nativa com prontuário e (futuramente) IA.

### Schema (5 tabelas novas)

`080_aesthetic_procedures_packages.sql`:

#### `aesthetic_procedures`
Catálogo de procedimentos do tenant.
- Campos críticos: `name`, `category` (enum: injetaveis/laser/peeling/radiofrequencia/microagulhamento/limpeza_pele/drenagem/outros), `price_default`, `duration_minutes`, `requires_doctor BOOLEAN`, `recovery_days`, `contraindications`, `active`
- Index: `(tenant_id, active, category)`

#### `aesthetic_packages`
Combos de procedimentos com desconto.
- Campos: `name`, `price`, `sessions_count`, `valid_for_days`, `procedures_included JSONB` (`[{procedure_id, qty}]`), `discount_pct`, `active`
- Index: `(tenant_id, active)`

#### `package_sales`
Venda registrada (cliente comprou).
- Campos: `subject_id`, `package_id`, `sold_at`, `expires_at` (sold_at + valid_for_days), `sold_price` (preço efetivo, pode customizar), `paid BOOLEAN`, `payment_method`, `payment_installments`, `sold_by_user_id`, `notes`, `status` (active/expired/consumed/cancelled)
- Index: `(tenant_id, subject_id, status)` + `(tenant_id, expires_at, status)` pra cron expiry

#### `procedure_sessions`
1 sessão executada de 1 procedimento.
- Campos: `subject_id`, `procedure_id`, `encounter_id` (FK opcional), `package_sale_id` (NULL se avulso), `appointment_id`, `executed_at`, `executed_by_user_id`, `satisfaction_score 1-5`, `status` (scheduled/executed/cancelled)
- Index: `(tenant_id, subject_id, executed_at DESC)` + `(package_sale_id) WHERE status='executed'`

#### `aesthetic_protocols` (já criada em F2 mas usada em F4)
Templates de tratamento sequenciados.
- Campos: `name`, `areas_of_interest JSONB`, `procedure_steps JSONB` (`[{procedure_id, week_offset, qty}]`), `target_concerns JSONB`, `estimated_sessions`, `estimated_price`

### Idempotência crítica — sessions_remaining

View calculada (não persistida — sempre fresh):
```sql
CREATE VIEW package_sales_with_remaining AS
SELECT ps.*, p.sessions_count,
       (p.sessions_count - COALESCE(COUNT(s.id), 0))::int AS sessions_remaining
FROM package_sales ps
JOIN aesthetic_packages p ON p.id = ps.package_id
LEFT JOIN procedure_sessions s
  ON s.package_sale_id = ps.id AND s.status = 'executed'
GROUP BY ps.id, p.sessions_count;
```

POST `/aesthetic/procedure-sessions` com `package_sale_id` valida `sessions_remaining > 0` antes de inserir → 409 caso contrário.

### Endpoints (CRUD + ações)

```
# Catálogo (admin only)
GET    /aesthetic/procedures
POST   /aesthetic/procedures
PUT    /aesthetic/procedures/:id
DELETE /aesthetic/procedures/:id

GET    /aesthetic/packages
POST   /aesthetic/packages
PUT    /aesthetic/packages/:id
DELETE /aesthetic/packages/:id

# Vendas (admin/medico/esteticista)
GET    /aesthetic/package-sales?status=active&subject_id=X
POST   /aesthetic/package-sales
PATCH  /aesthetic/package-sales/:id          # marcar paid, etc.
POST   /aesthetic/package-sales/:id/cancel

# Sessões
GET    /aesthetic/procedure-sessions?subject_id=X
POST   /aesthetic/procedure-sessions
POST   /aesthetic/procedure-sessions/:id/cancel
```

### UI

- **`/clinic/aesthetic/catalog`** — admin only, 2 tabs (Procedimentos / Pacotes), CRUD com Material dialogs
- **Patient-detail (módulo estetica)** — 2 tabs novas: "Pacotes" (visual com sessões restantes/expira), "Procedimentos" (histórico)
- **Encounter form (avaliação estética)** — fluxo "Recomendar pacote" → cria `package_sales`
- **Dashboard estético** (F5): KPIs financeiros + operacionais

### Cron job — expiração

`worker/src/notifications/scheduler.js` ganha `expirePackageSales`:
- Roda 1x por dia
- `UPDATE package_sales SET status='expired' WHERE status='active' AND expires_at < NOW() AND tenant_id IN (SELECT id FROM tenants WHERE module='estetica')`

### Tests F2

- Esteticista cria session de procedimento `requires_doctor=true` → 403
- POST session quando `sessions_remaining=0` → 409
- Cancelar session restaura sessions_remaining
- Pacote expirado via cron muda status
- View `package_sales_with_remaining` retorna número correto após cancel + re-execute
- Audit trigger registra INSERT/UPDATE/DELETE em `package_sales`

---

## F3 — Fotos antes/depois (~2 sprints)

**Objetivo:** profissional captura fotos do cliente em pontos do tratamento. Comparação visual + storage seguro com LGPD strict.

### Schema (3 tabelas novas)

`081_aesthetic_photos.sql`:

#### `aesthetic_photos`
- Campos: `subject_id`, `encounter_id` (opcional), `procedure_session_id` (opcional), `s3_key`, `photo_type` (before/during/after/followup/marketing), `area_of_interest` (face_full/face_left/face_right/perioral/periorbital/frontal/neck/colo/arms/legs/torso/custom), `shot_angle` (frontal/45_left/45_right/lateral_left/lateral_right/from_above), `captured_at`, `captured_by_user_id`, `lighting_notes`, `thumbnail_s3_key` (200×200), `width_px`, `height_px`, `anonymized BOOLEAN`, `metadata JSONB` (EXIF)
- S3 path: `aesthetic-photos/{tenant_id}/{subject_id}/{photo_id}.jpg`

#### `photo_comparisons`
- Pareamento before/after.
- Campos: `subject_id`, `photo_before_id`, `photo_after_id`, `alignment_data JSONB` (5 landmarks faciais), `notes`

#### `aesthetic_photo_consents`
LGPD strict — consent granular por finalidade.
- Campos: `subject_id`, `can_use_for_marketing BOOLEAN`, `can_use_for_education BOOLEAN`, `can_share_with_partner_clinics BOOLEAN`, `signed_at`, `signed_by` (nome cliente), `document_id` (FK pro `clinical_documents` gerado), `revoked_at`, `ip_address`

### Backend

- Upload via multipart (existing prescription `/pdf` pattern)
- Server-side: validação MIME (image/*), redimensiona se > 4MP, gera thumbnail
- IAM da task ECS: validar policy cobre `aesthetic-photos/*` prefix (lição aprendida em `feedback_iam_s3_prefixes.md`)
- Lifecycle S3: NUNCA delete — só soft-delete via `revoked_at` no consent (LGPD)

```
POST /aesthetic/photos/upload                # multipart, retorna {id, s3_key, signed_url}
GET  /aesthetic/photos?subject_id=X
GET  /aesthetic/photos/:id/url               # refresh signed URL TTL 1h
DELETE /aesthetic/photos/:id                 # soft via consent revoke
POST /aesthetic/comparisons
GET  /aesthetic/comparisons?subject_id=X
POST /aesthetic/photo-consents
PATCH /aesthetic/photo-consents/:id/revoke
```

### UI

- **Capture flow** (modal pós-procedure-session): picker de área + ângulo + upload múltiplo
- **Galeria** (patient-detail aba "Fotos"): grid agrupado por procedimento
- **Comparação visual:** modal com 2 layouts:
  - Side-by-side (50/50)
  - Slider (overlay com divisão arrastável)
- **Consent obrigatório** antes da 1ª foto: gera `clinical_documents` tipo `termo_consentimento_estetico_fotos`

### LGPD strict

- Upload sem consent ativo → 400
- Cliente revoga consent → fotos com flags marketing/educação/partner ficam invisíveis nos contextos correspondentes (NÃO deleta do storage; só hide)
- Audit log registra: upload, view, share, revoke

### Tests F3

- Upload sem consent ativo → 400
- Revogar consent oculta foto em chat entre clínicas (se can_share_with_partner_clinics era true)
- Esteticista pode upload + comparar (não exige médico)
- IAM S3 cobre `aesthetic-photos/*` (validar deploy)

---

## F4 — IA análise facial (~3 sprints) — O moat defensável

**Objetivo:** clínica sobe foto frontal/perfil. IA retorna análise estruturada (Fitzpatrick, achados, severidade) + recomenda protocolo. Para dermatologia médica adiciona detecção de lesões suspeitas com CID-10.

### Pipeline extension (zero break)

`worker/src/parsers/image.js`:
```js
async function classifyImageContent(imageBase64, mediaType) {
  // 4 categorias agora: 'medical_image' | 'document' | 'aesthetic_photo' | 'unknown'
}
```

`worker/src/processors/exam.js`:
```js
if (file_type === 'image') {
  const contentType = await classifyImageContent(...);
  if (contentType === 'aesthetic_photo' && tenant.module === 'estetica') {
    return processAestheticPhoto({ ... });   // F4 path
  }
  // ... paths existentes
}
```

Tenant não-estética + foto facial → fallback imaging legado. Sem comportamento novo em human/vet.

### Schema (1 tabela)

`082_aesthetic_facial_analysis.sql`:

#### `facial_analyses`
- `subject_id`, `photo_id`, `fitzpatrick_skin_type 1-6`
- `findings JSONB` — `[{type, area, severity, score}]`
  - Types: `wrinkle_static`, `wrinkle_dynamic`, `melasma`, `lentigo`, `acne`, `telangiectasia`, `flacidez`, `fotoenvelhecimento`, `cicatriz`
  - Severities: `mild`, `moderate`, `severe`
- `suspicious_lesions JSONB` (só se professional_type='medico') — `[{location, diagnosis_hint, cid10, confidence, recommend_biopsy}]`
- `recommended_protocols JSONB` — `[{protocol_id, score, rationale}]`
- `recommended_procedures JSONB` — `[{procedure_id, sessions_estimated, priority}]`
- `model_version`, `input_tokens`, `output_tokens`, `processing_ms`, `disclaimer TEXT NOT NULL`

### Agentes novos (`worker/src/agents/aesthetic/`)

1. **`agent_fitzpatrick.js`** — Claude Sonnet 4.6 Vision. Output: `{ fitzpatrick_type, confidence, rationale }`. ~R$ 0,15/call
2. **`agent_facial_findings.js`** — Claude Opus 4.7 Vision. Saneamento defensivo (mesmo pattern de `ai-suggestions`/`encounter-copilot`). ~R$ 0,80/call
3. **`agent_protocol_recommender.js`** — Claude Opus 4.7. Input: findings + histórico procedures + catálogo do tenant. Output: top 3 protocolos + sessões estimadas + rationale com diretrizes. ~R$ 0,50/call
4. **`agent_dermatologic_lesion.js`** — Claude Opus 4.7 Vision. Só ativado se `professional_type='medico'`. Detecta nevos atípicos (ABCDE), queratoses, basocelular suspeita. **Disclaimer obrigatório forte:** "IA NÃO diagnostica câncer de pele. Lesões suspeitas exigem avaliação dermatoscópica + biópsia." ~R$ 1,00/call

Pipeline: roda agentes em paralelo, persiste em `facial_analyses`, debita 4 entries em `credit_ledger` (kind: `agent_usage`), publica `aesthetic_analysis:done` Redis pub/sub, frontend recebe via WS.

### Endpoints

```
POST /aesthetic/photos/:id/analyze        # dispara worker job
GET  /aesthetic/facial-analyses/:id
GET  /aesthetic/facial-analyses?subject_id=X
```

### UI

Patient-detail aba "Análises faciais":
- Lista cronológica (thumbnail + sumário Fitzpatrick + 3 top findings)
- Click → modal completo:
  - Foto à esquerda
  - Painel direito: tipo de pele, achados com severity badges (verde/âmbar/vermelho)
  - "Recomendado pra você" — protocolos com botão "Vender pacote"
  - Lesões suspeitas (se médico) com CID-10 + alerta de biópsia
  - **Disclaimer obrigatório**

Cache: análise é fixa pra `(photo_id)`. Reanálise exige `force_refresh=true`.

### Tests F4

- Esteticista NÃO recebe `suspicious_lesions` (gate por professional_type)
- Tenant sem créditos → 402 claro
- Disclaimer presente em toda saída de IA
- Saneamento defensivo: filter findings malformados, clamp severity 0-10
- Saneamento: priority válida (high/medium/low) com fallback default

---

## F5 — Portal + Dashboards + Campanhas (~2 sprints)

### F5.1 — Portal estético (extends existente)

`apps/web/src/app/features/portal/portal.component.ts` ganha tabs novas se `tenant.module='estetica'`:
- **Pacotes** — sessions_remaining, expira em, "Renovar pacote" CTA WhatsApp
- **Procedimentos** — histórico (data, profissional, observações)
- **Análises faciais** — fotos antes/depois (somente com consent=marketing) + sumário IA
- **Recomendações** — sugestões da última análise + CTA "Agendar avaliação"

Backend extends `/portal/:token/*`:
- `GET /portal/:token/aesthetic/packages`
- `GET /portal/:token/aesthetic/procedures`
- `GET /portal/:token/aesthetic/analyses`

### F5.2 — Dashboard estético

`apps/web/src/app/features/clinic/aesthetic-dashboard/`:

KPIs financeiros: receita do mês, ticket médio, conversão consulta→pacote
Operacionais: top 5 procedures (volume + receita), top 5 packages, pacotes vencendo 30d, taxa de retorno

Backend: `GET /aesthetic/dashboard?period=30` — agregados em SQL com CTEs eficientes. Cache Redis 5min.

### F5.3 — Campanhas WhatsApp automatizadas

Estende `worker/src/notifications/scheduler.js` com 3 generators:

1. **`generateBirthdayCampaigns`** — daily, checa `subjects.birth_date = today`, manda template aniversário com cupom
2. **`generatePackageExpiringReminders`** — 3 ticks por sale (T-30d/T-15d/T-7d) baseado em `package_sales.expires_at`
3. **`generateCrossSellCampaigns`** — após `procedure_session` executada, agenda T+14d com sugestão IA

Schema: estende migration 076 CHECK pra incluir `birthday_campaign`, `package_expiring`, `aesthetic_cross_sell`. UNIQUE INDEX por `(tenant_id, subject_id, type, year-month)` pra idempotência (não duplica birthday no mesmo ano).

Opt-in granular em `notification_preferences`:
- `birthday_campaign_enabled` (default TRUE)
- `package_expiring_reminder_enabled` (default TRUE)
- `aesthetic_cross_sell_enabled` (default FALSE — opt-in!)

### Tests F5

- Portal renderiza tabs estéticas só se `tenant.module='estetica'`
- Dashboard requer admin/master role
- Birthday campaign idempotente
- Cross-sell respeita opt-out cliente
- WhatsApp template usa nome correto

---

## Resumo de impacto

| Fase | Migrations | Tabelas novas | Endpoints novos | Agentes IA | Tests novos |
|---|---|---|---|---|---|
| F1 | 1 | 0 | 0 | 0 | ~10 |
| F2 | 1 | 5 | ~12 | 0 | ~15 |
| F3 | 1 | 3 | ~8 | 0 | ~12 |
| F4 | 1 | 1 | ~3 | 4 | ~10 |
| F5 | 1 | 0 (extends) | ~6 | 0 | ~8 |
| **Σ** | **5** | **9** | **~29** | **4** | **~55** |

## Não-objetivos (intencionalmente fora)

- PDV / caixa avulsa não-pacote (deferred — usar Bling integração futuro)
- Estoque de cosmecêuticos (Bling)
- Fiscal NFC-e/NFS-e (terceirizar via Bling/Tiny)
- Internação ambulatorial
- Marketing além de WhatsApp (SMS, email blast)
- Multi-unidade/franquia gestão central (deferred até validar produto solo+boutique)

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Quebra em human/vet por enum extension | Tests existentes cobrem; CHECK constraint additive não invalida valores antigos |
| Custos de IA explodirem em F4 | Cache por photo_id, rate limit 10/min/tenant, créditos como gate |
| LGPD em fotos antes/depois | Consent granular obrigatório; revoke deve esconder em todos contextos |
| Esteticista escapando gate de prescrição | `requireMedico` middleware aplicado em todas as rotas; tests automatizados garantem |
| Tabelas novas poluindo schema human/vet | Reviews exigem que SELECT/INSERT em estética checke `tenant.module='estetica'` |
| Confusão Cliente vs Paciente | Maps centralizados em `app.component.ts` por module |

## Strategy de implementação

- **1 branch por fase**, mergeada em main quando completa + testada localmente
- Cada PR roda CI gate (`apps/api npm run test:unit`, `apps/worker npm test`, `apps/web npm test`) antes de merge
- Deploy automático em prod via pipeline existente (`deploy.yml`)
- Migrations testadas no Docker DB local antes do push
- Audit log triggers em tabelas `package_sales` + `procedure_sessions` (financeiro/LGPD)
- Memória Claude atualizada a cada fase em `docs/claude-memory/project_aesthetic_clinic.md`
- CLAUDE.md ganha seção "## Comportamentos Esperados" pra cada fase

## Status de entrega

| Fase | Status | SHA principal |
|---|---|---|
| F1 Foundation | ✅ Entregue 2026-05-06 | `38d31a92` |
| F2 Procedures + Packages | Não iniciada | — |
| F3 Photos antes/depois | Não iniciada | — |
| F4 IA análise facial | Não iniciada | — |
| F5 Portal + Dashboards + Campanhas | Não iniciada | — |

## Errata (atualizada 2026-05-06)

**Onboarding pago é via `/onboarding/checkout` (Stripe single-shot), NÃO `/auth/register`.** O plano F1 original assumia /auth/register; descobrimos durante execução que o fluxo real cria tenant+user só no webhook após pagamento. Próximas fases que precisarem de novos campos no onboarding devem atualizar:
- `apps/api/src/routes/onboarding-checkout.js` — body validation + Stripe metadata
- `apps/api/src/services/billing-events.js` `handleOnboardingSubscriptionCompleted` — webhook INSERT
- `apps/api/src/routes/auth.js` `/register` — compat retro pra admin/internal
- DB default seguro (3-camadas fail-closed em campos sensíveis)

Detalhes: `docs/claude-memory/feedback_onboarding_checkout_flow.md`.

## Débitos abertos pós-F1

- **Smoke E2E manual** (Task 15 do plano F1) — criar tenant teste com module='estetica' / professional_type='esteticista' em `app.genomaflow.com.br/onboarding`, validar fluxo completo (sidebar Clientes, prescription gate, campos fitzpatrick). Defer até alguém ter tempo de fazer manual.
- **/auth/register tests** — gate de prescriptions tem cobertura, mas não temos test E2E que cria tenant via /onboarding/checkout webhook + valida professional_type persistido. `tests/routes/onboarding-checkout.test.js` cobre o checkout handler isolado, `tests/routes/webhooks-stripe.test.js` cobre o webhook isolado, mas integração end-to-end (chamada real Stripe webhook → INSERT) é integration test debt.
- **Esteticista vê Tratamentos read-only:** decisão atual é mostrar prescrições existentes com Baixar PDF mas esconder Editar/Excluir. Decisão de UX/produto ainda em aberto se aba Tratamentos inteira deveria sumir pra esteticista (provavelmente sim em F2 quando tiver Procedimentos como aba paralela).

## Próximas fases

Cada fase tem seu próprio plano de implementação separado. Quando começar F2, invocar `superpowers:writing-plans` baseado nas seções F2-F5 deste spec + lições aprendidas em F1 (3-camadas fail-closed, onboarding-checkout flow).
