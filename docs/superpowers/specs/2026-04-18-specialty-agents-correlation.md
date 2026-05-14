# Especialidade Médica + Seleção de Agentes + Correlação Clínica — Design Spec

**Goal:** Quatro melhorias relacionadas ao pipeline de processamento de exames: (1) cadastro obrigatório de especialidade médica, (2) seleção de agentes de especialidade no momento do upload baseada na especialidade configurada, (3) novo agente "Correlação Clínica" que sintetiza todos os resultados de um exame com foco em fatores subjacentes e exames complementares sugeridos, (4) campos clínicos contextuais no perfil do paciente e no upload de exame para enriquecer a análise da IA.

---

## Contexto

Módulo humano sempre rodava 3 agentes de especialidade (metabolic + cardiovascular + hematology) independente da especialidade do médico. Isso gera custo desnecessário e ruído clínico. A solução preserva o valor de análise multi-especialidade permitindo controle explícito, sem quebrar o fluxo de trabalho.

Módulo veterinário: não afetado. Agente já é determinado pela espécie.

---

## Parte 1 — Especialidade do Médico

### Onde é armazenada

Campo `specialty VARCHAR(64)` na tabela `app_users` (ou `users`, conforme a tabela que guarda email/role do usuário autenticado). Migration `021_user_specialty.sql`.

### Especialidades disponíveis (módulo human)

```
endocrinologia · cardiologia · hematologia · clínica_geral · nutrição
nefrologia · hepatologia · gastroenterologia · ginecologia · urologia
pediatria · neurologia · ortopedia · pneumologia · reumatologia
oncologia · infectologia · dermatologia · psiquiatria · geriatria
medicina_esporte
```

### Obrigatoriedade

- **Onboarding:** após cadastro/pagamento, tela de boas-vindas exige seleção de especialidade antes de entrar no dashboard. Sem seleção não avança.
- **App sem especialidade cadastrada:** guard redireciona para `/onboarding/specialty` antes de qualquer outra rota.
- **Alterar especialidade:** menu do usuário (topo direito) → "Minha especialidade" → modal com select + botão salvar.

---

## Parte 2 — Mapeamento Especialidade → Agentes Phase 1

```
clínica_geral      → metabolic + cardiovascular + hematology
geriatria          → metabolic + cardiovascular + hematology
medicina_esporte   → metabolic + cardiovascular + hematology

endocrinologia     → metabolic
nutrição           → metabolic
dermatologia       → metabolic
psiquiatria        → metabolic

cardiologia        → cardiovascular
pneumologia        → cardiovascular + hematology

hematologia        → hematology
oncologia          → hematology
infectologia       → hematology

pediatria          → metabolic + hematology
neurologia         → metabolic + hematology
nefrologia         → metabolic + hematology
hepatologia        → metabolic + hematology
gastroenterologia  → metabolic + hematology
ginecologia        → metabolic + hematology
urologia           → metabolic + hematology
ortopedia          → metabolic + hematology
reumatologia       → metabolic + hematology
```

Agentes Phase 2 (therapeutic, nutrition, clinical_correlation) sempre rodam após Phase 1, independente da especialidade.

---

## Parte 3 — UI de Upload com Seleção de Agentes

### Fluxo atual
PDF selecionado → upload imediato → processamento com todos os agentes.

### Novo fluxo
PDF selecionado → painel de confirmação → médico ajusta agentes → confirma → upload + processamento.

### Painel de confirmação (inline no perfil do paciente, aba Exames)

Aparece abaixo do botão de upload após o médico selecionar o arquivo:

```
Arquivo: exame_joao_17042026.pdf

Queixa principal / motivo do exame  (opcional)
[ campo de texto — ex: fadiga persistente há 3 meses ]

Sintomas atuais  (opcional)
[ campo de texto — ex: perda de peso, poliúria, visão turva ]

Agentes de análise:
  ☑ Metabólico
  ☐ Cardiovascular
  ☐ Hematologia

  ✦ Correlação Clínica · Síntese Terapêutica · Nutrição (sempre incluídos)

[ Cancelar ]   [ Enviar para análise ]
```

- Queixa principal e sintomas são opcionais — não bloqueiam o envio
- Checkboxes pré-selecionados conforme a especialidade do médico
- Mínimo 1 agente Phase 1 obrigatório — botão "Enviar" desabilitado se todos desmarcados
- "Cancelar" limpa o arquivo selecionado
- "Enviar para análise" dispara o upload + enfileira o job

### Payload do job (adição ao existente)

```json
{
  "exam_id": "...",
  "tenant_id": "...",
  "file_path": "...",
  "selected_agents": ["metabolic", "hematology"],
  "chief_complaint": "fadiga persistente há 3 meses",
  "current_symptoms": "perda de peso, poliúria, visão turva"
}
```

O worker usa `selected_agents` para filtrar `PHASE1_AGENTS.human`. Se `selected_agents` estiver ausente (jobs antigos ou integração direta), assume todos os agentes — backwards compatible. `chief_complaint` e `current_symptoms` são opcionais — se ausentes, os agentes recebem string vazia.

---

## Parte 4 — Campos Clínicos Contextuais do Paciente

### Novos campos no perfil do paciente (persistentes)

Migration `022_subject_clinical_context.sql` — colunas adicionais na tabela `subjects`:

| Coluna | Tipo | Descrição |
|---|---|---|
| `medications` | TEXT | Medicamentos em uso (texto livre) |
| `smoking` | VARCHAR(16) | `não_fumante` · `ex_fumante` · `fumante` |
| `alcohol` | VARCHAR(16) | `não` · `social` · `abusivo` |
| `diet_type` | VARCHAR(32) | `onívoro` · `vegetariano` · `vegano` · `outro` |
| `physical_activity` | VARCHAR(16) | `sedentário` · `moderado` · `atleta` |
| `family_history` | TEXT | Histórico familiar relevante (texto livre) |

### UI — aba Perfil do paciente

Seção adicional "Contexto Clínico" na aba Perfil, abaixo dos campos existentes:

```
CONTEXTO CLÍNICO

Medicamentos em uso
[ campo de texto — ex: metformina 850mg, atorvastatina 20mg ]

Tabagismo       [ Não fumante ▼ ]
Etilismo        [ Não ▼ ]
Tipo de dieta   [ Onívoro ▼ ]
Atividade física [ Sedentário ▼ ]

Histórico familiar relevante
[ campo de texto — ex: pai com DM2, mãe com cardiopatia ]
```

Todos os campos opcionais. Salvos via `PUT /patients/:id` junto com os demais campos do perfil.

### Como são usados na análise

O worker já busca o perfil do paciente (`subjects`) antes de processar. Com os novos campos, o contexto enviado a cada agente passa a incluir:

```js
patient: {
  sex, age, weight, height, allergies, comorbidities,
  // novos:
  medications, smoking, alcohol, diet_type, physical_activity, family_history
}
```

Os prompts dos agentes recebem esse contexto no bloco `Patient context`, permitindo que a IA interprete valores laboratoriais considerando, por exemplo, que o paciente usa metformina (B12 baixo esperado) ou é vegano (B12 e ferro heme baixos esperados).

---

## Parte 5 — Agente "Correlação Clínica" (clinical_correlation)

### Posição no pipeline

Phase 2 — roda uma vez por exame após todos os agentes Phase 1 concluírem. Recebe:
- Todos os resultados de Phase 1 do exame atual
- Perfil completo do paciente (incluindo campos clínicos contextuais)
- Queixa principal e sintomas atuais informados no upload (se presentes)

### Output JSON

```json
{
  "interpretation": "string — síntese narrativa dos achados cruzados",
  "suggested_exams": [
    {
      "exam": "Nome do exame complementar sugerido",
      "rationale": "Justificativa clínica baseada nos marcadores encontrados"
    }
  ],
  "contextual_factors": [
    "string — observações sobre contexto clínico que pode influenciar os resultados"
  ],
  "alerts": [
    { "marker": "string", "value": "string", "severity": "low|medium|high|critical" }
  ],
  "risk_scores": { "clinical_complexity": "LOW|MEDIUM|HIGH|CRITICAL" },
  "disclaimer": "string"
}
```

### Regras de linguagem do prompt (juridicamente seguras)

**Permitido:**
- "A combinação de [X] e [Y] é consistente com..."
- "Os marcadores sugerem investigar..."
- "Pode ser relevante avaliar..."
- "É frequentemente associado a..."
- "Merece atenção clínica adicional"
- "Considerar solicitação de [exame]"

**Proibido:**
- "Indica", "confirma", "diagnóstico de", "o paciente tem"
- Nomear doenças estigmatizantes diretamente (DSTs, HIV, etc.) — usar "infecção de transmissão sexual", "infecção viral", "condição imunológica"
- Afirmações categóricas sem qualificador de probabilidade

### Exibição na UI

Card adicional nas Análises IA com `agent_type = 'clinical_correlation'`, label **"Correlação Clínica"** via `AGENT_LABELS`, exibido após os cards de especialidade. Inclui:
- Seção "EXAMES SUGERIDOS" com lista de `suggested_exams`
- Seção "FATORES CONTEXTUAIS" com `contextual_factors`
- Seção padrão de alertas e interpretação

---

## Fora de escopo

- Módulo veterinário (não afetado)
- Histórico de especialidades por usuário
- Especialidade diferente por paciente (é do médico, não do paciente)
- Campos de estilo de vida para pacientes veterinários
- Cirurgias anteriores e histórico de viagens
- Interface de administração de especialidades (o médico gerencia o próprio perfil)
- Campos obrigatórios de contexto clínico — todos são opcionais exceto especialidade do médico
