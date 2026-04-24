import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subject, debounceTime } from 'rxjs';
import { ChatService } from './chat.service';
import { DirectoryEntry, ChatSettings } from '../../shared/models/chat.models';

@Component({
  selector: 'app-directory-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatIconModule, MatButtonModule, MatSnackBarModule],
  styles: [`
    :host { display: block; background: #0b1326; color: #dae2fd; }
    .wrap { padding: 1.5rem; }
    h2 {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.25rem; color: #c0c1ff; margin: 0 0 1rem;
    }
    .search-row { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .search-row input {
      flex: 1; padding: 0.625rem 0.875rem; font-size: 0.875rem;
      background: #171f33; color: #dae2fd;
      border: 1px solid rgba(70,69,84,0.25); border-radius: 4px; outline: none;
    }
    .search-row input:focus { border-color: #c0c1ff; }
    .search-row select {
      padding: 0.625rem; background: #171f33; color: #dae2fd;
      border: 1px solid rgba(70,69,84,0.25); border-radius: 4px;
      font-family: inherit; font-size: 0.875rem;
    }
    .results {
      max-height: 420px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 0.5rem;
    }
    .empty {
      padding: 2rem; text-align: center;
      color: #7c7b8f; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem;
    }
    .item {
      padding: 0.875rem 1rem; border-radius: 6px;
      background: #111929; border: 1px solid rgba(70,69,84,0.15);
      display: flex; align-items: center; justify-content: space-between;
    }
    .item-info { flex: 1; min-width: 0; }
    .item-name {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 0.9375rem; color: #dae2fd;
    }
    .item-meta {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #7c7b8f; margin-top: 0.25rem;
    }
    .invite-btn { color: #c0c1ff; }
    .msg-area { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .msg-area textarea {
      padding: 0.5rem 0.75rem; min-height: 80px;
      background: #171f33; color: #dae2fd; border: 1px solid rgba(70,69,84,0.25);
      border-radius: 4px; outline: none; font-family: inherit; font-size: 0.875rem; resize: vertical;
    }
    .msg-area textarea:focus { border-color: #c0c1ff; }
    .actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.75rem; }

    /* Banner visibilidade */
    .visibility-banner {
      background: rgba(255,203,107,0.06);
      border-left: 3px solid #ffcb6b;
      padding: 0.75rem 1rem;
      margin-bottom: 1rem;
      display: flex; gap: 0.75rem; align-items: flex-start;
      border-radius: 0 4px 4px 0;
    }
    .visibility-banner mat-icon {
      color: #ffcb6b; font-size: 20px; width: 20px; height: 20px; flex-shrink: 0;
    }
    .visibility-banner-body { flex: 1; font-size: 0.8125rem; color: #dae2fd; line-height: 1.5; }
    .visibility-banner-body strong { color: #ffcb6b; }
    .visibility-banner-action {
      margin-top: 0.5rem;
      display: flex; gap: 0.5rem;
    }
    .visibility-banner-ok {
      background: rgba(74,214,160,0.06);
      border-left-color: #4ad6a0;
    }
    .visibility-banner-ok mat-icon { color: #4ad6a0; }
    .visibility-banner-ok strong { color: #4ad6a0; }
  `],
  template: `
    <div class="wrap">
      <h2>Nova conversa</h2>

      @if (!selected()) {
        @if (settings() && !settings()!.visible_in_directory) {
          <div class="visibility-banner">
            <mat-icon>visibility_off</mat-icon>
            <div class="visibility-banner-body">
              <strong>Sua clínica está invisível no diretório.</strong>
              <div>Outras clínicas não conseguem te encontrar na busca.
                Ative a visibilidade pra permitir que te achem e enviem convites.</div>
              <div class="visibility-banner-action">
                <button mat-flat-button
                        style="background:#ffcb6b;color:#0b1326;font-weight:700"
                        [disabled]="togglingVisibility()"
                        (click)="toggleVisibility()">
                  {{ togglingVisibility() ? 'Ativando…' : 'Tornar visível agora' }}
                </button>
              </div>
            </div>
          </div>
        } @else if (settings() && settings()!.visible_in_directory) {
          <div class="visibility-banner visibility-banner-ok">
            <mat-icon>visibility</mat-icon>
            <div class="visibility-banner-body">
              <strong>Sua clínica está visível no diretório.</strong>
              Outras clínicas do seu módulo podem te encontrar.
              <div class="visibility-banner-action">
                <button mat-button style="color:#7c7b8f"
                        [disabled]="togglingVisibility()"
                        (click)="toggleVisibility()">
                  Ocultar do diretório
                </button>
              </div>
            </div>
          </div>
        }

        <div class="search-row">
          <input [(ngModel)]="q" placeholder="Buscar clínica por nome…" (input)="onQueryChange()"/>
          <select [(ngModel)]="uf" (change)="refresh()">
            <option value="">Todas UFs</option>
            @for (u of UFS; track u) { <option [value]="u">{{ u }}</option> }
          </select>
        </div>

        <div class="results">
          @if (results().length === 0) {
            <div class="empty">Nenhuma clínica visível no diretório com esses filtros.</div>
          }
          @for (r of results(); track r.tenant_id) {
            <div class="item">
              <div class="item-info">
                <div class="item-name">{{ r.name }}</div>
                <div class="item-meta">
                  {{ r.module === 'veterinary' ? 'VET' : 'HUMAN' }}
                  @if (r.region_uf) { &nbsp;·&nbsp; {{ r.region_uf }} }
                  @if (r.specialties?.length) { &nbsp;·&nbsp; {{ r.specialties.join(', ') }} }
                </div>
              </div>
              <button mat-flat-button class="invite-btn" (click)="onPickInvitee(r)">
                <mat-icon>person_add</mat-icon> Convidar
              </button>
            </div>
          }
        </div>

        <div class="actions">
          <button mat-button (click)="ref.close(false)">Cancelar</button>
        </div>
      } @else {
        <p style="margin-bottom: 0.5rem">Convidar <strong>{{ selected()!.name }}</strong>?</p>
        <div class="msg-area">
          <label style="font-size: 11px; color: #7c7b8f; letter-spacing: 0.08em; text-transform: uppercase; font-family: 'JetBrains Mono', monospace">
            Mensagem opcional
          </label>
          <textarea [(ngModel)]="inviteMessage" placeholder="Olá, gostaria de conversar sobre…" maxlength="500"></textarea>
        </div>
        <div class="actions">
          <button mat-button (click)="selected.set(null)">Voltar</button>
          <button mat-flat-button style="background: #c0c1ff; color: #1000a9; font-weight: 700" (click)="onSendInvite()" [disabled]="sending">
            {{ sending ? 'Enviando…' : 'Enviar convite' }}
          </button>
        </div>
      }
    </div>
  `
})
export class DirectoryModalComponent {
  private chat = inject(ChatService);
  private snack = inject(MatSnackBar);
  ref = inject(MatDialogRef<DirectoryModalComponent>);

  readonly UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

  q = '';
  uf = '';
  results = signal<DirectoryEntry[]>([]);
  selected = signal<DirectoryEntry | null>(null);
  inviteMessage = '';
  sending = false;
  settings = signal<ChatSettings | null>(null);
  togglingVisibility = signal(false);

  private query$ = new Subject<void>();

  constructor() {
    this.query$.pipe(debounceTime(300)).subscribe(() => this.refresh());
    this.loadSettings();
    this.refresh();
  }

  private loadSettings() {
    this.chat.getSettings().subscribe({
      next: (s) => this.settings.set(s),
      error: () => {}
    });
  }

  toggleVisibility() {
    const current = this.settings();
    if (!current) return;
    this.togglingVisibility.set(true);
    const next = !current.visible_in_directory;
    this.chat.updateSettings({ visible_in_directory: next }).subscribe({
      next: (s) => {
        this.settings.set(s);
        this.togglingVisibility.set(false);
        this.snack.open(
          next ? 'Sua clínica agora é visível no diretório.' : 'Visibilidade desativada.',
          '', { duration: 3000 }
        );
        this.refresh();
      },
      error: (err) => {
        this.togglingVisibility.set(false);
        this.snack.open(err.error?.error || 'Erro ao atualizar configuração.', 'Fechar', { duration: 5000 });
      }
    });
  }

  onQueryChange() { this.query$.next(); }

  refresh() {
    this.chat.searchDirectory({ q: this.q, uf: this.uf }).subscribe({
      next: (res) => this.results.set(res.results)
    });
  }

  onPickInvitee(entry: DirectoryEntry) {
    this.selected.set(entry);
    this.inviteMessage = '';
  }

  onSendInvite() {
    const target = this.selected();
    if (!target) return;
    this.sending = true;
    this.chat.sendInvitation(target.tenant_id, this.inviteMessage.trim() || undefined).subscribe({
      next: () => {
        this.snack.open('Convite enviado!', '', { duration: 3000 });
        this.ref.close(true);
      },
      error: (err) => {
        this.sending = false;
        const msg = err.error?.error || 'Erro ao enviar convite.';
        this.snack.open(msg, 'Fechar', { duration: 5000, panelClass: ['snack-error'] });
      }
    });
  }
}
