# Chat Entre Tenants V1 — Fase 4 (Anexo análise IA anonimizada) Implementation Plan

**Goal:** Médico anexa **análise IA anonimizada** a uma mensagem no chat entre clínicas — selecionando exame do próprio tenant + agentes (cardiovascular, hematologia, etc.) — o backend gera snapshot com dados clínicos **sem identificadores do paciente** (sem subject_id, sem nome, sem CPF), apenas idade aproximada, sexo, espécie/raça (vet), risk_scores, alerts, recommendations. Card aparece embutido na thread com expand/collapse.

**Architecture:** Endpoint `POST /conversations/:id/messages` estendido pra aceitar `ai_analysis_card: { exam_id, agent_types[] }` atomicamente (transação cria message + attachment). Payload do attachment é JSONB com os campos anonimizados. Frontend ganha modal picker + componente de card que renderiza risk scores, alertas e recomendações. Constraint `tenant_attachments_kind_payload_check` da Phase 1 já enforça `kind='ai_analysis_card'` com `payload NOT NULL` e `s3_key NULL`.

**Branch:** `feat/chat-phase4-ai-attach`

**Spec:** `docs/superpowers/specs/2026-04-23-inter-tenant-chat-design.md` §5.7 + §7 + §10

---

## Payload anonimizado (contrato JSONB)

```typescript
{
  exam_source_tenant_id: string;   // audit: qual clínica gerou (sempre = sender_tenant_id)
  exam_created_at: string;         // ISO, sem precisão de segundo (só data+hora mês)
  subject: {
    subject_type: 'human' | 'animal';
    age_range: string | null;      // '20-30', '30-40', '60+', etc. — NUNCA birth_date
    sex: string;
    // vet only:
    species?: string;              // 'dog', 'cat', 'equine', 'bovine'
    breed?: string;                // 'labrador', etc.
    weight_kg?: number | null;     // sem precisão decimal
  };
  // No nome, cpf, owner_name, phone, microchip, etc.
  results: Array<{
    agent_type: string;
    interpretation: string;        // texto do agente (pode conter nome? vai pro filtro PII na Phase 5)
    risk_scores: Record<string, string>;
    alerts: Array<{ marker: string; value: string; severity: 'low'|'medium'|'high'|'critical' }>;
    recommendations: Array<{ type: string; description: string; priority: string }>;
  }>;
}
```

**Decisões:**
- `age_range` em buckets de 10 anos (0-10, 10-20, …, 60-70, 70+). Evita identificar por idade exata + condição rara.
- `exam_created_at` mantém timestamp (agente pode precisar; dado identificável é o paciente, não o timestamp do exame).
- Para V1, `interpretation` vai **sem filtro PII**. Phase 5 adiciona filtro.
- `exam_source_tenant_id` é audit — comprova que o snapshot veio do próprio tenant sender.

---

## Pre-flight

- [ ] **Step 0.1: Branch**
  ```bash
  git checkout main && git pull --ff-only origin main
  git checkout -b feat/chat-phase4-ai-attach
  ```

---

## Task 1: Backend — anexo atomic no POST /messages

**Files:**
- Modify: `apps/api/src/routes/inter-tenant-chat/messages.js`
- Create: `apps/api/src/routes/inter-tenant-chat/anonymize.js` (helper puro)
- Create: `apps/api/tests/routes/inter-tenant-chat/anonymize.test.js`
- Modify: `apps/api/tests/routes/inter-tenant-chat/messages.test.js`

- [ ] **Step 1.1: Helper `anonymizeAiAnalysis`**

Create `apps/api/src/routes/inter-tenant-chat/anonymize.js`:

```javascript
/**
 * Converte exam + clinical_results + subject em payload anonimizado
 * pra anexo de chat entre tenants. NUNCA retorna nome, cpf, owner_name,
 * microchip, data de nascimento exata, telefone ou outro PII direto.
 *
 * Input: { exam, subject, results } (rows do DB)
 * Output: payload JSONB conforme spec §5.7
 */

function ageRange(birthDate) {
  if (!birthDate) return null;
  const years = Math.floor((Date.now() - new Date(birthDate).getTime()) / (365.25 * 24 * 3600 * 1000));
  if (years < 0) return null;
  if (years >= 70) return '70+';
  const bucket = Math.floor(years / 10) * 10;
  return `${bucket}-${bucket + 10}`;
}

function roundWeight(w) {
  if (w == null) return null;
  const n = Number(w);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);  // sem casas decimais (5.73 → 6)
}

function anonymizeAiAnalysis({ exam, subject, results }) {
  const isVet = subject.subject_type === 'animal';
  const anonSubject = {
    subject_type: subject.subject_type,
    age_range: ageRange(subject.birth_date),
    sex: subject.sex,
  };
  if (isVet) {
    anonSubject.species = subject.species || null;
    anonSubject.breed = subject.breed || null;
    anonSubject.weight_kg = roundWeight(subject.weight);
  }

  return {
    exam_source_tenant_id: exam.tenant_id,
    exam_created_at: exam.created_at,
    subject: anonSubject,
    results: (results || []).map(r => ({
      agent_type: r.agent_type,
      interpretation: r.interpretation,
      risk_scores: r.risk_scores || {},
      alerts: r.alerts || [],
      recommendations: r.recommendations || [],
    })),
  };
}

module.exports = { anonymizeAiAnalysis, ageRange, roundWeight };
```

- [ ] **Step 1.2: Testes do helper**

Create `apps/api/tests/routes/inter-tenant-chat/anonymize.test.js`:

```javascript
const { anonymizeAiAnalysis, ageRange, roundWeight } = require('../../../src/routes/inter-tenant-chat/anonymize');

describe('ageRange', () => {
  it('retorna null para birth_date nulo', () => {
    expect(ageRange(null)).toBeNull();
  });
  it('retorna bucket de 10 anos', () => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 25);
    expect(ageRange(d.toISOString())).toBe('20-30');
  });
  it('retorna 70+ para idade >= 70', () => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 75);
    expect(ageRange(d.toISOString())).toBe('70+');
  });
});

describe('roundWeight', () => {
  it('arredonda peso', () => { expect(roundWeight(5.73)).toBe(6); });
  it('retorna null para não-número', () => { expect(roundWeight(null)).toBeNull(); expect(roundWeight('abc')).toBeNull(); });
});

describe('anonymizeAiAnalysis', () => {
  it('remove nome/cpf/microchip do subject (human)', () => {
    const exam = { id: 'e1', tenant_id: 't1', created_at: '2026-01-01T00:00:00Z' };
    const birthDate = new Date(); birthDate.setFullYear(birthDate.getFullYear() - 35);
    const subject = {
      id: 's1', name: 'João Silva', cpf_hash: 'xxx', phone: '11999', subject_type: 'human',
      birth_date: birthDate.toISOString(), sex: 'M'
    };
    const results = [
      { agent_type: 'cardiovascular', interpretation: 'ECG normal',
        risk_scores: { total: '3/10' }, alerts: [], recommendations: [] }
    ];

    const out = anonymizeAiAnalysis({ exam, subject, results });
    expect(out.subject.subject_type).toBe('human');
    expect(out.subject.age_range).toBe('30-40');
    expect(out.subject.sex).toBe('M');
    expect(out.subject).not.toHaveProperty('name');
    expect(out.subject).not.toHaveProperty('cpf_hash');
    expect(out.subject).not.toHaveProperty('phone');
    expect(out.subject).not.toHaveProperty('birth_date');
    expect(out.results[0].agent_type).toBe('cardiovascular');
  });

  it('mantém species/breed/weight_kg no animal (vet)', () => {
    const exam = { id: 'e1', tenant_id: 't1', created_at: '2026-01-01' };
    const subject = {
      id: 's1', name: 'Rex', subject_type: 'animal', sex: 'M',
      species: 'dog', breed: 'labrador', weight: 27.3, microchip: 'XYZ123', birth_date: null,
      owner_cpf_hash: 'yyy'
    };
    const out = anonymizeAiAnalysis({ exam, subject, results: [] });
    expect(out.subject.species).toBe('dog');
    expect(out.subject.breed).toBe('labrador');
    expect(out.subject.weight_kg).toBe(27);
    expect(out.subject).not.toHaveProperty('microchip');
    expect(out.subject).not.toHaveProperty('owner_cpf_hash');
    expect(out.subject).not.toHaveProperty('name');
  });
});
```

- [ ] **Step 1.3: Estender POST /messages pra aceitar ai_analysis_card**

**Edit** `apps/api/src/routes/inter-tenant-chat/messages.js`. O handler atual:

```javascript
if (!body || typeof body !== 'string' || !body.trim()) {
  return reply.status(400).send({ error: 'body é obrigatório' });
}
```

Precisa ser relaxado: `body` fica opcional **se** houver attachment. Adicionar validação do anexo.

Substituir o handler POST por:

```javascript
fastify.post('/conversations/:id/messages', {
  preHandler: [fastify.authenticate, ADMIN_ONLY],
  config: { rateLimit: {
    max: 200, timeWindow: '24 hours',
    keyGenerator: (req) => `msg:${req.user?.tenant_id || req.ip}`,
  } }
}, async (request, reply) => {
  const { tenant_id, user_id } = request.user;
  const { id } = request.params;
  const { body, ai_analysis_card } = request.body || {};

  const bodyTrim = typeof body === 'string' ? body.trim() : '';

  // Validação: precisa de body OU anexo
  if (!bodyTrim && !ai_analysis_card) {
    return reply.status(400).send({ error: 'body ou attachment obrigatório' });
  }
  if (bodyTrim.length > 5000) {
    return reply.status(400).send({ error: 'body muito longo (max 5000 chars)' });
  }

  // Validação do anexo de análise IA
  if (ai_analysis_card) {
    const { exam_id, agent_types } = ai_analysis_card;
    if (!exam_id || typeof exam_id !== 'string') {
      return reply.status(400).send({ error: 'ai_analysis_card.exam_id obrigatório' });
    }
    if (!Array.isArray(agent_types) || agent_types.length === 0) {
      return reply.status(400).send({ error: 'ai_analysis_card.agent_types deve ser array não-vazio' });
    }
  }

  try {
    const result = await withConversationAccess(fastify.pg, id, tenant_id, async (client, conv) => {
      // 1. Busca dados do anexo se houver (sempre do tenant do sender)
      let attachmentPayload = null;
      if (ai_analysis_card) {
        const { exam_id, agent_types } = ai_analysis_card;

        // Exame do próprio tenant
        const { rows: examRows } = await client.query(
          `SELECT id, tenant_id, subject_id, created_at, status
           FROM exams
           WHERE id = $1 AND tenant_id = $2 AND status = 'done'`,
          [exam_id, tenant_id]
        );
        if (examRows.length === 0) {
          throw Object.assign(new Error('exam_not_found'), { code: 'EXAM_NOT_FOUND' });
        }
        const exam = examRows[0];

        const { rows: subjectRows } = await client.query(
          `SELECT id, tenant_id, subject_type, birth_date, sex, species, breed, weight
           FROM subjects
           WHERE id = $1 AND tenant_id = $2`,
          [exam.subject_id, tenant_id]
        );
        if (subjectRows.length === 0) {
          throw Object.assign(new Error('subject_not_found'), { code: 'SUBJECT_NOT_FOUND' });
        }
        const subject = subjectRows[0];

        const { rows: resultRows } = await client.query(
          `SELECT agent_type, interpretation, risk_scores, alerts, recommendations
           FROM clinical_results
           WHERE exam_id = $1 AND tenant_id = $2 AND agent_type = ANY($3)`,
          [exam.id, tenant_id, agent_types]
        );
        if (resultRows.length === 0) {
          throw Object.assign(new Error('no_results_for_agents'), { code: 'NO_RESULTS' });
        }

        const { anonymizeAiAnalysis } = require('./anonymize');
        attachmentPayload = anonymizeAiAnalysis({ exam, subject, results: resultRows });
      }

      // 2. Insere mensagem
      const { rows: msgRows } = await client.query(
        `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body, has_attachment)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, conversation_id, sender_tenant_id, sender_user_id, body, has_attachment, created_at`,
        [id, tenant_id, user_id, bodyTrim, !!attachmentPayload]
      );
      const msg = msgRows[0];

      // 3. Insere attachment se houver
      let attachment = null;
      if (attachmentPayload) {
        const { rows: attRows } = await client.query(
          `INSERT INTO tenant_message_attachments (message_id, kind, payload)
           VALUES ($1, 'ai_analysis_card', $2)
           RETURNING id, kind, payload, created_at`,
          [msg.id, JSON.stringify(attachmentPayload)]
        );
        attachment = attRows[0];
      }

      await client.query(
        `UPDATE tenant_conversations SET last_message_at = NOW() WHERE id = $1`,
        [id]
      );
      const counterpart = conv.tenant_a_id === tenant_id ? conv.tenant_b_id : conv.tenant_a_id;
      return { msg, attachment, counterpart };
    });

    // Notifica counterpart
    try {
      if (fastify.notifyTenant) {
        const preview = result.msg.body.length > 120
          ? result.msg.body.slice(0, 120) + '…'
          : (result.msg.body || (result.attachment ? '[análise IA anexada]' : ''));
        fastify.notifyTenant(result.counterpart, {
          event: 'chat:message_received',
          conversation_id: id,
          message_id: result.msg.id,
          sender_tenant_id: tenant_id,
          body_preview: preview,
          created_at: result.msg.created_at,
        });
        fastify.notifyTenant(result.counterpart, {
          event: 'chat:unread_change',
          conversation_id: id,
          delta: 1,
        });
      }
    } catch (_) {}

    return reply.status(201).send({
      ...result.msg,
      attachments: result.attachment ? [result.attachment] : [],
    });
  } catch (err) {
    if (err instanceof ConversationAccessDeniedError) return mapAccessDenied(err, reply);
    if (err.code === 'EXAM_NOT_FOUND') return reply.status(404).send({ error: 'Exame não encontrado ou não está finalizado.' });
    if (err.code === 'SUBJECT_NOT_FOUND') return reply.status(404).send({ error: 'Paciente do exame não encontrado.' });
    if (err.code === 'NO_RESULTS') return reply.status(400).send({ error: 'Nenhum resultado de análise IA para os agent_types selecionados.' });
    throw err;
  }
});
```

- [ ] **Step 1.4: Estender GET /messages pra incluir attachments**

**Edit** `apps/api/src/routes/inter-tenant-chat/messages.js`. No handler GET, mudar a query pra fazer LEFT JOIN com attachments e agregar:

```javascript
fastify.get('/conversations/:id/messages', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
  // ... (auth e params igual)
  try {
    const rows = await withConversationAccess(fastify.pg, id, tenant_id, async (client) => {
      const { rows: r } = await client.query(
        `SELECT m.id, m.conversation_id, m.sender_tenant_id, m.sender_user_id, m.body,
                m.has_attachment, m.created_at,
                COALESCE(
                  (SELECT jsonb_agg(jsonb_build_object(
                    'id', a.id, 'kind', a.kind, 'payload', a.payload, 'created_at', a.created_at
                  ))
                   FROM tenant_message_attachments a WHERE a.message_id = m.id),
                  '[]'::jsonb
                ) AS attachments
         FROM tenant_messages m
         WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
           AND ($2::timestamptz IS NULL OR m.created_at < $2)
         ORDER BY m.created_at DESC
         LIMIT $3`,
        [id, before, limit]
      );
      return r;
    });
    return { results: rows };
  } catch (err) { return mapAccessDenied(err, reply); }
});
```

- [ ] **Step 1.5: Append testes de attachment em messages.test.js**

Adicionar ao `describe('POST /inter-tenant-chat/conversations/:id/messages', ...)` existente:

```javascript
it('201 com ai_analysis_card — cria attachment anonimizado', async () => {
  const { a, conversationId } = await fixtures.createConversedPair(app);
  // cria exam + subject + clinical_result do tenant A
  const pool = fixtures.getPool();
  const { rows: [subj] } = await pool.query(
    `INSERT INTO subjects (tenant_id, name, sex, subject_type, birth_date) VALUES ($1, 'TestSubject', 'M', 'human', '1990-01-01') RETURNING id`,
    [a.tenantId]
  );
  const { rows: [exam] } = await pool.query(
    `INSERT INTO exams (tenant_id, subject_id, uploaded_by, status) VALUES ($1, $2, $3, 'done') RETURNING id`,
    [a.tenantId, subj.id, a.userId]
  );
  await pool.query(
    `INSERT INTO clinical_results (exam_id, tenant_id, agent_type, interpretation, risk_scores, alerts, recommendations, model_version)
     VALUES ($1, $2, 'cardiovascular', 'ECG normal', '{"total":"3/10"}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'test')`,
    [exam.id, a.tenantId]
  );

  const res = await supertest(app.server)
    .post(`/inter-tenant-chat/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${a.token}`)
    .send({ body: 'Opinião?', ai_analysis_card: { exam_id: exam.id, agent_types: ['cardiovascular'] } });
  expect(res.status).toBe(201);
  expect(res.body.has_attachment).toBe(true);
  expect(res.body.attachments).toHaveLength(1);
  const att = res.body.attachments[0];
  expect(att.kind).toBe('ai_analysis_card');
  expect(att.payload.subject.subject_type).toBe('human');
  expect(att.payload.subject).not.toHaveProperty('name');
  expect(att.payload.results[0].agent_type).toBe('cardiovascular');

  // cleanup extra
  await pool.query(`DELETE FROM exams WHERE id = $1`, [exam.id]);
  await pool.query(`DELETE FROM subjects WHERE id = $1`, [subj.id]);
});

it('404 se exam_id não pertence ao sender', async () => {
  const { a, conversationId } = await fixtures.createConversedPair(app);
  const res = await supertest(app.server)
    .post(`/inter-tenant-chat/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${a.token}`)
    .send({ body: 'x', ai_analysis_card: { exam_id: '00000000-0000-0000-0000-000000000099', agent_types: ['cardiovascular'] } });
  expect(res.status).toBe(404);
});

it('400 se body e attachment ambos ausentes', async () => {
  const { a, conversationId } = await fixtures.createConversedPair(app);
  const res = await supertest(app.server)
    .post(`/inter-tenant-chat/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${a.token}`)
    .send({});
  expect(res.status).toBe(400);
});
```

Também adicionar o `'200 GET /messages retorna attachments incluídos'` no bloco GET.

- [ ] **Step 1.6: Rodar testes**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/inter-tenant-chat/ 2>&1 | tail -10
```

Expected: ~65+ PASS (59 prior + ~3 anon helper + ~3 message attach).

- [ ] **Step 1.7: Commit**

```bash
git add apps/api/src/routes/inter-tenant-chat/ apps/api/tests/routes/inter-tenant-chat/
git commit -m "feat(chat): anexo de análise IA anonimizada em POST /messages"
```

---

## Task 2: Frontend — tipos + ChatService helper + picker modal + card component

**Files:**
- Modify: `apps/web/src/app/shared/models/chat.models.ts`
- Create: `apps/web/src/app/features/chat-inter-tenant/ai-analysis-picker.component.ts`
- Create: `apps/web/src/app/features/chat-inter-tenant/ai-analysis-card.component.ts`
- Modify: `apps/web/src/app/features/chat-inter-tenant/chat.service.ts` (sendMessage aceita payload)
- Modify: `apps/web/src/app/features/chat-inter-tenant/thread.component.ts` (botão anexar + render card)

- [ ] **Step 2.1: Tipos**

Adicionar a `chat.models.ts`:

```typescript
export interface AiAnalysisCardPayload {
  exam_source_tenant_id: string;
  exam_created_at: string;
  subject: {
    subject_type: 'human' | 'animal';
    age_range: string | null;
    sex: string;
    species?: string;
    breed?: string;
    weight_kg?: number | null;
  };
  results: Array<{
    agent_type: string;
    interpretation: string;
    risk_scores: Record<string, string>;
    alerts: Array<{ marker: string; value: string; severity: 'low'|'medium'|'high'|'critical' }>;
    recommendations: Array<{ type: string; description: string; priority: string }>;
  }>;
}

export interface MessageAttachment {
  id: string;
  kind: 'ai_analysis_card' | 'pdf' | 'image';
  payload?: AiAnalysisCardPayload;
  created_at: string;
}

// Estender InterTenantMessage
export interface InterTenantMessage {
  // ... existentes
  attachments?: MessageAttachment[];
}
```

- [ ] **Step 2.2: ChatService.sendMessage aceita attachment opcional**

```typescript
sendMessage(conversationId: string, payload: { body?: string; ai_analysis_card?: { exam_id: string; agent_types: string[] } }): Observable<InterTenantMessage> {
  return this.http.post<InterTenantMessage>(`${this.base}/conversations/${conversationId}/messages`, payload);
}
```

(Mudança breaking no call site — atualizar thread.component.ts)

Adicionar método `listMyExams()` e `listMySubjects()` — OU reutilizar endpoints existentes `/exams` e `/patients`. Vamos reutilizar os existentes em vez de criar novos.

- [ ] **Step 2.3: Modal picker**

Create `ai-analysis-picker.component.ts` — MatDialog que:
- Lista exames `done` do tenant (GET /exams?status=done via HttpClient direto — NÃO via ChatService)
- Ao selecionar exame, mostra agentes disponíveis (de `exam.results.map(r => r.agent_type)`)
- Checkboxes de agentes
- Botão "Anexar" fecha dialog com `{ exam_id, agent_types[] }`

Exemplo minimal:

```typescript
// ai-analysis-picker.component.ts
@Component({...})
export class AiAnalysisPickerComponent {
  exams = signal<Exam[]>([]);
  selectedExamId = signal<string | null>(null);
  selectedAgents = signal<Set<string>>(new Set());

  // load via HttpClient direto ao /exams?status=done
  // ... UI com list de exames + chips de agentes
}
```

- [ ] **Step 2.4: Card de análise IA no thread**

Create `ai-analysis-card.component.ts`:

```typescript
@Component({
  selector: 'app-ai-analysis-card',
  ...
  template: `
    <div class="card" [class.expanded]="expanded()">
      <div class="card-header" (click)="expanded.update(v => !v)">
        <mat-icon>insights</mat-icon>
        <span class="card-title">Análise IA Anonimizada</span>
        <span class="card-subtitle">
          {{ payload.subject.subject_type === 'animal' ? 'Animal' : 'Paciente' }} ·
          {{ payload.subject.age_range || 'idade N/D' }} · {{ payload.subject.sex }}
          @if (payload.subject.species) { · {{ payload.subject.species }} }
          @if (payload.subject.weight_kg) { · {{ payload.subject.weight_kg }}kg }
        </span>
        <mat-icon class="chevron">{{ expanded() ? 'expand_less' : 'expand_more' }}</mat-icon>
      </div>
      @if (expanded()) {
        <div class="card-body">
          @for (r of payload.results; track r.agent_type) {
            <div class="agent-block">
              <div class="agent-name">{{ agentLabel(r.agent_type) }}</div>
              @if (r.risk_scores && (r.risk_scores | keyvalue).length > 0) {
                <div class="risk-scores">
                  @for (rs of r.risk_scores | keyvalue; track rs.key) {
                    <span class="risk-chip">{{ rs.key }}: {{ rs.value }}</span>
                  }
                </div>
              }
              @if (r.alerts?.length) {
                <div class="alerts">
                  @for (a of r.alerts; track a.marker) {
                    <div class="alert" [class]="'sev-' + a.severity">
                      <strong>{{ a.marker }}</strong>: {{ a.value }}
                    </div>
                  }
                </div>
              }
              @if (r.interpretation) {
                <div class="interpretation">{{ r.interpretation }}</div>
              }
            </div>
          }
          <div class="disclaimer">🛡 Dados anonimizados. Sem nome, CPF ou identificador do paciente.</div>
        </div>
      }
    </div>
  `
})
export class AiAnalysisCardComponent {
  @Input() payload!: AiAnalysisCardPayload;
  expanded = signal(false);

  agentLabel(k: string): string {
    const map: Record<string, string> = {
      cardiovascular: 'Cardiovascular', hematology: 'Hematologia', metabolic: 'Metabólico',
      therapeutic: 'Terapêutico', nutrition: 'Nutrição',
      small_animals: 'Pequenos Animais', equine: 'Equino', bovine: 'Bovino'
    };
    return map[k] || k;
  }
}
```

- [ ] **Step 2.5: Integrar no ThreadComponent**

- Adicionar botão `[+]` no input antes do textarea abrindo picker (MatDialog)
- Ao receber retorno do picker, chamar `chat.sendMessage(id, { body: draft, ai_analysis_card: {...} })`
- No render de cada message.bubble, se `attachments?.length > 0`, renderizar `<app-ai-analysis-card [payload]="att.payload" />` para cada attachment kind='ai_analysis_card'

- [ ] **Step 2.6: Build**

```bash
cd apps/web && npx ng build --configuration=development 2>&1 | tail -5
```

- [ ] **Step 2.7: Rebuild containers + smoke**

```bash
cd /home/rodrigonoma/GenomaFlow && docker compose up -d --build api web
```

Smoke manual: login admin com exame `done` existente, abrir /chat, conversa com outra clínica, clicar `+`, selecionar exame + agent, enviar. Card aparece na thread expandido/colapsado.

- [ ] **Step 2.8: Commit + push**

```bash
git add apps/web/src/app/
git commit -m "feat(chat): anexo de análise IA no frontend — picker + card + integração thread"
git push -u origin feat/chat-phase4-ai-attach
```

---

## Critérios de pronto

- [ ] Backend: POST /messages aceita `ai_analysis_card: { exam_id, agent_types[] }` e persiste attachment anonimizado
- [ ] Helper `anonymizeAiAnalysis` nunca retorna nome, cpf_hash, phone, owner_*, microchip, birth_date
- [ ] GET /messages retorna attachments array em cada message
- [ ] Frontend: modal picker lista exames `done` + agentes disponíveis
- [ ] Card visual renderiza risk_scores, alerts, recommendations com disclaimer de anonimização
- [ ] Zero regressão nos 108 testes anteriores

## Próximas fases

| 5 | Pipeline PII + anexo PDF/imagem |
| 6 | Reações + busca UI + badge refinado |
| 7 | Anti-abuso + email notify |
| 8 | Mobile + audit log + E2E final |
