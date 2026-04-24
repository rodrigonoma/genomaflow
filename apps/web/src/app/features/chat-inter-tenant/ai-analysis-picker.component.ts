import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { environment } from '../../../environments/environment';

interface Exam {
  id: string;
  subject_id: string;
  status: string;
  created_at: string;
  file_path?: string;
  file_type?: string;
  results: Array<{ agent_type: string }> | null;
}

const AGENT_LABELS: Record<string, string> = {
  cardiovascular: 'Cardiovascular',
  hematology: 'Hematologia',
  metabolic: 'Metabólico',
  therapeutic: 'Terapêutico',
  nutrition: 'Nutrição',
  small_animals: 'Pequenos Animais',
  equine: 'Equino',
  bovine: 'Bovino',
};

@Component({
  selector: 'app-ai-analysis-picker',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, MatDialogModule, MatIconModule, MatButtonModule],
  styles: [`
    :host { display: block; background: #0b1326; color: #dae2fd; }
    .wrap { padding: 1.5rem; }
    h2 {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.125rem; color: #c0c1ff; margin: 0 0 1rem;
    }
    .disclaimer {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #4ad6a0; background: rgba(74,214,160,0.06);
      padding: 0.5rem 0.75rem; border-radius: 4px;
      border-left: 2px solid #4ad6a0; margin-bottom: 1rem;
    }
    .exams-list {
      max-height: 280px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 0.375rem;
      margin-bottom: 1rem;
    }
    .empty {
      padding: 2rem; text-align: center;
      color: #7c7b8f; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem;
    }
    .exam-item {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.625rem 0.875rem; border-radius: 6px;
      background: #111929; border: 1px solid rgba(70,69,84,0.15);
      cursor: pointer;
    }
    .exam-item.selected { background: #1a2540; border-color: #c0c1ff; }
    .exam-date {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #dae2fd; font-weight: 600;
    }
    .exam-agents {
      display: flex; gap: 0.25rem; flex-wrap: wrap; flex: 1;
    }
    .mini-chip {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      padding: 1px 6px; border-radius: 3px;
      background: rgba(192,193,255,0.08); color: #c0c1ff;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .agent-picker { display: flex; flex-direction: column; gap: 0.375rem; }
    .agent-picker h3 {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #7c7b8f; text-transform: uppercase; letter-spacing: 0.08em;
      margin: 0.75rem 0 0.25rem;
    }
    .agent-row {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.4rem 0.625rem; border-radius: 4px;
      background: #111929; cursor: pointer;
      border: 1px solid rgba(70,69,84,0.15);
    }
    .agent-row.selected { background: #1a2540; border-color: #c0c1ff; }
    .agent-row .checkbox {
      width: 14px; height: 14px; border-radius: 2px;
      border: 1px solid rgba(192,193,255,0.4);
      display: flex; align-items: center; justify-content: center;
    }
    .agent-row.selected .checkbox { background: #c0c1ff; border-color: #c0c1ff; }
    .agent-row.selected .checkbox mat-icon { color: #1000a9; font-size: 12px; width: 12px; height: 12px; }
    .actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
  `],
  template: `
    <div class="wrap">
      <h2>Anexar análise IA</h2>
      <div class="disclaimer">
        🛡 O anexo é automaticamente anonimizado — sem nome, CPF, idade exata ou outros dados do paciente.
      </div>

      <h3 style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#7c7b8f;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 0.5rem">Selecione o exame</h3>
      <div class="exams-list">
        @if (exams().length === 0) {
          <div class="empty">Nenhum exame finalizado no seu tenant.</div>
        }
        @for (e of exams(); track e.id) {
          <div class="exam-item" [class.selected]="selectedExamId() === e.id" (click)="selectedExamId.set(e.id)">
            <span class="exam-date">{{ e.created_at | date:'dd/MM/yyyy HH:mm' }}</span>
            <div class="exam-agents">
              @for (a of getAgents(e); track a) {
                <span class="mini-chip">{{ agentLabel(a) }}</span>
              }
            </div>
          </div>
        }
      </div>

      @if (selectedExam()) {
        <div class="agent-picker">
          <h3>Quais agentes anexar?</h3>
          @for (a of getAgents(selectedExam()!); track a) {
            <div class="agent-row" [class.selected]="selectedAgents().has(a)" (click)="toggleAgent(a)">
              <div class="checkbox">
                @if (selectedAgents().has(a)) { <mat-icon>check</mat-icon> }
              </div>
              <span>{{ agentLabel(a) }}</span>
            </div>
          }
        </div>
      }

      <div class="actions">
        <button mat-button (click)="ref.close(null)">Cancelar</button>
        <button mat-flat-button style="background:#c0c1ff;color:#1000a9;font-weight:700"
                [disabled]="!canConfirm()"
                (click)="confirm()">
          Anexar
        </button>
      </div>
    </div>
  `
})
export class AiAnalysisPickerComponent {
  private http = inject(HttpClient);
  ref = inject(MatDialogRef<AiAnalysisPickerComponent, { exam_id: string; agent_types: string[] } | null>);

  exams = signal<Exam[]>([]);
  selectedExamId = signal<string | null>(null);
  selectedAgents = signal<Set<string>>(new Set());

  selectedExam = computed(() => {
    const id = this.selectedExamId();
    return this.exams().find(e => e.id === id) || null;
  });

  constructor() {
    this.http.get<Exam[]>(`${environment.apiUrl}/exams`).subscribe({
      next: (all) => {
        const done = (all || []).filter(e => e.status === 'done' && e.results && e.results.length > 0);
        // ordena mais recente primeiro
        done.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        this.exams.set(done);
      },
      error: () => this.exams.set([])
    });
  }

  getAgents(exam: Exam): string[] {
    return [...new Set((exam.results || []).map(r => r.agent_type))];
  }

  agentLabel(k: string): string { return AGENT_LABELS[k] || k; }

  toggleAgent(a: string) {
    const s = new Set(this.selectedAgents());
    if (s.has(a)) s.delete(a); else s.add(a);
    this.selectedAgents.set(s);
  }

  canConfirm(): boolean {
    return !!this.selectedExamId() && this.selectedAgents().size > 0;
  }

  confirm() {
    if (!this.canConfirm()) return;
    this.ref.close({
      exam_id: this.selectedExamId()!,
      agent_types: [...this.selectedAgents()]
    });
  }
}
