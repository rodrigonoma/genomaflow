import { Observable, of, map, catchError } from 'rxjs';
import { HttpClient } from '@angular/common/http';

interface ViaCepResponse {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

export interface CepAddress {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

/**
 * Busca endereço por CEP via ViaCEP. Retorna null se não encontrado.
 */
export function lookupCep(http: HttpClient, cep: string): Observable<CepAddress | null> {
  const digits = (cep || '').replace(/\D/g, '');
  if (digits.length !== 8) return of(null);
  return http.get<ViaCepResponse>(`https://viacep.com.br/ws/${digits}/json/`).pipe(
    map(r => r?.erro ? null : {
      street: r.logradouro || '',
      neighborhood: r.bairro || '',
      city: r.localidade || '',
      state: r.uf || ''
    }),
    catchError(() => of(null))
  );
}
