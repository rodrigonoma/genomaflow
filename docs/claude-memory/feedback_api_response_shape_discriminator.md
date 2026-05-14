---
name: API response shape — discriminator pattern obrigatório
description: Quando uma rota retorna shapes diferentes conforme estado (ex: existe vs não existe), backend DEVE incluir um discriminator boolean. Frontend DEVE checar o discriminator, nunca usar truthy check do objeto inteiro. Incidente 2026-05-12 (consent → upload de fotos nunca disparava).
type: feedback
---

# API response shape — discriminator pattern obrigatório

## Regra

Quando uma rota REST retorna **shapes diferentes** conforme estado (entidade existe / não existe, ação OK / pendente, etc.):

1. **Backend**: SEMPRE incluir um campo discriminator boolean (`confirmed`, `found`, `success`, `complete`...) no payload, em TODAS as variações de shape.
2. **Frontend**: SEMPRE checar o discriminator antes de tratar como válido. Nunca usar `if (response)` (objeto sempre é truthy).
3. **TypeScript interface**: refletir TODAS as formas com union type OU campos opcionais + discriminator obrigatório.

## Por quê

`{ confirmed: false }` é um objeto JavaScript não-vazio → **truthy**. `response.revoked_at` em payload sem essa key → `undefined` → `!undefined === true`. Combinação dessas duas:

```js
if (response && !response.revoked_at) {
  // ENTRA AQUI mesmo com { confirmed: false } + nenhum dado
}
```

Resultado: state machine pula validação, fluxo segue com estado inconsistente, bug silencioso.

## Incidente 2026-05-12 — referência forense

**Bug:** esteticista clica em "Análise Estética IA" → escolhe região facial → seleciona 3 fotos → upload **nunca dispara**. Sem erro de rede, sem erro de console.

**Diagnóstico via CloudWatch:** `POST /aesthetic/photos` NUNCA chegou ao backend. As 3 fotos travaram no frontend.

**Causa raiz:**

```js
// apps/api/src/routes/aesthetic-consent.js
fastify.get('/consent/:subject_id', async (request, reply) => {
  const consent = await getConsent(...);
  if (!consent) return reply.send({ confirmed: false });   // ← shape A
  return reply.send({ confirmed: true, id, created_at, reinforced_regions });  // ← shape B
});
```

```ts
// apps/web/.../facial-analysis-tab.component.ts (PRE-FIX)
checkConsent(): void {
  this.svc.getConsent(this.subject().id).subscribe({
    next: (consent) => {
      if (consent && !consent.revoked_at) {  // ⚠️ { confirmed: false } passa
        this.step.set('guide');  // ← avança sem registrar consent
      } else {
        this._openConsentModal(...);
      }
    },
  });
}
```

Frontend pulava o registro de consent → state machine seguia para `guide` → upload nunca iniciava por race condition/estado inconsistente.

## Fix aplicado (commit `c69c261`)

```ts
// AestheticConsent interface — TODAS as shapes
export interface AestheticConsent {
  confirmed: boolean;            // ← discriminator OBRIGATÓRIO
  id?: string;                   // ← undefined quando confirmed=false
  created_at?: string;
  reinforced_regions?: string[] | null;
  revoked_at?: string | null;
  // ...
}

// checkConsent — discriminator pattern
const hasValidConsent = !!consent && consent.confirmed === true && !consent.revoked_at;
if (hasValidConsent) { ... } else { this._openConsentModal(...); }
```

## Padrões obrigatórios

### ✅ Backend correto

```js
// Opção 1: discriminator + payload condicional
if (!found) return reply.send({ found: false });
return reply.send({ found: true, id, ... });

// Opção 2: 404 quando ausente (mais semântico HTTP)
if (!found) return reply.status(404).send({ error: 'not_found' });
return reply.send({ id, ... });
```

### ✅ Frontend correto

```ts
// Discriminator pattern
if (response.confirmed === true) { /* uso seguro */ }

// OU type narrowing via union
type Response = { confirmed: true; id: string; } | { confirmed: false };
function process(r: Response) {
  if (r.confirmed) { console.log(r.id); }  // TS sabe que r tem id
}

// OU pelo erro HTTP
.subscribe({
  next: (entity) => { /* found */ },
  error: (err) => { if (err.status === 404) { /* not found */ } },
});
```

### ❌ Anti-patterns

```ts
// ❌ truthy check de objeto inteiro
if (response) { ... }

// ❌ checagem de campo específico que pode ser undefined em ambas as shapes
if (!response.revoked_at) { ... }

// ❌ TypeScript interface mentindo (campos não-opcionais que backend pode omitir)
interface Foo { id: string; }  // backend pode retornar { found: false } sem id
```

## Onde mais o problema pode aparecer no GenomaFlow

Endpoints com shape condicional (auditar quando mexer):

- `GET /aesthetic/consent/:subject_id` — ✅ fixed
- `GET /aesthetic/profile/:subject_id` — sempre retorna `{ profile, computed }`, profile pode ser `{}`. OK.
- `GET /master/treatment-suggestions/:id` — ?
- `GET /onboarding/status` — ?

Quando criar rota nova com possibilidade de "não existe" como estado válido, garantir discriminator + frontend usa pattern.

## Como detectar precocemente

1. **TypeScript interface estrita** — campos opcionais explícitos refletindo todas as shapes.
2. **Test source-inspection** — ler o handler do backend + grep por `reply.send` com objetos diferentes. Se houver >1 shape, deve ter discriminator.
3. **Camada 2 integration tests** — quando estabilizar, testa fluxo E2E (consent → upload → analysis) com Postgres real, pega quando state machine pula registros.

## Anti-pattern bonus: Backend retornando shape conforme NOT EXISTS

A escolha de retornar 200 + `{ confirmed: false }` em vez de 404 é defendível para o GET de consent porque consent ausente é estado válido (modal abre para registrar). MAS:

- Documentar o contrato explicitamente no comment do handler
- TypeScript do frontend DEVE refletir o `confirmed: false` shape
- Frontend DEVE usar discriminator, não truthy

Se o backend retornasse 404, o erro path do Observable cuidaria. Optou-se por 200 + flag para simplicidade do consumer — mas isso EXIGE o discriminator pattern do consumer pra funcionar.
