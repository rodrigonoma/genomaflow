import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Owner {
  id: string;
  name: string;
  cpf_last4: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  observations?: string | null;
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  created_at: string;
  updated_at?: string;
}

export interface OwnerUpdatePayload {
  name?: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  observations?: string | null;
  cep?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
}

@Injectable({ providedIn: 'root' })
export class OwnersService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/patients/owners`;

  list(): Observable<Owner[]> {
    return this.http.get<Owner[]>(this.base);
  }

  get(id: string): Observable<Owner> {
    return this.http.get<Owner>(`${this.base}/${id}`);
  }

  update(id: string, payload: OwnerUpdatePayload): Observable<Owner> {
    return this.http.put<Owner>(`${this.base}/${id}`, payload);
  }
}
