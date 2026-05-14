# Aesthetic F4 — Nutrition + Profile Implementation Plan (RETROACTIVE)

> **Nota:** Plan registrado retroativamente em 2026-05-12. F4 foi planejado e executado inline durante 2026-05-11 sem plan file dedicado. Este documento registra as 7 tasks que foram executadas para fins de rastreabilidade.

**Goal:** Perfil antropométrico do paciente (altura, peso, idade, sexo, atividade, objetivos) + cálculo de TMB (Mifflin-St Jeor) + recomendações nutricionais ricas pela IA com disclaimer CRN fail-safe.

**Architecture:** 1 migration aditiva (`subjects.aesthetic_profile JSONB`) + 2 services API (tmb + profile) + 1 route CRUD + 1 lib worker (mirror do tmb api) + processor fetch profile + recommender prompt estendido + 1 service Angular + 1 component standalone + integração patient-detail.

**Tech Stack:** Igual F1-F3.

**Spec de referência:** `docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md` §4.6, §5.6, §6.4 F4.

---

## Tasks executadas (7)

### Task 1: Migration 095 `subjects.aesthetic_profile JSONB`
- File: `apps/api/src/db/migrations/095_subjects_aesthetic_profile.sql`
- `ALTER TABLE subjects ADD COLUMN aesthetic_profile JSONB NOT NULL DEFAULT '{}'`
- Index parcial só pra rows com profile preenchido
- Multi-módulo safe (default '{}' invisível pra human/vet)

### Task 2: Service `aesthetic-tmb.js` (API)
- File: `apps/api/src/services/aesthetic-tmb.js`
- Mifflin-St Jeor + ACTIVITY_FACTOR + GOAL_ADJUSTMENT + computeMacros
- `computeAll(profile)` integrador
- 13 testes

### Task 3: Service `aesthetic-profile.js` + route
- Files: `apps/api/src/services/aesthetic-profile.js`, `apps/api/src/routes/aesthetic-profile.js`
- `validate()` clamp + whitelist + sanitize string arrays + strip campos extras
- GET/PUT `/aesthetic/profile/:subject_id` sob `requireEsteticaModule`
- withTenant + audit channel='ui' + AND tenant_id explícito
- 15 testes route

### Task 4: Worker tmb lib + processor + recommender
- Files: `apps/worker/src/lib/tmb.js`, `apps/worker/src/processors/aesthetic-analysis.js`, `apps/worker/src/agents/aesthetic-recommender.js`
- TMB lib espelhado de api (pure math, sem cross-package require, comentário sync)
- Processor fetcha aesthetic_profile + computa nutrição server-side antes do call Opus
- Recommender prompt: "use EXATAMENTE estes valores. NÃO recalcule" + bloco PERFIL DO PACIENTE
- **Disclaimer CRN injetado sempre** em sanitizeLifestyle (fail-safe regulatório)
- Fallback gracioso pra computedNutrition se LLM omite lifestyle
- 21 testes

### Task 5: Frontend service + form component
- Files: `apps/web/src/app/features/aesthetic/services/aesthetic-profile.service.ts`, `apps/web/src/app/features/aesthetic/components/aesthetic-profile-form.component.ts`
- Service tipado + constantes ACTIVITY_LEVELS/GOAL_OPTIONS/DIETARY_OPTIONS
- Component standalone OnPush + 6 seções (antropometria, atividade, objetivos, restrições, alergias, condições)
- Painel TMB/calorias/macros lateral
- Disclaimer CRN visível
- 7 testes

### Task 6: patient-detail integration
- File: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`
- Nova aba "Perfil Estético" gated `auth.currentProfile?.module === 'estetica'`
- Paridade multi-módulo (human/vet não veem)

### Task 7: Memória + landing
- File: `docs/claude-memory/project_aesthetic_f4_nutrition.md`
- MEMORY.md indexed
- Landing card PROTO-1 expandido pra mencionar catálogo + atualização mensal

---

## Resultado

- ~56 testes novos (28 API + 21 worker + 7 web)
- 0 regressões
- Multi-módulo zero break
- Mudança crítica: TMB é computado server-side, NÃO delegado ao LLM (aritmética regulatória)
- Disclaimer CRN é fail-safe (injetado sempre, mesmo se Opus esquecer)

Detalhes completos: `docs/claude-memory/project_aesthetic_f4_nutrition.md`.
