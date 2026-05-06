---
name: Aesthetic Clinic F1 Foundation
description: Module 'estetica' + professional_type — schema additive, requireMedico middleware, onboarding 3 cards. F1 entregue 2026-05-06
type: project
---

# F1 Foundation — entregue 2026-05-06

Spec: `docs/superpowers/specs/2026-05-05-aesthetic-clinic-module-design.md`
Plano: `docs/superpowers/plans/2026-05-05-aesthetic-clinic-f1-foundation.md`

## Schema (migration 079)

- `tenants.module` enum estendido pra `('human','veterinary','estetica')`
- `users.professional_type` ('medico','esteticista','dentista','biomedico','outro') com backfill 'medico' e default 'medico'
- `subjects.fitzpatrick_type` (1-6) e `subjects.skin_concerns` (jsonb default `[]`) opcionais
- `appointments.appointment_type` estendido com 'avaliacao_estetica','procedimento_estetico','retorno_estetica'
- `clinical_encounters.encounter_type` estendido com 'avaliacao_estetica','pos_procedimento'

## Middleware

`apps/api/src/middleware/professional-gate.js` exporta `requireMedico` que retorna 403 se `request.user.professional_type` não for `medico` ou `dentista`. Aplicado em rotas mutativas de `prescriptions.js` (POST `/`, PUT `/:id`, POST `/:id/pdf`, POST `/:id/send-email`) — esteticista bloqueado.

GETs de prescriptions ficam abertos — esteticista pode VER prescrições do paciente, só não criar/editar.

## Onboarding

Step 2 ganha 3º card "Clínica de Estética" + sub-bloco "Tipo de profissional" (Médico / Esteticista) inline quando module='estetica'. Esteticista pula Step 3 (especialidades médicas) → vai direto pro Step 4 (pagamento).

## Onboarding-checkout (Stripe single-shot)

Frontend manda `professional_type` no payload do `POST /onboarding/checkout`. Backend:
1. `routes/onboarding-checkout.js` valida contra VALID_PROFESSIONAL_TYPES + default 'medico'
2. Propaga via `metadata.professional_type` da Stripe Checkout Session
3. `services/billing-events.js` `handleOnboardingSubscriptionCompleted` lê metadata e inclui `professional_type` no INSERT de users após webhook de pagamento confirmado

3 camadas de fail-closed (default 'medico'): no body extraction, na metadata read, no migration default. Erro de digitação na landing nunca libera prescrição indevida.

## Frontend

- **Sidebar:** `app.component.ts` ganhou helpers `subjectLabelForModule` e `subjectIconForModule` — module='estetica' renderiza "Clientes" + ícone `spa`. Tenant chip topbar idem com `tenantTooltipForModule/IconForModule/BadgeForModule`.
- **patient-detail:** campos `fitzpatrick_type` (select 1-6 com descrições) e `skin_concerns` (input CSV via helper `parseConcerns`) renderizados condicional `@if (subject_type==='human' && currentProfile?.module==='estetica')`.
- **Botões "Nova prescrição":** wrappados com `@if (professional_type === 'medico' || === 'dentista')` em result-panel + patient-detail aba Análises IA + Tratamentos. Esteticista vê Baixar PDF (read-only) mas não Editar/Excluir.

## Padrão pra F2-F5

- Code novo prefixado `aesthetic/` no path (api routes, web features, worker agents)
- Tests sempre cobrem: backend gate por professional_type (Fastify isolado + mock pg), frontend hide UI por professional_type
- Migrations sempre additive (DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT com lista estendida)
- 3 camadas de fail-closed quando criar campo crítico: body validation + metadata/payload validation + DB default

## Tests novos

- `tests/middleware/professional-gate.test.js` (5 cases — medico/dentista pass, esteticista/biomedico/undefined 403)
- `tests/routes/prescriptions-medico-gate.test.js` (3 cases — POST 403, PUT 403, medico passa)
- `tests/routes/onboarding-checkout.test.js` (4 cases — propaga professional_type, validação, defaults)
- `tests/routes/webhooks-stripe.test.js` ganhou 3 cases novos pra `handleOnboardingSubscriptionCompleted` com professional_type

Total: 592 verdes na API (+15), 31 verdes web.

## Commits da fase

- `596890f5` — migration 079
- `71649188` — VALID_MODULES + VALID_PROFESSIONAL_TYPES
- `51d1e1c5` — middleware requireMedico (TDD)
- `456a6455` — gate em prescription routes
- `44e9e908` — auth.js professional_type
- `8eb40d50` — UserProfile interface
- `7cd9a0be` — onboarding 3 cards + sub-step
- `ddd0d77c` — onboarding-checkout + webhook propagam professional_type
- `27cf8253` — sidebar Clientes + ícone spa
- `ecbdbe1f` — patient-detail campos estéticos
- `93753f9f` — hide prescription buttons pra esteticista
