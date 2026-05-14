# Patient Timeline — Design Spec
**Data:** 2026-05-08  
**Status:** Aprovado  
**Módulos afetados:** human, veterinary, estetica

---

## Objetivo

Nova aba "Timeline" no patient-detail que narra cronologicamente toda a história do paciente dentro do GenomaFlow: cadastro, exames, análises IA, agendamentos, teleconsultas, prontuários, prescrições e follow-ups enviados. Substitui a abordagem fragmentada atual onde cada tipo de dado vive em abas separadas sem conexão temporal.

---

## Abordagem escolhida

**Opção A — Timeline vertical + painel lateral deslizante**

- Feed cronológico vertical com eventos agrupados por mês/ano
- Clique em qualquer evento abre um painel de detalhe sem navegar para outra página
- Desktop: slide-over 420px pela direita (`translateX`)
- Mobile: bottom-sheet 85% de altura (`translateY`), com handle de arraste
- Botões "Abrir completo" no painel para ações explícitas de navegação

---

## Backend

### Endpoint existente a ser expandido

`GET /patients/:id/timeline` em `apps/api/src/routes/patients.js`

Já implementa:
- UNION ALL de `clinical_encounters`, `exams`, `prescriptions`, `clinical_results`
- Paginação cursor-based (timestamp + ID)
- Limite configurável até 200, padrão 50

### Novos tipos adicionados ao UNION ALL

```sql
-- 1. Cadastro do paciente (evento único)
SELECT
  s.id            AS event_id,
  'registered'    AS event_type,
  s.created_at    AS event_at,
  s.name          AS title,
  NULL            AS subtitle,
  NULL            AS status,
  NULL            AS metadata
FROM subjects s
WHERE s.id = $subject_id AND s.tenant_id = $tenant_id

-- 2. Agendamentos
SELECT
  a.id                AS event_id,
  'appointment'       AS event_type,
  a.start_at          AS event_at,
  a.appointment_type  AS title,
  a.status            AS subtitle,
  a.status            AS status,
  json_build_object(
    'duration_minutes', a.duration_minutes,
    'notes', a.notes
  )                   AS metadata
FROM appointments a
WHERE a.subject_id = $subject_id AND a.tenant_id = $tenant_id

-- 3. Teleconsultas
SELECT
  vc.id                  AS event_id,
  'video_consultation'   AS event_type,
  COALESCE(vc.started_at, vc.created_at) AS event_at,
  vc.modality            AS title,
  vc.status              AS subtitle,
  vc.status              AS status,
  json_build_object(
    'duration_seconds', vc.duration_seconds,
    'credits_debited',  vc.credits_debited,
    'modality',         vc.modality,
    'encounter_id',     vc.encounter_id
  )                      AS metadata
FROM video_consultations vc
JOIN appointments a ON a.id = vc.appointment_id
WHERE a.subject_id = $subject_id AND vc.tenant_id = $tenant_id

-- 4. Follow-ups enviados
SELECT
  sn.id              AS event_id,
  'followup'         AS event_type,
  sn.sent_at         AS event_at,
  sn.notification_type AS title,
  sn.channel         AS subtitle,
  'sent'             AS status,
  json_build_object(
    'type', sn.notification_type,
    'channel', sn.channel
  )                  AS metadata
FROM scheduled_notifications sn
WHERE sn.subject_id = $subject_id
  AND sn.tenant_id = $tenant_id
  AND sn.sent_at IS NOT NULL
```

### Formato de resposta

```json
{
  "items": [
    {
      "event_id": "uuid",
      "event_type": "video_consultation",
      "event_at": "2026-05-08T14:00:00Z",
      "title": "complete",
      "subtitle": "done",
      "status": "done",
      "metadata": {
        "duration_seconds": 1080,
        "credits_debited": 3,
        "encounter_id": "uuid"
      }
    }
  ],
  "next_cursor": "2026-05-05T09:15:00Z_uuid",
  "has_more": true
}
```

---

## Frontend

### Componentes novos

#### `patient-timeline.component.ts`
`apps/web/src/app/features/doctor/patients/patient-timeline.component.ts`

Responsabilidades:
- Recebe `subjectId` como `@Input()`
- Carrega eventos paginados (`/patients/:id/timeline?cursor=&limit=50`)
- Agrupa por mês/ano para os separadores
- Renderiza a linha vertical + cartões
- Barra de filtro: chips por `event_type` + seletor de período (últimos 30d / 3m / 6m / 1a / tudo)
- Botão "Carregar mais" no rodapé (não infinite scroll)
- Ao clicar num evento: emite `(eventSelected)` → parent abre o painel

#### `timeline-panel.component.ts`
`apps/web/src/app/features/doctor/patients/timeline-panel.component.ts`

Responsabilidades:
- Recebe `event` como `@Input()` e `visible` como `@Input()`
- Renderiza conteúdo diferente via `@switch (event.event_type)`
- Desktop: `position:fixed; right:0; top:0; bottom:0; width:420px; transform:translateX(100%→0)`
- Mobile (`max-width:768px`): `position:fixed; bottom:0; left:0; right:0; height:85vh; transform:translateY(100%→0)` + handle no topo
- Fecha com: Esc, clique no backdrop semitransparente, botão ×, swipe down (mobile)
- Backdrop: `rgba(0,0,0,0.4)` cobrindo o restante da tela

### Integração no patient-detail

Nova aba adicionada no `mat-tab-group` existente:
```html
<mat-tab label="🕐 Timeline">
  <app-patient-timeline [subjectId]="subject.id" />
</mat-tab>
```

### Identidade visual dos eventos

| event_type | Ícone Material | Cor do dot |
|---|---|---|
| `registered` | `person_add` | `#22c55e` |
| `exam` | `biotech` | `#3b82f6` |
| `ai_analysis` | `psychology` | `#8b5cf6` |
| `appointment` | `calendar_today` | `#f59e0b` |
| `video_consultation` | `videocam` | `#06b6d4` |
| `encounter` | `description` | `#94a3b8` |
| `prescription` | `medication` | `#f97316` |
| `followup` | `notifications` | `#64748b` |

### Layout do cartão de evento

```
[dot]─[ícone]  Título legível do evento          23/05/2026 14:32
               Subtítulo de 1 linha
               [badge de status/alerta opcional]
```

### Agrupamento por mês/ano

```
── Maio 2026 ────────────────────────
● videocam   Teleconsulta completa · 18 min · 3 créditos    08/05 14:00
● biotech    Hemograma · ⚠ alerta alto                      05/05 09:15
── Abril 2026 ───────────────────────
● description  Prontuário assinado                          28/04 11:00
```

---

## Conteúdo do painel por event_type

| Tipo | Campos exibidos | Ação primária |
|---|---|---|
| `registered` | Data de cadastro, módulo, dados básicos | — |
| `exam` | Tipo, status, alerta, resumo IA se disponível | "Ver resultados completos" → `/results/:id` |
| `ai_analysis` | Agente, data, trecho do summary, confiança | "Ver exame associado" |
| `appointment` | Data/hora, duração, tipo, status, notas | — |
| `video_consultation` | Modalidade, duração, créditos, status | "Abrir prontuário" se encounter_id presente |
| `encounter` | Queixa, diagnóstico hipotético, snippet anamnese, origem | "Abrir prontuário completo" → `/encounters/:id` |
| `prescription` | Lista de medicamentos + posologia, status | "Ver prescrição completa" |
| `followup` | Tipo, canal, data de envio | — |

---

## Responsividade e Mobile (Capacitor)

- Breakpoint `768px` separa comportamento desktop/mobile
- Mobile: bottom-sheet com handle de arraste (swipe down fecha)
- Filtros mobile: botão "Filtrar ▾" → bottom-sheet separado de filtros
- Cartões mobile: full-width sem linha lateral esquerda
- `cap sync android` obrigatório após build web

---

## Compatibilidade multi-módulo

- `human`: subjects, owners irrelevante, appointment_type pode ser "telemedicina" ou "presencial"
- `veterinary`: mesmos eventos; título do paciente inclui espécie/raça nos metadados do `registered`
- `estetica`: sem `ai_analysis` de agentes clínicos, sem `encounter` (ou com source diferente)
- A query usa `subject_id` como FK universal — funciona para os 3 módulos sem alteração

---

## Sem migration nova

`scheduled_notifications` não tem RLS formal, mas a UNION ALL usa `AND tenant_id = $tenant_id` explícito em todas as sub-queries (defesa em profundidade — padrão do projeto). Sem migration necessária para o endpoint (apenas query expandida).

---

## Não está no escopo desta spec

- Edição de eventos a partir da timeline
- Exportação PDF da timeline
- Compartilhamento da timeline com o paciente
- Notificação em tempo real de novos eventos (possível fase 2)
