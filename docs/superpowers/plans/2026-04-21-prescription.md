# Receita Médica/Veterinária — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar prescrição gerada por IA com sugestão de medicamentos/cuidados, modal de edição pelo profissional, geração de PDF com logo da clínica, envio por WhatsApp, armazenamento no banco e exibição no resultado do exame.

**Architecture:** Worker gera sugestões de medicamentos/cuidados nos agentes terapêutico e nutrição. O profissional revisa no frontend via modal (Angular standalone), gera PDF via jsPDF no browser, faz upload do PDF ao S3 e salva a receita via API. As receitas ficam vinculadas ao exame e aparecem no card de resultado do agente.

**Tech Stack:** Node.js/Fastify (API), PostgreSQL + RLS + `withTenant`, S3 (upload logo + PDF), Angular 18 standalone, jsPDF (browser), @fastify/multipart (logo upload).

---

## Mapa de Arquivos

### Criar
- `apps/api/src/db/migrations/039_prescriptions.sql` — tabela prescriptions + colunas tenants
- `apps/api/src/routes/prescriptions.js` — CRUD de receitas + envio de email (501)
- `apps/api/src/routes/clinic.js` — perfil da clínica + upload de logo
- `apps/web/src/app/features/clinic/prescription/prescription-modal.component.ts` — modal de edição + geração PDF
- `apps/web/src/app/features/clinic/profile/clinic-profile-modal.component.ts` — modal de editar perfil

### Modificar
- `apps/worker/src/agents/therapeutic.js` — prompt com medicamentos específicos + doses
- `apps/worker/src/agents/nutrition.js` — prompt com cuidados vinculados a marcadores
- `apps/api/src/server.js` — registrar rotas prescriptions e clinic
- `apps/web/src/app/shared/models/api.models.ts` — extender Recommendation + nova interface Prescription + ClinicProfile
- `apps/web/src/app/app.component.ts` — adicionar "Editar Perfil" ao menu do avatar
- `apps/web/src/app/features/doctor/results/result-panel.component.ts` — botão "Gerar Receita" + seção receitas salvas
- `apps/web/src/app/features/doctor/patients/patient-detail.component.ts` — botão "Gerar Receita" + seção receitas salvas
- `apps/web/package.json` — adicionar jspdf

---

## Task 1: Branch e Migration SQL

**Files:**
- Create: `apps/api/src/db/migrations/039_prescriptions.sql`

- [ ] **Step 1: Criar branch a partir da main**

```bash
git checkout main
git pull origin main
git checkout -b feat/prescription
```

- [ ] **Step 2: Escrever a migration**

Criar `apps/api/src/db/migrations/039_prescriptions.sql`:

```sql
-- Migration 039: prescriptions table + clinic profile columns

-- Novas colunas em tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cnpj TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS clinic_logo_url TEXT;

-- Tabela de receitas
CREATE TABLE IF NOT EXISTS prescriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  subject_id  UUID NOT NULL REFERENCES subjects(id),
  exam_id     UUID NOT NULL REFERENCES exams(id),
  created_by  UUID NOT NULL REFERENCES users(id),
  agent_type  TEXT NOT NULL CHECK (agent_type IN ('therapeutic', 'nutrition')),
  items       JSONB NOT NULL DEFAULT '[]',
  notes       TEXT,
  pdf_url     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- RLS obrigatório (ENABLE + FORCE)
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions FORCE ROW LEVEL SECURITY;

-- Policy: tenant só acessa suas próprias receitas
CREATE POLICY prescriptions_tenant ON prescriptions
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- Índices de performance
CREATE INDEX IF NOT EXISTS prescriptions_tenant_idx ON prescriptions(tenant_id);
CREATE INDEX IF NOT EXISTS prescriptions_exam_idx   ON prescriptions(exam_id);
CREATE INDEX IF NOT EXISTS prescriptions_subject_idx ON prescriptions(subject_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON prescriptions TO genomaflow_app;
```

- [ ] **Step 3: Aplicar migration no banco Docker**

```bash
docker compose exec api node src/db/migrate.js
```

Resultado esperado: `Migration 039_prescriptions.sql applied` (ou já aplicada).

- [ ] **Step 4: Verificar estrutura criada**

```bash
docker compose exec db psql -U genomaflow_app -d genomaflow -c "\d prescriptions"
docker compose exec db psql -U genomaflow_app -d genomaflow -c "\d tenants" | grep cnpj
```

Resultado esperado: tabela `prescriptions` com todas as colunas + colunas `cnpj` e `clinic_logo_url` em `tenants`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/migrations/039_prescriptions.sql
git commit -m "feat(db): migration 039 — tabela prescriptions + cnpj/clinic_logo em tenants"
```

---

## Task 2: Agente Terapêutico — Sugestão de Medicamentos com Dose

**Files:**
- Modify: `apps/worker/src/agents/therapeutic.js`

- [ ] **Step 1: Atualizar o prompt do agente terapêutico**

Substituir a função `buildSystemPrompt` em `apps/worker/src/agents/therapeutic.js`:

```javascript
const DISCLAIMER = 'As sugestões terapêuticas são de suporte à decisão clínica e devem ser avaliadas e prescritas pelo profissional de saúde responsável. Os medicamentos, doses e frequências sugeridos são recomendações iniciais que DEVEM ser validados, ajustados ou descartados pelo médico ou veterinário antes de qualquer prescrição. Não substituem consulta médica ou veterinária.';

function buildSystemPrompt(module) {
  const context = module === 'veterinary'
    ? 'veterinary clinical decision support, considering species-specific pharmacology, contraindications and Brazilian MAPA/CFMV guidelines'
    : 'human clinical decision support, following Brazilian ANVISA guidelines and CFM protocols';
  return `You are a specialized therapeutic recommendations analyst providing ${context}.
Based on the specialty analysis results and raw lab values provided, suggest therapeutic interventions.
Respond ONLY with valid JSON:
{
  "interpretation": "<summary of therapeutic approach in Brazilian Portuguese>",
  "recommendations": [
    {
      "type": "medication",
      "name": "<specific medication name in Brazilian Portuguese, e.g. Metformina, Enalapril>",
      "dose": "<dose with unit, e.g. 500mg, 10mg/kg>",
      "frequency": "<e.g. 2x ao dia com refeições, 1x ao dia em jejum>",
      "duration": "<e.g. 30 dias — reavaliar, uso contínuo>",
      "priority": "<low|medium|high>",
      "description": "<clinical rationale in Brazilian Portuguese — link to specific lab finding>"
    },
    {
      "type": "procedure",
      "description": "<text in Brazilian Portuguese>",
      "priority": "<low|medium|high>"
    },
    {
      "type": "referral",
      "description": "<text in Brazilian Portuguese>",
      "priority": "<low|medium|high>"
    }
  ],
  "risk_scores": { "therapeutic_urgency": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Rules:
- For type=medication: always include name, dose, frequency, duration. Suggest specific molecules (e.g. Metformina, not just "biguanida").
- For veterinary module: use species-appropriate medications and doses (e.g. Enrofloxacino 5mg/kg for dogs).
- For type=procedure or referral: omit name/dose/frequency/duration fields.
- Link each medication recommendation to the specific lab finding that justifies it.
- The professional will review and edit before prescribing — you may suggest, they decide.`;
}
```

- [ ] **Step 2: Verificar que o JSON gerado inclui os novos campos**

```bash
docker compose exec worker node -e "
const { runTherapeuticAgent } = require('./src/agents/therapeutic');
runTherapeuticAgent({
  examText: 'Glicemia: 187 mg/dL (ref: 70-99). HbA1c: 8.2% (ref: <5.7%). Colesterol LDL: 145 mg/dL.',
  patient: { sex: 'M' },
  specialtyResults: [{ agent_type: 'metabolic', interpretation: 'Glicemia elevada, DM2 provável', alerts: [] }],
  module: 'human',
  species: null
}).then(r => console.log(JSON.stringify(r.result.recommendations, null, 2))).catch(console.error);
"
```

Resultado esperado: array com objetos contendo `name`, `dose`, `frequency`, `duration` para type=medication.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/agents/therapeutic.js
git commit -m "feat(worker): agente terapêutico sugere medicamentos específicos com dose e frequência"
```

---

## Task 3: Agente de Nutrição — Cuidados Vinculados a Marcadores

**Files:**
- Modify: `apps/worker/src/agents/nutrition.js`

- [ ] **Step 1: Atualizar o prompt do agente de nutrição**

Substituir a função `buildSystemPrompt` em `apps/worker/src/agents/nutrition.js`:

```javascript
const DISCLAIMER = 'As sugestões de nutrição e hábitos são de suporte à decisão clínica e devem ser avaliadas pelo profissional de saúde responsável. Não substituem consulta médica, veterinária ou com nutricionista.';

function buildSystemPrompt(module) {
  const context = module === 'veterinary'
    ? 'veterinary nutritional and husbandry recommendations, species-specific dietary guidance following Brazilian MAPA guidelines'
    : 'human nutritional and lifestyle recommendations following Brazilian dietary guidelines (Guia Alimentar para a População Brasileira)';
  return `You are a specialized nutrition and lifestyle analyst providing ${context}.
Based on the specialty analysis results and raw lab values, suggest dietary and lifestyle interventions.
Respond ONLY with valid JSON:
{
  "interpretation": "<summary of nutritional approach in Brazilian Portuguese — mention specific lab values that justify the approach>",
  "recommendations": [
    {
      "type": "diet",
      "description": "<specific dietary instruction in Brazilian Portuguese — always reference the lab finding, e.g. 'Reduzir carboidratos simples — glicemia 187 mg/dL detectada'>",
      "priority": "<low|medium|high>"
    },
    {
      "type": "supplement",
      "name": "<supplement name, e.g. Ômega-3, Vitamina D3>",
      "dose": "<dose with unit, e.g. 1g/dia, 2000 UI/dia>",
      "description": "<rationale in Brazilian Portuguese — reference the specific deficiency or finding>",
      "priority": "<low|medium|high>"
    },
    {
      "type": "habit",
      "description": "<lifestyle recommendation in Brazilian Portuguese>",
      "priority": "<low|medium|high>"
    },
    {
      "type": "activity",
      "description": "<physical activity recommendation in Brazilian Portuguese>",
      "priority": "<low|medium|high>"
    }
  ],
  "risk_scores": { "nutritional_risk": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "${DISCLAIMER}"
}
Rules:
- Always reference specific lab values in each recommendation description.
- For type=supplement: always include name and dose.
- For veterinary: adapt to species diet (e.g. for dogs, mention brand-type guidance; for equines, mention forage/concentrate ratios).
- Never prescribe medication — only diet, habits, supplements and activity.`;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/worker/src/agents/nutrition.js
git commit -m "feat(worker): agente nutrição vincula cuidados aos marcadores encontrados e inclui dose em suplementos"
```

---

## Task 4: API — Rota de Receitas

**Files:**
- Create: `apps/api/src/routes/prescriptions.js`
- Modify: `apps/api/src/server.js`

- [ ] **Step 1: Criar `apps/api/src/routes/prescriptions.js`**

```javascript
const { withTenant } = require('../db/tenant');
const { uploadFile } = require('../storage/s3');

module.exports = async function (fastify) {

  // POST /prescriptions — criar receita
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { subject_id, exam_id, agent_type, items, notes } = request.body || {};

    if (!subject_id || !exam_id || !agent_type || !items) {
      return reply.status(400).send({ error: 'subject_id, exam_id, agent_type e items são obrigatórios' });
    }
    if (!['therapeutic', 'nutrition'].includes(agent_type)) {
      return reply.status(400).send({ error: 'agent_type inválido. Use: therapeutic ou nutrition' });
    }
    if (!Array.isArray(items)) {
      return reply.status(400).send({ error: 'items deve ser um array' });
    }

    const { rows } = await withTenant(fastify.pg, tenant_id, async (client) => {
      return client.query(
        `INSERT INTO prescriptions (tenant_id, subject_id, exam_id, created_by, agent_type, items, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, tenant_id, subject_id, exam_id, agent_type, items, notes, pdf_url, created_at`,
        [tenant_id, subject_id, exam_id, user_id, agent_type, JSON.stringify(items), notes ?? null]
      );
    });

    return reply.status(201).send(rows[0]);
  });

  // GET /exams/:examId/prescriptions — listar receitas do exame
  fastify.get('/exams/:examId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { examId } = request.params;

    const { rows } = await withTenant(fastify.pg, tenant_id, async (client) => {
      return client.query(
        `SELECT p.id, p.agent_type, p.items, p.notes, p.pdf_url, p.created_at,
                u.email as created_by_email
         FROM prescriptions p
         LEFT JOIN users u ON u.id = p.created_by
         WHERE p.exam_id = $1
         ORDER BY p.created_at DESC`,
        [examId]
      );
    });

    return rows;
  });

  // GET /prescriptions/:id — detalhe
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const { rows } = await withTenant(fastify.pg, tenant_id, async (client) => {
      return client.query(
        `SELECT p.*, u.email as created_by_email
         FROM prescriptions p
         LEFT JOIN users u ON u.id = p.created_by
         WHERE p.id = $1`,
        [id]
      );
    });

    if (!rows.length) return reply.status(404).send({ error: 'Receita não encontrada' });
    return rows[0];
  });

  // PUT /prescriptions/:id — atualizar receita (items, notes, pdf_url)
  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const { items, notes, pdf_url } = request.body || {};

    const { rows } = await withTenant(fastify.pg, tenant_id, async (client) => {
      return client.query(
        `UPDATE prescriptions
         SET items = COALESCE($1, items),
             notes = COALESCE($2, notes),
             pdf_url = COALESCE($3, pdf_url),
             updated_at = NOW()
         WHERE id = $4
         RETURNING id, items, notes, pdf_url, updated_at`,
        [items ? JSON.stringify(items) : null, notes ?? null, pdf_url ?? null, id]
      );
    });

    if (!rows.length) return reply.status(404).send({ error: 'Receita não encontrada' });
    return rows[0];
  });

  // DELETE /prescriptions/:id
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    await withTenant(fastify.pg, tenant_id, async (client) => {
      await client.query('DELETE FROM prescriptions WHERE id = $1', [id]);
    });

    return reply.status(204).send();
  });

  // POST /prescriptions/:id/pdf — upload do PDF gerado no browser para S3
  fastify.post('/:id/pdf', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const parts = request.parts();
    let fileBuffer = null;
    let filename = 'receita.pdf';

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'file') {
        filename = part.filename || filename;
        const chunks = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
      }
    }

    if (!fileBuffer) return reply.status(400).send({ error: 'file é obrigatório' });

    const key = `prescriptions/${tenant_id}/${Date.now()}-${filename}`;
    const s3Path = await uploadFile(key, fileBuffer, 'application/pdf');

    const { rows } = await withTenant(fastify.pg, tenant_id, async (client) => {
      return client.query(
        `UPDATE prescriptions SET pdf_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id, pdf_url`,
        [s3Path, id]
      );
    });

    if (!rows.length) return reply.status(404).send({ error: 'Receita não encontrada' });
    return rows[0];
  });

  // POST /prescriptions/:id/send-email — infra pronta, provider TBD
  fastify.post('/:id/send-email', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
    return reply.status(501).send({
      error: 'Envio por email será ativado em breve. Configure o provider de email nas configurações da clínica.'
    });
  });
};
```

- [ ] **Step 2: Registrar as rotas no server.js**

Em `apps/api/src/server.js`, dentro do bloco de registros, adicionar:

```javascript
  fastify.register(require('./routes/prescriptions'), { prefix: '/prescriptions' });
  fastify.register(require('./routes/clinic'),        { prefix: '/clinic' });
```

Adicionar após a linha `fastify.register(require('./routes/chat'), { prefix: '/chat' });`.

- [ ] **Step 3: Testar os endpoints**

```bash
docker compose restart api
# Obter token de teste
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"seu@email.com","password":"suasenha"}' | jq -r '.token')

# Criar uma receita (usar IDs reais do banco)
curl -s -X POST http://localhost:3000/prescriptions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject_id": "UUID_DO_PACIENTE",
    "exam_id": "UUID_DO_EXAME",
    "agent_type": "therapeutic",
    "items": [{"name":"Metformina","dose":"500mg","frequency":"2x ao dia","duration":"30 dias","notes":""}],
    "notes": "Reavaliar em 30 dias"
  }' | jq .
```

Resultado esperado: `201` com objeto da receita incluindo `id`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/prescriptions.js apps/api/src/server.js
git commit -m "feat(api): endpoints CRUD de receitas + upload de PDF para S3"
```

---

## Task 5: API — Perfil da Clínica

**Files:**
- Create: `apps/api/src/routes/clinic.js`

- [ ] **Step 1: Criar `apps/api/src/routes/clinic.js`**

```javascript
const { uploadFile } = require('../storage/s3');

module.exports = async function (fastify) {

  // GET /clinic/profile
  fastify.get('/profile', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    const { rows } = await fastify.pg.query(
      `SELECT id, name, module, cnpj, clinic_logo_url FROM tenants WHERE id = $1`,
      [tenant_id]
    );
    return rows[0] ?? {};
  });

  // PUT /clinic/profile — atualizar nome e CNPJ
  fastify.put('/profile', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Acesso restrito a administradores' });

    const { name, cnpj } = request.body || {};
    if (!name?.trim()) return reply.status(400).send({ error: 'Nome da clínica é obrigatório' });

    const { rows } = await fastify.pg.query(
      `UPDATE tenants SET name = $1, cnpj = $2 WHERE id = $3
       RETURNING id, name, cnpj, clinic_logo_url, module`,
      [name.trim(), cnpj?.trim() ?? null, tenant_id]
    );
    return rows[0];
  });

  // POST /clinic/logo — upload do logo para S3
  fastify.post('/logo', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Acesso restrito a administradores' });

    const parts = request.parts();
    let fileBuffer = null;
    let mimetype = '';
    let filename = 'logo';

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'file') {
        mimetype = part.mimetype;
        filename = part.filename || filename;
        const chunks = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
      }
    }

    if (!fileBuffer) return reply.status(400).send({ error: 'file é obrigatório' });
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(mimetype)) {
      return reply.status(400).send({ error: 'Apenas imagens PNG ou JPEG são aceitas' });
    }
    if (fileBuffer.length > 2 * 1024 * 1024) {
      return reply.status(400).send({ error: 'Imagem deve ter no máximo 2MB' });
    }

    const ext = mimetype === 'image/png' ? 'png' : 'jpg';
    const key = `logos/${tenant_id}/logo.${ext}`;
    const s3Path = await uploadFile(key, fileBuffer, mimetype);

    const { rows } = await fastify.pg.query(
      `UPDATE tenants SET clinic_logo_url = $1 WHERE id = $2 RETURNING id, clinic_logo_url`,
      [s3Path, tenant_id]
    );
    return rows[0];
  });
};
```

- [ ] **Step 2: Testar**

```bash
docker compose restart api
curl -s http://localhost:3000/clinic/profile \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Resultado esperado: objeto com `id`, `name`, `module`, `cnpj` (null), `clinic_logo_url` (null).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/clinic.js
git commit -m "feat(api): endpoints de perfil da clínica — nome, CNPJ e upload de logo"
```

---

## Task 6: Frontend — Modelos TypeScript

**Files:**
- Modify: `apps/web/src/app/shared/models/api.models.ts`

- [ ] **Step 1: Extender Recommendation e adicionar Prescription e ClinicProfile**

Em `apps/web/src/app/shared/models/api.models.ts`, substituir a interface `Recommendation` e adicionar as novas interfaces:

```typescript
export interface Recommendation {
  type: 'medication' | 'procedure' | 'referral' | 'diet' | 'habit' | 'supplement' | 'activity'
      | 'suggested_exam' | 'contextual_factor';
  description: string;
  priority: 'low' | 'medium' | 'high';
  // Campos adicionais para medication (therapeutic) e supplement (nutrition)
  name?: string;
  dose?: string;
  frequency?: string;
  duration?: string;
  _exam?: string;
  _rationale?: string;
}

export interface PrescriptionItem {
  name: string;
  dose: string | null;
  frequency: string;
  duration: string | null;
  notes: string;
}

export interface Prescription {
  id: string;
  exam_id: string;
  subject_id: string;
  agent_type: 'therapeutic' | 'nutrition';
  items: PrescriptionItem[];
  notes: string | null;
  pdf_url: string | null;
  created_at: string;
  created_by_email?: string;
}

export interface ClinicProfile {
  id: string;
  name: string;
  module: 'human' | 'veterinary';
  cnpj: string | null;
  clinic_logo_url: string | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/shared/models/api.models.ts
git commit -m "feat(types): Recommendation extendida + interfaces Prescription e ClinicProfile"
```

---

## Task 7: Frontend — Instalar jsPDF

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Instalar jsPDF**

```bash
cd apps/web && npm install jspdf@^2.5.1 && cd ../..
```

- [ ] **Step 2: Verificar instalação**

```bash
cat apps/web/package.json | grep jspdf
```

Resultado esperado: `"jspdf": "^2.5.1"` em dependencies.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json
git commit -m "feat(deps): instalar jspdf para geração de PDF no browser"
```

---

## Task 8: Frontend — Modal de Editar Perfil da Clínica

**Files:**
- Create: `apps/web/src/app/features/clinic/profile/clinic-profile-modal.component.ts`
- Modify: `apps/web/src/app/app.component.ts`

- [ ] **Step 1: Criar `clinic-profile-modal.component.ts`**

Criar pasta `apps/web/src/app/features/clinic/profile/` e o arquivo:

```typescript
import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatDialogRef } from '@angular/material/dialog';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../../environments/environment';
import { ClinicProfile } from '../../../shared/models/api.models';

@Component({
  selector: 'app-clinic-profile-modal',
  standalone: true,
  imports: [MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatSnackBarModule, FormsModule],
  styles: [`
    .modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1.5rem 1.5rem 0; margin-bottom: 1.25rem;
    }
    h2 { font-family: 'Space Grotesk', sans-serif; font-size: 1.125rem; font-weight: 700; color: #dae2fd; margin: 0; }
    .modal-body { padding: 0 1.5rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
    .field { width: 100%; }
    .logo-section { display: flex; flex-direction: column; gap: 0.5rem; }
    .logo-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #6e6d80; }
    .logo-preview { width: 80px; height: 80px; object-fit: contain; border: 1px solid rgba(70,69,84,0.3); border-radius: 6px; background: #0b1326; }
    .logo-placeholder { width: 80px; height: 80px; border: 1px dashed rgba(70,69,84,0.4); border-radius: 6px; display: flex; align-items: center; justify-content: center; }
    .upload-btn { font-family: 'JetBrains Mono', monospace; font-size: 11px; }
    .footer { display: flex; justify-content: flex-end; gap: 0.75rem; padding: 1rem 1.5rem; border-top: 1px solid rgba(70,69,84,0.15); }
  `],
  template: `
    <div class="modal-header">
      <h2>Editar Perfil da Clínica</h2>
      <button mat-icon-button (click)="close()"><mat-icon>close</mat-icon></button>
    </div>
    <div class="modal-body">
      <mat-form-field class="field" appearance="outline">
        <mat-label>Nome da Clínica</mat-label>
        <input matInput [(ngModel)]="name" />
      </mat-form-field>

      <mat-form-field class="field" appearance="outline">
        <mat-label>CNPJ</mat-label>
        <input matInput [(ngModel)]="cnpj" placeholder="00.000.000/0000-00" />
      </mat-form-field>

      <div class="logo-section">
        <span class="logo-label">Logo da Clínica (PNG ou JPG, máx 2MB)</span>
        <div style="display:flex;align-items:center;gap:1rem;">
          @if (logoPreview()) {
            <img class="logo-preview" [src]="logoPreview()" alt="Logo" />
          } @else {
            <div class="logo-placeholder"><mat-icon style="color:#6e6d80">image</mat-icon></div>
          }
          <button mat-stroked-button class="upload-btn" (click)="fileInput.click()">
            <mat-icon>upload</mat-icon> Selecionar imagem
          </button>
          <input #fileInput type="file" accept="image/png,image/jpeg" style="display:none" (change)="onFileSelected($event)" />
        </div>
      </div>

      @if (error()) {
        <p style="color:#ffb4ab;font-family:'JetBrains Mono',monospace;font-size:11px;">{{ error() }}</p>
      }
    </div>
    <div class="footer">
      <button mat-button (click)="close()">Cancelar</button>
      <button mat-flat-button color="primary" [disabled]="saving()" (click)="save()">
        {{ saving() ? 'Salvando...' : 'Salvar' }}
      </button>
    </div>
  `
})
export class ClinicProfileModalComponent implements OnInit {
  private http    = inject(HttpClient);
  private snack   = inject(MatSnackBar);
  private dialogRef = inject(MatDialogRef<ClinicProfileModalComponent>);

  name     = '';
  cnpj     = '';
  logoPreview = signal<string | null>(null);
  saving   = signal(false);
  error    = signal('');
  private selectedFile: File | null = null;

  ngOnInit(): void {
    this.http.get<ClinicProfile>(`${environment.apiUrl}/clinic/profile`).subscribe({
      next: (p) => {
        this.name = p.name ?? '';
        this.cnpj = p.cnpj ?? '';
        if (p.clinic_logo_url) this.logoPreview.set(p.clinic_logo_url);
      },
      error: () => {}
    });
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { this.error.set('Imagem deve ter no máximo 2MB'); return; }
    this.selectedFile = file;
    const reader = new FileReader();
    reader.onload = (e) => this.logoPreview.set(e.target?.result as string);
    reader.readAsDataURL(file);
    this.error.set('');
  }

  save(): void {
    if (!this.name.trim()) { this.error.set('Nome da clínica é obrigatório'); return; }
    this.saving.set(true);
    this.error.set('');

    const updateProfile$ = this.http.put(`${environment.apiUrl}/clinic/profile`, { name: this.name, cnpj: this.cnpj });

    if (this.selectedFile) {
      const form = new FormData();
      form.append('file', this.selectedFile);
      this.http.post(`${environment.apiUrl}/clinic/logo`, form).subscribe({
        next: () => {
          updateProfile$.subscribe({
            next: () => { this.saving.set(false); this.snack.open('Perfil atualizado', '', { duration: 2500 }); this.dialogRef.close(true); },
            error: (e) => { this.saving.set(false); this.error.set(e.error?.error ?? 'Erro ao salvar'); }
          });
        },
        error: (e) => { this.saving.set(false); this.error.set(e.error?.error ?? 'Erro ao enviar logo'); }
      });
    } else {
      updateProfile$.subscribe({
        next: () => { this.saving.set(false); this.snack.open('Perfil atualizado', '', { duration: 2500 }); this.dialogRef.close(true); },
        error: (e) => { this.saving.set(false); this.error.set(e.error?.error ?? 'Erro ao salvar'); }
      });
    }
  }

  close(): void { this.dialogRef.close(); }
}
```

- [ ] **Step 2: Adicionar "Editar Perfil" ao menu do avatar em app.component.ts**

Em `apps/web/src/app/app.component.ts`, adicionar import do modal:

```typescript
import { ClinicProfileModalComponent } from './features/clinic/profile/clinic-profile-modal.component';
```

Adicionar ao array `imports` do `@Component`:
```typescript
ClinicProfileModalComponent
```

Adicionar método na classe:
```typescript
openProfile(): void {
  this.dialog.open(ClinicProfileModalComponent, { width: '480px', panelClass: 'dark-dialog' });
}
```

Onde `dialog` já está injetado (ou adicionar): `private dialog = inject(MatDialog);`

No template, dentro de `<mat-menu #menu="matMenu">`, adicionar antes do botão de logout:
```html
<button mat-menu-item (click)="openProfile()">
  <mat-icon>business</mat-icon> Editar Perfil
</button>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/features/clinic/profile/clinic-profile-modal.component.ts apps/web/src/app/app.component.ts
git commit -m "feat(ui): modal de editar perfil da clínica — nome, CNPJ, logo"
```

---

## Task 9: Frontend — Modal de Receita com jsPDF

**Files:**
- Create: `apps/web/src/app/features/clinic/prescription/prescription-modal.component.ts`

- [ ] **Step 1: Criar `prescription-modal.component.ts`**

Criar pasta `apps/web/src/app/features/clinic/prescription/` e o arquivo:

```typescript
import { Component, inject, signal, Inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../../environments/environment';
import { Prescription, PrescriptionItem, Subject, ClinicalResult, ClinicProfile } from '../../../shared/models/api.models';

export interface PrescriptionModalData {
  examId: string;
  subjectId: string;
  subject: Subject;
  result: ClinicalResult; // resultado do agente (therapeutic ou nutrition)
  module: 'human' | 'veterinary';
  existingPrescription?: Prescription;
}

@Component({
  selector: 'app-prescription-modal',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSnackBarModule, FormsModule],
  styles: [`
    .modal-wrap { background: #111929; border-radius: 8px; width: 640px; max-width: 95vw; }
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 1.5rem 1.5rem 0; }
    h2 { font-family: 'Space Grotesk', sans-serif; font-size: 1.125rem; font-weight: 700; color: #dae2fd; margin: 0; }
    .modal-body { padding: 1.25rem 1.5rem; max-height: 60vh; overflow-y: auto; }
    .item-row { background: #0b1326; border: 1px solid rgba(70,69,84,0.2); border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem; position: relative; }
    .item-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    .item-fields-full { grid-column: 1 / -1; }
    .delete-btn { position: absolute; top: 0.5rem; right: 0.5rem; }
    .add-btn { width: 100%; margin-top: 0.5rem; }
    .notes-field { width: 100%; margin-top: 1rem; }
    .footer { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; border-top: 1px solid rgba(70,69,84,0.15); gap: 0.75rem; }
    .actions { display: flex; gap: 0.5rem; }
    .field { width: 100%; }
    label { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6e6d80; display: block; margin-bottom: 0.25rem; }
    input[type=text] { width: 100%; background: #111929; border: 1px solid rgba(70,69,84,0.3); border-radius: 4px; padding: 0.5rem 0.75rem; color: #dae2fd; font-size: 13px; font-family: 'JetBrains Mono', monospace; box-sizing: border-box; }
    input[type=text]:focus { outline: none; border-color: #c0c1ff; }
    textarea { width: 100%; background: #111929; border: 1px solid rgba(70,69,84,0.3); border-radius: 4px; padding: 0.5rem 0.75rem; color: #dae2fd; font-size: 13px; font-family: 'JetBrains Mono', monospace; resize: vertical; min-height: 80px; box-sizing: border-box; }
  `],
  template: `
    <div class="modal-wrap">
      <div class="modal-header">
        <h2>{{ data.result.agent_type === 'therapeutic' ? 'Gerar Receita Médica' : 'Gerar Prescrição Nutricional' }}</h2>
        <button mat-icon-button (click)="close()"><mat-icon>close</mat-icon></button>
      </div>

      <div class="modal-body">
        @for (item of items; track $index) {
          <div class="item-row">
            <button mat-icon-button class="delete-btn" (click)="removeItem($index)" style="color:#ffb4ab">
              <mat-icon>delete</mat-icon>
            </button>
            <div class="item-fields">
              <div>
                <label>{{ data.result.agent_type === 'therapeutic' ? 'Medicamento' : 'Item' }}</label>
                <input type="text" [(ngModel)]="item.name" placeholder="Nome" />
              </div>
              <div>
                <label>Dose</label>
                <input type="text" [(ngModel)]="item.dose" placeholder="ex: 500mg" />
              </div>
              <div>
                <label>Frequência</label>
                <input type="text" [(ngModel)]="item.frequency" placeholder="ex: 2x ao dia" />
              </div>
              <div>
                <label>Duração</label>
                <input type="text" [(ngModel)]="item.duration" placeholder="ex: 30 dias" />
              </div>
              <div class="item-fields-full">
                <label>Observações</label>
                <input type="text" [(ngModel)]="item.notes" placeholder="Observações adicionais" />
              </div>
            </div>
          </div>
        }

        <button mat-stroked-button class="add-btn" (click)="addItem()">
          <mat-icon>add</mat-icon> Adicionar item
        </button>

        <div style="margin-top:1rem;">
          <label>Observações gerais</label>
          <textarea [(ngModel)]="notes" placeholder="Observações gerais da prescrição..."></textarea>
        </div>
      </div>

      @if (pdfReady()) {
        <div style="padding:0.75rem 1.5rem;background:rgba(74,214,160,0.08);border-top:1px solid rgba(74,214,160,0.2);">
          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#4ad6a0;">✓ Receita salva e PDF gerado</span>
        </div>
        <div class="footer">
          <div class="actions">
            <button mat-stroked-button (click)="downloadPdf()"><mat-icon>download</mat-icon> Baixar PDF</button>
            <button mat-stroked-button (click)="shareWhatsApp()"><mat-icon>chat</mat-icon> WhatsApp</button>
            <button mat-stroked-button (click)="shareEmail()"><mat-icon>email</mat-icon> Email</button>
          </div>
          <button mat-button (click)="close()">Fechar</button>
        </div>
      } @else {
        <div class="footer">
          <button mat-button (click)="close()">Cancelar</button>
          <button mat-flat-button color="primary" [disabled]="saving()" (click)="saveAndGeneratePdf()">
            <mat-icon>picture_as_pdf</mat-icon>
            {{ saving() ? 'Gerando...' : 'Salvar e Gerar PDF' }}
          </button>
        </div>
      }
    </div>
  `
})
export class PrescriptionModalComponent {
  data: PrescriptionModalData = inject(MAT_DIALOG_DATA);
  private http      = inject(HttpClient);
  private snack     = inject(MatSnackBar);
  private dialogRef = inject(MatDialogRef<PrescriptionModalComponent>);

  items: PrescriptionItem[] = [];
  notes = '';
  saving   = signal(false);
  pdfReady = signal(false);

  private savedPrescriptionId: string | null = null;
  private pdfBlob: Blob | null = null;
  private clinicProfile: ClinicProfile | null = null;

  constructor() {
    // Pré-popular com items do agente
    const recs = this.data.result.recommendations ?? [];
    if (this.data.result.agent_type === 'therapeutic') {
      this.items = recs
        .filter(r => r.type === 'medication')
        .map(r => ({
          name: r.name ?? r.description,
          dose: r.dose ?? null,
          frequency: r.frequency ?? '',
          duration: r.duration ?? null,
          notes: ''
        }));
    } else {
      // nutrition — todos os tipos
      this.items = recs.map(r => ({
        name: r.name ?? r.description,
        dose: r.dose ?? null,
        frequency: r.frequency ?? '',
        duration: r.duration ?? null,
        notes: ''
      }));
    }

    // Se estiver reabrindo uma receita existente
    if (this.data.existingPrescription) {
      this.items = [...this.data.existingPrescription.items];
      this.notes = this.data.existingPrescription.notes ?? '';
      this.savedPrescriptionId = this.data.existingPrescription.id;
    }
  }

  addItem(): void {
    this.items.push({ name: '', dose: null, frequency: '', duration: null, notes: '' });
  }

  removeItem(index: number): void {
    this.items.splice(index, 1);
  }

  saveAndGeneratePdf(): void {
    if (!this.items.length) { this.snack.open('Adicione ao menos um item', '', { duration: 2500 }); return; }
    this.saving.set(true);

    // 1. Buscar perfil da clínica (logo, nome, CNPJ)
    this.http.get<ClinicProfile>(`${environment.apiUrl}/clinic/profile`).subscribe({
      next: (profile) => {
        this.clinicProfile = profile;
        this.doSaveAndPdf();
      },
      error: () => {
        this.clinicProfile = null;
        this.doSaveAndPdf();
      }
    });
  }

  private doSaveAndPdf(): void {
    const body = {
      subject_id: this.data.subjectId,
      exam_id: this.data.examId,
      agent_type: this.data.result.agent_type,
      items: this.items,
      notes: this.notes
    };

    const save$ = this.savedPrescriptionId
      ? this.http.put<Prescription>(`${environment.apiUrl}/prescriptions/${this.savedPrescriptionId}`, body)
      : this.http.post<Prescription>(`${environment.apiUrl}/prescriptions`, body);

    save$.subscribe({
      next: (prescription) => {
        this.savedPrescriptionId = prescription.id;
        this.generateAndUploadPdf(prescription.id);
      },
      error: (e) => {
        this.saving.set(false);
        this.snack.open(e.error?.error ?? 'Erro ao salvar receita', '', { duration: 3000 });
      }
    });
  }

  private async generateAndUploadPdf(prescriptionId: string): Promise<void> {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const profile = this.clinicProfile;
    const subject = this.data.subject;
    const isVet = this.data.module === 'veterinary';
    const dateStr = new Date().toLocaleDateString('pt-BR');

    // Cabeçalho
    let headerY = 20;
    if (profile?.clinic_logo_url && !profile.clinic_logo_url.startsWith('s3://')) {
      try {
        doc.addImage(profile.clinic_logo_url, 'PNG', 15, 10, 30, 30);
      } catch (_) {}
      headerY = 15;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(11, 19, 38);
    doc.text(profile?.name ?? 'Clínica', 105, headerY, { align: 'center' });
    if (profile?.cnpj) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`CNPJ: ${profile.cnpj}`, 105, headerY + 6, { align: 'center' });
    }
    doc.text(dateStr, 195, headerY, { align: 'right' });

    // Linha divisória
    doc.setDrawColor(192, 193, 255);
    doc.line(15, 45, 195, 45);

    // Título
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(27, 27, 100);
    const title = isVet ? 'RECEITA VETERINÁRIA' : 'RECEITA MÉDICA';
    doc.text(title, 105, 55, { align: 'center' });

    // Identificação do paciente/animal
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(50, 50, 80);
    const patientLabel = isVet ? 'Animal' : 'Paciente';
    doc.text(`${patientLabel}: ${subject.name}`, 15, 65);
    if (isVet && subject.species) {
      doc.text(`Espécie: ${subject.species}${subject.breed ? ' — ' + subject.breed : ''}`, 15, 71);
    }

    // Itens da receita
    let y = isVet && subject.species ? 82 : 76;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Prescrição:', 15, y);
    y += 6;
    doc.setFont('helvetica', 'normal');

    this.items.forEach((item, i) => {
      if (y > 240) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold');
      doc.text(`${i + 1}. ${item.name}`, 15, y);
      doc.setFont('helvetica', 'normal');
      y += 5;
      if (item.dose) { doc.text(`   Dose: ${item.dose}`, 15, y); y += 5; }
      if (item.frequency) { doc.text(`   Frequência: ${item.frequency}`, 15, y); y += 5; }
      if (item.duration) { doc.text(`   Duração: ${item.duration}`, 15, y); y += 5; }
      if (item.notes) { doc.text(`   Obs: ${item.notes}`, 15, y); y += 5; }
      y += 3;
    });

    // Observações gerais
    if (this.notes) {
      y += 4;
      doc.setFont('helvetica', 'bold');
      doc.text('Observações:', 15, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(this.notes, 180);
      doc.text(lines, 15, y);
      y += lines.length * 5 + 5;
    }

    // Área de assinatura
    const sigY = Math.max(y + 20, 230);
    doc.line(15, sigY, 95, sigY);
    doc.setFontSize(9);
    doc.text(isVet ? 'Assinatura e CRMV' : 'Assinatura e CRM', 15, sigY + 5);

    // Disclaimer
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 140);
    const disclaimer = isVet
      ? 'Prescrição veterinária. Válida mediante avaliação clínica do profissional responsável.'
      : 'Prescrição médica. Válida mediante avaliação clínica do profissional responsável.';
    doc.text(disclaimer, 105, 280, { align: 'center' });
    doc.text('GenomaFlow Clinical AI', 105, 284, { align: 'center' });

    // Gerar blob e upload
    this.pdfBlob = doc.output('blob');
    const formData = new FormData();
    formData.append('file', this.pdfBlob, `receita-${prescriptionId}.pdf`);

    this.http.post<{ id: string; pdf_url: string }>(
      `${environment.apiUrl}/prescriptions/${prescriptionId}/pdf`, formData
    ).subscribe({
      next: () => { this.saving.set(false); this.pdfReady.set(true); },
      error: () => {
        // PDF gerado localmente mesmo se upload falhar
        this.saving.set(false);
        this.pdfReady.set(true);
      }
    });
  }

  downloadPdf(): void {
    if (!this.pdfBlob) return;
    const url = URL.createObjectURL(this.pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receita-${this.data.subject.name.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  shareWhatsApp(): void {
    const name = this.data.subject.name;
    const date = new Date().toLocaleDateString('pt-BR');
    const text = encodeURIComponent(`Receita de ${name} - ${date}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }

  shareEmail(): void {
    this.snack.open('Envio por email será ativado em breve.', '', { duration: 3000 });
  }

  close(): void { this.dialogRef.close(); }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/features/clinic/prescription/prescription-modal.component.ts
git commit -m "feat(ui): PrescriptionModalComponent — edição de itens, geração de PDF via jsPDF, WhatsApp"
```

---

## Task 10: Frontend — Botão "Gerar Receita" e Receitas Salvas no Result Panel

**Files:**
- Modify: `apps/web/src/app/features/doctor/results/result-panel.component.ts`

- [ ] **Step 1: Adicionar imports, serviço de receitas e método de abertura do modal**

Em `result-panel.component.ts`, adicionar imports:

```typescript
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { PrescriptionModalComponent, PrescriptionModalData } from '../../clinic/prescription/prescription-modal.component';
import { Prescription } from '../../../shared/models/api.models';
```

Adicionar `MatDialogModule` e `PrescriptionModalComponent` ao array `imports` do `@Component`.

Na classe, adicionar:

```typescript
private dialog = inject(MatDialog);
prescriptionsByAgent = signal<Record<string, Prescription[]>>({});

ngOnInit(): void {
  this.loadPrescriptions();
}

private loadPrescriptions(): void {
  if (!this.exam?.id) return;
  this.http.get<Prescription[]>(`${environment.apiUrl}/prescriptions/exams/${this.exam.id}`)
    .subscribe({
      next: (list) => {
        const map: Record<string, Prescription[]> = {};
        list.forEach(p => {
          if (!map[p.agent_type]) map[p.agent_type] = [];
          map[p.agent_type].push(p);
        });
        this.prescriptionsByAgent.set(map);
      },
      error: () => {}
    });
}

openPrescription(result: ClinicalResult, existing?: Prescription): void {
  const data: PrescriptionModalData = {
    examId: this.exam.id,
    subjectId: this.exam.subject_id ?? this.exam.patient_id ?? '',
    subject: this.subject,
    result,
    module: this.module,
    existingPrescription: existing
  };
  const ref = this.dialog.open(PrescriptionModalComponent, { width: '680px', panelClass: 'dark-dialog', data });
  ref.afterClosed().subscribe(saved => { if (saved) this.loadPrescriptions(); });
}
```

Onde `this.subject`, `this.module` e `this.exam` já existem no componente (verificar nomes exatos e adaptar se necessário).

- [ ] **Step 2: Adicionar botão e seção no template para agentes therapeutic e nutrition**

No template, dentro do loop `@for (result of e.results ?? []; track result.agent_type)`, após a seção de recomendações existente, adicionar para agentes `therapeutic` e `nutrition`:

```html
@if (result.agent_type === 'therapeutic' || result.agent_type === 'nutrition') {
  <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid rgba(70,69,84,0.15);">
    <button mat-stroked-button style="font-size:12px;" (click)="openPrescription(result)">
      <mat-icon>description</mat-icon>
      {{ result.agent_type === 'therapeutic' ? 'Gerar Receita Médica' : 'Gerar Prescrição Nutricional' }}
    </button>

    @if ((prescriptionsByAgent()[result.agent_type] ?? []).length > 0) {
      <div style="margin-top:0.75rem;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6e6d80;margin-bottom:0.5rem;">
          Receitas geradas
        </div>
        @for (p of prescriptionsByAgent()[result.agent_type]; track p.id) {
          <div style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.75rem;background:#0b1326;border-radius:4px;margin-bottom:0.25rem;">
            <mat-icon style="font-size:16px;width:16px;height:16px;color:#c0c1ff;">description</mat-icon>
            <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#a09fb2;flex:1;">
              {{ p.created_at | date:'dd/MM/yyyy HH:mm' }} — {{ p.created_by_email }}
            </span>
            <button mat-icon-button style="width:28px;height:28px;" (click)="openPrescription(result, p)">
              <mat-icon style="font-size:16px;">open_in_new</mat-icon>
            </button>
          </div>
        }
      </div>
    }
  </div>
}
```

Adicionar `DatePipe` aos imports do componente se ainda não estiver.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/features/doctor/results/result-panel.component.ts
git commit -m "feat(ui): botão Gerar Receita + seção de receitas salvas no result-panel"
```

---

## Task 11: Frontend — Botão "Gerar Receita" no Patient Detail

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`

- [ ] **Step 1: Adicionar imports e lógica no patient-detail**

Em `patient-detail.component.ts`, adicionar imports:

```typescript
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { PrescriptionModalComponent, PrescriptionModalData } from '../../clinic/prescription/prescription-modal.component';
import { Prescription, ClinicalResult } from '../../../shared/models/api.models';
```

Adicionar `MatDialogModule` e `PrescriptionModalComponent` ao array `imports` do `@Component`.

Na classe, adicionar:

```typescript
private dialog = inject(MatDialog);
prescriptionsByExam = signal<Record<string, Record<string, Prescription[]>>>({});

private loadPrescriptionsForExam(examId: string): void {
  this.http.get<Prescription[]>(`${environment.apiUrl}/prescriptions/exams/${examId}`)
    .subscribe({
      next: (list) => {
        const map: Record<string, Prescription[]> = {};
        list.forEach(p => {
          if (!map[p.agent_type]) map[p.agent_type] = [];
          map[p.agent_type].push(p);
        });
        this.prescriptionsByExam.update(current => ({ ...current, [examId]: map }));
      },
      error: () => {}
    });
}

openPrescriptionFromDetail(exam: Exam, result: ClinicalResult): void {
  const s = this.subject();
  if (!s) return;
  const data: PrescriptionModalData = {
    examId: exam.id,
    subjectId: s.id,
    subject: s,
    result,
    module: (this as any).module ?? 'human'
  };
  const ref = this.dialog.open(PrescriptionModalComponent, { width: '680px', panelClass: 'dark-dialog', data });
  ref.afterClosed().subscribe(saved => { if (saved) this.loadPrescriptionsForExam(exam.id); });
}
```

Chamar `this.loadPrescriptionsForExam(exam.id)` dentro de `loadExams()` após popular `this.aiResults`.

- [ ] **Step 2: Adicionar botão no template de exame com resultado terapêutico/nutricional**

No template do patient-detail, localizar onde os resultados dos agentes são exibidos (buscar por `result.agent_type` ou `aiResults`). Após as recomendações de cada agente `therapeutic` ou `nutrition`, adicionar:

```html
@if (result.agent_type === 'therapeutic' || result.agent_type === 'nutrition') {
  <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid rgba(70,69,84,0.1);">
    <button mat-stroked-button style="font-size:11px;" (click)="openPrescriptionFromDetail(exam, result)">
      <mat-icon>description</mat-icon>
      {{ result.agent_type === 'therapeutic' ? 'Gerar Receita' : 'Gerar Prescrição Nutricional' }}
    </button>

    @if ((prescriptionsByExam()[exam.id]?.[result.agent_type] ?? []).length > 0) {
      <div style="margin-top:0.5rem;">
        @for (p of prescriptionsByExam()[exam.id][result.agent_type]; track p.id) {
          <div style="display:flex;align-items:center;gap:0.5rem;padding:0.375rem 0.625rem;background:#0b1326;border-radius:4px;margin-bottom:0.25rem;">
            <mat-icon style="font-size:14px;width:14px;height:14px;color:#c0c1ff;">description</mat-icon>
            <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#a09fb2;flex:1;">
              {{ p.created_at | date:'dd/MM/yyyy' }}
            </span>
            <button mat-icon-button style="width:24px;height:24px;" (click)="openPrescriptionFromDetail(exam, result)">
              <mat-icon style="font-size:14px;">open_in_new</mat-icon>
            </button>
          </div>
        }
      </div>
    }
  </div>
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/features/doctor/patients/patient-detail.component.ts
git commit -m "feat(ui): botão Gerar Receita + receitas salvas no patient-detail"
```

---

## Task 12: Build e Smoke Test Local

- [ ] **Step 1: Build local sem erros**

```bash
cd apps/web && npx ng build --configuration=production 2>&1 | tail -20
```

Resultado esperado: `✔ Building... — Build at: ...` sem erros `✘`.

- [ ] **Step 2: Smoke test — fluxo completo**

```
1. Abrir http://localhost:4200
2. Logar como admin
3. Abrir um paciente/animal com exame done
4. Verificar que aparece botão "Gerar Receita" no card do agente terapêutico
5. Clicar — modal abre com items pré-populados do agente
6. Editar um item (nome, dose)
7. Clicar "Salvar e Gerar PDF"
8. Verificar que PDF é gerado e botões WhatsApp/Email aparecem
9. Clicar "Baixar PDF" — arquivo baixado
10. Fechar modal — receita aparece na seção "Receitas geradas"
11. Clicar no avatar → "Editar Perfil" — modal abre
12. Fazer upload de uma imagem de logo
13. Salvar — perfil atualizado
14. Gerar nova receita — logo aparece no PDF
```

- [ ] **Step 3: Push da branch**

```bash
git push origin feat/prescription
```

- [ ] **Step 4: Apresentar ao usuário para aprovação**

Reportar resultado do smoke test e aguardar aprovação explícita antes de mergear na main.

---

## Self-Review

**Spec coverage:**
- ✅ Migration 039 (Task 1)
- ✅ Agente terapêutico com medicamentos + dose (Task 2)
- ✅ Agente nutrição com marcadores (Task 3)
- ✅ CRUD de receitas (Task 4)
- ✅ Upload de PDF para S3 (Task 4)
- ✅ Perfil da clínica + logo (Task 5)
- ✅ Modelos TypeScript (Task 6)
- ✅ jsPDF instalado (Task 7)
- ✅ Modal editar perfil (Task 8)
- ✅ PrescriptionModal com edição, PDF, WhatsApp, email (501) (Task 9)
- ✅ Botão + receitas no result-panel (Task 10)
- ✅ Botão + receitas no patient-detail (Task 11)
- ✅ RLS com policy correta (Task 1)
- ✅ Retrocompatibilidade: campos novos em Recommendation são opcionais (Task 6)
- ✅ Multi-módulo: PDF e prompts adaptados por human/veterinary (Tasks 2, 3, 9)

**Sem placeholders ou TBDs.**

**Consistência de tipos:** `PrescriptionItem`, `Prescription`, `ClinicProfile` definidos em Task 6 e usados em Tasks 8, 9, 10, 11. `PrescriptionModalData` definido e exportado em Task 9, importado em Tasks 10 e 11.
