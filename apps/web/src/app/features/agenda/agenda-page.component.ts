import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { AgendaService } from './agenda.service';
import {
  Appointment,
  ScheduleSettings,
  STATUS_COLORS,
  STATUS_LABELS,
} from './agenda.models';
import {
  QuickCreateDialogComponent,
  QuickCreateDialogData,
  QuickCreateDialogResult,
} from './quick-create-dialog.component';
import {
  EditAppointmentDialogComponent,
  EditAppointmentDialogData,
  EditAppointmentDialogResult,
} from './edit-appointment-dialog.component';
import {
  AgendaSettingsDialogComponent,
} from './settings-dialog.component';

interface SubjectMap { [id: string]: string; }

@Component({
  selector: 'app-agenda-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatIconModule, MatButtonModule, MatTooltipModule,
    MatDialogModule, MatSnackBarModule, MatMenuModule,
  ],
  styles: [`
    :host { display:flex; flex-direction:column; flex:1; overflow:hidden; background:#0b1326; color:#dae2fd; }

    .toolbar {
      display:flex; align-items:center; gap:0.75rem;
      padding:0.875rem 1.5rem;
      border-bottom:1px solid rgba(70,69,84,0.15);
    }
    .nav-btn {
      background:transparent; color:#c0c1ff; border:1px solid rgba(192,193,255,0.2);
      border-radius:5px; padding:0.375rem 0.625rem; cursor:pointer;
      display:flex; align-items:center;
    }
    .nav-btn:hover { background:rgba(192,193,255,0.08); }
    .nav-btn.today {
      font-family:'JetBrains Mono',monospace; font-size:11px; text-transform:uppercase;
      letter-spacing:0.06em; padding:0.375rem 0.875rem;
    }
    .range-label {
      font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:1rem;
      color:#dae2fd; flex:1; min-width:0;
    }
    .toolbar-spacer { flex:1; }
    .settings-btn { color:#c0c1ff; }

    .calendar-wrap {
      flex:1; overflow:auto;
      display:grid;
      grid-template-rows: auto 1fr;
    }
    .day-headers {
      display:grid;
      grid-template-columns: 60px repeat(7, 1fr);
      position:sticky; top:0; z-index:5;
      background:#0b1326;
      border-bottom:1px solid rgba(70,69,84,0.15);
    }
    .corner-cell { background:#0b1326; }
    .day-header {
      padding:0.5rem 0.5rem 0.625rem;
      text-align:center;
      border-left:1px solid rgba(70,69,84,0.12);
      font-family:'JetBrains Mono',monospace;
      font-size:10px; text-transform:uppercase; letter-spacing:0.08em;
      color:#908fa0;
    }
    .day-header strong { color:#dae2fd; font-size:1.125rem; display:block; margin-top:2px; font-weight:700; font-family:'Space Grotesk',sans-serif; }
    .day-header.today strong { color:#c0c1ff; }
    .day-header.today { background:rgba(192,193,255,0.05); }

    .grid {
      display:grid;
      grid-template-columns: 60px repeat(7, 1fr);
      position:relative;
    }
    .hour-label {
      padding:0.25rem 0.5rem 0;
      font-family:'JetBrains Mono',monospace;
      font-size:10px; color:#7c7b8f;
      text-align:right;
      border-right:1px solid rgba(70,69,84,0.12);
    }
    .day-column {
      position:relative;
      border-left:1px solid rgba(70,69,84,0.12);
      min-height:100%;
    }
    .hour-row {
      height:60px;
      border-bottom:1px solid rgba(70,69,84,0.10);
    }
    .hour-row.half { border-bottom-style:dashed; border-bottom-color:rgba(70,69,84,0.06); }
    .day-column.business {
      background: linear-gradient(180deg, transparent 0%, transparent 100%);
    }
    .business-overlay {
      position:absolute; left:0; right:0;
      background:rgba(73, 75, 214, 0.04);
      pointer-events:none;
    }

    .appt {
      position:absolute; left:4px; right:4px;
      border-left:3px solid;
      border-radius:4px;
      padding:4px 6px;
      font-size:11px;
      cursor:pointer;
      overflow:hidden;
      box-sizing:border-box;
      transition: transform 80ms;
      z-index:2;
    }
    .appt:hover { transform: translateX(1px); box-shadow:0 2px 6px rgba(0,0,0,0.3); }
    .appt-name { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .appt-time { font-family:'JetBrains Mono',monospace; font-size:10px; opacity:0.85; margin-top:1px; }
    .appt.cancelled { opacity:0.5; text-decoration:line-through; }
    .appt.blocked .appt-name { font-style:italic; }

    .empty-slot-hint {
      position:absolute; left:0; right:0; height:0;
      pointer-events:none;
    }
    .day-column.click-area:hover { background:rgba(192,193,255,0.025); cursor:pointer; }
    .day-column.click-area.no-business { cursor:not-allowed; }
    .day-column.click-area.no-business:hover { background:rgba(70,69,84,0.06); }

    .empty-state {
      grid-column: 1 / -1;
      text-align:center; padding:3rem 1rem;
      color:#7c7b8f; font-family:'JetBrains Mono',monospace; font-size:0.8125rem;
    }
  `],
  template: `
    <div class="toolbar">
      <button class="nav-btn" (click)="prevWeek()" matTooltip="Semana anterior (←)">
        <mat-icon>chevron_left</mat-icon>
      </button>
      <button class="nav-btn today" (click)="goToToday()">Hoje</button>
      <button class="nav-btn" (click)="nextWeek()" matTooltip="Próxima semana (→)">
        <mat-icon>chevron_right</mat-icon>
      </button>
      <span class="range-label">{{ rangeLabel() }}</span>
      <div class="toolbar-spacer"></div>
      <button mat-icon-button class="settings-btn" (click)="openSettings()" matTooltip="Configurações da agenda">
        <mat-icon>settings</mat-icon>
      </button>
    </div>

    <div class="calendar-wrap">
      <div class="day-headers">
        <div class="corner-cell"></div>
        @for (day of weekDays(); track day.iso) {
          <div class="day-header" [class.today]="day.isToday">
            {{ day.weekday }}
            <strong>{{ day.dayNumber }}</strong>
          </div>
        }
      </div>

      <div class="grid">
        <div>
          @for (h of hourLabels(); track h) {
            <div class="hour-label" style="height:60px">{{ h }}</div>
          }
        </div>

        @for (day of weekDays(); track day.iso) {
          <div class="day-column click-area"
               [class.no-business]="!day.hasBusinessHours"
               (click)="onDayClick($event, day.iso)">
            @for (h of hourLabels(); track h; let i = $index) {
              <div class="hour-row" [class.half]="i % 2 === 1"></div>
            }
            @for (window of day.businessWindows; track window.top) {
              <div class="business-overlay"
                   [style.top.px]="window.top"
                   [style.height.px]="window.height"></div>
            }
            @for (a of day.appointments; track a.id) {
              <div class="appt"
                   [class.cancelled]="a.status === 'cancelled'"
                   [class.blocked]="a.status === 'blocked'"
                   [style.top.px]="a._top"
                   [style.height.px]="a._height"
                   [style.background]="colorBg(a)"
                   [style.border-left-color]="colorBorder(a)"
                   [style.color]="colorText(a)"
                   (click)="$event.stopPropagation(); openEdit(a)">
                <div class="appt-name">
                  @if (a.status === 'blocked') {
                    🚫 {{ a.reason || 'Bloqueado' }}
                  } @else {
                    {{ a.subject_name || '(sem nome)' }}
                  }
                </div>
                <div class="appt-time">{{ formatTime(a.start_at) }} · {{ a.duration_minutes }}min · {{ statusLabel(a.status) }}</div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class AgendaPageComponent implements OnInit, OnDestroy {
  private agenda = inject(AgendaService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private http = inject(HttpClient);
  auth = inject(AuthService);

  // Hours visible in grid: 7h–22h = 15 rows (60px each = 900px)
  private readonly HOUR_START = 7;
  private readonly HOUR_END = 22;
  private readonly PIXELS_PER_MINUTE = 1; // 60px / 60min

  weekStart = signal<Date>(this.startOfWeek(new Date()));
  appointments = signal<Appointment[]>([]);
  settings = signal<ScheduleSettings | null>(null);
  subjectMap = signal<SubjectMap>({});

  hourLabels = computed(() => {
    const arr: string[] = [];
    for (let h = this.HOUR_START; h < this.HOUR_END; h++) {
      arr.push(`${String(h).padStart(2, '0')}:00`);
    }
    return arr;
  });

  weekDays = computed(() => {
    const start = this.weekStart();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const settings = this.settings();
    const subjMap = this.subjectMap();
    const apptsAll = this.appointments();
    const dayKeys: ('mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun')[] = ['mon','tue','wed','thu','fri','sat','sun'];
    const weekdayLabels = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

    return dayKeys.map((dk, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const iso = day.toISOString().slice(0, 10);
      const isToday = day.getTime() === today.getTime();

      const windows = settings?.business_hours?.[dk] || [];
      const businessWindows = windows.map(([s, e]) => {
        const [sh, sm] = s.split(':').map(Number);
        const [eh, em] = e.split(':').map(Number);
        return {
          top: ((sh - this.HOUR_START) * 60 + sm) * this.PIXELS_PER_MINUTE,
          height: ((eh - sh) * 60 + (em - sm)) * this.PIXELS_PER_MINUTE,
        };
      });

      const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
      const appointments = apptsAll
        .filter(a => {
          const aDate = new Date(a.start_at);
          return aDate >= dayStart && aDate <= dayEnd;
        })
        .map(a => {
          const aDate = new Date(a.start_at);
          const minutesFromStart = (aDate.getHours() - this.HOUR_START) * 60 + aDate.getMinutes();
          return {
            ...a,
            subject_name: a.subject_id ? (subjMap[a.subject_id] || a.subject_name || 'Paciente') : null,
            _top: Math.max(0, minutesFromStart * this.PIXELS_PER_MINUTE),
            _height: Math.max(28, a.duration_minutes * this.PIXELS_PER_MINUTE - 2),
          } as any;
        });

      return {
        iso,
        weekday: weekdayLabels[i],
        dayNumber: String(day.getDate()).padStart(2, '0') + '/' + String(day.getMonth() + 1).padStart(2, '0'),
        isToday,
        hasBusinessHours: windows.length > 0,
        businessWindows,
        appointments,
      };
    });
  });

  rangeLabel = computed(() => {
    const start = this.weekStart();
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    return `${fmt(start)} – ${fmt(end)} ${end.getFullYear()}`;
  });

  private subs = new Subscription();

  ngOnInit() {
    this.loadSettings();
    this.loadSubjects();
    this.loadWeek();
  }
  ngOnDestroy() { this.subs.unsubscribe(); }

  private startOfWeek(d: Date): Date {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // segunda
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  private loadSettings() {
    this.agenda.getSettings().subscribe({
      next: s => this.settings.set(s),
      error: () => {}
    });
  }

  private loadSubjects() {
    this.http.get<any[]>(`${environment.apiUrl}/patients`).subscribe({
      next: list => {
        const map: SubjectMap = {};
        for (const s of list || []) map[s.id] = s.name;
        this.subjectMap.set(map);
      },
      error: () => {}
    });
  }

  private loadWeek() {
    const start = this.weekStart();
    const end = new Date(start); end.setDate(end.getDate() + 7);
    this.agenda.listAppointments(start.toISOString(), end.toISOString()).subscribe({
      next: r => this.appointments.set(r.results || []),
      error: () => this.snack.open('Erro ao carregar agenda.', 'Fechar', { duration: 4000 })
    });
  }

  prevWeek() {
    const w = new Date(this.weekStart()); w.setDate(w.getDate() - 7);
    this.weekStart.set(w);
    this.loadWeek();
  }
  nextWeek() {
    const w = new Date(this.weekStart()); w.setDate(w.getDate() + 7);
    this.weekStart.set(w);
    this.loadWeek();
  }
  goToToday() {
    this.weekStart.set(this.startOfWeek(new Date()));
    this.loadWeek();
  }

  onDayClick(evt: MouseEvent, dayIso: string) {
    const target = evt.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const offsetY = evt.clientY - rect.top;
    // Snap a 30 min: cada 30 min são 30px
    const totalMinFromStart = Math.floor(offsetY / 30) * 30;
    const hour = this.HOUR_START + Math.floor(totalMinFromStart / 60);
    const minute = totalMinFromStart % 60;
    if (hour < this.HOUR_START || hour >= this.HOUR_END) return;

    const start = new Date(`${dayIso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
    const dialogData: QuickCreateDialogData = {
      start_at: start.toISOString(),
      default_duration_minutes: this.settings()?.default_slot_minutes || 30,
    };
    this.dialog.open<QuickCreateDialogComponent, QuickCreateDialogData, QuickCreateDialogResult>(
      QuickCreateDialogComponent,
      { panelClass: 'dark-dialog', autoFocus: false, data: dialogData }
    ).afterClosed().subscribe(result => {
      if (result?.created) {
        this.loadWeek();
        this.snack.open('Agendamento criado.', '', { duration: 2500 });
      }
    });
  }

  openEdit(appt: Appointment) {
    const subjMap = this.subjectMap();
    const data: EditAppointmentDialogData = {
      appointment: appt,
      subject_name: appt.subject_id ? subjMap[appt.subject_id] : undefined,
    };
    this.dialog.open<EditAppointmentDialogComponent, EditAppointmentDialogData, EditAppointmentDialogResult>(
      EditAppointmentDialogComponent,
      { panelClass: 'dark-dialog', autoFocus: false, data }
    ).afterClosed().subscribe(result => {
      if (result) {
        this.loadWeek();
        if (result.action === 'updated') this.snack.open('Atualizado.', '', { duration: 2000 });
        if (result.action === 'cancelled') this.snack.open('Cancelado.', '', { duration: 2000 });
        if (result.action === 'deleted') this.snack.open('Bloqueio removido.', '', { duration: 2000 });
      }
    });
  }

  openSettings() {
    this.dialog.open(AgendaSettingsDialogComponent, {
      panelClass: 'dark-dialog',
      autoFocus: false,
      data: { settings: this.settings() },
    }).afterClosed().subscribe(saved => {
      if (saved) {
        this.settings.set(saved);
        this.snack.open('Configurações salvas.', '', { duration: 2500 });
      }
    });
  }

  // ── Helpers ────────────────────────────────────
  colorBg(a: Appointment): string { return STATUS_COLORS[a.status].bg; }
  colorBorder(a: Appointment): string { return STATUS_COLORS[a.status].border; }
  colorText(a: Appointment): string { return STATUS_COLORS[a.status].text; }
  statusLabel(s: any): string { return STATUS_LABELS[s as keyof typeof STATUS_LABELS] || s; }
  formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
}
