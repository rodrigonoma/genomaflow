# Prescrições da IA na aba Tratamentos — Design

**Data:** 2026-04-22
**Branch:** `feat/prescriptions-in-treatments-tab` (a criar)
**Status:** Aprovado para implementação

---

## Contexto e Problema

Hoje existem dois conceitos distintos e desconectados:

1. **Prescrições** (tabela `prescriptions`): criadas via `PrescriptionModalComponent` a partir da aba "Análises IA", quando o médico/veterinário aceita ou edita recomendações dos agentes `therapeutic` ou `nutrition`. Têm PDF no S3, itens JSONB, vinculadas a `exam_id`.

2. **Planos de Tratamento** (tabela `treatment_plans`): criados manualmente na aba "Tratamentos". Sem vínculo com exame.

**Problema:** após gerar a prescrição pela IA, ela fica "escondida" — só acessível reabrindo a análise do exame específico. O médico/veterinário que consulta o histórico do paciente precisa navegar entre exames para encontrar prescrições anteriores.

**Objetivo:** unificar a visão de histórico de tratamentos na aba "Tratamentos", mantendo a distinção entre prescrições derivadas de análise da IA e planos criados manualmente, para que o médico/veterinário possa criar seu próprio plano quando não aceitar a sugestão da IA.

---

## Decisões de Design

### Estrutura da aba "Tratamentos" (Opção B — duas seções)

Duas seções separadas verticalmente dentro da aba:

1. **Prescrições da IA** (topo) — lista de prescrições derivadas de análises de IA
2. **Planos Manuais** (abaixo) — a funcionalidade atual (lista de `treatment_plans` + botão "Novo plano")

Razão: o profissional pode rejeitar a sugestão da IA e criar seu próprio plano do zero — ambas as trilhas devem coexistir visualmente. Separação ajuda a identificar a origem imediatamente.

### Card de prescrição (conteúdo aprovado)

**Cabeçalho:**
- Badge colorido: `IA · Terapêutico` (roxo) ou `IA · Nutricional` (verde)
- Título calculado: *"Prescrição Terapêutica"* ou *"Prescrição Nutricional"*
- Data de criação da prescrição
- Link destacado: *"Baseada em exame de DD/MM/YYYY"* — clicável

**Corpo:**
- Tabela read-only com os itens (name / dose / frequency / duration / notes)
- Observações gerais (se houver)

**Ações (canto superior direito):**
- **Baixar PDF** (se `pdf_url` existe) — abre em nova aba
- Menu `⋮`:
  - Editar → reabre `PrescriptionModalComponent` com `existingPrescription`
  - Enviar WhatsApp → reabre modal em estado `pdfReady`, chama `shareWhatsApp`
  - Enviar Email → reabre modal em estado `pdfReady`, chama `shareEmail`
  - Excluir → confirm + `DELETE /prescriptions/:id` + reload
- Se `pdf_url` estiver vazio: botão **Gerar PDF** em vez de "Baixar" — reabre modal para permitir salvar/gerar

---

## Backend

### Novo endpoint

`GET /prescriptions/subjects/:subjectId` — retorna todas as prescrições do paciente.

**Resposta:**

```json
[
  {
    "id": "uuid",
    "agent_type": "therapeutic" | "nutrition",
    "items": [...],
    "notes": "...",
    "pdf_url": "s3://..." | null,
    "created_at": "...",
    "exam_id": "uuid",
    "exam_created_at": "..."
  }
]
```

**Query:**

```sql
SELECT p.id, p.agent_type, p.items, p.notes, p.pdf_url, p.created_at,
       p.exam_id, e.created_at AS exam_created_at
FROM prescriptions p
JOIN exams e ON e.id = p.exam_id
WHERE p.subject_id = $1
ORDER BY p.created_at DESC;
```

**Segurança:** `preHandler: [fastify.authenticate]`, execução dentro de `withTenant`. Query já fica tenant-isolada porque `prescriptions` e `exams` têm RLS FORCE. Teste: requisição com `subject_id` de outro tenant retorna lista vazia (RLS) — não vaza dados.

**Arquivo:** `apps/api/src/routes/prescriptions.js` — adicionar handler logo após `GET /exams/:examId`.

### Sem migrations

Nenhuma mudança de schema. Usa apenas colunas existentes.

---

## Frontend

### Mudanças em `patient-detail.component.ts`

**Novos signals:**
```ts
prescriptions = signal<Prescription[]>([]);
```

**Novo método `loadPrescriptions(subjectId: string)`:**
- Chama `GET /prescriptions/subjects/:id`
- Popula o signal

**Refatoração de `loadPlans(id)`:**
- Renomear mental para "loadTreatments" — mas na prática, manter `loadPlans` e adicionar `loadPrescriptions` separados para clareza

**`ngOnInit`:** adicionar `this.loadPrescriptions(id)` após `this.loadPlans(id)`.

**Refresh hooks:**
- Após `openPrescriptionFromDetail(...)` salvar (no `afterClosed`), chamar `loadPrescriptions(subjectId)` além do `loadPrescriptionsForExam` existente
- Após delete, chamar `loadPrescriptions`

### Estrutura do template (aba Tratamentos)

```html
<mat-tab label="'Tratamentos (' + (prescriptions().length + plans().length) + ')'">

  <!-- ── Seção 1: Prescrições da IA ── -->
  <div class="treatments-section">
    <div class="section-header">
      <span class="section-title">Prescrições da IA</span>
      <span class="section-count">{{ prescriptions().length }}</span>
    </div>

    @if (prescriptions().length === 0) {
      <p class="empty-state-small">Nenhuma prescrição da IA registrada.</p>
    }

    @for (p of prescriptions(); track p.id) {
      <div class="prescription-card" [class]="'agent-' + p.agent_type">
        <div class="prescription-header">
          <div>
            <span class="badge-ia" [class]="'badge-' + p.agent_type">
              IA · {{ p.agent_type === 'therapeutic' ? 'Terapêutico' : 'Nutricional' }}
            </span>
            <div class="prescription-title">
              Prescrição {{ p.agent_type === 'therapeutic' ? 'Terapêutica' : 'Nutricional' }}
            </div>
            <div class="prescription-meta">
              {{ p.created_at | date:'dd/MM/yyyy HH:mm' }}
              · <a class="exam-link" (click)="goToAnalysis(p.exam_id, p.agent_type)">
                  Baseada em exame de {{ p.exam_created_at | date:'dd/MM/yyyy' }}
                </a>
            </div>
          </div>
          <div class="prescription-actions">
            @if (p.pdf_url) {
              <button mat-stroked-button (click)="downloadPdf(p)">
                <mat-icon>download</mat-icon> Baixar PDF
              </button>
            } @else {
              <button mat-stroked-button (click)="editPrescription(p)">
                <mat-icon>picture_as_pdf</mat-icon> Gerar PDF
              </button>
            }
            <button mat-icon-button [matMenuTriggerFor]="actions">
              <mat-icon>more_vert</mat-icon>
            </button>
            <mat-menu #actions>
              <button mat-menu-item (click)="editPrescription(p)">
                <mat-icon>edit</mat-icon> Editar
              </button>
              @if (p.pdf_url) {
                <button mat-menu-item (click)="sharePrescription(p, 'whatsapp')">
                  <mat-icon>chat</mat-icon> WhatsApp
                </button>
                <button mat-menu-item (click)="sharePrescription(p, 'email')">
                  <mat-icon>email</mat-icon> Email
                </button>
              }
              <button mat-menu-item (click)="deletePrescription(p)" class="danger">
                <mat-icon>delete</mat-icon> Excluir
              </button>
            </mat-menu>
          </div>
        </div>
        @if (p.items.length) {
          <table class="items-table">
            <tr><th>Item</th><th>Dose</th><th>Frequência</th><th>Duração</th></tr>
            @for (item of p.items; track item.name) {
              <tr>
                <td class="td-label">{{ item.name }}</td>
                <td>{{ item.dose || '—' }}</td>
                <td>{{ item.frequency || '—' }}</td>
                <td>{{ item.duration || '—' }}</td>
              </tr>
            }
          </table>
        }
        @if (p.notes) {
          <div class="prescription-notes">{{ p.notes }}</div>
        }
      </div>
    }
  </div>

  <!-- ── Seção 2: Planos Manuais ── -->
  <div class="treatments-section" style="margin-top: 2rem;">
    <div class="section-header">
      <span class="section-title">Planos Manuais</span>
      <span class="section-count">{{ plans().length }}</span>
      <button mat-stroked-button (click)="toggleNewPlan()" style="margin-left:auto;">
        <mat-icon>add</mat-icon> Novo plano
      </button>
    </div>

    <!-- resto do conteúdo atual (form + lista de plans) -->
  </div>

</mat-tab>
```

### Métodos novos

```ts
goToAnalysis(examId: string, agentType: string): void {
  this.selectedAiExamId.set(examId);
  this.expandedAgents.set(new Set([agentType]));
  this.selectedTabIndex.set(2); // Análises IA é a 3ª aba (index 2)
}

downloadPdf(p: Prescription): void {
  if (p.pdf_url) window.open(p.pdf_url, '_blank');
}

editPrescription(p: Prescription): void {
  // Reusar openPrescriptionFromDetail com existingPrescription
  const exam = this.exams().find(e => e.id === p.exam_id);
  if (!exam) return;
  const result = (exam.results ?? []).find(r => r.agent_type === p.agent_type);
  if (!result) return;
  this.openPrescriptionFromDetail(exam, result, p);
}

sharePrescription(p: Prescription, via: 'whatsapp' | 'email'): void {
  // Abre o modal em pdfReady. Precisa novo input em PrescriptionModalData: preloadShareAction
  this.editPrescription(p); // v1: simplesmente reabre — usuário clica WhatsApp/Email na tela de success
  // v2 (opcional): passar preloadShareAction para modal auto-disparar
}

deletePrescription(p: Prescription): void {
  if (!confirm('Excluir esta prescrição? Esta ação não pode ser desfeita.')) return;
  this.http.delete(`${environment.apiUrl}/prescriptions/${p.id}`).subscribe({
    next: () => this.loadPrescriptions(this.subject()!.id),
    error: () => this.snack.open('Erro ao excluir prescrição.', '', { duration: 3000 })
  });
}
```

### Tab switch programático

Adicionar signal e binding:
```ts
selectedTabIndex = signal(0);
```
```html
<mat-tab-group [(selectedIndex)]="selectedTabIndex">
```

Mas `mat-tab-group` não aceita two-way binding direto com signal. Usar:
```html
<mat-tab-group [selectedIndex]="selectedTabIndex()" (selectedIndexChange)="selectedTabIndex.set($event)">
```

---

## Compatibilidade Multi-módulo

Funciona idêntico para ambos módulos:
- `human`: agentes `therapeutic` e `nutrition` geram prescrições
- `veterinary`: os mesmos dois agentes existem (clinical_correlation é só human)

Nenhum ramo if-else por módulo na listagem — as prescrições vêm do banco já filtradas por subject_id, que pertence a algum tenant com módulo definido.

---

## Edge Cases

1. **Prescrição sem PDF** (`pdf_url` null): card mostra botão "Gerar PDF" em vez de "Baixar"
2. **Exam deletado** (futuro com soft-delete): `exam_created_at` viria null via LEFT JOIN. Atual usa INNER JOIN (`JOIN exams`), então prescrições órfãs não aparecem. Trade-off: prescrições órfãs ficariam invisíveis, mas isso é aceitável enquanto `exams` não tem soft-delete.
3. **Agente desconhecido** futuro: validação `CHECK (agent_type IN ('therapeutic', 'nutrition'))` na tabela protege contra dados inválidos.
4. **Usuário sem permissão**: `fastify.authenticate` + RLS isolam.

---

## Impacto e Riscos

- **Sem migrations** → sem risco em produção
- **Endpoint novo** → risco zero para rotas existentes
- **Aba "Tratamentos"** reestruturada → teste obrigatório: criar plano manual ainda funciona; criar prescrição via modal aparece na lista
- **Reabrir modal para edição** já é padrão existente — sem retrabalho

---

## Fora do Escopo

- Gerar PDF server-side (continua client-side via jsPDF)
- Envio automático WhatsApp/Email sem o modal (usuário ainda clica no botão no modal)
- Histórico de versões da prescrição (hoje só há versão "atual")
- Retirar a criação manual de planos (explicitamente preservada — opção B escolhida)

---

## Plano de Teste

1. Criar prescrição via modal da IA → aparece na seção "Prescrições da IA" da aba Tratamentos
2. Clicar "Baseada em exame de..." → muda para aba "Análises IA" com exame + agente corretos expandidos
3. Clicar "Editar" no card → reabre modal em modo edição, items carregados
4. Salvar edição → retorna à aba Tratamentos, card atualizado
5. Clicar "Baixar PDF" → abre PDF em nova aba
6. Excluir prescrição → confirmação, card some
7. Criar plano manual → aparece na seção "Planos Manuais"
8. Testar em ambos módulos (human e veterinary)
