# GenomaFlow MVP — Design Document

**Date:** 2026-04-13
**Version:** 1.0
**Status:** Approved

---

## 1. Vision

GenomaFlow is a Clinical Intelligence Platform that transforms laboratory exams into actionable clinical insights using specialized AI agents. The MVP targets three user personas — doctors, labs, and clinics — connected through a multi-tenant SaaS platform.

**Core flow:** exam upload (PDF) → async AI processing → structured clinical analysis → real-time dashboard. HL7/FHIR integration is Phase 2.

**Non-negotiable constraints:**
- IA is decision support only — never final diagnosis
- Multi-tenant with RLS from day one
- LGPD compliance: patient data anonymized before leaving the system

---

## 2. Users and Roles

| Role | Tenant Type | Primary Action |
|------|------------|----------------|
| `doctor` | clinic | upload exams, view patient analysis |
| `lab_tech` | lab | upload exams in batch or via API |
| `admin` | clinic / lab | manage users, view aggregate dashboard |

---

## 3. Architecture

### 3.1 Overview

```
┌─────────────────────────────────────────────────────┐
│                   Angular SPA                        │
│  [Doctor View] [Lab View] [Clinic View]              │
└─────────────────────┬───────────────────────────────┘
                      │ HTTPS
┌─────────────────────▼───────────────────────────────┐
│              Fastify API (modular monolith)           │
│                                                      │
│  /auth     → JWT + tenant validation                 │
│  /exams    → upload, status, results                 │
│  /patients → CRUD with RLS                           │
│  /alerts   → clinical alerts                         │
│  /agents   → agent config per tenant                 │
└──────┬──────────────────────────┬────────────────────┘
       │ enqueues job             │ read/write
┌──────▼──────┐          ┌────────▼────────────────────┐
│  Redis Queue│          │  PostgreSQL + pgvector       │
│  (BullMQ)   │          │  - tenants (RLS)             │
└──────┬──────┘          │  - patients                  │
       │                 │  - exams                     │
┌──────▼──────────────┐  │  - clinical_results          │
│   Exam Worker        │  │  - rag_documents             │
│                      │  └─────────────────────────────┘
│  1. parse PDF/HL7    │
│  2. anonymize data   │
│  3. RAG (pgvector)   │
│  4. Claude API       │
│  5. save result      │
│  6. notify via WS    │
└──────────────────────┘
```

### 3.2 API Modules (Fastify)

- **auth** — login, JWT issuance, tenant context injection
- **exams** — file upload (PDF), status polling, result retrieval
- **patients** — CRUD, always scoped by `tenant_id`
- **alerts** — retrieve clinical alerts by patient or exam
- **agents** — per-tenant agent configuration

### 3.3 Async Processing (BullMQ + Redis)

The API never calls Claude directly. Every exam is enqueued as a job. The worker processes it asynchronously and notifies the frontend via WebSocket when done. This decouples slow AI processing (5–30s) from API response time.

---

## 4. Database Schema

```sql
-- Core multi-tenancy
tenants (
  id uuid PK,
  name text,
  type text CHECK (type IN ('clinic', 'lab', 'hospital')),
  plan text,
  created_at timestamptz
)

-- Users scoped to a tenant
users (
  id uuid PK,
  tenant_id uuid FK → tenants,
  email text UNIQUE,
  password_hash text,
  role text CHECK (role IN ('doctor', 'lab_tech', 'admin')),
  created_at timestamptz
)

-- Patients scoped to a tenant
patients (
  id uuid PK,
  tenant_id uuid FK → tenants,
  name text,
  birth_date date,
  sex text,
  cpf_hash text,
  created_at timestamptz
)

-- Exams with processing status
exams (
  id uuid PK,
  tenant_id uuid FK → tenants,
  patient_id uuid FK → patients,
  uploaded_by uuid FK → users,
  status text CHECK (status IN ('pending', 'processing', 'done', 'error')),
  source text CHECK (source IN ('upload', 'hl7', 'fhir')),
  file_path text,
  raw_data jsonb,
  created_at timestamptz
)

-- AI-generated clinical results
clinical_results (
  id uuid PK,
  exam_id uuid FK → exams,
  tenant_id uuid FK → tenants,
  agent_type text,
  interpretation text,
  risk_scores jsonb,
  alerts jsonb,
  model_version text,
  created_at timestamptz
)

-- RAG knowledge base
rag_documents (
  id uuid PK,
  source text,
  title text,
  content text,
  embedding vector(1536),
  created_at timestamptz
)
```

### 4.1 Row Level Security

Every table with `tenant_id` has an RLS policy:

```sql
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

The API sets `app.tenant_id` on every authenticated connection. Tenant isolation is enforced at the database level, not just the application layer.

---

## 5. Clinical Agents

### 5.1 MVP Agents

| Agent | Specialty | Markers |
|-------|-----------|---------|
| `metabolic_agent` | Endocrinology / Metabolism | Glucose, HbA1c, insulin, TSH, T4 |
| `cardiovascular_agent` | Cardiology | Total cholesterol, LDL, HDL, triglycerides, CRP |
| `hematology_agent` | Hematology | Full blood count (RBC, WBC, platelets) |

### 5.2 Worker Pipeline

```
1. Parse
   PDF → text extraction (pdf-parse)

2. Classification
   Identify markers present → select agent(s) to invoke

3. Anonymization (LGPD)
   Remove: name, CPF, exact birth date
   Keep: sex, age range, lab markers

4. RAG
   Generate embedding of anonymized markers
   Query pgvector for relevant clinical guidelines
   (e.g., ADA guidelines for diabetes, SBC for cholesterol)

5. Claude API call
   System: agent persona + retrieved guidelines
   User: anonymized patient markers

6. Structured response
   {
     interpretation: string,
     risk_scores: { cardiovascular?: string, metabolic?: string, ... },
     alerts: [{ marker, value, severity: low|medium|high|critical }],
     disclaimer: string
   }

7. Persist to clinical_results
   Notify frontend via WebSocket
```

### 5.3 Mandatory Disclaimer

Every `clinical_results` record must include:

> "Esta análise é um suporte à decisão clínica e não substitui avaliação médica profissional."

---

## 6. AI Engine

- **Model:** Claude (Anthropic API) — claude-sonnet-4-6 for production, claude-haiku-4-5 for triage/classification
- **RAG knowledge base:** clinical guidelines ingested as embeddings into pgvector (ADA, SBC, CFM protocols, PubMed excerpts)
- **Prompt caching:** enabled for system prompts (agent personas + static guidelines) to reduce cost
- **Data leaving the system:** only anonymized markers — no PII sent to Anthropic API

---

## 7. Frontend (Angular)

### 7.1 Module Structure

```
src/app/
├── core/                    # guards, interceptors, auth service, WS service
├── shared/                  # reusable components (exam card, alert badge, risk meter)
└── features/
    ├── auth/                # login, tenant selection
    ├── doctor/
    │   ├── patients/        # patient list and profile
    │   ├── exams/           # upload + real-time status
    │   └── results/         # clinical analysis panel
    ├── lab/
    │   ├── uploads/         # batch upload or API integration
    │   └── queue/           # processing queue view
    └── clinic/
        ├── dashboard/       # management overview
        └── users/           # doctor/tech management
```

### 7.2 Technology

- Angular 17+ with standalone components
- Angular Material for UI
- Native WebSocket for real-time notifications
- JWT interceptor for automatic auth on all requests

### 7.3 Doctor Golden Path

```
Login
  → Patient list
    → Select patient
      → Upload exam (PDF)
        → Processing status (real-time via WebSocket)
          → Clinical result panel:
              Patient summary | Exam date
              Critical alerts (highlighted)
              Risk scores per area
              Full interpretation text
              Disclaimer
```

---

## 8. Infrastructure

```yaml
services:
  api:       Fastify monolith (Node.js Alpine)
  worker:    Exam processing worker (Node.js Alpine)
  web:       Angular SPA (Nginx Alpine)
  db:        PostgreSQL 15 Alpine + pgvector extension
  redis:     Redis Alpine (BullMQ queue)
```

All services run in Docker. WSL + Docker Desktop for local development.

---

## 9. Roadmap After MVP

| Phase | Feature |
|-------|---------|
| 2 | HL7/FHIR API integration (lab-side) |
| 2 | Longitudinal patient history analysis |
| 3 | Genomic exam support |
| 3 | Additional specialized agents (neurology, nephrology) |
| 4 | Clinical data platform APIs for pharma / insurance partners |

---

## 10. Out of Scope (MVP)

- Genomic sequencing analysis
- DICOM / imaging support
- Direct EHR (prontuário eletrônico) integration
- Predictive risk models (trained on proprietary data)
- Mobile app
