# Aesthetic V2 — Fase 2: Scores agregados + Heatmaps refinados

**Spec V2 original:** `genomaflow_estetica_v_2_spec_md.md` §9 (scores) + §5.3 (heatmaps).
**Pré-requisito:** Fase 1 entregue 2026-05-13 (`project_aesthetic_v2_fase1.md`).
**Escopo:** subset cirúrgico — 7 scores agregados + `Region.severity` opcional.

---

## 1. Objetivo

Dar ao esteticista uma camada de leitura de "alto nível" sobre análises existentes:
- **7 scores agregados** (textura/manchas/simetria/rugas/olheiras/acne/evolução geral) — não inventa dados, agrega métricas que já existem (Vision F1-F6 + Geometria V2-E)
- **Heatmaps granulares** com `severity` por região — overlay visual mais informativo (regiões mais opacas = mais graves)

Resultado pro usuário: PDF e tela de resultado ganham um "executive summary" no topo (7 scores) + overlays SVG mais expressivos. Esteticista vende melhor pro paciente.

---

## 2. Princípio do produto

- **Sem custo de IA extra.** Scores são agregação determinística no worker; severity adicional no prompt LLM sem call extra.
- **Sem mudança de UX disruptiva.** Adições aditivas no resultado existente (analysis-result.component).
- **Compatibilidade Fase 1 absoluta.** Análises sem severity continuam renderizando como hoje.

---

## 3. Decisões arquiteturais (travadas via brainstorming 2026-05-13)

| # | Decisão | Justificativa |
|---|---|---|
| F2-D1 | Worker calcula scores agregados, grava no JSONB `aesthetic_analyses.metrics` | Persistente — vai automático pro PDF, compare, export sem duplicar lógica |
| F2-D2 | `Region.severity?: number` (0-100, 100=grave) — campo aditivo opcional | Evita conflito semântico com MetricData.score (que é 100=ideal) |
| F2-D3 | Scores agregados rodam em **ambos os tiers** | Standard usa só Vision; Advanced enriquece com geometria. Custo marginal zero |
| F2-D4 | Score "evolução geral" só no `/compare` | É inerentemente comparativo; análise individual não tem baseline implícito |
| F2-D5 | Naming dos scores agregados com prefixo `aggregate_*` no JSONB | Evita confusão com métricas atômicas (rugas, simetria, etc) |
| F2-D6 | Pesos iniciais iguais (média simples); pesos configuráveis vêm em Fase 2.1 | YAGNI — sem dados pra calibrar pesos ainda |

---

## 4. Os 6 scores agregados (não-comparativos)

### 4.1 Mapeamento métrica → score

| Score agregado | Métricas Vision (sempre) | Métricas Geometria (advanced only) |
|---|---|---|
| `aggregate_skin_texture` | `textura`, `poros`, `uniformidade_tom` | — |
| `aggregate_spots` | `manchas`, `vermelhidao` | — |
| `aggregate_symmetry` | `simetria` | `symmetry_horizontal`, `head_tilt_roll`, `mandibular_angle_left`, `mandibular_angle_right` |
| `aggregate_wrinkles` | `rugas`, `firmeza`, `elasticidade` | — |
| `aggregate_dark_circles` | `olheiras` | — |
| `aggregate_acne` | `acne` | — |

### 4.2 Fórmula (worker, pós-merge Vision+landmarks)

```javascript
function computeAggregate(metricsByKey, contributorKeys) {
  const present = contributorKeys
    .map(k => metricsByKey[k])
    .filter(m => m && typeof m.score === 'number');
  if (present.length === 0) return null;

  const score = Math.round(
    present.reduce((s, m) => s + m.score, 0) / present.length
  );

  // Confiança agregada: high se todas high; low se qualquer low; senão medium
  const confs = present.map(m => m.confidence);
  let confidence = 'high';
  if (confs.includes('low')) confidence = 'low';
  else if (confs.includes('medium')) confidence = 'medium';

  return {
    score,
    confidence,
    regions: [],
    source: 'aggregate',     // novo source flag pra split UI
    contributors: present.length, // pra debug
  };
}
```

### 4.3 Shape no JSONB

```json
{
  "rugas": { "score": 70, "confidence": "high", "regions": [...] },
  "firmeza": { "score": 65, "confidence": "high", "regions": [] },
  "elasticidade": { "score": 60, "confidence": "medium", "regions": [] },

  "aggregate_wrinkles": {
    "score": 65,
    "confidence": "medium",
    "regions": [],
    "source": "aggregate",
    "contributors": 3
  }
}
```

`source: 'aggregate'` é o discriminador que o frontend usa pra renderizar em section própria (separada de Vision IA e Geometria).

---

## 5. Score "evolução geral" — só no `/compare`

Endpoint existente: `POST /aesthetic/analyses/:id/compare { baseline_id }`.

Retorno atual:
```json
{ "baseline_id": "...", "current_id": "...", "deltas": {...}, "overall_change": +5, "tier": "standard" }
```

**Estende com breakdown por categoria:**
```json
{
  "baseline_id": "...",
  "current_id": "...",
  "tier": "advanced",
  "deltas": {...},
  "overall_change": +5,
  "evolution_breakdown": {
    "skin_texture": +8,
    "spots": -2,
    "symmetry": +12,
    "wrinkles": +3,
    "dark_circles": 0,
    "acne": -1,
    "general": +5
  }
}
```

`evolution_breakdown[category]` = `current.aggregate_X.score - baseline.aggregate_X.score`. Sempre presente quando ambos os lados têm o aggregate. `general` é a média dos demais não-nulos.

---

## 6. `Region.severity` — heatmap granular

### 6.1 Tipo aditivo

```typescript
// apps/web/.../models/analysis.model.ts (estender Region union)
export interface RegionBbox {
  type: 'bbox';
  x: number; y: number; width: number; height: number;
  label?: string;
  severity?: number; // V2 Fase 2: 0-100, 100=grave (aditivo)
}
// idem RegionPolyline, RegionPolygon, RegionLine, RegionPoint
```

### 6.2 Worker — sanitizer + prompt

`apps/worker/src/agents/aesthetic-facial.js` `sanitizeRegion`:
```javascript
const out = { type: r.type };
if (typeof r.label === 'string') out.label = r.label.slice(0, MAX_LABEL);

// V2 Fase 2: severity opcional
if (typeof r.severity === 'number' && Number.isFinite(r.severity)) {
  out.severity = Math.max(0, Math.min(100, Math.round(r.severity)));
}
// ... resto do switch case
```

Prompt LLM estendido:
```
Para cada região, retorne:
- type, coordenadas
- label (opcional, até 100 chars)
- severity (opcional, 0-100): SEVERIDADE do problema NESTA região
  específica. 100 = problema severo localizado; 0 = praticamente sem
  manifestação na região (mas você está marcando porque é a área de
  referência anatômica). Use só quando puder julgar com confiança.
```

Backward compat: sem `severity`, frontend renderiza como hoje (opacity fixa 0.4).

### 6.3 Frontend — opacity proporcional

`photo-overlay.component.ts` template:
```typescript
@for (region of layer.regions; track $index) {
  <g [attr.opacity]="severityOpacity(region) ?? opacity()">
    ...
  </g>
}
```

```typescript
severityOpacity(region: Region): number | null {
  if (typeof region.severity !== 'number') return null;
  // Clamp 0.2..0.9 — sempre visível, mas modulação clara
  return Math.max(0.2, Math.min(0.9, region.severity / 100));
}
```

Sem `severity` → fallback pra opacity global do toolbar (UX atual).

---

## 7. Backend — mudanças

### 7.1 Worker `apps/worker/src/agents/aesthetic-aggregate-scores.js` (NOVO)

Modular, testável:
```javascript
const SCORE_MAP = { /* tabela §4.1 */ };

function computeAllAggregateScores(mergedMetrics) {
  const out = {};
  for (const [aggKey, contributors] of Object.entries(SCORE_MAP)) {
    const result = computeAggregate(mergedMetrics, contributors);
    if (result) out[aggKey] = result;
  }
  return out;
}

module.exports = { computeAllAggregateScores };
```

### 7.2 Processor `apps/worker/src/processors/aesthetic-analysis.js`

Após o `mergedMetrics = { ...vision, ...landmarks }`, adicionar:
```javascript
// V2 Fase 2: scores agregados — roda em qualquer tier, sobre mergedMetrics
const { computeAllAggregateScores } = require('../agents/aesthetic-aggregate-scores');
const aggregateScores = computeAllAggregateScores(mergedMetrics);
Object.assign(mergedMetrics, aggregateScores);
```

Persistência igual à F1 (já usa mergedMetrics no UPDATE).

### 7.3 Worker `aesthetic-facial.js` + `aesthetic-body.js` — sanitizer ganha severity

(Patch §6.2)

### 7.4 API `apps/api/src/routes/aesthetic-analyses.js` — /compare extras

`computeDeltas` em `services/aesthetic-analyses.js` ganha helper:
```javascript
function evolutionBreakdown(baselineMetrics, currentMetrics) {
  const categories = ['skin_texture','spots','symmetry','wrinkles','dark_circles','acne'];
  const breakdown = {};
  let sum = 0, count = 0;
  for (const cat of categories) {
    const key = `aggregate_${cat}`;
    const b = baselineMetrics?.[key]?.score;
    const c = currentMetrics?.[key]?.score;
    if (typeof b === 'number' && typeof c === 'number') {
      breakdown[cat] = c - b;
      sum += breakdown[cat]; count++;
    }
  }
  breakdown.general = count > 0 ? Math.round(sum / count) : 0;
  return breakdown;
}
```

Rota `/compare` retorna `evolution_breakdown` quando ambos têm aggregates.

---

## 8. Frontend — mudanças

### 8.1 `models/analysis.model.ts`

- `Region.severity?: number` aditivo (todos os tipos)
- `MetricData.source` whitelist estendida: `'anthropic_vision' | 'mediapipe' | 'aggregate'`
- `CompareResult.evolution_breakdown?: Record<string, number>` aditivo

### 8.2 `analysis-result.component.ts`

Nova section topo "Resumo da Análise" com os 6 scores agregados (cards verticais com barra grande):

```html
@if (aggregateScores().length > 0) {
  <section class="aggregate-summary" data-testid="aggregate-summary">
    <h4>Resumo da análise</h4>
    <div class="aggregate-grid">
      @for (s of aggregateScores(); track s[0]) {
        <div class="aggregate-card" [attr.data-key]="s[0]">
          <span class="aggregate-label">{{ humanLabel(s[0]) }}</span>
          <div class="aggregate-score-big">{{ s[1].score }}</div>
          <div class="aggregate-bar"><div [style.width.%]="s[1].score"></div></div>
        </div>
      }
    </div>
  </section>
}
```

Sections atuais (Vision IA + Geometria) ficam **abaixo** do resumo, sem mudança.

`metricsList` continua. Novo computed:
```typescript
readonly aggregateScores = computed<[string, MetricData][]>(() =>
  this.metricsList().filter(([, m]) => m.source === 'aggregate')
);
readonly visionMetrics = computed(() =>
  this.metricsList().filter(([, m]) => m.source !== 'mediapipe' && m.source !== 'aggregate')
);
readonly geometryMetrics = computed(() =>
  this.metricsList().filter(([, m]) => m.source === 'mediapipe')
);
```

### 8.3 `photo-overlay.component.ts`

`severityOpacity(region)` helper. Aplica em `<g>` por region — se severity definido, override do opacity global.

### 8.4 `comparison-view.component.ts`

Quando `compareResult.evolution_breakdown` presente, renderiza tabela `Resumo evolutivo por categoria` antes dos deltas individuais.

### 8.5 PDF export

`apps/api/src/services/aesthetic-pdf-export.js`: section "Resumo da Análise" topo (3 colunas × 2 linhas pros 6 scores). E na compare PDF (se existir essa rota futura), section "Evolução por categoria".

---

## 9. Sub-fases

| Sub-fase | Conteúdo | LOC estimado |
|---|---|---|
| **F2.1-A** | Worker `aesthetic-aggregate-scores` + integração no processor + tests | ~400 |
| **F2.1-B** | API `evolutionBreakdown` em /compare + tests | ~150 |
| **F2.1-C** | Worker sanitizer ganha `severity` + prompts LLM estendidos + tests | ~200 |
| **F2.1-D** | Frontend: aggregate-summary section + analysis-result split adicional | ~300 |
| **F2.1-E** | Frontend: photo-overlay severity opacity + comparison-view breakdown table | ~200 |
| **F2.1-F** | PDF export section "Resumo da Análise" | ~150 |

Total ~1400 LOC, ~40 testes novos.

---

## 10. Tests adicionados

- Worker: `aesthetic-aggregate-scores.test.js` — 6 scores × happy/missing-contributors/all-low-confidence
- Worker: `aesthetic-facial.test.js` (regression) — sanitizer aceita severity, descarta inválida
- API: `aesthetic-analyses.test.js` (regression) — /compare retorna evolution_breakdown
- Web: `analysis-result.component.spec.ts` — aggregate section renderiza, split atualizado
- Web: `photo-overlay.component.spec.ts` — severity afeta opacity, fallback funciona
- Web: `comparison-view.component.spec.ts` — breakdown table renderiza

---

## 11. Critérios de aceite

- [ ] Worker calcula 6 scores agregados em qualquer tier
- [ ] Standard: scores usam só Vision; Advanced: enriquece com geometria
- [ ] PDF e tela resultado mostram "Resumo da Análise" no topo
- [ ] Region.severity opcional aceito por sanitizer; opacity proporcional renderiza
- [ ] /compare retorna evolution_breakdown quando aggregates presentes
- [ ] Análises legacy F1-F6 sem aggregates renderizam sem section "Resumo"
- [ ] Multi-módulo: human/vet inalterados
- [ ] +40 testes verdes, deploy verde

---

## 12. Fora de escopo (Fase 2)

- Pesos configuráveis em scores agregados (Fase 2.1 quando tivermos dados)
- Recommender consumindo aggregates (atual usa só Vision direto — preservar)
- Visual comparison side-by-side com landmarks animados (Fase 3 ou 2.5)
- Timeline temporal de scores (Fase 4)
- Pseudo-3D (Fase 3 do spec V2 original)
