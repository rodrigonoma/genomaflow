---
name: Aesthetic Region contract — worker output deve espelhar TS model
description: Bug 2026-05-12 — sanitizeRegion no worker gravou bbox.w/h, polyline tuplas e line from/to enquanto o frontend lia bbox.width/height, polyline {x,y} e line x1/y1/x2/y2. Marcadores SVG nunca renderizavam.
type: feedback
---

# Region contract — worker ↔ frontend

A análise estética facial e corporal grava `regions` por métrica no JSONB
`aesthetic_analyses.metrics`. O frontend renderiza essas regiões como overlay SVG
sobre as fotos via `app-photo-overlay`.

**Regra:** o shape de `Region` que sai do worker DEVE bater 1:1 o discriminated
union em `apps/web/src/app/features/aesthetic/models/analysis.model.ts`. Mismatch
não vira erro de runtime — vira `undefined * pixels` = `NaN` → SVG vazio → nenhum
marcador na tela.

## Bug original (2026-05-12)

| Tipo | Worker gravava | Frontend lia | Sintoma |
|------|----------------|--------------|---------|
| `bbox` | `{ x, y, w, h }` | `width`, `height` | `rect` com width/height NaN |
| `polyline` | `points: [[x,y],...]` | `points: [{x,y},...]` | `p.x` undefined → string "undefined,undefined" |
| `polygon` | idem polyline | idem polyline | idem |
| `line` | `{ from: [x,y], to: [x,y] }` | `x1, y1, x2, y2` | `line` com coordenadas NaN |
| `point` | `{ x, y }` | `{ x, y }` | OK |

Todos os 4 tipos quebrados rendiam SVG, mas sem marcações visíveis. A análise
em si funcionava (`status='done'`, métricas salvas, scores corretos).

## Por que os testes não pegaram

Os testes do worker (`tests/agents/aesthetic-facial.test.js`) afirmavam:
- regiões eram filtradas/sanitizadas (count, type whitelist)
- score era clamp
- métricas fora do catálogo eram dropadas

**Nenhum teste afirmou o shape exato dos campos de saída.** O modelo TS no
frontend e o sanitizer no worker viviam em arquivos separados, sem ponte.

Solução: 3 regression tests em `tests/agents/aesthetic-facial.test.js`:
- `output shape: bbox usa width/height (NÃO w/h)`
- `output shape: polyline/polygon usa points como {x,y} (NÃO tuplas)`
- `output shape: line usa x1/y1/x2/y2 (NÃO from/to)`

## Padrão correto

`sanitizeRegion` em `apps/worker/src/agents/aesthetic-{facial,body}.js`:

- **Tolerante na entrada:** aceita `w/h` OU `width/height`; tuplas `[x,y]` OU
  objetos `{x,y}`; `from/to` OU `x1/y1/x2/y2`. LLM tende a variar — não
  desperdiçar uma análise (5 créditos + 30s) porque o modelo trocou a
  representação.
- **Strict na saída:** SEMPRE produz o shape do `Region` do frontend.
- **Prompt ensina o formato final:** reduz trabalho do sanitizer e melhora
  taxa de conformidade do LLM.

## Não regredir

❌ Não voltar a gravar `w/h`, tuplas, ou `from/to` — quebra overlay silenciosamente.
❌ Não duplicar `sanitizeRegion` em mais arquivos. Hoje vive em facial.js + body.js.
   Próxima feature deve consolidar em `services/aesthetic-region.js` compartilhado.
❌ Não remover os 3 regression tests — eles são a única defesa contra reincidência.

✅ Toda mudança no `Region` discriminated union do frontend exige atualizar o
   sanitizer do worker E os regression tests.
✅ Considerar gerar tipos compartilhados via shared package (proposta antiga,
   não priorizada).
