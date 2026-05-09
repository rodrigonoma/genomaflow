import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TimelineEvent } from './patient-timeline.component';

@Component({
  selector: 'app-timeline-panel',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe, MatIconModule, MatButtonModule],
  styles: [`
    .backdrop {
      position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:200;
      opacity:0; transition:opacity 220ms ease; pointer-events:none;
    }
    .backdrop.open { opacity:1; pointer-events:auto; }

    /* Desktop: slide da direita */
    .panel {
      position:fixed; top:0; right:0; bottom:0; width:420px; z-index:201;
      background:#111929; border-left:1px solid rgba(70,69,84,.25);
      display:flex; flex-direction:column; overflow:hidden;
      transform:translateX(100%); transition:transform 220ms ease;
    }
    .panel.open { transform:translateX(0); }

    /* Mobile: bottom-sheet */
    @media (max-width:768px) {
      .panel {
        top:auto; left:0; right:0; bottom:0; width:100%; height:85vh;
        border-left:none; border-top:1px solid rgba(70,69,84,.25);
        border-radius:16px 16px 0 0;
        transform:translateY(100%);
      }
      .panel.open { transform:translateY(0); }
      .handle {
        width:40px; height:4px; background:rgba(70,69,84,.5);
        border-radius:2px; margin:.75rem auto .25rem; flex-shrink:0;
      }
    }
    @media (min-width:769px) {
      .handle { display:none; }
    }

    .panel-header {
      display:flex; align-items:center; gap:.5rem;
      padding:.875rem 1rem; border-bottom:1px solid rgba(70,69,84,.2);
      flex-shrink:0;
    }
    .panel-title { flex:1; font-size:.9rem; font-weight:600; color:#dae2fd; }
    .panel-date  { font-size:.7rem; color:#6e6d80; font-family:'JetBrains Mono',monospace; }
    .close-btn   { color:#6e6d80; cursor:pointer; background:none; border:none; padding:0; line-height:1; }
    .close-btn:hover { color:#dae2fd; }

    .panel-body { flex:1; overflow-y:auto; padding:1rem; }

    .field { margin-bottom:.875rem; }
    .field-label {
      font-size:.65rem; color:#6e6d80; font-family:'JetBrains Mono',monospace;
      text-transform:uppercase; letter-spacing:.08em; margin-bottom:.25rem;
    }
    .field-value { font-size:.82rem; color:#dae2fd; line-height:1.5; }

    .action-btn {
      width:100%; margin-top:1rem; padding:.625rem;
      background:#1a2440; border:1px solid rgba(192,193,255,.25);
      border-radius:6px; color:#c0c1ff; font-size:.8rem; cursor:pointer;
      display:flex; align-items:center; justify-content:center; gap:.5rem;
    }
    .action-btn:hover { background:#202e4a; }

    .badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:.7rem;
             font-family:'JetBrains Mono',monospace; }
    .badge-critical { background:#7f1d1d; color:#fca5a5; }
    .badge-high     { background:#78350f; color:#fde68a; }
    .badge-done     { background:#14532d; color:#86efac; }
    .badge-tele     { background:#164e63; color:#67e8f9; }
  `],
  template: `
    <div class="backdrop" [class.open]="visible" (click)="close.emit()"></div>

    <div class="panel" [class.open]="visible" (keydown.escape)="close.emit()" tabindex="-1">
      <div class="handle"></div>

      @if (event) {
        <div class="panel-header">
          <span class="panel-title">{{ panelTitle() }}</span>
          <span class="panel-date">{{ event.event_at | date:'dd/MM/yyyy HH:mm' }}</span>
          <button class="close-btn" (click)="close.emit()"><mat-icon>close</mat-icon></button>
        </div>

        <div class="panel-body">
          @switch (event.event_type) {

            @case ('registered') {
              <div class="field">
                <div class="field-label">Nome</div>
                <div class="field-value">{{ event.payload['name'] }}</div>
              </div>
              <div class="field">
                <div class="field-label">Módulo</div>
                <div class="field-value">{{ event.payload['module'] }}</div>
              </div>
              <div class="field">
                <div class="field-label">Tipo</div>
                <div class="field-value">{{ event.payload['subject_type'] === 'animal' ? 'Animal' : 'Humano' }}</div>
              </div>
            }

            @case ('exam') {
              <div class="field">
                <div class="field-label">Tipo de arquivo</div>
                <div class="field-value">{{ event.payload['file_type'] ?? 'N/A' }}</div>
              </div>
              <div class="field">
                <div class="field-label">Status</div>
                <div class="field-value">{{ event.payload['status'] }}</div>
              </div>
              @if (event.payload['alert_level']) {
                <div class="field">
                  <div class="field-label">Alerta</div>
                  <div class="field-value">
                    <span class="badge"
                      [class.badge-critical]="event.payload['alert_level']==='critical'"
                      [class.badge-high]="event.payload['alert_level']==='high'">
                      {{ event.payload['alert_level'] }}
                    </span>
                  </div>
                </div>
              }
              <button class="action-btn" (click)="navigate('/results/' + event.payload['id'])">
                <mat-icon style="font-size:16px;width:16px;height:16px;">open_in_new</mat-icon>
                Ver resultados completos
              </button>
            }

            @case ('ai_analysis') {
              <div class="field">
                <div class="field-label">Agente</div>
                <div class="field-value">{{ event.payload['agent_type'] }}</div>
              </div>
              <button class="action-btn" (click)="navigate('/results/' + event.payload['exam_id'])">
                <mat-icon style="font-size:16px;width:16px;height:16px;">biotech</mat-icon>
                Ver exame associado
              </button>
            }

            @case ('appointment') {
              <div class="field">
                <div class="field-label">Tipo</div>
                <div class="field-value">{{ event.payload['appointment_type'] ?? 'N/A' }}</div>
              </div>
              <div class="field">
                <div class="field-label">Duração</div>
                <div class="field-value">{{ event.payload['duration_minutes'] }} min</div>
              </div>
              <div class="field">
                <div class="field-label">Status</div>
                <div class="field-value">{{ event.payload['status'] }}</div>
              </div>
              @if (event.payload['notes']) {
                <div class="field">
                  <div class="field-label">Notas</div>
                  <div class="field-value">{{ event.payload['notes'] }}</div>
                </div>
              }
            }

            @case ('video_consultation') {
              <div class="field">
                <div class="field-label">Modalidade</div>
                <div class="field-value">{{ event.payload['modality'] === 'complete' ? 'Completa (IA)' : 'Simples' }}</div>
              </div>
              <div class="field">
                <div class="field-label">Duração</div>
                <div class="field-value">
                  {{ event.payload['duration_seconds']
                    ? ((event.payload['duration_seconds'] / 60) | number:'1.0-0') + ' min'
                    : 'N/A' }}
                </div>
              </div>
              <div class="field">
                <div class="field-label">Créditos debitados</div>
                <div class="field-value">{{ event.payload['credits_debited'] ?? 0 }}</div>
              </div>
              <div class="field">
                <div class="field-label">Status</div>
                <div class="field-value">
                  <span class="badge badge-tele">{{ event.payload['status'] }}</span>
                </div>
              </div>
              @if (event.payload['encounter_id']) {
                <button class="action-btn" (click)="navigate('/clinic/encounters/' + event.payload['encounter_id'])">
                  <mat-icon style="font-size:16px;width:16px;height:16px;">description</mat-icon>
                  Abrir prontuário gerado pela IA
                </button>
              }
            }

            @case ('encounter') {
              @if (event.payload['chief_complaint']) {
                <div class="field">
                  <div class="field-label">Queixa principal</div>
                  <div class="field-value">{{ event.payload['chief_complaint'] }}</div>
                </div>
              }
              <div class="field">
                <div class="field-label">Origem</div>
                <div class="field-value">{{ event.payload['source'] === 'video_ai' ? 'IA de teleconsulta' : 'Manual' }}</div>
              </div>
              @if (event.payload['signed_at']) {
                <div class="field">
                  <div class="field-label">Assinado em</div>
                  <div class="field-value">{{ event.payload['signed_at'] | date:'dd/MM/yyyy HH:mm' }}</div>
                </div>
              }
              <button class="action-btn" (click)="navigate('/clinic/encounters/' + event.payload['id'])">
                <mat-icon style="font-size:16px;width:16px;height:16px;">open_in_new</mat-icon>
                Abrir prontuário completo
              </button>
            }

            @case ('prescription') {
              <div class="field">
                <div class="field-label">Itens prescritos</div>
                <div class="field-value">{{ event.payload['item_count'] }} item(s)</div>
              </div>
              @if (event.payload['agent_type']) {
                <div class="field">
                  <div class="field-label">Agente IA</div>
                  <div class="field-value">{{ event.payload['agent_type'] }}</div>
                </div>
              }
            }

            @case ('followup') {
              <div class="field">
                <div class="field-label">Tipo</div>
                <div class="field-value">{{ event.payload['notification_type'] }}</div>
              </div>
              <div class="field">
                <div class="field-label">Canal</div>
                <div class="field-value">{{ event.payload['channel'] }}</div>
              </div>
            }

          }
        </div>
      }
    </div>
  `
})
export class TimelinePanelComponent {
  @Input() event: TimelineEvent | null = null;
  @Input() visible = false;
  @Output() close = new EventEmitter<void>();

  private router = inject(Router);

  panelTitle(): string {
    if (!this.event) return '';
    const map: Record<string, string> = {
      registered: 'Cadastro', exam: 'Exame', ai_analysis: 'Análise IA',
      appointment: 'Agendamento', video_consultation: 'Teleconsulta',
      encounter: 'Prontuário', prescription: 'Prescrição', followup: 'Follow-up',
    };
    return map[this.event.event_type] ?? this.event.event_type;
  }

  navigate(path: string) {
    this.close.emit();
    this.router.navigate([path]);
  }
}
