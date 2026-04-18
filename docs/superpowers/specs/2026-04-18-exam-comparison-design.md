# Comparação de Exames — Design Spec

**Goal:** Permitir ao usuário selecionar 2 ou mais exames concluídos de um mesmo paciente e visualizar um resumo do que mudou entre eles, evidenciando a evolução clínica ao longo do tempo.

---

## Contexto

Localização: aba **"Evolução"** no `patient-detail.component.ts`, ao lado das abas Perfil, Exames, Análises IA e Tratamentos. Sem novas rotas. Sem novo arquivo de componente — segue o padrão inline do componente existente.

---

## Dados

- **Fonte:** signal `exams()` já carregado no componente via `GET /exams` (filtrado por subject_id). O campo `results: ClinicalResult[]` já vem populado nessa resposta.
- **Zero chamadas extras à API** para o fluxo normal. Se um exame selecionado não tiver `results` carregados (caso raro), busca `GET /exams/:id` sob demanda.
- **Exames elegíveis:** apenas `status === 'done'`.

---

## Estado local da aba

```ts
selectedExamIds = new Set<string>();   // IDs marcados nos checkboxes
comparison: ComparisonBlock[] | null = null;  // resultado calculado no frontend
```

`ComparisonBlock`:
```ts
interface ComparisonBlock {
  agent_type: string;
  risk_trajectory: string[];          // ex: ['MEDIUM', 'HIGH', 'HIGH']
  changes: AlertChange[];
}

interface AlertChange {
  marker: string;
  kind: 'new' | 'worsened' | 'improved' | 'resolved';
  from_severity?: string;
  to_severity?: string;
  value?: string;                     // valor do alerta mais recente
}
```

---

## Algoritmo de comparação (frontend puro)

1. Filtrar exames selecionados com `status === 'done'` e `results !== null`.
2. Ordenar por `created_at` ascendente (mais antigo → mais recente).
3. Coletar todos os `agent_type` presentes em qualquer exame selecionado.
4. Para cada `agent_type`:
   - **Risk trajectory:** extrair `risk_scores` de cada exame na ordem cronológica → array de valores.
   - **Alert changes:** comparar par a par (exame N-1 → exame N):
     - Match por `marker` (case-insensitive).
     - Severity order: `low=1, medium=2, high=3, critical=4`.
     - Novo: marker existe em N mas não em N-1 → `kind: 'new'`
     - Piorou: severity(N) > severity(N-1) → `kind: 'worsened'`
     - Melhorou: severity(N) < severity(N-1) → `kind: 'improved'`
     - Resolvido: marker existe em N-1 mas não em N → `kind: 'resolved'`
     - Igual: oculto.
   - Desduplicar: se um marker mudou em múltiplos pares, mostrar apenas a mudança mais recente.
5. Agentes sem nenhum `AlertChange` E com risk_trajectory constante são omitidos do resultado.

---

## UI

### Painel de seleção

- Lista de exames `done` ordenada do mais recente ao mais antigo.
- Cada linha: `[ checkbox ] DD/MM/YYYY · N agentes · done`
- Botão **"Comparar N exames selecionados"** — desabilitado quando `selectedExamIds.size < 2`.

### Resultado da comparação

Header: `COMPARANDO  DD/MM  →  DD/MM  →  DD/MM`

Para cada `ComparisonBlock`:
```
METABÓLICO          MEDIUM → HIGH → HIGH
  🔴 NOVO      Triglicerídeos: 474 mg/dL (critical)
  🟡 PIOROU    Glicemia: medium → high
  🟢 MELHOROU  TSH: high → medium
  ⚫ RESOLVIDO  Colesterol total
```

Ícone + cor por `kind`:
| kind | ícone | cor |
|---|---|---|
| new | `fiber_new` | `#ffb4ab` (vermelho) |
| worsened | `trending_up` | `#ffcb6b` (amarelo) |
| improved | `trending_down` | `#4ad6a0` (verde) |
| resolved | `check_circle` | `#908fa0` (cinza) |

Risk trajectory renderizada inline na linha do agente, separada por `→`.

---

## Sem API nova

Toda a lógica de comparação é computada no frontend. O backend não precisa de nenhuma alteração.

---

## Fora de escopo

- Gráficos de linha (Chart.js etc.) — texto é suficiente por ora.
- Exportação PDF da comparação.
- Comparação entre pacientes diferentes.
- Comparação de exames com `status !== 'done'`.
