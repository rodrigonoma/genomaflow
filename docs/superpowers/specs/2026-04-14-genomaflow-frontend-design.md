# GenomaFlow Frontend — Design Document

**Date:** 2026-04-14
**Version:** 1.0
**Status:** Approved

---

## 1. Overview

Angular SPA that serves three roles — `doctor`, `lab_tech`, `admin` — each in a dedicated lazy-loaded module with its own layout and routes. The app connects to the existing Fastify backend via HTTP (JWT-authenticated) and WebSocket (real-time exam status).

**Technology stack:**
- Angular 17+ with standalone components inside lazy modules
- Angular Material — UI components and theming
- TailwindCSS — layout, spacing, utility classes
- Native WebSocket — real-time exam notifications
- Nginx Alpine — production serving inside Docker

---

## 2. Architecture

### 2.1 Routing

```
/login           → AuthComponent (standalone)
/doctor/...      → DoctorModule (lazy) — guard: authenticated + role=doctor
/lab/...         → LabModule (lazy)    — guard: authenticated + role=lab_tech
/clinic/...      → ClinicModule (lazy) — guard: authenticated + role=admin
/                → redirect to module matching current role
```

### 2.2 Folder Structure

```
apps/web/
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── auth/
│   │   │   │   ├── auth.service.ts       # login, logout, JWT decode, role
│   │   │   │   ├── auth.guard.ts         # redirect to /login if unauthenticated
│   │   │   │   └── role.guard.ts         # block access by role
│   │   │   ├── interceptors/
│   │   │   │   └── jwt.interceptor.ts    # inject Authorization header on every request
│   │   │   └── ws/
│   │   │       └── ws.service.ts         # singleton WebSocket, BehaviorSubject per tenant
│   │   ├── shared/
│   │   │   ├── components/
│   │   │   │   ├── exam-card/
│   │   │   │   ├── alert-badge/
│   │   │   │   ├── risk-meter/
│   │   │   │   ├── exam-status/
│   │   │   │   └── disclaimer/
│   │   │   └── models/
│   │   │       └── api.models.ts         # Exam, Patient, ClinicalResult, Alert interfaces
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   ├── doctor/
│   │   │   ├── lab/
│   │   │   └── clinic/
│   │   ├── app.routes.ts
│   │   └── app.config.ts                 # provideRouter, provideHttpClient, Material
│   ├── environments/
│   │   ├── environment.ts                # apiUrl: localhost:3000, wsUrl: ws://localhost:3000
│   │   └── environment.prod.ts
│   └── styles.scss                       # Material theme + Tailwind base
├── Dockerfile
├── nginx.conf
└── angular.json
```

---

## 3. Core Services

### 3.1 AuthService

- `POST /auth/login` → stores JWT in `localStorage`
- `currentUser$: BehaviorSubject<{user_id, tenant_id, role} | null>`
- `logout()` — clears storage, navigates to `/login`
- Token decoded client-side (no extra API call) for role/tenant_id

### 3.2 JwtInterceptor

- Injects `Authorization: Bearer <token>` on every `HttpRequest`
- On 401 response: calls `AuthService.logout()` automatically

### 3.3 WsService

- Opens one WebSocket connection to `GET /exams/subscribe` after login
- `examUpdates$: Subject<{exam_id: string}>` — emits on every `exam:done` message
- Exponential backoff reconnect: 1s → 2s → 4s → max 30s
- Closes on logout
- No WebSocket logic outside this service — consumers use `examUpdates$.pipe(filter(...))`

### 3.4 Environments

```typescript
// environment.ts
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
  wsUrl: 'ws://localhost:3000'
};
```

No hardcoded URLs in components or services — always `environment.apiUrl`.

---

## 4. Shared Components

| Component | Purpose |
|---|---|
| `<app-exam-card>` | Card with filename, status badge, date, link to result |
| `<app-alert-badge>` | Color-coded chip: `low`=gray, `medium`=yellow, `high`=orange, `critical`=red |
| `<app-risk-meter>` | Horizontal progress bar with label (e.g. "Risco cardiovascular: alto") |
| `<app-exam-status>` | Animated spinner for `pending`/`processing`, static icon for `done`/`error` |
| `<app-disclaimer>` | Fixed PT-BR disclaimer text with warning icon — shown in every result panel |

### API Models (`api.models.ts`)

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
  created_at: string;
  updated_at: string;
  results: ClinicalResult[] | null;
}
```

---

## 5. Doctor Module (`/doctor`)

### Routes

```
/doctor/patients              → patient list
/doctor/patients/:id          → patient profile + exam history
/doctor/patients/:id/exams    → exam upload + real-time status
/doctor/results/:examId       → clinical result panel
```

### Screens

**Patient List**
- Table with name search, last exam status badge, "Novo exame" button
- Navigates to patient profile on row click

**Patient Profile**
- Basic info: sex, age range
- Exam history list ordered by date — each item shows date, status badge, agent types
- "Enviar novo exame" button → navigates to exam upload

**Exam Upload**
- `<input type="file" accept=".pdf">` with `patient_id` pre-filled from route
- On submit: `POST /exams` multipart
- Exam card appears immediately with `pending` status
- WsService notifies → card updates to `done` inline (no reload) + Material snackbar toast "Resultado disponível" with link to `/doctor/results/:examId`

**Clinical Result Panel**
- Two-column layout:
  - *Left:* patient summary (sex, age range), exam date, exam selector for comparison
  - *Right:* critical alerts (AlertBadge by severity), risk meters by area, full interpretation text, `<app-disclaimer>`
- **Exam comparison:** selecting a second exam splits the right column into two side-by-side columns (current vs. selected) — scores and alerts shown for each

---

## 6. Lab Module (`/lab`)

### Routes

```
/lab/uploads     → upload + processing queue (single screen)
```

### Screen

**Upload Tabs**

- *Individual tab:* single PDF upload with patient search by name → submits to `POST /exams`
- *Batch tab:* multi-file dropzone (`multiple` attribute). Each file generates a queue row. `patient_id` inferred from filename pattern `CPF_NOME.pdf` or manually assigned before submit.

**Processing Queue**

Real-time table updated via WsService:

| File | Patient | Sent at | Status | Agents |
|------|---------|---------|--------|--------|
| exame.pdf | João Silva | 14/04 10:32 | 🟡 processing | metabolic |
| outro.pdf | Maria Lima | 14/04 10:30 | 🟢 done | cardiovascular |

- Status updates inline on WebSocket notification
- `done` row: link icon to result panel
- `error` row: tooltip with error message
- Filter by status (all / pending / processing / done / error)

---

## 7. Clinic Module (`/clinic`)

### Routes

```
/clinic/dashboard    → aggregate metrics
/clinic/users        → tenant user management
```

### Dashboard (`/clinic/dashboard`)

Material card grid (Tailwind grid layout):
- Exam counts: today / this week / this month
- Exams by status — visual progress bar breakdown
- Recent critical alerts — last 10 `severity=critical` with patient name and date
- Average processing time — computed from `created_at` vs `updated_at`
- Most-used agents — count by type (metabolic, cardiovascular, hematology)

Data sourced from existing `GET /alerts` and `GET /exams` endpoints — no new backend endpoint needed for metrics.

### User Management (`/clinic/users`)

Table of tenant users:
- Email, role badge, created_at
- "Convidar usuário" button → modal: email + role selector (doctor / lab_tech / admin) → `POST /users`
- "Remover" button with confirmation dialog → `DELETE /users/:id`

---

## 8. Backend Additions Required

Two new endpoints on the API (admin-only, scoped by tenant RLS):

```
POST   /users        — invite user to tenant: { email, password, role }
DELETE /users/:id    — remove user from tenant
```

Both require `role=admin` guard on the Fastify route. RLS ensures tenant isolation at DB level.

---

## 9. Infrastructure

### Dockerfile (`apps/web/`)

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
COPY --from=build /app/dist/web/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

### nginx.conf

```nginx
server {
  listen 80;

  location /api/ {
    proxy_pass http://api:3000/;
  }

  location / {
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;
  }
}
```

### docker-compose addition

```yaml
web:
  build: ./apps/web
  ports:
    - "4200:80"
  depends_on:
    - api
```

---

## 10. Testing Strategy

- **Unit tests:** AuthService, WsService, shared components — Angular TestBed with mock HttpClient
- **Guard tests:** auth.guard and role.guard with mock AuthService
- **Component tests:** ExamCard, AlertBadge, RiskMeter with @Input data
- **E2E (Phase 2):** Cypress golden path — login → upload exam → wait for result → view panel

---

## 11. Out of Scope (MVP)

- Mobile / responsive optimization (desktop-first)
- Dark mode
- Internationalization (PT-BR only)
- Push notifications (browser Notification API)
- Offline support / PWA
