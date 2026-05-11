# Aesthetic F2 — Body Analysis + Visual Before/After Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender plataforma estética pra análise corporal (culote, abdômen, glúteos, silhueta completa) reutilizando infra F1, com comparação visual antes/depois (overlay duplo das regiões anotadas) e region picker no fluxo de criação de análise.

**Architecture:** Reutiliza 90% da F1 — schema, RLS, audit, queue, frontend overlay SVG, créditos. Adiciona: agente Opus Vision corporal (mesmo two-call pattern, prompt diferente), region picker UI, comparison enhanced com baseline outline overlay. Refator o orchestrator `facial-analysis-tab` pra ser genérico `analysis-tab` aceitando region.

**Tech Stack:** Idêntica F1 — Fastify, Postgres + RLS, BullMQ, Sonnet Vision + Opus, Angular 18 signals, SVG inline.

**Spec de referência:** `docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md` §16 (F2: Corporal estrutural).

**Estimativa:** ~10 dias úteis em 8 tarefas.

**O que F2 NÃO faz** (defere pra F3+):
- Catálogo curado de tratamentos com `aesthetic_treatments` table — F3
- Recomendações nutricionais com TMB calc + `aesthetic_profile` JSONB — F4
- Regiões sensíveis (mama, glúteos, abdômen) com consent reforçado + auto-crop blur — F5

F2 entrega body analysis com mesma profundidade que F1 entregou facial.

**Princípios de execução:**
- Reutilizar infraestrutura F1 (mesma queue, mesmo processor framework, mesmas tabelas)
- TDD em backend e worker
- Multi-módulo preservation absoluta (`module === 'estetica'`)
- Frontend genérico — não criar duplicação de componentes facial vs body

---

## Task 1: Worker agent `aesthetic-body` (Sonnet Vision Call #1)

**Files:**
- Create: `apps/worker/src/agents/aesthetic-body.js`
- Test: `apps/worker/tests/agents/aesthetic-body.test.js`

**Pre-requisito:** F1 completo, especially `apps/worker/src/agents/aesthetic-facial.js` (template) e `apps/worker/src/config/aesthetic-metrics.js` (REGION_METRICS).

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull origin main
git checkout -b feat/aesthetic-f2-task-01-body-agent
```

- [ ] **Step 2: Write test file**

`apps/worker/tests/agents/aesthetic-body.test.js`:

```js
'use strict';

const { describe, test, expect } = require('@jest/globals');

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic { constructor() {} messages = { create: mockCreate }; },
}));

const { analyzeBody, sanitizeBodyMetrics } = require('../../src/agents/aesthetic-body');

describe('analyzeBody', () => {
  test('happy path retorna metrics corporais + observations', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({
        metrics: {
          culote_esquerdo: { score: 65, confidence: 'medium', regions: [{ type: 'polygon', points: [[0.3,0.5],[0.35,0.5],[0.35,0.6],[0.3,0.6]] }] },
          culote_direito: { score: 60, confidence: 'medium', regions: [] },
        },
        observations: { qualitative: 'presença moderada de culote em ambas as faces laterais' }
      })}],
      usage: { input_tokens: 1200, output_tokens: 800 },
    });
    const result = await analyzeBody({
      photoBuffers: [Buffer.from('fake')],
      subject: { age_years: 35, sex: 'F' },
      analysisType: 'legs',
    });
    expect(result.metrics.culote_esquerdo.score).toBe(65);
    expect(result.tokens_input).toBe(1200);
  });

  test('rejeita métricas fora do catálogo da região', () => {
    const dirty = {
      culote_esquerdo: { score: 50, regions: [] },
      rugas: { score: 70, regions: [] }, // não é legs
    };
    const clean = sanitizeBodyMetrics(dirty, 'legs');
    expect(clean.culote_esquerdo).toBeDefined();
    expect(clean.rugas).toBeUndefined();
  });

  test('clamp score 0-100', () => {
    const dirty = {
      culote_esquerdo: { score: 150, regions: [] },
      celulite_coxas: { score: -10, regions: [] },
    };
    const clean = sanitizeBodyMetrics(dirty, 'legs');
    expect(clean.culote_esquerdo.score).toBe(100);
    expect(clean.celulite_coxas.score).toBe(0);
  });

  test('region polygon points sliced to MAX_POINTS=50', () => {
    const longPoints = Array(80).fill([0.5, 0.5]);
    const dirty = {
      culote_esquerdo: { score: 50, regions: [{ type: 'polygon', points: longPoints }] },
    };
    const clean = sanitizeBodyMetrics(dirty, 'legs');
    expect(clean.culote_esquerdo.regions[0].points.length).toBeLessThanOrEqual(50);
  });

  test('NO_BODY_DETECTED quando IA flag', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({ no_body_detected: true, reason: 'imagem não mostra corpo' }) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await expect(analyzeBody({
      photoBuffers: [Buffer.from('fake')],
      subject: { age_years: 30, sex: 'F' },
      analysisType: 'abdomen',
    })).rejects.toMatchObject({ code: 'NO_BODY_DETECTED' });
  });

  test('BAD_LLM_OUTPUT em JSON inválido', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: 'lorem ipsum' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await expect(analyzeBody({
      photoBuffers: [Buffer.from('fake')],
      subject: { age_years: 30, sex: 'F' },
      analysisType: 'legs',
    })).rejects.toMatchObject({ code: 'BAD_LLM_OUTPUT' });
  });
});
```

- [ ] **Step 3: Run test (deve falhar)**

```bash
cd apps/worker && npm test -- tests/agents/aesthetic-body.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement agent**

`apps/worker/src/agents/aesthetic-body.js`:

```js
'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const MODELS = require('../config/models');
const { metricsForRegion } = require('../config/aesthetic-metrics');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });

const VALID_REGION_TYPES = new Set(['bbox', 'polyline', 'polygon', 'line', 'point']);
const MAX_REGIONS_PER_METRIC = 20;
const MAX_POINTS_PER_REGION = 50;
const MAX_LABEL_LENGTH = 100;

const BODY_REGIONS = new Set(['legs', 'glutes', 'abdomen', 'arms', 'breast', 'full_body']);

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(1, x));
}

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function sanitizeRegion(r) {
  if (!r || !VALID_REGION_TYPES.has(r.type)) return null;
  const out = { type: r.type };
  if (typeof r.label === 'string') out.label = r.label.slice(0, MAX_LABEL_LENGTH);
  switch (r.type) {
    case 'bbox': {
      const x = clamp01(r.x), y = clamp01(r.y), w = clamp01(r.w), h = clamp01(r.h);
      if ([x,y,w,h].some(v => v === null)) return null;
      return { ...out, x, y, w, h };
    }
    case 'polyline':
    case 'polygon': {
      if (!Array.isArray(r.points)) return null;
      const points = r.points.slice(0, MAX_POINTS_PER_REGION)
        .map(p => Array.isArray(p) && p.length === 2 ? [clamp01(p[0]), clamp01(p[1])] : null)
        .filter(p => p !== null && p[0] !== null && p[1] !== null);
      if (points.length < 2) return null;
      return { ...out, points };
    }
    case 'line': {
      if (!Array.isArray(r.from) || !Array.isArray(r.to)) return null;
      const from = [clamp01(r.from[0]), clamp01(r.from[1])];
      const to = [clamp01(r.to[0]), clamp01(r.to[1])];
      if (from.some(v => v === null) || to.some(v => v === null)) return null;
      return { ...out, from, to };
    }
    case 'point': {
      const x = clamp01(r.x), y = clamp01(r.y);
      if (x === null || y === null) return null;
      return { ...out, x, y };
    }
  }
  return null;
}

function sanitizeBodyMetrics(rawMetrics, analysisType) {
  const allowed = new Set(metricsForRegion(analysisType));
  const clean = {};
  for (const [key, value] of Object.entries(rawMetrics || {})) {
    if (!allowed.has(key)) continue;
    if (!value || typeof value !== 'object') continue;
    const regions = Array.isArray(value.regions)
      ? value.regions.slice(0, MAX_REGIONS_PER_METRIC).map(sanitizeRegion).filter(Boolean)
      : [];
    clean[key] = {
      score: clampScore(value.score),
      confidence: ['high', 'medium', 'low'].includes(value.confidence) ? value.confidence : 'medium',
      regions,
    };
  }
  return clean;
}

function buildPrompt(subject, analysisType) {
  const metrics = metricsForRegion(analysisType);
  const ageText = subject.age_years ? `${subject.age_years} anos` : 'idade não informada';
  const sexText = subject.sex === 'M' ? 'masculino' : (subject.sex === 'F' ? 'feminino' : 'sexo não informado');
  const regionDescriptions = {
    legs:     'Análise corporal de pernas/coxas: avalie culote (gordura lateral), celulite, estrias, flacidez interna da coxa.',
    glutes:   'Análise corporal de glúteos: firmeza, celulite, estrias, projeção.',
    abdomen:  'Análise abdominal: flacidez, estrias, manchas, volume aparente, diástase visível.',
    arms:     'Análise corporal de braços: flacidez tríceps, manchas, textura, celulite.',
    breast:   'Análise de tronco/mamas: ptose mamária, simetria, qualidade da pele.',
    full_body: 'Análise de silhueta completa: proporção corporal, postura, simetria global, volume aparente.',
  };
  const regionDesc = regionDescriptions[analysisType] || 'Análise corporal genérica.';

  return `Você é um assistente de análise estética CORPORAL. Analise a(s) foto(s) do paciente
(${ageText}, ${sexText}).

CONTEXTO: ${regionDesc}

Avalie as seguintes métricas (escala 0-100, onde 0 = problema severo, 100 = estado ideal):
${metrics.map(m => '- ' + m).join('\n')}

Para cada métrica, retorne:
- score (0-100)
- confidence: "high" | "medium" | "low" — use "low" pra estimativas de área que dependem de medição precisa 2D (culote, volume_aparente, projecao_glutea, etc.)
- regions: lista de áreas afetadas com coordenadas normalizadas 0-1.
  Use polygon pra áreas orgânicas (culote, abdomen flácido, celulite), bbox pra lesões discretas (estrias localizadas), point pra pontos de referência.
  Format: { "type": "polygon", "points": [[x,y],...], "label": "área culote esquerdo" }
- label opcional (até 100 chars).

IMPORTANTE — estimativas corporais 2D:
- Medições absolutas (área em cm²) NÃO são confiáveis via foto 2D — não inclua. Score 0-100 reflete severidade visual, não medida.
- Marque confidence="low" em métricas que dependem de proporção/profundidade.

Se NÃO identificar a região anatômica esperada na foto, retorne:
{"no_body_detected": true, "reason": "..."}

Se foto desfocada/com má iluminação:
{"image_too_blurry": true, "reason": "..."}

NÃO faça diagnóstico médico. NÃO sugira tratamentos (outro agente cuida).

Output: JSON estrito:
{
  "metrics": { "<metric_name>": { "score": ..., "confidence": "...", "regions": [...] }, ... },
  "observations": { "qualitative": "<2-3 linhas em PT-BR>" }
}`;
}

async function analyzeBody({ photoBuffers, subject, analysisType }) {
  if (!photoBuffers?.length) {
    throw Object.assign(new Error('No photos provided'), { code: 'NO_PHOTOS' });
  }
  if (!BODY_REGIONS.has(analysisType)) {
    throw Object.assign(new Error(`Region ${analysisType} not body type`), { code: 'INVALID_BODY_REGION' });
  }

  const imageContents = photoBuffers.map((buf) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') },
  }));

  let response;
  try {
    response = await client.messages.create({
      model: MODELS.VISION,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(subject, analysisType) },
          ...imageContents,
        ],
      }],
    });
  } catch (err) {
    throw Object.assign(new Error(`Anthropic call failed: ${err.message}`), { code: 'ANTHROPIC_FAIL', cause: err });
  }

  const rawText = response.content?.[0]?.text || '';
  let parsed;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : rawText);
  } catch {
    throw Object.assign(new Error('BAD_LLM_OUTPUT'), { code: 'BAD_LLM_OUTPUT', raw: rawText.slice(0, 500) });
  }

  if (parsed.no_body_detected) {
    throw Object.assign(new Error(parsed.reason || 'No body region detected'), { code: 'NO_BODY_DETECTED' });
  }
  if (parsed.image_too_blurry) {
    throw Object.assign(new Error(parsed.reason || 'Image too blurry'), { code: 'IMAGE_TOO_BLURRY' });
  }
  if (!parsed.metrics || typeof parsed.metrics !== 'object') {
    throw Object.assign(new Error('metrics ausente'), { code: 'BAD_LLM_OUTPUT' });
  }

  const cleanMetrics = sanitizeBodyMetrics(parsed.metrics, analysisType);
  const observations = parsed.observations && typeof parsed.observations === 'object'
    ? { qualitative: String(parsed.observations.qualitative || '').slice(0, 1500) }
    : {};

  return {
    metrics: cleanMetrics,
    observations,
    model: MODELS.VISION,
    tokens_input: response.usage?.input_tokens || 0,
    tokens_output: response.usage?.output_tokens || 0,
  };
}

module.exports = { analyzeBody, sanitizeBodyMetrics };
```

- [ ] **Step 5: Run tests (deve passar)**

```bash
cd apps/worker && npm test -- tests/agents/aesthetic-body.test.js
```

Expected: PASS (6 tests).

- [ ] **Step 6: Full worker suite — zero regressões**

```bash
cd apps/worker && npm test
```

Expected: ~53 tests passing (era 52 + 6 = ~58? wait, tests do agent só foram adicionados, então 58. Mas tests dos outros não mudam. ~58 total).

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/agents/aesthetic-body.js apps/worker/tests/agents/aesthetic-body.test.js
git commit -m "feat(aesthetic): agente Sonnet Vision análise corporal (F2.1)

Call #1 corporal mesmo two-call pattern do facial.
Prompt específico por região (legs/glutes/abdomen/arms/breast/full_body).
BODY_REGIONS whitelist + sanitização clamp 0-100 + region.type validation.
NO_BODY_DETECTED + IMAGE_TOO_BLURRY flags propagados como errors terminais.
Spec §16 F2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Worker processor — route facial vs body

**Files:**
- Modify: `apps/worker/src/processors/aesthetic-analysis.js` (já existe — adicionar routing)
- Modify: `apps/worker/tests/processors/aesthetic-analysis.test.js` (adicionar test pra body)

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull && git checkout -b feat/aesthetic-f2-task-02-processor-routing
```

- [ ] **Step 2: Modificar processor — selecionar agent baseado em analysis_type**

Em `apps/worker/src/processors/aesthetic-analysis.js`, ANTES da chamada Call #1, adicionar:

```js
const FACIAL_REGIONS = new Set(['facial', 'eyelids', 'neck']);
const BODY_REGIONS_PROC = new Set(['legs', 'glutes', 'abdomen', 'arms', 'breast', 'full_body']);

function pickAgent(analysisType) {
  if (FACIAL_REGIONS.has(analysisType)) return 'facial';
  if (BODY_REGIONS_PROC.has(analysisType)) return 'body';
  throw Object.assign(new Error(`Unsupported analysis_type: ${analysisType}`), { code: 'UNSUPPORTED_REGION' });
}
```

E na chamada Call #1, substituir:
```js
const visionResult = await analyzeFacial({ photoBuffers: buffers, subject, analysisType: analysis_type });
```
Por:
```js
const agentKind = pickAgent(analysis_type);
const visionResult = agentKind === 'body'
  ? await analyzeBody({ photoBuffers: buffers, subject, analysisType: analysis_type })
  : await analyzeFacial({ photoBuffers: buffers, subject, analysisType: analysis_type });
```

E adicionar `const { analyzeBody } = require('../agents/aesthetic-body');` ao topo (logo após `analyzeFacial` import).

Update TERMINAL_REFUND_CODES:
```js
const TERMINAL_REFUND_CODES = new Set(['NO_FACE_DETECTED', 'NO_BODY_DETECTED', 'IMAGE_TOO_BLURRY', 'BAD_LLM_OUTPUT', 'UNSUPPORTED_REGION']);
```

- [ ] **Step 3: Adicionar test pra body routing**

Em `apps/worker/tests/processors/aesthetic-analysis.test.js`, adicionar describe block:

```js
describe('processAestheticAnalysis — body region routing', () => {
  test('analysis_type=legs roteia pra analyzeBody (não analyzeFacial)', async () => {
    const { analyzeFacial } = require('../../src/agents/aesthetic-facial');
    const { analyzeBody } = require('../../src/agents/aesthetic-body');
    const { recommendProtocol } = require('../../src/agents/aesthetic-recommender');

    analyzeBody.mockResolvedValue({
      metrics: { culote_esquerdo: { score: 65, regions: [] } },
      observations: { qualitative: 'ok' },
      tokens_input: 1000, tokens_output: 500,
    });
    recommendProtocol.mockResolvedValue({
      recommendations: {},
      tokens_input: 500, tokens_output: 300,
    });

    const queries = [];
    const pool = {
      connect: jest.fn(async () => ({
        query: jest.fn(async (sql, params) => {
          queries.push({ sql, params });
          if (/SELECT .* FROM aesthetic_photos/i.test(sql)) {
            return { rows: params[0].map((id) => ({ id, s3_key: `path/${id}.jpg` })) };
          }
          if (/SELECT .* FROM subjects/i.test(sql)) {
            return { rows: [{ id: 'sub1', sex: 'F', birth_date: '1990-01-01' }] };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      })),
    };

    await processAestheticAnalysis({
      pool,
      data: { analysis_id: 'a1', tenant_id: 't1', subject_id: 'sub1', user_id: 'u1',
              analysis_type: 'legs', photo_ids: ['p1'], professional_type: 'medico' },
    });

    expect(analyzeBody).toHaveBeenCalled();
    expect(analyzeFacial).not.toHaveBeenCalled();
  });
});
```

E no topo do test file, adicionar:
```js
jest.mock('../../src/agents/aesthetic-body', () => ({
  analyzeBody: jest.fn(),
}));
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && npm test -- tests/processors/aesthetic-analysis.test.js
```

Expected: PASS (existing 2 + 1 new = 3 tests).

- [ ] **Step 5: Full worker suite**

```bash
cd apps/worker && npm test
```

Expected: zero regressões (~59 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/processors/aesthetic-analysis.js apps/worker/tests/processors/aesthetic-analysis.test.js
git commit -m "feat(aesthetic): processor route facial vs body (F2.2)

Adiciona pickAgent() baseado em analysis_type.
- FACIAL_REGIONS: facial, eyelids, neck
- BODY_REGIONS_PROC: legs, glutes, abdomen, arms, breast, full_body
TERMINAL_REFUND_CODES estendido com NO_BODY_DETECTED + UNSUPPORTED_REGION.
Test cobre roteamento legs → analyzeBody.
Spec §16 F2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Frontend `region-picker` component

**Files:**
- Create: `apps/web/src/app/features/aesthetic/components/region-picker.component.ts`
- Test: `apps/web/src/app/features/aesthetic/components/region-picker.component.spec.ts`

**Responsibility:** Grid 3×4 de cards (1 por região anatômica). Click emite `regionSelected: AnalysisType`.

- [ ] **Step 1: Branch + test**

```bash
git checkout main && git pull && git checkout -b feat/aesthetic-f2-task-03-region-picker
```

`apps/web/src/app/features/aesthetic/components/region-picker.component.spec.ts`:

```ts
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { RegionPickerComponent } from './region-picker.component';

describe('RegionPickerComponent', () => {
  let fixture: ComponentFixture<RegionPickerComponent>;
  let component: RegionPickerComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegionPickerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RegionPickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renderiza 10 region cards', () => {
    const el: HTMLElement = fixture.nativeElement;
    const cards = el.querySelectorAll('[data-testid="region-card"]');
    expect(cards.length).toBe(10);
  });

  it('click em card emite regionSelected com region key', () => {
    const emitted: string[] = [];
    component.regionSelected.subscribe((r) => emitted.push(r));
    const el: HTMLElement = fixture.nativeElement;
    const firstCard = el.querySelector('[data-testid="region-card"][data-region="facial"]') as HTMLElement;
    firstCard.click();
    expect(emitted).toEqual(['facial']);
  });

  it('cards renderizam label PT-BR', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Facial');
    expect(el.textContent).toContain('Coxas');
    expect(el.textContent).toContain('Glúteos');
  });
});
```

- [ ] **Step 2: Run (deve falhar)**

```bash
cd apps/web && npm test -- --testPathPattern='region-picker'
```

Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/web/src/app/features/aesthetic/components/region-picker.component.ts`:

```ts
import { Component, EventEmitter, Output, signal, ChangeDetectionStrategy } from '@angular/core';
import { AnalysisType } from '../models/analysis.model';

interface RegionCard {
  key: AnalysisType;
  label: string;
  iconEmoji: string;
  description: string;
  sensitive?: boolean;
}

const REGIONS: RegionCard[] = [
  { key: 'facial',     label: 'Facial',         iconEmoji: '👤', description: '11 métricas' },
  { key: 'eyelids',    label: 'Pálpebras',      iconEmoji: '👁️', description: '5 métricas' },
  { key: 'neck',       label: 'Pescoço',        iconEmoji: '🦴', description: '5 métricas' },
  { key: 'breast',     label: 'Mama / Tórax',   iconEmoji: '🔒', description: '4 métricas — região sensível', sensitive: true },
  { key: 'arms',       label: 'Braços',         iconEmoji: '💪', description: '5 métricas' },
  { key: 'abdomen',    label: 'Abdômen',        iconEmoji: '🤰', description: '5 métricas — região sensível', sensitive: true },
  { key: 'legs',       label: 'Coxas',          iconEmoji: '🦵', description: '6 métricas' },
  { key: 'glutes',     label: 'Glúteos',        iconEmoji: '🍑', description: '4 métricas — região sensível', sensitive: true },
  { key: 'full_body',  label: 'Silhueta completa', iconEmoji: '🚶', description: '4 métricas globais' },
  { key: 'other',      label: 'Outra',          iconEmoji: '➕', description: 'genérica' },
];

@Component({
  selector: 'app-region-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="region-picker">
      <h3>Selecione a região anatômica</h3>
      <div class="region-grid">
        @for (region of regions; track region.key) {
          <button class="region-card"
                  [class.sensitive]="region.sensitive"
                  [attr.data-testid]="'region-card'"
                  [attr.data-region]="region.key"
                  (click)="select(region.key)">
            <span class="emoji">{{ region.iconEmoji }}</span>
            <span class="label">{{ region.label }}</span>
            <span class="desc">{{ region.description }}</span>
          </button>
        }
      </div>
      <p class="note">Regiões marcadas como "sensível" exigem consentimento operacional reforçado (F5).</p>
    </div>
  `,
  styles: [`
    .region-picker { padding: 1.5rem; }
    .region-picker h3 { margin: 0 0 1rem; font-size: 1.25rem; }
    .region-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;
    }
    @media (max-width: 640px) { .region-grid { grid-template-columns: repeat(2, 1fr); } }
    .region-card {
      display: flex; flex-direction: column; align-items: center; padding: 1.5rem 1rem;
      background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.15);
      border-radius: 12px; cursor: pointer; color: inherit;
      transition: background .15s, border-color .15s;
    }
    .region-card:hover { background: rgba(168,85,247,.15); border-color: rgba(168,85,247,.5); }
    .region-card.sensitive { border-color: rgba(251,191,36,.4); }
    .emoji { font-size: 2rem; margin-bottom: .5rem; }
    .label { font-weight: 600; }
    .desc { font-size: .8rem; opacity: .7; margin-top: .25rem; text-align: center; }
    .note { margin-top: 1rem; font-size: .8rem; opacity: .6; }
  `],
})
export class RegionPickerComponent {
  readonly regions = REGIONS;
  @Output() regionSelected = new EventEmitter<AnalysisType>();

  select(region: AnalysisType) {
    this.regionSelected.emit(region);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/web && npm test -- --testPathPattern='region-picker'
```

Expected: PASS (3 tests).

- [ ] **Step 5: Full web suite zero regressões**

```bash
cd apps/web && npm test
```

Expected: ~99 + 3 = 102 tests passing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/aesthetic/components/region-picker.component.ts \
        apps/web/src/app/features/aesthetic/components/region-picker.component.spec.ts
git commit -m "feat(aesthetic): region-picker component (F2.3)

Grid 3×3 de 10 regiões anatômicas (facial + 8 corporais + other).
Cards com emoji + label PT-BR + métrica count + flag sensitive.
Click emite regionSelected: AnalysisType.
Spec §16 F2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Body photo guides — orientações por região

**Files:**
- Modify: `apps/web/src/app/features/aesthetic/components/photo-quality-guide.component.ts` (já existe — adicionar input region + orientações por região)
- Modify: `apps/web/src/app/features/aesthetic/components/photo-quality-guide.component.spec.ts`

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull && git checkout -b feat/aesthetic-f2-task-04-body-guides
```

- [ ] **Step 2: Extend component pra aceitar region prop + listar orientações específicas**

Em `photo-quality-guide.component.ts`, adicionar:

```ts
import { input } from '@angular/core';
import { AnalysisType } from '../models/analysis.model';

const GUIDE_BY_REGION: Record<AnalysisType, { protocol: string; tips: string[] }> = {
  facial:    { protocol: '1 foto frontal + opcional 2 laterais (perfil 45° e 90°)',
               tips: ['Rosto centralizado', 'Olhar diretamente pra câmera', 'Iluminação uniforme', 'Sem maquiagem pesada/óculos/franja'] },
  eyelids:   { protocol: 'Close-up frontal + close-up perfil',
               tips: ['Olhos abertos naturalmente', 'Sem máscara/sombra escura', 'Foco nas pálpebras'] },
  neck:      { protocol: 'Frontal de pescoço + perfil',
               tips: ['Cabeça em posição neutra', 'Sem gola alta', 'Iluminação lateral pra mostrar contornos'] },
  breast:    { protocol: 'Frontal de tronco descoberto + perfil',
               tips: ['Paciente em pé, braços ao lado', 'Sem soutien', '⚠️ Região sensível — consentimento reforçado obrigatório'] },
  arms:      { protocol: '2 fotos: braços relaxados + braços flexionados (ambos frontal)',
               tips: ['Braços abertos lateralmente', 'Sem pulseiras/relógios', 'Mostrar tríceps'] },
  abdomen:   { protocol: 'Frontal + 2 perfis (esquerdo/direito)',
               tips: ['Em pé, postura natural', 'Sem roupa coverindo abdômen', '⚠️ Região sensível'] },
  legs:      { protocol: 'Frontal de pernas + costas + 2 perfis',
               tips: ['Em pé, pernas levemente separadas', 'Roupa íntima neutra ou shorts curto', 'Pernas relaxadas'] },
  glutes:    { protocol: 'Foto de costas em pé',
               tips: ['Postura natural', 'Roupa íntima ou shorts justo', '⚠️ Região sensível'] },
  full_body: { protocol: 'Silhueta completa: frontal + costas + 2 perfis (4 fotos)',
               tips: ['Em pé, postura ereta', 'Braços ao lado', 'Roupa justa pra mostrar silhueta', 'Fundo neutro'] },
  other:     { protocol: 'Foto da região de interesse',
               tips: ['Foco na área específica', 'Iluminação clara'] },
};
```

E no template, substituir orientações hardcoded por:
```html
@if (region(); as r) {
  <h4>Protocolo de fotos para {{ regionLabel(r) }}</h4>
  <p class="protocol">{{ guideFor(r).protocol }}</p>
  <ul class="tips">
    @for (tip of guideFor(r).tips; track $index) {
      <li>{{ tip }}</li>
    }
  </ul>
}
```

Adicionar:
```ts
region = input<AnalysisType>('facial');
guideFor(r: AnalysisType) { return GUIDE_BY_REGION[r] || GUIDE_BY_REGION.facial; }
regionLabel(r: AnalysisType) {
  const labels: Record<AnalysisType, string> = {
    facial: 'Facial', eyelids: 'Pálpebras', neck: 'Pescoço', breast: 'Mama/Tórax',
    arms: 'Braços', abdomen: 'Abdômen', legs: 'Coxas', glutes: 'Glúteos',
    full_body: 'Silhueta completa', other: 'Região',
  };
  return labels[r];
}
```

Existing test deve continuar passando (region default = 'facial'). Adicionar test:

```ts
it('renderiza orientações específicas pra region=legs', () => {
  fixture.componentRef.setInput('region', 'legs');
  fixture.detectChanges();
  const text = (fixture.nativeElement as HTMLElement).textContent || '';
  expect(text).toContain('Coxas');
  expect(text).toContain('Roupa íntima');
});

it('renderiza ⚠️ pra região sensível (breast)', () => {
  fixture.componentRef.setInput('region', 'breast');
  fixture.detectChanges();
  const text = (fixture.nativeElement as HTMLElement).textContent || '';
  expect(text).toContain('⚠️');
  expect(text).toContain('consentimento');
});
```

- [ ] **Step 3-5: Run + commit pattern padrão (test fail → impl → pass)**

```bash
cd apps/web && npm test -- --testPathPattern='photo-quality-guide'
# Expected: PASS (existing 2 + 2 new = 4 tests)

git add apps/web/src/app/features/aesthetic/components/photo-quality-guide.component.ts \
        apps/web/src/app/features/aesthetic/components/photo-quality-guide.component.spec.ts
git commit -m "feat(aesthetic): body photo guides por região (F2.4)

photo-quality-guide.component ganha input region: AnalysisType.
GUIDE_BY_REGION lista protocolo + tips específicos pra cada uma das 10 regiões.
Sensitive regions (breast/abdomen/glutes) ganham ⚠️ + nota consent reforçado.
Spec §16 F2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Refator `facial-analysis-tab` → `analysis-tab` genérico

**Files:**
- Rename + refactor: `apps/web/src/app/features/aesthetic/components/facial-analysis-tab.component.ts` → mantém o nome (compat) mas adiciona suporte a region picker no fluxo
- Modify: spec test

**Pra evitar quebrar imports**, mantém o nome `FacialAnalysisTabComponent` mas refator interno pra suportar todas regiões.

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull && git checkout -b feat/aesthetic-f2-task-05-tab-generic
```

- [ ] **Step 2: Adicionar estado `region_pick` ao state machine**

Editar `facial-analysis-tab.component.ts`:

Type Step estende:
```ts
type Step = 'idle' | 'region_pick' | 'consent_check' | 'consent_ask' | 'guide' | 'upload' | 'processing' | 'result' | 'list' | 'compare';
```

Adicionar signal `selectedRegion = signal<AnalysisType>('facial');`

Em `startNewAnalysis()` (handler do botão "Nova análise"):
- Antes: ia direto pra `consent_check`
- Depois: vai pra `region_pick`

Adicionar handler:
```ts
onRegionSelected(region: AnalysisType) {
  this.selectedRegion.set(region);
  this.step.set('consent_check');
  this.checkConsent();
}
```

No template, adicionar case do state machine:
```html
@case ('region_pick') {
  <app-region-picker (regionSelected)="onRegionSelected($event)"></app-region-picker>
}
```

E na state 'guide', passar region:
```html
@case ('guide') {
  <app-photo-quality-guide [region]="selectedRegion()" (photosSelected)="onPhotosSelected($event)"></app-photo-quality-guide>
}
```

Na chamada `createAnalysis`, passar `analysis_type: selectedRegion()`:
```ts
this.svc.createAnalysis({
  analysis_type: this.selectedRegion(),  // antes: hardcoded 'facial'
  subject_id: this.subject().id,
  photo_ids: photoIds,
}).subscribe({...});
```

Importar `RegionPickerComponent` no `imports` do standalone component.

- [ ] **Step 3: Update test**

`facial-analysis-tab.component.spec.ts` — adicionar test:
```ts
it('Nova análise abre region_pick antes do consent_check', () => {
  // dispatch click "Nova análise"
  component.startNewAnalysis();
  expect(component.step()).toBe('region_pick');
});

it('region selection avança pra consent_check com analysis_type correto', () => {
  component.startNewAnalysis();
  component.onRegionSelected('legs');
  expect(component.selectedRegion()).toBe('legs');
  expect(component.step()).toBe('consent_check');
});
```

- [ ] **Step 4: Run tests + commit padrão**

```bash
cd apps/web && npm test -- --testPathPattern='facial-analysis-tab'
# Expected: existing 14 + 2 new = 16 tests passing
```

Commit msg: `feat(aesthetic): analysis-tab suporta seleção de região (F2.5)`.

---

## Task 6: Update patient-detail tab label

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts` — trocar label "Análise Facial IA" pra "Análise IA"

- [ ] **Step 1: Branch + Edit (1 linha)**

```bash
git checkout main && git pull && git checkout -b feat/aesthetic-f2-task-06-tab-label
```

Procurar no template a linha:
```html
<mat-tab label="Análise Facial IA" data-tab="aesthetic-facial">
```

Substituir por:
```html
<mat-tab label="Análise IA" data-tab="aesthetic">
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/features/doctor/patients/patient-detail.component.ts
git commit -m "feat(aesthetic): tab label genérico (F2.6)

Tab agora suporta facial + corporal — label removido qualificador 'Facial'.
data-tab='aesthetic' (era 'aesthetic-facial') pra refletir escopo expandido.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Enhanced `comparison-view` com overlay duplo

**Files:**
- Modify: `apps/web/src/app/features/aesthetic/components/comparison-view.component.ts` (já existe, melhorar visual)
- Test: spec já existe, adicionar 2 tests

**Adicionar:** quando comparison loaded, renderizar 2 fotos lado a lado:
- Esquerda: foto baseline com overlay das regions baseline (red/orange tint)
- Direita: foto atual com overlay das regions current (green tint)

Plus: botão "Mostrar contorno do antes sobreposto" — overlay duplo na foto atual.

- [ ] **Step 1: Branch + extend**

```bash
git checkout main && git pull && git checkout -b feat/aesthetic-f2-task-07-comparison-visual
```

Em `comparison-view.component.ts`, adicionar inputs/state:
```ts
// novos signals
baselineAnalysis = signal<AestheticAnalysisDetail | null>(null);
currentAnalysis = signal<AestheticAnalysisDetail | null>(null);
photoUrls = signal<Record<string, string>>({});
showBaselineOverlay = signal(true);
```

Quando seleciona baseline + current, fetcha detail completo de ambos via `svc.getAnalysis(id)` (já existe Task 13). Depois fetcha photoUrls dos photo_ids de ambos.

Template estendido:
```html
@if (baselineAnalysis() && currentAnalysis()) {
  <div class="comparison-photos">
    <div class="photo-side">
      <h4>Antes ({{ baselineAnalysis()?.created_at | date:'shortDate' }})</h4>
      <app-photo-overlay
        [photoUrl]="firstPhotoUrl(baselineAnalysis())"
        [metrics]="baselineAnalysis()?.metrics ?? {}"
        [activeLayers]="metricKeys(baselineAnalysis())"
        [opacity]="0.4" />
    </div>
    <div class="photo-side">
      <h4>Depois ({{ currentAnalysis()?.created_at | date:'shortDate' }})</h4>
      <app-photo-overlay
        [photoUrl]="firstPhotoUrl(currentAnalysis())"
        [metrics]="overlayMetrics()"
        [activeLayers]="metricKeys(currentAnalysis())"
        [opacity]="0.4" />
      <label>
        <input type="checkbox" [checked]="showBaselineOverlay()" (change)="toggleBaselineOverlay()" />
        Mostrar contorno do antes sobreposto
      </label>
    </div>
  </div>
}
```

Adicionar:
```ts
// se showBaselineOverlay, combina baseline regions (cor diferente) + current regions
overlayMetrics = computed(() => {
  const cur = this.currentAnalysis()?.metrics ?? {};
  if (!this.showBaselineOverlay()) return cur;
  const base = this.baselineAnalysis()?.metrics ?? {};
  // copia current + adiciona baseline regions com prefix _baseline_
  const merged: any = { ...cur };
  for (const [k, v] of Object.entries(base)) {
    merged[`${k}_baseline`] = v;
  }
  return merged;
});

firstPhotoUrl(a: AestheticAnalysisDetail | null) {
  if (!a || !a.photo_ids?.length) return '';
  return this.photoUrls()[a.photo_ids[0]] ?? '';
}
metricKeys(a: AestheticAnalysisDetail | null) {
  return a?.metrics ? Object.keys(a.metrics) : [];
}
toggleBaselineOverlay() { this.showBaselineOverlay.update(v => !v); }
```

CSS:
```css
.comparison-photos {
  display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.5rem;
}
@media (max-width: 768px) { .comparison-photos { grid-template-columns: 1fr; } }
.photo-side h4 { margin: 0 0 .5rem; opacity: .8; }
```

- [ ] **Step 2: Adicionar 1 test simples**

```ts
it('toggleBaselineOverlay alterna showBaselineOverlay signal', () => {
  expect(component.showBaselineOverlay()).toBe(true);
  component.toggleBaselineOverlay();
  expect(component.showBaselineOverlay()).toBe(false);
});
```

- [ ] **Step 3: Run + commit**

```bash
cd apps/web && npm test -- --testPathPattern='comparison-view'
# expected: existing 3 + 1 new = 4 tests

git add apps/web/src/app/features/aesthetic/components/comparison-view.component.ts \
        apps/web/src/app/features/aesthetic/components/comparison-view.component.spec.ts
git commit -m "feat(aesthetic): comparison-view com fotos lado a lado + overlay duplo (F2.7)

Quando baseline + current selected, renderiza 2 photos lado a lado com
overlays das regions. Botão toggle overlay do baseline sobre current photo
(antes/depois sobreposto pra visualização clara da diferença).
Spec §16 F2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Smoke + memory + landing update

**Files:**
- Create: `docs/claude-memory/project_aesthetic_f2_body.md`
- Modify: `docs/claude-memory/MEMORY.md`
- Modify: `apps/landing/index.html` (mention corporal)

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull && git checkout -b docs/aesthetic-f2-memory-landing
```

- [ ] **Step 2: Memory file**

`docs/claude-memory/project_aesthetic_f2_body.md`:

```markdown
---
name: F2 Aesthetic Body Analysis
description: Análise corporal IA estética (entregue 2026-MM-DD). 6 regiões corporais com Sonnet Vision + Opus recommender + comparação antes/depois com overlay duplo. Multi-módulo preservado.
type: project
---

# F2 — Body Analysis (entregue)

Estende F1 facial pra análise corporal. Reutiliza 90% da infra:
- Mesma queue BullMQ aesthetic-analysis
- Mesmas tabelas (aesthetic_photos, aesthetic_analyses, aesthetic_consent)
- Mesmo two-call pipeline (Sonnet Vision + Opus Recommender)
- Mesmo cobrança via credit_ledger

## Novos componentes

- `apps/worker/src/agents/aesthetic-body.js` — Vision agent corporal com prompts específicos por região
- `apps/worker/src/processors/aesthetic-analysis.js` — pickAgent() routes facial vs body baseado em analysis_type
- `apps/web/.../region-picker.component.ts` — Grid de 10 regiões anatômicas
- `apps/web/.../photo-quality-guide.component.ts` — Guides específicas por região
- `apps/web/.../comparison-view.component.ts` — Overlay duplo antes/depois

## 6 regiões corporais (29 métricas total)

- legs: culote_esquerdo, culote_direito, celulite_coxas, estrias_coxas, firmeza_coxas, flacidez_interna_coxa (6)
- glutes: firmeza_gluteos, celulite_gluteos, estrias_gluteos, projecao_glutea (4)
- abdomen: flacidez_abdominal, estrias_abdominais, manchas_abdominais, volume_aparente_abdomen, diastase_visivel (5)
- arms: flacidez_triceps, manchas_brazos, textura_brazos, celulite_brazos, firmeza_brazos (5)
- breast: ptose_mamaria, simetria_mamaria, volume_aparente, qualidade_pele_torax (4) — SENSITIVE
- full_body: proporcao_corporal, postura_visual, simetria_global, volume_aparente_global (4)

## Limitações honestas

- Medições absolutas (área em cm²) NÃO confiáveis via foto 2D. Score 0-100 reflete severidade visual.
- Comparativo antes/depois é visual + delta de scores, não medição clínica.
- Regiões sensíveis (breast, abdomen, glutes) ainda não têm consent reforçado (F5 cobre).

## SHAs principais

(preencher com commits após merge)
```

- [ ] **Step 3: MEMORY.md entry**

Append:
```
- [F2 Aesthetic Body Analysis](project_aesthetic_f2_body.md) — Análise corporal IA (entregue). 6 regiões (legs/glutes/abdomen/arms/breast/full_body) + comparação visual antes/depois + overlay duplo. Multi-módulo preservado.
```

- [ ] **Step 4: Landing update**

No `apps/landing/index.html`, na seção #modulo-estetica (criada em F1), atualizar texto: "análise facial e corporal por IA".

- [ ] **Step 5: Commit**

```bash
git add docs/claude-memory/project_aesthetic_f2_body.md \
        docs/claude-memory/MEMORY.md \
        apps/landing/index.html
git commit -m "docs(aesthetic-f2): memory + landing update (F2.8)

F2 entregue: análise corporal IA (6 regiões + 29 métricas).
Comparação antes/depois com overlay duplo.
Reutilizou 90% da infra F1.

Próxima fase: F3 (catálogo de tratamentos curado + recomendação rica).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (§16 F2):**
- ✅ Migration extensão (não necessária — F1 já tem analysis_type completo)
- ✅ Backend: validações body photos (Task 2 processor routing)
- ✅ Worker: agente corporal (Task 1)
- ✅ Frontend: region-picker (Task 3), body guides (Task 4), comparison-view enhanced (Task 7)
- ✅ Antes/depois com overlay duplo (Task 7)
- ✅ Tests, memory update (Task 8)

**Multi-módulo zero quebra:**
- Tab condicional `module === 'estetica'` preservado (não alterado)
- Tabelas existentes não tocadas
- Worker queue mesma — apenas roteamento interno do processor

**Type consistency:** `AnalysisType` union já tem todas 10 regiões (F1 Task 13). `Region` types consistente. `Metrics` shape inalterado.

**Reuso máximo:** F2 adiciona 1 worker agent + 1 frontend component novo (region-picker) + 1 melhoria comparison. Resto é routing/extension.

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-aesthetic-f2-body.md`.**

Two execution options:

**1. Subagent-Driven (recomendado)** — Eu despacho subagente por task, reviso entre tasks.

**2. Inline Execution** — Executo nesta sessão.

Qual?
