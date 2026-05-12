---
name: F6 Aesthetic Polish + Integrations (final phase)
description: F6 entregue 2026-05-11 — encounter↔analysis link, timeline UNION aesthetic_analyses, PDF protocol export via pdf-lib, frontend timeline render + agenda quick-create wire + PDF download button + encounter-form vínculo análise. Plataforma aesthetic completa F1-F6.
type: project
---

# F6 — Polish + Integrações (entregue 2026-05-11)

Fase final da plataforma aesthetic. Não traz feature nova de IA — costura tudo dentro do ecossistema existente (timeline, agenda, prontuário) + export PDF do protocolo.

## Migration entregue

| Migration | Conteúdo |
|---|---|
| `096_clinical_encounters_aesthetic_link.sql` | ALTER `clinical_encounters` ADD `related_aesthetic_analysis_id UUID NULL REFERENCES aesthetic_analyses(id) ON DELETE SET NULL`. Index parcial. Aditivo, multi-módulo safe. |

## Backend entregue

| Componente | Path | Função |
|---|---|---|
| Timeline UNION | `apps/api/src/routes/patients.js` (linha ~560) | 8ª branch UNION ALL: aesthetic_analyses status='done' AND deleted_at IS NULL. Payload jsonb com id, analysis_type, status, completed_at, photo_count, top_metrics (top 3 score). **Nota: status real é 'done' (não 'completed') — CHECK constraint em migration 089.** |
| Encounter validation | `apps/api/src/routes/encounters.js` | POST/PATCH validam `related_aesthetic_analysis_id`: deve existir + mesmo tenant + mesmo subject + deleted_at NULL. Senão 400 `INVALID_AESTHETIC_LINK`. |
| PDF service | `apps/api/src/services/aesthetic-pdf-export.js` | `buildAnalysisPDF` via pdf-lib. A4 portrait, multi-página via `ensure()`. Sections: header, paciente, análise, top 12 métricas, treatment_protocol, lifestyle, disclaimer regulatório, footer. Graceful c/ campos ausentes. |
| PDF route | `apps/api/src/routes/aesthetic-analyses.js` | GET `/aesthetic/analyses/:id/export.pdf` sob `requireEsteticaModule`. Retorna application/pdf attachment. Rate limit 30/h. Try/catch → 500 `BAD_PDF_GENERATION`. |

## Frontend entregue

| Componente | Path | Função |
|---|---|---|
| Timeline list | `apps/web/src/app/features/doctor/patients/patient-timeline.component.ts` | EVENT_META entry `aesthetic_analysis_completed` (icon face_retouching_natural, color #ec4899 pink, label "Análise estética"). Summary string com tipo + photo count. |
| Timeline panel | `apps/web/src/app/features/doctor/patients/timeline-panel.component.ts` | @case `aesthetic_analysis_completed` renderiza analysis_type + photo_count + top_metrics em lista + botão "Ver análise completa" (stub — TODO deep-link). |
| Agenda quick-create | `apps/web/src/app/features/agenda/quick-create-dialog.component.ts` | Aceita `preset_appointment_type`, `preset_subject_id`, `preset_notes` (additive backward-compat). Constructor pré-popula. |
| analysis-result | `apps/web/src/app/features/aesthetic/components/analysis-result.component.ts` | `onScheduleTreatment` abre `QuickCreateDialogComponent` pré-preenchida com `procedimento_estetico` + notes referenciando `treatment_name`, `treatment_id`, `analysis.id`. Novo botão "Baixar PDF" via HttpClient blob + anchor programático. |
| encounter-form | `apps/web/src/app/features/encounters/encounter-form.component.ts` | @Input module estendido para incluir 'estetica'. Dropdown "Análise estética vinculada" renderizado APENAS module=='estetica'. Fetcha GET /aesthetic/analyses?subject_id. Submit payload inclui `related_aesthetic_analysis_id`. |

## Limitação conhecida — PDF UTF-8

`pdf-lib` Helvetica é WinAnsi (latin-1), não UTF-8. Caracteres acentuados são substituídos por equivalentes ASCII no PDF gerado:
- "Análise" → "Analise"
- "Métricas" → "Metricas"
- "Médico" → "Medico"

**Por que aceitamos:** funciona, é legível, evita complexidade de empacotar font UTF-8 (Roboto/NotoSans precisariam fontkit + arquivo .ttf no repo).

**Plano para resolver:** F6.5+ (futuro) — embed Roboto-Regular.ttf via fontkit; adiciona ~150KB ao bundle do api Docker mas resolve definitivamente. Tracking: TODO ao final desta memória.

## Pipeline atualizado F1→F6 (completo)

```
[Esteticista] /aesthetic/analyses POST { analysis_type, subject_id, photo_ids[] }
       ↓ Pre-flight (consent + créditos + photos + REINFORCED CONSENT se sensitive)  ← F5.2
       ↓ Photo upload com auto-crop Sonnet Vision + sharp pixelate se is_sensitive    ← F5.1
       ↓ Enqueue BullMQ
[Worker]
       ↓ analyzeFacial/analyzeBody (Sonnet Vision)                                    ← F1/F2
       ↓ fetch_catalog (top 50 por usage_count_30d)                                   ← F3.5
       ↓ fetch_profile aesthetic_profile + computeAll(profile)                        ← F4.4
       ↓ recommendProtocol({ metrics, subject, catalog, profile, computedNutrition }) ← F1/F3/F4
       ↓ Sanitize + CRN disclaimer fail-safe
       ↓ Persist analysis_result com treatment_protocol + lifestyle
[Frontend]
       ↓ analysis-result → <app-treatment-protocol-cards>                             ← F3.8
       ↓ Botão "Agendar agora" → quick-create-dialog (procedimento_estetico)          ← F6.6
       ↓ Botão "Baixar PDF" → GET .../export.pdf blob download                        ← F6.6
       ↓ Timeline patient detail mostra evento aesthetic_analysis_completed            ← F6.5
       ↓ Encounter form pode vincular related_aesthetic_analysis_id                   ← F6.7
[Worker tick mensal 1º UTC]
       ↓ aesthetic-treatment-discovery: Opus lista novos tratamentos                  ← F3.6
[Master UI]
       ↓ /master/aesthetic-catalog + /master/aesthetic-suggestions                    ← F3.9, F3.10
[Worker tick diário 07h UTC]
       ↓ aesthetic-purge-sensitive: is_sensitive >1y → soft delete + S3 delete       ← F5.3
```

## Tests F6

- API: +6 (timeline) +6 (pdf service) +3 (analyses pdf route) +4 (encounters validation) = 19 novos. Total ~789 verdes.
- Web: +5 (patient-timeline) +5 (timeline-panel) +2 (analysis-result) +5 (encounter-form) = 17 novos. Total ~160 verdes.

**~36 testes novos, 0 regressões.**

## Multi-módulo zero quebra

- Migration 096 NULLable, default behavior preservado para human/vet.
- Timeline endpoint multi-módulo — para human/vet o JOIN naturalmente retorna 0 rows aesthetic.
- Encounters route aceita o novo campo opcionalmente — payloads sem ele = legacy.
- encounter-form gated: dropdown SÓ aparece module='estetica'. Tipo do @Input estendido aditivamente.
- PDF export é único endpoint gated por requireEsteticaModule — humano/vet não acessa.
- analysis-result inalterado em estrutura — só adiciona botões.

## Marcos finais — Plataforma Aesthetic completa

| Fase | Entregue | Componentes principais |
|---|---|---|
| F1 | 2026-05-11 | Análise facial IA (11 métricas), consent, photos, SVG overlay |
| F2 | 2026-05-11 | Análise corporal IA (6 regiões, 29 métricas adicionais), comparação antes/depois |
| F3 | 2026-05-11 | Catálogo curado + master CRUD + job mensal Opus de descoberta |
| F4 | 2026-05-11 | Nutrição: aesthetic_profile JSONB + TMB Mifflin-St Jeor + lifestyle disclaimer CRN |
| F5 | 2026-05-11 | Auto-crop sensitive + reinforced consent gate + purge job diário |
| F6 | 2026-05-11 | Timeline UNION + agenda wire + PDF export + encounter link |

**Total: ~290 testes adicionados, 0 regressões em 30+ commits ff-only.**

## TODOs / Futuro

- **PDF UTF-8 font**: embed Roboto-Regular.ttf via fontkit (F6.5 polish).
- **Timeline deep-link**: `openAesthetic(id)` em timeline-panel é stub (console.log). Router navigate + lazy load do componente analysis-result quando deep-link existir.
- **PDF preview no frontend**: hoje download direto. Poderia abrir em modal iframe.
- **Encounter sugestão automática**: ao criar encounter sem related_id mas com aesthetic_analyses recente, sugerir vínculo (UX).
- **Treatment "Agendar X sessões"**: hoje agenda 1 procedimento — poderia gerar series de N appointments espaçados pelo interval_days do catálogo.

## Custos

- PDF export: zero custo IA. pdf-lib local. ~50-200ms latência por análise.
- Timeline UNION extra: marginal (1 SELECT extra por timeline call). ~5ms.
- Agenda wire: zero custo extra.
- Encounter link validate: 1 SELECT extra ao criar encounter com link. ~2ms.

**Plataforma aesthetic está completa e production-ready.**
