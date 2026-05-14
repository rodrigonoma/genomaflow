---
name: pg.Pool fallback DB_HOST quando DATABASE_URL ausente
description: Task def ECS prod expõe DB_HOST/PORT/NAME/USER/PASSWORD como secrets individuais, NÃO DATABASE_URL. Worker code que usa só connectionString trava no localhost. Sempre fallback. Incidente 2026-05-14.
type: feedback
---

# pg.Pool precisa de fallback DB_HOST quando DATABASE_URL ausente

**Regra:** ao criar `pg.Pool` em qualquer worker ou serviço backend,
**SEMPRE** usar o pattern `poolConfig()` que aceita DATABASE_URL OU
DB_HOST/PORT/etc.

```js
function poolConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    };
  }
  return {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  };
}
const pool = new Pool(poolConfig());
```

**Why:** Task def ECS em prod expõe credenciais como **secrets
individuais** (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD), NÃO
como DATABASE_URL combinada. Código que faz só:
```js
new Pool({ connectionString: process.env.DATABASE_URL })
```
recebe `connectionString: undefined` → pg.Pool default = tenta
`localhost:5432` → `pool.connect()` trava indefinidamente (não joga
erro, fica esperando TCP).

**Sintoma:** worker loga "Job N event=triage" ou similar, e nunca
completa. Nenhum erro, sem log de progresso. Olha logs de scheduler/tick
e estão funcionando normal — só o pool.connect() trava silenciosamente.

**Modelo de referência:** `apps/api/src/plugins/postgres.js` já tem o
pattern correto. Worker code que cria pools próprios DEVE replicar
(scheduler.js, processors/*.js, video/transcription.js, jobs/*.js,
rag/*.js todos têm esse risco — ver Tech debt latente abaixo).

**Tech debt latente (Genomaflow worker):** estes arquivos têm `new Pool({ connectionString: process.env.DATABASE_URL })` sem fallback:
- `apps/worker/src/processors/exam.js`
- `apps/worker/src/processors/aesthetic-analysis.js`
- `apps/worker/src/processors/aesthetic-depth.js`
- `apps/worker/src/notifications/scheduler.js` (throw early — pelo menos não trava silencioso)
- `apps/worker/src/video/transcription.js`
- `apps/worker/src/jobs/aesthetic-purge-sensitive.js`
- `apps/worker/src/rag/indexer.js` + `backfill.js` + `backfill-all.js`

Não corrigidos ainda porque (provavelmente) suas code paths ainda não
foram executadas com volume suficiente em prod pra detectar. Trello QA
foi o primeiro a queimar a mão. Quando uma dessas falhar em prod, vai
ser o mesmo sintoma.

## Não regredir

❌ Não criar `new Pool({ connectionString: process.env.DATABASE_URL })` sem fallback
❌ Não confiar que `DATABASE_URL` está no env só porque está nos testes locais (jest.setup.js define com fallback)

✅ Sempre `poolConfig()` ou helper compartilhado quando criar pool fora de `apps/api/src/plugins/postgres.js`
✅ Sempre testar conexão local + prod task def antes de declarar feature pronta
✅ Quando adicionar novo processor ao worker, copiar a função `poolConfig` de algum exemplo correto (ex: `apps/worker/src/processors/trello-qa.js`)
