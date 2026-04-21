import { Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { environment } from '../../../../environments/environment';
import { User } from '../../../shared/models/api.models';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [
    DatePipe, FormsModule,
    MatTableModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatIconModule, MatTooltipModule
  ],
  template: `
    <div class="users-page">
      <div class="page-header">
        <h1 class="page-title">Usuários</h1>
        <button class="primary-btn" (click)="showInvite = true">
          <mat-icon>person_add</mat-icon>
          Novo Usuário
        </button>
      </div>

      @if (showInvite) {
        <div class="invite-panel">
          <h3 class="invite-title">Novo Usuário</h3>
          <div class="invite-fields">
            <mat-form-field appearance="outline">
              <mat-label>E-mail</mat-label>
              <input matInput [(ngModel)]="newEmail" type="email" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Senha inicial</mat-label>
              <input matInput [(ngModel)]="newPassword" type="password" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Role</mat-label>
              <mat-select [(ngModel)]="newRole">
                <mat-option value="admin">Admin</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <div class="invite-actions">
            <button class="primary-btn small" (click)="invite()">Criar</button>
            <button class="ghost-btn" (click)="showInvite = false">Cancelar</button>
          </div>
          @if (inviteError) {
            <p class="error-msg">{{ inviteError }}</p>
          }
        </div>
      }

      <table mat-table [dataSource]="users" class="users-table">
        <ng-container matColumnDef="email">
          <th mat-header-cell *matHeaderCellDef>E-mail</th>
          <td mat-cell *matCellDef="let u">{{ u.email }}</td>
        </ng-container>
        <ng-container matColumnDef="role">
          <th mat-header-cell *matHeaderCellDef>Role</th>
          <td mat-cell *matCellDef="let u">
            <span class="role-badge role-admin">ADMIN</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="created_at">
          <th mat-header-cell *matHeaderCellDef>Criado em</th>
          <td mat-cell *matCellDef="let u">
            <span class="date-cell">{{ u.created_at | date:'dd/MM/yyyy' }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let u">
            <button mat-icon-button class="delete-btn" (click)="remove(u)" matTooltip="Remover">
              <mat-icon>delete</mat-icon>
            </button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns;"></tr>
      </table>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      background: #0b1326;
      min-height: 100vh;
      padding: 2rem;
    }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2rem;
    }

    .page-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 1.5rem;
      color: #dae2fd;
      margin: 0;
    }

    .primary-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1.25rem;
      background: #c0c1ff;
      color: #1000a9;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .primary-btn:hover { opacity: 0.9; }
    .primary-btn.small { padding: 0.4rem 1rem; font-size: 0.8rem; }

    .ghost-btn {
      display: inline-flex;
      align-items: center;
      padding: 0.4rem 1rem;
      background: transparent;
      color: #908fa0;
      font-family: 'Inter', sans-serif;
      font-size: 0.875rem;
      border: 1px solid rgba(70, 69, 84, 0.3);
      border-radius: 4px;
      cursor: pointer;
      transition: background 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .ghost-btn:hover { background: #222a3d; }

    .invite-panel {
      background: #131b2e;
      border: 1px solid rgba(70, 69, 84, 0.15);
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .invite-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 600;
      font-size: 1rem;
      color: #dae2fd;
      margin: 0 0 1rem 0;
    }

    .invite-fields {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .invite-actions {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }

    .error-msg {
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      color: #ffb4ab;
      margin: 0.75rem 0 0 0;
    }

    .users-table {
      width: 100%;
      background: transparent !important;
    }

    .role-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: 4px;
    }

    .role-admin {
      background: rgba(192, 193, 255, 0.1);
      color: #c0c1ff;
    }

    .role-doctor {
      background: rgba(192, 193, 255, 0.08);
      color: #b2b3f2;
    }

    .role-lab {
      background: rgba(255, 183, 131, 0.1);
      color: #ffb783;
    }

    .date-cell {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #908fa0;
    }

    .delete-btn {
      color: #ffb4ab !important;
    }
  `]
})
export class UsersComponent implements OnInit {
  private http = inject(HttpClient);

  users: User[] = [];
  columns = ['email', 'role', 'created_at', 'actions'];
  showInvite = false;
  newEmail = '';
  newPassword = '';
  newRole = 'admin';
  inviteError = '';

  ngOnInit(): void { this.load(); }

  load(): void {
    this.http.get<User[]>(`${environment.apiUrl}/users`).subscribe(u => this.users = u);
  }

  invite(): void {
    this.inviteError = '';
    this.http.post<User>(`${environment.apiUrl}/users`, {
      email: this.newEmail, password: this.newPassword, role: this.newRole
    }).subscribe({
      next: (u) => {
        this.users.unshift(u);
        this.showInvite = false;
        this.newEmail = this.newPassword = '';
      },
      error: (err) => {
        this.inviteError = err.error?.error ?? 'Erro ao criar usuário.';
      }
    });
  }

  remove(user: User): void {
    if (!confirm(`Remover ${user.email}?`)) return;
    this.http.delete(`${environment.apiUrl}/users/${user.id}`).subscribe(() => {
      this.users = this.users.filter(u => u.id !== user.id);
    });
  }
}
