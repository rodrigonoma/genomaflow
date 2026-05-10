# Análises IA UX Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o tab "Análises IA" do patient-detail por uma experiência summary-first: seletor de exame + faixa de status com chips por agente + cards colapsáveis com o agente mais crítico aberto por padrão.

**Architecture:** Toda a lógica é frontend puro dentro de `patient-detail.component.ts`. Dois novos signals (`selectedAiExamId`, `expandedAgents`) + um computed (`selectedAiExam`, `sortedAiExams`) controlam o estado. O template existente do tab é substituído inteiramente.

**Tech Stack:** Angular 17 standalone, signals, computed, Angular Material (MatSelect, MatIcon), TypeScript

---

## Arquivos modificados

- **Modify:** `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`
  - Task 1: novos signals, computed properties, métodos helpers
  - Task 2: substituição do template do tab + estilos

---

### Task 1: Signals, computed e helpers

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`

- [ ] **Step 1: Adicionar signals de estado do tab IA**

Localizar na classe (após `uploadError = signal('');`):
```ts
  uploading   = signal(false);
  uploadError = signal('');
```
Inserir após:
```ts
  selectedAiExamId = signal<string | null>(null);
  expandedAgents   = signal<Set<string>>(new Set());
```

- [ ] **Step 2: Adicionar computed sortedAiExams e selectedAiExam**

Localizar (após os signals recém-adicionados, antes de `selectedExamIds`):
```ts
  selectedExamIds = computed(
```
Inserir antes:
```ts
  sortedAiExams = computed(() =>
    [...this.aiResults()].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  );

  selectedAiExam = computed<Exam | null>(() => {
    const all = this.sortedAiExams();
    if (!all.length) return null;
    const id = this.selectedAiExamId();
    return id ? (all.find(e => e.id === id) ?? all[0]) : all[0];
  });
```

- [ ] **Step 3: Adicionar constante e helpers de severidade**

Localizar na classe (antes do `private readonly SEV: Record<string, number>`):
```ts
  private readonly SEV: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
```
Inserir antes:
```ts
  private readonly SEV_COLORS: Record<string, string> = {
    critical: '#ffb4ab', high: '#ffcb6b', medium: '#c0c1ff', low: '#4ad6a0', none: '#464554'
  };

  topSeverity(alerts: Alert[]): string {
    if (!alerts?.length) return 'none';
    for (const s of ['critical', 'high', 'medium', 'low']) {
      if (alerts.some(a => a.severity?.toLowerCase() === s)) return s;
    }
    return 'none';
  }

  severityColor(sev: string): string {
    return this.SEV_COLORS[sev?.toLowerCase()] ?? '#464554';
  }

  sortedAlerts(alerts: Alert[]): Alert[] {
    const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    return [...(alerts ?? [])].sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0));
  }
```

- [ ] **Step 4: Adicionar métodos de interação**

Localizar (antes de `toggleExamSelection`):
```ts
  toggleExamSelection(id: string): void {
```
Inserir antes:
```ts
  onAiExamSelect(id: string): void {
    this.selectedAiExamId.set(id);
    const exam = this.aiResults().find(e => e.id === id);
    if (exam) this.initExpandedAgents(exam);
  }

  toggleAgent(agentType: string): void {
    const s = new Set(this.expandedAgents());
    s.has(agentType) ? s.delete(agentType) : s.add(agentType);
    this.expandedAgents.set(s);
  }

  private initExpandedAgents(exam: Exam): void {
    const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
    const results = exam.results ?? [];
    if (!results.length) { this.expandedAgents.set(new Set()); return; }
    const top = results.reduce((best, r) =>
      (rank[this.topSeverity(r.alerts)] ?? 0) > (rank[this.topSeverity(best.alerts)] ?? 0) ? r : best
    , results[0]);
    this.expandedAgents.set(new Set([top.agent_type]));
  }
```

- [ ] **Step 5: Inicializar expandedAgents no loadExams**

Localizar em `loadExams`:
```ts
      this.exams.set(mine);
      this.aiResults.set(mine.filter(e => e.status === 'done' && e.results?.length));
```
Substituir por:
```ts
      this.exams.set(mine);
      const done = mine.filter(e => e.status === 'done' && e.results?.length);
      this.aiResults.set(done);
      const latest = [...done].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];
      if (latest) this.initExpandedAgents(latest);
```

- [ ] **Step 6: Verificar build**

```bash
cd /home/rodrigonoma/GenomaFlow
docker compose build web 2>&1 | grep -E "ERROR|error TS|Built"
```
Expected: `Image genomaflow-web Built` sem linhas ERROR.

---

### Task 2: Template e estilos do tab Análises IA

**Files:**
- Modify: `apps/web/src/app/features/doctor/patients/patient-detail.component.ts`

- [ ] **Step 1: Remover estilos antigos do tab AI e adicionar os novos**

Localizar no bloco `styles` e remover todo o bloco `/* ── AI RESULTS ── */`:
```ts
    /* ── AI RESULTS ── */
    .results-list { display: flex; flex-direction: column; gap: 1rem; max-width: 900px; }
    .result-card {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 6px; padding: 1.25rem;
    }
    .result-header {
      display: flex; justify-content: space-between;
      align-items: center; margin-bottom: 1rem;
    }
    .result-agent {
      font-family: 'JetBrains Mono', monospace; font-size: 12px;
      color: #c0c1ff; letter-spacing: 0.08em;
    }
    .result-date { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #464554; }
    .result-interpretation {
      font-size: 13px; color: #c7c4d7; line-height: 1.6;
      border-left: 2px solid rgba(192,193,255,0.3);
      padding-left: 0.75rem; margin-bottom: 1rem;
    }
    .alerts-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 0.75rem; }
    .alert-chip {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      padding: 3px 10px; border-radius: 2px; text-transform: uppercase;
    }
    .sev-critical { background: rgba(255,91,91,0.15); color: #ff5b5b; }
    .sev-high     { background: rgba(255,180,171,0.15); color: #ffb4ab; }
    .sev-medium   { background: rgba(245,193,74,0.15); color: #f5c14a; }
    .sev-low      { background: rgba(74,214,160,0.15); color: #4ad6a0; }
```

Substituir por:
```ts
    /* ── AI RESULTS (redesign) ── */
    .ai-exam-selector { margin-bottom: 1rem; }
    .ai-select-field { width: 300px; }
    .ai-status-strip { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
    .ai-agent-chip {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.4rem 0.75rem; background: #131b2e;
      border: 1px solid rgba(70,69,84,0.2); border-left: 3px solid;
      border-radius: 6px; cursor: pointer; transition: background 150ms;
    }
    .ai-agent-chip:hover { background: #1a2540; }
    .ai-chip-name {
      font-family: 'Space Grotesk', sans-serif; font-size: 12px;
      font-weight: 700; color: #dae2fd; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .ai-chip-sev { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; }
    .ai-chip-count { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #908fa0; }
    .ai-cards { display: flex; flex-direction: column; gap: 0.5rem; max-width: 860px; }
    .ai-card {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.2);
      border-left: 4px solid; border-radius: 8px; overflow: hidden;
    }
    .ai-card-header {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.75rem 1rem; cursor: pointer; transition: background 150ms;
    }
    .ai-card-header:hover { background: #1a2540; }
    .ai-expand-icon { font-size: 18px !important; width: 18px !important; height: 18px !important; color: #908fa0; }
    .ai-card-name {
      font-family: 'Space Grotesk', sans-serif; font-size: 13px;
      font-weight: 700; color: #dae2fd; text-transform: uppercase; letter-spacing: 0.04em; flex: 1;
    }
    .ai-card-sev { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; }
    .ai-card-count { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #908fa0; }
    .ai-result-link {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #c0c1ff; text-decoration: none; white-space: nowrap; margin-left: auto;
    }
    .ai-result-link:hover { text-decoration: underline; }
    .ai-card-body { padding: 0 1rem 1rem 1rem; border-top: 1px solid rgba(70,69,84,0.15); }
    .ai-section-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.1em; color: #464554;
      margin: 1rem 0 0.5rem 0;
    }
    .ai-alerts { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.5rem; }
    .ai-alert-row {
      display: flex; align-items: center; gap: 0.5rem;
      font-family: 'JetBrains Mono', monospace; font-size: 12px;
    }
    .ai-alert-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .ai-alert-marker { color: #dae2fd; flex: 1; }
    .ai-alert-value { color: #908fa0; }
    .ai-alert-sev { font-size: 10px; font-weight: 700; min-width: 56px; text-align: right; }
    .ai-interpretation { margin-bottom: 0.5rem; }
    .ai-interpretation p {
      font-family: 'Inter', sans-serif; font-size: 13px; color: #c7c4d7;
      line-height: 1.6; margin: 0 0 0.5rem 0;
      padding-left: 0.75rem; border-left: 2px solid rgba(192,193,255,0.2);
    }
    .ai-recs { display: flex; flex-direction: column; gap: 0.375rem; }
    .ai-rec-item {
      display: flex; gap: 0.5rem; align-items: flex-start;
      padding: 0.5rem 0.75rem; border-radius: 4px;
      background: rgba(70,69,84,0.08); border-left: 3px solid;
    }
    .ai-rec-type {
      font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700;
      letter-spacing: 0.08em; color: #908fa0; flex-shrink: 0; padding-top: 2px; min-width: 88px;
    }
    .ai-rec-desc { font-family: 'Inter', sans-serif; font-size: 13px; color: #c7c4d7; line-height: 1.4; }
```

- [ ] **Step 2: Substituir o template do tab "Análises IA"**

Localizar o bloco inteiro:
```html
        <!-- ── ANÁLISES IA ── -->
        <mat-tab [label]="'Análises IA (' + aiResults().length + ')'">
          @if (aiResults().length === 0) {
            <p class="empty-state">Nenhuma análise de IA disponível.</p>
          } @else {
            <div class="results-list">
              @for (r of aiResults(); track r.id) {
                @for (cr of r.results; track cr.agent_type) {
                  <div class="result-card">
                    <div class="result-header">
                      <span class="result-agent">{{ cr.agent_type }}</span>
                      <span class="result-date">{{ r.created_at | date:'dd/MM/yyyy HH:mm' }}</span>
                    </div>
                    <div class="result-interpretation">{{ cr.interpretation }}</div>
                    @if (cr.alerts?.length) {
                      <div class="alerts-row">
                        @for (a of cr.alerts; track a.marker) {
                          <span class="alert-chip" [ngClass]="'sev-' + a.severity">
                            {{ a.marker }}: {{ a.value }}
                          </span>
                        }
                      </div>
                    }
                    <a mat-button style="font-size:11px;color:#c0c1ff;padding:0"
                       [routerLink]="['/results', r.id]">
                      Ver resultado completo →
                    </a>
                  </div>
                }
              }
            </div>
          }
        </mat-tab>
```

Substituir por:
```html
        <!-- ── ANÁLISES IA ── -->
        <mat-tab [label]="'Análises IA (' + aiResults().length + ')'">
          @if (aiResults().length === 0) {
            <p class="empty-state">Nenhuma análise de IA disponível.</p>
          } @else {
            <!-- Seletor de exame -->
            <div class="ai-exam-selector">
              <mat-form-field appearance="outline" class="ai-select-field">
                <mat-label>Exame</mat-label>
                <mat-select [value]="selectedAiExam()?.id"
                            (selectionChange)="onAiExamSelect($event.value)">
                  @for (e of sortedAiExams(); track e.id) {
                    <mat-option [value]="e.id">
                      {{ e.created_at | date:'dd/MM/yyyy HH:mm' }} · {{ e.results!.length }} {{ e.results!.length === 1 ? 'agente' : 'agentes' }}
                    </mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>

            @if (selectedAiExam(); as exam) {
              <!-- Faixa de status -->
              <div class="ai-status-strip">
                @for (cr of exam.results ?? []; track cr.agent_type) {
                  @let sev = topSeverity(cr.alerts);
                  <div class="ai-agent-chip" [style.border-left-color]="severityColor(sev)"
                       (click)="toggleAgent(cr.agent_type)">
                    <span class="ai-chip-name">{{ agentLabel(cr.agent_type) }}</span>
                    <span class="ai-chip-sev" [style.color]="severityColor(sev)">{{ sev.toUpperCase() }}</span>
                    @if (cr.alerts?.length) {
                      <span class="ai-chip-count">{{ cr.alerts.length }} alerta{{ cr.alerts.length !== 1 ? 's' : '' }}</span>
                    }
                  </div>
                }
              </div>

              <!-- Cards colapsáveis -->
              <div class="ai-cards">
                @for (cr of exam.results ?? []; track cr.agent_type) {
                  @let sev = topSeverity(cr.alerts);
                  @let expanded = expandedAgents().has(cr.agent_type);
                  <div class="ai-card" [style.border-left-color]="severityColor(sev)">
                    <div class="ai-card-header" (click)="toggleAgent(cr.agent_type)">
                      <mat-icon class="ai-expand-icon">{{ expanded ? 'expand_more' : 'chevron_right' }}</mat-icon>
                      <span class="ai-card-name">{{ agentLabel(cr.agent_type) }}</span>
                      <span class="ai-card-sev" [style.color]="severityColor(sev)">{{ sev.toUpperCase() }}</span>
                      @if (cr.alerts?.length) {
                        <span class="ai-card-count">{{ cr.alerts.length }} alerta{{ cr.alerts.length !== 1 ? 's' : '' }}</span>
                      }
                      <a class="ai-result-link" [routerLink]="['/doctor/results', exam.id]"
                         (click)="$event.stopPropagation()">Ver resultado ↗</a>
                    </div>

                    @if (expanded) {
                      <div class="ai-card-body">
                        @if (cr.alerts?.length) {
                          <div class="ai-section-label">ALERTAS</div>
                          <div class="ai-alerts">
                            @for (a of sortedAlerts(cr.alerts); track a.marker) {
                              <div class="ai-alert-row">
                                <span class="ai-alert-dot" [style.background]="severityColor(a.severity)"></span>
                                <span class="ai-alert-marker">{{ a.marker }}</span>
                                <span class="ai-alert-value">{{ a.value }}</span>
                                <span class="ai-alert-sev" [style.color]="severityColor(a.severity)">{{ a.severity }}</span>
                              </div>
                            }
                          </div>
                        }

                        <div class="ai-section-label">INTERPRETAÇÃO · AI · CLAUDE SONNET</div>
                        <div class="ai-interpretation">
                          @for (para of cr.interpretation.split('\n'); track $index) {
                            @if (para.trim()) {
                              <p>{{ para.trim() }}</p>
                            }
                          }
                        </div>

                        @if (cr.recommendations?.length) {
                          <div class="ai-section-label">RECOMENDAÇÕES</div>
                          <div class="ai-recs">
                            @for (rec of cr.recommendations; track rec.description) {
                              <div class="ai-rec-item"
                                   [style.border-left-color]="severityColor(rec.priority === 'high' ? 'high' : rec.priority === 'medium' ? 'medium' : 'low')">
                                <span class="ai-rec-type">{{ rec.type | uppercase }}</span>
                                <span class="ai-rec-desc">{{ rec.description }}</span>
                              </div>
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
        </mat-tab>
```

- [ ] **Step 3: Build e verificação**

```bash
cd /home/rodrigonoma/GenomaFlow
docker compose build web 2>&1 | grep -E "ERROR|error TS|Built"
```
Expected: `Image genomaflow-web Built` sem linhas ERROR. Se houver erros TypeScript, corrija antes de continuar.

- [ ] **Step 4: Restart e teste manual**

```bash
docker compose up -d web
```

Testar em `http://localhost:4200`:
1. Abrir perfil de paciente com exame `done` → aba "Análises IA"
2. Verificar faixa de chips coloridos por severidade no topo
3. Verificar card do agente mais crítico expandido por padrão
4. Clicar em chip → card correspondente faz toggle
5. Clicar no header do card → expand/collapse
6. Clicar "Ver resultado ↗" → abre `/doctor/results/:id` sem fechar o card
7. Trocar exame no dropdown → cards reiniciam com o agente mais crítico do novo exame

- [ ] **Step 5: Commit**

```bash
cd /home/rodrigonoma/GenomaFlow
git add apps/web/src/app/features/doctor/patients/patient-detail.component.ts
git commit -m "feat: redesign aba Análises IA — summary-first com chips e cards colapsáveis"
```
