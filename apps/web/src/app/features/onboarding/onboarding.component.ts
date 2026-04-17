import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

interface OnboardingData {
  clinic_name: string;
  email: string;
  password: string;
  confirm_password: string;
  module: 'human' | 'veterinary' | '';
  specialties: string[];
  gateway: 'stripe' | 'mercadopago' | '';
  tenant_id: string;
}

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div style="min-height:100vh;background:#0b1326;color:#dbe2fd;font-family:Inter,sans-serif;" class="flex flex-col items-center justify-center px-4 py-16">

  <!-- Progress bar -->
  <div class="w-full max-w-xl mb-10">
    <div class="flex items-center gap-2 mb-2">
      @for (s of [1,2,3,4]; track s) {
        <div class="h-1 flex-1 rounded-full transition-all"
             [style.background]="step() >= s ? '#c0c1ff' : '#222a3e'"></div>
      }
    </div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:#c7c5d0;letter-spacing:0.1em;text-transform:uppercase;">
      Etapa {{ step() }} de 4 — {{ stepLabel() }}
    </div>
  </div>

  <!-- Card -->
  <div class="w-full max-w-xl" style="background:#222a3e;border-radius:0.25rem;padding:2.5rem;">

    @switch (step()) {

      <!-- Step 1: Dados da Clínica -->
      @case (1) {
        <div class="mb-6">
          <h1 style="font-family:'Space Grotesk',sans-serif;font-size:1.875rem;font-weight:700;margin-bottom:0.5rem;">Dados da Clínica</h1>
          <p style="color:#c7c5d0;font-size:0.875rem;">Preencha os dados do administrador da conta.</p>
        </div>
        <div class="space-y-4">
          <div>
            <label style="font-size:0.625rem;letter-spacing:0.1em;text-transform:uppercase;color:#c7c5d0;display:block;margin-bottom:0.25rem;">Nome da Clínica</label>
            <input [(ngModel)]="data.clinic_name" placeholder="Clínica São Lucas"
              style="width:100%;background:#060d20;color:#dbe2fd;font-family:'JetBrains Mono',monospace;font-size:0.875rem;padding:0.75rem 1rem;border:none;border-bottom:1px solid transparent;outline:none;box-sizing:border-box;"
              (focus)="$any($event.target).style.borderBottomColor='#c0c1ff'"
              (blur)="$any($event.target).style.borderBottomColor='transparent'"/>
          </div>
          <div>
            <label style="font-size:0.625rem;letter-spacing:0.1em;text-transform:uppercase;color:#c7c5d0;display:block;margin-bottom:0.25rem;">Email do Administrador</label>
            <input [(ngModel)]="data.email" type="email" placeholder="admin@clinica.com.br"
              style="width:100%;background:#060d20;color:#dbe2fd;font-family:'JetBrains Mono',monospace;font-size:0.875rem;padding:0.75rem 1rem;border:none;border-bottom:1px solid transparent;outline:none;box-sizing:border-box;"
              (focus)="$any($event.target).style.borderBottomColor='#c0c1ff'"
              (blur)="$any($event.target).style.borderBottomColor='transparent'"/>
          </div>
          <div>
            <label style="font-size:0.625rem;letter-spacing:0.1em;text-transform:uppercase;color:#c7c5d0;display:block;margin-bottom:0.25rem;">Senha (mínimo 8 caracteres)</label>
            <input [(ngModel)]="data.password" type="password" placeholder="••••••••"
              style="width:100%;background:#060d20;color:#dbe2fd;font-family:'JetBrains Mono',monospace;font-size:0.875rem;padding:0.75rem 1rem;border:none;border-bottom:1px solid transparent;outline:none;box-sizing:border-box;"
              (focus)="$any($event.target).style.borderBottomColor='#c0c1ff'"
              (blur)="$any($event.target).style.borderBottomColor='transparent'"/>
          </div>
          <div>
            <label style="font-size:0.625rem;letter-spacing:0.1em;text-transform:uppercase;color:#c7c5d0;display:block;margin-bottom:0.25rem;">Confirmar Senha</label>
            <input [(ngModel)]="data.confirm_password" type="password" placeholder="••••••••"
              style="width:100%;background:#060d20;color:#dbe2fd;font-family:'JetBrains Mono',monospace;font-size:0.875rem;padding:0.75rem 1rem;border:none;border-bottom:1px solid transparent;outline:none;box-sizing:border-box;"
              (focus)="$any($event.target).style.borderBottomColor='#c0c1ff'"
              (blur)="$any($event.target).style.borderBottomColor='transparent'"/>
          </div>
          @if (errorMsg()) {
            <p style="color:#ffb4ab;font-family:'JetBrains Mono',monospace;font-size:0.75rem;">{{ errorMsg() }}</p>
          }
        </div>
        <button (click)="nextStep1()" style="width:100%;margin-top:1.5rem;padding:0.75rem;background:#c0c1ff;color:#4b4d83;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:0.75rem;letter-spacing:0.1em;text-transform:uppercase;border:none;border-radius:0.25rem;cursor:pointer;">
          Continuar
        </button>
      }

      <!-- Step 2: Módulo -->
      @case (2) {
        <div class="mb-6">
          <h1 style="font-family:'Space Grotesk',sans-serif;font-size:1.875rem;font-weight:700;margin-bottom:0.5rem;">Seleção de Módulo</h1>
          <p style="color:#c7c5d0;font-size:0.875rem;">Esta seleção é permanente após o cadastro.</p>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
          <div (click)="data.module = 'human'" style="padding:2rem;border-radius:0.25rem;cursor:pointer;border:2px solid transparent;transition:all 0.2s;"
               [style.borderColor]="data.module === 'human' ? '#c0c1ff' : 'transparent'"
               [style.background]="data.module === 'human' ? '#171f33' : '#060d20'">
            <span style="font-family:'Material Symbols Outlined';color:#c0c1ff;font-size:2rem;display:block;margin-bottom:0.75rem;">local_hospital</span>
            <h3 style="font-family:'Space Grotesk',sans-serif;font-size:1rem;font-weight:600;margin-bottom:0.5rem;">Clínica Humana</h3>
            <p style="font-size:0.75rem;color:#c7c5d0;">Medicina humana: metabólico, cardiovascular, hematologia</p>
          </div>
          <div (click)="data.module = 'veterinary'" style="padding:2rem;border-radius:0.25rem;cursor:pointer;border:2px solid transparent;transition:all 0.2s;"
               [style.borderColor]="data.module === 'veterinary' ? '#c0c1ff' : 'transparent'"
               [style.background]="data.module === 'veterinary' ? '#171f33' : '#060d20'">
            <span style="font-family:'Material Symbols Outlined';color:#c0c1ff;font-size:2rem;display:block;margin-bottom:0.75rem;">pets</span>
            <h3 style="font-family:'Space Grotesk',sans-serif;font-size:1rem;font-weight:600;margin-bottom:0.5rem;">Clínica Veterinária</h3>
            <p style="font-size:0.75rem;color:#c7c5d0;">Medicina veterinária: pequenos animais, equinos, bovinos</p>
          </div>
        </div>
        @if (errorMsg()) {
          <p style="color:#ffb4ab;font-family:'JetBrains Mono',monospace;font-size:0.75rem;margin-bottom:1rem;">{{ errorMsg() }}</p>
        }
        <div style="display:flex;gap:0.75rem;">
          <button (click)="step.set(1)" style="flex:1;padding:0.75rem;background:#060d20;color:#c7c5d0;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:0.75rem;letter-spacing:0.1em;text-transform:uppercase;border:none;border-radius:0.25rem;cursor:pointer;">Voltar</button>
          <button (click)="nextStep2()" style="flex:1;padding:0.75rem;background:#c0c1ff;color:#4b4d83;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:0.75rem;letter-spacing:0.1em;text-transform:uppercase;border:none;border-radius:0.25rem;cursor:pointer;">Continuar</button>
        </div>
      }

      <!-- Step 3: Especialidades -->
      @case (3) {
        <div class="mb-6">
          <h1 style="font-family:'Space Grotesk',sans-serif;font-size:1.875rem;font-weight:700;margin-bottom:0.5rem;">Especialidades</h1>
          <p style="color:#c7c5d0;font-size:0.875rem;">Mínimo 1 especialidade obrigatória.</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1rem;">
          @for (spec of currentSpecialties; track spec.key) {
            <div (click)="toggleSpecialty(spec.key)"
                 style="display:flex;align-items:center;gap:1rem;padding:1rem;border-radius:0.25rem;cursor:pointer;transition:all 0.2s;"
                 [style.background]="isSpecialtySelected(spec.key) ? '#171f33' : '#060d20'">
              <div style="width:16px;height:16px;border-radius:2px;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all 0.2s;"
                   [style.background]="isSpecialtySelected(spec.key) ? '#c0c1ff' : 'transparent'"
                   [style.border]="isSpecialtySelected(spec.key) ? 'none' : '1px solid rgba(192,193,255,0.4)'">
                @if (isSpecialtySelected(spec.key)) {
                  <span style="color:#060d20;font-size:10px;font-weight:bold;">✓</span>
                }
              </div>
              <span style="font-size:0.875rem;">{{ spec.label }}</span>
              @if (spec.phase2) {
                <span style="margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:0.625rem;color:#c7c5d0;border:1px solid rgba(70,70,79,0.5);padding:0.125rem 0.5rem;">fase 2</span>
              }
            </div>
          }
        </div>
        @if (data.specialties.length > 0) {
          <div style="background:#060d20;padding:1rem;border-radius:0.25rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#c0c1ff;margin-bottom:1rem;">
            Com {{ data.specialties.length }} especialidade(s), cada exame consome {{ data.specialties.length }} crédito(s).
          </div>
        }
        @if (errorMsg()) {
          <p style="color:#ffb4ab;font-family:'JetBrains Mono',monospace;font-size:0.75rem;margin-bottom:1rem;">{{ errorMsg() }}</p>
        }
        <div style="display:flex;gap:0.75rem;">
          <button (click)="step.set(2)" style="flex:1;padding:0.75rem;background:#060d20;color:#c7c5d0;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:0.75rem;letter-spacing:0.1em;text-transform:uppercase;border:none;border-radius:0.25rem;cursor:pointer;">Voltar</button>
          <button (click)="nextStep3()" [disabled]="loading()"
                  style="flex:1;padding:0.75rem;background:#c0c1ff;color:#4b4d83;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:0.75rem;letter-spacing:0.1em;text-transform:uppercase;border:none;border-radius:0.25rem;cursor:pointer;"
                  [style.opacity]="loading() ? '0.5' : '1'">
            {{ loading() ? 'Registrando...' : 'Continuar' }}
          </button>
        </div>
      }

      <!-- Step 4: Plano e Pagamento -->
      @case (4) {
        <div class="mb-6">
          <h1 style="font-family:'Space Grotesk',sans-serif;font-size:1.875rem;font-weight:700;">Plano e Pagamento</h1>
        </div>

        <!-- Card assinatura -->
        <div style="background:#060d20;padding:1.5rem;border-radius:0.25rem;margin-bottom:1rem;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:0.625rem;color:#c0c1ff;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:0.5rem;">Assinatura Mensal</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:2.25rem;color:#c0c1ff;">R$&nbsp;199<span style="font-size:0.75rem;color:#c7c5d0;">,00/mês</span></div>
          <ul style="font-size:0.75rem;color:#c7c5d0;margin-top:1rem;list-style:none;padding:0;display:flex;flex-direction:column;gap:0.25rem;">
            <li>✦ Acesso completo à plataforma</li>
            <li>✦ Todos os módulos habilitados</li>
            <li>✦ Suporte 8/5</li>
          </ul>
        </div>

        <!-- Banner promoção -->
        <div style="border-left:2px solid #585990;background:rgba(192,193,255,0.08);backdrop-filter:blur(20px);padding:1rem;margin-bottom:1rem;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:0.625rem;color:#c0c1ff;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:0.25rem;">✦ Oferta de Boas-Vindas</div>
          <p style="font-size:0.75rem;color:#c7c5d0;line-height:1.5;">
            Primeiro mês: ~122 créditos grátis<br/>
            <span style="color:#c0c1ff;">(30% de R$&nbsp;199,00 convertidos em créditos)</span>
          </p>
        </div>

        <!-- Gateway -->
        <div style="margin-bottom:1rem;">
          <label style="font-size:0.625rem;letter-spacing:0.1em;text-transform:uppercase;color:#c7c5d0;display:block;margin-bottom:0.5rem;">Forma de Pagamento</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
            <div (click)="data.gateway = 'stripe'" style="padding:1rem;border-radius:0.25rem;cursor:pointer;text-align:center;border:2px solid transparent;transition:all 0.2s;"
                 [style.borderColor]="data.gateway === 'stripe' ? '#c0c1ff' : 'transparent'"
                 [style.background]="data.gateway === 'stripe' ? '#171f33' : '#060d20'">
              <div style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#c0c1ff;margin-bottom:0.25rem;">Stripe</div>
              <div style="font-size:0.625rem;color:#c7c5d0;">Cartão de crédito</div>
            </div>
            <div (click)="data.gateway = 'mercadopago'" style="padding:1rem;border-radius:0.25rem;cursor:pointer;text-align:center;border:2px solid transparent;transition:all 0.2s;"
                 [style.borderColor]="data.gateway === 'mercadopago' ? '#c0c1ff' : 'transparent'"
                 [style.background]="data.gateway === 'mercadopago' ? '#171f33' : '#060d20'">
              <div style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#c0c1ff;margin-bottom:0.25rem;">Mercado Pago</div>
              <div style="font-size:0.625rem;color:#c7c5d0;">PIX / Boleto</div>
            </div>
          </div>
        </div>

        @if (errorMsg()) {
          <p style="color:#ffb4ab;font-family:'JetBrains Mono',monospace;font-size:0.75rem;margin-bottom:1rem;">{{ errorMsg() }}</p>
        }

        <button (click)="goToPayment()" [disabled]="loading()"
                style="width:100%;padding:0.75rem;background:#c0c1ff;color:#4b4d83;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:0.75rem;letter-spacing:0.1em;text-transform:uppercase;border:none;border-radius:0.25rem;cursor:pointer;margin-bottom:0.75rem;"
                [style.opacity]="loading() ? '0.5' : '1'">
          {{ loading() ? 'Redirecionando...' : 'Ir para pagamento' }}
        </button>

        @if (!isProd()) {
          <button (click)="simulatePayment()" [disabled]="loading()"
                  style="width:100%;padding:0.75rem;background:transparent;color:#c0c1ff;font-family:'JetBrains Mono',monospace;font-size:0.75rem;letter-spacing:0.1em;text-transform:uppercase;border:1px solid rgba(192,193,255,0.2);border-radius:0.25rem;cursor:pointer;"
                  [style.opacity]="loading() ? '0.5' : '1'">
            Simular pagamento aprovado (dev)
          </button>
        }
      }

    }
  </div>
</div>
  `,
})
export class OnboardingComponent {
  step = signal<number>(1);
  errorMsg = signal<string>('');
  loading = signal<boolean>(false);

  data: OnboardingData = {
    clinic_name: '',
    email: '',
    password: '',
    confirm_password: '',
    module: '',
    specialties: [],
    gateway: '',
    tenant_id: ''
  };

  readonly specialtiesMap: Record<string, { key: string; label: string; phase2?: boolean }[]> = {
    human: [
      { key: 'metabolic', label: 'Metabólico' },
      { key: 'cardiovascular', label: 'Cardiovascular' },
      { key: 'hematology', label: 'Hematologia' },
      { key: 'therapeutic', label: 'Terapêutico', phase2: true },
      { key: 'nutrition', label: 'Nutrição', phase2: true }
    ],
    veterinary: [
      { key: 'small_animals', label: 'Pequenos Animais (cão/gato)' },
      { key: 'equine', label: 'Equinos' },
      { key: 'bovine', label: 'Bovinos' },
      { key: 'therapeutic', label: 'Terapêutico', phase2: true },
      { key: 'nutrition', label: 'Nutrição', phase2: true }
    ]
  };

  constructor(private http: HttpClient, private router: Router) {}

  get currentSpecialties() {
    return this.specialtiesMap[this.data.module as string] ?? [];
  }

  stepLabel(): string {
    return ['', 'Dados da Clínica', 'Seleção de Módulo', 'Especialidades', 'Plano e Pagamento'][this.step()] ?? '';
  }

  toggleSpecialty(key: string): void {
    const idx = this.data.specialties.indexOf(key);
    if (idx >= 0) this.data.specialties.splice(idx, 1);
    else this.data.specialties.push(key);
  }

  isSpecialtySelected(key: string): boolean {
    return this.data.specialties.includes(key);
  }

  isProd(): boolean {
    return environment.production;
  }

  nextStep1(): void {
    this.errorMsg.set('');
    if (!this.data.clinic_name.trim()) return this.errorMsg.set('Nome da clínica é obrigatório.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.data.email)) return this.errorMsg.set('Email inválido.');
    if (this.data.password.length < 8) return this.errorMsg.set('Senha deve ter no mínimo 8 caracteres.');
    if (this.data.password !== this.data.confirm_password) return this.errorMsg.set('Senhas não coincidem.');
    this.step.set(2);
  }

  nextStep2(): void {
    this.errorMsg.set('');
    if (!this.data.module) return this.errorMsg.set('Selecione um módulo.');
    this.step.set(3);
  }

  nextStep3(): void {
    this.errorMsg.set('');
    if (this.data.specialties.length === 0) return this.errorMsg.set('Selecione ao menos 1 especialidade.');
    this.loading.set(true);
    this.http.post<{ tenant_id: string; user_id: string; email: string }>(
      `${environment.apiUrl}/auth/register`,
      {
        clinic_name: this.data.clinic_name,
        email: this.data.email,
        password: this.data.password,
        module: this.data.module
      }
    ).subscribe({
      next: (res) => {
        this.data.tenant_id = res.tenant_id;
        this.loading.set(false);
        this.step.set(4);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMsg.set(err.error?.error ?? 'Erro ao criar conta. Tente novamente.');
      }
    });
  }

  goToPayment(): void {
    this.errorMsg.set('');
    if (!this.data.gateway) return this.errorMsg.set('Selecione uma forma de pagamento.');
    this.loading.set(true);
    this.http.post<{ checkout_url: string }>(
      `${environment.apiUrl}/billing/subscribe`,
      {
        gateway: this.data.gateway,
        plan: 'starter',
        tenant_id: this.data.tenant_id,
        specialties: this.data.specialties
      }
    ).subscribe({
      next: (res) => { window.location.href = res.checkout_url; },
      error: (err) => {
        this.loading.set(false);
        this.errorMsg.set(err.error?.error ?? 'Erro ao iniciar pagamento.');
      }
    });
  }

  simulatePayment(): void {
    this.loading.set(true);
    this.http.post(`${environment.apiUrl}/auth/activate`, { tenant_id: this.data.tenant_id })
      .subscribe({
        next: () => this.router.navigate(['/login'], { queryParams: { activated: 'true' } }),
        error: () => {
          this.loading.set(false);
          this.errorMsg.set('Erro ao simular pagamento.');
        }
      });
  }
}
