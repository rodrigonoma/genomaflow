# Análises IA Tab — UX Redesign Spec

**Goal:** Substituir o tab "Análises IA" do patient-detail por uma experiência summary-first: faixa de status escaneável no topo + cards colapsáveis por agente, com o mais crítico expandido por padrão.

**Primary use case:** Médico abre o tab para ver rapidamente o estado clínico do paciente com base no exame mais recente — sem precisar rolar.

---

## Localização

`apps/web/src/app/features/doctor/patients/patient-detail.component.ts` — apenas o tab "Análises IA". Sem novas rotas, sem novos arquivos de componente.

---

## Dados

- **Fonte:** signal `aiResults()` já existente (`Exam[]` com `status === 'done'` e `results?.length`)
- **Exame selecionado:** signal `selectedAiExam` inicializado com o exame mais recente (`aiResults()[0]` após sort por `created_at` desc)
- **Zero chamadas extras à API**

---

## Estado local

```ts
selectedAiExamId = signal<string | null>(null);   // null = mais recente
expandedAgents   = signal<Set<string>>(new Set()); // agent_types expandidos
```

`selectedAiExam` é um `computed()` que resolve o exame do `aiResults()` pelo id, ou o primeiro se null.

`expandedAgents` é inicializado com o `agent_type` de severidade máxima do exame selecionado. Resetado quando o exame selecionado muda.

---

## UI

### 1. Seletor de exame

Dropdown compacto no topo do tab:

```
Exame: [ 17/04/2026 23:12 · 5 agentes  ▼ ]
```

- Mostra apenas exames `done` com results, ordenados do mais recente ao mais antigo
- Padrão: exame mais recente
- Ao mudar: atualiza `selectedAiExamId`, recalcula `expandedAgents` para o agente mais crítico do novo exame

### 2. Faixa de status (status strip)

Linha horizontal com um chip por agente do exame selecionado:

```
[ ● METABÓLICO  HIGH  4 alertas ]  [ ● CARDIOVASCULAR  MEDIUM  2 alertas ]  ...
```

- Um chip por `ClinicalResult` no exame selecionado
- Cor da borda esquerda do chip = severidade máxima dos alertas do agente:
  - `critical` → `#ffb4ab`
  - `high`     → `#ffcb6b`
  - `medium`   → `#c0c1ff`
  - `low`      → `#4ad6a0`
  - nenhum     → `#464554`
- Clicar no chip: toggle do card correspondente (expand se collapsed, collapse se expanded)
- Overflow horizontal com scroll se muitos agentes

### 3. Cards colapsáveis por agente

Um card por `ClinicalResult`, na ordem retornada pela API.

**Estado collapsed:**
```
▶  ● METABÓLICO    [HIGH]    4 alertas    Ver resultado ↗
```
- Ícone `chevron_right` / `expand_more` indicando estado
- Nome do agente localizado (usar `AGENT_LABELS` já existente no componente)
- Badge de severidade máxima colorido
- Contagem de alertas
- Link "Ver resultado ↗" → `/doctor/results/:examId`
- Clicar em qualquer parte da linha (exceto o link) faz toggle

**Estado expanded:**

```
▼  ● METABÓLICO    [HIGH]    4 alertas    Ver resultado ↗
─────────────────────────────────────────────────────────
ALERTAS
  🔴 Triglicerídeos: 474 mg/dL  critical
  🟡 Glicemia: 130 mg/dL        high
  🟣 HOMA-IR: 23.5              medium
  🟢 TSH: 0.8                   low

INTERPRETAÇÃO · AI · CLAUDE SONNET
  [texto com quebras de parágrafo naturais]

RECOMENDAÇÕES   (omitido se vazio)
  ▸ MEDICAMENTO    Metformina 500–1000 mg/dia  ·  alta prioridade
  ▸ MONITORAMENTO  Glicemia em jejum em 30 dias
```

**Detalhes:**

- **Alertas:** ordenados critical → high → medium → low. Ícone colorido por severidade (mesmas cores do chip). Font: JetBrains Mono.
- **Interpretação:** texto quebrado em parágrafos. Split por `\n` — cada parágrafo em `<p>`. Não usar `white-space: pre-wrap` (causa o bloco denso atual).
- **Recomendações:** exibidas apenas se `result.recommendations?.length`. Badge de tipo (`MEDICAMENTO`, `PROCEDIMENTO`, etc.) + descrição + indicador de prioridade (alta=`#ffcb6b`, média=`#c0c1ff`, baixa=`#4ad6a0`).

---

## Severidade máxima (helper)

Já existe `getTopSeverity()` no `ResultPanelComponent`. Extrair como função pura ou duplicar no patient-detail:

```ts
private topSeverity(alerts: Alert[]): string {
  const order = ['critical', 'high', 'medium', 'low'];
  for (const s of order) {
    if (alerts?.some(a => a.severity?.toLowerCase() === s)) return s;
  }
  return 'none';
}
```

---

## Inicialização do agente expandido por padrão

Ao carregar o exame selecionado (ou trocar de exame), calcular qual agente tem a maior severidade e pré-popular `expandedAgents`:

```ts
private initExpandedAgents(exam: Exam): void {
  const severityRank = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
  const top = (exam.results ?? []).reduce((best, r) => {
    const s = this.topSeverity(r.alerts);
    return severityRank[s] > severityRank[this.topSeverity(best.alerts)] ? r : best;
  }, exam.results![0]);
  this.expandedAgents.set(new Set([top.agent_type]));
}
```

---

## Fora de escopo

- Reordenar agentes por severidade (manter ordem da API)
- Animação de expand/collapse
- Exportação PDF
- Alterações no `result-panel.component.ts`
