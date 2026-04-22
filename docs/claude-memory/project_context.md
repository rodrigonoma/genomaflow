---
name: GenomaFlow Project Context
description: Frontend + backend em produção — stack, arquitetura, estado atual (atualizado 2026-04-21)
type: project
originSessionId: 70201c53-e120-4e84-a6d1-e96d8946598d
---
GenomaFlow é uma plataforma SaaS multi-tenant de inteligência clínica (Brasil). Exames laboratoriais (PDF) e imagens médicas (DICOM, JPG, PNG) são enviados, processados de forma assíncrona por agentes de IA (Claude + RAG) e os resultados exibidos em dashboard em tempo real.

**Stack:** Fastify 4 (API) + BullMQ/Redis (queue) + PostgreSQL 15 + pgvector + Node 20 Alpine + Angular 18 standalone + Docker + WSL + AWS ECS Fargate.

**Backend: COMPLETO (main branch)**
- 40 migrations aplicadas (uuid-ossp → file_type em exams + metadata em clinical_results)
- RLS com FORCE ROW LEVEL SECURITY em todas as tabelas tenant-scoped
- Fastify plugins: postgres, redis, JWT auth, WebSocket pubsub
- Routes: /auth/login, /patients, /exams (multipart + WS /subscribe), /alerts, /users, /billing, /chat, /feedback, /error-log
- BullMQ worker: PDF parse → OCR fallback (claude-haiku) → PII scrub → RAG → Claude agents → persist → Redis notify
- Worker também escuta Redis pub/sub: `subject:upserted:*` e `billing:updated:*` → re-indexa RAG automaticamente
- Agentes IA Fase 1 (human): metabolic, cardiovascular, hematology
- Agentes IA Fase 1 (veterinary): small_animals, equine, bovine
- Agentes IA Fase 2: therapeutic, nutrition, clinical_correlation (human), therapeutic, nutrition (veterinary)
- Agentes de imagem: imaging_rx, imaging_ecg, imaging_ultrasound, imaging_mri
- Pipeline de imagem: DICOM → PNG (jimp) → Vision classifier → agente específico → resultado com bounding boxes
- Credit ledger com kinds: agent_usage, ocr_usage, credit_purchase
- `publishSubjectUpserted` em patients.js dispara re-indexação RAG ao criar/editar paciente

**Frontend Angular: COMPLETO (main branch)**
- Módulos human e veterinary (label/ícone dinâmico por módulo)
- Rotas: /clinic/dashboard, /clinic/users, /clinic/billing, /doctor/patients, /doctor/review-queue, /doctor/results/:id, /onboarding
- exam-upload: suporte a PDF, DICOM, JPG, PNG; auto-update via WS + polling 8s; back button para perfil do paciente
- result-panel: back button, identity chip linkável, suporte a imaging_mri com bounding boxes
- exam-card: exibe error_message real da API; botão "Tentar Novamente" chama /reprocess
- FeedbackDialog: preview de screenshot (até 5MB), validação, área de drop com hint contextual
- WsService: detecta eventos por `msg['event'] ?? msg['type']`; billing events separados de exam events
- patient-detail: polling 8s para exames pending/processing

**Papel único: `admin`**
- Não existem mais perfis doctor/lab_tech — migration 037 converteu todos para admin
- Role `master` preservado para superusuário rodrigonoma

**ICP:** Clínicas de médio porte no Brasil. Médico é dono do negócio e usuário direto.

**Why:** LGPD + multi-tenant from day one; AI é suporte à decisão, nunca diagnóstico.
**How to apply:** Qualquer nova feature usa withTenant; nunca bypass RLS; sempre disclaimer em PT-BR em clinical_results. Só existe role admin (e master para super). Rotas apontam para /doctor/* (pacientes, review-queue, results) e /clinic/* (dashboard, users, billing).
