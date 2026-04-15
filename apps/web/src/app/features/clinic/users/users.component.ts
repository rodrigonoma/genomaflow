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
    <div class="page-container">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-semibold">Usuários</h1>
        <button mat-flat-button color="primary" (click)="showInvite = true">Convidar usuário</button>
      </div>

      @if (showInvite) {
        <div class="bg-gray-50 border rounded p-4 mb-6">
          <h3 class="font-medium mb-3">Novo usuário</h3>
          <div class="flex gap-3 flex-wrap">
            <mat-form-field>
              <mat-label>E-mail</mat-label>
              <input matInput [(ngModel)]="newEmail" type="email" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Senha inicial</mat-label>
              <input matInput [(ngModel)]="newPassword" type="password" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Role</mat-label>
              <mat-select [(ngModel)]="newRole">
                <mat-option value="doctor">Médico</mat-option>
                <mat-option value="lab_tech">Lab Tech</mat-option>
                <mat-option value="admin">Admin</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <div class="flex gap-2">
            <button mat-flat-button color="primary" (click)="invite()">Criar</button>
            <button mat-button (click)="showInvite = false">Cancelar</button>
          </div>
          @if (inviteError) { <p class="text-red-600 text-sm mt-2">{{ inviteError }}</p> }
        </div>
      }

      <table mat-table [dataSource]="users" class="w-full">
        <ng-container matColumnDef="email">
          <th mat-header-cell *matHeaderCellDef>E-mail</th>
          <td mat-cell *matCellDef="let u">{{ u.email }}</td>
        </ng-container>
        <ng-container matColumnDef="role">
          <th mat-header-cell *matHeaderCellDef>Role</th>
          <td mat-cell *matCellDef="let u">
            <span class="capitalize px-2 py-1 rounded text-xs font-medium"
              [class]="u.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                       u.role === 'doctor' ? 'bg-blue-100 text-blue-800' :
                       'bg-green-100 text-green-800'">
              {{ u.role }}
            </span>
          </td>
        </ng-container>
        <ng-container matColumnDef="created_at">
          <th mat-header-cell *matHeaderCellDef>Criado em</th>
          <td mat-cell *matCellDef="let u">{{ u.created_at | date:'dd/MM/yyyy' }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let u">
            <button mat-icon-button color="warn" (click)="remove(u)"
              matTooltip="Remover">
              <mat-icon>delete</mat-icon>
            </button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns;"></tr>
      </table>
    </div>
  `
})
export class UsersComponent implements OnInit {
  private http = inject(HttpClient);

  users: User[] = [];
  columns = ['email', 'role', 'created_at', 'actions'];
  showInvite = false;
  newEmail = '';
  newPassword = '';
  newRole = 'doctor';
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
