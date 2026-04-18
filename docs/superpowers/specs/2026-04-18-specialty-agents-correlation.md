# Especialidade Médica + Seleção de Agentes + Correlação Clínica — Design Spec

**Goal:** Três melhorias relacionadas ao pipeline de processamento de exames: (1) cadastro obrigatório de especialidade médica, (2) seleção de agentes de especialidade no momento do upload baseada na especialidade configurada, (3) novo agente "Correlação Clínica" que sintetiza todos os resultados de um exame com foco em fatores subjacentes e exames complementares sugeridos.

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

Agentes de análise:
  ☑ Metabólico
  ☐ Cardiovascular
  ☐ Hematologia

  ✦ Correlação Clínica · Síntese Terapêutica · Nutrição (sempre incluídos)

[ Cancelar ]   [ Enviar para análise ]
```

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
  "selected_agents": ["metabolic", "hematology"]
}
```

O worker usa `selected_agents` para filtrar `PHASE1_AGENTS.human`. Se `selected_agents` estiver ausente (jobs antigos ou integração direta), assume todos os agentes — backwards compatible.

---

## Parte 4 — Agente "Correlação Clínica" (clinical_correlation)

### Posição no pipeline

Phase 2 — roda uma vez por exame após todos os agentes Phase 1 concluírem. Recebe:
- Todos os resultados de Phase 1 do exame atual
- Perfil do paciente: sexo, idade, peso, altura, alergias, comorbidades

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
- Armazenamento de dados de estilo de vida do paciente (dieta, etc.) — o agente infere do que está nos marcadores e no perfil existente
- Interface de administração de especialidades (o médico gerencia o próprio perfil)
