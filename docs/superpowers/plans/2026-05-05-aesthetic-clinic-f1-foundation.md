# Aesthetic Clinic F1 Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar suporte a tenant com `module='estetica'` ao GenomaFlow sem quebrar nada existente. Tenant esteticista pode usar agenda + prontuário + portal **reusando 100%** do que já existe. Esteticista (não-médico) é bloqueado de prescrever via middleware.

**Architecture:** Schema additive (extends enums, adds optional columns). Middleware `requireMedico` bloqueia rotas de prescription. Onboarding ganha 3º card. Frontend renderiza campos estéticos só em `module='estetica'`. Zero feature commercial nova nessa fase — só foundation. Detalhes em `docs/superpowers/specs/2026-05-05-aesthetic-clinic-module-design.md`.

**Tech Stack:** PostgreSQL 15 + Fastify 4 + Angular 18 standalone. Existing patterns: `withTenant` helper, RLS NULLIF, `fastify.authenticate` preHandler, signal-based Angular components.

---

## File Structure

**Backend (new files):**
- `apps/api/src/db/migrations/079_estetica_module_foundation.sql` — schema additive
- `apps/api/src/middleware/professional-gate.js` — `requireMedico` middleware
- `apps/api/tests/middleware/professional-gate.test.js` — unit tests do middleware
- `apps/api/tests/routes/prescriptions-medico-gate.test.js` — gate aplicado em prescription routes

**Backend (modified):**
- `apps/api/src/constants.js` — extender `VALID_MODULES`, adicionar `VALID_PROFESSIONAL_TYPES`
- `apps/api/src/routes/prescriptions.js` — aplicar `requireMedico` em POST/PUT/PATCH
- `apps/api/src/routes/auth.js` — `/register` aceita `professional_type`, `/me` retorna campo

**Frontend (modified):**
- `apps/web/src/app/shared/models/api.models.ts` — `UserProfile` ganha `professional_type`
- `apps/web/src/app/features/onboarding/onboarding.component.ts` — 3º card + sub-step
- `apps/web/src/app/app.component.ts` — sidebar label condicional
- `apps/web/src/app/features/doctor/patients/patient-detail.component.ts` — campos estéticos condicionais
- `apps/web/src/app/features/doctor/patients/patient-list.component.ts` — labels "Cliente" vs "Paciente"

---

### Task 1: Branch + setup

**Files:** N/A (git only)

- [ ] **Step 1: Confirmar repo limpo**

Run: `cd /home/rodrigonoma/GenomaFlow && git status && git branch --show-current`
Expected: branch `main`, working tree clean (untracked OK).

- [ ] **Step 2: Criar branch da fase**

Run: `git checkout -b feat/aesthetic-f1-foundation`
Expected: `Switched to a new branch 'feat/aesthetic-f1-foundation'`

---

### Task 2: Schema migration 079

**Files:**
- Create: `apps/api/src/db/migrations/079_estetica_module_foundation.sql`

- [ ] **Step 1: Criar arquivo da migration**

Conteúdo completo de `apps/api/src/db/migrations/079_estetica_module_foundation.sql`:

```sql
-- 079_estetica_module_foundation.sql
-- Phase F1: Foundation pra módulo de Estética.
-- Spec: docs/superpowers/specs/2026-05-05-aesthetic-clinic-module-design.md
--
-- Tudo additive. Zero break em human/veterinary:
-- - Estende CHECK de tenants.module pra incluir 'estetica'
-- - Adiciona users.professional_type com backfill 'medico' pros existentes
-- - Adiciona subjects.fitzpatrick_type, subjects.skin_concerns (NULL pra human/vet)
-- - Estende CHECK de appointments.appointment_type e clinical_encounters.encounter_type

-- ── tenants.module: estende enum ──────────────────────────────────────────
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_module_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_module_check
  CHECK (module IN ('human','veterinary','estetica'));

-- ── users.professional_type: gate de features (prescription só medico/dentista) ──
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS professional_type TEXT
  CHECK (professional_type IN ('medico','esteticista','dentista','biomedico','outro'));

-- Backfill: usuários existentes (human/vet) viram 'medico' (sem mudar comportamento)
UPDATE users SET professional_type = 'medico' WHERE professional_type IS NULL;

ALTER TABLE users
  ALTER COLUMN professional_type SET NOT NULL,
  ALTER COLUMN professional_type SET DEFAULT 'medico';

-- ── subjects: campos estéticos opcionais ──────────────────────────────────
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS fitzpatrick_type INTEGER
    CHECK (fitzpatrick_type BETWEEN 1 AND 6);
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS skin_concerns JSONB DEFAULT '[]'::jsonb;

-- ── appointments.appointment_type: estende enum ───────────────────────────
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_appointment_type_check;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_appointment_type_check
  CHECK (appointment_type IN (
    'consulta','retorno','exame','procedimento','telemedicina','banho_tosa',
    'avaliacao_estetica','procedimento_estetico','retorno_estetica',
    'outro'
  ));

-- ── clinical_encounters.encounter_type: estende enum ──────────────────────
ALTER TABLE clinical_encounters
  DROP CONSTRAINT IF EXISTS clinical_encounters_encounter_type_check;
ALTER TABLE clinical_encounters
  ADD CONSTRAINT clinical_encounters_encounter_type_check
  CHECK (encounter_type IN (
    'consulta','retorno','evolucao','procedimento','telemedicina',
    'avaliacao_estetica','pos_procedimento',
    'outro'
  ));
```

- [ ] **Step 2: Verificar que enums atuais estão completos**

Antes de aplicar, confirmar que CHECK existente nas tabelas inclui todos os valores que estão na migration. Run:

```bash
docker compose exec db psql -U postgres -d genomaflow -c "\d tenants" | grep -A1 module
docker compose exec db psql -U postgres -d genomaflow -c "\d appointments" | grep -A1 appointment_type
docker compose exec db psql -U postgres -d genomaflow -c "\d clinical_encounters" | grep -A1 encounter_type
```

Se algum valor existente NÃO estiver no CHECK novo da migration acima → adicionar antes de prosseguir. (CHECK constraint que rejeita valor existente faz a migration falhar.)

- [ ] **Step 3: Copiar migration pro container e aplicar local**

```bash
docker cp apps/api/src/db/migrations/079_estetica_module_foundation.sql genomaflow-api-1:/app/src/db/migrations/
docker compose exec api node src/db/migrate.js
```

Expected output: `[apply] 079_estetica_module_foundation.sql` + `Migrations complete.`

- [ ] **Step 4: Verificar schema atualizado**

```bash
docker compose exec db psql -U postgres -d genomaflow -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='tenants_module_check';"
docker compose exec db psql -U postgres -d genomaflow -c "\d users" | grep professional_type
docker compose exec db psql -U postgres -d genomaflow -c "\d subjects" | grep -E "fitzpatrick|skin_concerns"
```

Expected: módulo enum mostra `human, veterinary, estetica`. `professional_type text NOT NULL DEFAULT 'medico'`. `fitzpatrick_type integer`, `skin_concerns jsonb`.

- [ ] **Step 5: Backfill spot-check**

```bash
docker compose exec db psql -U postgres -d genomaflow -c "SELECT email, professional_type FROM users LIMIT 5;"
```

Expected: todos com `professional_type='medico'` (backfill funcionou).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/migrations/079_estetica_module_foundation.sql
git commit -m "feat(aesthetic-f1): migration 079 — module estetica + professional_type + skin fields"
```

---

### Task 3: Constants — VALID_MODULES + VALID_PROFESSIONAL_TYPES

**Files:**
- Modify: `apps/api/src/constants.js`
- Test: `apps/api/tests/services/constants.test.js`

- [ ] **Step 1: Atualizar constants**

Em `apps/api/src/constants.js`, substituir `const VALID_MODULES = ...` e adicionar nova constante:

```js
const VALID_MODULES = ['human', 'veterinary', 'estetica'];

const VALID_PROFESSIONAL_TYPES = ['medico', 'esteticista', 'dentista', 'biomedico', 'outro'];
```

E expor no `module.exports`:

```js
module.exports = {
  VALID_DOCTOR_SPECIALTIES,
  VALID_AGENT_TYPES,
  VALID_CREDIT_PACKAGES,
  PRICE_BY_PACK,
  VALID_PAYMENT_METHODS,
  VALID_MODULES,
  VALID_PROFESSIONAL_TYPES,
};
```

- [ ] **Step 2: Atualizar teste de constants**

Em `apps/api/tests/services/constants.test.js`, adicionar bloco descrevendo as novas constants. Conteúdo a adicionar (no fim do `describe` raíz):

```js
describe('VALID_MODULES', () => {
  it('inclui human, veterinary, estetica', () => {
    const { VALID_MODULES } = require('../../src/constants');
    expect(VALID_MODULES).toEqual(expect.arrayContaining(['human', 'veterinary', 'estetica']));
    expect(VALID_MODULES).toHaveLength(3);
  });
});

describe('VALID_PROFESSIONAL_TYPES', () => {
  it('inclui medico, esteticista, dentista, biomedico, outro', () => {
    const { VALID_PROFESSIONAL_TYPES } = require('../../src/constants');
    expect(VALID_PROFESSIONAL_TYPES).toEqual(['medico', 'esteticista', 'dentista', 'biomedico', 'outro']);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd /home/rodrigonoma/GenomaFlow/apps/api && npm test -- tests/services/constants.test.js`
Expected: PASS, todos os describes verdes.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/constants.js apps/api/tests/services/constants.test.js
git commit -m "feat(aesthetic-f1): VALID_MODULES inclui estetica + VALID_PROFESSIONAL_TYPES"
```

---

### Task 4: Middleware requireMedico (TDD)

**Files:**
- Create: `apps/api/src/middleware/professional-gate.js`
- Create: `apps/api/tests/middleware/professional-gate.test.js`

- [ ] **Step 1: Escrever teste falhando**

Conteúdo de `apps/api/tests/middleware/professional-gate.test.js`:

```js
const Fastify = require('fastify');
const { requireMedico } = require('../../src/middleware/professional-gate');

function buildApp(userOverride = {}) {
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { user_id: 'u1', tenant_id: 't1', role: 'admin', professional_type: 'medico', ...userOverride };
  });
  app.post('/test/prescribe', {
    preHandler: [app.authenticate, requireMedico],
  }, async () => ({ ok: true }));
  return app;
}

describe('requireMedico', () => {
  it('permite medico', async () => {
    const app = buildApp({ professional_type: 'medico' });
    const r = await app.inject({ method: 'POST', url: '/test/prescribe' });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
  });

  it('permite dentista', async () => {
    const app = buildApp({ professional_type: 'dentista' });
    const r = await app.inject({ method: 'POST', url: '/test/prescribe' });
    expect(r.statusCode).toBe(200);
  });

  it('bloqueia esteticista com 403', async () => {
    const app = buildApp({ professional_type: 'esteticista' });
    const r = await app.inject({ method: 'POST', url: '/test/prescribe' });
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).error).toMatch(/médico|dentista/i);
  });

  it('bloqueia biomedico com 403', async () => {
    const app = buildApp({ professional_type: 'biomedico' });
    const r = await app.inject({ method: 'POST', url: '/test/prescribe' });
    expect(r.statusCode).toBe(403);
  });

  it('bloqueia quando professional_type ausente', async () => {
    const app = buildApp({ professional_type: undefined });
    const r = await app.inject({ method: 'POST', url: '/test/prescribe' });
    expect(r.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test (deve falhar — module não existe)**

Run: `npm test -- tests/middleware/professional-gate.test.js`
Expected: FAIL com `Cannot find module '../../src/middleware/professional-gate'`.

- [ ] **Step 3: Implementar middleware**

Conteúdo de `apps/api/src/middleware/professional-gate.js`:

```js
'use strict';

/**
 * Middleware que bloqueia rotas onde só medico/dentista podem agir.
 * Usado em prescriptions.js (POST/PUT/PATCH).
 *
 * Esteticista (estetica module) NÃO pode prescrever — gate aplicado aqui.
 * Biomedico, outro: também bloqueados (V1).
 *
 * Aplicar em rotas DEPOIS de fastify.authenticate (precisa de request.user populado).
 */
async function requireMedico(request, reply) {
  const ptype = request.user?.professional_type;
  if (ptype !== 'medico' && ptype !== 'dentista') {
    return reply.status(403).send({
      error: 'Apenas profissional médico ou dentista pode realizar esta ação.',
    });
  }
}

module.exports = { requireMedico };
```

- [ ] **Step 4: Run test (deve passar)**

Run: `npm test -- tests/middleware/professional-gate.test.js`
Expected: PASS, 5 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middleware/professional-gate.js apps/api/tests/middleware/professional-gate.test.js
git commit -m "feat(aesthetic-f1): middleware requireMedico — gate pra prescriptions"
```

---

### Task 5: Aplicar requireMedico em prescription routes

**Files:**
- Modify: `apps/api/src/routes/prescriptions.js`
- Create: `apps/api/tests/routes/prescriptions-medico-gate.test.js`

- [ ] **Step 1: Localizar rotas que precisam de gate**

Run: `grep -nE "fastify\.(post|put|patch).*'/'" apps/api/src/routes/prescriptions.js`
Inspecionar quais rotas escrevem prescriptions (POST cria, PUT atualiza, POST /:id/pdf upload, POST /:id/send-email envia).

POST /, PUT /:id, POST /:id/send-email são as rotas que merecem o gate. Upload de PDF (POST /:id/pdf) já depende do registro existir, então gate herdado da criação.

- [ ] **Step 2: Importar middleware**

No topo de `apps/api/src/routes/prescriptions.js`, adicionar logo após o `withTenant` import:

```js
const { requireMedico } = require('../middleware/professional-gate');
```

- [ ] **Step 3: Aplicar gate**

Em cada `fastify.post`/`fastify.put` da prescription, adicionar `requireMedico` ao array `preHandler`.

Para POST `/`, mudar:

```js
fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
```

Para:

```js
fastify.post('/', { preHandler: [fastify.authenticate, requireMedico] }, async (request, reply) => {
```

Repetir o mesmo pattern para `fastify.put('/:id', ...)` e `fastify.post('/:id/send-email', ...)`. NÃO aplicar em GETs (esteticista pode VER prescrições do paciente, só não pode criar/editar).

- [ ] **Step 4: Escrever teste de gate aplicado**

Conteúdo de `apps/api/tests/routes/prescriptions-medico-gate.test.js`:

```js
const Fastify = require('fastify');

// Mock do withTenant pra não tocar DB
jest.mock('../../src/db/tenant', () => ({
  withTenant: jest.fn(async (pg, tid, fn) => fn({
    query: async () => ({ rows: [{ id: 'rx1' }] })
  })),
}));

describe('prescriptions routes — requireMedico gate', () => {
  function build(userOverride = {}) {
    const app = Fastify();
    app.decorate('authenticate', async (request) => {
      request.user = { user_id: 'u1', tenant_id: 't1', role: 'admin', professional_type: 'medico', ...userOverride };
    });
    app.decorate('pg', { query: jest.fn(async () => ({ rows: [] })) });
    app.register(require('../../src/routes/prescriptions'), { prefix: '/prescriptions' });
    return app;
  }

  it('POST /prescriptions — esteticista 403', async () => {
    const app = build({ professional_type: 'esteticista' });
    const r = await app.inject({
      method: 'POST', url: '/prescriptions',
      payload: { subject_id: 's1', exam_id: 'e1', agent_type: 'therapeutic', items: [] },
    });
    expect(r.statusCode).toBe(403);
  });

  it('PUT /prescriptions/:id — esteticista 403', async () => {
    const app = build({ professional_type: 'esteticista' });
    const r = await app.inject({
      method: 'PUT', url: '/prescriptions/abc',
      payload: { items: [] },
    });
    expect(r.statusCode).toBe(403);
  });

  it('POST /prescriptions — medico passa o gate (200/4xx do handler, não 403)', async () => {
    const app = build({ professional_type: 'medico' });
    const r = await app.inject({
      method: 'POST', url: '/prescriptions',
      payload: {},
    });
    expect(r.statusCode).not.toBe(403);
  });
});
```

- [ ] **Step 5: Run test**

Run: `npm test -- tests/routes/prescriptions-medico-gate.test.js`
Expected: PASS, 3 testes verdes.

- [ ] **Step 6: Verificar suite total ainda passa**

Run: `cd /home/rodrigonoma/GenomaFlow/apps/api && npm run test:unit`
Expected: todos verdes (numero anterior + 8 novos = 5 do middleware + 3 deste).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/prescriptions.js apps/api/tests/routes/prescriptions-medico-gate.test.js
git commit -m "feat(aesthetic-f1): aplicar requireMedico em POST/PUT/send-email de prescription"
```

---

### Task 6: Adicionar test:unit listagem

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Verificar lista atual de test:unit**

Run: `grep -A1 'test:unit' apps/api/package.json`

- [ ] **Step 2: Adicionar 2 testes novos**

Em `apps/api/package.json`, na entry `"test:unit"`, adicionar:
- `tests/middleware/professional-gate.test.js`
- `tests/routes/prescriptions-medico-gate.test.js`

Exemplo (caso a regex atual já cubra `tests/middleware/.*.test.js` e `tests/routes/.*.test.js`, este step pode ser pulado — verificar):

Run: `npm run test:unit -- --listTests` e verificar se os 2 arquivos aparecem na lista.

Se aparecem → Step 3 pode pular. Se não → editar package.json com paths explícitos.

- [ ] **Step 3: Commit (se mudou)**

```bash
git add apps/api/package.json
git commit -m "chore(aesthetic-f1): test:unit list inclui professional-gate e prescriptions-medico-gate"
```

(Se package.json não mudou pq regex já cobria, pular este commit.)

---

### Task 7: auth.js /register aceita professional_type

**Files:**
- Modify: `apps/api/src/routes/auth.js`

- [ ] **Step 1: Importar VALID_PROFESSIONAL_TYPES**

No topo de `apps/api/src/routes/auth.js`, garantir:

```js
const { VALID_MODULES, VALID_PROFESSIONAL_TYPES } = require('../constants');
```

(VALID_MODULES já era importado; só somar VALID_PROFESSIONAL_TYPES.)

- [ ] **Step 2: Atualizar handler /register**

Substituir bloco que extrai `request.body` (linha ~85) por:

```js
const { clinic_name, email: rawEmail, password, module: mod, professional_type: ptype } = request.body || {};
```

Substituir validação `if (!VALID_MODULES.includes(mod))` adicionando logo embaixo:

```js
if (!VALID_MODULES.includes(mod)) {
  return reply.status(400).send({ error: 'Módulo inválido. Use: human, veterinary ou estetica' });
}

// professional_type opcional — default 'medico' (compat retro pra register human/vet existente).
// Estetica deve sempre passar explícito; senão herda 'medico' (médico-dermato é caso comum).
const professional_type = ptype && VALID_PROFESSIONAL_TYPES.includes(ptype) ? ptype : 'medico';
```

- [ ] **Step 3: Persistir professional_type no INSERT do user**

Substituir o INSERT atual:

```js
"INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id"
```

Por:

```js
"INSERT INTO users (tenant_id, email, password_hash, role, professional_type) VALUES ($1, $2, $3, 'admin', $4) RETURNING id"
```

E ajustar args `[tenant_id, email, password_hash]` → `[tenant_id, email, password_hash, professional_type]`.

- [ ] **Step 4: /me retorna professional_type**

No handler `fastify.get('/me', ...)`, adicionar `u.professional_type` na lista de SELECT:

```js
`SELECT u.id, u.email, u.role, u.specialty, u.created_at,
        u.crm_number, u.crm_uf, u.professional_data_confirmed_at,
        u.professional_type,
        t.module, t.name AS tenant_name, t.billing_status
 FROM users u ...`
```

- [ ] **Step 5: Validar sintaxe + run tests existentes**

```bash
node -c apps/api/src/routes/auth.js
cd apps/api && npm run test:unit
```

Expected: OK + todos verdes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/auth.js
git commit -m "feat(aesthetic-f1): /register aceita professional_type, /me retorna campo"
```

---

### Task 8: Frontend UserProfile inclui professional_type

**Files:**
- Modify: `apps/web/src/app/shared/models/api.models.ts`

- [ ] **Step 1: Localizar interface UserProfile**

Run: `grep -n "interface UserProfile" apps/web/src/app/shared/models/api.models.ts`

- [ ] **Step 2: Adicionar campo professional_type**

Editar UserProfile pra incluir:

```typescript
export interface UserProfile {
  id: string;
  email: string;
  role: 'admin' | 'master';
  specialty?: string | null;
  created_at: string;
  crm_number?: string | null;
  crm_uf?: string | null;
  professional_data_confirmed_at?: string | null;
  professional_type: 'medico' | 'esteticista' | 'dentista' | 'biomedico' | 'outro';
  module: 'human' | 'veterinary' | 'estetica';
  tenant_name: string;
  billing_status: BillingStatus;
}
```

(Mantém os outros campos exatamente como estavam — só adiciona `professional_type` e estende `module` com `'estetica'`.)

- [ ] **Step 3: Build pra verificar tipagem**

```bash
cd apps/web && npx ng build --configuration=development 2>&1 | grep -E "error TS" | head -10
```

Expected: nenhum error (zero output).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/shared/models/api.models.ts
git commit -m "feat(aesthetic-f1): UserProfile.professional_type + module estetica"
```

---

### Task 9: Onboarding — 3º card de módulo + sub-step professional_type

**Files:**
- Modify: `apps/web/src/app/features/onboarding/onboarding.component.ts`

- [ ] **Step 1: Atualizar interface OnboardingData**

No topo de `apps/web/src/app/features/onboarding/onboarding.component.ts`:

```typescript
interface OnboardingData {
  clinic_name: string;
  email: string;
  password: string;
  confirm_password: string;
  module: 'human' | 'veterinary' | 'estetica' | '';
  professional_type: 'medico' | 'esteticista' | 'dentista' | 'biomedico' | 'outro' | '';
  specialties: string[];
}
```

E init data:

```typescript
data: OnboardingData = {
  clinic_name: '', email: '', password: '', confirm_password: '',
  module: '',
  professional_type: '',
  specialties: [],
};
```

- [ ] **Step 2: Adicionar 3º card no Step 2**

No template, dentro do `@case (2)`, dentro do grid, adicionar 3º card APÓS o card de veterinary:

```html
<div (click)="data.module = 'estetica'" style="padding:2rem;border-radius:0.25rem;cursor:pointer;border:2px solid transparent;transition:all 0.2s;"
     [style.borderColor]="data.module === 'estetica' ? '#c0c1ff' : 'transparent'"
     [style.background]="data.module === 'estetica' ? '#171f33' : '#060d20'">
  <span style="font-family:'Material Symbols Outlined';color:#c0c1ff;font-size:2rem;display:block;margin-bottom:0.75rem;">spa</span>
  <h3 style="font-family:'Space Grotesk',sans-serif;font-size:1rem;font-weight:600;margin-bottom:0.5rem;">Clínica de Estética</h3>
  <p style="font-size:0.75rem;color:#c7c5d0;">Dermatologia, harmonização orofacial e estética avançada</p>
</div>
```

E mudar grid pra 3 colunas:

```html
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:1rem;">
```

- [ ] **Step 3: Adicionar sub-step de professional_type**

Após `nextStep2()` validation, se module='estetica' e ainda não tem professional_type → mostra sub-step. Implementação simples: novo case `2.5` no @switch ou um sub-modal. Pra evitar complexidade do progress bar (que tem 4 etapas), vou usar **toggle inline no Step 2** — quando module='estetica' selecionado, aparece bloco "Tipo de profissional" abaixo dos cards.

No template, dentro do `@case (2)`, ANTES do `@if (errorMsg())`, adicionar:

```html
@if (data.module === 'estetica') {
  <div style="margin-top:1.5rem;padding:1rem;background:#171f33;border-radius:0.25rem;">
    <label style="font-size:0.625rem;letter-spacing:0.1em;text-transform:uppercase;color:#c7c5d0;display:block;margin-bottom:0.5rem;">Tipo de profissional principal</label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
      <button type="button" (click)="data.professional_type = 'medico'"
              style="padding:0.75rem;background:#060d20;color:#dbe2fd;font-size:0.8125rem;border:2px solid transparent;border-radius:0.25rem;cursor:pointer;text-align:left;"
              [style.borderColor]="data.professional_type === 'medico' ? '#c0c1ff' : 'transparent'">
        <strong style="display:block;font-size:0.875rem;">🩺 Médico</strong>
        <span style="font-size:0.6875rem;color:#c7c5d0;">Dermatologista, harmonização</span>
      </button>
      <button type="button" (click)="data.professional_type = 'esteticista'"
              style="padding:0.75rem;background:#060d20;color:#dbe2fd;font-size:0.8125rem;border:2px solid transparent;border-radius:0.25rem;cursor:pointer;text-align:left;"
              [style.borderColor]="data.professional_type === 'esteticista' ? '#c0c1ff' : 'transparent'">
        <strong style="display:block;font-size:0.875rem;">💆 Esteticista</strong>
        <span style="font-size:0.6875rem;color:#c7c5d0;">Técnico em estética</span>
      </button>
    </div>
  </div>
}
```

- [ ] **Step 4: Atualizar nextStep2() pra exigir professional_type quando estetica**

Localizar método `nextStep2()` e adicionar validação após `if (!data.module)`:

```typescript
nextStep2() {
  this.errorMsg.set('');
  if (!this.data.module) return this.errorMsg.set('Selecione um módulo.');
  if (this.data.module === 'estetica' && !this.data.professional_type) {
    return this.errorMsg.set('Selecione o tipo de profissional principal.');
  }
  // ... resto do método (current já existe, manter)
  this.step.set(3);
}
```

- [ ] **Step 5: Atualizar payload de submit**

Localizar `submit()` ou onde faz POST `/auth/register`. Adicionar `professional_type` ao body:

```typescript
const payload = {
  clinic_name: this.data.clinic_name,
  email: this.data.email,
  password: this.data.password,
  module: this.data.module,
  professional_type: this.data.professional_type || 'medico', // default backward compat
};
```

- [ ] **Step 6: Skip Step 3 (especialidades) se esteticista**

Esteticista NÃO tem especialidade (não é médico). Pular pra Step 4.

Em `nextStep2()`, após validação:

```typescript
if (this.data.module === 'estetica' && this.data.professional_type === 'esteticista') {
  // esteticista pula step de especialidades
  this.data.specialties = [];
  this.step.set(4);
  return;
}
this.step.set(3);
```

- [ ] **Step 7: Build + smoke local**

```bash
cd apps/web && npx ng build --configuration=production 2>&1 | tail -5
```

Expected: `Output location: ...` (sem error).

Smoke manual no browser:
1. http://localhost:4200/onboarding
2. Step 1: preencher
3. Step 2: clicar "Estética" → sub-bloco aparece
4. Selecionar "Médico" → continuar → vai pra Step 3 (especialidades) ✓
5. Voltar, selecionar "Esteticista" → continuar → vai direto pra Step 4 ✓
6. Submit → backend retorna 201 com tenant module=estetica + user professional_type=esteticista

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/features/onboarding/onboarding.component.ts
git commit -m "feat(aesthetic-f1): onboarding 3º card estetica + sub-step professional_type"
```

---

### Task 10: Sidebar terminologia "Pacientes" vs "Clientes"

**Files:**
- Modify: `apps/web/src/app/app.component.ts`

- [ ] **Step 1: Localizar nav item de pacientes**

Run: `grep -n 'Pacientes\|Animais\|/doctor/patients' apps/web/src/app/app.component.ts | head -5`

Localizar block (provavelmente algo como):

```html
<a class="nav-item" routerLink="/doctor/patients" routerLinkActive="active">
  <mat-icon>{{ user.module === 'veterinary' ? 'pets' : 'people' }}</mat-icon>
  {{ user.module === 'veterinary' ? 'Animais' : 'Pacientes' }}
</a>
```

- [ ] **Step 2: Estender ternário pra cobrir estetica**

Substituir por:

```html
<a class="nav-item" routerLink="/doctor/patients" routerLinkActive="active">
  <mat-icon>{{ subjectIconForModule(user.module) }}</mat-icon>
  {{ subjectLabelForModule(user.module) }}
</a>
```

- [ ] **Step 3: Adicionar helpers no class**

No `AppComponent`, adicionar métodos:

```typescript
subjectLabelForModule(mod: string | undefined): string {
  if (mod === 'veterinary') return 'Animais';
  if (mod === 'estetica') return 'Clientes';
  return 'Pacientes';
}

subjectIconForModule(mod: string | undefined): string {
  if (mod === 'veterinary') return 'pets';
  if (mod === 'estetica') return 'spa';
  return 'people';
}
```

- [ ] **Step 4: Build**

```bash
cd apps/web && npx ng build --configuration=production 2>&1 | tail -3
```

Expected: success.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/app.component.ts
git commit -m "feat(aesthetic-f1): sidebar 'Clientes' + ícone spa pra module estetica"
```

---

### Task 11: Patient-detail campos estéticos condicionais

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`

- [ ] **Step 1: Localizar bloco "Dados clínicos" no template**

Run: `grep -n "section-label.*Dados clínicos\|fitzpatrick\|skin_concerns" apps/web/src/app/features/doctor/patients/patient-detail.component.ts | head -5`

Provavelmente vai achar a section "Dados clínicos" mas SEM os campos estéticos ainda (eles serão novos).

- [ ] **Step 2: Adicionar campos no template**

Dentro da section "Dados clínicos", após o último campo existente (provavelmente notes ou comorbidades), adicionar:

```html
@if (subject()!.subject_type === 'human' && (auth.currentProfile?.module === 'estetica')) {
  <mat-form-field appearance="outline">
    <mat-label>Fototipo (Fitzpatrick)</mat-label>
    <mat-select [(ngModel)]="editForm.fitzpatrick_type">
      <mat-option [value]="null">Não informado</mat-option>
      <mat-option [value]="1">I — Branca, sempre queima, nunca bronzeia</mat-option>
      <mat-option [value]="2">II — Branca, queima fácil, bronzeia pouco</mat-option>
      <mat-option [value]="3">III — Morena clara, queima às vezes, bronzeia gradual</mat-option>
      <mat-option [value]="4">IV — Morena, queima pouco, bronzeia bem</mat-option>
      <mat-option [value]="5">V — Morena escura, raramente queima</mat-option>
      <mat-option [value]="6">VI — Negra, nunca queima</mat-option>
    </mat-select>
  </mat-form-field>
  <mat-form-field appearance="outline">
    <mat-label>Queixas estéticas (separadas por vírgula)</mat-label>
    <input matInput
           [ngModel]="(editForm.skin_concerns || []).join(', ')"
           (ngModelChange)="editForm.skin_concerns = parseConcerns($event)"
           placeholder="ex: melasma, rugas, acne"/>
  </mat-form-field>
}
```

- [ ] **Step 3: Adicionar helper parseConcerns**

No class:

```typescript
parseConcerns(input: string): string[] {
  return String(input).split(',').map(s => s.trim()).filter(Boolean);
}
```

- [ ] **Step 4: Estender Subject interface (model)**

Run: `grep -n "interface Subject" apps/web/src/app/shared/models/api.models.ts`

Adicionar à interface Subject:

```typescript
fitzpatrick_type?: number | null;
skin_concerns?: string[];
```

- [ ] **Step 5: Garantir backend /patients PUT/POST aceita campos**

Run: `grep -n "fitzpatrick\|skin_concerns" apps/api/src/routes/patients.js`

Se não tem, adicionar em PUT/POST handler de patients (handler atual aceita campos opcionais — só adicionar `fitzpatrick_type` e `skin_concerns` no SELECT/UPDATE).

Em `apps/api/src/routes/patients.js`, no handler PUT `/patients/:id`, no UPDATE statement adicionar:

```sql
fitzpatrick_type = COALESCE($X, fitzpatrick_type),
skin_concerns = COALESCE($Y, skin_concerns),
```

(X, Y são próximos placeholders na lista existente.) E adicionar `body.fitzpatrick_type ?? null` e `JSON.stringify(body.skin_concerns) ?? null` aos params.

E no SELECT que retorna o subject (GET /:id), adicionar:

```sql
SELECT ..., fitzpatrick_type, skin_concerns, ...
```

- [ ] **Step 6: Build + smoke**

```bash
cd apps/web && npx ng build --configuration=production 2>&1 | tail -3
```

Expected: success.

Smoke manual: tenant estetica → patient detail → campos Fototipo e Queixas aparecem; tenant human → não aparecem.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/doctor/patients/patient-detail.component.ts apps/web/src/app/shared/models/api.models.ts apps/api/src/routes/patients.js
git commit -m "feat(aesthetic-f1): patient-detail campos fitzpatrick + skin_concerns condicionais"
```

---

### Task 12: Hide prescription buttons pra esteticista

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`
- Modify (talvez): `apps/web/src/app/features/clinic/prescription/prescription-modal.component.ts` ou onde mais existir botão

- [ ] **Step 1: Localizar botões "Nova prescrição"**

Run: `grep -rn "Nova prescrição\|prescription-modal\|openPrescriptionFromDetail" apps/web/src/app/features/doctor/ apps/web/src/app/features/clinic/ | head -10`

- [ ] **Step 2: Wrap botão com @if**

Em cada local que tem o botão (provavelmente `patient-detail` aba Tratamentos + result-panel), wrappear:

```html
@if (auth.currentProfile?.professional_type === 'medico' || auth.currentProfile?.professional_type === 'dentista') {
  <button mat-button (click)="openPrescriptionFromDetail(...)">
    Nova prescrição
  </button>
}
```

- [ ] **Step 3: Build**

```bash
cd apps/web && npx ng build --configuration=production 2>&1 | tail -3
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/doctor/patients/patient-detail.component.ts apps/web/src/app/features/doctor/results/result-panel.component.ts
git commit -m "feat(aesthetic-f1): hide 'Nova prescrição' pra esteticista (gate UI consistente com backend)"
```

---

### Task 13: AuthService persist + hidratar professional_type no F5

**Files:**
- Modify: `apps/web/src/app/core/auth/auth.service.ts`

- [ ] **Step 1: Verificar que profile já é persistido**

Run: `grep -n "localStorage.*profile\|currentProfileSubject" apps/web/src/app/core/auth/auth.service.ts | head -5`

Se já tem persistence (de feedback_auth_profile_hydration.md), o `professional_type` será hydratado automaticamente porque `fetchProfile()` usa o /auth/me que agora retorna o campo. Validar.

- [ ] **Step 2: Smoke test**

Em browser, login como esteticista → F5 → verificar que `auth.currentProfile?.professional_type` ainda mostra 'esteticista' após reload.

Run no console do browser:

```js
JSON.parse(localStorage.getItem('profile'))
```

Expected: objeto com `professional_type: 'esteticista'`.

- [ ] **Step 3: Commit (se mudou algo)**

Se nada precisou mudar na auth.service, esta task só foi smoke. Sem commit. Senão:

```bash
git add apps/web/src/app/core/auth/auth.service.ts
git commit -m "feat(aesthetic-f1): hidratar professional_type via /me + localStorage profile"
```

---

### Task 14: Testes finais + suite total

- [ ] **Step 1: Run API test suite**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/api && npm run test:unit 2>&1 | tail -5
```

Expected: 580+ verdes (anterior + ~8 novos).

- [ ] **Step 2: Run Web test suite**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/web && npm test 2>&1 | tail -5
```

Expected: 31 verdes (sem regressão).

- [ ] **Step 3: Run Production build (catch erros TS strict)**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/web && npx ng build --configuration=production 2>&1 | grep -E "error|ERROR" | head -10
```

Expected: vazio.

---

### Task 15: Smoke test E2E manual

- [ ] **Step 1: Tenant estetica/esteticista — fluxo completo**

1. Onboarding: cria conta com module=estetica, professional_type=esteticista
2. Verifica email + login
3. Sidebar mostra "Clientes" + ícone `spa`
4. Cria cliente humano com fitzpatrick_type=3 + skin_concerns=['melasma']
5. Patient-detail mostra os 2 campos novos
6. Aba Tratamentos: botão "Nova prescrição" NÃO aparece (gate UI)
7. POST /prescriptions direto via DevTools → 403 (gate backend)

- [ ] **Step 2: Tenant estetica/medico — médico-derm**

1. Onboarding: module=estetica, professional_type=medico
2. Tudo do anterior +
3. Botão "Nova prescrição" APARECE
4. POST /prescriptions → 201 (gate backend libera)

- [ ] **Step 3: Tenant human existente — não regression**

1. Login com user existente (human)
2. Sidebar mostra "Pacientes" (igual antes)
3. Patient-detail NÃO mostra campos fitzpatrick/skin_concerns
4. Prescrições funcionam (médico)

---

### Task 16: Documentação + memória

**Files:**
- Modify: `CLAUDE.md`
- Create: `docs/claude-memory/project_aesthetic_f1.md`
- Modify: `docs/claude-memory/MEMORY.md`

- [ ] **Step 1: Adicionar memória do projeto**

Conteúdo de `docs/claude-memory/project_aesthetic_f1.md`:

```markdown
---
name: Aesthetic Clinic F1 Foundation
description: Module 'estetica' + professional_type — schema additive, requireMedico middleware, onboarding 3 cards. F1 entregue 2026-XX-XX
type: project
---

# F1 Foundation — entregue 2026-XX-XX

Spec: `docs/superpowers/specs/2026-05-05-aesthetic-clinic-module-design.md`

## Schema (migration 079)

- `tenants.module` enum estendido pra `('human','veterinary','estetica')`
- `users.professional_type` ('medico','esteticista','dentista','biomedico','outro') com backfill 'medico' e default 'medico'
- `subjects.fitzpatrick_type` (1-6) e `subjects.skin_concerns` (jsonb) opcionais
- `appointments.appointment_type` estendido com 'avaliacao_estetica','procedimento_estetico','retorno_estetica'
- `clinical_encounters.encounter_type` estendido com 'avaliacao_estetica','pos_procedimento'

## Middleware

`apps/api/src/middleware/professional-gate.js` exporta `requireMedico` que retorna 403 se `request.user.professional_type` não for `medico` ou `dentista`. Aplicado em rotas de `prescriptions.js` (POST `/`, PUT `/:id`, POST `/:id/send-email`) — esteticista bloqueado.

## Onboarding

Step 2 ganha 3º card "Clínica de Estética" + sub-bloco "Tipo de profissional" quando module=estetica. Esteticista pula step de especialidades médicas (não tem CRM).

## Padrão pra F2-F5

Todo code novo prefixado `aesthetic/` no path (api routes, web features, worker agents). Tests sempre cobrem: backend gate por professional_type, frontend hide UI por professional_type. Migrations sempre additive.
```

- [ ] **Step 2: Adicionar entry no índice MEMORY.md**

Em `docs/claude-memory/MEMORY.md`, ao final do índice:

```markdown
- [Aesthetic Clinic F1 Foundation](project_aesthetic_f1.md) — Module 'estetica' + professional_type + requireMedico middleware. Schema additive (migration 079), zero break em human/veterinary. Foundation pra F2-F5. (entregue 2026-XX-XX)
```

- [ ] **Step 3: Estender CLAUDE.md "Comportamentos Esperados"**

Em `CLAUDE.md`, na seção "## Comportamentos Esperados", adicionar:

```markdown
- Module 'estetica' (F1, entregue 2026-XX-XX): tenant pode escolher 'estetica' no onboarding. Schema additive — `tenants.module IN ('human','veterinary','estetica')`. Users ganham `professional_type` ('medico','esteticista','dentista','biomedico','outro') com default 'medico'. Esteticista bloqueado em POST/PUT de prescriptions via `requireMedico` middleware (403). Frontend renderiza campos `fitzpatrick_type` e `skin_concerns` em patient-detail só se module='estetica'. Sidebar "Pacientes" → "Clientes" condicional.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/claude-memory/project_aesthetic_f1.md docs/claude-memory/MEMORY.md
git commit -m "docs(aesthetic-f1): registrar foundation em memória + CLAUDE.md"
```

---

### Task 17: Merge + push + monitor

- [ ] **Step 1: Merge fast-forward em main**

```bash
git checkout main
git merge --ff-only feat/aesthetic-f1-foundation
git push origin main
git branch -d feat/aesthetic-f1-foundation
```

- [ ] **Step 2: Monitor CI/CD**

Acompanhar deploy.yml run via `gh run list --workflow=deploy.yml --limit 1`. Migration 079 vai rodar via `genomaflow-prod-migrate` task. Esperar Migration concluída ✅.

- [ ] **Step 3: Smoke prod**

Após deploy: criar tenant teste em `app.genomaflow.com.br/onboarding` com module=estetica → validar fluxo end-to-end.

---

## Self-Review

**Spec coverage:**
- ✅ Module 'estetica' enum (Task 2)
- ✅ professional_type em users com backfill (Task 2)
- ✅ subjects.fitzpatrick_type + skin_concerns (Task 2)
- ✅ appointments.appointment_type + clinical_encounters.encounter_type extends (Task 2)
- ✅ Constants update (Task 3)
- ✅ requireMedico middleware (Task 4)
- ✅ Gate aplicado em prescription routes (Task 5)
- ✅ /register aceita professional_type (Task 7)
- ✅ /me retorna professional_type (Task 7)
- ✅ Onboarding 3º card + sub-step (Task 9)
- ✅ Sidebar "Clientes" pra estetica (Task 10)
- ✅ Patient-detail campos condicionais (Task 11)
- ✅ Hide prescription buttons (Task 12)
- ✅ Tests cobrindo gate backend (Tasks 4, 5)
- ✅ Backfill verification (Task 2 step 5)
- ✅ Memória + CLAUDE.md atualizados (Task 16)

**Placeholder scan:** zero TODOs/TBDs/FIXMEs. Toda step tem código completo ou comando exato.

**Type consistency:** `professional_type` definido com mesmo conjunto de valores em (a) constants.js (b) migration CHECK (c) middleware (d) UserProfile interface (e) onboarding interface. Verificado.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-05-aesthetic-clinic-f1-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
