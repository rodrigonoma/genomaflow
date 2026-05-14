---
name: Phase 1 PMS Expansion — Prontuário + Agenda Multi-Profissional (entregue 2026-05-05)
description: Prontuário clínico estruturado (encontros + sinais vitais), timeline unificada por paciente, agenda multi-profissional, cadastros expandidos. Sem quebrar funcionalidades existentes
type: project
---

Primeiro passo do plano de transformar o GenomaFlow em PMS clínico completo (Caminho A) — fechou o gap mais crítico vs simples.vet: prontuário/evolução. Spec: `docs/superpowers/specs/2026-05-05-clinical-pms-expansion-design.md`. Plano: `docs/superpowers/plans/2026-05-05-phase-1-prontuario-agenda.md`.

## Decisões tomadas (autorizadas pelo usuário 2026-05-05 sem aprovação por questão)

1. **Edição de encontro:** 24h pra autor editar; depois 409, força adendo (criar novo encounter `encounter_type='retorno'`). Após `signed_at`, imutável.
2. **Visibilidade entre profissionais:** profissional vê encontros de qualquer profissional do mesmo tenant (clínica colaborativa). Master sempre vê tudo. Configuração por tenant fica para Fase 4+.
3. **Backfill `appointments.appointment_type`:** rows existentes ganham `'consulta'` ou `'outro'` (se `status='blocked'`). `user_id` permanece como o profissional (não duplicado em coluna nova — economia de schema).
4. **Aba "Prontuário":** NOVA aba no patient-detail, posicionada entre "Perfil" e "Exames". Não toca em outras abas.
5. **Vacinas humano:** ficam pra Fase 2 só vet; humano fica deferido pra Fase 4+ se ICP humano pedir.
6. **Cross-module field validation:** **REJEITAR com 400** explicitamente (`vital_signs.hydration` em humano = 400; `medical_history` em vet = 400). Explicit > implicit.

## Migrations 065-068

- **065** `clinical_encounters.sql` — tabela `clinical_encounters` (consulta/evolução estruturada, universal humano+vet com colunas opcionais por módulo) + tabela `vital_signs` (1:1 com encounter, separada pra futuro gráfico longitudinal). RLS NULLIF + audit trigger genérico (LGPD/compliance médico). 3 indexes: timeline por subject, agenda por profissional, ligação com appointment
- **066** `subjects_clinical_extended.sql` — adiciona `microchip`, `allergies_text`, `current_weight_kg`, `neutered` (vet); `birth_date`, `sex`, `emergency_contact_name`, `emergency_contact_phone`, `insurance_name` (humano). Todos NULL — zero risco. Index parcial em `microchip`
- **067** `owners_observations.sql` — `observations TEXT NULL` em `owners`
- **068** `appointments_appointment_type.sql` — `appointment_type` enum (consulta/retorno/vacina/procedimento/banho_tosa/telemedicina/exame/outro). 3 passos atômicos: ADD nullable → backfill → SET NOT NULL. Index composto novo `(tenant_id, user_id, appointment_type, start_at)`. **Decisão importante:** mantemos `user_id` como o profissional (já era — V1 foi single-doctor), NÃO criamos `professional_user_id` redundante. Multi-prof emerge naturalmente por filtro

## Backend — endpoints novos

| Path | Método | Notas |
|---|---|---|
| `/encounters` | POST | Cria encounter + vital signs em transação. `withTenant({ channel: 'ui' })`. Snapshot peso atual em `subjects.current_weight_kg` quando vital signs trazem peso |
| `/encounters?subject_id=&cursor=&limit=` | GET | Lista encontros do sujeito. **Cursor pagination** base64(`ISOdate|uuid`) — sem OFFSET. Default limit 50, max 200. JOIN com `users` (professional_email) e `vital_signs` |
| `/encounters/:id` | GET | Detalhe completo |
| `/encounters/:id` | PATCH | Atualiza. **409** se >24h da criação ou `signed_at` populado. Apenas autor pode editar. UPSERT vital_signs |
| `/encounters/:id/sign` | POST | Marca `signed_at = NOW()`. Vira imutável. Apenas autor pode assinar |
| `/patients/:id/timeline?cursor=&limit=` | GET | **UNION ALL** de encontros + exames + prescrições + análises IA, ordem cronológica desc. Wrapper `withTenant` (exams/clinical_results têm RLS direto sem NULLIF) |
| `/agenda/professionals` | GET | Lista users ativos do tenant (selector multi-prof) |
| `/agenda/appointments?professional_id=...` | GET | **Retrocompat:** sem `professional_id` = comportamento V1 (self). Com `professional_id=all` = todos do tenant (admin/master only). Com uuid = filtra. **Bonus:** `?appointment_type=` filtra por tipo |

## Backend — endpoints estendidos (sem breaking change)

- `PUT /patients/:id` — aceita campos extras opcionais: `allergies_text`, `current_weight_kg`, `emergency_contact_name`, `emergency_contact_phone`, `insurance_name`. COALESCE preserva valor antigo
- `PUT /patients/owners/:id` — aceita `observations` opcional
- `POST /agenda/appointments` — aceita `appointment_type` opcional (default `'consulta'` ou `'outro'` se status=blocked). Backward-compat: clientes V1 continuam funcionando
- `PATCH /agenda/appointments/:id` — `appointment_type` agora atualizável

## Frontend — componentes novos

Em `apps/web/src/app/features/encounters/`:
- `EncountersService` — HTTP service (list, get, create, update, sign, timeline). Cursor pagination
- `EncounterFormComponent` — shell shared do form. Renderização universal + `@if (module === 'human') { ... }` explícito + sub-component módulo-específico de vital signs
- `vet/VetVitalSignsComponent` — peso/temp/FC/FR/hidratação/mucosas/dor (sem PA)
- `human/HumanVitalSignsComponent` — peso/temp/FC/FR/PA sistólica+diastólica/dor (sem hidratação/mucosas)
- `EncounterListComponent` — lista de encontros com header (tipo + data + signed badge), corpo (queixa, anamnese, conduta, retorno) e rodapé (vitals chips). Cursor pagination via "Carregar mais"
- `TimelineComponent` — timeline unificada com badges coloridos por tipo (encounter=violeta, exam=verde, prescription=amarelo, ai_analysis=vermelho). Cursor pagination

Frontend — integrações:
- `patient-detail.component.ts` — nova aba **"Prontuário"** entre "Perfil" e "Exames". `moduleHint()` resolve módulo a partir de `subject.subject_type` (preferido) ou `auth.currentProfile.module` (fallback)
- `agenda-page.component.ts` — seletor de profissional no toolbar (`<select>` com "Minha agenda" / "Toda a clínica" / lista). Carrega via `loadProfessionals()` em `ngOnInit`. `loadWeek()` passa `professional_id` se selecionado
- `agenda.service.ts` — `listAppointments` ganha terceiro arg `professionalId?: string | 'all'`. Novo método `listProfessionals()`

## Estratégia de separação humano/vet (P2 da spec)

**Princípio guia:** infraestrutura compartilhada onde a regra é a mesma; código separado onde a regra diverge. Sem `if (module) { 50 lines } else { 50 lines }` no meio de rota compartilhada.

**Aplicado:**
- Schema: `clinical_encounters` e `vital_signs` são tabelas únicas com colunas opcionais por módulo (NULL pra módulo que não usa)
- Backend: `validateEncounterBody(body, module, isUpdate)` e `validateVitalSigns(vs, module)` ramificam por módulo apenas onde o regex de cross-module precisa rejeitar — handler de rota é único
- Frontend: `EncounterFormComponent` é shell shared; sub-components `VetVitalSigns` e `HumanVitalSigns` ficam em pastas separadas `vet/` e `human/`. Template usa `@if (module === 'veterinary') { <app-vet-vital-signs> } @else { <app-human-vital-signs> }` explícito

## Performance — decisões P3

- **Indexes compostos** com `tenant_id` primeiro (RLS + filtro): `(tenant_id, subject_id, created_at DESC, id DESC)` em `clinical_encounters` e `vital_signs`; `(tenant_id, professional_user_id, created_at DESC)` em encounters; `(tenant_id, user_id, appointment_type, start_at)` em appointments
- **Cursor pagination** em listagens de encounter e timeline (base64 de `(created_at, id)` tuple, sem OFFSET — escala em N+ páginas)
- **Timeline UNION ALL** (não N queries no app server) com discriminator + ORDER BY DESC + LIMIT
- **Sem N+1**: list encounter já faz JOIN com users (professional_email) e vital_signs
- **`withTenant` wrapper** na timeline (exams/clinical_results têm RLS direto sem NULLIF — fora de contexto seriam vazias)

## Testes (CI gate +14)

- `apps/api/tests/routes/encounters-validation.test.js` — Fastify isolado, 14 cases:
  - subject_id obrigatório, encounter_type whitelist
  - cross-module: medical_history rejeitado em vet, hydration rejeitado em humano
  - vital_signs ranges (weight, pain_score)
  - attachments max 20, shape obrigatório
  - cursor inválido ignorado (não quebra)
  - limit clamp 200
- Adicionado ao `package.json#test:unit` (CI gate)
- **Resultado:** 424 passed / 20 skipped / 22 suites (era 410/20/21)

## Arquivos alterados

**Backend (8 arquivos):**
- `apps/api/src/db/migrations/065_clinical_encounters.sql` (NEW, ~100 linhas)
- `apps/api/src/db/migrations/066_subjects_clinical_extended.sql` (NEW, ~20 linhas)
- `apps/api/src/db/migrations/067_owners_observations.sql` (NEW, ~3 linhas)
- `apps/api/src/db/migrations/068_appointments_appointment_type.sql` (NEW, ~30 linhas)
- `apps/api/src/routes/encounters.js` (NEW, ~330 linhas)
- `apps/api/src/routes/patients.js` — adiciona `/timeline` + extends `PUT /:id` + extends `PUT /owners/:id`
- `apps/api/src/routes/agenda.js` — `/professionals` + `?professional_id=` + `appointment_type` em POST/PATCH/validator
- `apps/api/src/server.js` — registra `/encounters`
- `apps/api/package.json` — `test:unit` adiciona path do novo teste
- `apps/api/tests/routes/encounters-validation.test.js` (NEW, ~150 linhas)

**Frontend (8 arquivos):**
- `apps/web/src/app/features/encounters/encounters.service.ts` (NEW)
- `apps/web/src/app/features/encounters/encounter-form.component.ts` (NEW)
- `apps/web/src/app/features/encounters/encounter-list.component.ts` (NEW)
- `apps/web/src/app/features/encounters/timeline.component.ts` (NEW)
- `apps/web/src/app/features/encounters/vet/vet-vital-signs.component.ts` (NEW)
- `apps/web/src/app/features/encounters/human/human-vital-signs.component.ts` (NEW)
- `apps/web/src/app/features/doctor/patients/patient-detail.component.ts` — imports + nova tab "Prontuário" + `moduleHint()` + `onEncounterSaved()`
- `apps/web/src/app/features/agenda/agenda.service.ts` — `listAppointments` aceita `professionalId`; novo `listProfessionals()`
- `apps/web/src/app/features/agenda/agenda-page.component.ts` — selector multi-prof + `loadProfessionals()`

## Smoke local validado

- ✅ `POST /encounters` cria encounter humano com vital signs (peso, temp, FC, PA, dor)
- ✅ Cross-module rejection: `vital_signs.hydration` em tenant `human` → 400 com mensagem clara
- ✅ `GET /patients/:id/timeline` retorna eventos misturados em ordem desc (encounter + ai_analysis dos exames existentes)
- ✅ `GET /agenda/professionals` lista todos users do tenant
- ✅ `GET /agenda/appointments?professional_id=all` aceita query param (admin)
- ✅ 424 unit tests verdes
- ✅ `ng build --configuration=development` OK (warnings preexistentes apenas, nenhum erro novo)
- ✅ 31 web tests verdes / 3 skipped (preexistente)

## Estado em prod (deploy 2026-05-05)

- Pipeline run `25358666565` ✅ success (Unit tests gate + deploy + migrations)
- Migrations 065-068 aplicadas em prod (confirmado via log da task ECS migrate `cf4b57354a6f4e5fb52636beec2028f6`)
- ECS api + web `rolloutState=COMPLETED`, 1/1 running
- API prod respondendo em `https://app.genomaflow.com.br/api/auth/login`
- Branch `feat/phase-1-prontuario-agenda` deletada (local + remote) após merge
- HEAD em main: `e030cf2e` (merge commit) com `f40fef4b` como commit do Phase 1

## Próximos passos (Fase 2-4)

- **Fase 2:** vacinas (vet) + clinical_documents (atestado, pedido_exame, encaminhamento, relatório) + NPS surveys
- **Fase 3:** WhatsApp via Z-API (lembretes + confirmação + mensagens) + portal do tutor/paciente (read-only)
- **Fase 4 (condicional):** PDV+estoque+financeiro via Bling/Conta Azul OU integração Focus NFE pra NF-e/NFC-e/NFS-e (decidido com base em feedback dos clientes Fase 1-3)

Tudo deferido com justificativa explícita na spec — incluindo internação (OUT permanente), TISS (OUT da Fase 1-3), banho/tosa dedicado (Fase 4+ se vet pedir), telemedicina/teleconsulta integrada (Fase 4+).
