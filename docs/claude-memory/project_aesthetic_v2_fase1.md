---
name: Aesthetic V2 Fase 1 — Captura Guiada + Landmarks + Métricas Geométricas
description: Plataforma aesthetic V2 Fase 1 entregue 2026-05-13. Dois tiers (standard 5cr / advanced 10cr "Análise Avançada — Captura Guiada"). MediaPipe Web 5 poses faciais ou 4 corporais, landmarks no cliente, worker calcula 10 métricas geométricas. Spec genomaflow_estetica_v_2_spec_md.md fase 1.
type: project
---

# Aesthetic V2 Fase 1 — entregue 2026-05-13

Plataforma aesthetic ganhou tier `advanced` opcional. Tier `standard` (F1-F6) preservado 100% intacto — backward compat absoluta. Spec original: `genomaflow_estetica_v_2_spec_md.md`. Spec da Fase 1: `docs/superpowers/specs/2026-05-12-aesthetic-v2-fase1-design.md`. Plano: `docs/superpowers/plans/2026-05-12-aesthetic-v2-fase1.md`.

## Decisões arquiteturais travadas (D1–D12)

| # | Decisão |
|---|---|
| D1 | Escopo Fase 1 = captura guiada + landmarks + métricas geométricas (Pseudo-3D adiado pra Fase 3) |
| D2 | MediaPipe Web browser/WASM — sem container Python |
| D3 | Anthropic Vision permanece complementar (não substituído) |
| D4 | Evoluir schema F1-F6 (aditivo), não criar paralelo |
| D5 | Validação client-first com 7 heurísticas |
| D6 | Cliente envia foto + landmarks JSON; worker valida shape |
| D7 | 1 sessão = 1 análise multi-pose (5 facial ou 4 corporal) |
| D8 | Métricas geométricas no MESMO JSONB com flag `source: 'mediapipe'` |
| D9 | Mobile (Capacitor) consome mesma lib MediaPipe Web |
| D10 | Dois tiers: `standard` (5cr) e `advanced` (10cr) |
| D11 | Naming UI "Análise Avançada — Captura Guiada" + badge "PRECISÃO" |
| D12 | Endpoint /compare exige mesmo tier (TIER_MISMATCH cross-tier) |

## Migrations entregues

| # | Conteúdo |
|---|---|
| 099 | `aesthetic_sessions` (id, tenant_id, subject_id, user_id, session_date, session_type, notes, deleted_at) + RLS NULLIF pattern + audit trigger genérico |
| 100 | ALTER `aesthetic_photos` ADD `pose VARCHAR(40)`, `landmarks JSONB`, `session_id UUID FK` — todas NULLable, índices parciais |
| 101 | ALTER `aesthetic_analyses` ADD `session_id UUID FK`, `tier VARCHAR(20) NOT NULL DEFAULT 'standard'` + CHECK (tier IN ('standard','advanced')) |
| 102 | DROP+RECREATE `credit_ledger_kind_check` adicionando 9 kinds `aesthetic_*_analysis_advanced` |

## Backend (apps/api)

| Arquivo | Função |
|---|---|
| `services/aesthetic-sessions.js` | CRUD sessions com withTenant + audit context (userId, channel='ui'), whitelist session_type |
| `services/aesthetic-landmarks-validate.js` | Validação shape: provider whitelist (mediapipe), type face\|body, points count (468\|33), range [-1, 2], type↔pose coerência |
| `services/aesthetic-analyses.js` | createPending estendido com sessionId+tier; novo helper `validatePhotosForAdvanced` verifica pose+landmarks+session match |
| `services/aesthetic-photos.js` | createPhoto aceita pose, landmarks (JSON), sessionId opcionais |
| `services/aesthetic-pdf-export.js` | PDF split sections "Análise Visual (IA)" vs "Métricas Geométricas (Análise Avançada)" |
| `routes/aesthetic-sessions.js` | POST/GET/GET-by-id /aesthetic/sessions com requireEsteticaModule |
| `routes/aesthetic-photos.js` | POST /photos valida pose/landmarks/session_id se presentes; 400 codes: INVALID_POSE, INVALID_LANDMARKS+code, INVALID_LANDMARKS_JSON, INVALID_SESSION, SESSION_SUBJECT_MISMATCH |
| `routes/aesthetic-analyses.js` | POST aceita tier+session_id; COST_TABLE tier-aware; kind tier-aware; tier=advanced exige exatos 5 fotos facial \| 4 body; validatePhotosForAdvanced; compare tier-gate (TIER_MISMATCH 400) |

## Worker (apps/worker)

| Arquivo | Função |
|---|---|
| `agents/aesthetic-landmarks-metrics.js` | 6 métricas faciais (symmetry_horizontal, proportion_thirds, mandibular_angle_left/right, head_tilt_roll, interocular_distance) + 4 corporais (posture_shoulder_asymmetry, posture_hip_asymmetry, waist_hip_ratio_visual, posture_alignment_lateral). Falha graciosa: erro retorna {} mas não bloqueia análise |
| `processors/aesthetic-analysis.js` | Stage `call_1b_landmarks_metrics` roda APENAS se job.data.tier='advanced'; mergedMetrics = vision ∪ landmarks persiste no JSONB; recommender continua recebendo só Vision metrics |

## Frontend (apps/web)

| Componente | Função |
|---|---|
| `tier-selector.component.ts` | 2 cards (5cr/10cr badge ✨PRECISÃO); role=radiogroup; Enter/Space + click → tierSelected emit |
| `capture-guide-facial.component.ts` | Wizard 5 poses (frontal → profile_left/right → 45_left/right); webcam + canvas hidden pra detect; raF loop; overlay moldura target + checklist live |
| `capture-guide-body.component.ts` | Análogo facial mas Pose 33 pts, 4 poses (body_front/back/lateral_left/right), aspect 9:16, câmera traseira preferida |
| `analysis-result.component.ts` | Badge "✨ Análise Avançada" no header se isAdvanced; split sections "Análise Visual (IA)" 🧪 vs "Geometria" 🎯 (gradient amber-pink); barras separadas |
| `comparison-view.component.ts` | filteredBaselines computed filtra availableBaselines por mesmo tier; dropdown mostra "✨ Avançada" + nota explicativa |
| `facial-analysis-tab.component.ts` | State machine ganha steps `tier_choice` (entre idle e region_pick) e `capture` (advanced wizard); rotea facial vs corporal por `_isFacialRegion()` |

| Service | Função |
|---|---|
| `mediapipe-loader.service.ts` | Lazy singleton (`import('@mediapipe/tasks-vision')`); single-flight; WASM/modelos via CDN jsdelivr+Google Storage; getFaceLandmarker / getPoseLandmarker; version='0.10.16' exposto |
| `capture-validator.service.ts` | 6 heurísticas client-side validateFace (POSE/EYES/MOUTH/CENTERED/FOCUS/EXPOSURE) + 6 validateBody (FULL_BODY/POSTURE/FEET/POSE_DIR/FOCUS/EXPOSURE); helpers expostos pra teste |
| `aesthetic-facial.service.ts` | createSession + uploadPhotoV2 helpers |

## Pipeline end-to-end

```
[Esteticista] Aba "Análise Estética IA" → "Nova análise"
    ↓ TierSelector (2 cards, 5cr standard | 10cr advanced)
    ↓ tier_choice → region_pick → consent_check
    ↓ Standard: → guide → upload (fluxo F1-F6 idêntico)
    ↓ Advanced:
      ↓ POST /aesthetic/sessions cria wrapper
      ↓ CaptureGuide (Facial OU Body conforme região)
      ↓ MediaPipe lazy load (~10s primeira vez via CDN)
      ↓ Loop raF: detect + 6 heurísticas live → checklist verde/vermelho
      ↓ Capturar (botão libera com 6/6 OK) → snapshot JPEG + POST /aesthetic/photos
      ↓        com pose + landmarks JSON (468 face | 33 body pts, range -1..2)
      ↓ Repetir 5 (facial) ou 4 (corporal) vezes
      ↓ POST /aesthetic/analyses { tier:'advanced', session_id, photo_ids }
      ↓        validate: photos têm pose+landmarks+session match, 5|4 exato
      ↓ Cobra 10cr kind=aesthetic_*_analysis_advanced
[Worker]
    ↓ fetch_photos inclui pose+landmarks JSONB
    ↓ call_1_vision (Sonnet — métricas qualitativas)
    ↓ call_1b_landmarks_metrics (V2 — APENAS se tier=advanced)
    ↓ mergedMetrics = vision ∪ geometria (cada com source flag)
    ↓ call_2_recommender (só vision metrics)
    ↓ persist_done + Redis pub/sub
[Frontend resultado]
    ↓ Badge "✨ Análise Avançada"
    ↓ Section "Análise Visual (IA)" + Section "Geometria" lado a lado
    ↓ PDF export inclui ambas as seções
    ↓ Compare filtra dropdown por tier (impede TIER_MISMATCH)
```

## Custos & pricing (env vars)

| Env | Default | Aplicado |
|---|---|---|
| `AESTHETIC_FACIAL_COST` | 5 | tier=standard facial |
| `AESTHETIC_FACIAL_COST_ADVANCED` | 10 | tier=advanced facial |
| `AESTHETIC_BODY_COST` | 5 | tier=standard corporal |
| `AESTHETIC_BODY_COST_ADVANCED` | 10 | tier=advanced corporal |

Estratégia: subir Premium pra 15-20cr depois quando adoção estabilizar. Reservar "Premium" pro tier Pseudo-3D (Fase 3).

## Refund policy

| Cenário | Standard | Advanced |
|---|---|---|
| Vision falha (NO_FACE, BLURRY, BAD_LLM) | Refund total | Refund total |
| Landmarks-metrics falha | N/A | **Sem refund** — Vision já entregue (basic produto) |
| Recommender falha | Sem refund | Sem refund |
| Foto inválida pre-flight | Não cobra | Não cobra |

## Tests adicionados (≈80 novos)

- API: aesthetic-sessions (14), aesthetic-landmarks-validate (26), aesthetic-photos V2 extends (8), aesthetic-analyses tier V2 (10), compare tier-gate (3), migrations integration (8) = ~69
- Worker: aesthetic-landmarks-metrics (23) com fixtures sintéticos
- Web: tier-selector (6), mediapipe-loader (6), capture-validator (16), facial-analysis-tab tier flow (3 novos) = ~31

## Multi-módulo + paridade

- Todas rotas novas sob `requireEsteticaModule` (human/vet 403)
- Migrações NULLable preservam analyses F1-F6 sem rewrite (CHECK 'standard' default)
- Mobile sync feito (Android `npx cap sync android` rodado em V2-C e V2-D)
- iOS via CI ao criar tag `v*.*.*` (não rodado, esperar quando priorizar)

## Pontos de atenção pra teste em produção

- HTTPS é mandatório pra `getUserMedia` (já temos cert em app.genomaflow.com.br)
- MediaPipe WASM ~10MB vem do CDN jsdelivr — primeira captura precisa internet
- Browser pede permissão de câmera na primeira vez
- Capacitor Android low-end pode travar com MediaPipe → fallback "Pular validação" disponível
- Worker fixos com pose `body_back` usam ausência de visibilidade do nariz como proxy (heurística aproximada)
- ALB já tem regra `/api/*` então rotas novas /aesthetic/sessions caem na infra existente

## Próximas fases (do spec V2 original)

- **Fase 2:** métricas faciais/corporais refinadas, heatmaps avançados, scores estéticos, comparação evolutiva visual mais elaborada
- **Fase 3:** Pseudo-3D facial via depth estimation (Depth Anything / MiDaS / ZoeDepth) + Three.js viewer — o "WOW visual" que motiva o produto
- **Fase 4:** relatório paciente HTML/PDF novo, timeline evolutiva com gráficos, IA recomendação estética avançada

Cada uma é spec/plan separado quando priorizar.

## Não regredir

❌ Não trocar tier=standard default em aesthetic_analyses (quebra F1-F6 backward compat)
❌ Não confiar em landmarks do cliente sem validar shape (count, range, type↔pose)
❌ Não comparar análises cross-tier (delta semanticamente quebrado)
❌ Não rodar landmarks-metrics em tier=standard (sem landmarks salvos)
❌ Não bloquear análise se landmarks-metrics falha (Vision basic é o produto)

✅ Sempre `source: 'mediapipe'` em métricas geométricas pra frontend distinguir
✅ Sempre 5 fotos facial / 4 corporal exato em advanced (validação backend)
✅ Sempre POST /aesthetic/sessions antes do upload no fluxo advanced
✅ Sempre `provider_version` em landmarks JSON pra reproduzir
