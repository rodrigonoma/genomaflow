# Onboarding de Novos Tenants — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar fluxo completo de cadastro de clínicas — migration SQL, endpoints de registro/ativação, wizard Angular de 4 etapas, middleware de auth com verificação `active`.

**Architecture:** Migration 015 adiciona `tenants.active`. Backend: rotas públicas `POST /auth/register` e `POST /auth/activate` (dev-only) em `apps/api/src/routes/auth.js`. Frontend: componente Angular standalone em `apps/web/src/app/features/onboarding/` com estado local e `@switch (step)`. Step 3 chama `POST /auth/register`, Step 4 chama `POST /billing/subscribe`. Dev mode tem botão "Simular pagamento aprovado".

**Tech Stack:** Node.js/Fastify, PostgreSQL, bcrypt, Angular 17+ standalone, environment.ts.

---

## File Map

- Create: `apps/api/src/db/migrations/015_tenant_active.sql`
- Modify: `apps/api/src/routes/auth.js` — adicionar `POST /auth/register` e `POST /auth/activate`
- Modify: `apps/api/src/plugins/auth.js` — verificar `t.active` no login
- Create: `apps/web/src/app/features/onboarding/onboarding.component.ts`
- Modify: `apps/web/src/app/app.routes.ts` — adicionar rota `/onboarding`
- Modify: `apps/api/tests/routes/auth.test.js` — adicionar testes do register/activate

---

### Task 1: Migration 015 — `tenants.active`

**Files:**
- Create: `apps/api/src/db/migrations/015_tenant_active.sql`

- [ ] **Step 1: Ler migration mais recente para entender o padrão**

```bash
ls apps/api/src/db/migrations/ | sort | tail -3
```

- [ ] **Step 2: Criar migration 015**

```sql
-- apps/api/src/db/migrations/015_tenant_active.sql
ALTER TABLE tenants
  ADD COLUMN active BOOLEAN NOT NULL DEFAULT false;

-- Tenants existentes já são considerados ativos
UPDATE tenants SET active = true;
```

- [ ] **Step 3: Verificar se existe script de migrations para rodar**

```bash
grep -r "migrations" apps/api/package.json || grep -r "migrate" apps/api/src/db/ --include="*.js" -l
```

- [ ] **Step 4: Rodar a migration**

Se existir script (ex: `node apps/api/src/db/migrate.js`):
```bash
cd apps/api && node src/db/migrate.js
```

Se não existir script de migration runner automático, rodar via psql:
```bash
psql $DATABASE_URL -f apps/api/src/db/migrations/015_tenant_active.sql
```

Verificar output: `ALTER TABLE` + `UPDATE X` (X = número de tenants existentes).

- [ ] **Step 5: Verificar coluna criada**

```bash
psql $DATABASE_URL -c "\d tenants" | grep active
# Esperado: active | boolean | not null | false
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/migrations/015_tenant_active.sql
git commit -m "feat: migration 015 — add tenants.active column"
```

---

### Task 2: Backend — `POST /auth/register` e `POST /auth/activate`

**Files:**
- Modify: `apps/api/src/routes/auth.js`
- Modify: `apps/api/tests/routes/auth.test.js` (ou criar se não existir)

- [ ] **Step 1: Ler `apps/api/src/routes/auth.js` para entender padrões existentes**

Verificar como outras rotas estão estruturadas (fastify.post, validação, resposta de erro).

- [ ] **Step 2: Escrever testes antes de implementar**

Ler o arquivo de testes existente (se existir `apps/api/tests/routes/auth.test.js`) para entender o padrão de testes, depois adicionar:

```javascript
// No arquivo de testes auth.test.js
describe('POST /auth/register', () => {
  it('cria tenant e usuário admin com dados válidos', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        clinic_name: 'Clínica Teste',
        email: 'admin@teste.com',
        password: 'senhasegura123',
        module: 'human'
      }
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('tenant_id');
    expect(body).toHaveProperty('user_id');
    expect(body.email).toBe('admin@teste.com');
  });

  it('retorna 400 se campos obrigatórios ausentes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'admin@teste.com' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('retorna 409 se email já cadastrado', async () => {
    // Cadastrar primeiro
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { clinic_name: 'Dup', email: 'dup@teste.com', password: '12345678', module: 'human' }
    });
    // Tentar de novo com mesmo email
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { clinic_name: 'Dup2', email: 'dup@teste.com', password: '12345678', module: 'human' }
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('Email já cadastrado');
  });
});

describe('POST /auth/activate', () => {
  it('marca tenant como ativo', async () => {
    // Criar tenant via register
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { clinic_name: 'Activate Test', email: 'activate@teste.com', password: '12345678', module: 'human' }
    });
    const { tenant_id } = JSON.parse(regRes.body);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/activate',
      payload: { tenant_id }
    });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 3: Rodar testes para confirmar que falham**

```bash
cd apps/api && npm test -- --testPathPattern=auth
# Esperado: FAIL — POST /auth/register, cannot POST /auth/register (404 ou método não encontrado)
```

- [ ] **Step 4: Implementar os endpoints em `apps/api/src/routes/auth.js`**

Adicionar ao arquivo (após os imports existentes, antes do `module.exports`):

```javascript
// POST /auth/register — rota pública, cria tenant + admin
fastify.post('/auth/register', async (request, reply) => {
  const { clinic_name, email, password, module: mod } = request.body || {};

  if (!clinic_name || !email || !password || !mod) {
    return reply.status(400).send({ error: 'Campos obrigatórios: clinic_name, email, password, module' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return reply.status(400).send({ error: 'Formato de email inválido' });
  }

  if (password.length < 8) {
    return reply.status(400).send({ error: 'Senha deve ter no mínimo 8 caracteres' });
  }

  if (!['human', 'veterinary'].includes(mod)) {
    return reply.status(400).send({ error: 'Módulo inválido. Use: human ou veterinary' });
  }

  const client = await fastify.pg.connect();
  try {
    // Verificar email duplicado
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: 'Email já cadastrado' });
    }

    const bcrypt = require('bcrypt');
    const password_hash = await bcrypt.hash(password, 12);

    // Criar tenant (active = false até pagamento)
    const tenantRes = await client.query(
      "INSERT INTO tenants (name, type, module, active) VALUES ($1, 'clinic', $2, false) RETURNING id",
      [clinic_name, mod]
    );
    const tenant_id = tenantRes.rows[0].id;

    // Criar usuário admin
    const userRes = await client.query(
      "INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id",
      [tenant_id, email, password_hash]
    );
    const user_id = userRes.rows[0].id;

    return reply.status(201).send({ tenant_id, user_id, email });
  } finally {
    client.release();
  }
});

// POST /auth/activate — DEV ONLY: ativa tenant sem gateway real
fastify.post('/auth/activate', async (request, reply) => {
  const { tenant_id } = request.body || {};

  if (!tenant_id) {
    return reply.status(400).send({ error: 'tenant_id é obrigatório' });
  }

  const client = await fastify.pg.connect();
  try {
    const res = await client.query(
      'UPDATE tenants SET active = true WHERE id = $1 RETURNING id',
      [tenant_id]
    );
    if (res.rowCount === 0) {
      return reply.status(404).send({ error: 'Tenant não encontrado' });
    }
    return reply.status(200).send({ ok: true });
  } finally {
    client.release();
  }
});
```

- [ ] **Step 5: Rodar testes**

```bash
cd apps/api && npm test -- --testPathPattern=auth
# Esperado: PASS — todos os testes de register e activate passando
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/auth.js apps/api/tests/routes/auth.test.js
git commit -m "feat: POST /auth/register and POST /auth/activate endpoints"
```

---

### Task 3: Middleware de auth — verificação `tenants.active`

**Files:**
- Modify: `apps/api/src/plugins/auth.js` (ou onde está a lógica de login)

- [ ] **Step 1: Ler o arquivo de auth/login para encontrar onde valida senha**

```bash
grep -n "password\|bcrypt\|token\|jwt" apps/api/src/plugins/auth.js apps/api/src/routes/auth.js 2>/dev/null | head -30
```

Identificar a query que busca o usuário no login (JOIN com tenants).

- [ ] **Step 2: Adicionar verificação de `t.active` na query de login**

Na query de login (que faz JOIN users + tenants), adicionar `t.active` ao SELECT e verificar antes de gerar JWT:

```javascript
// Exemplo: localizar a query existente que inclui JOIN tenants
// e adicionar t.active ao SELECT
const result = await client.query(
  `SELECT u.id, u.email, u.password_hash, u.role, u.tenant_id,
          t.name AS tenant_name, t.module, t.active
   FROM users u
   JOIN tenants t ON t.id = u.tenant_id
   WHERE u.email = $1`,
  [email]
);

const user = result.rows[0];
if (!user) return reply.status(401).send({ error: 'Credenciais inválidas' });

// Verificação de active ANTES de checar senha
if (!user.active) {
  return reply.status(403).send({ error: 'Conta pendente de ativação. Verifique seu pagamento.' });
}

// ... resto do fluxo de validação de senha e geração de JWT
```

- [ ] **Step 3: Escrever teste para login com conta inativa**

No arquivo de testes de auth, adicionar:

```javascript
describe('POST /auth/login — conta inativa', () => {
  it('retorna 403 se tenant.active = false', async () => {
    // Criar tenant inativo via register (não ativar)
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { clinic_name: 'Inativa', email: 'inativa@teste.com', password: '12345678', module: 'human' }
    });
    expect(regRes.statusCode).toBe(201);

    // Tentar login sem ativar
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'inativa@teste.com', password: '12345678' }
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/ativação/i);
  });
});
```

- [ ] **Step 4: Rodar testes**

```bash
cd apps/api && npm test -- --testPathPattern=auth
# Esperado: PASS — incluindo o novo teste de conta inativa
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/plugins/auth.js apps/api/tests/routes/auth.test.js
git commit -m "feat: login returns 403 for inactive tenant accounts"
```

---

### Task 4: Frontend — componente Angular de onboarding (Steps 1–2)

**Files:**
- Create: `apps/web/src/app/features/onboarding/onboarding.component.ts`
- Modify: `apps/web/src/app/app.routes.ts`

- [ ] **Step 1: Ler `app.routes.ts` para entender o padrão de rotas existentes**

```bash
cat apps/web/src/app/app.routes.ts
```

- [ ] **Step 2: Registrar rota `/onboarding` (sem guard)**

Em `apps/web/src/app/app.routes.ts`, adicionar:

```typescript
{ path: 'onboarding', loadComponent: () => import('./features/onboarding/onboarding.component').then(m => m.OnboardingComponent) },
```

- [ ] **Step 3: Criar o componente — Steps 1 e 2**

Criar `apps/web/src/app/features/onboarding/onboarding.component.ts`:

```typescript
import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

interface OnboardingData {
  clinic_name: string;
  email: string;
  password: string;
  confirm_password: string;
  module: 'human' | 'veterinary' | '';
  specialties: string[];
  gateway: 'stripe' | 'mercadopago' | '';
  tenant_id: string;
}

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="min-h-screen bg-surface flex flex-col items-center justify-center px-4 py-16">
  <!-- Progress -->
  <div class="w-full max-w-xl mb-10">
    <div class="flex items-center gap-2 mb-2">
      @for (s of [1,2,3,4]; track s) {
        <div class="h-1 flex-1 rounded-full transition-all"
             [class]="step() >= s ? 'bg-secondary' : 'bg-surface-container-high'"></div>
      }
    </div>
    <div class="font-mono text-xs text-on-surface-variant uppercase tracking-widest">
      Etapa {{ step() }} de 4 — {{ stepLabel() }}
    </div>
  </div>

  <!-- Card -->
  <div class="w-full max-w-xl bg-surface-container-high rounded-lg p-10 space-y-8">

    @switch (step()) {

      @case (1) {
        <div class="space-y-2">
          <h1 class="font-headline text-3xl font-bold">Dados da Clínica</h1>
          <p class="text-on-surface-variant text-sm">Preencha os dados do administrador da conta.</p>
        </div>
        <div class="space-y-4">
          <div class="space-y-1">
            <label class="font-label text-xs uppercase tracking-widest text-on-surface-variant">Nome da Clínica</label>
            <input [(ngModel)]="data.clinic_name" class="w-full bg-surface-container-lowest text-on-surface font-mono text-sm px-4 py-3 focus:outline-none border-b border-transparent focus:border-b focus:border-secondary placeholder-on-surface-variant/40" placeholder="Clínica São Lucas"/>
          </div>
          <div class="space-y-1">
            <label class="font-label text-xs uppercase tracking-widest text-on-surface-variant">Email do Administrador</label>
            <input [(ngModel)]="data.email" type="email" class="w-full bg-surface-container-lowest text-on-surface font-mono text-sm px-4 py-3 focus:outline-none border-b border-transparent focus:border-b focus:border-secondary placeholder-on-surface-variant/40" placeholder="admin@clinica.com.br"/>
          </div>
          <div class="space-y-1">
            <label class="font-label text-xs uppercase tracking-widest text-on-surface-variant">Senha (mínimo 8 caracteres)</label>
            <input [(ngModel)]="data.password" type="password" class="w-full bg-surface-container-lowest text-on-surface font-mono text-sm px-4 py-3 focus:outline-none border-b border-transparent focus:border-b focus:border-secondary placeholder-on-surface-variant/40" placeholder="••••••••"/>
          </div>
          <div class="space-y-1">
            <label class="font-label text-xs uppercase tracking-widest text-on-surface-variant">Confirmar Senha</label>
            <input [(ngModel)]="data.confirm_password" type="password" class="w-full bg-surface-container-lowest text-on-surface font-mono text-sm px-4 py-3 focus:outline-none border-b border-transparent focus:border-b focus:border-secondary placeholder-on-surface-variant/40" placeholder="••••••••"/>
          </div>
          @if (errorMsg()) {
            <p class="text-error text-xs font-mono">{{ errorMsg() }}</p>
          }
        </div>
        <button (click)="nextStep1()" class="w-full py-3 bg-primary-container text-on-primary-container font-headline font-bold uppercase text-xs tracking-widest rounded hover:scale-105 transition-transform">
          Continuar
        </button>
      }

      @case (2) {
        <div class="space-y-2">
          <h1 class="font-headline text-3xl font-bold">Seleção de Módulo</h1>
          <p class="text-on-surface-variant text-sm">Esta seleção é permanente após o cadastro.</p>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div (click)="data.module = 'human'"
               class="p-8 rounded-lg cursor-pointer transition-all border-2 space-y-3"
               [class]="data.module === 'human' ? 'border-secondary bg-surface-container' : 'border-transparent bg-surface-container-lowest hover:border-secondary/30'">
            <span class="material-symbols-outlined text-secondary block">local_hospital</span>
            <h3 class="font-headline text-lg font-semibold">Clínica Humana</h3>
            <p class="text-xs text-on-surface-variant">Medicina humana: metabólico, cardiovascular, hematologia</p>
          </div>
          <div (click)="data.module = 'veterinary'"
               class="p-8 rounded-lg cursor-pointer transition-all border-2 space-y-3"
               [class]="data.module === 'veterinary' ? 'border-secondary bg-surface-container' : 'border-transparent bg-surface-container-lowest hover:border-secondary/30'">
            <span class="material-symbols-outlined text-secondary block">pets</span>
            <h3 class="font-headline text-lg font-semibold">Clínica Veterinária</h3>
            <p class="text-xs text-on-surface-variant">Medicina veterinária: pequenos animais, equinos, bovinos</p>
          </div>
        </div>
        @if (errorMsg()) {
          <p class="text-error text-xs font-mono">{{ errorMsg() }}</p>
        }
        <div class="flex gap-3">
          <button (click)="step.set(1)" class="flex-1 py-3 bg-surface-container-lowest text-on-surface-variant font-headline font-bold uppercase text-xs tracking-widest rounded hover:text-on-surface transition-colors">
            Voltar
          </button>
          <button (click)="nextStep2()" class="flex-1 py-3 bg-primary-container text-on-primary-container font-headline font-bold uppercase text-xs tracking-widest rounded hover:scale-105 transition-transform">
            Continuar
          </button>
        </div>
      }

      @case (3) {
        <!-- Step 3 — renderizado em Task 5 -->
        <p class="text-on-surface-variant">Carregando especialidades...</p>
      }

      @case (4) {
        <!-- Step 4 — renderizado em Task 5 -->
        <p class="text-on-surface-variant">Carregando plano...</p>
      }

    }

  </div>
</div>
  `,
  styles: [`
    :host { display: block; background: #0b1326; min-height: 100vh; }
  `]
})
export class OnboardingComponent {
  step = signal<number>(1);
  errorMsg = signal<string>('');
  loading = signal<boolean>(false);

  data: OnboardingData = {
    clinic_name: '',
    email: '',
    password: '',
    confirm_password: '',
    module: '',
    specialties: [],
    gateway: '',
    tenant_id: ''
  };

  constructor(private http: HttpClient, private router: Router) {}

  stepLabel(): string {
    const labels: Record<number, string> = {
      1: 'Dados da Clínica',
      2: 'Seleção de Módulo',
      3: 'Especialidades',
      4: 'Plano e Pagamento'
    };
    return labels[this.step()] ?? '';
  }

  nextStep1(): void {
    this.errorMsg.set('');
    if (!this.data.clinic_name.trim()) return this.errorMsg.set('Nome da clínica é obrigatório.');
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.data.email);
    if (!emailOk) return this.errorMsg.set('Email inválido.');
    if (this.data.password.length < 8) return this.errorMsg.set('Senha deve ter no mínimo 8 caracteres.');
    if (this.data.password !== this.data.confirm_password) return this.errorMsg.set('Senhas não coincidem.');
    this.step.set(2);
  }

  nextStep2(): void {
    this.errorMsg.set('');
    if (!this.data.module) return this.errorMsg.set('Selecione um módulo.');
    this.step.set(3);
  }
}
```

- [ ] **Step 4: Rodar `ng serve` e navegar para `http://localhost:4200/onboarding`**

```bash
cd apps/web && ng serve
```

Verificar: Step 1 renderiza campos, validação funciona ao clicar "Continuar" com campos vazios, Step 2 mostra cards de seleção de módulo.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/onboarding/onboarding.component.ts apps/web/src/app/app.routes.ts
git commit -m "feat: onboarding component steps 1 and 2 — clinic data, module selection"
```

---

### Task 5: Frontend — Steps 3 (especialidades) e 4 (plano + pagamento)

**Files:**
- Modify: `apps/web/src/app/features/onboarding/onboarding.component.ts`

- [ ] **Step 1: Adicionar especialidades por módulo e lógica de créditos**

No componente, adicionar na classe:

```typescript
  readonly specialtiesMap: Record<string, {key: string, label: string, phase2?: boolean}[]> = {
    human: [
      { key: 'metabolic', label: 'Metabólico' },
      { key: 'cardiovascular', label: 'Cardiovascular' },
      { key: 'hematology', label: 'Hematologia' },
      { key: 'therapeutic', label: 'Terapêutico', phase2: true },
      { key: 'nutrition', label: 'Nutrição', phase2: true }
    ],
    veterinary: [
      { key: 'small_animals', label: 'Pequenos Animais (cão/gato)' },
      { key: 'equine', label: 'Equinos' },
      { key: 'bovine', label: 'Bovinos' },
      { key: 'therapeutic', label: 'Terapêutico', phase2: true },
      { key: 'nutrition', label: 'Nutrição', phase2: true }
    ]
  };

  get currentSpecialties() {
    return this.specialtiesMap[this.data.module] ?? [];
  }

  get creditsEstimate(): number {
    return this.data.specialties.length;
  }

  toggleSpecialty(key: string): void {
    const idx = this.data.specialties.indexOf(key);
    if (idx >= 0) {
      this.data.specialties.splice(idx, 1);
    } else {
      this.data.specialties.push(key);
    }
  }

  isSpecialtySelected(key: string): boolean {
    return this.data.specialties.includes(key);
  }
```

- [ ] **Step 2: Adicionar Step 3 e Step 4 ao template**

Substituir os cases de `@case (3)` e `@case (4)` no template por:

```typescript
      @case (3) {
        <div class="space-y-2">
          <h1 class="font-headline text-3xl font-bold">Especialidades</h1>
          <p class="text-on-surface-variant text-sm">Mínimo 1 especialidade obrigatória.</p>
        </div>
        <div class="space-y-3">
          @for (spec of currentSpecialties; track spec.key) {
            <div (click)="toggleSpecialty(spec.key)"
                 class="flex items-center gap-4 p-4 rounded cursor-pointer transition-all"
                 [class]="isSpecialtySelected(spec.key) ? 'bg-surface-container' : 'bg-surface-container-lowest hover:bg-surface-container'">
              <div class="w-4 h-4 border border-secondary/50 rounded-sm flex items-center justify-center flex-shrink-0"
                   [class]="isSpecialtySelected(spec.key) ? 'bg-secondary' : ''">
                @if (isSpecialtySelected(spec.key)) {
                  <span class="text-surface text-xs font-bold">✓</span>
                }
              </div>
              <span class="font-body text-sm">{{ spec.label }}</span>
              @if (spec.phase2) {
                <span class="ml-auto font-mono text-[10px] text-on-surface-variant border border-outline-variant/30 px-2 py-0.5">fase 2</span>
              }
            </div>
          }
        </div>
        @if (data.specialties.length > 0) {
          <div class="bg-surface-container-lowest p-4 rounded font-mono text-xs text-secondary">
            Com {{ data.specialties.length }} especialidade(s), cada exame consome {{ creditsEstimate }} crédito(s).
          </div>
        }
        @if (errorMsg()) {
          <p class="text-error text-xs font-mono">{{ errorMsg() }}</p>
        }
        <div class="flex gap-3">
          <button (click)="step.set(2)" class="flex-1 py-3 bg-surface-container-lowest text-on-surface-variant font-headline font-bold uppercase text-xs tracking-widest rounded hover:text-on-surface transition-colors">
            Voltar
          </button>
          <button (click)="nextStep3()" [disabled]="loading()"
                  class="flex-1 py-3 bg-primary-container text-on-primary-container font-headline font-bold uppercase text-xs tracking-widest rounded hover:scale-105 transition-transform disabled:opacity-50">
            {{ loading() ? 'Registrando...' : 'Continuar' }}
          </button>
        </div>
      }

      @case (4) {
        <div class="space-y-2">
          <h1 class="font-headline text-3xl font-bold">Plano e Pagamento</h1>
        </div>

        <!-- Card assinatura -->
        <div class="bg-surface-container-lowest p-6 rounded-lg space-y-4">
          <span class="font-mono text-[10px] text-secondary uppercase tracking-widest">Assinatura Mensal</span>
          <div class="font-mono text-4xl text-secondary">R$ 199<span class="text-xs text-on-surface-variant">,00/mês</span></div>
          <ul class="text-xs space-y-1 text-on-surface-variant font-body">
            <li>✦ Acesso completo à plataforma</li>
            <li>✦ Todos os módulos habilitados</li>
            <li>✦ Suporte 8/5</li>
          </ul>
        </div>

        <!-- Banner promoção -->
        <div class="border-l-2 border-[#585990] bg-[rgba(192,193,255,0.1)] backdrop-blur p-4 space-y-1">
          <div class="font-mono text-xs text-secondary uppercase tracking-widest">✦ Oferta de Boas-Vindas</div>
          <p class="font-body text-xs text-on-surface-variant">
            Primeiro mês: ~122 créditos grátis<br/>
            <span class="text-secondary">(30% de R$&nbsp;199,00 convertidos em créditos)</span>
          </p>
        </div>

        <!-- Gateway -->
        <div class="space-y-2">
          <label class="font-label text-xs uppercase tracking-widest text-on-surface-variant">Forma de Pagamento</label>
          <div class="grid grid-cols-2 gap-3">
            <div (click)="data.gateway = 'stripe'"
                 class="p-4 rounded cursor-pointer border-2 text-center transition-all"
                 [class]="data.gateway === 'stripe' ? 'border-secondary bg-surface-container' : 'border-transparent bg-surface-container-lowest hover:border-secondary/30'">
              <div class="font-mono text-xs text-secondary mb-1">Stripe</div>
              <div class="font-body text-[10px] text-on-surface-variant">Cartão de crédito</div>
            </div>
            <div (click)="data.gateway = 'mercadopago'"
                 class="p-4 rounded cursor-pointer border-2 text-center transition-all"
                 [class]="data.gateway === 'mercadopago' ? 'border-secondary bg-surface-container' : 'border-transparent bg-surface-container-lowest hover:border-secondary/30'">
              <div class="font-mono text-xs text-secondary mb-1">Mercado Pago</div>
              <div class="font-body text-[10px] text-on-surface-variant">PIX / Boleto</div>
            </div>
          </div>
        </div>

        @if (errorMsg()) {
          <p class="text-error text-xs font-mono">{{ errorMsg() }}</p>
        }

        <button (click)="goToPayment()" [disabled]="loading()"
                class="w-full py-3 bg-primary-container text-on-primary-container font-headline font-bold uppercase text-xs tracking-widest rounded hover:scale-105 transition-transform disabled:opacity-50">
          {{ loading() ? 'Redirecionando...' : 'Ir para pagamento' }}
        </button>

        @if (!isProd()) {
          <button (click)="simulatePayment()" [disabled]="loading()"
                  class="w-full py-3 bg-surface-container-lowest text-secondary font-mono text-xs uppercase tracking-widest rounded border border-secondary/20 hover:border-secondary/50 transition-colors">
            Simular pagamento aprovado (dev)
          </button>
        }
      }

    }
```

- [ ] **Step 3: Adicionar métodos `nextStep3`, `goToPayment`, `simulatePayment`, `isProd` na classe**

```typescript
  isProd(): boolean {
    return environment.production;
  }

  nextStep3(): void {
    this.errorMsg.set('');
    if (this.data.specialties.length === 0) return this.errorMsg.set('Selecione ao menos 1 especialidade.');
    this.loading.set(true);
    this.http.post<{ tenant_id: string; user_id: string; email: string }>(
      `${environment.apiUrl}/auth/register`,
      {
        clinic_name: this.data.clinic_name,
        email: this.data.email,
        password: this.data.password,
        module: this.data.module
      }
    ).subscribe({
      next: (res) => {
        this.data.tenant_id = res.tenant_id;
        this.loading.set(false);
        this.step.set(4);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMsg.set(err.error?.error ?? 'Erro ao criar conta. Tente novamente.');
      }
    });
  }

  goToPayment(): void {
    this.errorMsg.set('');
    if (!this.data.gateway) return this.errorMsg.set('Selecione uma forma de pagamento.');
    this.loading.set(true);
    this.http.post<{ checkout_url: string }>(
      `${environment.apiUrl}/billing/subscribe`,
      {
        gateway: this.data.gateway,
        plan: 'starter',
        tenant_id: this.data.tenant_id,
        specialties: this.data.specialties
      }
    ).subscribe({
      next: (res) => {
        window.location.href = res.checkout_url;
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMsg.set(err.error?.error ?? 'Erro ao iniciar pagamento.');
      }
    });
  }

  simulatePayment(): void {
    this.loading.set(true);
    this.http.post(`${environment.apiUrl}/auth/activate`, { tenant_id: this.data.tenant_id })
      .subscribe({
        next: () => {
          this.router.navigate(['/login'], { queryParams: { activated: 'true' } });
        },
        error: () => {
          this.loading.set(false);
          this.errorMsg.set('Erro ao simular pagamento.');
        }
      });
  }
```

- [ ] **Step 4: Verificar no browser — golden path completo**

1. Navegar para `/onboarding`
2. Step 1: preencher dados válidos → Continuar
3. Step 2: selecionar módulo → Continuar
4. Step 3: selecionar especialidades → estimativa aparece → Continuar (vai chamar API)
5. Step 4: ver card do plano, banner promoção, seleção de gateway, botão "Simular pagamento aprovado" visível

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/onboarding/onboarding.component.ts
git commit -m "feat: onboarding steps 3 (specialties) and 4 (plan/payment)"
```

---

### Task 6: Banner de ativação no login

**Files:**
- Modify: `apps/web/src/app/features/auth/login/login.component.ts` (ou equivalente)

- [ ] **Step 1: Localizar o componente de login**

```bash
find apps/web/src/app -name "login*" -type f
```

- [ ] **Step 2: Ler o componente de login para entender a estrutura**

- [ ] **Step 3: Adicionar verificação de `?activated=true` e exibir banner**

No constructor ou ngOnInit do componente de login:

```typescript
import { ActivatedRoute } from '@angular/router';

// No construtor:
constructor(private route: ActivatedRoute, ...) {}

// No ngOnInit:
this.showActivatedBanner = this.route.snapshot.queryParams['activated'] === 'true';
```

No template, adicionar antes do formulário:

```html
@if (showActivatedBanner) {
  <div class="w-full max-w-sm mb-6 border-l-2 border-[#585990] bg-[rgba(192,193,255,0.1)] p-4 rounded">
    <p class="font-mono text-xs text-secondary">✅ Conta ativada! Seus créditos de boas-vindas já estão disponíveis.</p>
  </div>
}
```

- [ ] **Step 4: Verificar no browser**

Navegar para `/login?activated=true` e confirmar que o banner aparece.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/auth/login/login.component.ts
git commit -m "feat: login banner for activated=true query param"
```
