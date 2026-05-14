---
name: F2 Aesthetic Body Analysis
description: Análise corporal IA estética (entregue 2026-05-11). 6 regiões corporais + Sonnet Vision corporal + processor routing + region picker + body photo guides + comparison antes/depois com overlay duplo. Multi-módulo preservado.
type: project
---

# F2 — Body Analysis (entregue 2026-05-11)

Estende F1 facial pra análise corporal. **Reutiliza 90% da infra F1**:
- Mesma queue BullMQ `aesthetic-analysis`
- Mesmas tabelas (`aesthetic_photos`, `aesthetic_analyses`, `aesthetic_consent`)
- Mesmo two-call pipeline (Sonnet Vision + Opus Recommender)
- Mesma cobrança via credit_ledger (5 créditos default)
- Mesmo IAM `aesthetic-photos/*` prefix
- Mesmo disclaimer regulatório

## Novos componentes (entregues)

| Componente | SHA | Função |
|---|---|---|
| `apps/worker/src/agents/aesthetic-body.js` | `0ef2f7a` | Sonnet Vision corporal com prompts específicos por região, BODY_REGIONS whitelist, NO_BODY_DETECTED flag |
| `apps/worker/src/processors/aesthetic-analysis.js` | `0da677c` | `pickAgent()` routes facial vs body baseado em analysis_type |
| `apps/web/.../region-picker.component.ts` | `b2dc7a4` | Grid 3×3 de 10 regiões anatômicas com flag sensitive |
| `apps/web/.../photo-quality-guide.component.ts` | `9686b29` | GUIDE_BY_REGION com protocolo + tips específicos por região |
| `apps/web/.../facial-analysis-tab.component.ts` | `7a5f44d` | State machine estendida com step `region_pick` antes de consent |
| `apps/web/.../patient-detail.component.ts` | `b5e54bb` | Tab label "Análise IA" (genérico facial+corporal) |
| `apps/web/.../comparison-view.component.ts` | `4580f66` | Fotos lado a lado + overlay duplo + toggle baseline overlay |

## 6 regiões corporais (29 métricas total)

- **legs**: culote_esquerdo, culote_direito, celulite_coxas, estrias_coxas, firmeza_coxas, flacidez_interna_coxa (6)
- **glutes**: firmeza_gluteos, celulite_gluteos, estrias_gluteos, projecao_glutea (4)
- **abdomen**: flacidez_abdominal, estrias_abdominais, manchas_abdominais, volume_aparente_abdomen, diastase_visivel (5)
- **arms**: flacidez_triceps, manchas_brazos, textura_brazos, celulite_brazos, firmeza_brazos (5)
- **breast**: ptose_mamaria, simetria_mamaria, volume_aparente, qualidade_pele_torax (4) — SENSITIVE
- **full_body**: proporcao_corporal, postura_visual, simetria_global, volume_aparente_global (4)

Total cobertura F1+F2: **40 métricas** (11 facial + 29 corporais).

## Pipeline (estendido)

```
[Esteticista] /aesthetic/analyses POST { analysis_type: 'legs', subject_id, photo_ids[] }
       ↓ Pre-flight (consent + créditos + photos own) — mesmo F1
       ↓ Enqueue BullMQ
[Worker] processAestheticAnalysis
       ↓ pickAgent(analysis_type)
       ↓ analysis_type === 'legs' → analyzeBody (Sonnet Vision corporal)  ← NOVO F2
       ↓ recommendProtocol (Opus, mesmo F1)
       ↓ Persist + Redis publish
[Frontend] WS → analysis-result + comparison-view com overlay duplo
```

## State machine UX expandida

```
idle → region_pick (NOVO F2 — escolhe entre 10 regiões)
     → consent_check (existing F1)
     → guide (com region-specific tips, NOVO F2)
     → upload (existing F1)
     → processing → result
     → list / compare
```

## Comparação visual antes/depois (F2.7)

Quando esteticista seleciona 2 análises pra comparar:
1. `comparison-view` busca ambas via `getAnalysis(id)` + `getPhotoUrl(first photo)` em paralelo
2. Renderiza 2 fotos lado a lado com overlays SVG
3. Toggle "Mostrar contorno do antes sobreposto" → `overlayMetrics()` computed combina baseline + current regions
4. Tabela de deltas matemáticos (sem chamada IA) já existia em F1

## Tests F2

- Worker: 6 (body agent) + 1 (processor routing) = 7 testes novos. Total worker 59.
- Web: 3 (region-picker) + 2 (body guides) + 2 (tab generic) + 1 (comparison toggle) = 8 testes novos. Total web 107.

Zero regressões em testes existentes ou outros módulos (human/veterinary).

## Multi-módulo zero quebra

- Tab condicional `@if (auth.currentProfile?.module === 'estetica')` preservada (apenas label mudou)
- Tabelas existentes não tocadas
- Worker queue mesma — apenas roteamento interno do processor
- Components facial continuam funcionando (region default = 'facial')

## Limitações honestas

- Medições absolutas (área em cm²) NÃO confiáveis via foto 2D — score 0-100 reflete severidade visual, não medição clínica
- Comparativo antes/depois é visual + delta de scores, não medição numérica precisa
- Regiões sensíveis (breast/abdomen/glutes) ainda usam consent operacional padrão — F5 cobrirá consent reforçado

## Custos

Mesmos da F1: 5 créditos/análise (~$0.30-0.40 API cost). Configurável via env var `AESTHETIC_FACIAL_COST` (TODO renomear pra `AESTHETIC_ANALYSIS_COST` ou criar separado pra corporal — defer F3+).

## Próxima fase

**F3 — Catálogo curado de tratamentos + recomendação rica + job descoberta mensal.** ~12 dias. Spec §16.
