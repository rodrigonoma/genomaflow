import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timer, switchMap, map, shareReplay, catchError, of, merge, Subject } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ReviewQueueItem } from '../../../shared/models/api.models';

@Injectable({ providedIn: 'root' })
export class ReviewQueueService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/exams`;

  private _forceRefresh$ = new Subject<void>();

  // Polls every 60s; also refreshes immediately when refreshCount() is called
  readonly pendingCount$: Observable<number> = merge(timer(0, 60_000), this._forceRefresh$).pipe(
    switchMap(() =>
      this.http.get<{ count: number }>(`${this.base}/review-queue/count`).pipe(
        catchError(() => of({ count: 0 }))
      )
    ),
    map(r => r.count),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  refreshCount(): void { this._forceRefresh$.next(); }

  getQueue(): Observable<ReviewQueueItem[]> {
    return this.http.get<ReviewQueueItem[]>(`${this.base}/review-queue`);
  }

  markViewed(examId: string): Observable<unknown> {
    return this.http.patch(`${this.base}/${examId}/review-status`, { review_status: 'viewed' });
  }

  markReviewed(examId: string): Observable<unknown> {
    return this.http.patch(`${this.base}/${examId}/review-status`, { review_status: 'reviewed' });
  }

  navigate(currentId: string, direction: 'next' | 'prev'): Observable<{ id: string }> {
    return this.http.get<{ id: string }>(
      `${this.base}/review-queue/navigate?current_id=${currentId}&direction=${direction}`
    );
  }
}
