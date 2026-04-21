import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../../environments/environment';
import { ClinicProfile } from '../../../shared/models/api.models';

@Component({
  selector: 'app-clinic-profile-modal',
  standalone: true,
  imports: [MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatSnackBarModule, FormsModule],
  styles: [`
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 1.5rem 1.5rem 0; margin-bottom: 1.25rem; }
    h2 { font-family: 'Space Grotesk', sans-serif; font-size: 1.125rem; font-weight: 700; color: #dae2fd; margin: 0; }
    .modal-body { padding: 0 1.5rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
    .field { width: 100%; }
    .logo-section { display: flex; flex-direction: column; gap: 0.5rem; }
    .logo-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #6e6d80; }
    .logo-preview { width: 80px; height: 80px; object-fit: contain; border: 1px solid rgba(70,69,84,0.3); border-radius: 6px; background: #0b1326; }
    .logo-placeholder { width: 80px; height: 80px; border: 1px dashed rgba(70,69,84,0.4); border-radius: 6px; display: flex; align-items: center; justify-content: center; }
    .footer { display: flex; justify-content: flex-end; gap: 0.75rem; padding: 1rem 1.5rem; border-top: 1px solid rgba(70,69,84,0.15); }
  `],
  template: `
    <div class="modal-header">
      <h2>Editar Perfil da Clínica</h2>
      <button mat-icon-button (click)="close()"><mat-icon>close</mat-icon></button>
    </div>
    <div class="modal-body">
      <mat-form-field class="field" appearance="outline">
        <mat-label>Nome da Clínica</mat-label>
        <input matInput [(ngModel)]="name" />
      </mat-form-field>

      <mat-form-field class="field" appearance="outline">
        <mat-label>CNPJ</mat-label>
        <input matInput [(ngModel)]="cnpj" placeholder="00.000.000/0000-00" />
      </mat-form-field>

      <div class="logo-section">
        <span class="logo-label">Logo da Clínica (PNG ou JPG, máx 2MB)</span>
        <div style="display:flex;align-items:center;gap:1rem;">
          @if (logoPreview()) {
            <img class="logo-preview" [src]="logoPreview()" alt="Logo" />
          } @else {
            <div class="logo-placeholder"><mat-icon style="color:#6e6d80">image</mat-icon></div>
          }
          <button mat-stroked-button (click)="fileInput.click()" style="font-size:11px">
            <mat-icon>upload</mat-icon> Selecionar imagem
          </button>
          <input #fileInput type="file" accept="image/png,image/jpeg" style="display:none" (change)="onFileSelected($event)" />
        </div>
      </div>

      @if (error()) {
        <p style="color:#ffb4ab;font-family:'JetBrains Mono',monospace;font-size:11px;margin:0">{{ error() }}</p>
      }
    </div>
    <div class="footer">
      <button mat-button (click)="close()">Cancelar</button>
      <button mat-flat-button color="primary" [disabled]="saving()" (click)="save()">
        {{ saving() ? 'Salvando...' : 'Salvar' }}
      </button>
    </div>
  `
})
export class ClinicProfileModalComponent implements OnInit {
  private http      = inject(HttpClient);
  private snack     = inject(MatSnackBar);
  private dialogRef = inject(MatDialogRef<ClinicProfileModalComponent>);

  name        = '';
  cnpj        = '';
  logoPreview = signal<string | null>(null);
  saving      = signal(false);
  error       = signal('');

  private selectedFile: File | null = null;

  ngOnInit(): void {
    this.http.get<ClinicProfile>(`${environment.apiUrl}/clinic/profile`).subscribe({
      next: (p) => {
        this.name = p.name ?? '';
        this.cnpj = p.cnpj ?? '';
        if (p.clinic_logo_url) this.logoPreview.set(p.clinic_logo_url);
      },
      error: () => {}
    });
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { this.error.set('Imagem deve ter no máximo 2MB'); return; }
    this.selectedFile = file;
    const reader = new FileReader();
    reader.onload = (e) => this.logoPreview.set(e.target?.result as string);
    reader.readAsDataURL(file);
    this.error.set('');
  }

  save(): void {
    if (!this.name.trim()) { this.error.set('Nome da clínica é obrigatório'); return; }
    this.saving.set(true);
    this.error.set('');

    const updateProfile$ = this.http.put(`${environment.apiUrl}/clinic/profile`, { name: this.name, cnpj: this.cnpj });

    if (this.selectedFile) {
      const form = new FormData();
      form.append('file', this.selectedFile);
      this.http.post(`${environment.apiUrl}/clinic/logo`, form).subscribe({
        next: () => {
          updateProfile$.subscribe({
            next: () => { this.saving.set(false); this.snack.open('Perfil atualizado', '', { duration: 2500 }); this.dialogRef.close(true); },
            error: (e) => { this.saving.set(false); this.error.set(e.error?.error ?? 'Erro ao salvar'); }
          });
        },
        error: (e) => { this.saving.set(false); this.error.set(e.error?.error ?? 'Erro ao enviar logo'); }
      });
    } else {
      updateProfile$.subscribe({
        next: () => { this.saving.set(false); this.snack.open('Perfil atualizado', '', { duration: 2500 }); this.dialogRef.close(true); },
        error: (e) => { this.saving.set(false); this.error.set(e.error?.error ?? 'Erro ao salvar'); }
      });
    }
  }

  close(): void { this.dialogRef.close(); }
}
