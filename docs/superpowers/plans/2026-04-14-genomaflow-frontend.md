# GenomaFlow Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Angular 18 SPA with doctor, lab_tech, and admin modules backed by the existing Fastify API, plus two backend additions (users CRUD, WS JWT query param).

**Architecture:** Lazy-loaded Angular modules per role (`/doctor`, `/lab`, `/clinic`) sharing a core layer (AuthService, WsService, JwtInterceptor) and shared standalone components. Backend adds users endpoint and WebSocket JWT query-param support.

**Tech Stack:** Angular 18 standalone, Angular Material (prebuilt theme), TailwindCSS, Jest (jest-preset-angular), Fastify (existing), Node 20 Alpine, Nginx Alpine.

---

## File Map

**Backend (additions):**
- Modify: `apps/api/src/plugins/auth.js`
- Create: `apps/api/src/routes/users.js`
- Modify: `apps/api/src/server.js`
- Create: `apps/api/tests/routes/users.test.js`

**Frontend (`apps/web/src/app/`):**
- `app.component.ts`, `app.config.ts`, `app.routes.ts`
- `core/auth/auth.service.ts`, `auth.guard.ts`, `role.guard.ts`
- `core/interceptors/jwt.interceptor.ts`
- `core/ws/ws.service.ts`
- `shared/models/api.models.ts`
- `shared/components/exam-card/`, `alert-badge/`, `risk-meter/`, `exam-status/`, `disclaimer/`
- `features/auth/login.component.ts`
- `features/doctor/doctor.routes.ts`, `patients/patient-list.component.ts`, `patients/patient-detail.component.ts`, `exams/exam-upload.component.ts`, `results/result-panel.component.ts`
- `features/lab/lab.routes.ts`, `uploads/uploads.component.ts`
- `features/clinic/clinic.routes.ts`, `dashboard/dashboard.component.ts`, `users/users.component.ts`
- `apps/web/Dockerfile`, `apps/web/nginx.conf`, `apps/web/proxy.conf.json`

---

## Task 1: Backend — WS JWT query param support

**Files:**
- Modify: `apps/api/src/plugins/auth.js`

WebSocket connections cannot send custom headers. The `authenticate` decorator must fall back to `request.query.token` when no `Authorization` header is present.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/routes/exams.test.js` (before `afterAll`):

```javascript
describe('WS /exams/subscribe', () => {
  it('rejects subscribe without any token', async () => {
    const res = await supertest(app.server)
      .get('/exams/subscribe');
    // Without upgrade headers supertest treats WS as HTTP — expects 401 or 400
    expect([400, 401]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run to confirm test state**

```bash
cd apps/api && npx jest tests/routes/exams.test.js --forceExit
```

- [ ] **Step 3: Update auth plugin**

Replace `apps/api/src/plugins/auth.js` entirely:

```javascript
const fp = require('fastify-plugin');
const jwt = require('@fastify/jwt');

module.exports = fp(async function (fastify) {
  fastify.register(jwt, { secret: process.env.JWT_SECRET });

  fastify.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch (headerErr) {
      // WebSocket connections pass token as ?token= query param
      const token = request.query && request.query.token;
      if (!token) throw headerErr;
      try {
        request.user = fastify.jwt.verify(token);
      } catch {
        throw headerErr;
      }
    }
  });
});
```

- [ ] **Step 4: Run all API tests**

```bash
cd apps/api && npx jest --forceExit
```

Expected: 13 passed (existing tests unaffected)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/plugins/auth.js apps/api/tests/routes/exams.test.js
git commit -m "feat: accept JWT from query param for WebSocket authentication"
```

---

## Task 2: Backend — Users API

**Files:**
- Create: `apps/api/src/routes/users.js`
- Modify: `apps/api/src/server.js`
- Create: `apps/api/tests/routes/users.test.js`

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/routes/users.test.js`:

```javascript
const supertest = require('supertest');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const app = require('../../src/server');
const { setupTestDb, teardownTestDb } = require('../setup');

let adminToken, doctorToken, tenantId;

beforeAll(async () => {
  await app.ready();
  const result = await setupTestDb();
  tenantId = result.tenantId;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
  const hash = await bcrypt.hash('admin123', 10);
  await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
    [tenantId, 'admin@clinic.com', hash]
  );
  await pool.end();

  const adminRes = await supertest(app.server)
    .post('/auth/login').send({ email: 'admin@clinic.com', password: 'admin123' });
  adminToken = adminRes.body.token;

  const docRes = await supertest(app.server)
    .post('/auth/login').send({ email: 'test@clinic.com', password: 'password123' });
  doctorToken = docRes.body.token;
});

afterAll(async () => { await teardownTestDb(); await app.close(); });

describe('GET /users', () => {
  it('returns users list for admin', async () => {
    const res = await supertest(app.server)
      .get('/users').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 403 for non-admin', async () => {
    const res = await supertest(app.server)
      .get('/users').set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /users', () => {
  it('creates a user as admin', async () => {
    const res = await supertest(app.server)
      .post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'newdoc@clinic.com', password: 'pass123', role: 'doctor' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('newdoc@clinic.com');
    expect(res.body.role).toBe('doctor');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  it('returns 403 for non-admin', async () => {
    const res = await supertest(app.server)
      .post('/users').set('Authorization', `Bearer ${doctorToken}`)
      .send({ email: 'x@clinic.com', password: 'pass', role: 'doctor' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid role', async () => {
    const res = await supertest(app.server)
      .post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'y@clinic.com', password: 'pass', role: 'superuser' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /users/:id', () => {
  it('deletes a user as admin', async () => {
    const created = await supertest(app.server)
      .post('/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'todel@clinic.com', password: 'pass123', role: 'lab_tech' });

    const res = await supertest(app.server)
      .delete(`/users/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 for unknown user', async () => {
    const res = await supertest(app.server)
      .delete('/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd apps/api && npx jest tests/routes/users.test.js --forceExit
```

Expected: FAIL — "Cannot find module '../../src/routes/users'"

- [ ] **Step 3: Create users route**

Create `apps/api/src/routes/users.js`:

```javascript
const bcrypt = require('bcrypt');
const { withTenant } = require('../db/tenant');

const VALID_ROLES = ['doctor', 'lab_tech', 'admin'];

module.exports = async function (fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { role, tenant_id } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Forbidden' });

    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, email, role, created_at FROM users
         WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenant_id]
      );
      return rows;
    });
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { role, tenant_id } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Forbidden' });

    const { email, password, role: newRole } = request.body;
    if (!VALID_ROLES.includes(newRole)) {
      return reply.status(400).send({ error: 'Invalid role' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, role, created_at`,
        [tenant_id, email, hash, newRole]
      );
      return rows[0];
    });

    return reply.status(201).send(user);
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { role, tenant_id, user_id } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Forbidden' });

    const { id } = request.params;
    if (id === user_id) {
      return reply.status(400).send({ error: 'Cannot delete yourself' });
    }

    try {
      await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rowCount } = await client.query(
          `DELETE FROM users WHERE id = $1 AND tenant_id = $2`,
          [id, tenant_id]
        );
        if (rowCount === 0) {
          const err = new Error('User not found');
          err.statusCode = 404;
          throw err;
        }
      });
    } catch (err) {
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      throw err;
    }

    return reply.status(204).send();
  });
};
```

- [ ] **Step 4: Register route in server.js**

Add one line to `apps/api/src/server.js` after the alerts route registration:

```javascript
app.register(require('./routes/users'), { prefix: '/users' });
```

Full updated `apps/api/src/server.js`:

```javascript
require('dotenv').config();
const Fastify = require('fastify');

const app = Fastify({ logger: true });

app.register(require('./plugins/postgres'));
app.register(require('./plugins/redis'));
app.register(require('./plugins/auth'));
app.register(require('@fastify/multipart'), {
  limits: { fileSize: 20 * 1024 * 1024 }
});
app.register(require('@fastify/websocket'));
app.register(require('./plugins/pubsub'));

app.register(require('./routes/auth'), { prefix: '/auth' });
app.register(require('./routes/patients'), { prefix: '/patients' });
app.register(require('./routes/exams'), { prefix: '/exams' });
app.register(require('./routes/alerts'), { prefix: '/alerts' });
app.register(require('./routes/users'), { prefix: '/users' });

if (require.main === module) {
  app.listen({ port: 3000, host: '0.0.0.0' });
}

module.exports = app;
```

- [ ] **Step 5: Run all tests**

```bash
cd apps/api && npx jest --forceExit
```

Expected: 19 passed (13 existing + 6 new users tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/users.js apps/api/src/server.js apps/api/tests/routes/users.test.js
git commit -m "feat: users API — GET/POST/DELETE /users with admin-only guard"
```

---

## Task 3: Angular project initialization

**Files:**
- Delete: `apps/web/src/app/app.component.ts` (legacy placeholder)
- Create: full Angular 18 project scaffold in `apps/web/`

- [ ] **Step 1: Remove legacy placeholder and scaffold Angular project**

```bash
rm -rf /home/rodrigonoma/GenomaFlow/apps/web
cd /home/rodrigonoma/GenomaFlow
npx -y @angular/cli@18 new genomaflow-web \
  --directory apps/web \
  --standalone \
  --routing \
  --style=scss \
  --skip-git \
  --skip-tests
```

Expected: `✓ Packages installed successfully.` after ~2 minutes.

- [ ] **Step 2: Install Angular Material**

```bash
cd apps/web
npx ng add @angular/material --skip-confirmation --theme=azure-blue --typography=true --animations=enabled
```

Expected: `✓ Packages installed successfully.`

- [ ] **Step 3: Install Tailwind**

```bash
cd apps/web
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init
```

- [ ] **Step 4: Configure Tailwind**

Replace `apps/web/tailwind.config.js`:

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: { extend: {} },
  plugins: [],
  corePlugins: {
    preflight: false  // avoid conflicts with Angular Material reset
  }
};
```

- [ ] **Step 5: Install Jest**

```bash
cd apps/web
npm install -D jest jest-preset-angular @types/jest
```

- [ ] **Step 6: Configure Jest**

Create `apps/web/jest.config.js`:

```javascript
module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterFramework: ['<rootDir>/setup-jest.ts'],
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      { tsconfig: '<rootDir>/tsconfig.spec.json', stringifyContentPathRegex: '\\.html$' }
    ]
  },
  moduleFileExtensions: ['ts', 'html', 'js', 'json'],
  testPathPattern: '\\.spec\\.ts$'
};
```

Create `apps/web/setup-jest.ts`:

```typescript
import 'jest-preset-angular/setup-jest';
```

- [ ] **Step 7: Update tsconfig.spec.json**

Replace `apps/web/tsconfig.spec.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./out-tsc/spec",
    "types": ["jest"]
  },
  "include": ["src/**/*.spec.ts", "src/**/*.d.ts", "setup-jest.ts"]
}
```

- [ ] **Step 8: Update package.json test script**

In `apps/web/package.json`, replace the `"test"` script:

```json
"test": "jest"
```

- [ ] **Step 9: Create dev proxy config**

Create `apps/web/proxy.conf.json`:

```json
{
  "/api": {
    "target": "http://localhost:3000",
    "pathRewrite": { "^/api": "" },
    "changeOrigin": true,
    "secure": false
  },
  "/exams/subscribe": {
    "target": "ws://localhost:3000",
    "ws": true,
    "changeOrigin": true
  }
}
```

- [ ] **Step 10: Add proxy to angular.json**

In `apps/web/angular.json`, find the `"serve"` entry under `"architect"` and add `"proxyConfig"` to `"options"`:

```json
"serve": {
  "builder": "@angular-devkit/build-angular:dev-server",
  "options": {
    "proxyConfig": "proxy.conf.json"
  },
  ...
}
```

- [ ] **Step 11: Update styles.scss**

Replace `apps/web/src/styles.scss`:

```scss
@tailwind base;
@tailwind components;
@tailwind utilities;

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: Roboto, sans-serif;
  background: #f5f5f5;
}

.page-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}
```

- [ ] **Step 12: Verify build**

```bash
cd apps/web && npx ng build --configuration=development 2>&1 | tail -5
```

Expected: `✓ Building...` completes without errors.

- [ ] **Step 13: Commit**

```bash
cd /home/rodrigonoma/GenomaFlow
git add apps/web/
git commit -m "feat: scaffold Angular 18 project with Material, Tailwind, Jest"
```

---

## Task 4: App shell — config, routes, environments, proxy

**Files:**
- Modify: `apps/web/src/app/app.component.ts`
- Create: `apps/web/src/app/app.config.ts`
- Create: `apps/web/src/app/app.routes.ts`
- Create: `apps/web/src/environments/environment.ts`
- Create: `apps/web/src/environments/environment.prod.ts`

- [ ] **Step 1: Create environments**

Create `apps/web/src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: '/api'
};
```

Create `apps/web/src/environments/environment.prod.ts`:

```typescript
export const environment = {
  production: true,
  apiUrl: '/api'
};
```

- [ ] **Step 2: Create app.routes.ts**

Replace `apps/web/src/app/app.routes.ts`:

```typescript
import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'doctor',
    canActivate: [authGuard, roleGuard('doctor')],
    loadChildren: () =>
      import('./features/doctor/doctor.routes').then(m => m.DOCTOR_ROUTES)
  },
  {
    path: 'lab',
    canActivate: [authGuard, roleGuard('lab_tech')],
    loadChildren: () =>
      import('./features/lab/lab.routes').then(m => m.LAB_ROUTES)
  },
  {
    path: 'clinic',
    canActivate: [authGuard, roleGuard('admin')],
    loadChildren: () =>
      import('./features/clinic/clinic.routes').then(m => m.CLINIC_ROUTES)
  },
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: '**', redirectTo: 'login' }
];
```

- [ ] **Step 3: Create app.config.ts**

Replace `apps/web/src/app/app.config.ts`:

```typescript
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { routes } from './app.routes';
import { jwtInterceptor } from './core/interceptors/jwt.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([jwtInterceptor])),
    provideAnimationsAsync()
  ]
};
```

- [ ] **Step 4: Update app.component.ts**

Replace `apps/web/src/app/app.component.ts`:

```typescript
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />'
})
export class AppComponent {}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/
git commit -m "feat: app shell — routes, config, environments"
```

---

## Task 5: API Models

**Files:**
- Create: `apps/web/src/app/shared/models/api.models.ts`

- [ ] **Step 1: Create models**

```bash
mkdir -p apps/web/src/app/shared/models
```

Create `apps/web/src/app/shared/models/api.models.ts`:

```typescript
export interface Patient {
  id: string;
  name: string;
  sex: string;
  birth_date: string;
  cpf_hash?: string;
  created_at: string;
}

export interface Alert {
  marker: string;
  value: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ClinicalResult {
  agent_type: string;
  interpretation: string;
  risk_scores: Record<string, string>;
  alerts: Alert[];
  disclaimer: string;
}

export interface Exam {
  id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  source: string;
  file_path: string;
  created_at: string;
  updated_at: string;
  results: ClinicalResult[] | null;
}

export interface User {
  id: string;
  email: string;
  role: 'doctor' | 'lab_tech' | 'admin';
  created_at: string;
}

export interface JwtPayload {
  user_id: string;
  tenant_id: string;
  role: 'doctor' | 'lab_tech' | 'admin';
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/shared/models/api.models.ts
git commit -m "feat: shared API models — Patient, Exam, ClinicalResult, Alert, User"
```

---

## Task 6: AuthService + Guards

**Files:**
- Create: `apps/web/src/app/core/auth/auth.service.ts`
- Create: `apps/web/src/app/core/auth/auth.guard.ts`
- Create: `apps/web/src/app/core/auth/role.guard.ts`
- Create: `apps/web/src/app/core/auth/auth.service.spec.ts`

- [ ] **Step 1: Write failing test**

```bash
mkdir -p apps/web/src/app/core/auth
```

Create `apps/web/src/app/core/auth/auth.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AuthService } from './auth.service';
import { WsService } from '../ws/ws.service';

const mockWs = { connect: jest.fn(), disconnect: jest.fn() };

// Fake JWT: header.payload.sig — payload = { user_id, tenant_id, role }
const fakeToken = 'x.' + btoa(JSON.stringify({
  user_id: 'u1', tenant_id: 't1', role: 'doctor'
})) + '.sig';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, RouterTestingModule],
      providers: [
        AuthService,
        { provide: WsService, useValue: mockWs }
      ]
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => { http.verify(); localStorage.clear(); });

  it('currentUser is null when no token in storage', () => {
    expect(service.currentUser).toBeNull();
  });

  it('login stores token and emits currentUser', (done) => {
    service.login('doc@clinic.com', 'pass123').subscribe(() => {
      expect(service.currentUser?.role).toBe('doctor');
      expect(localStorage.getItem('token')).toBe(fakeToken);
      done();
    });
    http.expectOne('/api/auth/login').flush({ token: fakeToken });
  });

  it('logout clears token and currentUser', (done) => {
    service.login('doc@clinic.com', 'pass123').subscribe(() => {
      service.logout();
      expect(service.currentUser).toBeNull();
      expect(localStorage.getItem('token')).toBeNull();
      done();
    });
    http.expectOne('/api/auth/login').flush({ token: fakeToken });
  });
});
```

- [ ] **Step 2: Run to confirm test fails**

```bash
cd apps/web && npm test -- --testPathPattern=auth.service.spec
```

Expected: FAIL — "Cannot find module './auth.service'"

- [ ] **Step 3: Create AuthService**

Create `apps/web/src/app/core/auth/auth.service.ts`:

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { JwtPayload } from '../../shared/models/api.models';
import { WsService } from '../ws/ws.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private ws = inject(WsService);

  private currentUserSubject = new BehaviorSubject<JwtPayload | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  constructor() {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        this.currentUserSubject.next(this.decode(token));
        this.ws.connect(token);
      } catch {
        localStorage.removeItem('token');
      }
    }
  }

  login(email: string, password: string): Observable<void> {
    return this.http
      .post<{ token: string }>(`${environment.apiUrl}/auth/login`, { email, password })
      .pipe(
        tap(({ token }) => {
          localStorage.setItem('token', token);
          const payload = this.decode(token);
          this.currentUserSubject.next(payload);
          this.ws.connect(token);
        }),
        map(({ token }) => {
          const payload = this.decode(token);
          const path =
            payload.role === 'doctor' ? '/doctor/patients' :
            payload.role === 'lab_tech' ? '/lab/uploads' :
            '/clinic/dashboard';
          this.router.navigate([path]);
        })
      );
  }

  logout(): void {
    localStorage.removeItem('token');
    this.ws.disconnect();
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  get currentUser(): JwtPayload | null {
    return this.currentUserSubject.value;
  }

  private decode(token: string): JwtPayload {
    return JSON.parse(atob(token.split('.')[1]));
  }
}
```

- [ ] **Step 4: Create AuthGuard**

Create `apps/web/src/app/core/auth/auth.guard.ts`:

```typescript
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.currentUser) {
    router.navigate(['/login']);
    return false;
  }
  return true;
};
```

- [ ] **Step 5: Create RoleGuard**

Create `apps/web/src/app/core/auth/role.guard.ts`:

```typescript
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export function roleGuard(requiredRole: string): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.currentUser || auth.currentUser.role !== requiredRole) {
      router.navigate(['/login']);
      return false;
    }
    return true;
  };
}
```

- [ ] **Step 6: Run tests**

```bash
cd apps/web && npm test -- --testPathPattern=auth.service.spec
```

Expected: 3 passed

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/core/auth/
git commit -m "feat: AuthService, authGuard, roleGuard"
```

---

## Task 7: JWT Interceptor

**Files:**
- Create: `apps/web/src/app/core/interceptors/jwt.interceptor.ts`
- Create: `apps/web/src/app/core/interceptors/jwt.interceptor.spec.ts`

- [ ] **Step 1: Write failing test**

```bash
mkdir -p apps/web/src/app/core/interceptors
```

Create `apps/web/src/app/core/interceptors/jwt.interceptor.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { jwtInterceptor } from './jwt.interceptor';
import { AuthService } from '../auth/auth.service';
import { WsService } from '../ws/ws.service';

const mockAuth = { getToken: jest.fn(), logout: jest.fn(), currentUser: null };
const mockWs = { connect: jest.fn(), disconnect: jest.fn() };

describe('jwtInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      providers: [
        provideHttpClient(withInterceptors([jwtInterceptor])),
        { provide: AuthService, useValue: mockAuth },
        { provide: WsService, useValue: mockWs }
      ]
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('adds Authorization header when token exists', () => {
    mockAuth.getToken.mockReturnValue('mytoken');
    http.get('/api/patients').subscribe();
    const req = controller.expectOne('/api/patients');
    expect(req.request.headers.get('Authorization')).toBe('Bearer mytoken');
    req.flush([]);
  });

  it('does not add header when no token', () => {
    mockAuth.getToken.mockReturnValue(null);
    http.get('/api/patients').subscribe();
    const req = controller.expectOne('/api/patients');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
  });

  it('calls logout on 401 response', () => {
    mockAuth.getToken.mockReturnValue('expired');
    http.get('/api/patients').subscribe({ error: () => {} });
    const req = controller.expectOne('/api/patients');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    expect(mockAuth.logout).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd apps/web && npm test -- --testPathPattern=jwt.interceptor.spec
```

- [ ] **Step 3: Create interceptor**

Create `apps/web/src/app/core/interceptors/jwt.interceptor.ts`:

```typescript
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.getToken();

  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) auth.logout();
      return throwError(() => error);
    })
  );
};
```

- [ ] **Step 4: Run tests**

```bash
cd apps/web && npm test -- --testPathPattern=jwt.interceptor.spec
```

Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/core/interceptors/
git commit -m "feat: JWT interceptor — injects token, handles 401 logout"
```

---

## Task 8: WsService

**Files:**
- Create: `apps/web/src/app/core/ws/ws.service.ts`
- Create: `apps/web/src/app/core/ws/ws.service.spec.ts`

- [ ] **Step 1: Write failing test**

```bash
mkdir -p apps/web/src/app/core/ws
```

Create `apps/web/src/app/core/ws/ws.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { WsService } from './ws.service';

describe('WsService', () => {
  let service: WsService;
  let mockWs: any;

  beforeEach(() => {
    mockWs = {
      onopen: null, onmessage: null, onclose: null,
      close: jest.fn()
    };
    (global as any).WebSocket = jest.fn(() => mockWs);

    TestBed.configureTestingModule({ providers: [WsService] });
    service = TestBed.inject(WsService);
  });

  it('opens WebSocket on connect', () => {
    service.connect('mytoken');
    expect(WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('/exams/subscribe?token=mytoken')
    );
  });

  it('emits examUpdates$ on message', (done) => {
    service.connect('tok');
    service.examUpdates$.subscribe(data => {
      expect(data.exam_id).toBe('abc');
      done();
    });
    mockWs.onmessage({ data: JSON.stringify({ exam_id: 'abc' }) });
  });

  it('does not reconnect after disconnect', () => {
    jest.useFakeTimers();
    service.connect('tok');
    service.disconnect();
    mockWs.onclose();
    jest.runAllTimers();
    expect(WebSocket).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd apps/web && npm test -- --testPathPattern=ws.service.spec
```

- [ ] **Step 3: Create WsService**

Create `apps/web/src/app/core/ws/ws.service.ts`:

```typescript
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class WsService {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private destroyed = false;
  private token: string | null = null;

  examUpdates$ = new Subject<{ exam_id: string }>();

  connect(token: string): void {
    this.disconnect();
    this.token = token;
    this.destroyed = false;
    this.reconnectDelay = 1000;
    this.openConnection();
  }

  private openConnection(): void {
    if (!this.token || this.destroyed) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/exams/subscribe?token=${this.token}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => { this.reconnectDelay = 1000; };

    this.ws.onmessage = (event) => {
      try {
        this.examUpdates$.next(JSON.parse(event.data));
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = () => {
      if (!this.destroyed) {
        setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
          this.openConnection();
        }, this.reconnectDelay);
      }
    };
  }

  disconnect(): void {
    this.destroyed = true;
    this.token = null;
    this.ws?.close();
    this.ws = null;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/web && npm test -- --testPathPattern=ws.service.spec
```

Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/core/ws/
git commit -m "feat: WsService — singleton WebSocket with exponential backoff reconnect"
```

---

## Task 9: Login Component

**Files:**
- Create: `apps/web/src/app/features/auth/login.component.ts`
- Create: `apps/web/src/app/features/auth/login.component.spec.ts`

- [ ] **Step 1: Write failing test**

```bash
mkdir -p apps/web/src/app/features/auth
```

Create `apps/web/src/app/features/auth/login.component.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth/auth.service';

const mockAuth = {
  login: jest.fn(),
  currentUser: null,
  currentUser$: of(null)
};

describe('LoginComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoginComponent, RouterTestingModule],
      providers: [{ provide: AuthService, useValue: mockAuth }]
    });
  });

  it('calls auth.login with form values', () => {
    mockAuth.login.mockReturnValue(of(undefined));
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;
    component.email = 'doc@clinic.com';
    component.password = 'pass';
    component.submit();
    expect(mockAuth.login).toHaveBeenCalledWith('doc@clinic.com', 'pass');
  });

  it('sets error message on login failure', (done) => {
    mockAuth.login.mockReturnValue(throwError(() => ({ status: 401 })));
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;
    component.email = 'x';
    component.password = 'y';
    component.submit();
    setTimeout(() => {
      expect(component.error).toBeTruthy();
      done();
    }, 0);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd apps/web && npm test -- --testPathPattern=login.component.spec
```

- [ ] **Step 3: Create LoginComponent**

Create `apps/web/src/app/features/auth/login.component.ts`:

```typescript
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatProgressSpinnerModule
  ],
  template: `
    <div class="flex items-center justify-center min-h-screen">
      <mat-card class="w-full max-w-sm p-6">
        <mat-card-header>
          <mat-card-title class="text-2xl mb-4">GenomaFlow</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <form (ngSubmit)="submit()" class="flex flex-col gap-4">
            <mat-form-field>
              <mat-label>E-mail</mat-label>
              <input matInput type="email" [(ngModel)]="email" name="email" required />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Senha</mat-label>
              <input matInput type="password" [(ngModel)]="password" name="password" required />
            </mat-form-field>
            @if (error) {
              <p class="text-red-600 text-sm">{{ error }}</p>
            }
            <button mat-flat-button color="primary" type="submit" [disabled]="loading">
              @if (loading) { <mat-spinner diameter="20" /> } @else { Entrar }
            </button>
          </form>
        </mat-card-content>
      </mat-card>
    </div>
  `
})
export class LoginComponent {
  private auth = inject(AuthService);

  email = '';
  password = '';
  error = '';
  loading = false;

  submit(): void {
    this.error = '';
    this.loading = true;
    this.auth.login(this.email, this.password).subscribe({
      next: () => { this.loading = false; },
      error: () => {
        this.loading = false;
        this.error = 'E-mail ou senha inválidos.';
      }
    });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/web && npm test -- --testPathPattern=login.component.spec
```

Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/auth/
git commit -m "feat: login component with Material form and error handling"
```

---

## Task 10: Shared Components

**Files:**
- Create: `apps/web/src/app/shared/components/alert-badge/alert-badge.component.ts`
- Create: `apps/web/src/app/shared/components/exam-status/exam-status.component.ts`
- Create: `apps/web/src/app/shared/components/risk-meter/risk-meter.component.ts`
- Create: `apps/web/src/app/shared/components/disclaimer/disclaimer.component.ts`
- Create: `apps/web/src/app/shared/components/exam-card/exam-card.component.ts`
- Create: `apps/web/src/app/shared/components/alert-badge/alert-badge.component.spec.ts`

- [ ] **Step 1: Write failing test for AlertBadge**

```bash
mkdir -p apps/web/src/app/shared/components/{alert-badge,exam-status,risk-meter,disclaimer,exam-card}
```

Create `apps/web/src/app/shared/components/alert-badge/alert-badge.component.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { AlertBadgeComponent } from './alert-badge.component';

describe('AlertBadgeComponent', () => {
  it('renders severity label', () => {
    TestBed.configureTestingModule({ imports: [AlertBadgeComponent] });
    const fixture = TestBed.createComponent(AlertBadgeComponent);
    fixture.componentInstance.severity = 'critical';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('critical');
  });
});
```

- [ ] **Step 2: Create AlertBadgeComponent**

Create `apps/web/src/app/shared/components/alert-badge/alert-badge.component.ts`:

```typescript
import { Component, Input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';

type Severity = 'low' | 'medium' | 'high' | 'critical';

@Component({
  selector: 'app-alert-badge',
  standalone: true,
  imports: [MatChipsModule],
  template: `
    <mat-chip [class]="colorClass">{{ severity }}</mat-chip>
  `,
  styles: [`
    .low { background: #e0e0e0 !important; }
    .medium { background: #fff3e0 !important; color: #e65100 !important; }
    .high { background: #ffe0b2 !important; color: #bf360c !important; }
    .critical { background: #ffebee !important; color: #b71c1c !important; font-weight: bold; }
  `]
})
export class AlertBadgeComponent {
  @Input() severity: Severity = 'low';
  get colorClass(): string { return this.severity; }
}
```

- [ ] **Step 3: Create ExamStatusComponent**

Create `apps/web/src/app/shared/components/exam-status/exam-status.component.ts`:

```typescript
import { Component, Input } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';

type Status = 'pending' | 'processing' | 'done' | 'error';

@Component({
  selector: 'app-exam-status',
  standalone: true,
  imports: [MatProgressSpinnerModule, MatIconModule],
  template: `
    @switch (status) {
      @case ('pending') { <mat-spinner diameter="16" /> }
      @case ('processing') { <mat-spinner diameter="16" mode="indeterminate" /> }
      @case ('done') { <mat-icon class="text-green-600">check_circle</mat-icon> }
      @case ('error') { <mat-icon class="text-red-600">error</mat-icon> }
    }
  `
})
export class ExamStatusComponent {
  @Input() status: Status = 'pending';
}
```

- [ ] **Step 4: Create RiskMeterComponent**

Create `apps/web/src/app/shared/components/risk-meter/risk-meter.component.ts`:

```typescript
import { Component, Input } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';

const RISK_VALUES: Record<string, number> = {
  baixo: 20, low: 20,
  moderado: 50, medium: 50,
  alto: 80, high: 80,
  crítico: 100, critical: 100
};

@Component({
  selector: 'app-risk-meter',
  standalone: true,
  imports: [MatProgressBarModule],
  template: `
    <div class="mb-2">
      <span class="text-sm font-medium">{{ label }}: </span>
      <span class="text-sm text-gray-600">{{ value }}</span>
    </div>
    <mat-progress-bar [value]="numericValue" [color]="barColor" />
  `
})
export class RiskMeterComponent {
  @Input() label = '';
  @Input() value = '';

  get numericValue(): number {
    return RISK_VALUES[this.value?.toLowerCase()] ?? 0;
  }

  get barColor(): 'primary' | 'accent' | 'warn' {
    const v = this.numericValue;
    if (v >= 80) return 'warn';
    if (v >= 50) return 'accent';
    return 'primary';
  }
}
```

- [ ] **Step 5: Create DisclaimerComponent**

Create `apps/web/src/app/shared/components/disclaimer/disclaimer.component.ts`:

```typescript
import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-disclaimer',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div class="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded mt-4">
      <mat-icon class="text-amber-600 text-base leading-tight">info</mat-icon>
      <p class="text-xs text-amber-800 m-0">
        Esta análise é um suporte à decisão clínica e não substitui avaliação médica profissional.
      </p>
    </div>
  `
})
export class DisclaimerComponent {}
```

- [ ] **Step 6: Create ExamCardComponent**

Create `apps/web/src/app/shared/components/exam-card/exam-card.component.ts`:

```typescript
import { Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { ExamStatusComponent } from '../exam-status/exam-status.component';
import { Exam } from '../../models/api.models';

@Component({
  selector: 'app-exam-card',
  standalone: true,
  imports: [RouterModule, MatCardModule, MatButtonModule, ExamStatusComponent],
  template: `
    <mat-card class="mb-2">
      <mat-card-content class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3">
          <app-exam-status [status]="exam.status" />
          <div>
            <div class="font-medium text-sm">{{ filename }}</div>
            <div class="text-xs text-gray-500">{{ exam.created_at | date:'dd/MM/yyyy HH:mm' }}</div>
          </div>
        </div>
        @if (exam.status === 'done') {
          <a mat-stroked-button [routerLink]="['/doctor/results', exam.id]">Ver resultado</a>
        }
      </mat-card-content>
    </mat-card>
  `
})
export class ExamCardComponent {
  @Input() exam!: Exam;
  get filename(): string {
    return this.exam.file_path?.split('/').pop() ?? 'exame.pdf';
  }
}
```

Note: `date` pipe requires `DatePipe` import. Add `DatePipe` to imports array.

Updated imports for ExamCardComponent:

```typescript
import { DatePipe } from '@angular/common';
// ...
imports: [RouterModule, MatCardModule, MatButtonModule, ExamStatusComponent, DatePipe],
```

- [ ] **Step 7: Run tests**

```bash
cd apps/web && npm test -- --testPathPattern=alert-badge.component.spec
```

Expected: 1 passed

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/shared/
git commit -m "feat: shared components — AlertBadge, ExamStatus, RiskMeter, Disclaimer, ExamCard"
```

---

## Task 11: Doctor — Patient List

**Files:**
- Create: `apps/web/src/app/features/doctor/doctor.routes.ts`
- Create: `apps/web/src/app/features/doctor/patients/patient-list.component.ts`
- Create: `apps/web/src/app/features/doctor/patients/patient-list.component.spec.ts`

- [ ] **Step 1: Write failing test**

```bash
mkdir -p apps/web/src/app/features/doctor/patients
```

Create `apps/web/src/app/features/doctor/patients/patient-list.component.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { PatientListComponent } from './patient-list.component';
import { AuthService } from '../../../core/auth/auth.service';
import { WsService } from '../../../core/ws/ws.service';

const mockAuth = { getToken: () => 'tok', logout: jest.fn(), currentUser: { role: 'doctor' }, currentUser$: { subscribe: jest.fn() } };
const mockWs = { connect: jest.fn(), disconnect: jest.fn(), examUpdates$: { pipe: jest.fn(() => ({ subscribe: jest.fn() })) } };

describe('PatientListComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PatientListComponent, RouterTestingModule, HttpClientTestingModule],
      providers: [
        { provide: AuthService, useValue: mockAuth },
        { provide: WsService, useValue: mockWs }
      ]
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads patients on init', () => {
    const fixture = TestBed.createComponent(PatientListComponent);
    fixture.detectChanges();
    const req = http.expectOne('/api/patients');
    req.flush([{ id: '1', name: 'João', sex: 'M', birth_date: '1980-01-01', created_at: '' }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('João');
  });
});
```

- [ ] **Step 2: Create doctor.routes.ts**

Create `apps/web/src/app/features/doctor/doctor.routes.ts`:

```typescript
import { Routes } from '@angular/router';

export const DOCTOR_ROUTES: Routes = [
  {
    path: 'patients',
    loadComponent: () =>
      import('./patients/patient-list.component').then(m => m.PatientListComponent)
  },
  {
    path: 'patients/:id',
    loadComponent: () =>
      import('./patients/patient-detail.component').then(m => m.PatientDetailComponent)
  },
  {
    path: 'patients/:id/exams',
    loadComponent: () =>
      import('./exams/exam-upload.component').then(m => m.ExamUploadComponent)
  },
  {
    path: 'results/:examId',
    loadComponent: () =>
      import('./results/result-panel.component').then(m => m.ResultPanelComponent)
  },
  { path: '', redirectTo: 'patients', pathMatch: 'full' }
];
```

- [ ] **Step 3: Create PatientListComponent**

Create `apps/web/src/app/features/doctor/patients/patient-list.component.ts`:

```typescript
import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../../environments/environment';
import { Patient } from '../../../shared/models/api.models';

@Component({
  selector: 'app-patient-list',
  standalone: true,
  imports: [
    RouterModule, FormsModule,
    MatTableModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule
  ],
  template: `
    <div class="page-container">
      <div class="flex justify-between items-center mb-4">
        <h1 class="text-2xl font-semibold">Pacientes</h1>
      </div>

      <mat-form-field class="w-full mb-4">
        <mat-label>Buscar paciente</mat-label>
        <input matInput [(ngModel)]="search" (ngModelChange)="applyFilter()" placeholder="Nome..." />
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>

      <table mat-table [dataSource]="filtered" class="w-full">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Nome</th>
          <td mat-cell *matCellDef="let p">{{ p.name }}</td>
        </ng-container>
        <ng-container matColumnDef="sex">
          <th mat-header-cell *matHeaderCellDef>Sexo</th>
          <td mat-cell *matCellDef="let p">{{ p.sex }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let p">
            <a mat-button [routerLink]="['/doctor/patients', p.id]">Ver perfil</a>
            <a mat-stroked-button [routerLink]="['/doctor/patients', p.id, 'exams']" class="ml-2">Novo exame</a>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns;" class="cursor-pointer hover:bg-gray-50"></tr>
      </table>
    </div>
  `
})
export class PatientListComponent implements OnInit {
  private http = inject(HttpClient);
  patients: Patient[] = [];
  filtered: Patient[] = [];
  search = '';
  columns = ['name', 'sex', 'actions'];

  ngOnInit(): void {
    this.http.get<Patient[]>(`${environment.apiUrl}/patients`).subscribe(p => {
      this.patients = p;
      this.filtered = p;
    });
  }

  applyFilter(): void {
    this.filtered = this.patients.filter(p =>
      p.name.toLowerCase().includes(this.search.toLowerCase())
    );
  }
}
```

- [ ] **Step 4: Run test**

```bash
cd apps/web && npm test -- --testPathPattern=patient-list.component.spec
```

Expected: 1 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/doctor/
git commit -m "feat: doctor patient list with search"
```

---

## Task 12: Doctor — Patient Detail

**Files:**
- Create: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`

- [ ] **Step 1: Create component**

Create `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`:

```typescript
import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { ExamCardComponent } from '../../../shared/components/exam-card/exam-card.component';
import { environment } from '../../../../environments/environment';
import { Patient, Exam } from '../../../shared/models/api.models';

@Component({
  selector: 'app-patient-detail',
  standalone: true,
  imports: [RouterModule, DatePipe, MatCardModule, MatButtonModule, MatListModule, ExamCardComponent],
  template: `
    <div class="page-container">
      @if (patient) {
        <div class="flex justify-between items-start mb-6">
          <div>
            <h1 class="text-2xl font-semibold">{{ patient.name }}</h1>
            <p class="text-gray-600">
              Sexo: {{ patient.sex }} &nbsp;|&nbsp;
              Nascimento: {{ patient.birth_date | date:'dd/MM/yyyy' }}
            </p>
          </div>
          <a mat-flat-button color="primary"
             [routerLink]="['/doctor/patients', patient.id, 'exams']">
            Enviar novo exame
          </a>
        </div>

        <h2 class="text-lg font-medium mb-3">Histórico de exames</h2>
        @for (exam of exams; track exam.id) {
          <app-exam-card [exam]="exam" />
        }
        @if (exams.length === 0) {
          <p class="text-gray-500">Nenhum exame encontrado.</p>
        }
      }
    </div>
  `
})
export class PatientDetailComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  patient: Patient | null = null;
  exams: Exam[] = [];

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.http.get<Patient>(`${environment.apiUrl}/patients/${id}`)
      .subscribe(p => this.patient = p);
    this.http.get<Exam[]>(`${environment.apiUrl}/exams?patient_id=${id}`)
      .subscribe(e => this.exams = e);
  }
}
```

Note: `GET /exams?patient_id=` needs to be added to the backend if it doesn't exist. If the backend only returns all exams for the tenant, filter client-side. Replace the subscribe block:

```typescript
this.http.get<Exam[]>(`${environment.apiUrl}/exams`)
  .subscribe(all => this.exams = all.filter(e => (e as any).patient_id === id));
```

> **Backend note:** The `GET /exams` route currently returns a single exam by `:id`. For the patient detail view to list all exams for a patient, add `GET /exams?patient_id=` to the backend. This is captured as a backend gap — implement it if the patient detail page needs exam history.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/features/doctor/patients/patient-detail.component.ts
git commit -m "feat: doctor patient detail with exam history"
```

---

## Task 13: Doctor — Exam Upload

**Files:**
- Create: `apps/web/src/app/features/doctor/exams/exam-upload.component.ts`

- [ ] **Step 1: Create component**

```bash
mkdir -p apps/web/src/app/features/doctor/exams
```

Create `apps/web/src/app/features/doctor/exams/exam-upload.component.ts`:

```typescript
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription, filter } from 'rxjs';
import { WsService } from '../../../core/ws/ws.service';
import { ExamCardComponent } from '../../../shared/components/exam-card/exam-card.component';
import { environment } from '../../../../environments/environment';
import { Exam } from '../../../shared/models/api.models';

@Component({
  selector: 'app-exam-upload',
  standalone: true,
  imports: [RouterModule, MatButtonModule, MatIconModule, MatSnackBarModule, ExamCardComponent],
  template: `
    <div class="page-container">
      <h1 class="text-2xl font-semibold mb-6">Enviar exame</h1>

      <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-6">
        <mat-icon class="text-4xl text-gray-400 mb-2">upload_file</mat-icon>
        <p class="text-gray-600 mb-4">Selecione um arquivo PDF</p>
        <input #fileInput type="file" accept=".pdf" class="hidden" (change)="onFileSelected($event)" />
        <button mat-stroked-button (click)="fileInput.click()">Selecionar PDF</button>
        @if (selectedFile) {
          <p class="mt-2 text-sm text-green-700">{{ selectedFile.name }}</p>
        }
      </div>

      <button mat-flat-button color="primary" [disabled]="!selectedFile || uploading" (click)="upload()">
        {{ uploading ? 'Enviando...' : 'Enviar exame' }}
      </button>

      @if (exams.length > 0) {
        <h2 class="text-lg font-medium mt-8 mb-3">Exames enviados</h2>
        @for (exam of exams; track exam.id) {
          <app-exam-card [exam]="exam" />
        }
      }
    </div>
  `
})
export class ExamUploadComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private ws = inject(WsService);
  private snackBar = inject(MatSnackBar);

  patientId = '';
  selectedFile: File | null = null;
  uploading = false;
  exams: Exam[] = [];
  private wsSub?: Subscription;

  ngOnInit(): void {
    this.patientId = this.route.snapshot.paramMap.get('id')!;
    this.wsSub = this.ws.examUpdates$
      .pipe(filter(({ exam_id }) => this.exams.some(e => e.id === exam_id)))
      .subscribe(({ exam_id }) => {
        this.refreshExam(exam_id);
        this.snackBar.open('Resultado disponível!', 'Ver', { duration: 5000 })
          .onAction().subscribe(() =>
            window.location.href = `/doctor/results/${exam_id}`
          );
      });
  }

  ngOnDestroy(): void { this.wsSub?.unsubscribe(); }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  upload(): void {
    if (!this.selectedFile) return;
    this.uploading = true;
    const form = new FormData();
    form.append('patient_id', this.patientId);
    form.append('file', this.selectedFile);

    this.http.post<{ exam_id: string; status: string }>(
      `${environment.apiUrl}/exams`, form
    ).subscribe({
      next: ({ exam_id, status }) => {
        this.exams.unshift({ id: exam_id, status: status as any, file_path: this.selectedFile!.name, created_at: new Date().toISOString(), updated_at: '', source: 'upload', results: null });
        this.selectedFile = null;
        this.uploading = false;
      },
      error: () => { this.uploading = false; }
    });
  }

  private refreshExam(examId: string): void {
    this.http.get<Exam>(`${environment.apiUrl}/exams/${examId}`).subscribe(exam => {
      const idx = this.exams.findIndex(e => e.id === examId);
      if (idx !== -1) this.exams[idx] = exam;
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/features/doctor/exams/
git commit -m "feat: exam upload with real-time status via WebSocket"
```

---

## Task 14: Doctor — Clinical Result Panel

**Files:**
- Create: `apps/web/src/app/features/doctor/results/result-panel.component.ts`

- [ ] **Step 1: Create component**

```bash
mkdir -p apps/web/src/app/features/doctor/results
```

Create `apps/web/src/app/features/doctor/results/result-panel.component.ts`:

```typescript
import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { AlertBadgeComponent } from '../../../shared/components/alert-badge/alert-badge.component';
import { RiskMeterComponent } from '../../../shared/components/risk-meter/risk-meter.component';
import { DisclaimerComponent } from '../../../shared/components/disclaimer/disclaimer.component';
import { environment } from '../../../../environments/environment';
import { Exam, ClinicalResult } from '../../../shared/models/api.models';

@Component({
  selector: 'app-result-panel',
  standalone: true,
  imports: [
    DatePipe, FormsModule,
    MatCardModule, MatSelectModule, MatDividerModule,
    AlertBadgeComponent, RiskMeterComponent, DisclaimerComponent
  ],
  template: `
    <div class="page-container">
      @if (exam) {
        <h1 class="text-2xl font-semibold mb-6">Resultado do Exame</h1>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <!-- Left column -->
          <div class="md:col-span-1">
            <mat-card class="p-4">
              <h3 class="font-medium mb-2">Dados do exame</h3>
              <p class="text-sm text-gray-600">Data: {{ exam.created_at | date:'dd/MM/yyyy HH:mm' }}</p>
              <p class="text-sm text-gray-600">Status: {{ exam.status }}</p>

              @if (allExams.length > 1) {
                <mat-divider class="my-3" />
                <mat-form-field class="w-full">
                  <mat-label>Comparar com</mat-label>
                  <mat-select [(ngModel)]="compareExamId" (ngModelChange)="loadCompare()">
                    @for (e of allExams; track e.id) {
                      @if (e.id !== exam.id) {
                        <mat-option [value]="e.id">{{ e.created_at | date:'dd/MM/yy' }}</mat-option>
                      }
                    }
                  </mat-select>
                </mat-form-field>
              }
            </mat-card>
          </div>

          <!-- Right column(s) -->
          <div [class]="compareExam ? 'md:col-span-1' : 'md:col-span-2'">
            <ng-container [ngTemplateOutlet]="resultTpl" [ngTemplateOutletContext]="{ $implicit: exam }" />
          </div>

          @if (compareExam) {
            <div class="md:col-span-1">
              <p class="text-xs text-gray-500 mb-2">Comparando: {{ compareExam.created_at | date:'dd/MM/yyyy' }}</p>
              <ng-container [ngTemplateOutlet]="resultTpl" [ngTemplateOutletContext]="{ $implicit: compareExam }" />
            </div>
          }
        </div>

        <ng-template #resultTpl let-e>
          @for (result of e.results ?? []; track result.agent_type) {
            <mat-card class="p-4 mb-4">
              <h3 class="font-medium mb-3 capitalize">{{ result.agent_type }}</h3>

              @if (result.alerts?.length) {
                <div class="mb-3">
                  <p class="text-sm font-medium mb-1">Alertas</p>
                  @for (alert of result.alerts; track alert.marker) {
                    <div class="flex items-center gap-2 mb-1">
                      <app-alert-badge [severity]="alert.severity" />
                      <span class="text-sm">{{ alert.marker }}: {{ alert.value }}</span>
                    </div>
                  }
                </div>
              }

              @if (result.risk_scores && objectKeys(result.risk_scores).length) {
                <div class="mb-3">
                  <p class="text-sm font-medium mb-2">Scores de risco</p>
                  @for (key of objectKeys(result.risk_scores); track key) {
                    <app-risk-meter [label]="key" [value]="result.risk_scores[key]" />
                  }
                </div>
              }

              <mat-divider class="my-3" />
              <p class="text-sm text-gray-700 whitespace-pre-wrap">{{ result.interpretation }}</p>
              <app-disclaimer />
            </mat-card>
          }
        </ng-template>
      }
    </div>
  `
})
export class ResultPanelComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  exam: Exam | null = null;
  compareExam: Exam | null = null;
  compareExamId: string | null = null;
  allExams: Exam[] = [];

  objectKeys = Object.keys;

  ngOnInit(): void {
    const examId = this.route.snapshot.paramMap.get('examId')!;
    this.http.get<Exam>(`${environment.apiUrl}/exams/${examId}`).subscribe(e => {
      this.exam = e;
    });
  }

  loadCompare(): void {
    if (!this.compareExamId) { this.compareExam = null; return; }
    this.http.get<Exam>(`${environment.apiUrl}/exams/${this.compareExamId}`)
      .subscribe(e => this.compareExam = e);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/features/doctor/results/
git commit -m "feat: clinical result panel with comparison mode"
```

---

## Task 15: Lab — Uploads + Queue

**Files:**
- Create: `apps/web/src/app/features/lab/lab.routes.ts`
- Create: `apps/web/src/app/features/lab/uploads/uploads.component.ts`

- [ ] **Step 1: Create lab routes**

```bash
mkdir -p apps/web/src/app/features/lab/uploads
```

Create `apps/web/src/app/features/lab/lab.routes.ts`:

```typescript
import { Routes } from '@angular/router';

export const LAB_ROUTES: Routes = [
  {
    path: 'uploads',
    loadComponent: () =>
      import('./uploads/uploads.component').then(m => m.UploadsComponent)
  },
  { path: '', redirectTo: 'uploads', pathMatch: 'full' }
];
```

- [ ] **Step 2: Create UploadsComponent**

Create `apps/web/src/app/features/lab/uploads/uploads.component.ts`:

```typescript
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { WsService } from '../../../core/ws/ws.service';
import { ExamStatusComponent } from '../../../shared/components/exam-status/exam-status.component';
import { environment } from '../../../../environments/environment';
import { Patient, Exam } from '../../../shared/models/api.models';

interface QueueEntry {
  exam_id: string;
  filename: string;
  patient_name: string;
  patient_id: string;
  status: Exam['status'];
  agents: string;
  created_at: string;
  error_message?: string;
}

@Component({
  selector: 'app-uploads',
  standalone: true,
  imports: [
    FormsModule, DatePipe, RouterModule,
    MatTabsModule, MatTableModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatTooltipModule, MatIconModule, ExamStatusComponent
  ],
  template: `
    <div class="page-container">
      <h1 class="text-2xl font-semibold mb-6">Upload de Exames</h1>

      <mat-tab-group class="mb-8">
        <!-- Individual upload -->
        <mat-tab label="Individual">
          <div class="p-4">
            <mat-form-field class="w-full mb-3">
              <mat-label>Buscar paciente</mat-label>
              <input matInput [(ngModel)]="patientSearch" (ngModelChange)="searchPatients()" />
            </mat-form-field>

            @if (patientResults.length) {
              <mat-form-field class="w-full mb-3">
                <mat-label>Selecionar paciente</mat-label>
                <mat-select [(ngModel)]="selectedPatientId">
                  @for (p of patientResults; track p.id) {
                    <mat-option [value]="p.id">{{ p.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }

            <input #singleFile type="file" accept=".pdf" class="hidden" (change)="onSingleFile($event)" />
            <button mat-stroked-button (click)="singleFile.click()">Selecionar PDF</button>
            @if (singleSelected) { <span class="ml-3 text-sm">{{ singleSelected.name }}</span> }

            <div class="mt-4">
              <button mat-flat-button color="primary"
                [disabled]="!singleSelected || !selectedPatientId"
                (click)="uploadSingle()">Enviar</button>
            </div>
          </div>
        </mat-tab>

        <!-- Batch upload -->
        <mat-tab label="Lote">
          <div class="p-4">
            <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-4">
              <input #batchFiles type="file" accept=".pdf" multiple class="hidden" (change)="onBatchFiles($event)" />
              <button mat-stroked-button (click)="batchFiles.click()">Selecionar PDFs (múltiplos)</button>
              @if (batchSelected.length) {
                <p class="mt-2 text-sm text-gray-600">{{ batchSelected.length }} arquivo(s) selecionado(s)</p>
              }
            </div>
            <button mat-flat-button color="primary"
              [disabled]="!batchSelected.length"
              (click)="uploadBatch()">Enviar todos</button>
          </div>
        </mat-tab>
      </mat-tab-group>

      <!-- Queue -->
      <h2 class="text-lg font-medium mb-3">Fila de Processamento</h2>

      <mat-form-field>
        <mat-label>Filtrar status</mat-label>
        <mat-select [(ngModel)]="statusFilter" (ngModelChange)="applyFilter()">
          <mat-option value="">Todos</mat-option>
          <mat-option value="pending">Pending</mat-option>
          <mat-option value="processing">Processing</mat-option>
          <mat-option value="done">Done</mat-option>
          <mat-option value="error">Error</mat-option>
        </mat-select>
      </mat-form-field>

      <table mat-table [dataSource]="filteredQueue" class="w-full mt-3">
        <ng-container matColumnDef="filename">
          <th mat-header-cell *matHeaderCellDef>Arquivo</th>
          <td mat-cell *matCellDef="let e">{{ e.filename }}</td>
        </ng-container>
        <ng-container matColumnDef="patient">
          <th mat-header-cell *matHeaderCellDef>Paciente</th>
          <td mat-cell *matCellDef="let e">{{ e.patient_name }}</td>
        </ng-container>
        <ng-container matColumnDef="created_at">
          <th mat-header-cell *matHeaderCellDef>Enviado em</th>
          <td mat-cell *matCellDef="let e">{{ e.created_at | date:'dd/MM HH:mm' }}</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let e">
            <div class="flex items-center gap-2">
              <app-exam-status [status]="e.status" />
              <span class="text-sm capitalize">{{ e.status }}</span>
              @if (e.error_message) {
                <mat-icon [matTooltip]="e.error_message" class="text-red-600 text-base">error_outline</mat-icon>
              }
            </div>
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let e">
            @if (e.status === 'done') {
              <a mat-icon-button [routerLink]="['/doctor/results', e.exam_id]" matTooltip="Ver resultado">
                <mat-icon>open_in_new</mat-icon>
              </a>
            }
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="queueColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: queueColumns;"></tr>
      </table>
    </div>
  `
})
export class UploadsComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private ws = inject(WsService);

  patientSearch = '';
  patientResults: Patient[] = [];
  selectedPatientId = '';
  singleSelected: File | null = null;
  batchSelected: File[] = [];
  queue: QueueEntry[] = [];
  filteredQueue: QueueEntry[] = [];
  statusFilter = '';
  queueColumns = ['filename', 'patient', 'created_at', 'status', 'actions'];
  private wsSub?: Subscription;

  ngOnInit(): void {
    this.wsSub = this.ws.examUpdates$.subscribe(({ exam_id }) => {
      this.refreshQueueEntry(exam_id);
    });
  }

  ngOnDestroy(): void { this.wsSub?.unsubscribe(); }

  searchPatients(): void {
    if (!this.patientSearch.trim()) return;
    this.http.get<Patient[]>(`${environment.apiUrl}/patients`).subscribe(all =>
      this.patientResults = all.filter(p =>
        p.name.toLowerCase().includes(this.patientSearch.toLowerCase()))
    );
  }

  onSingleFile(e: Event): void {
    this.singleSelected = (e.target as HTMLInputElement).files?.[0] ?? null;
  }

  onBatchFiles(e: Event): void {
    this.batchSelected = Array.from((e.target as HTMLInputElement).files ?? []);
  }

  uploadSingle(): void {
    if (!this.singleSelected || !this.selectedPatientId) return;
    this.sendFile(this.singleSelected, this.selectedPatientId);
    this.singleSelected = null;
    this.selectedPatientId = '';
  }

  uploadBatch(): void {
    for (const file of this.batchSelected) {
      // Infer patient from filename: CPF_NOME.pdf — look up by name fragment
      this.sendFile(file, this.selectedPatientId || '');
    }
    this.batchSelected = [];
  }

  private sendFile(file: File, patientId: string): void {
    const form = new FormData();
    form.append('patient_id', patientId);
    form.append('file', file);
    this.http.post<{ exam_id: string; status: string }>(
      `${environment.apiUrl}/exams`, form
    ).subscribe(({ exam_id, status }) => {
      const entry: QueueEntry = {
        exam_id,
        filename: file.name,
        patient_name: '',
        patient_id: patientId,
        status: status as Exam['status'],
        agents: '',
        created_at: new Date().toISOString()
      };
      this.queue.unshift(entry);
      this.applyFilter();
    });
  }

  private refreshQueueEntry(examId: string): void {
    this.http.get<Exam>(`${environment.apiUrl}/exams/${examId}`).subscribe(exam => {
      const idx = this.queue.findIndex(e => e.exam_id === examId);
      if (idx !== -1) {
        this.queue[idx].status = exam.status;
        this.queue[idx].agents = exam.results?.map(r => r.agent_type).join(', ') ?? '';
        this.applyFilter();
      }
    });
  }

  applyFilter(): void {
    this.filteredQueue = this.statusFilter
      ? this.queue.filter(e => e.status === this.statusFilter)
      : [...this.queue];
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/features/lab/
git commit -m "feat: lab uploads — individual, batch, and real-time processing queue"
```

---

## Task 16: Clinic — Dashboard

**Files:**
- Create: `apps/web/src/app/features/clinic/clinic.routes.ts`
- Create: `apps/web/src/app/features/clinic/dashboard/dashboard.component.ts`

- [ ] **Step 1: Create clinic routes**

```bash
mkdir -p apps/web/src/app/features/clinic/{dashboard,users}
```

Create `apps/web/src/app/features/clinic/clinic.routes.ts`:

```typescript
import { Routes } from '@angular/router';

export const CLINIC_ROUTES: Routes = [
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'users',
    loadComponent: () =>
      import('./users/users.component').then(m => m.UsersComponent)
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
];
```

- [ ] **Step 2: Create DashboardComponent**

Create `apps/web/src/app/features/clinic/dashboard/dashboard.component.ts`:

```typescript
import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AlertBadgeComponent } from '../../../shared/components/alert-badge/alert-badge.component';
import { environment } from '../../../../environments/environment';
import { Exam } from '../../../shared/models/api.models';

interface AlertItem { marker: string; value: string; severity: any; exam_id: string; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DatePipe, RouterModule, MatCardModule, MatListModule, MatProgressBarModule, AlertBadgeComponent],
  template: `
    <div class="page-container">
      <h1 class="text-2xl font-semibold mb-6">Dashboard</h1>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <mat-card class="p-4 text-center">
          <div class="text-3xl font-bold text-blue-600">{{ counts.total }}</div>
          <div class="text-sm text-gray-600">Total de exames</div>
        </mat-card>
        <mat-card class="p-4 text-center">
          <div class="text-3xl font-bold text-green-600">{{ counts.done }}</div>
          <div class="text-sm text-gray-600">Concluídos</div>
        </mat-card>
        <mat-card class="p-4 text-center">
          <div class="text-3xl font-bold text-yellow-600">{{ counts.processing }}</div>
          <div class="text-sm text-gray-600">Processando</div>
        </mat-card>
        <mat-card class="p-4 text-center">
          <div class="text-3xl font-bold text-red-600">{{ counts.error }}</div>
          <div class="text-sm text-gray-600">Com erro</div>
        </mat-card>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <mat-card class="p-4">
          <h2 class="font-medium mb-3">Alertas críticos recentes</h2>
          @for (a of criticalAlerts; track a.marker) {
            <div class="flex items-center gap-2 mb-2">
              <app-alert-badge [severity]="a.severity" />
              <span class="text-sm">{{ a.marker }}: {{ a.value }}</span>
            </div>
          }
          @if (!criticalAlerts.length) {
            <p class="text-gray-500 text-sm">Nenhum alerta crítico.</p>
          }
        </mat-card>

        <mat-card class="p-4">
          <h2 class="font-medium mb-3">Agentes mais utilizados</h2>
          @for (entry of agentCounts | keyvalue; track entry.key) {
            <div class="mb-2">
              <div class="flex justify-between text-sm mb-1">
                <span class="capitalize">{{ entry.key }}</span>
                <span>{{ entry.value }}</span>
              </div>
              <mat-progress-bar [value]="(entry.value / counts.done) * 100" />
            </div>
          }
        </mat-card>
      </div>
    </div>
  `
})
export class DashboardComponent implements OnInit {
  private http = inject(HttpClient);

  counts = { total: 0, done: 0, processing: 0, error: 0, pending: 0 };
  criticalAlerts: AlertItem[] = [];
  agentCounts: Record<string, number> = {};

  ngOnInit(): void {
    this.http.get<any[]>(`${environment.apiUrl}/alerts?severity=critical`)
      .subscribe(alerts => {
        this.criticalAlerts = alerts.slice(0, 10).map(a => ({
          marker: a.marker, value: a.value, severity: a.severity, exam_id: a.exam_id
        }));
      });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/features/clinic/
git commit -m "feat: clinic dashboard — exam counts and critical alerts"
```

---

## Task 17: Clinic — User Management

**Files:**
- Create: `apps/web/src/app/features/clinic/users/users.component.ts`

- [ ] **Step 1: Create UsersComponent**

Create `apps/web/src/app/features/clinic/users/users.component.ts`:

```typescript
import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { AlertBadgeComponent } from '../../../shared/components/alert-badge/alert-badge.component';
import { environment } from '../../../../environments/environment';
import { User } from '../../../shared/models/api.models';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [
    DatePipe, FormsModule,
    MatTableModule, MatButtonModule, MatDialogModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule
  ],
  template: `
    <div class="page-container">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-semibold">Usuários</h1>
        <button mat-flat-button color="primary" (click)="showInvite = true">Convidar usuário</button>
      </div>

      @if (showInvite) {
        <div class="bg-gray-50 border rounded p-4 mb-6">
          <h3 class="font-medium mb-3">Novo usuário</h3>
          <div class="flex gap-3 flex-wrap">
            <mat-form-field>
              <mat-label>E-mail</mat-label>
              <input matInput [(ngModel)]="newEmail" type="email" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Senha inicial</mat-label>
              <input matInput [(ngModel)]="newPassword" type="password" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Role</mat-label>
              <mat-select [(ngModel)]="newRole">
                <mat-option value="doctor">Médico</mat-option>
                <mat-option value="lab_tech">Lab Tech</mat-option>
                <mat-option value="admin">Admin</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <div class="flex gap-2">
            <button mat-flat-button color="primary" (click)="invite()">Criar</button>
            <button mat-button (click)="showInvite = false">Cancelar</button>
          </div>
          @if (inviteError) { <p class="text-red-600 text-sm mt-2">{{ inviteError }}</p> }
        </div>
      }

      <table mat-table [dataSource]="users" class="w-full">
        <ng-container matColumnDef="email">
          <th mat-header-cell *matHeaderCellDef>E-mail</th>
          <td mat-cell *matCellDef="let u">{{ u.email }}</td>
        </ng-container>
        <ng-container matColumnDef="role">
          <th mat-header-cell *matHeaderCellDef>Role</th>
          <td mat-cell *matCellDef="let u">
            <span class="capitalize px-2 py-1 rounded text-xs font-medium"
              [class]="u.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                       u.role === 'doctor' ? 'bg-blue-100 text-blue-800' :
                       'bg-green-100 text-green-800'">
              {{ u.role }}
            </span>
          </td>
        </ng-container>
        <ng-container matColumnDef="created_at">
          <th mat-header-cell *matHeaderCellDef>Criado em</th>
          <td mat-cell *matCellDef="let u">{{ u.created_at | date:'dd/MM/yyyy' }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let u">
            <button mat-icon-button color="warn" (click)="remove(u)"
              [disabled]="u.role === 'admin'" matTooltip="Remover">
              <mat-icon>delete</mat-icon>
            </button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns;"></tr>
      </table>
    </div>
  `
})
export class UsersComponent implements OnInit {
  private http = inject(HttpClient);

  users: User[] = [];
  columns = ['email', 'role', 'created_at', 'actions'];
  showInvite = false;
  newEmail = '';
  newPassword = '';
  newRole = 'doctor';
  inviteError = '';

  ngOnInit(): void { this.load(); }

  load(): void {
    this.http.get<User[]>(`${environment.apiUrl}/users`).subscribe(u => this.users = u);
  }

  invite(): void {
    this.inviteError = '';
    this.http.post<User>(`${environment.apiUrl}/users`, {
      email: this.newEmail, password: this.newPassword, role: this.newRole
    }).subscribe({
      next: (u) => {
        this.users.unshift(u);
        this.showInvite = false;
        this.newEmail = this.newPassword = '';
      },
      error: (err) => {
        this.inviteError = err.error?.error ?? 'Erro ao criar usuário.';
      }
    });
  }

  remove(user: User): void {
    if (!confirm(`Remover ${user.email}?`)) return;
    this.http.delete(`${environment.apiUrl}/users/${user.id}`).subscribe(() => {
      this.users = this.users.filter(u => u.id !== user.id);
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/features/clinic/users/
git commit -m "feat: clinic user management — invite and remove users"
```

---

## Task 18: Docker + nginx + docker-compose

**Files:**
- Create: `apps/web/Dockerfile`
- Create: `apps/web/nginx.conf`
- Create: `apps/web/.dockerignore`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Create Dockerfile**

Create `apps/web/Dockerfile`:

```dockerfile
# Stage 1: build
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration=production

# Stage 2: serve
FROM nginx:alpine
COPY --from=build /app/dist/genomaflow-web/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

Note: verify the dist output folder name after `ng build` — it matches the `name` field in `angular.json`. Run `ls dist/` after building to confirm.

- [ ] **Step 2: Create nginx.conf**

Create `apps/web/nginx.conf`:

```nginx
server {
  listen 80;

  # Proxy API calls to backend (strips /api prefix)
  location /api/ {
    proxy_pass http://api:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  # WebSocket proxy for real-time exam updates
  location /exams/subscribe {
    proxy_pass http://api:3000/exams/subscribe;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600;
  }

  # SPA fallback
  location / {
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;
  }
}
```

- [ ] **Step 3: Create .dockerignore**

Create `apps/web/.dockerignore`:

```
node_modules
dist
.angular
*.log
```

- [ ] **Step 4: Add web service to docker-compose.yml**

Add to `docker-compose.yml` (under `services:`, after `worker:`):

```yaml
  web:
    build: ./apps/web
    ports:
      - "4200:80"
    depends_on:
      - api
```

Full updated `docker-compose.yml`:

```yaml
version: "3.9"

services:
  api:
    build: ./apps/api
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - uploads:/tmp/uploads

  worker:
    build: ./apps/worker
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - uploads:/tmp/uploads

  web:
    build: ./apps/web
    ports:
      - "4200:80"
    depends_on:
      - api

  db:
    image: pgvector/pgvector:pg15
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: genomaflow
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7.2-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
  uploads:
```

- [ ] **Step 5: Verify local dev server starts**

```bash
cd apps/web && npx ng serve --open=false 2>&1 | tail -5
```

Expected: `Local:   http://localhost:4200/` (Ctrl+C to stop)

- [ ] **Step 6: Commit**

```bash
cd /home/rodrigonoma/GenomaFlow
git add apps/web/Dockerfile apps/web/nginx.conf apps/web/.dockerignore docker-compose.yml
git commit -m "feat: web Dockerfile, nginx config, docker-compose web service"
```

---

## Backend Gap: GET /exams by patient

The patient detail component (Task 12) needs `GET /exams?patient_id=<id>`. The current backend only has `GET /exams/:id`. Add this endpoint before testing the patient detail view:

Add to `apps/api/src/routes/exams.js` (before the `/:id` route):

```javascript
fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
  const { tenant_id } = request.user;
  const { patient_id } = request.query;

  return withTenant(fastify.pg, tenant_id, async (client) => {
    const query = patient_id
      ? `SELECT id, status, file_path, source, created_at, updated_at FROM exams WHERE patient_id = $1 ORDER BY created_at DESC`
      : `SELECT id, status, file_path, source, created_at, updated_at FROM exams ORDER BY created_at DESC`;
    const params = patient_id ? [patient_id] : [];
    const { rows } = await client.query(query, params);
    return rows;
  });
});
```

Commit this together with any other backend adjustments needed.
