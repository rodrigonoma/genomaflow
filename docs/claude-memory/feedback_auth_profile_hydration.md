---
name: AuthService — hidratar profile do localStorage para evitar flicker no F5
description: currentProfile$ começa null a cada bootstrap; sem cache localStorage o chip do tenant some no F5
type: feedback
---

`AuthService.currentProfile$` (nome do tenant, módulo) é um `BehaviorSubject` que inicializa em `null` toda vez que o app faz bootstrap. Depois do login, `fetchProfile()` (HTTP `GET /auth/me`) popula o subject com os dados. Mas depois de F5/Ctrl+Shift+R, o subject volta a `null` e a UI do topbar (`@if auth.currentProfile$ | async; as profile`) esconde o chip do tenant — e se o fetch falhar silenciosamente, o chip não volta nunca.

**Why:** reportado 2026-04-24. Usuário dizia "o nome do tenant some no F5". A raiz é o padrão "HTTP call no construtor do service + BehaviorSubject começando em null". Isso sempre causa flicker. Em condições de rede ruim ou erro 5xx silencioso, vira desaparecimento permanente até novo login.

**How to apply:**

1. **Persistir o profile em `localStorage`** sob uma chave dedicada (`profile`), sincronizada com o token:
   - Toda vez que `currentProfileSubject.next(profile)` for chamado no `next:` do fetch, também salvar: `localStorage.setItem('profile', JSON.stringify(profile))`.
   - `resetSession()` e o `catch` de token inválido devem limpar: `localStorage.removeItem('profile')`.

2. **Hidratar no construtor antes do fetch:**
   ```ts
   const cached = this.readCachedProfile();
   if (cached) this.currentProfileSubject.next(cached);
   if (payload.role !== 'master') this.fetchProfile();  // atualiza em background
   ```
   Isso faz o chip aparecer instantaneamente a partir do cache; o fetch apenas refresca.

3. **Padrão geral:** qualquer state do usuário crítico pra UI no topbar/chrome (nome, módulo, avatar, role textual) deve ser cacheado em `localStorage` e hidratado no bootstrap. HTTP call em background apenas refresca — nunca deve ser a única fonte da primeira renderização.

4. **Nunca** mostrar dado do JWT puro (ex: `tenant_id`) como substituto — usuário não reconhece UUID. Ou tem o nome cacheado, ou loga out antes do fetch responder.

**Arquivos relevantes:**
- `apps/web/src/app/core/auth/auth.service.ts`
- `apps/web/src/app/app.component.ts` (consumidor — topbar)

**Commit de referência:**
- `86e833ce` (2026-04-24) — persistência do profile em localStorage
