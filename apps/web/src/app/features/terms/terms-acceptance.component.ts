import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TermsService, LegalDocument } from './terms.service';

@Component({
  selector: 'app-terms-acceptance',
  standalone: true,
  imports: [MatIconModule, MatCheckboxModule, MatButtonModule, MatSnackBarModule],
  styles: [`
    :host { display: block; min-height: 100vh; background: #0b1326; padding: 3rem 1rem; }

    .wrap { max-width: 780px; margin: 0 auto; }

    .header {
      display: flex; align-items: center; gap: 0.875rem;
      margin-bottom: 2rem;
    }
    .logo {
      width: 56px; height: 56px; object-fit: contain;
      background: #fff; border-radius: 8px; padding: 4px;
    }
    .title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 1.75rem;
      color: #dae2fd; margin: 0; letter-spacing: -0.02em;
    }
    .subtitle {
      font-family: 'Inter', sans-serif;
      font-size: 14px; color: #a09fb2;
      margin: 0.25rem 0 0; max-width: 60ch; line-height: 1.5;
    }

    .card {
      background: #111929; border: 1px solid rgba(70,69,84,0.2);
      border-radius: 10px; padding: 1.5rem;
    }

    .instructions {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #c0c1ff; text-transform: uppercase; letter-spacing: 0.1em;
      margin-bottom: 1rem;
    }

    .doc-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .doc-row {
      display: flex; align-items: center; gap: 0.875rem;
      background: #0b1326; border: 1px solid rgba(70,69,84,0.25);
      border-radius: 8px; padding: 0.875rem 1rem;
      transition: border-color 150ms ease, background 150ms ease;
    }
    .doc-row.accepted { border-color: rgba(74,214,160,0.4); background: rgba(74,214,160,0.04); }

    .doc-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 14px; color: #dae2fd; flex: 1;
    }
    .doc-version {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #6e6d80; margin-top: 2px;
    }
    .doc-info { flex: 1; min-width: 0; }

    .open-btn {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #c0c1ff; text-transform: uppercase; letter-spacing: 0.08em;
      background: transparent; border: 1px solid rgba(192,193,255,0.3);
      border-radius: 4px; padding: 0.375rem 0.75rem;
      cursor: pointer; text-decoration: none;
      display: inline-flex; align-items: center; gap: 4px;
      transition: all 150ms;
    }
    .open-btn:hover { background: rgba(192,193,255,0.1); border-color: #c0c1ff; }

    .actions {
      margin-top: 2rem; display: flex; justify-content: space-between;
      align-items: center; gap: 1rem;
    }
    .progress {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #7c7b8f; letter-spacing: 0.04em;
    }
    .progress.complete { color: #4ad6a0; }
    .submit-btn {
      background: #c0c1ff !important; color: #1000a9 !important;
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      letter-spacing: 0.03em;
    }
    .submit-btn:disabled {
      opacity: 0.4; cursor: not-allowed;
    }

    .footer-note {
      margin-top: 1.5rem; padding: 1rem;
      background: rgba(255,203,107,0.06);
      border: 1px solid rgba(255,203,107,0.2);
      border-radius: 6px;
      font-family: 'Inter', sans-serif; font-size: 12px;
      color: #d4b464; line-height: 1.5;
    }
    .footer-note strong { color: #f5c14a; }
    .footer-note mat-icon { font-size: 16px; width: 16px; height: 16px; vertical-align: middle; margin-right: 4px; color: #f5c14a; }
  `],
  template: `
    <div class="wrap">
      <div class="header">
        <img class="logo" src="logo_genoma.png" alt="GenomaFlow"/>
        <div>
          <h1 class="title">Termos e Políticas</h1>
          <p class="subtitle">
            Antes de continuar, leia e aceite os documentos abaixo. Eles são obrigatórios
            para o uso da plataforma e garantem conformidade com a LGPD e com as normas
            do CFM/CFMV.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="instructions">⬇ Abra cada documento e marque como lido</div>

        <div class="doc-list">
          @for (d of pending(); track d.type) {
            <div class="doc-row" [class.accepted]="isChecked(d.type)">
              <mat-checkbox color="primary"
                            [checked]="isChecked(d.type)"
                            [disabled]="!wasOpened(d.type)"
                            (change)="toggle(d.type, $event.checked)"/>
              <div class="doc-info">
                <div class="doc-title">{{ d.title }}</div>
                <div class="doc-version">Versão {{ d.version }} · clique abaixo para ler</div>
              </div>
              <a class="open-btn" [href]="d.pdf_url" target="_blank" rel="noopener" (click)="markOpened(d.type)">
                <mat-icon style="font-size:14px;width:14px;height:14px">open_in_new</mat-icon>
                Abrir PDF
              </a>
            </div>
          }
        </div>

        <div class="actions">
          <span class="progress" [class.complete]="allAccepted()">
            {{ checkedCount() }} / {{ pending().length }} aceitos
          </span>
          <button mat-flat-button class="submit-btn"
                  [disabled]="!allAccepted() || submitting()"
                  (click)="submit()">
            {{ submitting() ? 'Enviando...' : 'Aceitar e continuar' }}
          </button>
        </div>
      </div>

      <div class="footer-note">
        <mat-icon>info</mat-icon>
        <strong>Registro de aceite:</strong> seu aceite será registrado com data, hora,
        endereço IP e identificação do navegador, servindo como evidência documental.
        Você poderá acessar as versões aceitas a qualquer momento pelo seu perfil.
      </div>
    </div>
  `
})
export class TermsAcceptanceComponent implements OnInit {
  private terms = inject(TermsService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);

  pending = signal<LegalDocument[]>([]);
  checked = signal<Set<string>>(new Set());
  opened  = signal<Set<string>>(new Set());
  submitting = signal(false);

  checkedCount = computed(() => this.checked().size);
  allAccepted  = computed(() => this.checked().size > 0 && this.checked().size === this.pending().length);

  ngOnInit(): void {
    this.terms.getStatus().subscribe({
      next: status => {
        if (status.all_accepted) {
          this.router.navigateByUrl('/doctor/patients');
          return;
        }
        this.pending.set(status.pending);
      },
      error: () => this.snack.open('Erro ao carregar documentos.', '', { duration: 3000 })
    });
  }

  markOpened(type: string): void {
    const s = new Set(this.opened());
    s.add(type);
    this.opened.set(s);
  }

  wasOpened(type: string): boolean {
    return this.opened().has(type);
  }

  isChecked(type: string): boolean {
    return this.checked().has(type);
  }

  toggle(type: string, checked: boolean): void {
    if (!this.wasOpened(type)) return;
    const s = new Set(this.checked());
    checked ? s.add(type) : s.delete(type);
    this.checked.set(s);
  }

  submit(): void {
    if (!this.allAccepted()) return;
    this.submitting.set(true);
    this.terms.accept(this.pending()).subscribe({
      next: () => {
        this.submitting.set(false);
        this.snack.open('Documentos aceitos com sucesso.', '', { duration: 2500 });
        this.router.navigateByUrl('/doctor/patients');
      },
      error: err => {
        this.submitting.set(false);
        this.snack.open(err?.error?.error ?? 'Erro ao registrar aceite.', '', { duration: 4000 });
      }
    });
  }
}
