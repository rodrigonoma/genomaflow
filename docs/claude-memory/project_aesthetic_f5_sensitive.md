---
name: F5 Aesthetic Sensitive Regions (Reinforced Consent + Auto-blur + Purge)
description: F5 entregue 2026-05-11 + polish TODO#9-12 entregue 2026-05-11 — consent reforçado para regiões sensíveis, auto-crop Sonnet Vision + sharp pixelate, purge worker job diário 04h BRT (retenção configurável LGPD), actor_channel=system no audit trail, endpoint forceRun via Redis.
type: project
---

# F5 — Sensitive Regions (entregue 2026-05-11)

Hardening LGPD/CFM para fotos de regiões anatomicamente sensíveis (mama, glúteo, abdômen). Não é nova feature funcional — é refinamento regulatório obrigatório para uso real em clínicas estéticas.

## Backend entregue

| Componente | Path | Função |
|---|---|---|
| Auto-crop service | `apps/api/src/services/aesthetic-auto-crop.js` | Sonnet Vision detecta bbox de mamilo/genital/areolar → sharp pixelate (default) ou gaussian blur aplica nas coords. Falha não-fatal (warn, upload continua com original). `parseJSON` + `sanitizeRegions` (clamp 0-1, max 5 regions, whitelist types). |
| Photos service ext | `apps/api/src/services/aesthetic-photos.js` | `createPhoto` aceita `isSensitive` override; fallback pro heurístico legacy por `photoType` |
| Photos route ext | `apps/api/src/routes/aesthetic-photos.js` | Lê `is_sensitive` + `auto_crop` (multipart). Gate `CONSENT_REINFORCED_MISSING` (403) ANTES de tudo se sensitive sem consent. Auto-crop dispara antes do S3 upload. Resposta inclui `auto_crop_applied: N`. |
| Analyses route gate | `apps/api/src/routes/aesthetic-analyses.js` | Pre-flight 2b adicionado: se `analysis_type ∈ SENSITIVE_REGIONS`, exigir `consent.reinforced_regions` incluir essa região. Erro 403 `CONSENT_REINFORCED_MISSING` com `analysis_type` + `missing_reinforced_region`. |
| Master purge trigger | `apps/api/src/routes/master.js` | `POST /master/aesthetic-purge-sensitive/run-now` (master only). Publica em Redis `admin:purge-sensitive-trigger`. Fire-and-forget — resultado logado no worker. |

## Worker entregue

| Componente | Path | Função |
|---|---|---|
| Purge job | `apps/worker/src/jobs/aesthetic-purge-sensitive.js` | Diário TICK_UTC_HOUR UTC (default 7 = 04:00 BRT). Query: `is_sensitive=true AND deleted_at IS NULL AND created_at < NOW()-RETENTION_DAYS`. Soft delete dentro de transação com `SET LOCAL app.actor_channel='system'` (audit trail distingue worker de UI). S3 deleteFile best-effort fora da tx. Idempotência via `alreadyRanToday`. `forceRun` flag. Env vars: `AESTHETIC_SENSITIVE_RETENTION_DAYS` (default 365), `AESTHETIC_PURGE_BATCH` (default 100), `AESTHETIC_PURGE_HOUR_UTC` (default 7). |
| Scheduler integration | `apps/worker/src/notifications/scheduler.js` | tick() dispara `shouldPurgeRun(now)` (gate TICK_UTC_HOUR). subscribeAdminTriggers() ouve Redis canal `admin:purge-sensitive-trigger` e dispara runPurgeSensitive({forceRun:true}) — acionado pelo endpoint master. Try/catch non-fatal em ambos. |

## Frontend entregue

| Componente | Path | Função |
|---|---|---|
| Consent modal estendido | `apps/web/src/app/features/aesthetic/components/consent-modal.component.ts` | Quando `data.reinforced_regions.length > 0`: disclaimer LGPD/retenção 1y destacado em laranja + lista regions + `mat-checkbox` reinforcedAck obrigatório. `canConfirm()` exige reinforcedAck quando reinforced presente. |
| State machine | `apps/web/src/app/features/aesthetic/components/facial-analysis-tab.component.ts` | `checkConsent()` agora detecta `pickedRegionIsSensitive()` + `hasReinforcedFor(consent, region)`. Se sensitive sem reinforced cover → modal abre em modo reforçado. `_openConsentModal(reinforced_regions?)` propaga pro dialog. |

## Pipeline atualizado F5

```
[Esteticista] picks region
       ↓ region_pick → consent_check (GET /aesthetic/consent/:subject_id)
       ↓ consent existing + reinforced cobre região? → guide
       ↓ consent existing + sensitive sem reinforced? → consent_ask (modal reforçado)
       ↓ user marca reinforcedAck + signerName → POST /aesthetic/consent { reinforced_regions: [region] }
       ↓ backend UPSERT: aesthetic_consent.reinforced_regions array (UNION)
       ↓ guide → upload (POST /aesthetic/photos com is_sensitive + auto_crop)
       ↓ Backend gate: CONSENT_REINFORCED_MISSING 403 se reinforced_regions vazio
       ↓ Sonnet Vision detect → sharp pixelate (default) → S3 upload do buffer modificado
       ↓ aesthetic_photos.is_sensitive=true persisted
       ↓ POST /aesthetic/analyses gate: CONSENT_REINFORCED_MISSING 403 se region sensitive sem cover
       ↓ Enqueue normal → análise prossegue
       ↓ ...1 ano depois...
[Worker tick 07h UTC daily]
       ↓ shouldPurgeRun(now) → runPurge
       ↓ SELECT is_sensitive=true AND created_at < NOW()-365d LIMIT 100
       ↓ Soft delete + S3 deleteFile best-effort
       ↓ audit_trigger_fn captura UPDATE.deleted_at via changed_fields
```

## Decisões técnicas

- **Auto-crop é Sonnet Vision call separada** — adiciona ~$0.005/foto sensível + 3-5s latência. Justificado: LGPD biometria sensível exige cuidado. Se Vision falha, upload continua sem blur (warn log) — disponibilidade > perfeição visual; o que importa é o registro de consentimento + retenção curta.
- **Pixelate (default) vs gaussian blur** — pixelate (16-block downscale + upscale nearest) é mais agressivo visualmente. Cliente pode escolher `mode: 'blur'` se preferir.
- **Soft delete antes de S3 delete** — DB delete sempre completa (LGPD compliant). S3 delete é best-effort. Se S3 falha, row está marcada deleted_at mas objeto ainda no bucket — operacionalmente: bucket lifecycle policy ou re-run forçado limpa.
- **shouldPurgeRun guard UTC hour 7** — evita 12 queries/hora ao DB. Roda 1× por dia (com `alreadyRanToday` double-protection).
- **BATCH_LIMIT 100** — blast radius pequeno. Se houver 10k fotos sensíveis para purgar, leva ~100 dias (mas em prática, primeiro ano de uso real pode ter alguns milhares).
- **Consent UPSERT preserva regions existentes** — `aesthetic_consent` schema usa array `reinforced_regions[]`, e UPSERT faz UNION para preservar histórico. Se profissional pegou consent para `breast` antes e agora precisa para `glutes`, o segundo UPSERT mantém ambos.
- **Frontend modal único reaproveitado** — sem novo componente `consent-reinforced-modal` (spec mencionou). Decisão: simplicidade > 1 component a mais. Modal estende-se via prop `data.reinforced_regions`. Reduz duplicação e mantém UX coesa.

## Tests

- API: +27 (auto-crop) +5 (photos consent gate F5.2) +3 (analyses consent gate F5.2) +4 (preview-blur TODO#5) +4 (master purge route TODO#10) = 43 novos. Total 827 (807 pass + 20 skip) verdes.
- Worker: +19 (purge F5.3) +7 (purge polish TODO#9-12) = 26 novos. Total 167 verdes.
- Web: +9 (consent-modal reinforced) +2 (state machine F5.4) +4 (auto-crop-preview-modal TODO#5) = 15 novos. Total 182 (179 pass + 3 skip preexistentes) verdes.

**~84 testes novos total, 0 regressões.**

## Multi-módulo zero quebra

- SENSITIVE_REGIONS constant usado apenas pelo módulo estética. Outros módulos não interagem com aesthetic_photos.
- Auto-crop dispara apenas com `is_sensitive=true` flag explícita do cliente.
- Frontend state machine vive em features/aesthetic/* — human/vet não impactados.
- Purge job opera APENAS em aesthetic_photos — outras tabelas (exams, etc.) não tocadas.

## Preview auto-blur antes do upload (TODO#5 — entregue 2026-05-11)

Endpoint `POST /aesthetic/photos/preview-blur`: recebe foto + subject_id, executa `autoCropSensitive`, retorna buffer blurred como `image/jpeg` com headers `X-Auto-Crop-Applied: N` e `X-Auto-Crop-Regions: N`. **Não persiste em S3 nem DB.** Mesma gate de consent reforçado do upload real (403 `CONSENT_REINFORCED_MISSING` se ausente). Rate limit 20/h (vs 60/h do upload).

Frontend `AutoCropPreviewModalComponent`: modal standalone Angular 18 OnPush. Exibe lado a lado original vs blurred. Badge "N regiões borradas". 3 ações:
- "Aceitar e enviar com blur" → `{ confirmed: true, autoCrop: true }`
- "Enviar SEM blur (já está pronto)" → `{ confirmed: true, autoCrop: false }`
- "Cancelar" → `{ confirmed: false }`

Disclaimer: "Auto-blur é assistido por IA e pode falhar. Revise a imagem antes de enviar."

`PhotoUploaderComponent` ganhou inputs `isSensitive` e `previewBlurEnabled`. Quando ambos true, abre o modal antes do upload; passa `is_sensitive=true` + `auto_crop=false` se usuário escolheu sem blur.

## Polish TODO#9-12 (entregue 2026-05-11)

| TODO | Implementação |
|---|---|
| #9 actor_channel=system | `softDeleteAndPurge` abre transação explícita + `SET LOCAL app.tenant_id=$1` + `SET LOCAL app.actor_channel='system'` antes do UPDATE. Audit trigger registra channel='system' diferenciando de 'ui'. app.user_id NÃO setado — job sem ator humano. |
| #10 forceRun endpoint | `POST /master/aesthetic-purge-sensitive/run-now` (master only, `apps/api/src/routes/master.js`) publica em Redis canal `admin:purge-sensitive-trigger`. Worker `subscribeAdminTriggers()` ouve e dispara `runPurgeSensitive({forceRun:true})`. Fire-and-forget — resultado logado no worker. |
| #11 timezone BRT clarificado | `TICK_UTC_HOUR` configurável via env `AESTHETIC_PURGE_HOUR_UTC` (default 7). Comentário documenta: BRT = UTC-3 fixo desde 2019 (Lei 13.874/2019, sem DST). Comportamento previsível sem cálculo de timezone. |
| #12 retention configurável | `RETENTION_DAYS` via env `AESTHETIC_SENSITIVE_RETENTION_DAYS` (default 365). `BATCH_LIMIT` via `AESTHETIC_PURGE_BATCH` (default 100). Todos os defaults backward-compat preservados. |

## Limitações honestas

- **Sonnet Vision auto-crop não é 100% confiável** — pode ter falso-negativo (mamilo passa sem blur) ou falso-positivo (mancha confundida com mamilo). O modal de preview (TODO#5) mitiga isso — profissional vê o resultado antes de confirmar.
- **forceRun endpoint é fire-and-forget** — response HTTP retorna imediatamente após publish Redis. O caller não sabe quantas rows foram purgadas. Para verificar: checar logs do worker container ou `SELECT * FROM audit_log WHERE entity_type='aesthetic_photos' AND actor_channel='system'`.
- **subscribeAdminTriggers usa global.__purgeAdminRedisSub** — guard simples para evitar double-subscription em reinícios rápidos. Em multi-instância ECS (desiredCount>1), cada instância terá sua própria Redis sub connection e processará o mesmo trigger — ambas tentam purgar, mas `alreadyRanToday` + `AND deleted_at IS NULL` garantem idempotência (segunda instância não encontra rows elegíveis ou recebe rowCount=0).

## Custos

- Auto-crop por foto sensível: +~$0.005 (Sonnet Vision ~3k input tokens + 200 output) + ~3s latência. Cliente pode opt-out via `auto_crop=false`.
- Purge job mensal: ~zero (single query + DB updates + S3 deletes). Roda em worker existente.
- Sem mudança de cobrança ao tenant — créditos por análise inalterados.

## Próxima fase

**F6 — Polish + integrações finais (8 dias).** Migration 096 (`clinical_encounters.related_aesthetic_analysis_id`) + Timeline UNION ALL com aesthetic_analyses + encounter vinculo + agenda quick-create pre-fill + PDF protocol export + integration E2E tests. Spec §16 F6.
