import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { ViewportService } from './core/viewport/viewport.service';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { AsyncPipe, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { HttpClient } from '@angular/common/http';
import { Observable, Subscription, filter } from 'rxjs';
import { AuthService } from './core/auth/auth.service';
import { ReviewQueueService } from './features/doctor/review-queue/review-queue.service';
import { WsService } from './core/ws/ws.service';
import { ChatPanelComponent } from './features/chat/chat-panel.component';
import { ClinicProfileModalComponent } from './features/clinic/profile/clinic-profile-modal.component';
import { QuickSearchComponent } from './shared/components/quick-search/quick-search.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AsyncPipe,
            MatIconModule, MatMenuModule, MatButtonModule, MatTooltipModule,
            MatSnackBarModule, MatDialogModule, ChatPanelComponent, ClinicProfileModalComponent,
            QuickSearchComponent],
  styles: [`
    :host { display: block; }

    .sidebar {
      position: fixed; left: 0; top: 0; bottom: 0;
      width: 240px; background: #0b1326;
      border-right: 1px solid rgba(70,69,84,0.15);
      display: flex; flex-direction: column; z-index: 100;
    }

    .sidebar-brand {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid rgba(70,69,84,0.15);
      display: flex; align-items: center; gap: 0.75rem;
    }

    .brand-logo {
      width: 56px; height: 56px;
      object-fit: contain; flex-shrink: 0;
    }

    .brand-text { display: flex; flex-direction: column; }

    .brand-name {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 1.125rem;
      color: #c0c1ff; letter-spacing: -0.02em;
    }

    .brand-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; text-transform: uppercase;
      letter-spacing: 0.1em; color: #464554;
      margin-top: 2px;
    }

    .sidebar-nav { flex: 1; padding: 0.75rem 0; overflow-y: auto; }

    .nav-section-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; text-transform: uppercase;
      letter-spacing: 0.15em; color: #464554;
      padding: 0 1.5rem; margin: 1rem 0 0.25rem;
    }

    .nav-item {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.625rem 1.5rem;
      color: #908fa0;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 500; font-size: 0.875rem;
      text-decoration: none; cursor: pointer; background: none; border: none; width: 100%;
      border-left: 3px solid transparent;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
      text-align: left;
    }
    .nav-item:hover { background: #131b2e; color: #dae2fd; }
    .nav-item.active { background: #171f33; color: #c0c1ff; border-left-color: #494bd6; }
    ::ng-deep .nav-item .mat-icon { font-size: 18px !important; width: 18px !important; height: 18px !important; opacity: 0.7; }
    ::ng-deep .nav-item.active .mat-icon { opacity: 1; }

    .nav-badge {
      margin-left: auto;
      background: #494bd6;
      color: #fff;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 10px;
      min-width: 18px;
      text-align: center;
    }

    .sidebar-footer {
      padding: 1rem 1.5rem;
      border-top: 1px solid rgba(70,69,84,0.15);
    }

    .topbar {
      position: fixed; top: 0; left: 240px; right: 0;
      height: 56px; background: #0b1326;
      border-bottom: 1px solid rgba(70,69,84,0.15);
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0 1.5rem; z-index: 99;
    }
    .topbar-search { flex: 0 1 380px; margin-right: auto; }
    .topbar-spacer { flex: 1; }

    /* Chip de identidade do tenant — sempre visível, mitiga confusão
     * entre contas. Incidente 2026-04-23 mostrou que usuário não tinha
     * como saber em qual tenant estava logado. */
    .tenant-chip {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.375rem 0.75rem;
      border-radius: 4px;
      background: rgba(192,193,255,0.06);
      border: 1px solid rgba(192,193,255,0.18);
      max-width: 320px;
    }
    .tenant-chip mat-icon {
      font-size: 16px !important; width: 16px !important; height: 16px !important;
      color: #c0c1ff;
    }
    .tenant-name {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 600; font-size: 0.8125rem;
      color: #dae2fd;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 180px;
    }
    .tenant-module-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; text-transform: uppercase;
      letter-spacing: 0.1em;
      padding: 2px 6px; border-radius: 3px;
      background: rgba(73,75,214,0.18);
      color: #c0c1ff;
      white-space: nowrap;
    }

    .user-chip {
      display: flex; align-items: center; gap: 0.5rem;
      cursor: pointer; padding: 0.375rem 0.75rem;
      border-radius: 4px;
      border: 1px solid rgba(70,69,84,0.25);
      background: transparent;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .user-chip:hover { background: #131b2e; }

    .user-role-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.1em; color: #908fa0;
    }

    .main-content {
      margin-left: 240px;
      margin-top: 56px;
      min-height: calc(100vh - 56px);
      background: #0b1326;
      transition: margin-right 180ms cubic-bezier(0.4,0,0.2,1);
    }

    /* ── Mobile hamburger + drawer backdrop ── */
    .hamburger-btn {
      display: none;
      background: transparent; border: none; cursor: pointer;
      padding: 8px; margin-right: 0.25rem;
      color: #dae2fd;
    }
    .drawer-backdrop { display: none; }

    /* ══════════════ RESPONSIVO — mobile (< 640px) ══════════════
     * Estratégia: sidebar vira drawer (slide-in da esquerda), topbar
     * ganha hamburger, main-content usa viewport inteiro.
     * Desktop e tablet (≥ 640px) permanecem com o layout atual intacto.
     */
    @media (max-width: 639px) {
      .sidebar {
        transform: translateX(-100%);
        transition: transform 220ms cubic-bezier(0.4,0,0.2,1);
        width: 280px;
        box-shadow: 4px 0 24px rgba(0,0,0,0.5);
      }
      .sidebar.drawer-open {
        transform: translateX(0);
      }
      .topbar {
        left: 0 !important;
        padding: 0 0.75rem;
      }
      .main-content {
        margin-left: 0 !important;
      }
      .hamburger-btn {
        display: inline-flex; align-items: center;
      }
      .drawer-backdrop {
        display: none;
        position: fixed; inset: 0; z-index: 99;
        background: rgba(0,0,0,0.6);
        backdrop-filter: blur(2px);
        animation: fadeIn 180ms ease;
      }
      .drawer-backdrop.visible { display: block; }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

      /* topbar compactada no mobile */
      .topbar-search { display: none !important; }
      .topbar-spacer { flex: 1; }
      .user-chip .user-role-label { display: none; }
      .user-chip { padding: 0.375rem 0.5rem !important; }
      /* Tenant chip: mantém nome visível no mobile (encurta se preciso) */
      .tenant-chip { padding: 0.375rem 0.5rem; gap: 0.375rem; }
      .tenant-chip .tenant-name { max-width: 120px; font-size: 0.75rem; }
      .tenant-chip .tenant-module-badge { display: none; }

      /* sidebar com espaço extra no topo pra não sobrepor nada */
      .sidebar-brand { padding: 1rem 1.25rem; }
      .nav-item { padding: 0.75rem 1.25rem; font-size: 0.9375rem; }
    }
  `],
  template: `
    @if (auth.currentUser$ | async; as user) {
      <div class="drawer-backdrop" [class.visible]="drawerOpen()" (click)="closeDrawer()"></div>

      <aside class="sidebar" [class.drawer-open]="drawerOpen()">
        <div class="sidebar-brand">
          <img class="brand-logo" src="logo_genoma.png" alt="GenomaFlow"/>
          <div class="brand-text">
            <div class="brand-name">GenomaFlow</div>
            <div class="brand-badge">Clinical AI &middot; v1.0</div>
          </div>
        </div>

        <nav class="sidebar-nav">
          <div class="nav-section-label">Gestão</div>
          <a class="nav-item" routerLink="/clinic/dashboard" routerLinkActive="active">
            <mat-icon>dashboard</mat-icon> Dashboard
          </a>
          <a class="nav-item" routerLink="/clinic/users" routerLinkActive="active">
            <mat-icon>group</mat-icon> Usuários
          </a>
          <a class="nav-item" routerLink="/clinic/billing" routerLinkActive="active">
            <mat-icon>account_balance_wallet</mat-icon> Créditos
          </a>
          <div class="nav-section-label">Clínica</div>
          <a class="nav-item" routerLink="/doctor/patients" routerLinkActive="active">
            <mat-icon>{{ user.module === 'veterinary' ? 'pets' : 'people' }}</mat-icon>
            {{ user.module === 'veterinary' ? 'Animais' : 'Pacientes' }}
          </a>
          <a class="nav-item" routerLink="/doctor/review-queue" routerLinkActive="active">
            <mat-icon>inbox</mat-icon>
            <span>Fila de Revisão</span>
            @if (reviewCount$ | async; as count) {
              @if (count > 0) {
                <span class="nav-badge">{{ count }}</span>
              }
            }
          </a>
          <div class="nav-section-label" style="margin-top: 2rem">Suporte</div>
          <button class="nav-item" (click)="openFeedback('bug')">
            <mat-icon>bug_report</mat-icon> Reportar erro
          </button>
          <button class="nav-item" (click)="openFeedback('feature')">
            <mat-icon>lightbulb</mat-icon> Sugerir melhoria
          </button>
          <div class="nav-section-label" style="margin-top: 1rem">Sistema</div>
          <button class="nav-item" (click)="auth.logout()">
            <mat-icon>logout</mat-icon> Sair
          </button>
        </nav>

        <div class="sidebar-footer">
          <div class="user-role-label">{{ user.role }}</div>
        </div>
      </aside>

      <header class="topbar">
        <button class="hamburger-btn" (click)="toggleDrawer()" aria-label="Abrir menu">
          <mat-icon>menu</mat-icon>
        </button>
        @if (user.role !== 'master' && (auth.currentProfile$ | async); as profile) {
          <div class="tenant-chip"
               [matTooltip]="'Tenant: ' + profile.tenant_name + ' · ' + (profile.module === 'veterinary' ? 'Clínica Veterinária' : 'Clínica Humana')">
            <mat-icon>{{ profile.module === 'veterinary' ? 'pets' : 'local_hospital' }}</mat-icon>
            <span class="tenant-name">{{ profile.tenant_name }}</span>
            <span class="tenant-module-badge">{{ profile.module === 'veterinary' ? 'VET' : 'HUMAN' }}</span>
          </div>
        }
        @if (user.role !== 'master') {
          <app-quick-search class="topbar-search" />
        }
        <div class="topbar-spacer"></div>
        <button mat-icon-button
                matTooltip="Assistente clínico"
                style="color:#908fa0;margin-right:0.5rem"
                (click)="chatOpen = !chatOpen">
          <mat-icon>smart_toy</mat-icon>
        </button>
        <div class="user-chip" [matMenuTriggerFor]="menu">
          <mat-icon style="font-size:16px;width:16px;height:16px;color:#c0c1ff">account_circle</mat-icon>
          <span class="user-role-label">{{ user.role }}</span>
          <mat-icon style="font-size:14px;width:14px;height:14px;color:#464554">expand_more</mat-icon>
        </div>
        <mat-menu #menu="matMenu">
          <div style="padding:0.5rem 1rem;font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#908fa0;border-bottom:1px solid rgba(70,69,84,0.2);margin-bottom:4px;">
            {{ user.role }}
          </div>
          @if (user.module === 'human') {
            <button mat-menu-item routerLink="/onboarding/specialty">
              <mat-icon>school</mat-icon> Minha especialidade
            </button>
          }
          @if (user.role === 'admin') {
            <button mat-menu-item (click)="openClinicProfile()">
              <mat-icon>business</mat-icon> Editar Perfil da Clínica
            </button>
          }
          <button mat-menu-item (click)="auth.logout()">
            <mat-icon>logout</mat-icon> Sair
          </button>
        </mat-menu>
      </header>

      @if (chatOpen) {
        <app-chat-panel (closed)="chatOpen = false" />
      }

      <main class="main-content" [style.margin-right]="chatOpen ? '420px' : '0'">
        <router-outlet />
      </main>
    } @else {
      <router-outlet />
    }
  `
})
export class AppComponent implements OnInit, OnDestroy {
  auth = inject(AuthService);
  reviewService = inject(ReviewQueueService);
  ws = inject(WsService);
  snack = inject(MatSnackBar);
  dialog = inject(MatDialog);
  viewport = inject(ViewportService);
  private router = inject(Router);
  reviewCount$: Observable<number> = this.reviewService.pendingCount$;
  chatOpen = false;
  drawerOpen = signal(false);

  private subs = new Subscription();

  toggleDrawer(): void { this.drawerOpen.update(v => !v); }
  closeDrawer(): void { this.drawerOpen.set(false); }

  constructor() {
    // Fecha o drawer ao navegar para qualquer rota (UX mobile padrão)
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      if (this.drawerOpen()) this.drawerOpen.set(false);
    });
  }

  ngOnInit() {
    this.subs.add(
      this.ws.examUpdates$.subscribe(() => this.reviewService.refreshCount())
    );
    this.subs.add(
      this.ws.examError$.subscribe(({ error_message }) => {
        const msg = this.friendlyExamError(error_message);
        this.snack.open(`Falha no processamento do exame: ${msg}`, 'Fechar',
          { duration: 10000, panelClass: ['snack-error'] });
      })
    );
    this.subs.add(
      this.ws.billingAlert$.subscribe(({ balance }) => {
        this.snack.open(
          `Atenção: saldo baixo de créditos (${balance} restantes). Recarregue para continuar processando exames.`,
          'Fechar', { duration: 8000, panelClass: ['snack-warn'] }
        );
      })
    );
    this.subs.add(
      this.ws.billingExhausted$.subscribe(() => {
        this.snack.open(
          'Créditos esgotados. Novos exames não serão processados até você recarregar.',
          'Recarregar', { duration: 0, panelClass: ['snack-error'] }
        );
      })
    );
  }

  ngOnDestroy() { this.subs.unsubscribe(); }

  openFeedback(type: 'bug' | 'feature'): void {
    this.dialog.open(FeedbackDialogComponent, {
      width: '480px',
      data: { type }
    });
  }

  openClinicProfile(): void {
    this.dialog.open(ClinicProfileModalComponent, { width: '480px', panelClass: 'dark-dialog' });
  }

  private friendlyExamError(msg: string): string {
    if (!msg) return 'Erro desconhecido.';
    if (msg.includes('créditos insuficiente')) return 'Saldo de créditos insuficiente. Recarregue e reenvie.';
    if (msg.includes('Module mismatch')) return 'Tipo de exame incompatível com o módulo contratado.';
    if (msg.includes('No agent configured')) return 'Espécie sem agente configurado.';
    if (msg.includes('no file_path') || msg.includes('não encontrado') || msg.includes('NoSuchKey')) return 'Arquivo não encontrado. Reenvie o PDF.';
    return msg.length > 120 ? msg.slice(0, 120) + '…' : msg;
  }
}

@Component({
  selector: 'app-feedback-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatDialogModule, MatIconModule, NgIf],
  styles: [`
    .screenshot-drop {
      border: 1px dashed rgba(70,69,84,0.4); border-radius: 6px;
      padding: 0.75rem 1rem; margin-bottom: 1rem; cursor: pointer;
      display: flex; align-items: center; gap: 0.75rem;
      transition: border-color 150ms;
    }
    .screenshot-drop:hover { border-color: rgba(192,193,255,0.4); }
    .screenshot-drop mat-icon { color: #6e6d80; font-size: 20px; width: 20px; height: 20px; flex-shrink: 0; }
    .drop-label { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #a09fb2; }
    .drop-hint  { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #6e6d80; margin-top: 2px; }
    .preview-wrap { position: relative; display: inline-block; margin-bottom: 1rem; }
    .preview-img  { max-width: 100%; max-height: 180px; border-radius: 4px; border: 1px solid rgba(70,69,84,0.3); display: block; }
    .remove-btn {
      position: absolute; top: -8px; right: -8px;
      background: #0b1326; border: 1px solid rgba(70,69,84,0.4); border-radius: 50%;
      width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
      cursor: pointer; color: #ffb4ab; padding: 0;
    }
    .remove-btn mat-icon { font-size: 13px; width: 13px; height: 13px; }
  `],
  template: `
    <div style="padding:1.5rem;background:#131b2e;border-radius:8px;min-width:400px">
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem">
        <mat-icon style="color:{{ data.type === 'bug' ? '#ffb4ab' : '#c0c1ff' }}">
          {{ data.type === 'bug' ? 'bug_report' : 'lightbulb' }}
        </mat-icon>
        <h2 style="font-family:'Space Grotesk',sans-serif;font-size:1.1rem;font-weight:700;color:#dae2fd;margin:0">
          {{ data.type === 'bug' ? 'Reportar erro' : 'Sugerir melhoria' }}
        </h2>
      </div>

      <mat-form-field appearance="outline" style="width:100%;margin-bottom:1rem">
        <mat-label>{{ data.type === 'bug' ? 'Descreva o erro' : 'Descreva sua sugestão' }}</mat-label>
        <textarea matInput [(ngModel)]="message" rows="5"
          [placeholder]="data.type === 'bug' ? 'O que aconteceu? Quais passos reproduzem o problema?' : 'O que poderia ser melhorado ou adicionado?'">
        </textarea>
      </mat-form-field>

      @if (screenshotPreview) {
        <div class="preview-wrap">
          <img class="preview-img" [src]="screenshotPreview" alt="screenshot"/>
          <button class="remove-btn" type="button" (click)="removeScreenshot()">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      } @else {
        <input #fileInput type="file" accept="image/*" style="display:none" (change)="onFileSelect($event)"/>
        <div class="screenshot-drop" (click)="fileInput.click()">
          <mat-icon>add_photo_alternate</mat-icon>
          <div>
            <div class="drop-label">
              {{ data.type === 'bug' ? 'Anexar print de tela' : 'Print da tela a melhorar' }}
              <span style="color:#6e6d80"> (opcional)</span>
            </div>
            <div class="drop-hint">Anexar um print da tela ajuda a entender exatamente qual parte do sistema você está se referindo.</div>
          </div>
        </div>
      }

      @if (sent) {
        <div style="background:rgba(192,193,255,0.08);border:1px solid rgba(192,193,255,0.2);border-radius:4px;padding:0.75rem;font-family:'JetBrains Mono',monospace;font-size:12px;color:#c0c1ff;margin-bottom:1rem">
          Obrigado pelo feedback! Recebemos sua mensagem.
        </div>
      }

      <div style="display:flex;justify-content:flex-end;gap:0.5rem">
        <button mat-button [mat-dialog-close]="null" style="color:#908fa0">Fechar</button>
        <button mat-flat-button
                style="background:#c0c1ff;color:#1000a9;font-weight:700"
                [disabled]="!message.trim() || sending || sent"
                (click)="submit()">
          {{ sending ? 'Enviando…' : sent ? 'Enviado ✓' : 'Enviar' }}
        </button>
      </div>
    </div>
  `
})
export class FeedbackDialogComponent {
  data: { type: 'bug' | 'feature' } = inject(MAT_DIALOG_DATA);
  private http = inject(HttpClient);
  private snack = inject(MatSnackBar);

  message = '';
  sending = false;
  sent = false;
  screenshotPreview: string | null = null;
  private screenshotBase64: string | null = null;

  onFileSelect(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      this.snack.open('Imagem muito grande. Máximo 5 MB.', '', { duration: 3000 });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      this.screenshotPreview = result;
      this.screenshotBase64 = result;
    };
    reader.readAsDataURL(file);
  }

  removeScreenshot(): void {
    this.screenshotPreview = null;
    this.screenshotBase64 = null;
  }

  submit(): void {
    if (!this.message.trim()) return;
    this.sending = true;
    this.http.post('/api/feedback', {
      type: this.data.type,
      message: this.message,
      ...(this.screenshotBase64 ? { screenshot: this.screenshotBase64 } : {})
    }).subscribe({
      next: () => { this.sending = false; this.sent = true; },
      error: () => {
        this.sending = false;
        this.sent = true;
        this.snack.open('Feedback recebido. Obrigado!', '', { duration: 3000 });
      }
    });
  }
}
