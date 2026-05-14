---
name: Phase 4 — Aprofundamento da IA Clínica
description: 4 features (4.1 OCR foto laudo, 4.2 follow-up automatizado, 4.3 IA pró-ativa, 4.4 co-piloto consulta) entregues 2026-05-05. Foso defensável da plataforma
type: project
---

# Phase 4 — IA clínica como foso defensável (entregue 2026-05-05)

Após análise comparativa com SimplesVet (gap clínico fechou; gap restante é ERP comercial/fiscal), decisão estratégica foi **dobrar no que é único**: IA clínica + UX. ERP fiscal brasileiro é commodity, IA é defensável.

## 4.1 — Foto de laudo impresso → OCR Vision (`a97eb259`)

**Problema antes:** JPG/PNG ia direto pra `processImagingExam` (que tenta classificar modalidade RX/ECG/US/MRI). Foto de hemograma impresso falhava.

**Solução:** pré-classificação Vision em `apps/worker/src/parsers/image.js`:
- `classifyImageContent` → `medical_image | document | unknown`
- `ocrLabReport` → texto plano preservando estrutura
- Refactor em `processors/exam.js`: extraído `processTextExam(args, prefetchedText?)` compartilhado entre PDF e OCR Vision
- `processExam` virou roteador puro com fallback (image+ocr<50chars → imaging)

**Persistência:** original sobe pra `exam-images/{tenant}/{exam}/image.{ext}`. `credit_ledger` marca `ocr_usage` com kind `OCR: foto de laudo impresso (Vision)`.

**Tests:** 6 cases em `tests/parsers/image.test.js` (classify x4, OCR x2).

## 4.2 — Follow-up automatizado WhatsApp (`7850429d`)

3 generators novos no worker scheduler (5min ticks), idempotentes via UNIQUE INDEX partial:

| Tipo | Trigger | Default | Template |
|---|---|---|---|
| `post_consultation_followup` | encounter `signed_at` + 7d | 7 dias | "Como está se sentindo?" |
| `exam_alert_followup` | exam `done` com alerta `high`/`critical` + 30d | 30 dias | "Para acompanhar evolução, vale conversar..." |
| `vaccine_dose_reminder` | vaccine `next_dose_date` − 168h e − 24h | T-7d e T-1d | "Próxima dose de {{vacina}} em {{data}}" |

**Migration 076:**
- CHECK extendido pra 3 tipos novos
- Coluna `exam_id` em `scheduled_notifications` + FK
- 3 UNIQUE INDEX partial pra idempotência (status `pending`/`sent`)
- `notification_preferences` ganhou opt-in granular: `post_consultation_followup_enabled/days`, `exam_alert_followup_enabled/days`, `vaccine_dose_reminder_enabled/hours_before`

**Idempotência:** UNIQUE INDEX (encounter_id) | (exam_id) | (vaccine_id, hours_before) com `status IN ('pending','sent')` impede duplicação cross-ticks.

## 4.3 — IA pró-ativa no patient-detail (`a11d7b93`)

Card "Sugestões da IA" no topo da aba Perfil. Gera sugestões de **AÇÃO** (não diagnóstico) baseadas no histórico clínico.

**Migration 077:** `ai_suggestions` table (1 cache ativo por subject via UNIQUE upsert), TTL 24h, `dismissed_ids` JSONB array, RLS NULLIF padrão, audit trigger.

**Service:** `apps/api/src/services/ai-suggestions.js`:
- `buildSubjectContext`: agrega comorbidities + exames recentes (com top alertas) + prescrições + encontros (180d)
- `generateSuggestions`: Claude Opus 4.7 + system prompt clínico (sugestões > diagnóstico, cite diretriz, evite generalidades, trigger nos dados, priority high/medium/low)
- Parser tolerante: regex `/\{[\s\S]*\}/` pra extrair JSON mesmo com prefixo de texto
- Saneamento: filter sem title/rationale, priority válida default `medium`, slice campos longos

**Endpoints:**
- `GET /patients/:id/ai-suggestions` — cache + flag `expired`
- `POST /patients/:id/ai-suggestions/refresh` (admin only, rate limit 10/min)
- `POST /patients/:id/ai-suggestions/dismiss`

**Frontend:** `apps/web/src/app/features/ai-suggestions/`:
- Empty state com CTA "Gerar sugestões"
- Lista ordenada por prioridade (high → medium → low) com border-left colorida
- Dismiss individual (✕) — não some, fica em `dismissed_ids`
- Refresh com confirm de tokens
- **Disclaimer obrigatório** no footer

**Tests:** 8 cases em `tests/services/ai-suggestions.test.js`.

## 4.4 — Co-piloto durante consulta (`0afab7b3`)

Sidebar lateral no `encounter-form` com botão "Analisar prontuário atual". Médico digita rascunho, IA retorna estrutura com hipóteses + exames + red flags.

**Service:** `apps/api/src/services/encounter-copilot.js`:
- `analyze(draft)` — Claude Opus 4.7
- Rejeita input < 30 chars com `INPUT_TOO_SHORT`
- Saneamento agressivo: `prob_score` clampado [0,1], `priority` whitelist, `urgency` whitelist, slice campos
- Max 5 hipóteses, 8 exames, 5 red flags

**Schema output:**
```json
{
  "hypotheses": [{ "name", "icd10", "prob_score", "rationale" }],
  "recommended_exams": [{ "name", "type", "priority", "indication" }],
  "red_flags": [{ "signal", "urgency", "recommendation" }],
  "needs_more_info": ["pergunta 1"],
  "model_version": "claude-opus-4-7"
}
```

**Endpoint:** `POST /encounters/copilot` (rate limit 30/min). **Não persiste** — só análise on-demand. Estado fica só no cliente.

**Frontend:** `encounter-form.component.ts`:
- Layout 2 colunas (form + sidebar 320px), responsive empilha < 920px
- Toggle "Ativar co-piloto IA" no header (ícone dot pulsando)
- Sidebar com glassmorphism, 4 sections: Hipóteses (badge CID + prob chip), Exames (chip prioridade colorida), Red flags (vermelho + urgência), Falta investigar (lista bullet)
- Disclaimer footer

**Tests:** 6 cases em `tests/services/encounter-copilot.test.js`.

## Padrões reutilizáveis estabelecidos

### Pattern: LLM call com saneamento defensivo

```js
async function callLLM(input) {
  // 1. Validação de entrada (rejeita curto demais, etc)
  if (!isValidInput(input)) throw { code: 'INPUT_INVALID' };

  // 2. Call ao LLM
  const response = await client.messages.create({...});

  // 3. Parser tolerante (extrai JSON com prefixo de texto)
  let parsed;
  try {
    const m = response.text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : response.text);
  } catch (err) {
    throw { code: 'BAD_LLM_OUTPUT', raw: response.text };
  }

  // 4. Validação de schema (array obrigatório, etc)
  if (!Array.isArray(parsed.suggestions)) throw { code: 'BAD_LLM_OUTPUT' };

  // 5. Saneamento de cada entry
  const cleaned = parsed.suggestions
    .filter(isValidEntry)
    .map(sanitizeEntry);

  return cleaned;
}
```

LLM **pode mentir, alucinar, falhar** — backend nunca confia cegamente. Aplicar em qualquer feature de IA futura.

### Pattern: cache de resposta IA com TTL + UPSERT

```sql
CREATE UNIQUE INDEX uniq_ai_xxx_subject ON ai_xxx(tenant_id, subject_id);
```

```js
INSERT INTO ai_xxx (...) VALUES (...)
ON CONFLICT (tenant_id, subject_id) DO UPDATE SET
  payload = EXCLUDED.payload,
  generated_at = NOW(),
  expires_at = EXCLUDED.expires_at,
  dismissed_ids = '[]'::jsonb,  -- reset no refresh
  updated_at = NOW();
```

TTL 24h é razoável pra "estado do paciente". Refresh manual pelo profissional.

### Pattern: idempotência via UNIQUE INDEX partial

Pra prevenir duplicação cross-ticks no scheduler:

```sql
CREATE UNIQUE INDEX uniq_xxx
  ON scheduled_notifications(<chave de idempotência>)
  WHERE notification_type = 'xxx'
    AND <chave> IS NOT NULL
    AND status IN ('pending', 'sent');
```

`ON CONFLICT (chave) WHERE ... DO NOTHING` no INSERT respeita essa idempotência.

## Custo de inference (estimativa)

| Feature | Modelo | Input médio | Output médio | Custo/call |
|---|---|---|---|---|
| 4.1 OCR (Vision) | Sonnet 4.6 | ~1MB image | 500-2000 tokens | ~R$ 0.10-0.30 |
| 4.3 Sugestões | Opus 4.7 | 2-4k tokens | 800-1500 tokens | ~R$ 0.50-0.80 |
| 4.4 Co-piloto | Opus 4.7 | 1-2k tokens | 1000-1500 tokens | ~R$ 0.40-0.60 |

Cache (24h em 4.3) reduz drasticamente custo recorrente. Rate limiting evita abuso.

## Próximos passos não entregues

- Integração Bling (PDV + estoque + fiscal terceirizado) — pendente de decisão estratégica
- Recibo + PIX inline (monetização clínica humana particular)
- Memed/BirdID assinatura digital ICP-Brasil

## SHAs de referência

| Feature | SHA |
|---|---|
| 4.1 Foto de laudo OCR | `a97eb259` |
| 4.2 Follow-up automatizado | `7850429d` |
| 4.3 IA pró-ativa | `a11d7b93` |
| 4.4 Co-piloto consulta | `0afab7b3` |
