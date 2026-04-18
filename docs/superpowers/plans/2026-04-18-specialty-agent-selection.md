# Specialty + Agent Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mandatory doctor specialty, pre-select agents at upload based on specialty, allow per-upload override, and forward `selected_agents` + `chief_complaint` + `current_symptoms` through the worker pipeline.

**Architecture:** Migration 021 adds `specialty` to `users`. A new `GET/PUT /auth/me` endpoint exposes/updates it. An Angular onboarding route + guard enforce selection before dashboard access. The upload flow in patient-detail gains an inline confirmation panel with agent checkboxes pre-populated by the doctor's specialty. The worker filters `PHASE1_AGENTS.human` using `selected_agents` from the job payload (backwards-compatible).

**Tech Stack:** PostgreSQL (migration), Node.js/Fastify (API routes), Angular 17 signals (frontend), BullMQ (job queue)

---

## File Map

| Action | File |
|---|---|
| Create | `apps/api/src/db/migrations/021_user_specialty.sql` |
| Modify | `apps/api/src/routes/auth.js` — add `GET /auth/me` and `PUT /auth/me/specialty` |
| Modify | `apps/worker/src/processors/exam.js` — filter phase1 by `selected_agents` |
| Modify | `apps/api/src/routes/exams.js` — pass `selected_agents`, `chief_complaint`, `current_symptoms` to job payload |
| Create | `apps/web/src/app/features/onboarding/specialty-onboarding.component.ts` |
| Modify | `apps/web/src/app/app.routes.ts` — add `/onboarding/specialty` route |
| Create | `apps/web/src/app/core/auth/specialty.guard.ts` |
| Modify | `apps/web/src/app/app.routes.ts` — apply specialty guard to `/doctor` routes |
| Modify | `apps/web/src/app/shared/models/api.models.ts` — add `specialty` to `JwtPayload`/`User`, add `SPECIALTY_AGENTS` map |
| Modify | `apps/web/src/app/app.component.ts` — add "Minha especialidade" menu item |
| Modify | `apps/web/src/app/features/doctor/patients/patient-detail.component.ts` — inline upload confirmation panel |

---

## Task 1: Migration 021 — Add specialty to users

**Files:**
- Create: `apps/api/src/db/migrations/021_user_specialty.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 021 — Doctor specialty on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS specialty VARCHAR(64);
```

- [ ] **Step 2: Run the migration**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/api
node src/db/migrate.js
```

Expected: `[apply] 021_user_specialty.sql` then exits without error.

- [ ] **Step 3: Verify column exists**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/api
node -e "require('dotenv').config(); const {Pool}=require('pg'); const p=new Pool({connectionString:process.env.DATABASE_URL}); p.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='specialty'\").then(r=>console.log(r.rows)).finally(()=>p.end())"
```

Expected: `[ { column_name: 'specialty' } ]`

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/021_user_specialty.sql
git commit -m "feat: migration 021 — specialty column on users"
```

---

## Task 2: API — GET /auth/me and PUT /auth/me/specialty

**Files:**
- Modify: `apps/api/src/routes/auth.js`

The current auth.js has `/login` and `/register`. Add two new endpoints at the bottom.

- [ ] **Step 1: Add routes to auth.js**

Open `apps/api/src/routes/auth.js`. At the end of the exported async function (before the closing `};`), add:

```js
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id } = request.user;
    const { rows } = await fastify.pg.query(
      `SELECT id, email, role, specialty, created_at FROM users WHERE id = $1`,
      [user_id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'User not found' });
    return rows[0];
  });

  fastify.put('/me/specialty', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id } = request.user;
    const { specialty } = request.body;

    const VALID_SPECIALTIES = [
      'endocrinologia','cardiologia','hematologia','clínica_geral','nutrição',
      'nefrologia','hepatologia','gastroenterologia','ginecologia','urologia',
      'pediatria','neurologia','ortopedia','pneumologia','reumatologia',
      'oncologia','infectologia','dermatologia','psiquiatria','geriatria',
      'medicina_esporte'
    ];

    if (!specialty || !VALID_SPECIALTIES.includes(specialty)) {
      return reply.status(400).send({ error: 'Especialidade inválida', valid: VALID_SPECIALTIES });
    }

    const { rows } = await fastify.pg.query(
      `UPDATE users SET specialty = $1 WHERE id = $2 RETURNING id, email, role, specialty`,
      [specialty, user_id]
    );
    return rows[0];
  });
```

- [ ] **Step 2: Manual smoke test**

Start the API if not running:
```bash
cd /home/rodrigonoma/GenomaFlow/apps/api && node src/index.js &
```

Login and test:
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"SEU_EMAIL","password":"SUA_SENHA"}' | jq -r .token)

curl -s http://localhost:3000/auth/me -H "Authorization: Bearer $TOKEN" | jq .
curl -s -X PUT http://localhost:3000/auth/me/specialty \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"specialty":"cardiologia"}' | jq .
curl -s http://localhost:3000/auth/me -H "Authorization: Bearer $TOKEN" | jq .specialty
```

Expected: GET returns user object with `specialty` field; PUT updates it; second GET shows `"cardiologia"`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/auth.js
git commit -m "feat: GET /auth/me and PUT /auth/me/specialty endpoints"
```

---

## Task 3: Worker — filter Phase 1 agents by selected_agents

**Files:**
- Modify: `apps/worker/src/processors/exam.js`

Current `processExam` signature: `async function processExam({ exam_id, tenant_id, file_path })`.

- [ ] **Step 1: Update processExam to accept and use selected_agents**

In `apps/worker/src/processors/exam.js`, change:

```js
async function processExam({ exam_id, tenant_id, file_path }) {
```

to:

```js
async function processExam({ exam_id, tenant_id, file_path, selected_agents, chief_complaint, current_symptoms }) {
```

Then find the block that sets `phase1` for human module:

```js
    if (tenantModule === 'human') {
      phase1 = PHASE1_AGENTS.human;
    } else {
```

Replace with:

```js
    if (tenantModule === 'human') {
      phase1 = selected_agents?.length
        ? PHASE1_AGENTS.human.filter(a => selected_agents.includes(a.type))
        : PHASE1_AGENTS.human;
      if (!phase1.length) phase1 = PHASE1_AGENTS.human; // safety: never empty
    } else {
```

Then find the line that builds `phase2Ctx`:

```js
    const phase2Ctx = {
      examText,
      patient: anonSubject,
      specialtyResults,
      module: tenantModule,
      species: subject.species || null
    };
```

Replace with:

```js
    const phase2Ctx = {
      examText,
      patient: anonSubject,
      specialtyResults,
      module: tenantModule,
      species: subject.species || null,
      chief_complaint: chief_complaint || '',
      current_symptoms: current_symptoms || ''
    };
```

- [ ] **Step 2: Verify no syntax errors**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/worker && node -e "require('./src/processors/exam')" && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/processors/exam.js
git commit -m "feat: worker respects selected_agents filter and passes chief_complaint/current_symptoms to phase2"
```

---

## Task 4: API exams.js — forward extra fields to job payload

**Files:**
- Modify: `apps/api/src/routes/exams.js`

The POST `/` handler currently reads only `patient_id` from form fields. We need to also read `selected_agents` (JSON string), `chief_complaint`, `current_symptoms`.

- [ ] **Step 1: Update multipart field parsing**

In `apps/api/src/routes/exams.js`, find the for-await loop that reads parts:

```js
    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'patient_id') {
        subject_id = part.value;
      } else if (part.type === 'file' && part.fieldname === 'file') {
```

Replace with:

```js
    let selected_agents = null;
    let chief_complaint = '';
    let current_symptoms = '';

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'patient_id') {
        subject_id = part.value;
      } else if (part.type === 'field' && part.fieldname === 'selected_agents') {
        try { selected_agents = JSON.parse(part.value); } catch (_) {}
      } else if (part.type === 'field' && part.fieldname === 'chief_complaint') {
        chief_complaint = part.value || '';
      } else if (part.type === 'field' && part.fieldname === 'current_symptoms') {
        current_symptoms = part.value || '';
      } else if (part.type === 'file' && part.fieldname === 'file') {
```

Then find the `examQueue.add` call:

```js
      await examQueue.add('process-exam', {
        exam_id: exam.id,
        tenant_id,
        file_path: filePath
      });
```

Replace with:

```js
      await examQueue.add('process-exam', {
        exam_id: exam.id,
        tenant_id,
        file_path: filePath,
        selected_agents: selected_agents || null,
        chief_complaint,
        current_symptoms
      });
```

- [ ] **Step 2: Verify no syntax errors**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/api && node -e "require('./src/routes/exams')" && echo "OK"
```

Expected: may warn about missing fastify arg but should not throw parse errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/exams.js
git commit -m "feat: exams API forwards selected_agents, chief_complaint, current_symptoms to job payload"
```

---

## Task 5: Frontend — models + specialty constants

**Files:**
- Modify: `apps/web/src/app/shared/models/api.models.ts`

- [ ] **Step 1: Add specialty to JwtPayload and User, and add SPECIALTY_AGENTS map**

In `apps/web/src/app/shared/models/api.models.ts`, update the `User` interface:

```ts
export interface User {
  id: string;
  email: string;
  role: 'doctor' | 'lab_tech' | 'admin';
  specialty?: string;
  created_at: string;
}
```

Update `JwtPayload`:

```ts
export interface JwtPayload {
  user_id: string;
  tenant_id: string;
  role: 'doctor' | 'lab_tech' | 'admin';
  module: 'human' | 'veterinary';
}
```

(JwtPayload stays the same — specialty is NOT in the JWT, it's fetched from GET /auth/me)

Add at the end of the file:

```ts
export const HUMAN_SPECIALTIES: { value: string; label: string }[] = [
  { value: 'endocrinologia',    label: 'Endocrinologia' },
  { value: 'cardiologia',       label: 'Cardiologia' },
  { value: 'hematologia',       label: 'Hematologia' },
  { value: 'clínica_geral',     label: 'Clínica Geral' },
  { value: 'nutrição',          label: 'Nutrição' },
  { value: 'nefrologia',        label: 'Nefrologia' },
  { value: 'hepatologia',       label: 'Hepatologia' },
  { value: 'gastroenterologia', label: 'Gastroenterologia' },
  { value: 'ginecologia',       label: 'Ginecologia' },
  { value: 'urologia',          label: 'Urologia' },
  { value: 'pediatria',         label: 'Pediatria' },
  { value: 'neurologia',        label: 'Neurologia' },
  { value: 'ortopedia',         label: 'Ortopedia' },
  { value: 'pneumologia',       label: 'Pneumologia' },
  { value: 'reumatologia',      label: 'Reumatologia' },
  { value: 'oncologia',         label: 'Oncologia' },
  { value: 'infectologia',      label: 'Infectologia' },
  { value: 'dermatologia',      label: 'Dermatologia' },
  { value: 'psiquiatria',       label: 'Psiquiatria' },
  { value: 'geriatria',         label: 'Geriatria' },
  { value: 'medicina_esporte',  label: 'Medicina do Esporte' },
];

export const SPECIALTY_AGENTS: Record<string, string[]> = {
  clínica_geral:      ['metabolic', 'cardiovascular', 'hematology'],
  geriatria:          ['metabolic', 'cardiovascular', 'hematology'],
  medicina_esporte:   ['metabolic', 'cardiovascular', 'hematology'],
  endocrinologia:     ['metabolic'],
  nutrição:           ['metabolic'],
  dermatologia:       ['metabolic'],
  psiquiatria:        ['metabolic'],
  cardiologia:        ['cardiovascular'],
  pneumologia:        ['cardiovascular', 'hematology'],
  hematologia:        ['hematology'],
  oncologia:          ['hematology'],
  infectologia:       ['hematology'],
  pediatria:          ['metabolic', 'hematology'],
  neurologia:         ['metabolic', 'hematology'],
  nefrologia:         ['metabolic', 'hematology'],
  hepatologia:        ['metabolic', 'hematology'],
  gastroenterologia:  ['metabolic', 'hematology'],
  ginecologia:        ['metabolic', 'hematology'],
  urologia:           ['metabolic', 'hematology'],
  ortopedia:          ['metabolic', 'hematology'],
  reumatologia:       ['metabolic', 'hematology'],
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/shared/models/api.models.ts
git commit -m "feat: add HUMAN_SPECIALTIES and SPECIALTY_AGENTS constants to api.models"
```

---

## Task 6: Frontend — specialty onboarding component

**Files:**
- Create: `apps/web/src/app/features/onboarding/specialty-onboarding.component.ts`

- [ ] **Step 1: Create the component**

```ts
import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { environment } from '../../../../environments/environment';
import { HUMAN_SPECIALTIES } from '../../shared/models/api.models';

@Component({
  selector: 'app-specialty-onboarding',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatSelectModule],
  styles: [`
    :host {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: #0b1326;
    }
    .card {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.25);
      border-radius: 12px; padding: 2.5rem; width: 420px;
    }
    h1 {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.5rem; color: #dae2fd; margin: 0 0 0.5rem;
    }
    p { font-size: 13px; color: #908fa0; margin: 0 0 2rem; line-height: 1.5; }
    mat-form-field { width: 100%; margin-bottom: 1.5rem; }
    .actions { display: flex; justify-content: flex-end; }
    .error { color: #ffb4ab; font-size: 13px; margin-bottom: 1rem; }
  `],
  template: `
    <div class="card">
      <h1>Qual é sua especialidade?</h1>
      <p>Esta informação é usada para pré-selecionar os agentes de IA mais relevantes para suas análises.</p>

      <mat-form-field appearance="outline">
        <mat-label>Especialidade médica</mat-label>
        <mat-select [(ngModel)]="selectedSpecialty">
          @for (s of specialties; track s.value) {
            <mat-option [value]="s.value">{{ s.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      @if (error()) {
        <div class="error">{{ error() }}</div>
      }

      <div class="actions">
        <button mat-flat-button
                style="background:#c0c1ff;color:#1000a9;font-weight:700"
                [disabled]="!selectedSpecialty || saving()"
                (click)="save()">
          {{ saving() ? 'Salvando…' : 'Continuar' }}
        </button>
      </div>
    </div>
  `
})
export class SpecialtyOnboardingComponent {
  private http   = inject(HttpClient);
  private router = inject(Router);

  specialties = HUMAN_SPECIALTIES;
  selectedSpecialty = '';
  saving = signal(false);
  error  = signal('');

  save(): void {
    if (!this.selectedSpecialty) return;
    this.saving.set(true);
    this.error.set('');
    this.http.put(`${environment.apiUrl}/auth/me/specialty`, { specialty: this.selectedSpecialty })
      .subscribe({
        next: () => this.router.navigate(['/doctor/patients']),
        error: () => {
          this.saving.set(false);
          this.error.set('Erro ao salvar. Tente novamente.');
        }
      });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/features/onboarding/specialty-onboarding.component.ts
git commit -m "feat: specialty onboarding component"
```

---

## Task 7: Frontend — specialty guard + routes

**Files:**
- Create: `apps/web/src/app/core/auth/specialty.guard.ts`
- Modify: `apps/web/src/app/app.routes.ts`

- [ ] **Step 1: Create specialty guard**

```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { map, catchError, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export const specialtyGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const http   = inject(HttpClient);
  const router = inject(Router);

  if (!auth.currentUser) return router.createUrlTree(['/login']);
  if (auth.currentUser.module !== 'human') return true; // vets skip

  return http.get<{ specialty?: string }>(`${environment.apiUrl}/auth/me`).pipe(
    map(user => user.specialty ? true : router.createUrlTree(['/onboarding/specialty'])),
    catchError(() => of(router.createUrlTree(['/login'])))
  );
};
```

- [ ] **Step 2: Register route in app.routes.ts**

In `apps/web/src/app/app.routes.ts`, add the import at the top:

```ts
import { specialtyGuard } from './core/auth/specialty.guard';
```

Add the onboarding route (before the wildcard `**` route):

```ts
  {
    path: 'onboarding/specialty',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/onboarding/specialty-onboarding.component').then(m => m.SpecialtyOnboardingComponent)
  },
```

Apply `specialtyGuard` to the `/doctor` route:

```ts
  {
    path: 'doctor',
    canActivate: [authGuard, specialtyGuard],
    loadChildren: () =>
      import('./features/doctor/doctor.routes').then(m => m.DOCTOR_ROUTES)
  },
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/core/auth/specialty.guard.ts apps/web/src/app/app.routes.ts
git commit -m "feat: specialty guard redirects to onboarding when specialty not set (human module only)"
```

---

## Task 8: Frontend — "Minha especialidade" in top-right menu

**Files:**
- Modify: `apps/web/src/app/app.component.ts`

The top-right menu currently has only a role label and "Sair". Add a "Minha especialidade" item that navigates to a modal or inline page.

Strategy: clicking "Minha especialidade" navigates to `/onboarding/specialty` (reusing the onboarding component — works because the component has no "go back" and simply saves then redirects to /doctor/patients).

- [ ] **Step 1: Add RouterModule import and menu item**

In `apps/web/src/app/app.component.ts`, the imports array already includes `RouterLink`. Add `RouterModule` if not present. Then in the template, find the mat-menu:

```html
        <mat-menu #menu="matMenu">
          <div style="padding:0.5rem 1rem;font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#908fa0;border-bottom:1px solid rgba(70,69,84,0.2);margin-bottom:4px;">
            {{ user.role }}
          </div>
          <button mat-menu-item (click)="auth.logout()">
            <mat-icon>logout</mat-icon> Sair
          </button>
        </mat-menu>
```

Replace with:

```html
        <mat-menu #menu="matMenu">
          <div style="padding:0.5rem 1rem;font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#908fa0;border-bottom:1px solid rgba(70,69,84,0.2);margin-bottom:4px;">
            {{ user.role }}
          </div>
          @if (user.module === 'human') {
            <button mat-menu-item routerLink="/onboarding/specialty">
              <mat-icon>school</mat-icon> Minha especialidade
            </button>
          }
          <button mat-menu-item (click)="auth.logout()">
            <mat-icon>logout</mat-icon> Sair
          </button>
        </mat-menu>
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/app.component.ts
git commit -m "feat: Minha especialidade menu item in top-right user menu (human module only)"
```

---

## Task 9: Frontend — upload confirmation panel with agent checkboxes

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`

This is the largest task. The current upload flow: file input `(change)="onExamFile($event)"` triggers upload immediately. New flow: file selection shows an inline confirmation panel with agent checkboxes; submit triggers upload.

- [ ] **Step 1: Add new signals and constants to the component class**

In the class body of `PatientDetailComponent`, add:

```ts
// Upload confirmation panel
pendingFile     = signal<File | null>(null);
uploadAgents    = signal<Set<string>>(new Set(['metabolic', 'cardiovascular', 'hematology']));
chiefComplaint  = signal('');
currentSymptoms = signal('');

readonly PHASE1_AGENTS = [
  { type: 'metabolic',      label: 'Metabólico' },
  { type: 'cardiovascular', label: 'Cardiovascular' },
  { type: 'hematology',     label: 'Hematologia' },
];
```

Add an injection for `HttpClient` (already present) — also inject a user profile signal. We need to load the doctor's specialty to pre-select agents. Add to the class:

```ts
doctorSpecialty = signal<string | null>(null);
```

In `ngOnInit()`, add:

```ts
this.http.get<{ specialty?: string }>(`${environment.apiUrl}/auth/me`)
  .subscribe(u => {
    this.doctorSpecialty.set(u.specialty ?? null);
  });
```

Import `SPECIALTY_AGENTS` at the top of the file:

```ts
import { SPECIALTY_AGENTS } from '../../../shared/models/api.models';
```

- [ ] **Step 2: Update onExamFile to show panel instead of uploading**

Find the existing `onExamFile` method and replace it with:

```ts
onExamFile(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.type !== 'application/pdf') {
    this.uploadError.set('Apenas arquivos PDF são aceitos.');
    return;
  }
  this.uploadError.set('');
  this.chiefComplaint.set('');
  this.currentSymptoms.set('');

  const specialty = this.doctorSpecialty();
  const preselected = specialty && SPECIALTY_AGENTS[specialty]
    ? SPECIALTY_AGENTS[specialty]
    : ['metabolic', 'cardiovascular', 'hematology'];
  this.uploadAgents.set(new Set(preselected));
  this.pendingFile.set(file);
}
```

- [ ] **Step 3: Add toggleUploadAgent and submitUpload methods**

```ts
toggleUploadAgent(type: string): void {
  const s = new Set(this.uploadAgents());
  s.has(type) ? s.delete(type) : s.add(type);
  this.uploadAgents.set(s);
}

cancelUpload(): void {
  this.pendingFile.set(null);
  this.uploadError.set('');
}

submitUpload(): void {
  const file = this.pendingFile();
  const id = this.subject()!.id;
  if (!file) return;
  if (this.uploadAgents().size === 0) return;

  this.uploading.set(true);
  this.uploadError.set('');

  const form = new FormData();
  form.append('patient_id', id);
  form.append('file', file);
  form.append('selected_agents', JSON.stringify([...this.uploadAgents()]));
  if (this.chiefComplaint()) form.append('chief_complaint', this.chiefComplaint());
  if (this.currentSymptoms()) form.append('current_symptoms', this.currentSymptoms());

  this.http.post<{ exam_id: string; status: string }>(
    `${environment.apiUrl}/exams`, form
  ).subscribe({
    next: (exam) => {
      this.uploading.set(false);
      this.pendingFile.set(null);
      this.loadExams(id);
    },
    error: (err) => {
      this.uploading.set(false);
      this.uploadError.set(err?.error?.error || 'Falha no upload. Tente novamente.');
    }
  });
}
```

- [ ] **Step 4: Remove the old uploadExam method** (if it exists) and find any call to `onExamFile` that directly uploaded — the new flow is all in `submitUpload`.

- [ ] **Step 5: Update the Exames tab template**

Find the current upload section in the template (inside `<!-- ── EXAMES ── -->` mat-tab):

```html
          <div class="exams-upload-row">
            <input #examFile type="file" accept=".pdf" style="display:none"
                   (change)="onExamFile($event)"/>
            <button mat-stroked-button class="upload-exam-btn" (click)="examFile.click()"
                    [disabled]="uploading()">
              <mat-icon>upload_file</mat-icon>
              {{ uploading() ? 'Enviando…' : 'Upload de Exame (PDF)' }}
            </button>
            @if (uploadError()) {
              <span class="upload-error">{{ uploadError() }}</span>
            }
          </div>
```

Replace with:

```html
          <div class="exams-upload-row">
            <input #examFile type="file" accept=".pdf" style="display:none"
                   (change)="onExamFile($event)"/>
            @if (!pendingFile()) {
              <button mat-stroked-button class="upload-exam-btn" (click)="examFile.click()"
                      [disabled]="uploading()">
                <mat-icon>upload_file</mat-icon>
                Upload de Exame (PDF)
              </button>
            }
            @if (uploadError()) {
              <span class="upload-error">{{ uploadError() }}</span>
            }
          </div>

          @if (pendingFile()) {
            <div class="upload-panel">
              <div class="upload-panel-filename">
                <mat-icon style="font-size:16px;width:16px;height:16px;color:#c0c1ff">picture_as_pdf</mat-icon>
                {{ pendingFile()!.name }}
              </div>

              <mat-form-field appearance="outline" style="width:100%;margin-top:1rem">
                <mat-label>Queixa principal / motivo do exame (opcional)</mat-label>
                <input matInput [value]="chiefComplaint()"
                       (input)="chiefComplaint.set($any($event.target).value)"
                       placeholder="Ex: fadiga persistente há 3 meses"/>
              </mat-form-field>

              <mat-form-field appearance="outline" style="width:100%">
                <mat-label>Sintomas atuais (opcional)</mat-label>
                <input matInput [value]="currentSymptoms()"
                       (input)="currentSymptoms.set($any($event.target).value)"
                       placeholder="Ex: perda de peso, poliúria, visão turva"/>
              </mat-form-field>

              <div class="upload-agents-label">Agentes de análise</div>
              <div class="upload-agents">
                @for (a of PHASE1_AGENTS; track a.type) {
                  <label class="agent-checkbox">
                    <input type="checkbox"
                           [checked]="uploadAgents().has(a.type)"
                           (change)="toggleUploadAgent(a.type)"/>
                    {{ a.label }}
                  </label>
                }
              </div>
              <div class="upload-always-label">
                ✦ Correlação Clínica · Síntese Terapêutica · Nutrição (sempre incluídos)
              </div>

              <div class="upload-actions">
                <button mat-button (click)="cancelUpload()">Cancelar</button>
                <button mat-flat-button
                        style="background:#c0c1ff;color:#1000a9;font-weight:700"
                        [disabled]="uploading() || uploadAgents().size === 0"
                        (click)="submitUpload()">
                  {{ uploading() ? 'Enviando…' : 'Enviar para análise' }}
                </button>
              </div>
            </div>
          }
```

- [ ] **Step 6: Add CSS for the upload panel**

In the `styles` array of the component, add:

```css
    .upload-panel {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.25);
      border-radius: 8px; padding: 1.25rem; max-width: 640px; margin-bottom: 1.5rem;
    }
    .upload-panel-filename {
      display: flex; align-items: center; gap: 0.5rem;
      font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #dae2fd;
      margin-bottom: 0.25rem;
    }
    .upload-agents-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.1em; color: #464554;
      margin-bottom: 0.5rem;
    }
    .upload-agents { display: flex; gap: 1rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
    .agent-checkbox {
      display: flex; align-items: center; gap: 0.4rem;
      font-size: 13px; color: #dae2fd; cursor: pointer;
    }
    .agent-checkbox input { accent-color: #c0c1ff; cursor: pointer; }
    .upload-always-label {
      font-size: 11px; color: #464554; margin-bottom: 1rem;
    }
    .upload-actions { display: flex; gap: 8px; justify-content: flex-end; }
```

- [ ] **Step 7: Build check**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/web && npx ng build --configuration=development 2>&1 | tail -20
```

Expected: Build succeeds with no errors. Fix any TypeScript errors before continuing.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/features/doctor/patients/patient-detail.component.ts
git commit -m "feat: upload confirmation panel with agent checkboxes and clinical context fields"
```

---

## Self-Review Checklist

- Spec Part 1 (specialty mandatory): ✓ migration 021, GET/PUT /auth/me/specialty, specialty guard, onboarding component
- Spec Part 2 (agent mapping): ✓ SPECIALTY_AGENTS constant, used to pre-select checkboxes
- Spec Part 3 (upload panel): ✓ inline panel with chief_complaint, current_symptoms, agent checkboxes; cancel/submit buttons; backwards-compatible (old jobs without selected_agents use all agents)
- Minimum 1 agent enforced: ✓ `[disabled]="uploadAgents().size === 0"`
- Vet module unaffected: ✓ specialty guard returns `true` for non-human module; upload panel only shows PHASE1 human agents
- Worker backwards-compatible: ✓ `selected_agents?.length` check falls back to all agents if null
