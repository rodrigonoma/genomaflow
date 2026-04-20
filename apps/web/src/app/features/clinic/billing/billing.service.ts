import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface LedgerItem {
  id: string;
  amount: number;
  kind: string;
  description: string;
  exam_id: string | null;
  created_at: string;
  subject_name: string | null;
  file_name: string | null;
}

export interface LedgerSummary {
  credits_consumed: number;
  credits_added: number;
  agent_events: number;
  ocr_events: number;
}

export interface UsageReport {
  period_days: number;
  exams_processed: number;
  agents_executed: number;
  credits_consumed: number;
  input_tokens: number;
  output_tokens: number;
  estimated_api_cost_brl: number;
}

@Injectable({ providedIn: 'root' })
export class BillingService {
  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getBalance(): Observable<{ balance: number }> {
    return this.http.get<{ balance: number }>(`${this.api}/billing/balance`);
  }

  getHistory(page = 1, limit = 20, dateFrom?: string, dateTo?: string): Observable<{ items: LedgerItem[]; total: number; page: number; limit: number; summary: LedgerSummary }> {
    let url = `${this.api}/billing/history?page=${page}&limit=${limit}`;
    if (dateFrom) url += `&date_from=${dateFrom}`;
    if (dateTo)   url += `&date_to=${dateTo}`;
    return this.http.get<any>(url);
  }

  getUsage(days: number): Observable<UsageReport> {
    return this.http.get<UsageReport>(`${this.api}/billing/usage?days=${days}`);
  }

  topup(gateway: string, credits: number): Observable<{ checkout_url: string }> {
    return this.http.post<{ checkout_url: string }>(`${this.api}/billing/topup`, { gateway, credits });
  }
}
