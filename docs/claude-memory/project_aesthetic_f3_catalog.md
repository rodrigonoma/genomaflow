---
name: F3 Aesthetic Catalog + Recomendação Rica
description: Catálogo curado de tratamentos estéticos (entregue 2026-05-11). 22 seeds + master CRUD + job mensal Opus de descoberta + recommender consome catálogo + treatment matching + master review queue + UI tenant cards ricos + UI master catalog/suggestions.
type: project
---

# F3 — Catálogo + Recomendação Rica (entregue 2026-05-11)

Adiciona catálogo curado de tratamentos sobre F1/F2. Recomendações deixam de ser texto livre da IA e passam a referenciar `treatment_id` do catálogo. Master gerencia catálogo global; admins de clínica criam tratamentos proprietários.

## Migrations entregues

| Migration | Conteúdo |
|---|---|
| `091_aesthetic_treatments.sql` | Catálogo. `tenant_id NULL` = global GenomaFlow, `tenant_id` setado = proprietário do tenant. RLS NULLIF, audit trigger. GIN em `indications`. |
| `092_aesthetic_treatment_suggestions.sql` | Fila de revisão admin-only (sem RLS). UNIQUE INDEX em `(source_run_id, LOWER(name))` pra idempotência cross-runs. |
| `093_aesthetic_treatments_seed.sql` | Seed de 22 tratamentos comuns BR 2026. Idempotente via `WHERE NOT EXISTS` por `LOWER(name)`. DISABLE/ENABLE TRIGGER de audit em volta do seed (rows globais não têm tenant). |
| `094_audit_trigger_null_tenant_fallback.sql` | Patch generalizado: `audit_trigger_fn` agora usa `MASTER_TENANT_ID` quando `NEW.tenant_id IS NULL`. Backward compat (rows tenant continuam audit normal). |

## Backend entregue

| Componente | Path | Função |
|---|---|---|
| Service | `apps/api/src/services/aesthetic-treatments.js` | `validate`, `list`, `getById`, `create`, `update`, `softDelete` + `VALID_CATEGORIES`/`VALID_EVIDENCE` whitelists |
| Tenant routes | `apps/api/src/routes/aesthetic-treatments.js` | GET/POST/PUT/DELETE `/aesthetic/treatments` (ACL admin/master) |
| Master routes (catálogo) | `apps/api/src/routes/master.js` | GET/POST/PUT/DELETE `/master/aesthetic-treatments` (rows globais com `tenant_id=NULL`, audit via `SET LOCAL app.tenant_id = MASTER_TENANT_ID`) |
| Master routes (suggestions) | `apps/api/src/routes/master.js` | GET `/master/treatment-suggestions`, GET `/master/treatment-suggestions/runs`, POST `:id/approve`/`:id/reject`/`:id/supersede` (approve com transação BEGIN/COMMIT atômica) |
| Worker recommender | `apps/worker/src/agents/aesthetic-recommender.js` | Aceita `availableTreatments`; injeta no prompt + post-call matching case-insensitive trim → seta `treatment_id`, `in_catalog`, sobrescreve `requires_medico` |
| Worker processor | `apps/worker/src/processors/aesthetic-analysis.js` | Fetcha catálogo antes do call (global+tenant, active, top 50 por usage_count_30d). Falha não-fatal (graceful empty array) |
| Worker discovery job | `apps/worker/src/jobs/aesthetic-treatment-discovery.js` | Roda dia 1 UTC integrado ao tick do scheduler. Skip via `TO_CHAR(generated_at, 'YYYY-MM')`. Opus 4.7, 90s timeout. Saneamento: whitelist categories/evidence, slice strings, clamp ints/numbers, cap 30 suggestions, `BAD_LLM_OUTPUT 502`. INSERT com `ON CONFLICT DO NOTHING` (UNIQUE em run_id+LOWER(name)) |

## Frontend entregue

| Componente | Path | Função |
|---|---|---|
| Service compartilhado | `services/aesthetic-master.service.ts` | `list/create/update/remove` (catálogo) + `listSuggestions/listRuns/approveSuggestion/rejectSuggestion/supersedeSuggestion` |
| Cards rica | `components/treatment-protocol-cards.component.ts` | Standalone OnPush + `input.required` + `output()`. Badges in_catalog/requires_medico/urgency, cost range pt-BR, botão "Agendar agora" (disabled se off-catalog) — emite `schedule` (F6 vai wire na agenda) |
| Master catálogo UI | `components/master/master-treatment-catalog.component.ts` | Tabela + filtros + modal de create/edit + soft delete confirm. Rota `/master/aesthetic-catalog` |
| Master suggestions UI | `components/master/master-treatment-suggestions.component.ts` | Tabs Fila/Histórico + modais Aprovar/Rejeitar/Vincular existente. Rota `/master/aesthetic-suggestions` |

Nav items "Catálogo Estética" + "Sugestões IA" adicionados ao sidebar do `master.component.ts`.

## Categorias do catálogo

`corpo_modelagem`, `corpo_flacidez`, `facial_rejuvenescimento`, `facial_pigmentacao`, `facial_acne`, `facial_preenchimento`, `facial_toxina`, `cabelo`, `procedimento_cirurgico`, `wellness_drenagem`, `outro`.

Seed cobre 8 categorias com 22 tratamentos (Criolipólise, HIFU, Microagulhamento, RF, Peelings, Toxina, AH, Bioestimuladores, PRP, etc.).

## Pipeline atualizado

```
[Esteticista] /aesthetic/analyses POST { analysis_type, subject_id, photo_ids[] }
       ↓ Pre-flight (consent + créditos + photos)
       ↓ Enqueue BullMQ
[Worker] processAestheticAnalysis
       ↓ pickAgent(analysis_type) → analyzeFacial OR analyzeBody (Sonnet Vision)
       ↓ fetch_catalog (NEW F3): SELECT top 50 do catálogo por usage_count_30d
       ↓ recommendProtocol({ ..., availableTreatments }) → Opus + post-call matching
       ↓ Persist + Redis publish
[Frontend] analysis-result → <app-treatment-protocol-cards>
       (emit schedule → F6 vai conectar com agenda)

[Worker tick mensal] shouldTickRun (dia 1 UTC)
       ↓ alreadyRanThisMonth? → skip
       ↓ Opus 4.7 lista 10-20 novos tratamentos (exclui catálogo atual)
       ↓ Saneamento defensivo + ON CONFLICT DO NOTHING
       ↓ aesthetic_treatment_suggestions status='pending_review'
[Master UI] /master/aesthetic-suggestions
       ↓ Aprovar → INSERT em aesthetic_treatments (BEGIN/COMMIT atomic)
       ↓ Rejeitar / Vincular existente
```

## Defensive sanitization (recommender + discovery)

- Match case-insensitive + trim (não normaliza acentos — exato match por enquanto)
- `requires_medico` do catálogo sobrescreve LLM (source of truth)
- `availableTreatments` opcional → comportamento legacy (in_catalog não setado)
- Discovery job whitelist enums, slice strings (name 120 / desc 500 / sources 200), clamp ints/numbers (sessions 1-20, days 1-365, cost 0-100k), cap 30 suggestions, `BAD_LLM_OUTPUT` 502
- Catálogo fetch dentro do processor com try/catch + warn → fallback array vazio (não quebra pipeline em dev sem migration)

## RLS recap

- `aesthetic_treatments` USING `tenant_id IS NULL OR NULLIF(app.tenant_id,'') IS NULL OR tenant_id = NULLIF(app.tenant_id,'')::uuid`
  - Permite ver global + próprio tenant
  - Master (sem app.tenant_id setado) vê tudo
- `aesthetic_treatment_suggestions` SEM RLS — acesso via `/master/*` route apenas (role=master)
- `audit_log` agora aceita `tenant_id NULL` via fallback no trigger → MASTER_TENANT sentinel

## Tests

- API: +24 (master-treatment-suggestions) +18 (master-aesthetic-treatments) +9 (tenant routes) = 51 novos. Total 675+ green, 0 regressão.
- Worker: +35 (discovery) +4 (recommender catalog) +1 (processor) = 40 novos. Total 98 green.
- Web: +6 (cards) +6 (master catalog) +6 (master suggestions) = 18 novos. Total 125 green, 3 skipped pre-existing.

## Multi-módulo zero quebra

- Todas as rotas e componentes sob `/aesthetic/*` ou `/master/aesthetic-*` ou `/master/treatment-suggestions*`
- Tab `Análise IA` no patient-detail (genérica desde F2) inalterada
- Catálogo é additive — `availableTreatments` ausente = legacy mode
- Migrations 091-094 não tocam tabelas pre-existentes (exceto trigger patch que é backward compat)

## Limitações honestas

- **Treatment matching exato** (LOWER + trim) — sem synonyms/normalização de acentos. Casos como "Botox" vs "Toxina Botulínica" não dão match (sair como `in_catalog: false`). F4+ pode adicionar synonyms table ou usar embeddings.
- **Discovery roda dia 1 UTC** — não respeita timezone BRT especificamente; tick acontece em qualquer hora do dia 1 UTC (~21:00 do dia anterior BRT em Maio). Aceitável.
- **Cost range** mostrado é do catálogo (estimativa pesquisa de mercado 2026), não preço real da clínica. F4+ pode permitir override por tenant.
- **Botão "Agendar agora"** apenas emite event — F6 vai wirar na agenda existente.

## Custos por análise

Pipeline F1/F2 inalterado: 5 créditos/análise (~$0.30-0.40). Catálogo fetch é DB-only (sem custo adicional). Discovery job mensal ~1 call Opus/mês (~$0.50).

## Próxima fase

**F4 — Nutrição + aesthetic_profile JSONB.** TMB calc, antropometria, perfil consolidado por paciente. Spec §17.
