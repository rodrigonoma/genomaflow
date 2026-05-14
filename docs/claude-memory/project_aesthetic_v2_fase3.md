---
name: Aesthetic V2 Fase 3 — Pseudo-3D facial (F3.1 MVP heightmap)
description: V2 Fase 3 F3.1 entregue 2026-05-13. Botão "Gerar 3D" em análise advanced gera depth map no worker (MOCK gradient por enquanto) + viewer Three.js heightmap no frontend. F3.1-B.2 (ONNX real) e F3.2 (multi-view fusion) pendentes.
type: project
---

# Aesthetic V2 Fase 3 — F3.1 entregue 2026-05-13

Pseudo-3D facial via depth estimation + heightmap rendering Three.js. Disponível em tier=advanced apenas. Sem custo extra de créditos. Sob demanda (botão "Gerar 3D").

Spec: `docs/superpowers/specs/2026-05-13-aesthetic-v2-fase3-design.md`.
Branch: `feat/aesthetic-v2-fase3` (merged ff em main, deploy `25817104163` verde).

## Status atual

| Sub-fase | Status |
|---|---|
| F3.1-A migration 103 + service | ✅ Prod |
| F3.1-B worker depth-anything **MOCK** + processor + queue | ✅ Prod (mock gradient) — superado |
| F3.1-B.2 ONNX real (swap mock) | ✅ Prod (Depth-Anything-V2-Small) |
| F3.1-C API rotas POST/GET /aesthetic/analyses/:id/depth | ✅ Prod |
| F3.1-D DepthViewerComponent Three.js | ✅ Prod |
| F3.1-E Integração analysis-result + WS | ✅ Prod |
| F3.1-F IAM S3 policy (CDK) | ⚠️ **Requer cdk deploy MANUAL** |
| F3.2-A Multi-view depth (5 poses) + pose switcher UI | ✅ Prod |
| F3.2-B GLTF mesh real + GLTFLoader rotação 360° | ❌ Pendente |

## Decisões F3-D1 a F3-D8

| # | Decisão |
|---|---|
| F3-D1 | Depth estimation no worker via onnxruntime-node + Depth-Anything-V2-Small (~25MB) — MAS atualmente MOCK gradient F3.1-B.1 |
| F3-D2 | Multi-view fusion usa landmarks MediaPipe como correspondences (sem SolvePnP/ICP) — F3.2 pendente |
| F3-D3 | Sob demanda — botão dispara, não roda durante análise |
| F3-D4 | Tier advanced exclusivo (standard recebe 400 TIER_NOT_ADVANCED) |
| F3-D5 | Sem cobrança extra (incluído nos 10cr advanced) |
| F3-D6 | GLTF binário (.glb) pra F3.2; PNG depth pra F3.1 |
| F3-D7 | Foto frontal serve de textura UV |
| F3-D8 | Execução em 2 ondas: F3.1 heightmap MVP (entregue) → F3.2 multi-view fusion |

## Pipeline atual (F3.1)

```
[Esteticista] análise advanced concluída → botão "🎭 Gerar Modelo 3D"
       ↓ POST /aesthetic/analyses/:id/depth
[API]
       ↓ Valida: tier=advanced + status=done + idempotente
       ↓ INSERT aesthetic_depth_models status=pending
       ↓ BullMQ enqueue 'aesthetic-depth'
       ↓ Retorna 202 { status: pending }
[Worker — concurrency 1]
       ↓ markProcessing
       ↓ SELECT frontal photo (advanced sempre tem pose='frontal')
       ↓ Download S3
       ↓ generateDepthMap(buffer) [MOCK gradient radial — F3.1-B.1]
       ↓ Upload PNG 512x512 grayscale → aesthetic-depth/{tenant}/{analysis}.png
       ↓ markDone com metadata { processing_ms, photo_used, depth_resolution }
       ↓ Redis publish aesthetic:event:{tenant} { kind: 'depth_ready' }
[Frontend]
       ↓ WS event → getDepth refetch → status=done
       ↓ <app-depth-viewer> lazy import('three') + import OrbitControls
       ↓ PlaneGeometry 256 segments + displacementMap (PNG) + foto como texture
       ↓ OrbitControls clamp ±40° (heightmap perde ilusão em rotação alta)
       ↓ Esteticista rotaciona/zoom
```

## Arquitetura

### Backend

| Arquivo | Função |
|---|---|
| `db/migrations/103_aesthetic_depth_models.sql` | Tabela com status/model_type/s3_keys/metadata; RLS + audit trigger |
| `services/aesthetic-depth-models.js` (API) | CRUD: createPending (whitelist heightmap\|multiview_fusion), markDone, markError, getByAnalysisId |
| `queues/aesthetic-depth-queue.js` (API) | BullMQ producer attempts:1 (sem retry — depth é caro) |
| `routes/aesthetic-depth.js` | POST cria/idempotente; GET polling fallback; tier=advanced gate; rate limit 10/h |

### Worker

| Arquivo | Função |
|---|---|
| `lib/depth-anything.js` | **MOCK F3.1-B.1**: gradient radial 512x512 via sharp. TODO F3.1-B.2: substituir por onnxruntime-node + modelo real |
| `processors/aesthetic-depth.js` | Pipeline mark_processing → fetch frontal → generate → upload → mark_done + WS publish. Falha → mark_error + WS depth_failed. Sem re-throw (sem retry automático) |
| `index.js` | 4ª fila BullMQ 'aesthetic-depth' (concurrency 1) + graceful shutdown |

### Frontend

| Arquivo | Função |
|---|---|
| `components/depth-viewer.component.ts` | Three.js lazy + PlaneGeometry com displacementMap + OrbitControls clamp ±40°. Cleanup dispose completo no destroy |
| `components/analysis-result.component.ts` | Botão "Gerar 3D" state-aware (idle\|pending\|processing\|done\|error). ngAfterViewInit faz GET idempotente. WS subscribe depth_ready/depth_failed. Renderiza <app-depth-viewer> quando done |
| `services/aesthetic-facial.service.ts` | generateDepth + getDepth + DepthModelResponse interface |
| `services/aesthetic-ws.service.ts` | AestheticEvent.kind ganha 'depth_ready' \| 'depth_failed' + depth_id opcional |

### Infra (CDK)

- `infra/lib/ecs-stack.ts`: TaskRole ganha PutObject/GetObject/DeleteObject em `aesthetic-depth/*`
- **Requer `cdk deploy` manual** — workflow CI/CD não roda automaticamente

## Pendências críticas

### F3.1-B.2: swap MOCK → ONNX real (ENTREGUE 2026-05-13)

Concluído primeira tentativa. Alpine + onnxruntime-node compatíveis (musl não bloqueia).
HuggingFace download (~100MB) no Docker build passou com `--retry 3 --retry-delay 5`.

Pipeline real implementado em `apps/worker/src/lib/depth-anything.js`:
- `getSession()` singleton lazy (modelo carrega no primeiro `generateDepthMap`)
- `preprocess(buf)`: sharp resize 518x518 → CHW float32 com normalize ImageNet
- `session.run({ inputName: tensor })` via introspection de inputNames
- `postprocess(tensor)`: min-max normalize → 0-255 → resize 512x512 → PNG
- Suporta output [1, H, W] ou [1, 1, H, W] (variação export ONNX)

PROVIDER_VERSION agora `'depth-anything-v2-small@1.0'` (audit trail).

Tempo de inference em Fargate small a observar — se >60s vira gargalo,
upgrade pra c6i/c7i (AVX512) ou GPU on-demand via Lambda.

### F3.2: multi-view fusion

Após F3.1-B.2 estabilizado em prod com feedback positivo. Adiciona:
- Worker gera depth maps das 5 poses (não só frontal)
- Fusion via landmarks MediaPipe como correspondências cross-view
- Triangulação canonical FaceMesh + GLTF export
- Frontend DepthViewer aceita `mode='gltf'` + GLTFLoader

## Como testar em produção (após CDK deploy)

1. Rodar nova análise advanced com 5 fotos faciais MediaPipe captura guiada
2. Aguardar análise concluir (status=done com aggregates + geometria + Vision)
3. Resultado: botão **"🎭 Gerar Modelo 3D"** aparece (só em advanced)
4. Clicar → ~5s (mock é rápido) → viewer abre auto
5. Mock gradient renderiza como plano ligeiramente curvado (centro mais "próximo")
6. OrbitControls: arrasta pra girar (limitado ±40°), scroll pra zoom
7. Botão "Ocultar 3D" fecha viewer

## Não regredir

❌ Não chamar generateDepth sem checar tier=advanced (backend retorna 400)
❌ Não confiar que depth gerou em <30s (mock é instantâneo mas ONNX real será lento)
❌ Não usar `s3_key_glb` em F3.1 (vem em F3.2)
❌ Não esquecer cdk deploy quando adicionar novos prefixos S3 (incidente IAM 2026-04-25)
❌ Não rodar depth em tier=standard sem antes adicionar suporte (validação 2-fold: backend + frontend)

✅ Sempre idempotente em POST /depth (status=done → retorna direto)
✅ Status=error pode regenerar (cria nova entry, não bloqueia)
✅ WS event `depth_ready` SEMPRE seguido de GET pra fetchar URLs S3 assinadas
✅ Cleanup Three.js no ngOnDestroy (dispose geometry/material/textures/renderer)

## Custos & métricas

- Sem custo IA F3.1 (mock); F3.1-B.2 ONNX será ~$0 (modelo local)
- Storage: PNG depth ~200KB/análise advanced
- Worker compute: ~5s mock; F3.1-B.2 estimado 30-60s
- Bundle frontend: +600KB (Three.js + OrbitControls lazy)
- Latência usuário: clica → ~5s (mock) ou ~60s (ONNX real) + WS deliver
