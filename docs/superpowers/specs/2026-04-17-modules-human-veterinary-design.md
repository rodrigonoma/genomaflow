# GenomaFlow — Módulos Clínica Humana e Veterinária

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar suporte a clínicas veterinárias através de um sistema de módulos configurado no cadastro do tenant, adaptando banco de dados, pipeline de IA, RAG e frontend sem quebrar o fluxo humano existente.

**Architecture:** O módulo é fixo por tenant (definido no onboarding). A tabela `patients` é renomeada para `subjects` e ganha campos condicionais (`species`, `owner_cpf_hash`, `subject_type`). O worker executa em duas fases: Fase 1 — agentes de especialidade (metabolic, cardiovascular, hematology, small_animals, etc.) analisam o exame; Fase 2 — agentes de síntese (`therapeutic`, `nutrition`) recebem os outputs da Fase 1 + texto bruto e geram recomendações de tratamento e nutrição/hábitos. Ambas as fases são selecionáveis por tenant. O frontend adapta labels, formulários e lookup de sujeito com base no módulo do tenant autenticado.

**Tech Stack:** PostgreSQL 15 (migrations), Node.js/Fastify (backend), BullMQ worker, Anthropic SDK (novos agentes), Angular 17+ (frontend), RAG com pgvector.

---

## 1. Banco de Dados

### 1.1 Migration 011 — módulo no tenant

```sql
ALTER TABLE tenants
  ADD COLUMN module TEXT NOT NULL DEFAULT 'human'
    CHECK (module IN ('human', 'veterinary'));
```

### 1.2 Migration 012 — patients → subjects

```sql
-- Renomear tabela
ALTER TABLE patients RENAME TO subjects;

-- Novos campos
ALTER TABLE subjects
  ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'human'
    CHECK (subject_type IN ('human', 'animal')),
  ADD COLUMN species       TEXT,          -- 'dog' | 'cat' | 'equine' | 'bovine' — null para humanos
  ADD COLUMN owner_cpf_hash TEXT;         -- CPF hash do tutor — null para humanos

-- Renomear FK em exams
ALTER TABLE exams RENAME COLUMN patient_id TO subject_id;
```

**Regras de validação (nível de aplicação, não constraint SQL):**
- `module=human` → `cpf_hash` + `birth_date` obrigatórios; `species` e `owner_cpf_hash` proibidos
- `module=veterinary` → `species` + `owner_cpf_hash` obrigatórios; `cpf_hash` e `birth_date` ignorados

**Campos existentes que permanecem:**
- `name` — nome do paciente humano ou nome do animal
- `sex` — `M | F | other` (humano) ou `M | F` (animal)
- `cpf_hash` — CPF do paciente humano (null para animais)
- `birth_date` — data de nascimento humana (null para animais)

### 1.3 Migration 013 — RAG documents por módulo

```sql
ALTER TABLE rag_documents
  ADD COLUMN module  TEXT NOT NULL DEFAULT 'human'
    CHECK (module IN ('human', 'veterinary', 'both')),
  ADD COLUMN species TEXT; -- null = aplica a todas as espécies do módulo vet
```

**Índice de suporte:**
```sql
CREATE INDEX ON rag_documents (module, species);
```

---

## 2. Backend

### 2.1 Tenant — campo `module` no retorno do login

O JWT payload e o endpoint `/auth/login` passam a incluir `module` do tenant. O frontend usa esse dado para adaptar toda a UI.

### 2.2 Rota `/patients` (alias para `/subjects`)

- Path mantido como `/patients` para não quebrar o frontend existente
- Internamente opera na tabela `subjects`
- **POST /patients** — valida campos conforme `module` do tenant autenticado
- **GET /patients** — retorna `subjects` do tenant filtrados por `subject_type` coerente com o módulo
- **GET /patients/search** *(novo)* — busca por `owner_cpf_hash` para lookup no upload veterinário:
  ```
  GET /patients/search?owner_cpf_hash=<hash>
  → [{ id, name, species, sex }]
  ```
  Nunca faz match automático — retorna lista para seleção explícita.

### 2.3 Worker — pipeline em duas fases

O processor busca as especialidades configuradas do tenant e executa em duas fases:

```js
const specialties = await getAgentTypes(tenantId);

// Fase 1: agentes de especialidade (rodam em sequência, debitam 1 crédito cada)
const phase1Agents = specialties
  .filter(t => PHASE1_AGENTS.includes(t))
  .map(t => AGENT_MAP[t]);
  // PHASE1_AGENTS: ['metabolic','cardiovascular','hematology','small_animals','equine','bovine']

const specialtyResults = [];
for (const agent of phase1Agents) {
  const result = await agent(ctx);
  specialtyResults.push(result);
  await persistResult(result);
  await debitCredit(tenantId, examId, agent.type);
}

// Fase 2: agentes de síntese (rodam em paralelo após Fase 1, debitam 1 crédito cada)
const phase2Agents = specialties
  .filter(t => PHASE2_AGENTS.includes(t))
  .map(t => AGENT_MAP[t]);
  // PHASE2_AGENTS: ['therapeutic','nutrition']

const ctxWithResults = { ...ctx, specialtyResults };
await Promise.all(phase2Agents.map(async agent => {
  const result = await agent(ctxWithResults);
  await persistResult(result);
  await debitCredit(tenantId, examId, agent.type);
}));
```

**Contexto dos agentes de Fase 2:**
- `ctx.examText` — texto bruto do exame (mesmo da Fase 1)
- `ctx.specialtyResults` — array de outputs dos agentes da Fase 1
- `ctx.subject` — dados do paciente/animal (espécie, sexo, etc.)
- `ctx.module` — `'human'` ou `'veterinary'`

### 2.4 RAG — filtro por módulo e espécie

```sql
SELECT * FROM rag_documents
WHERE module IN ($module, 'both')
  AND (species IS NULL OR species = $species)
ORDER BY embedding <=> $queryEmbedding
LIMIT 5;
```

---

## 3. Agentes de IA Veterinários

Três novos agentes, estrutura idêntica aos agentes humanos existentes.

### Disclaimer padrão (todos os agentes vet)
```
Esta análise é um suporte à decisão clínica veterinária e não substitui avaliação do médico veterinário.
```

### Output JSON — mesmo contrato dos agentes humanos
```json
{
  "interpretation": "<em português>",
  "risk_scores": { "<domain>": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "<texto>"
}
```

### 3.1 `small_animals_agent` — cão e gato
- Cobre: hemograma, bioquímica sérica, perfil tireoidiano, urinálise
- `ctx.patient.species` distingue cão vs gato nos valores de referência
- RAG seed inicial: WSAVA Global Nutrition Guidelines, WSAVA vaccination guidelines, literatura de clínica de pequenos animais

### 3.2 `equine_agent` — equinos
- Cobre: hemograma equino, perfil hepático, CK/AST (muscular), eletrólitos
- RAG seed inicial: AAEP (American Association of Equine Practitioners) guidelines

### 3.3 `bovine_agent` — bovinos
- Cobre: perfil metabólico, saúde do rebanho, BHB (cetose), NEFA
- RAG seed inicial: literatura de medicina de produção animal (AABP guidelines)

### Princípio operacional de curadoria
Os seeds de guidelines veterinárias devem ser revisados periodicamente conforme novas publicações das sociedades de referência (WSAVA, AAEP, AABP). A atualização das bases RAG é responsabilidade operacional contínua do GenomaFlow — não é só código, é curadoria de conhecimento clínico.

---

## 3.B Agentes de Síntese (Fase 2) — Humano e Veterinário

Dois novos agentes cross-módulo, selecionáveis por tenant. Rodam **após** todos os agentes de Fase 1, recebendo os outputs das especialidades + texto bruto do exame. São agnósticos ao módulo — o system prompt adapta o contexto com base em `module` e `species`.

### Disclaimer padrão (agentes de síntese)
```
As sugestões apresentadas são de suporte à decisão clínica e devem ser avaliadas e prescritas
pelo profissional de saúde responsável. Não substituem consulta médica ou veterinária.
```

### Output JSON — agentes de síntese
```json
{
  "interpretation": "<resumo das recomendações em português>",
  "recommendations": [
    { "type": "<medication|procedure|habit|diet|supplement>", "description": "<texto>", "priority": "<low|medium|high>" }
  ],
  "risk_scores": { "<domain>": "<LOW|MEDIUM|HIGH|CRITICAL>" },
  "alerts": [{ "marker": "<name>", "value": "<value>", "severity": "<low|medium|high|critical>" }],
  "disclaimer": "<texto>"
}
```

### 3.B.1 `therapeutic_agent` — recomendações terapêuticas

**Função:** Com base nos achados dos agentes de especialidade e nos valores brutos do exame, sugere condutas terapêuticas (medicamentos, procedimentos, encaminhamentos).

**Humano:** classes de medicamentos indicadas, ajuste de dose quando relevante, indicação de encaminhamento a especialista.

**Veterinário:** protocolos terapêuticos veterinários, medicamentos indicados por espécie, alertas de contra-indicações espécie-específicas.

**RAG seed:**
- Humano: diretrizes terapêuticas SBC, ADA, SBH, Ministério da Saúde
- Vet: WSAVA treatment guidelines, formulário veterinário por espécie

**Não inclui:** prescrição nominal de medicamentos com dose exata — sempre recomendação de classe/protocolo, decisão final do profissional.

### 3.B.2 `nutrition_agent` — nutrição, hábitos e estilo de vida

**Função:** Com base nos achados clínicos, sugere intervenções nutricionais, alimentares e de estilo de vida (humano) ou manejo alimentar e ambiental (veterinário).

**Humano:** plano alimentar indicado, grupos alimentares a restringir/ampliar, hábitos (atividade física, cessação tabagismo, qualidade do sono, hidratação).

**Veterinário:** dieta indicada por espécie e condição clínica, frequência de alimentação, enriquecimento ambiental, restrições alimentares espécie-específicas.

**RAG seed:**
- Humano: guias alimentares do Ministério da Saúde, SBEM, SBC — nutrição clínica
- Vet: WSAVA Nutritional Assessment Guidelines, literatura de nutrição veterinária por espécie

---

## 4. Frontend

### 4.1 Módulo disponível globalmente

O `module` do tenant é incluído no response de login e exposto via `AuthService.currentUser$`. Todos os componentes que precisam adaptar comportamento leem `user.module`.

### 4.2 Onboarding — seleção de módulo

Nova tela no fluxo de cadastro de tenant com dois cards:
- **Clínica Humana** — medicina humana
- **Clínica Veterinária** — medicina veterinária

Seleção é permanente — não pode ser alterada após o cadastro.

### 4.3 Formulário de sujeito (condicional por módulo)

| Campo | `module=human` | `module=veterinary` |
|---|---|---|
| Label da seção | Paciente | Animal |
| Nome | Nome completo | Nome do animal |
| CPF | CPF do paciente (obrigatório) | — |
| Data de nascimento | Obrigatório | — |
| Sexo | M / F / Outro | M / F |
| Espécie | — | Select obrigatório: Cão, Gato, Equino, Bovino |
| CPF do tutor | — | CPF do tutor (obrigatório) |

### 4.4 Lookup de animal no upload (lab_tech — módulo vet)

Fluxo no upload de exame veterinário:
1. Lab_tech informa CPF do tutor
2. Sistema consulta `GET /patients/search?owner_cpf_hash=<hash>`
3. Se encontrar animais: exibe lista `"Rex — Cão"`, `"Mia — Gata"` para seleção explícita
4. Lab_tech seleciona o animal correto **ou** clica em "Cadastrar novo animal"
5. Nunca há match automático silencioso — seleção sempre é manual

**Prevenção de confusão:** o card de seleção do animal exibe `Nome · Espécie · Tutor: CPF parcial (***XXX-XX)` para confirmação visual antes de associar o exame.

### 4.5 Histórico e comparação de exames

Disponível para ambos os módulos na tela de resultado (`/doctor/results/:examId`):

- Painel lateral "Histórico" lista exames anteriores do mesmo `subject_id`
- Cada item: data + severidade + agentes executados
- Doctor pode abrir qualquer exame anterior para comparação lado a lado
- Header do painel sempre exibe identificação completa do sujeito:
  - Humano: `Nome · CPF parcial`
  - Animal: `Nome do animal · Espécie · Tutor: CPF parcial`
- Identificação visível em todos os momentos para evitar confusão entre animais do mesmo tutor

### 4.6 Adaptações de labels globais (módulo vet)

| Contexto | Humano | Veterinário |
|---|---|---|
| Sidebar nav | Pacientes | Animais |
| Fila de revisão | "Paciente" | "Animal" |
| Disclaimer no laudo | "...não substitui avaliação médica profissional" | "...não substitui avaliação do médico veterinário" |

---

## 5. Segurança e LGPD

- `owner_cpf_hash` é armazenado como hash (bcrypt/SHA-256) — nunca o CPF em texto puro
- Dados do tutor seguem as mesmas regras de LGPD aplicadas aos pacientes humanos
- RLS continua isolando dados por `tenant_id` — válido para ambos os módulos
- Dados de animais não são dados pessoais do titular (são do animal), mas o `owner_cpf_hash` é dado pessoal do tutor e deve ser tratado como tal

---

## 6. Fora de Escopo (MVP)

- Módulo "ambos" (mesma clínica atendendo humanos e animais) — fase futura
- Espécies além de cão, gato, equino e bovino — extensível via seed + novo agente
- Integração HIS/veterinary software — roadmap
- Portal do tutor para upload — roadmap
