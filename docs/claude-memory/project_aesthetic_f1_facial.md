---
name: F1 Aesthetic Facial Analysis
description: F1 Facial análise IA — entregue 2026-05-11. Pipeline two-call Sonnet+Opus, anotações SVG, comparação evolutiva, cobrança via créditos.
type: project
---

# F1 Aesthetic Facial Analysis — entregue 2026-05-11

Spec: `docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md`
Plano: `docs/superpowers/plans/2026-05-11-aesthetic-f1-facial.md`

## Estado em 2026-05-11

25 tasks + IAM update entregues em main. Feature ativa para tenants com `module = 'estetica'`. Pipeline end-to-end operacional: upload de foto → análise assíncrona via fila → resultado com anotações SVG + recomendações de protocolo.

## Migrations

| Migration | Tabela | Descrição |
|---|---|---|
| 088 | `aesthetic_photos` | Fotos com signed URL TTL 1h, RLS NULLIF padrão, audit trigger |
| 089 | `aesthetic_analyses` | Resultado JSON (métricas + anotações + recomendações), status queue |
| 090 | `aesthetic_consent` | Consent operacional 1×/paciente, registrado pelo profissional |

## Backend

- **Rotas:** `apps/api/src/routes/aesthetic/` — consent, photos, analyses
- **Services:** `apps/api/src/services/aesthetic/`
- **Queue:** `apps/worker/src/queues/aesthetic-analysis` — BullMQ, processamento assíncrono
- **Middleware:** module gate (bloqueia tenants sem `module = 'estetica'`)
- **Constants:** métricas faciais definidas em `apps/api/src/constants/aesthetic-metrics.js`

## Worker — Pipeline Two-Call

1. **Sonnet Vision** — Analisa foto facial e retorna 11 métricas quantitativas com bounding boxes / anotações SVG
2. **Opus Recommender** — Recebe métricas do Sonnet e gera recomendações de protocolo personalizadas

Padrão LLM: regex tolerante, whitelist de enums, clamp numérico, slice strings, BAD_LLM_OUTPUT 502 em falha de parse.

## 11 Métricas Faciais

`rugas`, `firmeza`, `elasticidade`, `textura`, `manchas`, `poros`, `olheiras`, `vermelhidao`, `uniformidade_tom`, `acne`, `simetria`

Cada métrica retorna: `score` (0-10), `observations` (string), `confidence` (float 0-1).

## Anotações SVG

5 tipos de anotação sobre a foto:
- `bbox` — bounding box retangular
- `polyline` — linha poligonal aberta
- `polygon` — polígono fechado
- `line` — linha simples
- `point` — ponto marcador

**Toggle por camada:** frontend permite ativar/desativar visualização de cada tipo de anotação independentemente (layer-toolbar).

## Comparação Evolutiva

- Esteticista escolhe foto **baseline** + foto **atual** (ambas do mesmo paciente)
- Delta matemático calculado no frontend, sem nova chamada IA
- comparison-view.component.ts renderiza side-by-side com delta colorido (melhora/piora por métrica)
- Útil para acompanhar evolução de tratamento ao longo do tempo

## Frontend — 13 componentes/services

Diretório: `apps/web/src/app/features/aesthetic/`

| Arquivo | Tipo | Função |
|---|---|---|
| `models/analysis.model.ts` | Model | Region union type, MetricData interface, etc. |
| `services/aesthetic-facial.service.ts` | Service | HTTP para API aesthetic |
| `services/photo-validator.service.ts` | Service | Validação client-side antes do upload |
| `services/photo-overlay.service.ts` | Service | Renderização de anotações SVG sobre canvas |
| `services/aesthetic-ws.service.ts` | Service | WebSocket para notificação de análise concluída |
| `components/consent-modal/` | Component | Modal de consentimento operacional (profissional confirma) |
| `components/photo-quality-guide/` | Component | Guia de requisitos da foto antes do upload |
| `components/photo-uploader/` | Component | Upload com validação e preview |
| `components/photo-overlay/` | Component | Foto com SVG overlay de anotações |
| `components/layer-toolbar/` | Component | Toggle por tipo de anotação |
| `components/analysis-result/` | Component | Resultado completo com disclaimer §13 |
| `components/analysis-list/` | Component | Histórico de análises do paciente |
| `components/comparison-view/` | Component | Comparação evolutiva side-by-side |
| `components/facial-analysis-tab/` | Component | Orchestrator — state machine completa do fluxo |

**Integração patient-detail:** aba "Análise Facial" exibida condicionalmente `@if (module === 'estetica')` — multi-módulo preservado.

## Consentimento (LGPD)

- **Operacional:** profissional confirma consentimento do paciente (1 vez por paciente)
- **Paciente não acessa:** sistema interno da clínica, não portal do paciente
- Tabela `aesthetic_consent` com audit trigger
- Sem anamnese — análise IA não substitui avaliação profissional

## Cobrança

- **5 créditos por análise** (configurável via env var `AESTHETIC_FACIAL_COST`)
- Debitado no início do processamento (queue reservation)
- **Refund automático** em erros terminais: `NO_FACE_DETECTED`, `IMAGE_TOO_BLURRY`, `BAD_LLM_OUTPUT`
- Erros técnicos reversíveis não geram cobrança ao paciente/cliente

## IAM / S3

- TaskRole atualizada: prefix `aesthetic-photos/*` adicionado
- Signed URLs com TTL 1h para fotos (segurança de dados sensíveis)
- RLS NULLIF padrão em todas as 3 tabelas novas

## LGPD / Compliance

- RLS com `NULLIF` em aesthetic_photos, aesthetic_analyses, aesthetic_consent
- `FORCE ROW LEVEL SECURITY` nas 3 tabelas
- Audit triggers em todas as 3 tabelas (INSERT/UPDATE/DELETE)
- Signed URLs TTL 1h (fotos não ficam expostas indefinidamente)
- Consent operacional registrado com timestamp + user_id do profissional

## Disclaimer Regulatório (§13 obrigatório)

Obrigatório em `analysis-result` e em qualquer tela que exiba resultado:

> "Os resultados desta análise são gerados por inteligência artificial e têm caráter exclusivamente informativo e de apoio ao profissional habilitado. Não constituem diagnóstico médico, laudo clínico nem prescrição de tratamento. A interpretação e a tomada de decisão são de responsabilidade exclusiva do profissional de estética/saúde responsável pelo atendimento, conforme CFM, CFE e CRN."

## Padrões estabelecidos para F2+

- Module gate via middleware para proteger rotas aesthetic
- Fila BullMQ com dead letter queue para análises com falha
- Two-call pattern (classificação rápida + recomendação profunda) para controle de custo
- Refund automático em terminal errors como padrão de créditos
- Signed URL TTL curto (1h) para fotos de pacientes como padrão LGPD

## Débitos abertos pós-F1 Facial

- **Smoke E2E manual** — criar tenant teste com `module='estetica'`, fazer upload de foto real, validar pipeline completo até resultado com anotações
- **F2 Facial** — comparação contra banco de referência anonimizado (sem dados pessoais de terceiros)
- **Relatório PDF** — exportar resultado análise + recomendações como PDF assinável
