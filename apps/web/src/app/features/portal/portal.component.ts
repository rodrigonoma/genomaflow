import { Component, OnInit, computed, signal, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

interface Tenant {
  name: string;
  module: 'human' | 'veterinary';
  whatsapp_phone: string | null;
  clinic_logo_url: string | null;
}

interface PortalProfile {
  tenant: Tenant;
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

interface PortalDocument {
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

type TabId = 'agenda' | 'exams' | 'prescriptions' | 'documents' | 'vaccines';

/**
 * Portal público read-only do tutor/paciente — redesign 2026-05-05.
 *
 * Movimentos: hero rico (logo + saudação contextual + próxima consulta),
 * dashboard de resumo, cards com ícone + hierarquia, empty states humanizados,
 * responsivo desktop (até 960px). Acesso via /portal/:token (TTL 90 dias).
 */
@Component({
  selector: 'app-portal',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterModule],
  template: `
    <div class="portal-bg">
      <div class="portal">
        @if (loading()) {
          <div class="skeleton-wrap">
            <div class="skel skel-hero"></div>
            <div class="skel skel-summary"></div>
            <div class="skel skel-card"></div>
            <div class="skel skel-card"></div>
          </div>
        } @else if (errorMsg()) {
          <div class="center error-state">
            <svg viewBox="0 0 64 64" width="80" height="80" aria-hidden="true">
              <circle cx="32" cy="32" r="28" fill="none" stroke="#ff6b6b" stroke-width="2" opacity="0.4"/>
              <path d="M32 18v18M32 42v2" stroke="#ff6b6b" stroke-width="3" stroke-linecap="round"/>
            </svg>
            <h1>Acesso indisponível</h1>
            <p>{{ errorMsg() }}</p>
          </div>
        } @else if (profile()) {
          <!-- ── HERO ─────────────────────────────────────── -->
          <header class="hero">
            <div class="hero-aurora"></div>
            <div class="hero-content">
              <div class="brand-row">
                @if (profile()!.tenant.clinic_logo_url) {
                  <img class="brand-logo" [src]="profile()!.tenant.clinic_logo_url!" alt=""/>
                } @else {
                  <div class="brand-placeholder">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                      <path d="M19 8h-2V3H7v5H5c-1.1 0-2 .9-2 2v9h18v-9c0-1.1-.9-2-2-2zM9 5h6v3H9V5zm10 14H5v-7h14v7z"/>
                    </svg>
                  </div>
                }
                <div class="brand-text">
                  <span class="brand-label">Portal · {{ profile()!.tenant.name }}</span>
                  <span class="brand-mod">{{ profile()!.tenant.module === 'veterinary' ? 'Clínica veterinária' : 'Cuidados em saúde' }}</span>
                </div>
              </div>

              <h1 class="greeting">{{ greeting() }},<br/><span class="greeting-name">{{ greetingName() }}</span></h1>

              @if (profile()!.scope === 'owner' && profile()!.subjects.length > 0) {
                <p class="subjects-pill">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <path d="M4.5 9.5c0-1.65 1.35-3 3-3s3 1.35 3 3-1.35 3-3 3-3-1.35-3-3zm9.4 7.27c-1.06-.62-2.6-1.27-3.9-1.27s-2.84.65-3.9 1.27c-.84.49-1.34 1.4-1.34 2.36V20h10.48v-.87c0-.95-.5-1.87-1.34-2.36zm6.13-1.27c1.84 0 3.97 1.35 3.97 2.5V20H20v-2.5c0-.81-.34-1.55-.97-2.27.31-.13.65-.23.97-.23zm-3-3c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3z"/>
                  </svg>
                  {{ profile()!.subjects.length }} {{ profile()!.subjects.length === 1 ? 'animal' : 'animais' }} sob seu cuidado
                </p>
              }

              @if (nextAppointment(); as next) {
                <div class="next-banner" (click)="activeTab.set('agenda')" role="button" tabindex="0">
                  <div class="next-icon">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z"/>
                    </svg>
                  </div>
                  <div class="next-text">
                    <span class="next-label">Próxima consulta {{ relativeDate(next.start_at) }}</span>
                    <span class="next-meta">{{ next.start_at | date:'dd MMM, HH:mm' }} · {{ next.appointment_type }}</span>
                  </div>
                  <svg class="next-arrow" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/>
                  </svg>
                </div>
              }
            </div>
          </header>

          <!-- ── SUMMARY CARDS (above-fold) ──────────────── -->
          <section class="summary">
            <button class="summary-card" (click)="activeTab.set('exams')">
              <div class="sc-icon sc-icon--exams">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                  <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z"/>
                </svg>
              </div>
              <div class="sc-content">
                <span class="sc-num">{{ exams().length }}</span>
                <span class="sc-label">{{ exams().length === 1 ? 'Exame' : 'Exames' }}</span>
              </div>
            </button>

            <button class="summary-card" (click)="activeTab.set('prescriptions')">
              <div class="sc-icon sc-icon--rx">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                  <path d="M17.81 4.47c-.08 0-.16-.02-.23-.06C15.66 3.42 14 3 12.01 3c-1.98 0-3.86.47-5.57 1.41-.24.13-.54.04-.68-.2-.13-.24-.04-.55.2-.68C7.82 2.52 9.86 2 12.01 2c2.13 0 3.99.47 6.03 1.52.25.13.34.43.21.67-.09.18-.26.28-.44.28zM3.5 9.72c-.1 0-.2-.03-.29-.09-.23-.16-.28-.47-.12-.7.99-1.4 2.25-2.5 3.75-3.27C9.98 4.04 14 4.03 17.15 5.65c1.5.77 2.76 1.86 3.75 3.25.16.22.11.54-.12.7-.23.16-.54.11-.7-.12-.9-1.26-2.04-2.25-3.39-2.94-2.87-1.47-6.54-1.47-9.4.01-1.36.7-2.5 1.7-3.4 2.96-.08.14-.23.21-.39.21zm6.25 12.07c-.13 0-.26-.05-.35-.15-.87-.87-1.34-1.43-2.01-2.64-.69-1.23-1.05-2.73-1.05-4.34 0-2.97 2.54-5.39 5.66-5.39s5.66 2.42 5.66 5.39c0 .28-.22.5-.5.5s-.5-.22-.5-.5c0-2.42-2.09-4.39-4.66-4.39-2.57 0-4.66 1.97-4.66 4.39 0 1.44.32 2.77.93 3.85.64 1.15 1.08 1.64 1.85 2.42.19.2.19.51 0 .71-.11.1-.24.15-.37.15z"/>
                </svg>
              </div>
              <div class="sc-content">
                <span class="sc-num">{{ prescriptions().length }}</span>
                <span class="sc-label">{{ prescriptions().length === 1 ? 'Prescrição' : 'Prescrições' }}</span>
              </div>
            </button>

            <button class="summary-card" (click)="activeTab.set('documents')">
              <div class="sc-icon sc-icon--docs">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                  <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>
                </svg>
              </div>
              <div class="sc-content">
                <span class="sc-num">{{ documents().length }}</span>
                <span class="sc-label">{{ documents().length === 1 ? 'Documento' : 'Documentos' }}</span>
              </div>
            </button>

            @if (profile()!.tenant.module === 'veterinary') {
              <button class="summary-card" [class.has-alert]="overdueVaccinesCount() > 0" (click)="activeTab.set('vaccines')">
                <div class="sc-icon sc-icon--vax">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                    <path d="M19.81 9.5L20.91 8.39C21.3 8 21.3 7.37 20.91 6.97L17.03 3.09C16.64 2.7 16 2.7 15.61 3.09L14.5 4.19L19.81 9.5M14.5 7L4 17.5V20H6.5L17 9.5L14.5 7M11 7H7V3H5V7H1V9H5V13H7V9H11V7Z"/>
                  </svg>
                </div>
                <div class="sc-content">
                  <span class="sc-num">{{ overdueVaccinesCount() || vaccines().length }}</span>
                  <span class="sc-label">
                    @if (overdueVaccinesCount() > 0) { Vacinas atrasadas }
                    @else { {{ vaccines().length === 1 ? 'Vacina' : 'Vacinas' }} }
                  </span>
                </div>
              </button>
            }
          </section>

          <!-- ── TABS NAV ────────────────────────────────── -->
          <nav class="tabs">
            <button [class.active]="activeTab() === 'agenda'" (click)="activeTab.set('agenda')">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5zm2 4h5v5H7z"/></svg>
              <span>Agenda</span>
              @if (appointments().length > 0) { <em class="count">{{ appointments().length }}</em> }
            </button>
            <button [class.active]="activeTab() === 'exams'" (click)="activeTab.set('exams')">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z"/></svg>
              <span>Exames</span>
              @if (exams().length > 0) { <em class="count">{{ exams().length }}</em> }
            </button>
            <button [class.active]="activeTab() === 'prescriptions'" (click)="activeTab.set('prescriptions')">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4.22 11.29l1.41 1.41 5.66-5.66c1.17-1.17 3.07-1.17 4.24 0s1.17 3.07 0 4.24l-5.66 5.66 2.83 2.83c.39.39 1.02.39 1.41 0l8.49-8.49c.39-.39.39-1.02 0-1.41L18.84 5l1.42-1.42L18.84 2.16 17.42 3.58 16 2.16l-1.41 1.41L13.17 2.16 11.76 3.58l1.41 1.41-2.13 2.13c-1.95 1.95-1.95 5.12 0 7.07z"/></svg>
              <span>Prescrições</span>
              @if (prescriptions().length > 0) { <em class="count">{{ prescriptions().length }}</em> }
            </button>
            <button [class.active]="activeTab() === 'documents'" (click)="activeTab.set('documents')">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
              <span>Documentos</span>
              @if (documents().length > 0) { <em class="count">{{ documents().length }}</em> }
            </button>
            @if (profile()!.tenant.module === 'veterinary') {
              <button [class.active]="activeTab() === 'vaccines'" (click)="activeTab.set('vaccines')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19.81 9.5L20.91 8.39C21.3 8 21.3 7.37 20.91 6.97L17.03 3.09C16.64 2.7 16 2.7 15.61 3.09L14.5 4.19L19.81 9.5M14.5 7L4 17.5V20H6.5L17 9.5L14.5 7Z"/></svg>
                <span>Vacinas</span>
                @if (vaccines().length > 0) { <em class="count" [class.alert]="overdueVaccinesCount() > 0">{{ vaccines().length }}</em> }
              </button>
            }
          </nav>

          <!-- ── CONTENT ─────────────────────────────────── -->
          <main class="content">
            @switch (activeTab()) {
              @case ('agenda') {
                @if (appointments().length === 0) {
                  <div class="empty-state">
                    <div class="empty-illustration">
                      <svg viewBox="0 0 80 80" width="100" height="100" aria-hidden="true">
                        <rect x="14" y="18" width="52" height="48" rx="4" fill="none" stroke="#c0c1ff" stroke-width="2" opacity="0.6"/>
                        <line x1="14" y1="30" x2="66" y2="30" stroke="#c0c1ff" stroke-width="2" opacity="0.6"/>
                        <circle cx="26" cy="14" r="3" fill="#c0c1ff" opacity="0.6"/>
                        <circle cx="54" cy="14" r="3" fill="#c0c1ff" opacity="0.6"/>
                        <line x1="26" y1="14" x2="26" y2="22" stroke="#c0c1ff" stroke-width="2" opacity="0.6"/>
                        <line x1="54" y1="14" x2="54" y2="22" stroke="#c0c1ff" stroke-width="2" opacity="0.6"/>
                      </svg>
                    </div>
                    <h3>Nenhuma consulta agendada</h3>
                    <p>Quando uma consulta for marcada, ela aparece aqui.</p>
                    @if (whatsappLink()) {
                      <a [href]="whatsappLink()" target="_blank" rel="noopener" class="empty-cta">
                        Falar com a clínica
                      </a>
                    }
                  </div>
                } @else {
                  <ul class="list">
                    @for (a of appointments(); track a.id) {
                      <li class="card card-appointment" [class.is-past]="isPast(a.start_at)" [class.is-today]="isToday(a.start_at)">
                        <div class="card-side"></div>
                        <div class="card-body">
                          <div class="card-head">
                            <div class="card-title">
                              <strong>{{ a.appointment_type }}</strong>
                              @if (a.subject_name) {
                                <span class="card-sub">· {{ a.subject_name }}</span>
                              }
                            </div>
                            <span class="status status-{{ a.status }}">{{ statusLabel(a.status) }}</span>
                          </div>
                          <div class="card-meta">
                            <span class="meta-chip">
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z"/></svg>
                              {{ a.start_at | date:'dd MMM, HH:mm' }}
                            </span>
                            <span class="meta-chip">{{ a.duration_minutes }} min</span>
                            @if (isToday(a.start_at)) { <span class="meta-chip chip-accent">Hoje</span> }
                          </div>
                          @if (a.reason) { <p class="card-note">{{ a.reason }}</p> }
                        </div>
                      </li>
                    }
                  </ul>
                }
              }

              @case ('exams') {
                @if (exams().length === 0) {
                  <div class="empty-state">
                    <div class="empty-illustration">
                      <svg viewBox="0 0 80 80" width="100" height="100" aria-hidden="true">
                        <rect x="20" y="14" width="40" height="56" rx="3" fill="none" stroke="#c0c1ff" stroke-width="2" opacity="0.6"/>
                        <line x1="28" y1="28" x2="52" y2="28" stroke="#c0c1ff" stroke-width="2" opacity="0.5"/>
                        <line x1="28" y1="36" x2="52" y2="36" stroke="#c0c1ff" stroke-width="2" opacity="0.5"/>
                        <line x1="28" y1="44" x2="44" y2="44" stroke="#c0c1ff" stroke-width="2" opacity="0.5"/>
                      </svg>
                    </div>
                    <h3>Nenhum exame disponível</h3>
                    <p>Seus resultados aparecem aqui assim que forem processados.</p>
                  </div>
                } @else {
                  <ul class="list">
                    @for (e of exams(); track e.id) {
                      <li class="card card-exam">
                        <div class="card-icon-block">
                          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z"/>
                          </svg>
                        </div>
                        <div class="card-body">
                          <div class="card-head">
                            <strong>{{ e.file_type ? (e.file_type | uppercase) : 'Exame' }}</strong>
                            <span class="status status-{{ e.status }}">{{ examStatusLabel(e.status) }}</span>
                          </div>
                          <div class="card-meta">
                            <span class="meta-chip">{{ e.created_at | date:'dd MMM yyyy' }}</span>
                          </div>
                        </div>
                      </li>
                    }
                  </ul>
                }
              }

              @case ('prescriptions') {
                @if (prescriptions().length === 0) {
                  <div class="empty-state">
                    <div class="empty-illustration">
                      <svg viewBox="0 0 80 80" width="100" height="100" aria-hidden="true">
                        <rect x="22" y="18" width="36" height="44" rx="18" fill="none" stroke="#c0c1ff" stroke-width="2" opacity="0.6"/>
                        <line x1="22" y1="40" x2="58" y2="40" stroke="#c0c1ff" stroke-width="2" opacity="0.5"/>
                      </svg>
                    </div>
                    <h3>Nenhuma prescrição disponível</h3>
                    <p>Receitas e planos terapêuticos ficam disponíveis aqui.</p>
                  </div>
                } @else {
                  <ul class="list">
                    @for (p of prescriptions(); track p.id) {
                      <li class="card card-rx">
                        <div class="card-icon-block icon-rx">
                          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                            <path d="M4.22 11.29l1.41 1.41 5.66-5.66c1.17-1.17 3.07-1.17 4.24 0s1.17 3.07 0 4.24l-5.66 5.66 2.83 2.83c.39.39 1.02.39 1.41 0l8.49-8.49c.39-.39.39-1.02 0-1.41z"/>
                          </svg>
                        </div>
                        <div class="card-body">
                          <div class="card-head">
                            <strong>{{ p.agent_type === 'therapeutic' ? 'Prescrição Terapêutica' : 'Plano Nutricional' }}</strong>
                            <span class="meta-chip">{{ (p.items?.length ?? 0) }} {{ (p.items?.length ?? 0) === 1 ? 'item' : 'itens' }}</span>
                          </div>
                          <div class="card-meta">
                            <span class="meta-chip">{{ p.created_at | date:'dd MMM yyyy' }}</span>
                          </div>
                          @if (p.notes) { <p class="card-note">{{ p.notes }}</p> }
                        </div>
                      </li>
                    }
                  </ul>
                }
              }

              @case ('documents') {
                @if (documents().length === 0) {
                  <div class="empty-state">
                    <div class="empty-illustration">
                      <svg viewBox="0 0 80 80" width="100" height="100" aria-hidden="true">
                        <path d="M28 14h18l10 12v40c0 2-2 4-4 4H28c-2 0-4-2-4-4V18c0-2 2-4 4-4z" fill="none" stroke="#c0c1ff" stroke-width="2" opacity="0.6"/>
                        <path d="M46 14v12h10" fill="none" stroke="#c0c1ff" stroke-width="2" opacity="0.6"/>
                        <line x1="32" y1="40" x2="48" y2="40" stroke="#c0c1ff" stroke-width="2" opacity="0.5"/>
                        <line x1="32" y1="48" x2="48" y2="48" stroke="#c0c1ff" stroke-width="2" opacity="0.5"/>
                      </svg>
                    </div>
                    <h3>Nenhum documento emitido</h3>
                    <p>Atestados, pedidos de exame e relatórios aparecem aqui.</p>
                  </div>
                } @else {
                  <ul class="list">
                    @for (d of documents(); track d.id) {
                      <li class="card card-doc">
                        <div class="card-icon-block icon-doc">
                          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>
                          </svg>
                        </div>
                        <div class="card-body">
                          <div class="card-head">
                            <strong>{{ d.title }}</strong>
                            @if (d.signed_at) {
                              <span class="badge-signed" title="Assinado em {{ d.signed_at | date:'dd/MM/yyyy' }}">
                                <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                                Assinado
                              </span>
                            }
                          </div>
                          <div class="card-meta">
                            <span class="meta-chip">{{ docTypeLabel(d.doc_type) }}</span>
                            <span class="meta-chip">{{ d.created_at | date:'dd MMM yyyy' }}</span>
                          </div>
                        </div>
                      </li>
                    }
                  </ul>
                }
              }

              @case ('vaccines') {
                @if (vaccines().length === 0) {
                  <div class="empty-state">
                    <div class="empty-illustration">
                      <svg viewBox="0 0 80 80" width="100" height="100" aria-hidden="true">
                        <path d="M20 60l24-24M40 32l8 8M32 40l8 8M48 16l16 16-8 8-16-16z" fill="none" stroke="#c0c1ff" stroke-width="2" opacity="0.6"/>
                      </svg>
                    </div>
                    <h3>Nenhuma vacina registrada</h3>
                    <p>O histórico de vacinação aparece aqui após a aplicação.</p>
                  </div>
                } @else {
                  <ul class="list">
                    @for (v of vaccines(); track v.id) {
                      <li class="card card-vax" [class.is-overdue]="v.next_dose_date && isOverdue(v.next_dose_date)">
                        <div class="card-icon-block icon-vax">
                          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                            <path d="M19.81 9.5L20.91 8.39C21.3 8 21.3 7.37 20.91 6.97L17.03 3.09C16.64 2.7 16 2.7 15.61 3.09L14.5 4.19L19.81 9.5M14.5 7L4 17.5V20H6.5L17 9.5L14.5 7Z"/>
                          </svg>
                        </div>
                        <div class="card-body">
                          <div class="card-head">
                            <strong>{{ v.vaccine_name }}</strong>
                            @if (v.next_dose_date && isOverdue(v.next_dose_date)) {
                              <span class="badge-alert">⚠ Atrasada</span>
                            } @else if (v.next_dose_date) {
                              <span class="badge-upcoming">Em dia</span>
                            }
                          </div>
                          <div class="card-meta">
                            <span class="meta-chip">Aplicada {{ v.applied_at | date:'dd MMM yyyy' }}</span>
                            @if (v.manufacturer) { <span class="meta-chip">{{ v.manufacturer }}</span> }
                          </div>
                          @if (v.next_dose_date) {
                            <p class="card-note" [class.note-warn]="isOverdue(v.next_dose_date)">
                              Próxima dose: {{ v.next_dose_date | date:'dd MMM yyyy' }}
                            </p>
                          }
                        </div>
                      </li>
                    }
                  </ul>
                }
              }
            }
          </main>

          <!-- ── WHATSAPP STICKY CTA ─────────────────────── -->
          @if (whatsappLink()) {
            <a [href]="whatsappLink()" target="_blank" rel="noopener" class="wa-fab" [attr.aria-label]="'Falar com ' + profile()!.tenant.name">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              <span class="wa-text">Falar com a clínica</span>
            </a>
          }

          <!-- ── FOOTER ──────────────────────────────────── -->
          <footer>
            <div class="footer-row">
              <span>Portal · acesso somente leitura</span>
              <span class="dot">·</span>
              <span class="muted">Expira em {{ profile()!.expires_at | date:'dd/MM/yyyy' }}</span>
            </div>
            <div class="footer-row footer-brand">
              <span class="muted">Powered by</span>
              <strong>GenomaFlow</strong>
            </div>
          </footer>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; color: #dbe2fd;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif; }
    .portal-bg {
      min-height: 100vh;
      background:
        radial-gradient(ellipse at top right, rgba(192,193,255,0.08), transparent 50%),
        radial-gradient(ellipse at bottom left, rgba(74,214,160,0.05), transparent 50%),
        #0b1326;
    }
    .portal { max-width: 960px; margin: 0 auto; padding: 16px; padding-bottom: 100px; }

    /* ── Skeleton ───────────────────────────────────────── */
    .skeleton-wrap { display: flex; flex-direction: column; gap: 12px; padding-top: 24px; }
    .skel { background: linear-gradient(90deg, #131b2e 0%, #1a2238 50%, #131b2e 100%);
             background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 8px; }
    .skel-hero    { height: 180px; }
    .skel-summary { height: 90px; }
    .skel-card    { height: 84px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    /* ── Error state ────────────────────────────────────── */
    .center { padding: 80px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .center h1 { font-size: 1.375rem; margin: 0; font-weight: 700; }
    .center p { color: #c7c5d0; margin: 0; max-width: 420px; }
    .error-state h1 { color: #ffb4ab; }

    /* ── Hero ───────────────────────────────────────────── */
    .hero {
      position: relative;
      padding: 32px 20px 24px;
      border-radius: 14px;
      overflow: hidden;
      background: linear-gradient(135deg, rgba(73,75,214,0.18), rgba(192,193,255,0.06));
      border: 1px solid rgba(192,193,255,0.12);
      margin-bottom: 16px;
    }
    .hero-aurora {
      position: absolute; inset: 0; pointer-events: none; opacity: 0.6;
      background:
        radial-gradient(circle at 20% 0%, rgba(192,193,255,0.35), transparent 40%),
        radial-gradient(circle at 80% 100%, rgba(74,214,160,0.18), transparent 50%);
    }
    .hero-content { position: relative; z-index: 1; }
    .brand-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
    .brand-logo {
      width: 36px; height: 36px; border-radius: 8px; object-fit: cover;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(192,193,255,0.18);
    }
    .brand-placeholder {
      width: 36px; height: 36px; border-radius: 8px;
      background: rgba(192,193,255,0.12);
      display: flex; align-items: center; justify-content: center;
      color: #c0c1ff;
      border: 1px solid rgba(192,193,255,0.18);
    }
    .brand-text { display: flex; flex-direction: column; gap: 2px; }
    .brand-label { font-size: 0.6875rem; color: #c0c1ff; text-transform: uppercase; letter-spacing: 0.12em;
                   font-family: 'JetBrains Mono', monospace; font-weight: 600; }
    .brand-mod { font-size: 0.6875rem; color: rgba(199,197,208,0.7); }

    .greeting {
      font-size: 1.875rem; font-weight: 700; line-height: 1.15;
      margin: 0 0 12px; letter-spacing: -0.02em;
    }
    .greeting-name { color: #c0c1ff; }

    .subjects-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 12px; background: rgba(192,193,255,0.1);
      border-radius: 100px; font-size: 0.8125rem;
      color: #dbe2fd; margin: 0 0 16px;
    }
    .subjects-pill svg { color: #c0c1ff; }

    .next-banner {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 16px; margin-top: 8px;
      background: rgba(74,214,160,0.1);
      border: 1px solid rgba(74,214,160,0.25);
      border-radius: 10px;
      cursor: pointer; transition: transform 0.15s, background 0.15s;
    }
    .next-banner:hover { background: rgba(74,214,160,0.15); transform: translateY(-1px); }
    .next-icon { color: #4ad6a0; flex-shrink: 0; }
    .next-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .next-label { font-size: 0.875rem; font-weight: 600; color: #fff; }
    .next-meta { font-size: 0.75rem; color: #b8c5e0; }
    .next-arrow { color: rgba(255,255,255,0.5); flex-shrink: 0; }

    /* ── Summary cards ──────────────────────────────────── */
    .summary {
      display: grid; gap: 8px; margin-bottom: 16px;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    }
    .summary-card {
      display: flex; align-items: center; gap: 10px;
      padding: 14px; background: rgba(23,31,51,0.6);
      border: 1px solid rgba(192,193,255,0.08);
      border-radius: 10px; cursor: pointer;
      transition: transform 0.15s, border-color 0.15s, background 0.15s;
      color: inherit; text-align: left;
      backdrop-filter: blur(8px);
    }
    .summary-card:hover { transform: translateY(-2px); border-color: rgba(192,193,255,0.25); background: rgba(23,31,51,0.8); }
    .summary-card.has-alert { border-color: rgba(255,107,107,0.4); background: rgba(255,107,107,0.06); }
    .sc-icon {
      width: 40px; height: 40px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .sc-icon--exams { background: rgba(192,193,255,0.15); color: #c0c1ff; }
    .sc-icon--rx    { background: rgba(74,214,160,0.15);  color: #4ad6a0; }
    .sc-icon--docs  { background: rgba(247,200,115,0.15); color: #f7c873; }
    .sc-icon--vax   { background: rgba(255,180,200,0.15); color: #ffb4c8; }
    .has-alert .sc-icon--vax { background: rgba(255,107,107,0.18); color: #ff6b6b; }
    .sc-content { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .sc-num { font-size: 1.5rem; font-weight: 700; line-height: 1; color: #fff; }
    .sc-label { font-size: 0.75rem; color: #c7c5d0; }

    /* ── Tabs ───────────────────────────────────────────── */
    .tabs {
      display: flex; gap: 4px; overflow-x: auto;
      padding: 4px; margin-bottom: 16px;
      background: rgba(23,31,51,0.4); border-radius: 10px;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .tabs button {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; background: transparent;
      color: #c7c5d0; border: none; border-radius: 7px;
      cursor: pointer; font-size: 0.8125rem; font-weight: 500;
      white-space: nowrap; flex-shrink: 0;
      transition: background 0.15s, color 0.15s;
    }
    .tabs button:hover { color: #dbe2fd; background: rgba(192,193,255,0.06); }
    .tabs button.active { background: rgba(192,193,255,0.16); color: #fff; }
    .tabs .count {
      font-style: normal; font-size: 0.6875rem; padding: 1px 6px;
      background: rgba(192,193,255,0.2); color: #fff; border-radius: 100px;
      font-weight: 600;
    }
    .tabs .count.alert { background: rgba(255,107,107,0.25); color: #ff6b6b; }

    /* ── Content / Cards ────────────────────────────────── */
    .content { padding-bottom: 32px; }
    .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .card {
      display: flex; gap: 0; overflow: hidden;
      background: rgba(23,31,51,0.6);
      border: 1px solid rgba(192,193,255,0.08);
      border-radius: 10px;
      transition: transform 0.15s, border-color 0.15s;
      backdrop-filter: blur(6px);
    }
    .card:hover { transform: translateY(-1px); border-color: rgba(192,193,255,0.18); }
    .card-side { width: 3px; background: #c0c1ff; flex-shrink: 0; }
    .card-icon-block {
      width: 56px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(192,193,255,0.08); color: #c0c1ff;
    }
    .icon-rx  { background: rgba(74,214,160,0.1);  color: #4ad6a0; }
    .icon-doc { background: rgba(247,200,115,0.1); color: #f7c873; }
    .icon-vax { background: rgba(255,180,200,0.1); color: #ffb4c8; }
    .card.is-overdue .icon-vax { background: rgba(255,107,107,0.15); color: #ff6b6b; }

    .card-body { flex: 1; min-width: 0; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .card-title { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .card-title strong { font-size: 0.9375rem; font-weight: 600; color: #fff; }
    .card-sub { color: #c7c5d0; font-size: 0.8125rem; }
    .card-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .meta-chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; background: rgba(192,193,255,0.06);
      border-radius: 100px; font-size: 0.75rem; color: #c7c5d0;
    }
    .meta-chip.chip-accent { background: rgba(74,214,160,0.15); color: #4ad6a0; font-weight: 500; }
    .card-note { margin: 4px 0 0; font-size: 0.8125rem; color: #dbe2fd; line-height: 1.5; }
    .card-note.note-warn { color: #ff8b8b; }

    /* Specific card vibes */
    .card-appointment.is-past { opacity: 0.55; }
    .card-appointment.is-past .card-side { background: #7c7b8f; }
    .card-appointment.is-today .card-side { background: #4ad6a0; }
    .card-appointment.is-today { box-shadow: 0 0 0 1px rgba(74,214,160,0.2); }
    .card-vax.is-overdue { border-color: rgba(255,107,107,0.35); background: rgba(255,107,107,0.05); }

    /* ── Status / Badges ────────────────────────────────── */
    .status {
      font-size: 0.6875rem; padding: 2px 8px; border-radius: 100px;
      text-transform: uppercase; letter-spacing: 0.04em;
      font-family: 'JetBrains Mono', monospace; font-weight: 600;
    }
    .status-scheduled { background: rgba(192,193,255,0.15); color: #c0c1ff; }
    .status-confirmed { background: rgba(74,214,160,0.15); color: #4ad6a0; }
    .status-completed { background: rgba(74,214,160,0.15); color: #4ad6a0; }
    .status-cancelled { background: rgba(255,107,107,0.15); color: #ff6b6b; }
    .status-no_show   { background: rgba(180,180,180,0.15); color: #b8b8c8; }
    .status-blocked   { background: rgba(180,180,180,0.15); color: #b8b8c8; }
    .status-done      { background: rgba(74,214,160,0.15); color: #4ad6a0; }
    .status-pending   { background: rgba(247,200,115,0.15); color: #f7c873; }
    .status-processing { background: rgba(192,193,255,0.15); color: #c0c1ff; }
    .status-error     { background: rgba(255,107,107,0.15); color: #ff6b6b; }

    .badge-signed {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 100px;
      background: rgba(247,200,115,0.15); color: #f7c873;
      font-size: 0.6875rem; font-weight: 600;
    }
    .badge-alert {
      padding: 2px 8px; border-radius: 100px;
      background: rgba(255,107,107,0.18); color: #ff6b6b;
      font-size: 0.6875rem; font-weight: 600;
    }
    .badge-upcoming {
      padding: 2px 8px; border-radius: 100px;
      background: rgba(74,214,160,0.15); color: #4ad6a0;
      font-size: 0.6875rem; font-weight: 600;
    }

    /* ── Empty states ───────────────────────────────────── */
    .empty-state {
      text-align: center; padding: 48px 24px;
      display: flex; flex-direction: column; align-items: center; gap: 10px;
    }
    .empty-illustration { opacity: 0.7; margin-bottom: 4px; }
    .empty-state h3 { margin: 0; font-size: 1.0625rem; font-weight: 600; color: #dbe2fd; }
    .empty-state p { margin: 0; color: #c7c5d0; font-size: 0.875rem; max-width: 320px; }
    .empty-cta {
      display: inline-block; margin-top: 12px;
      padding: 10px 20px; background: rgba(192,193,255,0.16);
      color: #c0c1ff; text-decoration: none; border-radius: 100px;
      font-size: 0.875rem; font-weight: 500;
      transition: background 0.15s, color 0.15s;
    }
    .empty-cta:hover { background: rgba(192,193,255,0.25); color: #fff; }

    /* ── WhatsApp FAB ───────────────────────────────────── */
    .wa-fab {
      position: fixed; bottom: 20px; right: 20px;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 14px 18px;
      background: #25D366; color: #fff; text-decoration: none;
      border-radius: 100px; font-weight: 600; font-size: 0.9375rem;
      box-shadow: 0 6px 20px rgba(37, 211, 102, 0.35);
      transition: transform 0.15s, box-shadow 0.15s;
      z-index: 100;
    }
    .wa-fab:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(37, 211, 102, 0.45); }

    /* ── Footer ─────────────────────────────────────────── */
    footer { padding: 24px 0 16px; text-align: center;
             font-size: 0.75rem; color: #c7c5d0; margin-top: 24px;
             border-top: 1px solid rgba(192,193,255,0.08); }
    .footer-row { display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
    .footer-row .dot { color: rgba(199,197,208,0.4); }
    .footer-row .muted { color: rgba(199,197,208,0.55); }
    .footer-brand strong { color: #c0c1ff; font-weight: 600; }

    /* ── Responsive ─────────────────────────────────────── */
    @media (min-width: 720px) {
      .portal { padding: 32px 24px; padding-bottom: 100px; }
      .greeting { font-size: 2.25rem; }
      .summary { grid-template-columns: repeat(4, 1fr); }
      .next-banner { padding: 16px 20px; }
      .wa-fab .wa-text { display: inline; }
    }
    @media (max-width: 480px) {
      .greeting { font-size: 1.5rem; }
      .wa-fab { padding: 12px; }
      .wa-fab .wa-text { display: none; }
      .card-icon-block { width: 48px; }
    }
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
  documents = signal<PortalDocument[]>([]);
  vaccines = signal<Vaccine[]>([]);
  loading = signal(true);
  errorMsg = signal('');
  activeTab = signal<TabId>('agenda');

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
    this.http.get<{items: PortalDocument[]}>(`${this.base}/portal/${t}/documents`).subscribe({
      next: r => this.documents.set(r.items || []), error: () => {},
    });
    if (this.profile()?.tenant.module === 'veterinary') {
      this.http.get<{items: Vaccine[]}>(`${this.base}/portal/${t}/vaccines`).subscribe({
        next: r => this.vaccines.set(r.items || []), error: () => {},
      });
    }
  }

  // ── Computed helpers ──────────────────────────────────────────────

  /** Próxima consulta futura (status válido, não cancelada/blocked) */
  nextAppointment = computed<Appointment | null>(() => {
    const now = Date.now();
    const upcoming = this.appointments()
      .filter(a => new Date(a.start_at).getTime() >= now)
      .filter(a => !['cancelled', 'blocked', 'no_show'].includes(a.status))
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    return upcoming[0] || null;
  });

  /** Vacinas com next_dose_date no passado */
  overdueVaccinesCount = computed(() =>
    this.vaccines().filter(v => v.next_dose_date && this.isOverdue(v.next_dose_date)).length
  );

  /** Saudação por hora do dia */
  greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  greetingName(): string {
    const p = this.profile();
    if (!p) return '';
    if (p.scope === 'subject') return p.subject?.name || '';
    return p.owner?.name || '';
  }

  // ── Date helpers ──────────────────────────────────────────────────
  isOverdue(iso: string): boolean { return new Date(iso) < new Date(); }

  isPast(iso: string): boolean {
    return new Date(iso).getTime() < Date.now() - 60 * 60 * 1000; // > 1h passou
  }

  isToday(iso: string): boolean {
    const d = new Date(iso);
    const t = new Date();
    return d.getFullYear() === t.getFullYear() &&
           d.getMonth() === t.getMonth() &&
           d.getDate() === t.getDate();
  }

  /** "hoje" / "amanhã" / "em N dias" / "em DD/MM" */
  relativeDate(iso: string): string {
    const target = new Date(iso);
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfDay(target) - startOfDay(now)) / (24 * 3600 * 1000));
    if (diffDays === 0) return 'hoje';
    if (diffDays === 1) return 'amanhã';
    if (diffDays > 1 && diffDays <= 7) return `em ${diffDays} dias`;
    return `em ${target.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
  }

  /**
   * Gera link wa.me se tenant tem whatsapp_phone configurado.
   * Normaliza pra E.164 (DDI 55 + DDD + número, sem pontuação).
   */
  whatsappLink(): string | null {
    const raw = this.profile()?.tenant.whatsapp_phone;
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10) return null;
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

  examStatusLabel(s: string): string {
    return ({
      pending: 'Aguardando',
      processing: 'Processando',
      done: 'Pronto',
      error: 'Erro',
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
