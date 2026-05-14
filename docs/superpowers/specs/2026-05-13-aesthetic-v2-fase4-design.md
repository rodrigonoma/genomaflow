# Aesthetic V2 — Fase 4: Relatório paciente + Timeline evolutiva

**Spec V2 original:** `genomaflow_estetica_v_2_spec_md.md` §10 + §15 Fase 4.
**Pré-requisitos:** V2 F1/F2/F3 em produção (2026-05-13).
**Branch:** `feat/aesthetic-v2-fase4`.

---

## 1. Objetivo

Fechar a plataforma aesthetic com 2 capacidades de valor B2B alto:

1. **Relatório paciente** — PDF + HTML acessíveis pro paciente final (não esteticista). Compartilhável por email ou WhatsApp. Linguagem leiga, scores explicados em texto, foto antes/depois.
2. **Timeline evolutiva** — série temporal de aggregate scores ao longo de N análises do mesmo subject. Gráfico de linhas (ng2-charts/Chart.js) na aba paciente. Esteticista mostra evolução pro paciente em consulta.

---

## 2. Decisões travadas (brainstorming 2026-05-13)

| # | Decisão |
|---|---|
| F4-D1 | Relatório paciente: PDF + HTML standalone (HTML pra inline email/preview browser) |
| F4-D2 | Compartilhamento: email (SES) E WhatsApp (Z-API send-document) |
| F4-D3 | Lib gráfico timeline: ng2-charts + Chart.js (lazy, ~150kb) |
| F4-D4 | Timeline mostra TODAS as análises (standard + advanced) — gaps onde score não existe |
| F4-D5 | PDF paciente em PT-BR com linguagem leiga gerada por LLM (Sonnet) à partir das métricas |
| F4-D6 | Z-API extension: `sendDocument` complementa o `sendText` existente |
| F4-D7 | Tracking: nova tabela `aesthetic_analysis_shares` audita quem foi enviado pra quem |

---

## 3. Arquitetura

### 3.1 Pipeline relatório paciente

```
[Esteticista] analysis-result → botão "Compartilhar com paciente"
  ↓ Modal: escolhe canais (email | whatsapp | both) + recipient
  ↓
[API] POST /aesthetic/analyses/:id/share
  ↓ Valida análise tier-livre (qualquer status=done)
  ↓ Gera PDF paciente lazy (cached em S3 se já foi gerado)
  ↓ Para email: SES + HTML inline + PDF anexo
  ↓ Para WhatsApp: Z-API send-document com URL S3 assinada (TTL 7d)
  ↓ INSERT aesthetic_analysis_shares { analysis_id, channel, recipient, sent_at, status }
  ↓ Retorna { sent_email: bool, sent_whatsapp: bool, share_id }
```

### 3.2 Pipeline timeline evolutiva

```
[Esteticista] patient-detail → aba "Evolução estética"
  ↓ GET /aesthetic/subjects/:id/aesthetic-evolution
[API]
  ↓ SELECT id, completed_at, tier, metrics->'aggregate_*'
       FROM aesthetic_analyses
      WHERE subject_id=$1 AND tenant_id=$X AND status='done'
   ORDER BY completed_at ASC
  ↓ Retorna { subject_id, points: [{date, scores}, ...] }
[Frontend]
  ↓ AestheticEvolutionTimelineComponent
  ↓ ng2-charts line chart, 6 séries (textura/manchas/simetria/rugas/olheiras/acne)
  ↓ Hover tooltip com data + valores
  ↓ Click no ponto → router navigate pra análise correspondente
```

---

## 4. Tabela `aesthetic_analysis_shares` (NOVA)

Migration **104**:

```sql
CREATE TABLE IF NOT EXISTS aesthetic_analysis_shares (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  analysis_id   UUID NOT NULL REFERENCES aesthetic_analyses(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  channel       TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  recipient     TEXT NOT NULL,             -- email ou phone E.164
  status        TEXT NOT NULL CHECK (status IN ('queued','sent','delivered','failed')),
  provider_id   TEXT,                       -- message_id retornado por SES/Z-API
  error_code    TEXT,
  error_message TEXT,
  s3_key_pdf    TEXT,                       -- cache do PDF paciente
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at  TIMESTAMPTZ
);

ALTER TABLE aesthetic_analysis_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE aesthetic_analysis_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY aesthetic_shares_tenant ON aesthetic_analysis_shares
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL
         OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX idx_aesthetic_shares_analysis ON aesthetic_analysis_shares (analysis_id, sent_at DESC);
CREATE TRIGGER aesthetic_shares_audit
  AFTER INSERT OR UPDATE OR DELETE ON aesthetic_analysis_shares
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

---

## 5. APIs

### 5.1 GET `/aesthetic/analyses/:id/export-patient.pdf`
Download direto do PDF paciente. Idempotente: se PDF já gerado e cacheado em S3, retorna; senão gera novo.

Auth: `requireEsteticaModule`. Rate limit: 30/h.

### 5.2 POST `/aesthetic/analyses/:id/share`
```json
{
  "channels": ["email", "whatsapp"],
  "recipient_email": "paciente@gmail.com",
  "recipient_phone": "+5511999998888",
  "custom_message": "Olá! Aqui está sua análise estética."  // opcional
}
```

Resposta:
```json
{
  "share_id": "uuid",
  "email": { "sent": true, "provider_id": "ses-xxx" },
  "whatsapp": { "sent": true, "provider_id": "zapi-xxx" }
}
```

Rate limit: 20/h (evita abuso). Tier-livre. Status 207 Multi-Status se um canal falha mas outro vai.

### 5.3 GET `/aesthetic/subjects/:id/aesthetic-evolution`

```json
{
  "subject_id": "uuid",
  "points": [
    {
      "analysis_id": "uuid",
      "completed_at": "2026-04-01T10:00:00Z",
      "tier": "standard",
      "aggregate_scores": {
        "skin_texture": 65, "spots": 55, "wrinkles": 60,
        "olheiras": null, "acne": 80, "symmetry": null
      }
    },
    ...
  ]
}
```

Inclui qualquer análise status=done. Scores ausentes vêm `null` (gap no gráfico). Order: ASC by completed_at.

---

## 6. Backend — services

| Arquivo | Função |
|---|---|
| `services/aesthetic-pdf-export-patient.js` | NOVO — pdf-lib + Roboto TTF; cards visuais com scores + foto antes/depois se baseline; texto leigo (gerado por aesthetic-recommender existente — campo `lay_summary` em recommendations) |
| `services/aesthetic-html-export-patient.js` | NOVO — HTML standalone com CSS inline + base64 images. Pra email/preview |
| `services/aesthetic-analysis-shares.js` | NOVO — createShare, updateStatus, listByAnalysis. withTenant + audit |
| `services/ses-mailer.js` (estender) | sendAnalysisShare({to, subject, htmlBody, pdfAttachment}) |
| `services/whatsapp-client.js` (estender) | sendDocument({phone, mediaUrl, fileName, caption}) usando Z-API endpoint `/send-document` |
| `services/aesthetic-evolution.js` | NOVO — listEvolutionPoints(subjectId) com SELECT JSONB jq dos aggregates |
| `routes/aesthetic-export-patient.js` | NOVO — GET .../export-patient.pdf |
| `routes/aesthetic-shares.js` | NOVO — POST .../share |
| `routes/aesthetic-evolution.js` | NOVO — GET /subjects/:id/aesthetic-evolution |

---

## 7. Frontend

| Arquivo | Função |
|---|---|
| `components/share-analysis-dialog.component.ts` | NOVO — modal: checkbox canais, input email/phone, custom_message textarea, botão Enviar |
| `components/aesthetic-evolution-timeline.component.ts` | NOVO — wrapper ng2-charts/Chart.js line chart 6 séries |
| `components/analysis-result.component.ts` (estender) | botão "📤 Compartilhar com paciente" abre modal |
| `services/aesthetic-facial.service.ts` (estender) | shareAnalysis(), getEvolution() |

### 7.1 Dep nova:
```json
{
  "ng2-charts": "^6.x",
  "chart.js": "^4.x"
}
```

---

## 8. Sub-fases

| Sub-fase | Conteúdo | LOC | Push |
|---|---|---|---|
| **F4-A** | Migration 104 + service shares + PDF paciente render | ~500 | Backend internal |
| **F4-B** | API routes: export-patient.pdf + share + extensions whatsapp/ses | ~400 | Visible mas sem UI |
| **F4-C** | Frontend share modal + integração analysis-result | ~400 | UX "compartilhar" |
| **F4-D** | API + Frontend timeline evolutiva (ng2-charts) | ~500 | UX "evolução" |

Total ~1800 LOC, ~40 testes novos.

---

## 9. LGPD / Cuidados

- WhatsApp envia URL S3 assinada com TTL 7d — paciente baixa quando quer, depois expira
- PDF não vai inline em texto (privacidade). Z-API envia via send-document
- aesthetic_analysis_shares audita TUDO (LGPD trail)
- Consent paciente assumido pelo fluxo (esteticista decide quando compartilhar)
- Disclaimer profissional preservado no PDF paciente

---

## 10. Não regredir

- ❌ Não enviar URL S3 sem TTL (presigned obrigatório, max 7d)
- ❌ Não compartilhar análises status≠done
- ❌ Não bloquear se um canal falha (207 Multi-Status; outro pode ter passado)
- ❌ Não regenerar PDF a cada share (cache S3 idempotente)
- ✅ Sempre auditar via aesthetic_analysis_shares
- ✅ Sempre validar email/phone antes de send (e.164 + RFC email)
- ✅ Sempre disclaimer "este relatório é informativo, decisões clínicas com profissional habilitado"
