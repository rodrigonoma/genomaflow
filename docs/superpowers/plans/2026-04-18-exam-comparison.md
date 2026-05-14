# Comparação de Exames — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar aba "Evolução" no perfil do paciente que permite selecionar 2+ exames concluídos e exibir resumo de mudanças clínicas (alertas novos, pioras, melhoras, resolvidos) com trajetória de risk scores.

**Architecture:** Toda a lógica é frontend puro — sem alterações na API. A aba reutiliza o signal `exams()` já carregado. O algoritmo de comparação roda no componente via método `compareExams()` que retorna `ComparisonBlock[]`. O resultado é armazenado em um signal `comparison`.

**Tech Stack:** Angular 17 standalone components, signals, TypeScript, Angular Material (MatCheckbox, MatButton, MatIcon)

---

## Arquivos modificados

- **Modify:** `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`
  - Adicionar interfaces `ComparisonBlock` e `AlertChange`
  - Adicionar signals `selectedExamIds`, `comparison`
  - Adicionar métodos `toggleExamSelection()`, `compareExams()`, `buildAgentLabel()`
  - Adicionar aba "Evolução" no template
  - Adicionar estilos da aba

---

### Task 1: Interfaces e signals de estado

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`

- [ ] **Step 1: Adicionar import de MatCheckboxModule**

Localizar a linha de imports do componente:
```ts
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
```
Substituir por:
```ts
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
```

- [ ] **Step 2: Adicionar MatCheckboxModule ao array imports do @Component**

Localizar:
```ts
    MatChipsModule, MatDialogModule, ExamCardComponent
```
Substituir por:
```ts
    MatChipsModule, MatDialogModule, MatCheckboxModule, ExamCardComponent
```

- [ ] **Step 3: Adicionar interfaces locais antes do @Component decorator**

Inserir antes de `@Component({`:
```ts
interface AlertChange {
  marker: string;
  kind: 'new' | 'worsened' | 'improved' | 'resolved';
  from_severity?: string;
  to_severity?: string;
  value?: string;
}

interface ComparisonBlock {
  agent_type: string;
  risk_trajectory: string[];
  changes: AlertChange[];
}
```

- [ ] **Step 4: Adicionar signals de estado na classe**

Localizar na classe (após `showNewPlan = signal(false);`):
```ts
  uploading   = signal(false);
  uploadError = signal('');
```
Inserir após:
```ts
  selectedExamIds = signal(new Set<string>());
  comparison      = signal<ComparisonBlock[] | null>(null);
```

- [ ] **Step 5: Verificar que o build não quebrou**

```bash
cd /home/rodrigonoma/GenomaFlow
docker compose build web 2>&1 | grep -E "ERROR|error TS|✓|Built"
```
Expected: `Image genomaflow-web Built` sem linhas de ERROR.

---

### Task 2: Algoritmo de comparação

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`

- [ ] **Step 1: Adicionar método toggleExamSelection**

Inserir antes de `onExamFile(event: Event)`:
```ts
  toggleExamSelection(id: string): void {
    const s = new Set(this.selectedExamIds());
    s.has(id) ? s.delete(id) : s.add(id);
    this.selectedExamIds.set(s);
    this.comparison.set(null);
  }
```

- [ ] **Step 2: Adicionar constante de severidade e helper**

Inserir antes de `toggleExamSelection`:
```ts
  private readonly SEV: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

  private severityOf(s: string): number {
    return this.SEV[s?.toLowerCase()] ?? 0;
  }
```

- [ ] **Step 3: Adicionar método compareExams**

Inserir após `toggleExamSelection`:
```ts
  compareExams(): void {
    const ids = this.selectedExamIds();
    const sorted = this.exams()
      .filter(e => ids.has(e.id) && e.status === 'done' && e.results?.length)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    if (sorted.length < 2) return;

    // Collect all agent types across selected exams
    const allAgents = [...new Set(sorted.flatMap(e => (e.results ?? []).map(r => r.agent_type)))];

    const blocks: ComparisonBlock[] = [];

    for (const agent of allAgents) {
      // Risk trajectory
      const risk_trajectory: string[] = sorted.map(e => {
        const r = (e.results ?? []).find(r => r.agent_type === agent);
        if (!r) return '—';
        const vals = Object.values(r.risk_scores ?? {});
        return vals[0] ?? '—';
      });

      // Alert changes — compare consecutive pairs, keep most recent change per marker
      const latestChange = new Map<string, AlertChange>();

      for (let i = 1; i < sorted.length; i++) {
        const prev = (sorted[i - 1].results ?? []).find(r => r.agent_type === agent);
        const curr = (sorted[i].results ?? []).find(r => r.agent_type === agent);

        const prevAlerts = prev?.alerts ?? [];
        const currAlerts = curr?.alerts ?? [];

        const prevMap = new Map(prevAlerts.map(a => [a.marker.toLowerCase(), a]));
        const currMap = new Map(currAlerts.map(a => [a.marker.toLowerCase(), a]));

        // New and changed
        for (const [key, ca] of currMap) {
          const pa = prevMap.get(key);
          if (!pa) {
            latestChange.set(key, { marker: ca.marker, kind: 'new', to_severity: ca.severity, value: ca.value });
          } else {
            const diff = this.severityOf(ca.severity) - this.severityOf(pa.severity);
            if (diff > 0) {
              latestChange.set(key, { marker: ca.marker, kind: 'worsened', from_severity: pa.severity, to_severity: ca.severity, value: ca.value });
            } else if (diff < 0) {
              latestChange.set(key, { marker: ca.marker, kind: 'improved', from_severity: pa.severity, to_severity: ca.severity, value: ca.value });
            }
          }
        }
        // Resolved
        for (const [key, pa] of prevMap) {
          if (!currMap.has(key)) {
            latestChange.set(key, { marker: pa.marker, kind: 'resolved', from_severity: pa.severity });
          }
        }
      }

      const changes = [...latestChange.values()];
      const isConstant = risk_trajectory.every(v => v === risk_trajectory[0]);
      if (changes.length === 0 && isConstant) continue;

      blocks.push({ agent_type: agent, risk_trajectory, changes });
    }

    this.comparison.set(blocks);
  }
```

- [ ] **Step 4: Adicionar método agentLabel**

Inserir após `compareExams`:
```ts
  agentLabel(type: string): string {
    const labels: Record<string, string> = {
      metabolic: 'Metabólico', cardiovascular: 'Cardiovascular',
      hematology: 'Hematologia', therapeutic: 'Terapêutico',
      nutrition: 'Nutrição', small_animals: 'Pequenos Animais',
      equine: 'Equino', bovine: 'Bovino'
    };
    return labels[type] ?? type;
  }

  kindIcon(kind: string): string {
    return { new: 'fiber_new', worsened: 'trending_up', improved: 'trending_down', resolved: 'check_circle' }[kind] ?? 'circle';
  }

  kindColor(kind: string): string {
    return { new: '#ffb4ab', worsened: '#ffcb6b', improved: '#4ad6a0', resolved: '#908fa0' }[kind] ?? '#908fa0';
  }

  kindLabel(kind: string): string {
    return { new: 'NOVO', worsened: 'PIOROU', improved: 'MELHOROU', resolved: 'RESOLVIDO' }[kind] ?? kind;
  }
```

- [ ] **Step 5: Verificar build**

```bash
docker compose build web 2>&1 | grep -E "ERROR|error TS|Built"
```
Expected: `Image genomaflow-web Built` sem erros.

---

### Task 3: Template da aba Evolução

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`

- [ ] **Step 1: Adicionar estilos da aba Evolução**

Localizar no bloco de styles:
```ts
    .exams-upload-row {
```
Inserir **antes** dessa linha:
```ts
    /* ── Evolução ── */
    .evolution-select-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem; }
    .evolution-exam-row {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.6rem 1rem; border-radius: 6px;
      background: #131b2e; border: 1px solid rgba(70,69,84,0.15);
      cursor: pointer;
    }
    .evolution-exam-row.selected { border-color: #c0c1ff; }
    .evolution-exam-meta { font-size: 13px; color: #908fa0; }
    .evolution-exam-date { font-weight: 600; color: #dae2fd; margin-right: 0.5rem; }
    .compare-btn { margin-bottom: 2rem; }
    .comparison-header {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      letter-spacing: 0.1em; color: #c0c1ff; text-transform: uppercase;
      margin-bottom: 1.5rem;
    }
    .comparison-blocks { display: flex; flex-direction: column; gap: 1.5rem; max-width: 800px; }
    .comp-block { background: #131b2e; border-radius: 8px; padding: 1rem 1.25rem; border: 1px solid rgba(70,69,84,0.15); }
    .comp-agent-header {
      display: flex; align-items: baseline; gap: 1rem; margin-bottom: 0.75rem;
    }
    .comp-agent-name {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 13px; text-transform: uppercase; color: #c0c1ff; letter-spacing: 0.05em;
    }
    .comp-risk-traj { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #908fa0; }
    .comp-changes { display: flex; flex-direction: column; gap: 0.4rem; }
    .comp-change-row { display: flex; align-items: center; gap: 0.5rem; font-size: 13px; }
    .comp-change-kind { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; min-width: 72px; }
    .comp-marker { color: #dae2fd; }
    .comp-severity { color: #908fa0; font-size: 12px; }
    .comp-empty { color: #908fa0; font-style: italic; font-size: 13px; }
```

- [ ] **Step 2: Adicionar aba Evolução no mat-tab-group**

Localizar no template:
```html
        <!-- ── TRATAMENTOS ── -->
        <mat-tab [label]="'Tratamentos (' + plans().length + ')'">
```
Inserir **antes** dessa linha:
```html
        <!-- ── EVOLUÇÃO ── -->
        <mat-tab label="Evolução">
          @let doneExams = exams().filter(e => e.status === 'done' && e.results?.length);
          @if (doneExams.length < 2) {
            <p class="empty-state">São necessários pelo menos 2 exames concluídos com análise de IA para comparar.</p>
          } @else {
            <div class="evolution-select-list">
              @for (e of doneExams; track e.id) {
                <div class="evolution-exam-row"
                     [class.selected]="selectedExamIds().has(e.id)"
                     (click)="toggleExamSelection(e.id)">
                  <mat-checkbox [checked]="selectedExamIds().has(e.id)"
                                (click)="$event.stopPropagation()"
                                (change)="toggleExamSelection(e.id)"/>
                  <span class="evolution-exam-date">{{ e.created_at | date:'dd/MM/yyyy HH:mm' }}</span>
                  <span class="evolution-exam-meta">
                    {{ e.results!.length }} {{ e.results!.length === 1 ? 'agente' : 'agentes' }}
                  </span>
                </div>
              }
            </div>

            <button mat-flat-button class="compare-btn"
                    style="background:#c0c1ff;color:#1000a9;font-weight:700"
                    [disabled]="selectedExamIds().size < 2"
                    (click)="compareExams()">
              <mat-icon>compare_arrows</mat-icon>
              Comparar {{ selectedExamIds().size }} exame{{ selectedExamIds().size !== 1 ? 's' : '' }} selecionado{{ selectedExamIds().size !== 1 ? 's' : '' }}
            </button>

            @if (comparison()) {
              @let blocks = comparison()!;
              <div class="comparison-header">
                Comparando &nbsp;
                @for (e of exams().filter(ex => selectedExamIds().has(ex.id) && ex.status === 'done').sort((a,b) => +new Date(a.created_at) - +new Date(b.created_at)); track e.id; let last = $last) {
                  {{ e.created_at | date:'dd/MM' }}@if (!last) { &nbsp;→&nbsp; }
                }
              </div>

              @if (blocks.length === 0) {
                <p class="comp-empty">Nenhuma mudança clínica detectada entre os exames selecionados.</p>
              } @else {
                <div class="comparison-blocks">
                  @for (block of blocks; track block.agent_type) {
                    <div class="comp-block">
                      <div class="comp-agent-header">
                        <span class="comp-agent-name">{{ agentLabel(block.agent_type) }}</span>
                        <span class="comp-risk-traj">{{ block.risk_trajectory.join(' → ') }}</span>
                      </div>
                      @if (block.changes.length === 0) {
                        <span class="comp-empty">Risk score alterado, sem mudanças em alertas.</span>
                      } @else {
                        <div class="comp-changes">
                          @for (ch of block.changes; track ch.marker) {
                            <div class="comp-change-row">
                              <mat-icon [style.color]="kindColor(ch.kind)" style="font-size:18px;width:18px;height:18px">{{ kindIcon(ch.kind) }}</mat-icon>
                              <span class="comp-change-kind" [style.color]="kindColor(ch.kind)">{{ kindLabel(ch.kind) }}</span>
                              <span class="comp-marker">{{ ch.marker }}</span>
                              @if (ch.value) {
                                <span class="comp-severity">· {{ ch.value }}</span>
                              }
                              @if (ch.from_severity && ch.to_severity) {
                                <span class="comp-severity">({{ ch.from_severity }} → {{ ch.to_severity }})</span>
                              } @else if (ch.to_severity) {
                                <span class="comp-severity">({{ ch.to_severity }})</span>
                              } @else if (ch.from_severity) {
                                <span class="comp-severity">(era {{ ch.from_severity }})</span>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            }
          }
        </mat-tab>
```

- [ ] **Step 3: Build final e validação**

```bash
docker compose build web 2>&1 | grep -E "ERROR|error TS|Built"
```
Expected: `Image genomaflow-web Built` sem erros.

- [ ] **Step 4: Restart e teste manual**

```bash
docker compose up -d web
```

Testar no browser (`http://localhost:4200`):
1. Abrir perfil de um paciente com 2+ exames `done`
2. Clicar na aba **Evolução**
3. Marcar 2 exames → botão "Comparar 2 exames selecionados" fica habilitado
4. Clicar Comparar → aparece seção com blocos por agente
5. Verificar que agentes sem mudança não aparecem
6. Verificar cores: vermelho=novo, amarelo=piorou, verde=melhorou, cinza=resolvido

- [ ] **Step 5: Commit**

```bash
cd /home/rodrigonoma/GenomaFlow
git add apps/web/src/app/features/doctor/patients/patient-detail.component.ts
git commit -m "feat: aba Evolução com comparação de exames por alertas e risk scores"
```
