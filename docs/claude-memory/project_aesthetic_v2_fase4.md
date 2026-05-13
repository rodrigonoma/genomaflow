---
name: Aesthetic V2 Fase 4 — Relatório paciente + Timeline evolutiva
description: F4 entregue 2026-05-13. Compartilhamento de relatório paciente via email (SES) E WhatsApp (Z-API). Timeline evolutiva ng2-charts no patient-detail. Migration 104 audit trail completo.
type: project
---

# Aesthetic V2 Fase 4 — entregue 2026-05-13

Fechamento da plataforma aesthetic V2. Spec: `docs/superpowers/specs/2026-05-13-aesthetic-v2-fase4-design.md`.

## Sub-fases entregues

| Sub | Status |
|---|---|
| F4-A migration 104 + service shares + PDF/HTML paciente | ✅ Prod |
| F4-B routes share + export-patient.pdf + Z-API sendDocument | ✅ Prod |
| F4-C ShareAnalysisDialogComponent + botão analysis-result | ✅ Prod |
| F4-D Evolution endpoint + AestheticEvolutionTimelineComponent + integração patient-detail | ✅ Prod |
| F4 IAM `aesthetic-patient-pdf/*` CDK | ✅ Aplicado |

## Componentes principais

### Backend (apps/api)

| Arquivo | Função |
|---|---|
| `db/migrations/104_aesthetic_analysis_shares.sql` | Audit trail (channel, status, recipient, provider_id, s3_key_pdf cache, sent_at, delivered_at) |
| `services/aesthetic-analysis-shares.js` | createShare/markSent/markFailed/listByAnalysis/findCachedPdfKey |
| `services/aesthetic-pdf-export-patient.js` | PDF leigo: scores como texto ('ótimo'/'bom'/'atenção'), barras coloridas, banda lavanda header |
| `services/aesthetic-html-export-patient.js` | HTML self-contained pra email inline; escape XSS |
| `services/aesthetic-evolution.js` | listEvolutionPoints (timeline temporal) |
| `services/whatsapp-client.js` (estendido) | sendDocument({phone, mediaUrl, fileName, caption}) Z-API send-document/{ext} |
| `routes/aesthetic-shares.js` | GET /export-patient.pdf + POST /share orquestrando email+whatsapp |
| `routes/aesthetic-evolution.js` | GET /subjects/:id/aesthetic-evolution |

### Frontend (apps/web)

| Arquivo | Função |
|---|---|
| `components/share-analysis-dialog.component.ts` | Modal com checkboxes email/whatsapp + inputs validados + custom_message 500 chars + result inline; suporta 207 multi-status |
| `components/aesthetic-evolution-timeline.component.ts` | ng2-charts^6 line 6 séries, spanGaps=false (legacy=null=gap), cores por categoria, tooltip PT-BR |
| `components/analysis-result.component.ts` (estendido) | Botão "📤 Compartilhar com paciente" abre modal; @Inputs subjectName/Email/Phone pré-preenchem |
| `doctor/patients/patient-detail.component.ts` (estendido) | Nova mat-tab "📈 Evolução Estética" só pra module='estetica'; loadSubject dispara GET evolution |
| `services/aesthetic-facial.service.ts` (estendido) | shareAnalysis, exportPatientPdfBlob, getEvolution + interfaces |

### Infra

- IAM `arn:aws:s3:::genomaflow-uploads-prod/aesthetic-patient-pdf/*` aplicado via `cdk deploy genomaflow-ecs`.

## Pipeline share end-to-end

```
[Esteticista] resultado análise → botão "📤 Compartilhar com paciente"
  ↓ Modal: escolhe email + whatsapp + recipient + custom_message
  ↓ POST /aesthetic/analyses/:id/share
[API]
  ↓ Valida tier-free (qualquer status=done) + RFC email + E.164 phone
  ↓ ensurePatientPdf: findCachedPdfKey OU gera novo via buildPatientPDF
  ↓ Upload S3 aesthetic-patient-pdf/{tenant}/{analysis}.pdf
  ↓ Pra cada canal:
       email: sendEmail (SES/Zoho SMTP) HTML inline + link presigned 7d
       whatsapp: sendDocument Z-API com PDF mediaUrl signed
  ↓ Cria aesthetic_analysis_shares (queued → sent/failed)
  ↓ Status 200 todos OK | 207 multi-status | 502 todos falham
```

## Pipeline timeline

```
[Esteticista] patient-detail → aba "📈 Evolução Estética"
[Frontend]
  ↓ ngOnInit já buscou via patient-detail loadSubject
  ↓ <app-aesthetic-evolution-timeline [points]="...">
  ↓ Chart.js line 6 séries (skin_texture, spots, symmetry, wrinkles, dark_circles, acne)
  ↓ Pontos sem score (null) viram gap visível (não interpolam)
  ↓ Cores canônicas: textura cyan, manchas orange, simetria emerald, rugas violet,
    olheiras slate, acne red
```

## Decisões F4-D1 a F4-D7

| # | Decisão |
|---|---|
| F4-D1 | Relatório paciente: PDF + HTML standalone |
| F4-D2 | Compartilhamento email (SES) E WhatsApp (Z-API send-document) |
| F4-D3 | Lib timeline: ng2-charts^6 (Angular 18 compat) + Chart.js |
| F4-D4 | Timeline mostra TODAS (standard + advanced) — gaps onde score=null |
| F4-D5 | Linguagem leiga via mapping score→label (sem LLM extra) |
| F4-D6 | Z-API sendDocument complementa sendText existente |
| F4-D7 | aesthetic_analysis_shares audit trail completo |

## ⚠️ Configuração necessária em produção

**ENV vars WhatsApp** na task definition ECS (sem isso, canal whatsapp falha mas email continua):
- `ZAPI_INSTANCE_ID`
- `ZAPI_TOKEN`
- `ZAPI_CLIENT_TOKEN`

ZAPI_MOCK=1 já está disponível pra dev sem credenciais reais.

**IAM** `aesthetic-patient-pdf/*` aplicado via cdk deploy.

## Tests

- API: 42 novos (services 23 + shares route 13 + evolution 6)
- Web: 0 novos diretos (mas 164 anteriores continuam verdes)

## Refund/cobrança

F4 NÃO consome créditos. Funcionalidade interna do tier advanced/standard.
Rate limits: share 20/h, export-patient.pdf 30/h.

## Bugs caught em deploy

- **ng2-charts@10** peer-requires Angular 21+ — projeto Angular 18 → downgrade pra ng2-charts^6.0.1 compat
- **Concurrency cancel-in-progress** — push CDK só com mudança em `infra/` foi catalogado como "doc-only" pelo path-filter (na verdade nem entrou no filter), cancelou o run F4 anterior. Solução: `gh run rerun <id>` pra forçar redeploy.

## Não regredir

❌ Não compartilhar análises status≠done
❌ Não enviar PDF sem TTL no S3 presigned URL (7 dias max — paciente pode abrir depois)
❌ Não regenerar PDF a cada share (findCachedPdfKey idempotência)
❌ Não falhar share inteiro se 1 canal falha (207 multi-status; outro pode ter passado)
❌ Não atualizar aesthetic_analysis_shares fora do contexto withTenant

✅ Sempre auditar via aesthetic_analysis_shares (LGPD trail)
✅ Sempre validar email RFC + phone E.164 antes de send
✅ Sempre disclaimer "este relatório é informativo, decisões clínicas com profissional"
✅ Timeline aceita análises legacy (sem aggregates) → gap visível, sem crash

## Próximas direções possíveis

- **F4.1** — Email com PDF anexo inline (não só link)
- **F4.2** — WhatsApp templates Meta Cloud API (volume >5k/mês)
- **F4.3** — Compartilhamento via SMS (Twilio)
- **F4.4** — IA recomendação estética temporal (analisa pattern de evolução)
- **F4.5** — Multi-language (EN/ES) — internacionalização
