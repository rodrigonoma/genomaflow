---
name: Aesthetic V2 Fase 2 — Scores Agregados + Heatmap Severity
description: 6 scores agregados (textura/manchas/simetria/rugas/olheiras/acne) computados no worker + Region.severity opcional pra heatmap granular + /compare retorna evolution_breakdown. Entregue 2026-05-13.
type: project
---

# Aesthetic V2 Fase 2 — entregue 2026-05-13

Adições aditivas sobre V2 Fase 1 — sem mudança comportamental no fluxo existente, só camadas extras de leitura.

Spec: `docs/superpowers/specs/2026-05-13-aesthetic-v2-fase2-design.md`.
Branch: `feat/aesthetic-v2-fase2` (merged ff em main, deploy `25807713689` verde).

## Decisões F2-D1 a F2-D6

| # | Decisão |
|---|---|
| F2-D1 | Worker grava scores agregados no JSONB `aesthetic_analyses.metrics` (persistente, vai pro PDF/compare automático) |
| F2-D2 | `Region.severity?: number` (0-100, 100=grave) — campo aditivo opcional. Nomeação distinta de `MetricData.score` (que é 100=ideal) |
| F2-D3 | Scores agregados rodam em ambos os tiers (standard + advanced) |
| F2-D4 | Score "evolução geral" só no `/compare` como `evolution_breakdown` |
| F2-D5 | Prefixo `aggregate_*` no JSONB pra distinguir de métricas atômicas |
| F2-D6 | Pesos iguais no MVP — média simples (YAGNI, recalibrar depois) |

## Arquitetura

### Worker (`apps/worker`)

| Arquivo | Função |
|---|---|
| `agents/aesthetic-aggregate-scores.js` (NOVO) | `computeAllAggregateScores(mergedMetrics)` calcula 6 agregados por média simples. `source: 'aggregate'` discriminador. Contributoras ausentes não viram zero, só reduzem amostra |
| `agents/aesthetic-facial.js` | `sanitizeRegion` ganha severity opcional clamp 0..100 round |
| `agents/aesthetic-body.js` | idem |
| `processors/aesthetic-analysis.js` | Stage entre `merge` e `recommender`: `Object.assign(mergedMetrics, computeAllAggregateScores(mergedMetrics))`. Falha graciosa (warn, não bloqueia) |

### Mapeamento score → contributoras

| Score | Vision (sempre) | + Geometria (advanced) |
|---|---|---|
| `aggregate_skin_texture` | textura, poros, uniformidade_tom | — |
| `aggregate_spots` | manchas, vermelhidao | — |
| `aggregate_symmetry` | simetria | symmetry_horizontal, head_tilt_roll, mandibular_angle_L/R |
| `aggregate_wrinkles` | rugas, firmeza, elasticidade | — |
| `aggregate_dark_circles` | olheiras | — |
| `aggregate_acne` | acne | — |

Confidence agregada: pior caso (low se qualquer low; senão medium se mistura; senão high).

### API (`apps/api`)

| Arquivo | Função |
|---|---|
| `services/aesthetic-analyses.js` | Novo helper `evolutionBreakdown(baseline, current)` calcula delta por categoria + `general` (média) |
| `routes/aesthetic-analyses.js` | `/compare` retorna `evolution_breakdown: { skin_texture, spots, ..., general }` |
| `services/aesthetic-pdf-export.js` | Section "Resumo da Análise" topo (6 cards rotulados PT-BR, antes de Vision IA) |

### Frontend (`apps/web`)

| Arquivo | Função |
|---|---|
| `models/analysis.model.ts` | `Region.severity?: number` aditivo (RegionCommon). `MetricData.source: 'anthropic_vision' \| 'mediapipe' \| 'aggregate'`. `CompareResult.evolution_breakdown?` aditivo |
| `components/analysis-result.component.ts` | Section "Resumo da análise" topo (6 cards score grande + barra gradient cyan/lavanda + "Confiança baixa"). 3 computeds separados: visionMetrics/geometryMetrics/aggregateScores |
| `components/photo-overlay.component.ts` | `<g>` intermediário por region com opacity individual. `severityOpacity(region)` clamp 0.2..0.9; null → fallback opacity global |
| `components/comparison-view.component.ts` | Section "Evolução por categoria" com cards verde/vermelho/cinza. `evolutionEntries()` ordenado (general por último). Só renderiza com >1 entry |

## Shape JSONB pós-F2

```json
{
  "rugas": { "score": 70, "confidence": "high", "regions": [
    { "type": "bbox", "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2, "severity": 75 }
  ]},
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

## /compare response pós-F2

```json
{
  "baseline_id": "...",
  "current_id": "...",
  "tier": "advanced",
  "deltas": { /* todas as métricas com b+c presentes */ },
  "overall_change": +5,
  "evolution_breakdown": {
    "wrinkles": +12,
    "spots": +5,
    "general": 9
  }
}
```

Categorias sem aggregates compartilhados são omitidas. `general` = média dos deltas presentes; 0 se nenhuma compartilhada.

## Testes adicionados (~26)

- Worker: aggregate-scores (18), severity em sanitizeRegion (6)
- API: /compare evolution_breakdown (2 happy + fallback)
- Web: photo-overlay severity (2 testes + ajuste do antigo que olhava opacity no layer externo)

164 testes web verdes + 33 API analyses + 7 PDF + worker integral.

## Renderização UX

Tela de resultado pós-F2:
```
✨ Análise Avançada (se tier=advanced)
─────────────────────────────────────
📊 Resumo da análise
  [Textura 72] [Manchas 65] [Simetria 83]
  [Rugas 68]   [Olheiras 55] [Acne 80]
─────────────────────────────────────
🧪 Análise Visual (IA)
  rugas: 70  ████████░░
  textura: 70  ███████░░░
  ...
─────────────────────────────────────
🎯 Geometria (Análise Avançada)
  symmetry_horizontal: 88  ████████░░
  ...
```

Compare:
```
↑ Melhora geral: +5 pontos
─────────────────────────────────────
Evolução por categoria
  Textura  +8    Manchas  -2
  Simetria +12   Rugas    +3
  Geral    +5
─────────────────────────────────────
Métrica       | Δ
rugas         | +3
...
```

## Backward compat absoluta

- Análises legacy F1-F6 (sem `source` em metrics) → aggregates não existem → frontend não renderiza section "Resumo"
- Análises pré-F2-D sem severity → opacity global aplica como sempre
- Cliente sem CompareResult.evolution_breakdown → section "Evolução por categoria" omitida
- PDF sem aggregates → section "Resumo da Análise" omitida (early return)

## Próximas fases possíveis

- **F2.1+** (futuro): pesos calibrados por dados de uso real; A/B test de fórmulas; clinical validation
- **Fase 3** (spec V2): Pseudo-3D facial via depth estimation (Depth Anything / MiDaS) + Three.js viewer
- **Fase 4** (spec V2): relatório paciente HTML/PDF reformulado, timeline evolutiva com gráficos temporais

## Não regredir

❌ Não trocar `source: 'aggregate'` por outro discriminador (frontend separa por isso)
❌ Não normalizar contributoras ausentes pra 0 — semântica de "não avaliado"
❌ Não computar evolution_breakdown sem aggregates nos 2 lados (resultado seria fake)
❌ Não aplicar severity em opacity sem clamp [0.2, 0.9] — invisível ou 100% opaco quebra UX

✅ `aggregate_*` prefix sempre — outros aggregates futuros sigam o padrão
✅ Falha do agente aggregate-scores é warn, não rollback — análise basic deve sempre entregar
✅ Region.severity respeita backward compat (omitido quando ausente, não default 0)
