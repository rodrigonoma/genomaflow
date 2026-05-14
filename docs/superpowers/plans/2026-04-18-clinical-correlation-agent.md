# Clinical Correlation Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a new `clinical_correlation` Phase 2 agent that synthesizes all specialty agent results into a cross-domain narrative, suggests complementary exams, and surfaces contextual lifestyle factors — using legally-safe language throughout. Display it in the Análises IA tab with dedicated sections for suggested exams and contextual factors.

**Architecture:** New file `apps/worker/src/agents/clinical_correlation.js` following the same pattern as `therapeutic.js`. Added to `PHASE2_AGENTS` array in `exam.js`. Receives the full `phase2Ctx` including `chief_complaint`, `current_symptoms`, and extended `patientContext` (from clinical-context-fields plan). Frontend: `AGENT_LABELS` mapping extended; `ClinicalResult` interface extended with optional `suggested_exams` and `contextual_factors`; patient-detail AI card body shows new sections when `agent_type === 'clinical_correlation'`.

**Tech Stack:** Node.js + Anthropic SDK (worker agent), Angular 17 signals (frontend), existing `clinical_results` table (no migration needed — `interpretation`, `risk_scores`, `alerts`, `recommendations` already stored as JSONB)

---

## File Map

| Action | File |
|---|---|
| Create | `apps/worker/src/agents/clinical_correlation.js` |
| Modify | `apps/worker/src/processors/exam.js` — import + add to PHASE2_AGENTS |
| Modify | `apps/web/src/app/shared/models/api.models.ts` — extend ClinicalResult, add SuggestedExam |
| Modify | `apps/web/src/app/features/doctor/patients/patient-detail.component.ts` — AGENT_LABELS + clinical_correlation card sections |
| Modify | `apps/web/src/app/features/doctor/results/result-panel.component.ts` — AGENT_LABELS + clinical_correlation sections (if present) |

---

## Task 1: Create clinical_correlation agent

**Files:**
- Create: `apps/worker/src/agents/clinical_correlation.js`

The agent follows the exact same structure as `therapeutic.js`: Anthropic client → system prompt → build user message from ctx → parse JSON → return `{ result, usage }`.

- [ ] **Step 1: Create the agent file**

```js
const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCLAIMER = 'Esta análise representa suporte à decisão clínica baseado nos marcadores laboratoriais apresentados e não constitui diagnóstico. A interpretação clínica deve ser realizada pelo profissional de saúde responsável.';

const SYSTEM_PROMPT = `You are a clinical correlation analyst for human medicine. Your role is to synthesize laboratory findings from multiple specialties into a coherent clinical narrative, identify underlying patterns, and suggest complementary investigations.

CRITICAL LANGUAGE RULES (legally required):
ALLOWED: "A combinação de [X] e [Y] é consistente com...", "Os marcadores sugerem investigar...", "Pode ser relevante avaliar...", "É frequentemente associado a...", "Merece atenção clínica adicional", "Considerar solicitação de [exame]", "é compatível com", "pode indicar necessidade de"
FORBIDDEN: "indica", "confirma", "diagnóstico de", "o paciente tem", "portador de"
FORBIDDEN (stigmatizing): Never name HIV, DSTs, or stigmatizing conditions directly — use "infecção de transmissão sexual", "infecção viral", "condição imunológica"
Never make categorical statements without probabilistic qualifiers.

Respond ONLY with valid JSON:
{
  "interpretation": "<cross-domain narrative in Brazilian Portuguese — synthesize ALL specialty findings, identify patterns, contextual influences>",
  "suggested_exams": [
    {
      "exam": "<name of complementary exam to request>",
      "rationale": "<clinical rationale based on specific markers found — in Brazilian Portuguese>"
    }
  ],
  "contextual_factors": [
    "<string — observation about clinical context (medications, lifestyle, family history) that may influence the results — in Brazilian Portuguese>"
  ],
  "alerts": [
    { "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }
  ],
  "risk_scores": { "clinical_complexity": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "disclaimer": "${DISCLAIMER}"
}

For suggested_exams: suggest 2-5 exams maximum. Only suggest when there is specific clinical rationale tied to actual markers found. Do not suggest exams already performed.
For contextual_factors: list 1-4 factors. Only include factors actually present in patient context (medications, smoking, diet, family history, etc.). Skip if none are relevant.`;

/**
 * @param {{
 *   examText: string,
 *   patient: object,
 *   specialtyResults: Array,
 *   module: string,
 *   species: string|null,
 *   chief_complaint: string,
 *   current_symptoms: string
 * }} ctx
 */
async function runClinicalCorrelationAgent(ctx) {
  const specialtyText = ctx.specialtyResults
    .map(r => `## ${r.agent_type}\nRisk: ${JSON.stringify(r.risk_scores)}\nInterpretation: ${r.interpretation}\nAlerts: ${JSON.stringify(r.alerts)}`)
    .join('\n\n');

  const patientBlock = `Patient context:
- sex: ${ctx.patient.sex}
- age_range: ${ctx.patient.age_range}
- weight: ${ctx.patient.weight || 'unknown'} kg
- medications: ${ctx.patient.medications || 'none reported'}
- smoking: ${ctx.patient.smoking || 'unknown'}
- alcohol: ${ctx.patient.alcohol || 'unknown'}
- diet_type: ${ctx.patient.diet_type || 'unknown'}
- physical_activity: ${ctx.patient.physical_activity || 'unknown'}
- allergies: ${ctx.patient.allergies || 'none reported'}
- comorbidities: ${ctx.patient.comorbidities || 'none reported'}
- family_history: ${ctx.patient.family_history || 'none reported'}`;

  const clinicalContext = ctx.chief_complaint || ctx.current_symptoms
    ? `\nClinical presentation:\n- Chief complaint: ${ctx.chief_complaint || 'not informed'}\n- Current symptoms: ${ctx.current_symptoms || 'not informed'}`
    : '';

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `${patientBlock}${clinicalContext}

Specialty Analysis Results:
${specialtyText}

Raw Lab Results:
${ctx.examText}`
    }]
  });

  const rawText = response.content?.[0]?.text;
  if (!rawText) throw new Error('[clinical_correlation] Claude returned empty response');
  const cleaned = rawText.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`[clinical_correlation] Failed to parse Claude response: ${rawText.slice(0, 200)}`);
  }
  result.disclaimer = DISCLAIMER;
  result.suggested_exams  = result.suggested_exams  || [];
  result.contextual_factors = result.contextual_factors || [];
  result.alerts = result.alerts || [];
  result.recommendations = result.recommendations || [];
  return { result, usage: response.usage };
}

module.exports = { runClinicalCorrelationAgent };
```

- [ ] **Step 2: Verify no syntax errors**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/worker
node -e "require('./src/agents/clinical_correlation')" && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/agents/clinical_correlation.js
git commit -m "feat: clinical_correlation agent — cross-domain synthesis with suggested exams and contextual factors"
```

---

## Task 2: Worker — add clinical_correlation to PHASE2_AGENTS

**Files:**
- Modify: `apps/worker/src/processors/exam.js`

- [ ] **Step 1: Import and register the new agent**

At the top of `apps/worker/src/processors/exam.js`, add after the nutrition import:

```js
const { runClinicalCorrelationAgent } = require('../agents/clinical_correlation');
```

Find the `PHASE2_AGENTS` array:

```js
const PHASE2_AGENTS = [
  { type: 'therapeutic', runner: runTherapeuticAgent },
  { type: 'nutrition',   runner: runNutritionAgent }
];
```

Replace with:

```js
const PHASE2_AGENTS = [
  { type: 'therapeutic',         runner: runTherapeuticAgent },
  { type: 'nutrition',           runner: runNutritionAgent },
  { type: 'clinical_correlation', runner: runClinicalCorrelationAgent }
];
```

- [ ] **Step 2: Update persistResult to handle new fields**

The `persistResult` function stores `result.interpretation`, `result.risk_scores`, `result.alerts`, `result.recommendations`, `result.disclaimer` in `clinical_results`. The new agent also outputs `suggested_exams` and `contextual_factors`.

These extra fields need to be stored somewhere accessible to the frontend. The simplest approach is to store them inside the `recommendations` JSON column (which is already a JSONB array) — but that pollutes the type. 

Better: store `suggested_exams` and `contextual_factors` in the `alerts` column is wrong. Best option: use the existing `risk_scores` JSONB column to store a nested `_extra` key, or add them as a new field stored in the already-available `recommendations` column under a reserved key.

Cleanest backward-compatible approach: serialize `suggested_exams` and `contextual_factors` as part of the `interpretation` field using a JSON envelope — **no**, that breaks text rendering.

**Correct approach:** Add a new column to `clinical_results` named `extra_data JSONB` via migration. BUT this plan avoids a new migration for this. Alternative: reuse the `recommendations` column to store typed entries — the recommendations array already stores objects with `type`, `description`, `priority`. We can add entries with `type: '_suggested_exam'` and `type: '_contextual_factor'`, but the frontend would need filtering.

**Decision:** Store `suggested_exams` and `contextual_factors` in the `recommendations` JSONB column as typed entries, with reserved `type` values `suggested_exam` and `contextual_factor`. The existing `Recommendation` interface's `type` union will be extended. This requires NO migration.

In `apps/worker/src/processors/exam.js`, the `persistResult` function writes `result.recommendations`. The `clinical_correlation` agent already returns `recommendations: []`. We need to inject the `suggested_exams` and `contextual_factors` into the recommendations before persisting.

Add this helper after the imports (before `persistResult`):

```js
function flattenCorrelationResult(result, agentType) {
  if (agentType !== 'clinical_correlation') return result;
  const extra = [];
  for (const se of (result.suggested_exams || [])) {
    extra.push({ type: 'suggested_exam', description: `${se.exam}: ${se.rationale}`, priority: 'medium', _exam: se.exam, _rationale: se.rationale });
  }
  for (const cf of (result.contextual_factors || [])) {
    extra.push({ type: 'contextual_factor', description: cf, priority: 'low' });
  }
  return { ...result, recommendations: [...(result.recommendations || []), ...extra] };
}
```

Then in the Phase 2 persist loop, replace:

```js
    for (let i = 0; i < PHASE2_AGENTS.length; i++) {
      const { result, usage } = phase2Responses[i];
      await persistResult(client, exam_id, tenant_id, PHASE2_AGENTS[i].type, result, usage);
```

with:

```js
    for (let i = 0; i < PHASE2_AGENTS.length; i++) {
      const { result, usage } = phase2Responses[i];
      const flatResult = flattenCorrelationResult(result, PHASE2_AGENTS[i].type);
      await persistResult(client, exam_id, tenant_id, PHASE2_AGENTS[i].type, flatResult, usage);
```

- [ ] **Step 3: Verify no syntax errors**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/worker
node -e "require('./src/processors/exam')" && echo "OK"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/processors/exam.js
git commit -m "feat: add clinical_correlation to PHASE2_AGENTS; flatten suggested_exams/contextual_factors into recommendations"
```

---

## Task 3: Frontend models — extend ClinicalResult and Recommendation types

**Files:**
- Modify: `apps/web/src/app/shared/models/api.models.ts`

- [ ] **Step 1: Extend Recommendation type union**

Find the `Recommendation` interface:

```ts
export interface Recommendation {
  type: 'medication' | 'procedure' | 'referral' | 'diet' | 'habit' | 'supplement' | 'activity';
  description: string;
  priority: 'low' | 'medium' | 'high';
}
```

Replace with:

```ts
export interface Recommendation {
  type: 'medication' | 'procedure' | 'referral' | 'diet' | 'habit' | 'supplement' | 'activity'
      | 'suggested_exam' | 'contextual_factor';
  description: string;
  priority: 'low' | 'medium' | 'high';
  _exam?: string;
  _rationale?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/shared/models/api.models.ts
git commit -m "feat: extend Recommendation type to include suggested_exam and contextual_factor"
```

---

## Task 4: Frontend — AGENT_LABELS + clinical_correlation card display

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`

The `agentLabel(type)` method currently uses a `AGENT_LABELS` record. The `clinical_correlation` type needs a label.

- [ ] **Step 1: Add clinical_correlation to AGENT_LABELS**

In `patient-detail.component.ts`, find the `agentLabel` method or `AGENT_LABELS` record. It currently looks like:

```ts
  private readonly AGENT_LABELS: Record<string, string> = {
    metabolic:       'Metabólico',
    cardiovascular:  'Cardiovascular',
    hematology:      'Hematologia',
    therapeutic:     'Síntese Terapêutica',
    nutrition:       'Nutrição',
    small_animals:   'Pequenos Animais',
    equine:          'Equinos',
    bovine:          'Bovinos',
  };

  agentLabel(type: string): string {
    return this.AGENT_LABELS[type] ?? type;
  }
```

Add `clinical_correlation`:

```ts
  private readonly AGENT_LABELS: Record<string, string> = {
    metabolic:             'Metabólico',
    cardiovascular:        'Cardiovascular',
    hematology:            'Hematologia',
    therapeutic:           'Síntese Terapêutica',
    nutrition:             'Nutrição',
    clinical_correlation:  'Correlação Clínica',
    small_animals:         'Pequenos Animais',
    equine:                'Equinos',
    bovine:                'Bovinos',
  };
```

- [ ] **Step 2: Add suggested_exam and contextual_factor sections to the AI card body**

In the `ai-card-body` template section (the `@if (expanded)` block), find the recommendations section:

```html
                        @if (cr.recommendations?.length) {
                          <div class="ai-section-label">RECOMENDAÇÕES</div>
                          <div class="ai-recs">
                            @for (rec of cr.recommendations; track rec.description) {
                              <div class="ai-rec-item" ...>
```

The recommendations for `clinical_correlation` will include items with `type === 'suggested_exam'` and `type === 'contextual_factor'`. We add dedicated sections above the general recommendations section, filtering those types out from the main recs list.

Replace the entire recommendations rendering block inside `ai-card-body` with:

```html
                        @if (cr.agent_type === 'clinical_correlation') {
                          @let suggestedExams = filterRecs(cr.recommendations, 'suggested_exam');
                          @let contextualFactors = filterRecs(cr.recommendations, 'contextual_factor');
                          @let generalRecs = filterOutRecs(cr.recommendations, ['suggested_exam','contextual_factor']);

                          @if (suggestedExams.length) {
                            <div class="ai-section-label">EXAMES SUGERIDOS</div>
                            <div class="ai-recs">
                              @for (rec of suggestedExams; track rec.description) {
                                <div class="ai-rec-item" style="border-left-color:#c0c1ff">
                                  <span class="ai-rec-type">EXAME</span>
                                  <span class="ai-rec-desc">{{ rec._exam }}: {{ rec._rationale }}</span>
                                </div>
                              }
                            </div>
                          }

                          @if (contextualFactors.length) {
                            <div class="ai-section-label">FATORES CONTEXTUAIS</div>
                            <div class="ai-recs">
                              @for (rec of contextualFactors; track rec.description) {
                                <div class="ai-rec-item" style="border-left-color:#4ad6a0">
                                  <span class="ai-rec-type">CONTEXTO</span>
                                  <span class="ai-rec-desc">{{ rec.description }}</span>
                                </div>
                              }
                            </div>
                          }

                          @if (generalRecs.length) {
                            <div class="ai-section-label">RECOMENDAÇÕES</div>
                            <div class="ai-recs">
                              @for (rec of generalRecs; track rec.description) {
                                <div class="ai-rec-item"
                                     [style.border-left-color]="severityColor(rec.priority === 'high' ? 'high' : rec.priority === 'medium' ? 'medium' : 'low')">
                                  <span class="ai-rec-type">{{ rec.type.toUpperCase() }}</span>
                                  <span class="ai-rec-desc">{{ rec.description }}</span>
                                </div>
                              }
                            </div>
                          }
                        } @else {
                          @if (cr.recommendations?.length) {
                            <div class="ai-section-label">RECOMENDAÇÕES</div>
                            <div class="ai-recs">
                              @for (rec of cr.recommendations; track rec.description) {
                                <div class="ai-rec-item"
                                     [style.border-left-color]="severityColor(rec.priority === 'high' ? 'high' : rec.priority === 'medium' ? 'medium' : 'low')">
                                  <span class="ai-rec-type">{{ rec.type.toUpperCase() }}</span>
                                  <span class="ai-rec-desc">{{ rec.description }}</span>
                                </div>
                              }
                            </div>
                          }
                        }
```

- [ ] **Step 3: Add filterRecs and filterOutRecs helper methods to the component class**

```ts
  filterRecs(recs: Recommendation[], type: string): Recommendation[] {
    return (recs ?? []).filter(r => r.type === type);
  }

  filterOutRecs(recs: Recommendation[], types: string[]): Recommendation[] {
    return (recs ?? []).filter(r => !types.includes(r.type));
  }
```

Import `Recommendation` in the component if not already imported (it is already in the import line).

- [ ] **Step 4: Build check**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/web && npx ng build --configuration=development 2>&1 | tail -20
```

Expected: Build succeeds. Fix any TypeScript errors before continuing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/doctor/patients/patient-detail.component.ts
git commit -m "feat: clinical_correlation card — EXAMES SUGERIDOS and FATORES CONTEXTUAIS sections"
```

---

## Task 5: result-panel — add clinical_correlation sections

**Files:**
- Modify: `apps/web/src/app/features/doctor/results/result-panel.component.ts`

The result-panel is the full-page view at `/doctor/results/:examId`. It should also show the dedicated sections when viewing a clinical_correlation result.

- [ ] **Step 1: Read the file to understand current structure**

Read `apps/web/src/app/features/doctor/results/result-panel.component.ts` — specifically the `AGENT_LABELS` record and the recommendations rendering section.

- [ ] **Step 2: Add clinical_correlation to AGENT_LABELS**

Find `AGENT_LABELS` in result-panel.component.ts and add:
```ts
clinical_correlation: 'Correlação Clínica',
```

- [ ] **Step 3: Add filterRecs/filterOutRecs helpers and update recommendations rendering**

Apply the same `filterRecs` / `filterOutRecs` helper methods and template changes as in Task 4 Steps 2-3, but in `result-panel.component.ts`. The template structure may differ — adapt accordingly, preserving the existing styling of the result-panel.

- [ ] **Step 4: Build check**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/web && npx ng build --configuration=development 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/doctor/results/result-panel.component.ts
git commit -m "feat: clinical_correlation label and sections in result-panel"
```

---

## Self-Review Checklist

- Spec Part 5 (clinical_correlation agent): ✓ new agent file, language rules enforced in system prompt
- Phase 2 position: ✓ added to PHASE2_AGENTS after therapeutic and nutrition
- Output JSON fields (interpretation, suggested_exams, contextual_factors, alerts, risk_scores): ✓ all handled
- Legally safe language: ✓ SYSTEM_PROMPT lists allowed/forbidden phrases; forbidden list includes "indica", "diagnóstico de", stigmatizing names
- Storage: ✓ suggested_exams and contextual_factors serialized into recommendations JSONB column as typed entries (no new migration)
- UI: ✓ AGENT_LABELS extended, dedicated sections EXAMES SUGERIDOS and FATORES CONTEXTUAIS shown only for clinical_correlation agent_type
- Other agent cards unaffected: ✓ `@else` branch keeps existing recommendations rendering for non-correlation agents
- chief_complaint and current_symptoms: ✓ passed from job payload through phase2Ctx to the agent prompt
