# Aesthetic F6 — Polish + Integrations Implementation Plan (RETROACTIVE)

> **Nota:** Plan registrado retroativamente em 2026-05-12. F6 foi planejado e executado inline durante 2026-05-11 sem plan file dedicado. Este documento registra as 8 tasks que foram executadas — fase final que costura aesthetic dentro do ecossistema existente.

**Goal:** Costurar análises estéticas no resto do produto: timeline UNION com aesthetic_analyses, agenda quick-create wire, PDF export do protocolo, encounter↔análise vinculação. Plataforma aesthetic completa F1-F6.

**Architecture:** 1 migration aditiva (`clinical_encounters.related_aesthetic_analysis_id`) + endpoint timeline estendido com 8ª UNION ALL + endpoint PDF export via pdf-lib + endpoints encounter validation + frontend timeline rendering + analysis-result wire agenda+PDF + encounter-form vínculo.

**Tech Stack:** pdf-lib (já instalado em apps/api), Angular 18.

**Spec de referência:** `docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md` §4.6, §9 F6.

---

## Tasks executadas (8)

### Task 1: Migration 096 encounter↔analysis link
- File: `apps/api/src/db/migrations/096_clinical_encounters_aesthetic_link.sql`
- `ALTER TABLE clinical_encounters ADD COLUMN related_aesthetic_analysis_id UUID NULL REFERENCES aesthetic_analyses(id) ON DELETE SET NULL`
- Index parcial só pra rows com link

### Task 2: Backend timeline UNION aesthetic_analyses
- File: modify `apps/api/src/routes/patients.js` (linha ~560)
- 8ª branch UNION ALL: aesthetic_analyses status='done' AND deleted_at IS NULL
- Payload jsonb com id, analysis_type, status, completed_at, photo_count, top_metrics (top 3 score)
- **Achado importante:** status real é `'done'` (não 'completed') — CHECK constraint migration 089
- 6 testes

### Task 3: Backend encounter validation related_id
- File: modify `apps/api/src/routes/encounters.js`
- POST/PATCH validam `related_aesthetic_analysis_id`: deve existir + mesmo tenant + mesmo subject + deleted_at NULL
- Erro 400 `INVALID_AESTHETIC_LINK`
- 4 testes

### Task 4: Backend PDF protocol export
- File: `apps/api/src/services/aesthetic-pdf-export.js` + `aesthetic-analyses.js`
- `buildAnalysisPDF` via pdf-lib. A4 portrait, multi-página via `ensure()`
- Sections: header, paciente, análise, top 12 métricas, treatment_protocol, lifestyle, disclaimer regulatório, footer
- GET `/aesthetic/analyses/:id/export.pdf` sob `requireEsteticaModule`, rate limit 30/h
- **Limitação inicial:** pdf-lib Helvetica era WinAnsi (ASCII fallback). Resolvido em TODO#1 polish (Roboto via fontkit)
- 9 testes (6 service + 3 route)

### Task 5: Frontend timeline rendering aesthetic
- Files: `apps/web/.../patient-timeline.component.ts`, `apps/web/.../timeline-panel.component.ts`
- EVENT_META entry `aesthetic_analysis_completed` (icon face_retouching_natural, color #ec4899 pink, label "Análise estética")
- @case renderiza analysis_type + photo_count + top_metrics + botão "Ver análise completa"
- 10 testes (5 list + 5 panel)

### Task 6: Frontend treatment cards → agenda quick-create + PDF download
- Files: `apps/web/.../analysis-result.component.ts`, modify `agenda/quick-create-dialog.component.ts`
- `onScheduleTreatment` abre `QuickCreateDialogComponent` pré-preenchida com `procedimento_estetico` + notes referenciando `treatment_name`, `treatment_id`, `analysis.id`
- Novo botão "Baixar PDF" via HttpClient blob + anchor programático (depois evoluído pra modal preview em TODO#6 polish)
- quick-create-dialog extended com `preset_appointment_type`, `preset_subject_id`, `preset_notes` (additive backward-compat)
- 2 testes analysis-result

### Task 7: Frontend encounter-form vínculo análise
- File: `apps/web/.../encounter-form.component.ts`
- @Input module estendido para incluir `'estetica'` (additivo)
- Dropdown "Análise estética vinculada" renderizado APENAS quando module=='estetica'
- Fetcha GET /aesthetic/analyses?subject_id quando subject_id presente
- Submit payload inclui `related_aesthetic_analysis_id`
- 5 testes (depois evoluído com auto-suggest em TODO#7 polish)

### Task 8: Final docs + landing
- File: `docs/claude-memory/project_aesthetic_f6_integrations.md`
- MEMORY.md indexed como fase final F1-F6 completa
- Landing card substitui CRED-1 (interno) por PROTOCOLO-1 (Protocolo PDF + Agenda)

---

## Resultado

- ~36 testes novos (19 API + 17 web)
- 0 regressões
- Multi-módulo zero break
- **Plataforma aesthetic F1-F6 production-ready**
- TODOs documentados resolvidos depois em polish batch (13 itens)

Detalhes completos: `docs/claude-memory/project_aesthetic_f6_integrations.md` e `project_aesthetic_polish_todos.md`.
