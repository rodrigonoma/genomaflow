# Aesthetic F5 — Sensitive Regions Implementation Plan (RETROACTIVE)

> **Nota:** Plan registrado retroativamente em 2026-05-12. F5 foi planejado e executado inline durante 2026-05-11 sem plan file dedicado. Este documento registra as 5 tasks que foram executadas.

**Goal:** Hardening LGPD/CFM para fotos sensíveis (mama, glúteo, abdômen). Auto-blur pixelizado via IA + consent reforçado obrigatório + purge automático após 1 ano.

**Architecture:** Auto-crop usa Sonnet Vision pra detectar bbox + sharp pra blur. Gate `CONSENT_REINFORCED_MISSING` em rotas. Worker job diário 04h BRT purge fotos sensíveis >1y. Frontend consent-modal estendido + state machine detecta sensitive sem reinforced cover.

**Tech Stack:** sharp (já instalado em apps/api), Anthropic SDK, BullMQ.

**Spec de referência:** `docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md` §2.3, §4.1, §6.7 F5.

---

## Tasks executadas (5)

### Task 1: Backend auto-crop service
- Files: `apps/api/src/services/aesthetic-auto-crop.js`, modify `aesthetic-photos.js`
- `detectSensitiveRegions` via Sonnet Vision (model env-configurable, timeout 30s) — retorna bboxes mamilo/genital/areolar
- `applyBlur` via sharp.composite() com overlays per-region (pixelate default, 16-block downscale ou gaussian sigma 30)
- `autoCropSensitive` orquestrador — falha não-fatal (warn + upload continua com original)
- Defesa anti-LLM: parseJSON regex + sanitizeRegions clamp 0-1 + max 5 regions + whitelist types
- Route POST /aesthetic/photos aceita `is_sensitive` + `auto_crop` fields
- 27 testes service + 5 testes route

### Task 2: Reinforced consent gate
- Files: `apps/api/src/routes/aesthetic-analyses.js`, `apps/api/src/routes/aesthetic-photos.js`
- Pre-flight 2b em POST /analyses: se analysis_type ∈ SENSITIVE_REGIONS, exigir `consent.reinforced_regions` cobrir a região. Erro 403 `CONSENT_REINFORCED_MISSING` com analysis_type + missing_region.
- POST /photos com is_sensitive=true: exigir ao menos UM reinforced region registrado. Falha fast (antes de auto-crop e antes de S3).
- 5 testes (3 analyses + 2 photos)

### Task 3: Worker purge sensitive job
- Files: `apps/worker/src/jobs/aesthetic-purge-sensitive.js`, modify `apps/worker/src/notifications/scheduler.js`
- Daily UTC hour 7 (04h BRT BRT fixo UTC-3 sem DST desde 2019) integrado ao tick
- Query: `is_sensitive=true AND deleted_at IS NULL AND created_at < NOW()-365d` BATCH 100
- Soft delete primeiro (LGPD safe) + S3 deleteFile best-effort (falha → warn, soft delete persiste)
- Idempotência via `alreadyRanToday` (query soft-delete same UTC day)
- `forceRun` flag pra ops/test
- 19 testes

### Task 4: Frontend consent-reinforced + state machine
- Files: `apps/web/.../consent-modal.component.ts`, `apps/web/.../facial-analysis-tab.component.ts`
- consent-modal estendida: quando `data.reinforced_regions.length > 0`, mostra disclaimer LGPD/retenção 1y em laranja + lista regions + `mat-checkbox` reinforcedAck **obrigatório** pra confirmar
- State machine detecta `pickedRegionIsSensitive()` + `hasReinforcedFor(consent, region)`. Se sensitive sem reinforced cover → modal abre em modo reforçado automaticamente
- 11 testes (9 modal + 2 state machine)

### Task 5: Memória + landing
- File: `docs/claude-memory/project_aesthetic_f5_sensitive.md`
- MEMORY.md indexed
- Landing card LGPD-1 upgrade pra "Consentimento + Privacidade" destacando reinforced + auto-blur + retenção 1y

---

## Resultado

- ~65 testes novos (35 API + 19 worker + 11 web)
- 0 regressões
- Multi-módulo zero break
- Decisão chave: auto-crop NÃO substitui consent — gate dispara ANTES da chamada Vision
- Falha de detection é não-fatal (upload continua com original + warn)
- Soft delete sempre completa primeiro; S3 delete é best-effort

Detalhes completos: `docs/claude-memory/project_aesthetic_f5_sensitive.md`.
