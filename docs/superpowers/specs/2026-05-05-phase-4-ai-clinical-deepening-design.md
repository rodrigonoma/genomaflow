# Phase 4 — Aprofundamento da IA Clínica

**Data:** 2026-05-05
**Status:** Entregue (4.1, 4.2, 4.3, 4.4 em produção)
**Origem:** brainstorm estratégico após análise comparativa com SimplesVet (2026-05-05)

## Contexto e motivação

Análise externa identificou que o gap clínico do GenomaFlow vs SimplesVet **fechou** com Phases 1-3 (prontuário, agenda, vacinas, documentos, portal, WhatsApp/lembretes). O gap restante é **ERP comercial/fiscal** (PDV, estoque, NFC-e/NFS-e), que não compete com a tese da plataforma.

A decisão estratégica foi **dobrar no que é único**: IA clínica. Sob ótica de PO/Arquiteto/Estrategista, o foso defensável é a inteligência clínica + UX, não ERP fiscal brasileiro (commodity).

Phase 4 entrega 4 features que aprofundam esse foso:

| Sub | Nome | Sprint | Entrega | SHA |
|---|---|---|---|---|
| 4.1 | Foto de laudo impresso → OCR Vision + pipeline texto | 1 | ✅ 2026-05-05 | `a97eb259` |
| 4.2 | Follow-up automatizado (WhatsApp pós-consulta/exame/vacina) | 1 | ✅ 2026-05-05 | `7850429d` |
| 4.3 | IA pró-ativa no patient-detail (sugestões de ação) | 2 | ✅ 2026-05-05 | `a11d7b93` |
| 4.4 | Co-piloto durante consulta (hipóteses + exames + red flags) | 2 | ✅ 2026-05-05 | `0afab7b3` |

Total: 6 sprints planejados, executados em 1 sessão sob autonomia explícita.

---

## 4.1 — Foto de laudo impresso → OCR Vision

### Problema
JPG/PNG enviado como exame caía direto em `processImagingExam`, que tenta classificar modalidade (RX/ECG/US/MRI). Foto de hemograma impresso falhava com "modalidade não identificada". Cliente forçado a escanear pra PDF antes de upload.

### Solução
Pré-classificação em duas etapas via Vision:

1. `apps/worker/src/parsers/image.js`:
   - `classifyImageContent(base64, mediaType)` → `'medical_image' | 'document' | 'unknown'`
   - `ocrLabReport(base64, mediaType)` → texto plano preservando estrutura (cabeçalho, tabela de resultados com valor+unidade+ref, comentários)
   - Modelo: `claude-sonnet-4-6` (mesmo já usado em classifiers/imaging)

2. `apps/worker/src/processors/exam.js`:
   - Refactor: extraído `processTextExam(args, prefetchedText?)` — pipeline texto compartilhado entre PDF e OCR Vision
   - `processExam` virou roteador puro:
     - `dicom` → `processImagingExam`
     - `image + content=document` → OCR + `processTextExam(prefetchedText=ocrText)`
     - `image + content=medical_image` → `processImagingExam` (legado)
     - `image + ocr<50chars` → fallback `processImagingExam`
     - `pdf` → `processTextExam` (com `extractText` do buffer)

### Persistência
- Imagem original sobe pra `exam-images/{tenant}/{exam}/image.{ext}` pra preview
- `credit_ledger` marca `ocr_usage` com kind `'OCR: foto de laudo impresso (Vision)'`

### Frontend
- Hint atualizado no upload: "PDF · DICOM · JPG · PNG · foto do laudo impresso"
- Sem mudança de UI maior — pipeline transparente pro usuário

### Tests
- `tests/parsers/image.test.js`: 6 cases (classify x4, OCR x2)

---

## 4.2 — Follow-up automatizado pós-consulta/exame/vacina

### Problema
Paciente sai com prescrição/exame e clínica nunca mais sabe o que aconteceu. Tutor vet pior — esquece próxima dose de vacina. Falta retenção sistemática.

### Solução
3 generators novos no worker scheduler (5min ticks), idempotentes via UNIQUE INDEX.

#### Tipos de follow-up

| Tipo | Trigger | Default | Template |
|---|---|---|---|
| `post_consultation_followup` | encounter `signed_at` + 7d | 7 dias | "Como está se sentindo?" |
| `exam_alert_followup` | exam `done` com alerta `high`/`critical` + 30d | 30 dias | "Para acompanhar evolução, vale conversar..." |
| `vaccine_dose_reminder` | vaccine `next_dose_date` − 7d e − 1d | T-168h, T-24h | "Próxima dose de {{vacina}} em {{data}}" |

#### Migration 076

```sql
-- CHECK extendido pra 3 tipos novos + retroativo
ALTER TABLE scheduled_notifications
  ADD CONSTRAINT scheduled_notifications_notification_type_check
  CHECK (notification_type IN (
    'appointment_reminder', 'vaccine_reminder', 'vaccine_dose_reminder',
    'nps_request', 'post_consultation_followup', 'exam_alert_followup', 'custom'
  ));

-- exam_id FK pra rastrear follow-ups por exam
ALTER TABLE scheduled_notifications
  ADD COLUMN IF NOT EXISTS exam_id UUID REFERENCES exams(id) ON DELETE CASCADE;

-- Idempotência (status pending OR sent)
CREATE UNIQUE INDEX uniq_post_consult_followup
  ON scheduled_notifications(encounter_id)
  WHERE notification_type = 'post_consultation_followup' AND ...;

CREATE UNIQUE INDEX uniq_exam_alert_followup
  ON scheduled_notifications(exam_id)
  WHERE notification_type = 'exam_alert_followup' AND ...;

CREATE UNIQUE INDEX uniq_vaccine_dose_reminder
  ON scheduled_notifications(vaccine_id, hours_before)
  WHERE notification_type = 'vaccine_dose_reminder' AND ...;

-- notification_preferences ganhou opt-in granular
ALTER TABLE notification_preferences
  ADD post_consultation_followup_enabled BOOLEAN DEFAULT TRUE,
  ADD post_consultation_followup_days INTEGER DEFAULT 7,
  ADD exam_alert_followup_enabled BOOLEAN DEFAULT TRUE,
  ADD exam_alert_followup_days INTEGER DEFAULT 30,
  ADD vaccine_dose_reminder_enabled BOOLEAN DEFAULT TRUE,
  ADD vaccine_dose_reminder_hours_before INTEGER[] DEFAULT ARRAY[168, 24];
```

#### Lógica de geração
- `generatePostConsultationFollowups`: encounters `signed_at` IS NOT NULL nos últimos 30d sem follow-up
- `generateExamAlertFollowups`: exams `done` nos últimos 90d com `clinical_results.alerts` contendo `severity:high|critical`
- `generateVaccineDoseReminders`: vaccines com `next_dose_date` nos próximos 14d, agenda T-7d e T-1d (skip h maior se passou; menor h "agora" se passou mas data futura)

#### Tests
- `tests/notifications/scheduler-templates.test.js`: smoke (mock pg) confirma exports + tick sem throw
- DB-heavy ficam como integration test debt

---

## 4.3 — IA pró-ativa no patient-detail

### Problema
Médico abre prontuário do paciente e vê histórico, mas **não vê "o que está faltando"**. Ex: paciente diabético há 6m sem HbA1c nova; tabagista sem espirometria; gato adulto sem hemograma anual.

### Solução
Card "Sugestões da IA" no topo da aba Perfil do paciente. Backend coleta contexto, anonimiza, chama Claude Opus, retorna JSON com sugestões priorizadas.

#### Migration 077

```sql
CREATE TABLE ai_suggestions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,  -- TTL 24h
  dismissed_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_by UUID REFERENCES users(id),
  ...
);

-- 1 cache ativo por subject (UPSERT no refresh)
CREATE UNIQUE INDEX uniq_ai_suggestions_subject ON ai_suggestions(tenant_id, subject_id);

-- RLS NULLIF padrão
```

#### Service
`apps/api/src/services/ai-suggestions.js`:
- `buildSubjectContext(client, subject_id, tenant_id)` — agrega comorbidities, exames recentes (com top alertas), prescrições, encontros (últimos 90 dias)
- `generateSuggestions(ctx, module)` — Claude Opus 4.7 + system prompt clínico
- Parser tolerante: extrai JSON mesmo com prefixo de texto (regex `/\{[\s\S]*\}/`)
- Saneamento: filter sem title/rationale, priority válida (default `medium`), slice campos longos
- `refreshSuggestions` — UPSERT com TTL de 24h
- `dismissSuggestion` — append no array `dismissed_ids`

#### System prompt (resumido)
> Você é um assistente clínico que ajuda médicos veterinários e humanos a identificar AÇÕES PROATIVAS. Sugestões > diagnóstico. Cite a diretriz quando relevante. Seja ESPECÍFICO. Cada sugestão deve ter trigger nos dados. Priorize: alta = 30 dias; média = próxima consulta; baixa = oportunidade. Se NADA relevante, retorne array vazio.

#### Endpoints
- `GET /patients/:id/ai-suggestions` — retorna cache + flag `expired`
- `POST /patients/:id/ai-suggestions/refresh` (admin only, rate limit 10/min) — gera/regenera
- `POST /patients/:id/ai-suggestions/dismiss` — marca uma sugestão como descartada

#### Frontend
`apps/web/src/app/features/ai-suggestions/`:
- `ai-suggestions.service.ts` — HTTP wrapper
- `ai-suggestions-card.component.ts` — empty state com CTA, lista ordenada por prioridade (high → medium → low) com border-left colorida, dismiss individual, refresh com confirm de tokens, disclaimer obrigatório
- Integrado no topo da aba Perfil do `patient-detail.component.ts`

#### Tests
- `tests/services/ai-suggestions.test.js`: 8 cases (parsing JSON, prefixo+sufixo, filter malformados, priority default, BAD_LLM_OUTPUT, buildSubjectContext NOT_FOUND e shape)

---

## 4.4 — Co-piloto durante consulta

### Problema
Médico tá no encounter-form digitando queixa, anamnese, exame físico. Ainda não fechou hipótese diagnóstica — mas a IA poderia sugerir CIDs prováveis e exames pra confirmar/excluir EM TEMPO REAL.

### Solução
Sidebar lateral no encounter-form com botão "Analisar prontuário atual". Backend recebe rascunho atual, retorna estrutura: hipóteses, exames recomendados, red flags, needs_more_info.

#### Service
`apps/api/src/services/encounter-copilot.js`:
- `analyze(draft)` — Claude Opus 4.7 com system prompt clínico
- Rejeita input curto (< 30 chars total) com `INPUT_TOO_SHORT`
- Saneamento agressivo:
  - `prob_score` clampado em [0, 1]
  - `priority` whitelist `[high, medium, low]` (default `medium`)
  - `urgency` whitelist `[imediata, hoje, esta_semana]` (default `esta_semana`)
  - `type` whitelist `[lab, imaging, other]` (default `other`)
  - Slice campos: title 120, rationale 300, indication 200
  - Max 5 hipóteses, 8 exames, 5 red flags, 5 needs_more_info

#### Schema do output
```json
{
  "hypotheses": [{ "name", "icd10", "prob_score", "rationale" }],
  "recommended_exams": [{ "name", "type", "priority", "indication" }],
  "red_flags": [{ "signal", "urgency", "recommendation" }],
  "needs_more_info": ["pergunta 1", "..."],
  "model_version": "claude-opus-4-7"
}
```

#### Endpoint
- `POST /encounters/copilot` (preHandler authenticate, rate limit 30/min)
- Request: `{ subject_id, chief_complaint, anamnesis, physical_exam, hypothesis, vital_signs }`
- Response: 200 com schema acima; 400 INPUT_TOO_SHORT; 502 BAD_LLM_OUTPUT
- **Não persiste** — só análise on-demand. Tokens consumidos, mas estado fica só no cliente.

#### Frontend
`apps/web/src/app/features/encounters/encounter-form.component.ts`:
- Layout 2 colunas (form 1fr + sidebar 320px), responsive empilha < 920px
- Toggle "Ativar co-piloto IA" no header do form (ícone dot + glassmorphism)
- Sidebar com glassmorphism (gradient), 4 sections: Hipóteses (badge CID + prob_score chip), Exames (chip prioridade colorida), Red flags (vermelho + urgência destacada), Falta investigar (lista bullet)
- Disclaimer obrigatório no footer: "⚕ Sugestões da IA. Médico decide."

#### Tests
- `tests/services/encounter-copilot.test.js`: 6 cases (input curto, parse completo, clamp prob_score, fallback urgency, BAD_LLM_OUTPUT, arrays vazios coerentes)

---

## Decisões arquiteturais

### LLM provider e modelo
- **Anthropic Claude Opus 4.7** pra 4.3 e 4.4 (raciocínio clínico exige modelo top)
- **Anthropic Claude Sonnet 4.6** pra 4.1 (Vision + OCR — Sonnet basta com qualidade alta)
- Reuso do SDK já presente em `chat.js`/`imaging.js`/`product-help.js`

### Cache vs streaming
- 4.3 (sugestões pró-ativas): **cache 24h** — análise é "estado do paciente", não muda a cada minuto. Refresh manual.
- 4.4 (co-piloto): **on-demand sem cache** — rascunho do prontuário muda em segundos. Sem persistência.
- Streaming SSE rejeitado em 4.4 por simplicidade (latência ~3s aceitável).

### Saneamento defensivo
LLM output sempre passa por:
1. Regex pra extrair JSON mesmo com prefixo (`/\{[\s\S]*\}/`)
2. `JSON.parse` com try/catch → `BAD_LLM_OUTPUT`
3. Whitelist de enums (priority, urgency, type)
4. Clamp numérico (prob_score 0-1)
5. Slice de strings (defesa contra prompt injection que tente vazar tokens enormes)
6. Filter de entries malformados

**Princípio:** o LLM pode mentir/alucinar/falhar. Backend nunca confia cegamente.

### Rate limiting
- 4.3 refresh: 10/min/tenant
- 4.4 copilot: 30/min/tenant

Custo de tokens é repassado via créditos (4.3) ou implícito (4.4 — a definir se vira créditos no futuro).

### Privacidade
- 4.1 OCR + 4.3 sugestões: anonimização não é estrita (médico está logado vendo seu próprio paciente — diferente do contexto de inter-tenant chat onde anonimização é obrigatória).
- 4.4 co-piloto: payload contém só rascunho do prontuário atual + demografia (idade, sexo, espécie). Nome do paciente NÃO é enviado ao LLM.

---

## Estatísticas de entrega

- **7 commits** (a97eb259, 7850429d, a11d7b93, 0afab7b3 + dependências)
- **~2.500 LOC adicionados**
- **2 migrations novas** (076, 077)
- **20 tests novos** (6 + 2 + 8 + 6 — todos verdes)
- **580 tests verdes na API**, 31 web
- **Tempo:** 1 sessão de execução autônoma (~3-4 horas)

## Próximos passos não executados

Da proposta original de 7 itens, restam:
1. **Integração Bling** (PDV + estoque + fiscal terceirizado) — depende de decisão estratégica
2. **Recibo + PIX inline** (monetização clínica humana particular)
3. **Memed/BirdID assinatura digital ICP-Brasil** (receita médica válida em farmácia)

Esses não são da Phase 4 — são adjacentes mas não tem dependência clínica. Prioridade comercial.
