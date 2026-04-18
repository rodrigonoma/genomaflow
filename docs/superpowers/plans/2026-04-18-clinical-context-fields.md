# Clinical Context Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six clinical lifestyle/context columns to the `subjects` table (medications, smoking, alcohol, diet_type, physical_activity, family_history), expose them through the existing `PUT /patients/:id` and `GET /patients/:id` endpoints, update the Angular frontend profile tab to show a "Contexto Clínico" section, and pass the fields to the worker's patient context so the AI agents can incorporate them in analysis.

**Architecture:** Migration 022 adds columns with `ALTER TABLE IF NOT EXISTS`. The existing `PUT /patients/:id` already uses `COALESCE($n, column)` — we extend the same pattern. `GET /patients/:id` uses `SELECT s.*` so it already returns new columns. The frontend adds a new section below the existing profile form. The worker already fetches the subject before processing — we extend the `anonSubject` data passed to agents.

**Tech Stack:** PostgreSQL (migration), Node.js/Fastify (API), Angular 17 signals (frontend), existing worker pipeline

---

## File Map

| Action | File |
|---|---|
| Create | `apps/api/src/db/migrations/022_subject_clinical_context.sql` |
| Modify | `apps/api/src/routes/patients.js` — extend PUT `/:id` and POST `/` to accept new fields |
| Modify | `apps/worker/src/processors/exam.js` — include new fields in patient context passed to agents |
| Modify | `apps/web/src/app/shared/models/api.models.ts` — extend `Subject` interface |
| Modify | `apps/web/src/app/features/doctor/patients/patient-detail.component.ts` — Contexto Clínico section |

---

## Task 1: Migration 022 — clinical context columns on subjects

**Files:**
- Create: `apps/api/src/db/migrations/022_subject_clinical_context.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 022 — Clinical context fields on subjects (human patients)
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS medications        TEXT,
  ADD COLUMN IF NOT EXISTS smoking            VARCHAR(16),
  ADD COLUMN IF NOT EXISTS alcohol            VARCHAR(16),
  ADD COLUMN IF NOT EXISTS diet_type          VARCHAR(32),
  ADD COLUMN IF NOT EXISTS physical_activity  VARCHAR(16),
  ADD COLUMN IF NOT EXISTS family_history     TEXT;
```

- [ ] **Step 2: Run the migration**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/api
node src/db/migrate.js
```

Expected: `[apply] 022_subject_clinical_context.sql` then exits without error.

- [ ] **Step 3: Verify columns exist**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/api
node -e "require('dotenv').config(); const {Pool}=require('pg'); const p=new Pool({connectionString:process.env.DATABASE_URL}); p.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='subjects' AND column_name IN ('medications','smoking','alcohol','diet_type','physical_activity','family_history') ORDER BY column_name\").then(r=>console.log(r.rows.map(r=>r.column_name))).finally(()=>p.end())"
```

Expected: array with all 6 column names.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/022_subject_clinical_context.sql
git commit -m "feat: migration 022 — clinical context columns on subjects"
```

---

## Task 2: API — extend PUT /patients/:id to save clinical context fields

**Files:**
- Modify: `apps/api/src/routes/patients.js`

The `PUT /:id` handler currently destructures:
```js
const { name, birth_date, sex, phone, weight, height, blood_type, allergies, comorbidities, notes, breed, color, microchip, neutered, owner_id } = request.body;
```

And the UPDATE query uses 15 positional params ending at `$16` for `id`.

- [ ] **Step 1: Extend PUT /:id to include the 6 new fields**

In `apps/api/src/routes/patients.js`, find the `PUT /:id` handler and replace the entire handler body with:

```js
  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const {
      name, birth_date, sex, phone,
      weight, height, blood_type, allergies, comorbidities, notes,
      breed, color, microchip, neutered, owner_id,
      // clinical context
      medications, smoking, alcohol, diet_type, physical_activity, family_history
    } = request.body;

    const subject = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE subjects SET
           name              = COALESCE($1,  name),
           birth_date        = COALESCE($2,  birth_date),
           sex               = COALESCE($3,  sex),
           phone             = COALESCE($4,  phone),
           weight            = COALESCE($5,  weight),
           height            = COALESCE($6,  height),
           blood_type        = COALESCE($7,  blood_type),
           allergies         = COALESCE($8,  allergies),
           comorbidities     = COALESCE($9,  comorbidities),
           notes             = COALESCE($10, notes),
           breed             = COALESCE($11, breed),
           color             = COALESCE($12, color),
           microchip         = COALESCE($13, microchip),
           neutered          = COALESCE($14, neutered),
           owner_id          = COALESCE($15, owner_id),
           medications       = COALESCE($16, medications),
           smoking           = COALESCE($17, smoking),
           alcohol           = COALESCE($18, alcohol),
           diet_type         = COALESCE($19, diet_type),
           physical_activity = COALESCE($20, physical_activity),
           family_history    = COALESCE($21, family_history)
         WHERE id = $22 AND deleted_at IS NULL
         RETURNING *`,
        [name, birth_date, sex, phone,
         weight, height, blood_type, allergies, comorbidities, notes,
         breed, color, microchip, neutered, owner_id,
         medications ?? null, smoking ?? null, alcohol ?? null,
         diet_type ?? null, physical_activity ?? null, family_history ?? null,
         id]
      );
      return rows[0] || null;
    });
    if (!subject) return reply.status(404).send({ error: 'Patient not found' });
    return subject;
  });
```

- [ ] **Step 2: Smoke test via curl**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/api && node src/index.js &
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"SEU_EMAIL","password":"SUA_SENHA"}' | jq -r .token)

# Get a subject id (replace with a real one)
SUBJECT_ID=$(curl -s http://localhost:3000/patients -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

curl -s -X PUT "http://localhost:3000/patients/$SUBJECT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"medications":"metformina 850mg","smoking":"não_fumante","alcohol":"não","diet_type":"onívoro","physical_activity":"sedentário","family_history":"pai com DM2"}' | jq '{medications,smoking,alcohol,diet_type,physical_activity,family_history}'
```

Expected: response shows the 6 new fields with the values sent.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/patients.js
git commit -m "feat: extend PUT /patients/:id with 6 clinical context fields"
```

---

## Task 3: Worker — pass clinical context to agent prompts

**Files:**
- Modify: `apps/worker/src/processors/exam.js`

The worker currently fetches subject with:
```sql
SELECT s.name, s.birth_date, s.sex, s.subject_type, s.species, t.module
```

Then calls `anonymize(subject)` which strips name/birth_date. The `anonSubject` is passed to agents as `patient`.

- [ ] **Step 1: Add clinical context columns to the subject query**

In `apps/worker/src/processors/exam.js`, find the SQL inside `processExam`:

```js
    const { rows } = await client.query(
      `SELECT s.name, s.birth_date, s.sex, s.subject_type, s.species,
              t.module
       FROM exams e
       JOIN subjects s ON s.id = e.subject_id
       JOIN tenants  t ON t.id = e.tenant_id
       WHERE e.id = $1`,
      [exam_id]
    );
```

Replace with:

```js
    const { rows } = await client.query(
      `SELECT s.name, s.birth_date, s.sex, s.subject_type, s.species,
              s.weight, s.height, s.allergies, s.comorbidities,
              s.medications, s.smoking, s.alcohol, s.diet_type,
              s.physical_activity, s.family_history,
              t.module
       FROM exams e
       JOIN subjects s ON s.id = e.subject_id
       JOIN tenants  t ON t.id = e.tenant_id
       WHERE e.id = $1`,
      [exam_id]
    );
```

- [ ] **Step 2: Include clinical context in phase1 and phase2 agent calls**

The Phase 1 runner call currently:

```js
const { result, usage } = await runner({ examText, patient: anonSubject, guidelines });
```

The `anonSubject` from `anonymize(subject)` already contains sex and age_range. We need to add the clinical context fields directly — they are not PII so they don't need anonymization. After the `const anonSubject = anonymize(subject);` line, add:

```js
    const patientContext = {
      ...anonSubject,
      weight:            subject.weight            || null,
      height:            subject.height            || null,
      allergies:         subject.allergies          || null,
      comorbidities:     subject.comorbidities      || null,
      medications:       subject.medications        || null,
      smoking:           subject.smoking            || null,
      alcohol:           subject.alcohol            || null,
      diet_type:         subject.diet_type          || null,
      physical_activity: subject.physical_activity  || null,
      family_history:    subject.family_history     || null
    };
```

Then change Phase 1 runner calls from `patient: anonSubject` to `patient: patientContext`:

```js
      const { result, usage } = await runner({ examText, patient: patientContext, guidelines });
```

And Phase 2 ctx:

```js
    const phase2Ctx = {
      examText,
      patient: patientContext,
      specialtyResults,
      module: tenantModule,
      species: subject.species || null,
      chief_complaint: chief_complaint || '',
      current_symptoms: current_symptoms || ''
    };
```

- [ ] **Step 3: Update Phase 1 agent prompts to mention new fields**

In `apps/worker/src/agents/metabolic.js`, the user message currently sends:
```
Patient: sex=${ctx.patient.sex}, age_range=${ctx.patient.age_range}
```

Replace the user message content in `runMetabolicAgent` with:

```js
      content: `Patient context:
- sex: ${ctx.patient.sex}
- age_range: ${ctx.patient.age_range}
- weight: ${ctx.patient.weight || 'unknown'} kg
- height: ${ctx.patient.height || 'unknown'} cm
- medications: ${ctx.patient.medications || 'none reported'}
- smoking: ${ctx.patient.smoking || 'unknown'}
- alcohol: ${ctx.patient.alcohol || 'unknown'}
- diet_type: ${ctx.patient.diet_type || 'unknown'}
- physical_activity: ${ctx.patient.physical_activity || 'unknown'}
- allergies: ${ctx.patient.allergies || 'none reported'}
- comorbidities: ${ctx.patient.comorbidities || 'none reported'}
- family_history: ${ctx.patient.family_history || 'none reported'}

Lab Results:
${ctx.examText}

Guidelines:
${guidelinesText}`
```

Apply the same patient context block to `cardiovascular.js` and `hematology.js` (they each have a similar user message — update them the same way).

- [ ] **Step 4: Verify no syntax errors**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/worker
node -e "require('./src/processors/exam'); require('./src/agents/metabolic'); require('./src/agents/cardiovascular'); require('./src/agents/hematology')" && echo "OK"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/processors/exam.js apps/worker/src/agents/metabolic.js apps/worker/src/agents/cardiovascular.js apps/worker/src/agents/hematology.js
git commit -m "feat: pass clinical context (medications, lifestyle) to AI agents in patient context"
```

---

## Task 4: Frontend models — extend Subject interface

**Files:**
- Modify: `apps/web/src/app/shared/models/api.models.ts`

- [ ] **Step 1: Add 6 new optional fields to Subject interface**

Find the `Subject` interface and add after `owner_email`:

```ts
  // clinical context (human only)
  medications?: string;
  smoking?: 'não_fumante' | 'ex_fumante' | 'fumante';
  alcohol?: 'não' | 'social' | 'abusivo';
  diet_type?: 'onívoro' | 'vegetariano' | 'vegano' | 'outro';
  physical_activity?: 'sedentário' | 'moderado' | 'atleta';
  family_history?: string;
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/shared/models/api.models.ts
git commit -m "feat: extend Subject interface with clinical context fields"
```

---

## Task 5: Frontend — "Contexto Clínico" section in patient profile tab

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`

The profile tab has sections "Dados pessoais" and "Dados clínicos" inside a `.profile-grid`. We add a new section below for human patients only.

- [ ] **Step 1: Extend editForm with clinical context fields**

The `editForm` is typed as `Partial<Subject>`. Because `Subject` now has the 6 new fields, the editForm already handles them. Verify `loadSubject` passes through all fields:

```ts
  private loadSubject(id: string): void {
    this.http.get<Subject>(`${environment.apiUrl}/patients/${id}`).subscribe(s => {
      this.subject.set(s);
      this.editForm = {
        ...s,
        birth_date: s.birth_date ? s.birth_date.toString().slice(0, 10) : undefined
      };
    });
  }
```

This spreads `s` which now includes the clinical context fields — no change needed.

- [ ] **Step 2: Add CSS for clinical context section**

In the component `styles` array, add:

```css
    .clinical-ctx-grid {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 1rem; margin-bottom: 1rem;
    }
```

- [ ] **Step 3: Add "Contexto Clínico" section to the profile tab template**

In the profile tab template, find the section just before the save button div:

```html
              <div class="profile-section span-2 save-row">
                <button mat-flat-button style="background:#c0c1ff;color:#1000a9;font-weight:700"
                        (click)="saveProfile()">
                  Salvar alterações
                </button>
              </div>
```

Insert a new section immediately before that save button div (still inside the `@if (subject()) {` block and inside `.profile-grid`):

```html
              @if (subject()!.subject_type === 'human') {
                <div class="profile-section span-2">
                  <div class="section-label">Contexto Clínico</div>
                  <div class="field-row">
                    <mat-form-field appearance="outline">
                      <mat-label>Medicamentos em uso</mat-label>
                      <textarea matInput rows="2" [(ngModel)]="editForm.medications"
                                placeholder="Ex: metformina 850mg, atorvastatina 20mg"></textarea>
                    </mat-form-field>
                    <div class="clinical-ctx-grid">
                      <mat-form-field appearance="outline">
                        <mat-label>Tabagismo</mat-label>
                        <mat-select [(ngModel)]="editForm.smoking">
                          <mat-option value="não_fumante">Não fumante</mat-option>
                          <mat-option value="ex_fumante">Ex-fumante</mat-option>
                          <mat-option value="fumante">Fumante</mat-option>
                        </mat-select>
                      </mat-form-field>
                      <mat-form-field appearance="outline">
                        <mat-label>Etilismo</mat-label>
                        <mat-select [(ngModel)]="editForm.alcohol">
                          <mat-option value="não">Não</mat-option>
                          <mat-option value="social">Social</mat-option>
                          <mat-option value="abusivo">Abusivo</mat-option>
                        </mat-select>
                      </mat-form-field>
                      <mat-form-field appearance="outline">
                        <mat-label>Tipo de dieta</mat-label>
                        <mat-select [(ngModel)]="editForm.diet_type">
                          <mat-option value="onívoro">Onívoro</mat-option>
                          <mat-option value="vegetariano">Vegetariano</mat-option>
                          <mat-option value="vegano">Vegano</mat-option>
                          <mat-option value="outro">Outro</mat-option>
                        </mat-select>
                      </mat-form-field>
                      <mat-form-field appearance="outline">
                        <mat-label>Atividade física</mat-label>
                        <mat-select [(ngModel)]="editForm.physical_activity">
                          <mat-option value="sedentário">Sedentário</mat-option>
                          <mat-option value="moderado">Moderado</mat-option>
                          <mat-option value="atleta">Atleta</mat-option>
                        </mat-select>
                      </mat-form-field>
                    </div>
                    <mat-form-field appearance="outline">
                      <mat-label>Histórico familiar relevante</mat-label>
                      <textarea matInput rows="2" [(ngModel)]="editForm.family_history"
                                placeholder="Ex: pai com DM2, mãe com cardiopatia"></textarea>
                    </mat-form-field>
                  </div>
                </div>
              }
```

- [ ] **Step 4: Build check**

```bash
cd /home/rodrigonoma/GenomaFlow/apps/web && npx ng build --configuration=development 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/doctor/patients/patient-detail.component.ts
git commit -m "feat: Contexto Clínico section in patient profile tab (human only)"
```

---

## Self-Review Checklist

- Spec Part 4 (6 new columns): ✓ migration 022, PUT /patients/:id extended, GET already returns `*`
- All fields optional: ✓ COALESCE in SQL, all nullable, `??` null coalescion in API
- UI human-only: ✓ wrapped in `@if (subject()!.subject_type === 'human')`
- Saved via PUT /patients/:id: ✓ same endpoint, no new route
- Worker uses new fields in agent context: ✓ extended SQL query + patientContext object + updated prompt templates
- Vet patients unaffected: ✓ columns null by default, vet agents don't receive them (guard in template + irrelevant to vet prompts)
