import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

interface PortalProfile {
  tenant: { name: string; module: 'human' | 'veterinary'; whatsapp_phone: string | null };
  scope: 'subject' | 'owner';
  subject: any | null;
  owner: any | null;
  subjects: any[];
  expires_at: string;
}

interface Appointment {
  id: string;
  start_at: string;
  duration_minutes: number;
  status: string;
  appointment_type: string;
  reason: string | null;
  subject_id?: string;
  subject_name?: string;
}

interface Exam {
  id: string;
  subject_id: string;
  status: string;
  file_type: string | null;
  created_at: string;
}

interface Prescription {
  id: string;
  subject_id: string;
  agent_type: string;
  items: any[];
  notes: string | null;
  created_at: string;
}

interface Document {
  id: string;
  subject_id: string;
  doc_type: string;
  title: string;
  signed_at: string | null;
  pdf_s3_key: string | null;
  created_at: string;
}

interface Vaccine {
  id: string;
  subject_id: string;
  vaccine_name: string;
  manufacturer: string | null;
  applied_at: string;
  next_dose_date: string | null;
}

/**
 * Portal público read-only do tutor/paciente.
 * Mobile-first, sem Material pesado, lazy-loaded.
 * Acesso via /portal/:token (TTL 90 dias).
 */
@Component({
  selector: 'app-portal',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterModule],
  template: `
    <div class="portal">
      @if (loading()) {
        <div class="center"><p>Carregando…</p></div>
      } @else if (errorMsg()) {
        <div class="center error">
          <h1>Acesso indisponível</h1>
          <p>{{ errorMsg() }}</p>
        </div>
      } @else if (profile()) {
        <header class="hero">
          <div class="brand">{{ profile()!.tenant.name }}</div>
          <h1>
            @if (profile()!.scope === 'subject') {
              Olá, {{ profile()!.subject?.name }}
            } @else {
              Olá, {{ profile()!.owner?.name }}
            }
          </h1>
          @if (profile()!.scope === 'owner' && profile()!.subjects.length > 0) {
            <p class="meta">{{ profile()!.subjects.length }} animais sob seu cuidado</p>
          }
        </header>

        <nav class="tabs">
          <button [class.active]="activeTab() === 'agenda'" (click)="activeTab.set('agenda')">
            Agenda
          </button>
          <button [class.active]="activeTab() === 'exams'" (click)="activeTab.set('exams')">
            Exames
          </button>
          <button [class.active]="activeTab() === 'prescriptions'" (click)="activeTab.set('prescriptions')">
            Prescrições
          </button>
          <button [class.active]="activeTab() === 'documents'" (click)="activeTab.set('documents')">
            Documentos
          </button>
          @if (profile()!.tenant.module === 'veterinary') {
            <button [class.active]="activeTab() === 'vaccines'" (click)="activeTab.set('vaccines')">
              Vacinas
            </button>
          }
        </nav>

        <main class="content">
          @switch (activeTab()) {
            @case ('agenda') {
              @if (appointments().length === 0) {
                <p class="empty">Nenhuma consulta agendada.</p>
              } @else {
                <ul class="list">
                  @for (a of appointments(); track a.id) {
                    <li class="card">
                      <div class="row1">
                        <strong>{{ a.start_at | date:'dd/MM HH:mm' }}</strong>
                        <span class="status status-{{ a.status }}">{{ statusLabel(a.status) }}</span>
                      </div>
                      <div class="row2">
                        <span>{{ a.appointment_type }}</span>
                        @if (a.subject_name) { <span> · {{ a.subject_name }}</span> }
                        <span> · {{ a.duration_minutes }}min</span>
                      </div>
                      @if (a.reason) { <p class="reason">{{ a.reason }}</p> }
                    </li>
                  }
                </ul>
              }
            }
            @case ('exams') {
              @if (exams().length === 0) {
                <p class="empty">Nenhum exame disponível.</p>
              } @else {
                <ul class="list">
                  @for (e of exams(); track e.id) {
                    <li class="card">
                      <div class="row1">
                        <strong>{{ e.file_type ? (e.file_type | uppercase) : 'Exame' }}</strong>
                        <span class="status status-{{ e.status }}">{{ e.status }}</span>
                      </div>
                      <div class="row2">{{ e.created_at | date:'dd/MM/yyyy' }}</div>
                    </li>
                  }
                </ul>
              }
            }
            @case ('prescriptions') {
              @if (prescriptions().length === 0) {
                <p class="empty">Nenhuma prescrição disponível.</p>
              } @else {
                <ul class="list">
                  @for (p of prescriptions(); track p.id) {
                    <li class="card">
                      <div class="row1">
                        <strong>{{ p.agent_type === 'therapeutic' ? 'Terapêutica' : 'Nutrição' }}</strong>
                        <span class="meta">{{ p.created_at | date:'dd/MM/yyyy' }}</span>
                      </div>
                      <div class="row2">{{ (p.items?.length ?? 0) }} itens</div>
                      @if (p.notes) { <p class="reason">{{ p.notes }}</p> }
                    </li>
                  }
                </ul>
              }
            }
            @case ('documents') {
              @if (documents().length === 0) {
                <p class="empty">Nenhum documento emitido.</p>
              } @else {
                <ul class="list">
                  @for (d of documents(); track d.id) {
                    <li class="card">
                      <div class="row1">
                        <strong>{{ d.title }}</strong>
                        @if (d.signed_at) { <span class="signed">🔒 Assinado</span> }
                      </div>
                      <div class="row2">
                        <span>{{ docTypeLabel(d.doc_type) }}</span>
                        <span> · {{ d.created_at | date:'dd/MM/yyyy' }}</span>
                      </div>
                    </li>
                  }
                </ul>
              }
            }
            @case ('vaccines') {
              @if (vaccines().length === 0) {
                <p class="empty">Nenhuma vacina registrada.</p>
              } @else {
                <ul class="list">
                  @for (v of vaccines(); track v.id) {
                    <li class="card">
                      <div class="row1">
                        <strong>{{ v.vaccine_name }}</strong>
                      </div>
                      <div class="row2">
                        Aplicada {{ v.applied_at | date:'dd/MM/yyyy' }}
                        @if (v.manufacturer) { <span> · {{ v.manufacturer }}</span> }
                      </div>
                      @if (v.next_dose_date) {
                        <p class="next" [class.overdue]="isOverdue(v.next_dose_date)">
                          Próxima: {{ v.next_dose_date | date:'dd/MM/yyyy' }}
                        </p>
                      }
                    </li>
                  }
                </ul>
              }
            }
          }
        </main>

        @if (whatsappLink()) {
          <a [href]="whatsappLink()" target="_blank" rel="noopener" class="wa-btn">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            <span>Falar com {{ profile()!.tenant.name }}</span>
          </a>
        }
        <footer>
          <p>Portal — apenas leitura</p>
          <p class="muted">Acesso válido até {{ profile()!.expires_at | date:'dd/MM/yyyy' }}</p>
        </footer>
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #0b1326; color: #dbe2fd;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .portal { max-width: 480px; margin: 0 auto; padding: 16px; }
    .center { padding: 60px 16px; text-align: center; }
    .center h1 { font-size: 1.25rem; margin: 0 0 8px 0; }
    .center.error { color: #ffb4ab; }

    .hero { padding: 16px 0 20px; border-bottom: 1px solid rgba(192,193,255,0.1); margin-bottom: 16px; }
    .brand { font-size: 0.625rem; color: #c0c1ff; text-transform: uppercase; letter-spacing: 0.15em;
             font-family: 'JetBrains Mono', monospace; margin-bottom: 4px; }
    h1 { font-size: 1.5rem; margin: 0; font-weight: 700; }
    .meta { color: #c7c5d0; font-size: 0.875rem; margin: 4px 0 0; }

    .tabs { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 8px;
            border-bottom: 1px solid rgba(192,193,255,0.1); margin-bottom: 16px; }
    .tabs::-webkit-scrollbar { display: none; }
    .tabs button { padding: 8px 14px; background: transparent; color: #c7c5d0; border: none;
                   border-radius: 4px; cursor: pointer; font-size: 0.8125rem;
                   white-space: nowrap; flex-shrink: 0; }
    .tabs button.active { background: rgba(192,193,255,0.1); color: #c0c1ff; font-weight: 600; }

    .content { padding-bottom: 32px; }
    .empty { color: #c7c5d0; text-align: center; padding: 32px 16px; }
    .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .card { background: #171f33; border-radius: 6px; padding: 14px; border-left: 2px solid #c0c1ff; }
    .row1 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .row1 strong { font-size: 0.95rem; }
    .row2 { color: #c7c5d0; font-size: 0.8125rem; margin-top: 4px; }
    .reason { margin: 6px 0 0; font-size: 0.8125rem; color: #dbe2fd; }
    .next { margin: 6px 0 0; font-size: 0.8125rem; color: #88d8b0; }
    .next.overdue { color: #ff6b6b; }
    .status { font-size: 0.625rem; padding: 2px 8px; border-radius: 3px; text-transform: uppercase;
              font-family: 'JetBrains Mono', monospace; letter-spacing: 0.05em; }
    .status-scheduled { background: rgba(192,193,255,0.15); color: #c0c1ff; }
    .status-confirmed { background: rgba(136,216,176,0.15); color: #88d8b0; }
    .status-completed { background: rgba(136,216,176,0.15); color: #88d8b0; }
    .status-cancelled { background: rgba(255,107,107,0.15); color: #ff6b6b; }
    .status-done { background: rgba(136,216,176,0.15); color: #88d8b0; }
    .status-pending { background: rgba(255,209,102,0.15); color: #ffd166; }
    .status-processing { background: rgba(192,193,255,0.15); color: #c0c1ff; }
    .signed { color: #ffd166; font-size: 0.75rem; }

    .wa-btn { display: flex; align-items: center; justify-content: center; gap: 10px;
              padding: 14px 18px; margin: 24px 0 0;
              background: #25D366; color: #fff; text-decoration: none; border-radius: 8px;
              font-weight: 600; font-size: 0.95rem;
              box-shadow: 0 4px 12px rgba(37, 211, 102, 0.25);
              transition: transform 0.15s, box-shadow 0.15s; }
    .wa-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(37, 211, 102, 0.35); }
    .wa-btn svg { flex-shrink: 0; }
    footer { border-top: 1px solid rgba(192,193,255,0.1); padding: 16px 0; text-align: center;
             font-size: 0.75rem; color: #c7c5d0; margin-top: 24px; }
    footer p { margin: 0; }
    footer .muted { color: rgba(199,197,208,0.6); margin-top: 4px; font-size: 0.6875rem; }
  `]
})
export class PortalComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  token = '';
  profile = signal<PortalProfile | null>(null);
  appointments = signal<Appointment[]>([]);
  exams = signal<Exam[]>([]);
  prescriptions = signal<Prescription[]>([]);
  documents = signal<Document[]>([]);
  vaccines = signal<Vaccine[]>([]);
  loading = signal(true);
  errorMsg = signal('');
  activeTab = signal<'agenda' | 'exams' | 'prescriptions' | 'documents' | 'vaccines'>('agenda');

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    if (!this.token || !/^[a-f0-9]{32}$/i.test(this.token)) {
      this.loading.set(false);
      this.errorMsg.set('Link inválido.');
      return;
    }

    this.http.get<PortalProfile>(`${this.base}/portal/${this.token}`).subscribe({
      next: (p) => {
        this.profile.set(p);
        this.loading.set(false);
        // Carrega resto em paralelo
        this.loadAll();
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err?.error?.error || 'Não foi possível acessar o portal.';
        this.errorMsg.set(msg.includes('expirado') || msg.includes('inválido')
          ? 'Este link expirou ou foi revogado. Entre em contato com a clínica para um novo acesso.'
          : msg);
      },
    });
  }

  private loadAll() {
    const t = this.token;
    this.http.get<{items: Appointment[]}>(`${this.base}/portal/${t}/agenda`).subscribe({
      next: r => this.appointments.set(r.items || []), error: () => {},
    });
    this.http.get<{items: Exam[]}>(`${this.base}/portal/${t}/exams`).subscribe({
      next: r => this.exams.set(r.items || []), error: () => {},
    });
    this.http.get<{items: Prescription[]}>(`${this.base}/portal/${t}/prescriptions`).subscribe({
      next: r => this.prescriptions.set(r.items || []), error: () => {},
    });
    this.http.get<{items: Document[]}>(`${this.base}/portal/${t}/documents`).subscribe({
      next: r => this.documents.set(r.items || []), error: () => {},
    });
    if (this.profile()?.tenant.module === 'veterinary') {
      this.http.get<{items: Vaccine[]}>(`${this.base}/portal/${t}/vaccines`).subscribe({
        next: r => this.vaccines.set(r.items || []), error: () => {},
      });
    }
  }

  isOverdue(iso: string): boolean { return new Date(iso) < new Date(); }

  /**
   * Gera link wa.me se tenant tem whatsapp_phone configurado.
   * Normaliza pra E.164 (DDI 55 + DDD + número, sem pontuação).
   */
  whatsappLink(): string | null {
    const raw = this.profile()?.tenant.whatsapp_phone;
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10) return null;
    // Adiciona DDI 55 (Brasil) se não tem (10 ou 11 dígitos = só DDD+número)
    const e164 = digits.length === 13 || digits.length === 12 ? digits : '55' + digits;
    const tenantName = this.profile()?.tenant.name || '';
    const subjectName = this.profile()?.subject?.name || this.profile()?.owner?.name || '';
    const greet = subjectName ? `Olá! Sou ${subjectName}` : 'Olá!';
    const text = encodeURIComponent(`${greet}, vim pelo portal de ${tenantName}.`);
    return `https://wa.me/${e164}?text=${text}`;
  }

  statusLabel(s: string): string {
    return ({
      scheduled: 'Agendado',
      confirmed: 'Confirmado',
      completed: 'Realizado',
      cancelled: 'Cancelado',
      no_show: 'Não compareceu',
      blocked: 'Bloqueio',
    } as any)[s] || s;
  }

  docTypeLabel(t: string): string {
    return ({
      atestado: 'Atestado',
      pedido_exame: 'Pedido de exame',
      encaminhamento: 'Encaminhamento',
      relatorio: 'Relatório',
      termo_consentimento: 'Termo de consentimento',
    } as any)[t] || t;
  }
}
