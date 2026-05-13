---
name: CI Deploy Pipeline — path-based + parallel jobs + Docker cache
description: Pipeline `.github/workflows/deploy.yml` otimizado em 2026-05-12. Path filter (dorny/paths-filter) + jobs paralelos por componente (api/worker/web) + Docker layer cache via GHA. Reduz deploy de ~12min → 3-6min no caso médio.
type: feedback
---

# CI Deploy Pipeline — arquitetura path-based

## Antes vs Depois

| Cenário | Antes (monolítico) | Depois (path-based) | Saving |
|---------|-------------------|---------------------|--------|
| Fix CSS no Angular | ~12min | ~4min (só web) | -67% |
| Fix lógica API | ~12min | ~5min (api + integration) | -58% |
| Migration nova | ~12min | ~6min (api + migrate + integration) | -50% |
| Doc/CLAUDE.md only | ~12min | ~1min (só reindex Copilot) | -92% |
| Worker job | ~12min | ~4min (só worker) | -67% |
| Full mudança (raro) | ~12min | ~6min (3 deploy jobs paralelos) | -50% |

Path filter via [`dorny/paths-filter@v3`](https://github.com/dorny/paths-filter) detecta o que mudou no push e expõe outputs consumidos pelos jobs via `if: needs.changes.outputs.X == 'true'`.

## Estrutura do workflow

```
push main
  ↓
[changes] (paths-filter detecta caminhos)
  ↓
┌─────────────────┬─────────────────┬─────────────────┐
[test-api]        [test-worker]     [test-web]
   if api           if worker         if web
   ↓                  ↓                 ↓
[integration]                  [test-web inclui ng build prod]
   if api OR migrations
  ↓
┌──────────────┬──────────────┬──────────────┐
[deploy-api]   [deploy-worker] [deploy-web]   [reindex-docs-only]
   needs:         needs:          needs:          if docs only
   test-api +     test-worker     test-web        (push sem code)
   integration
```

Jobs `deploy-*` rodam **em paralelo** (independentes). Antes era monolítico em 1 job sequencial.

## Detecção de paths

```yaml
filters: |
  api:        'apps/api/**'
  worker:     'apps/worker/**'
  web:        ['apps/web/**', 'apps/landing/**']
  migrations: 'apps/api/src/db/migrations/**'
  docs:       ['docs/**', 'CLAUDE.md', 'apps/worker/src/rag/**']
  infra:      'infra/**'
  workflow:   '.github/workflows/**'
```

- `migrations` é subset de `api` — quando muda, dispara migrate ECS task após deploy-api
- `docs` dispara reindex Copilot RAG (parte do deploy-worker se também mudou worker; senão job dedicado `reindex-docs-only`)
- `workflow` força tudo (mudança no CI exige revalidação completa)

## Docker layer cache

Cada job de build usa `docker/build-push-action@v5` com:

```yaml
cache-from: type=gha,scope=<api|worker|web>
cache-to: type=gha,mode=max,scope=<api|worker|web>
```

**GHA cache** = GitHub Actions cache (10GB free per repo). Scoped por componente para evitar invalidação cruzada.

Resultado típico:
- Cold build (1ª vez): igual ao antigo
- Warm build (npm install não mudou): 1-2min vs 3-4min

## Condicionais críticas

### `if: always() && (... == 'true' || ... == 'skipped')`

Necessário para deploy jobs porque `needs:` com job skipped (path-filter pulou test-api) causa o deploy job também ser skipped por default. Pattern correto:

```yaml
needs: [changes, test-api, integration]
if: |
  always() &&
  (needs.changes.outputs.api == 'true' || ...) &&
  (needs.test-api.result == 'success' || needs.test-api.result == 'skipped') &&
  (needs.integration.result == 'success' || needs.integration.result == 'skipped')
```

`always()` desativa o short-circuit por default. `result == 'skipped'` aceita o caso path-filter ter pulado, mas mantém bloqueio se o test falhou de verdade.

### docs-only push

Job dedicado `reindex-docs-only` roda quando docs/ mudou MAS nenhum código de api/worker/web/migrations. Sem build/push de container. ~30s no total.

## Backward compat

Workflow mantém:
- Concurrency cap (`group: deploy-production, cancel-in-progress: true`)
- ECS update via register-task-definition + update-service (não `force-new-deployment`)
- Migrations via ECS run-task (one-shot task)
- Reindex Copilot via ECS run-task
- Wait services stable (agora por job — cada deploy-* espera seu próprio service)

## Cuidados / edge cases

1. **`workflow: '.github/workflows/**'`** — mudança no próprio CI dispara TODOS os jobs (test + deploy de tudo) como salvaguarda contra workflow bug.
2. **`changes` precede tudo** — qualquer job que use `needs.changes.outputs.*` precisa ter `changes` no `needs:`.
3. **Migrations** rodam dentro de `deploy-api` (não em job separado) pra garantir ordem: migration aplica antes do api container novo virar saudável. Se rodasse em paralelo, race condition.
4. **Reindex Copilot** acontece em 2 lugares: (a) `deploy-worker` se docs+worker mudaram juntos; (b) `reindex-docs-only` se SÓ docs mudaram. Nunca em ambos no mesmo push (mutuamente exclusivo via `if`).
5. **Doc-only push não passa por Camada 2** (integration tests). Correto — sem mudança de schema/route, não precisa.

## Como adicionar nova categoria de path

Exemplo: novo app `apps/mobile/`.

1. Adicionar ao filter:
   ```yaml
   mobile: 'apps/mobile/**'
   ```
2. Criar job `test-mobile` condicional `if: needs.changes.outputs.mobile == 'true'`
3. Criar job `deploy-mobile` (se aplicável; mobile geralmente é tag-triggered, não push to main)

## Métricas pós-otimização (a coletar)

Após 1 semana de uso, comparar:
- Tempo médio total de deploy
- % de pushes que skipam algum componente
- Frequência de full deploy (todos os 3 jobs)
- CI minutes mensais (impacto no billing)

## Não regredir

❌ Não voltar pra 1 job monolítico. Path filter elimina ~70% do desperdício.
❌ Não remover `always()` dos `if:` dos deploy jobs — quebra a lógica de skip.
❌ Não remover `cancel-in-progress: true` do concurrency. Já tivemos incidente (2026-05-12) com 20 runs travados.
❌ Não tornar `integration` opcional (continue-on-error). Camada 2 obrigatória é fundamental.

✅ Path filter rules são `glob patterns` do `paths-filter` action. Ver docs do action para sintaxe avançada (negation, multiline, etc.).
