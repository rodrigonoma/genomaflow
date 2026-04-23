import { Component, inject, OnInit, signal, HostListener, ElementRef, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../../environments/environment';
import { Subject as SubjectModel } from '../../models/api.models';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-quick-search',
  standalone: true,
  imports: [FormsModule, AsyncPipe, MatIconModule],
  styles: [`
    :host {
      display: block; position: relative;
      min-width: 300px; max-width: 420px; width: 100%;
    }

    .search-box {
      display: flex; align-items: center; gap: 0.5rem;
      background: #111929; border: 1px solid rgba(70,69,84,0.25);
      border-radius: 6px; padding: 0.375rem 0.75rem;
      transition: border-color 150ms ease, background 150ms ease;
    }
    .search-box:focus-within {
      border-color: rgba(192,193,255,0.5);
      background: #131b2e;
    }
    .search-box mat-icon {
      color: #6e6d80; font-size: 18px; width: 18px; height: 18px; flex-shrink: 0;
    }
    .search-box input {
      flex: 1; background: transparent; border: none; outline: none;
      color: #dae2fd; font-family: 'Inter', sans-serif; font-size: 13px;
      padding: 4px 0;
    }
    .search-box input::placeholder { color: #6e6d80; }
    .clear-btn {
      background: none; border: none; color: #6e6d80; cursor: pointer;
      padding: 0; display: flex; align-items: center;
    }
    .clear-btn:hover { color: #dae2fd; }
    .kbd {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #6e6d80; border: 1px solid rgba(70,69,84,0.3);
      border-radius: 3px; padding: 1px 5px; flex-shrink: 0;
    }

    .results {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0;
      background: #111929; border: 1px solid rgba(70,69,84,0.3);
      border-radius: 6px; max-height: 400px; overflow-y: auto;
      z-index: 200; box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    }

    .result-item {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.625rem 0.875rem; cursor: pointer;
      border-bottom: 1px solid rgba(70,69,84,0.12);
      transition: background 150ms ease;
    }
    .result-item:last-child { border-bottom: none; }
    .result-item:hover, .result-item.active {
      background: #1a2540;
    }
    .result-icon {
      width: 28px; height: 28px; border-radius: 50%;
      background: rgba(192,193,255,0.08);
      display: flex; align-items: center; justify-content: center;
      color: #c0c1ff; flex-shrink: 0;
    }
    .result-icon.animal { background: rgba(74,214,160,0.08); color: #4ad6a0; }
    .result-icon mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .result-name {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 13px; color: #dae2fd;
    }
    .result-meta {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #7c7b8f; margin-top: 2px;
    }

    .empty {
      padding: 1.25rem 0.875rem; text-align: center;
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: #7c7b8f;
    }
  `],
  template: `
    <div class="search-box" (click)="focusInput()">
      <mat-icon>search</mat-icon>
      <input #inp type="text"
             [(ngModel)]="query"
             (ngModelChange)="onQueryChange($event)"
             (focus)="onFocus()"
             (keydown)="onKeydown($event)"
             [placeholder]="placeholderText()"
             autocomplete="off"/>
      @if (query) {
        <button class="clear-btn" (click)="clear($event)" aria-label="Limpar">
          <mat-icon style="font-size:16px;width:16px;height:16px">close</mat-icon>
        </button>
      } @else {
        <span class="kbd">/</span>
      }
    </div>

    @if (isOpen() && (query.trim() || recentResults().length > 0)) {
      <div class="results">
        @if (filtered().length === 0) {
          <div class="empty">
            @if (query.trim()) { Nenhum resultado para "{{ query }}". }
            @else { Digite para buscar... }
          </div>
        } @else {
          @for (p of filtered(); track p.id; let i = $index) {
            <div class="result-item" [class.active]="i === activeIndex()" (click)="select(p)">
              <div class="result-icon" [class.animal]="p.subject_type === 'animal'">
                <mat-icon>{{ p.subject_type === 'animal' ? 'pets' : 'person' }}</mat-icon>
              </div>
              <div>
                <div class="result-name">{{ p.name }}</div>
                <div class="result-meta">
                  @if (p.subject_type === 'animal') {
                    @if (p.species) { {{ speciesLabel(p.species) }} }
                    @if (p.breed) { · {{ p.breed }} }
                    @if (p.owner_name) { · Dono: {{ p.owner_name }} }
                  } @else {
                    {{ p.sex }}
                    @if (p.cpf_last4) { · CPF ***{{ p.cpf_last4 }} }
                    @if (p.birth_date) { · {{ p.birth_date }} }
                  }
                </div>
              </div>
            </div>
          }
        }
      </div>
    }
  `
})
export class QuickSearchComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  private el = inject(ElementRef);
  auth = inject(AuthService);

  query = '';
  private allSubjects = signal<SubjectModel[]>([]);
  private isOpenSig = signal(false);
  activeIndex = signal(0);

  filtered = computed<SubjectModel[]>(() => {
    const q = this.query.toLowerCase().trim();
    if (!q) return [];
    const nq = this.normalize(q);
    return this.allSubjects().filter(p =>
      this.normalize(p.name).includes(nq) ||
      this.normalize(p.owner_name ?? '').includes(nq)
    ).slice(0, 8);
  });

  /**
   * Remove acentos para busca case/diacritic-insensitive.
   * Decompõe via NFD e remove o bloco Unicode de Combining Diacritical Marks (U+0300–U+036F).
   * Usa RegExp() com string escape explícito para evitar ambiguidade de encoding do arquivo.
   */
  private readonly DIACRITICS_REGEX = new RegExp('[\\u0300-\\u036f]', 'g');
  private normalize(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(this.DIACRITICS_REGEX, '');
  }

  placeholderText(): string {
    return this.auth.currentUser?.module === 'veterinary' ? 'Buscar animal...' : 'Buscar paciente...';
  }

  recentResults = computed<SubjectModel[]>(() => this.allSubjects().slice(0, 5));

  isOpen = computed(() => this.isOpenSig());

  ngOnInit(): void {
    this.loadSubjects();
  }

  private loadSubjects(): void {
    this.http.get<SubjectModel[]>(`${environment.apiUrl}/patients`).subscribe({
      next: list => this.allSubjects.set(list),
      error: () => {}
    });
  }

  focusInput(): void {
    const inp = this.el.nativeElement.querySelector('input');
    if (inp) inp.focus();
  }

  onFocus(): void {
    this.isOpenSig.set(true);
    // Recarrega caso a busca inicial não tenha retornado (ex: timing de login)
    if (this.allSubjects().length === 0) this.loadSubjects();
  }

  onQueryChange(_v: string): void {
    this.isOpenSig.set(true);
    this.activeIndex.set(0);
  }

  onKeydown(event: KeyboardEvent): void {
    const results = this.filtered();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.set(Math.min(this.activeIndex() + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.set(Math.max(this.activeIndex() - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const r = results[this.activeIndex()];
      if (r) this.select(r);
    } else if (event.key === 'Escape') {
      this.clear(event);
    }
  }

  select(p: SubjectModel): void {
    this.router.navigate(['/doctor/patients', p.id]);
    this.query = '';
    this.isOpenSig.set(false);
    // recarrega lista em background para pegar pacientes novos
    this.loadSubjects();
  }

  clear(event: Event): void {
    event.stopPropagation();
    this.query = '';
    this.isOpenSig.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.el.nativeElement.contains(event.target)) {
      this.isOpenSig.set(false);
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    // Atalho "/" foca o campo, se não estiver em input/textarea
    if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      this.focusInput();
      this.isOpenSig.set(true);
    }
  }

  speciesLabel(species: string): string {
    const map: Record<string, string> = {
      dog: 'Cão', cat: 'Gato', equine: 'Equino', bovine: 'Bovino',
      bird: 'Ave', reptile: 'Réptil', other: 'Outro'
    };
    return map[species] ?? species;
  }
}
