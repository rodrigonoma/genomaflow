---
name: WS pub/sub contract — adicionar novo canal exige 3 pontos
description: Worker publica em canal Redis que API precisa subscribe para propagar via WebSocket ao frontend. Adicionar novo canal exige publisher (worker) + psubscribe pattern (api) + handler (api). Esquecer 1 dos 3 = bug silencioso. Incidente 2026-05-12 (análise aesthetic completava no DB mas frontend nunca recebia notify).
type: feedback
---

# WS pub/sub contract — checklist obrigatório

## Arquitetura

```
[Worker]                              [API]                          [Frontend]
   │ runs BullMQ job                     │                              │
   │ completes work                      │                              │
   │                                     │                              │
   ├─ redis.publish(canal, msg) ────────►│ subscriber.psubscribe(pattern)
   │                                     │ subscriber.on('pmessage', ...)
   │                                     │ → handler extrai tenantId
   │                                     │ → fastify.notifyTenant(tenantId, payload)
   │                                     │   ws.send(payload) ──────────►│
   │                                     │                              │ ws.onmessage
   │                                     │                              │ → service.emit(event)
   │                                     │                              │ → component reage
```

**3 pontos obrigatórios** para uma notificação chegar ao usuário:

1. **Worker publica** em canal Redis (`redis.publish('namespace:event:{tenantId}', json)`)
2. **API subscribe pattern** no `apps/api/src/plugins/pubsub.js` (`subscriber.psubscribe('namespace:event:*', ...)`)
3. **API handler branch** no `subscriber.on('pmessage', ...)` que reconhece o canal, extrai tenantId, propaga via `notifyTenant`
4. **Frontend handler** no `apps/web/src/app/core/ws/ws.service.ts` que reconhece o `kind` e emite no service específico
5. **Frontend service + component** que escuta via Subject e reage

Esquecer **qualquer um dos 3 backend points** = bug silencioso (worker completa job, DB atualiza, mas frontend nunca sabe).

## Incidente 2026-05-12 — referência forense

**Bug:** análise estética finalizava no DB (status='done', métricas persistidas, créditos cobrados) mas frontend ficava com spinner eterno.

**Causa raiz:**

```js
// apps/worker/src/processors/aesthetic-analysis.js:164 ✓
publisher().publish(`aesthetic:event:${tenant_id}`, JSON.stringify({
  kind: 'analysis_done', analysis_id, subject_id,
}));

// apps/api/src/plugins/pubsub.js:42-47 — ❌ FALTAVA aesthetic:event:*
subscriber.psubscribe(
  'exam:done:*', 'exam:error:*',
  'billing:alert:*', 'billing:exhausted:*',
  'chat:event:*',
  'appointment:event:*',
  'subject:upserted:*',
  'video:event:*',
  // ❌ 'aesthetic:event:*' ausente
);
```

Worker fazia publish, mas API não tinha psubscribe nem handler. Frontend `ws.service.ts` esperava `kind: 'analysis_done'` que nunca chegava.

## Fix aplicado (commit `3e11f8a`)

```js
subscriber.psubscribe(
  ...existing,
  'aesthetic:event:*',  // NOVO
  ...
);

subscriber.on('pmessage', (_pattern, channel, message) => {
  ...
  } else if (channel.startsWith('aesthetic:event:')) {
    tenantId = channel.replace('aesthetic:event:', '');
    payload = JSON.parse(message);  // já contém kind=analysis_done
  }
  ...
});
```

## Checklist OBRIGATÓRIO para nova feature com notificação WS

Ao adicionar uma nova feature que precisa notificar o frontend em tempo real:

- [ ] **Worker publica**: `redis.publish('<namespace>:event:{tenant_id}', JSON.stringify({ kind, ...payload }))`
- [ ] **API psubscribe**: adicionar `'<namespace>:event:*'` ao array do `psubscribe()` em `apps/api/src/plugins/pubsub.js`
- [ ] **API handler**: adicionar branch `else if (channel.startsWith('<namespace>:event:'))` que extrai tenantId + propaga payload via `notifyTenant`
- [ ] **Frontend ws.service.ts**: adicionar branch que reconhece o `kind` e emite no service específico
- [ ] **Frontend service**: criar `XxxWsService` com `events$ = new Subject<...>()` e método `emit()`
- [ ] **Component**: subscribe em `events$`, filtra por subject/analysis_id atual, reage
- [ ] **Test source-inspection**: 2 testes que validam (a) `psubscribe` inclui o canal, (b) handler tem o branch

Modelo vivo: `apps/api/tests/plugins/pubsub-aesthetic.test.js` (criado no commit `3e11f8a`).

## Padrões adicionais

### Polling fallback recomendado

WS pode ter race conditions (websocket reconectando, página em background, etc.). Recomendado em features críticas: o frontend também faz polling do recurso a cada X segundos como fallback. Exemplo já implementado: `facial-analysis-tab.component.ts._startPollingFallback()`.

### Canal NAMESPACING

Convenção atual: `<feature>:<event>:<tenant_id>`. Exemplos:
- `exam:done:<tid>`, `exam:error:<tid>`
- `aesthetic:event:<tid>`
- `chat:event:<tid>`
- `appointment:event:<tid>`
- `video:event:<tid>`
- `subject:upserted:<tid>`

Manter pattern para que o psubscribe + handler permaneçam previsíveis.

### Payload deve ter `kind` discriminator

O frontend `ws.service.ts` faz branch por `kind`. O payload do publish DEVE incluir `kind: '<event-name>'`. Sem isso, o frontend cai no fallback `examUpdates$` (que historicamente era o único caso).

## Test pattern obrigatório

```js
// apps/api/tests/plugins/pubsub-<feature>.test.js
const fs = require('fs');
const SOURCE = fs.readFileSync(/* pubsub.js */);

describe('<feature> WS bridge', () => {
  test('psubscribe inclui <feature>:event:*', () => {
    expect(SOURCE).toMatch(/psubscribe\([\s\S]*?'<feature>:event:\*'/);
  });
  test('handler tem branch para <feature>:event:', () => {
    expect(SOURCE).toMatch(/channel\.startsWith\(['"]<feature>:event:['"]\)/);
  });
});
```

E adicionar ao `test:unit` glob em `apps/api/package.json`.

## Anti-pattern

❌ Worker publica + assume que "alguém" vai ouvir. **NÃO existe magia** — se API não tem psubscribe + handler, nada acontece.

❌ Frontend confia 100% no WS. Sempre ter polling fallback em features críticas.

❌ Canal com naming inconsistente. Mantenha `<namespace>:<event>:<tenant_id>`.
