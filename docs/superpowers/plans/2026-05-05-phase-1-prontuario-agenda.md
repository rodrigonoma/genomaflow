# Fase 1 — Prontuário + Agenda Multi-Profissional — Plano de Implementação

**Data:** 2026-05-05
**Branch:** `feat/phase-1-prontuario-agenda`
**Spec base:** `docs/superpowers/specs/2026-05-05-clinical-pms-expansion-design.md`
**Status:** EM EXECUÇÃO

## Decisões (sem espera de aprovação — autorizado pelo usuário)

| # | Decisão |
|---|---|
| 1 | Edição de encontro: 24h pra autor; depois adendo; após `signed_at`, imutável |
| 2 | Profissional vê encontros de outros profissionais do mesmo tenant (colaborativo) |
| 3 | Backfill `professional_user_id` = `user_id` |
| 4 | Aba "Prontuário" nova, antes de "Análises IA" |
| 5 | Vacinas só vet na Fase 2 |
| 6 | Cross-module field = 400 (rejeitar) |

## Lista de tarefas

### Backend
- [ ] Migration `065_clinical_encounters.sql` — `clinical_encounters` + `vital_signs` + RLS + audit trigger
- [ ] Migration `066_subjects_clinical_extended.sql` — campos vet + human em subjects
- [ ] Migration `067_owners_observations.sql` — observações em owners
- [ ] Migration `068_appointments_multi_professional.sql` — `professional_user_id` (3 passos)
- [ ] Aplicar migrations no Docker DB local
- [ ] `apps/api/src/routes/encounters.js` — CRUD + timeline
- [ ] `apps/api/src/routes/agenda.js` — extender com `professional_id` + `GET /professionals`
- [ ] `apps/api/src/routes/patients.js` — extender PUT/POST com novos campos
- [ ] Registrar `/encounters` em `server.js`
- [ ] Tests `apps/api/tests/routes/encounters-validation.test.js`
- [ ] Tests `apps/api/tests/security/encounters-acl.test.js`
- [ ] Atualizar `package.json#test:unit` com novos paths

### Frontend
- [ ] `apps/web/src/app/features/encounters/` — pasta nova
- [ ] `EncounterFormComponent` — shell shared
- [ ] `VetVitalSignsComponent` + `HumanVitalSignsComponent`
- [ ] `HumanHistoryFieldsComponent`
- [ ] `EncounterListComponent`
- [ ] `TimelineComponent`
- [ ] `EncountersService` (HTTP + cursor)
- [ ] Integração na `patient-detail.component.ts` (nova aba "Prontuário")
- [ ] `AgendaProfessionalSelectComponent`
- [ ] Atualizar `agenda-page.component.ts` pra usar selector
- [ ] Rota lazy `/encounters` (se necessário — provável que não pra Fase 1, fica como sub-componente)

### Testes & Smoke
- [ ] `npm run test:unit` em `apps/api` verde
- [ ] `npm test` em `apps/web` verde
- [ ] Smoke local human: criar encontro, ver timeline
- [ ] Smoke local vet: criar encontro com sinais vitais, ver timeline
- [ ] Smoke local agenda: filtro por profissional
- [ ] Validar zero regressão nas telas atuais

### Memória & Deploy
- [ ] Atualizar `docs/claude-memory/project_context.md`
- [ ] Atualizar `MEMORY.md` index com nova memória do Fase 1
- [ ] Commit final, push, merge to main
- [ ] CI/CD aplica migrations em prod automaticamente

## Estimativa de arquivos

- **Migrations SQL:** 4 arquivos, ~250 linhas total
- **Backend routes/services:** 3 arquivos modificados/criados, ~700 linhas
- **Backend tests:** 2 arquivos novos, ~400 linhas
- **Frontend components:** 7 arquivos novos, ~1000 linhas
- **Frontend service:** 1 arquivo novo, ~100 linhas
- **Frontend integração:** 2 arquivos modificados (~150 linhas alteradas)
- **Docs/memória:** 3 arquivos
- **TOTAL:** ~2600 linhas adicionadas / ~150 modificadas

## Riscos identificados durante execução

(Preencher conforme surgirem)
