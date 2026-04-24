import { Component, Inject, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { environment } from '../../../environments/environment';

interface CounterpartContact {
  tenant_id: string;
  name: string;
  module: 'human' | 'veterinary';
  contact_email: string | null;
  phone: string | null;
  address: string | null;
}

export interface CounterpartContactDialogData {
  conversation_id: string;
  counterpart_name: string;
}

@Component({
  selector: 'app-counterpart-contact-dialog',
  standalone: true,
  imports: [MatDialogModule, MatIconModule, MatButtonModule, MatTooltipModule, MatSnackBarModule],
  styles: [`
    :host { display: block; }
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 1.5rem 0.5rem; }
    .modal-header h2 { font-family: 'Space Grotesk', sans-serif; font-size: 1rem; font-weight: 700; color: #dae2fd; margin: 0; }
    .subtitle { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #908fa0; letter-spacing: 0.1em; text-transform: uppercase; padding: 0 1.5rem 0.5rem; }
    .body { padding: 0.5rem 1.5rem 1.25rem; display: flex; flex-direction: column; gap: 0.625rem; min-width: 320px; }
    .row {
      display: flex; align-items: flex-start; gap: 0.75rem;
      padding: 0.75rem 0.875rem; border: 1px solid rgba(70,69,84,0.22);
      border-radius: 6px; background: #0b1326;
    }
    .row-icon { color: #7c7dff; flex-shrink: 0; margin-top: 1px; }
    .row-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .row-label { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: #908fa0; text-transform: uppercase; letter-spacing: 0.1em; }
    .row-value { font-size: 0.8125rem; color: #dae2fd; word-break: break-word; white-space: pre-wrap; line-height: 1.45; }
    .row-value.muted { color: #6e6d80; font-style: italic; }
    .row-action { display: flex; align-items: center; flex-shrink: 0; }
    .empty {
      padding: 1rem; color: #908fa0; font-size: 0.8125rem;
      text-align: center; border: 1px dashed rgba(70,69,84,0.3);
      border-radius: 6px; font-family: 'JetBrains Mono', monospace;
    }
    .loading { color: #908fa0; font-size: 0.8125rem; text-align: center; padding: 0.75rem; }
  `],
  template: `
    <div class="modal-header">
      <h2>{{ data.counterpart_name }}</h2>
      <button mat-icon-button (click)="close()"><mat-icon>close</mat-icon></button>
    </div>
    <div class="subtitle">Contato da Clínica</div>
    <div class="body">
      @if (contact(); as c) {
        <div class="row">
          <mat-icon class="row-icon">mail</mat-icon>
          <div class="row-content">
            <span class="row-label">E-mail</span>
            @if (c.contact_email) {
              <span class="row-value">{{ c.contact_email }}</span>
            } @else {
              <span class="row-value muted">Não informado</span>
            }
          </div>
          @if (c.contact_email) {
            <div class="row-action">
              <button mat-icon-button matTooltip="Copiar" (click)="copy(c.contact_email!, 'E-mail')">
                <mat-icon style="font-size:18px;width:18px;height:18px">content_copy</mat-icon>
              </button>
            </div>
          }
        </div>

        <div class="row">
          <mat-icon class="row-icon">phone</mat-icon>
          <div class="row-content">
            <span class="row-label">Telefone</span>
            @if (c.phone) {
              <span class="row-value">{{ c.phone }}</span>
            } @else {
              <span class="row-value muted">Não informado</span>
            }
          </div>
          @if (c.phone) {
            <div class="row-action">
              <button mat-icon-button matTooltip="Copiar" (click)="copy(c.phone!, 'Telefone')">
                <mat-icon style="font-size:18px;width:18px;height:18px">content_copy</mat-icon>
              </button>
            </div>
          }
        </div>

        <div class="row">
          <mat-icon class="row-icon">location_on</mat-icon>
          <div class="row-content">
            <span class="row-label">Endereço</span>
            @if (c.address) {
              <span class="row-value">{{ c.address }}</span>
            } @else {
              <span class="row-value muted">Não informado</span>
            }
          </div>
          @if (c.address) {
            <div class="row-action">
              <button mat-icon-button matTooltip="Copiar" (click)="copy(c.address!, 'Endereço')">
                <mat-icon style="font-size:18px;width:18px;height:18px">content_copy</mat-icon>
              </button>
            </div>
          }
        </div>
      } @else if (loading()) {
        <div class="loading">Carregando...</div>
      } @else {
        <div class="empty">Não foi possível carregar os dados de contato.</div>
      }
    </div>
  `
})
export class CounterpartContactDialogComponent implements OnInit {
  private http      = inject(HttpClient);
  private snack     = inject(MatSnackBar);
  private dialogRef = inject(MatDialogRef<CounterpartContactDialogComponent>);

  contact = signal<CounterpartContact | null>(null);
  loading = signal(true);

  constructor(@Inject(MAT_DIALOG_DATA) public data: CounterpartContactDialogData) {}

  ngOnInit(): void {
    this.http.get<CounterpartContact>(
      `${environment.apiUrl}/inter-tenant-chat/conversations/${this.data.conversation_id}/counterpart-contact`
    ).subscribe({
      next: (c) => { this.contact.set(c); this.loading.set(false); },
      error: () => { this.contact.set(null); this.loading.set(false); }
    });
  }

  async copy(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.snack.open(`${label} copiado`, '', { duration: 1800 });
    } catch {
      this.snack.open('Falha ao copiar', '', { duration: 1800 });
    }
  }

  close(): void { this.dialogRef.close(); }
}
