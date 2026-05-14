---
name: WebSocket em Produção — URL com API_PREFIX obrigatório
description: ALB roteia só /api/*; WS sem prefixo cai no nginx do Angular e 404 silencioso; real-time nunca funciona
type: feedback
---

**WebSocket em prod DEVE incluir API_PREFIX (`/api`) no URL do cliente. Sem isso, a conexão cai no nginx do Angular (que não tem proxy WS) e retorna 404 silencioso — o retry backoff nunca estabelece e real-time nunca funciona.**

**Why:** 2026-04-24 descobrimos que o chat entre tenants (Phase 3+) nunca teve WebSocket funcionando em produção. `ws.service.ts` conectava em `wss://app.genomaflow.com.br/exams/subscribe` (sem prefix). A ALB de prod tem uma única regra `/api/*` → API target; o resto vai pro nginx do Angular. O nginx não tem location pra `/exams/subscribe` → 404. Em DEV funcionava porque `proxy.conf.json` tem rule explícita com `ws:true` que intercepta antes.

O fix 820a9dcd (review-queue-badge em tempo real) do passado tinha o mesmo bug latente — mas como existia polling fallback de 60s, ninguém percebeu que o WS nunca chegava.

Chat V1 foi testado em dev e passou. Em prod, usuário reportou "nada atualiza sozinho" após deploy. Só notou porque chat não tem fallback — cada sintoma ligado (convite, mensagem, badge, reaction) só atualizava com F5.

**How to apply:**
1. `WsService` e qualquer WebSocket do frontend: prepend `environment.apiUrl` em produção:
   ```ts
   const basePath = environment.production ? environment.apiUrl : '';
   const url = `${protocol}//${location.host}${basePath}/exams/subscribe?token=…`;
   ```
2. Emitir evento WS das rotas da API: publicar em canal Redis (`fastify.redis.publish('chat:event:' + tenantId, JSON.stringify(data))`), NUNCA chamar `fastify.notifyTenant()` direto — mantém forward-compat com multi-instância e segue o padrão do `exam:done`.
3. `pubsub.js` deve fazer `psubscribe` em todos os canais e re-broadcast via `notifyTenant` local.
4. Feature real-time exige **validação em prod**, não só dev. `proxy.conf.json` esconde esse bug.
5. Red flag: se badge/notificação real-time demora ~60s ou pede F5 → suspeitar de WS URL errado. Log do nginx do web mostraria 404 em `/exams/subscribe`.

**Arquivos relevantes:**
- `apps/web/src/app/core/ws/ws.service.ts`
- `apps/web/proxy.conf.json` (dev-only, espelha /exams/subscribe)
- `apps/api/src/plugins/pubsub.js` (psubscribe + notifyTenant local)
- `apps/api/src/routes/inter-tenant-chat/*.js` (padrão de publish via redis)

**Commits de referência:**
- Bug: Phase 3 do chat, commit `3a0b1549` (dez/2026) — WS chamava notifyTenant direto
- Fix parcial: `a3224d69` (abr/2026) — migração pra Redis pub/sub
- Fix do código: `5c979165` (abr/2026) — prepend API_PREFIX em prod
- Causa raiz do bug em prod: `7559b82e` (abr/2026) — fileReplacements no angular.json

**Retrospectiva 2026-04-24:** o fix `5c979165` sozinho **não bastava**. O `ws.service.ts` tinha `environment.production ? '/api' : ''`, mas em prod `environment.production` era `false` porque o `angular.json` estava sem `fileReplacements`. Logo o ternário caía em `''` e a URL continuava sem prefixo. Ver `feedback_angular_prod_build.md` pra mais detalhes.

Lição transversal: quando um fix "certo" não resolve em prod, auditar o bundle minificado antes de refazer deploy — `environment.production` pode estar mentindo.
