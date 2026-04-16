// apps/web/src/app/features/clinic/integrations/wizard/wizard.component.ts
import { Component, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatStepperModule } from '@angular/material/stepper';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../../../environments/environment';
import { SwaggerParseResult } from '../../../../shared/models/api.models';

interface TargetField { key: string; label: string; required: boolean; }

const TARGET_FIELDS: TargetField[] = [
  { key: 'patient.name',       label: 'Nome do paciente',       required: true  },
  { key: 'patient.birth_date', label: 'Data de nascimento',     required: false },
  { key: 'patient.sex',        label: 'Sexo (M/F)',             required: false },
  { key: 'exam.file_url',      label: 'URL do arquivo PDF',     required: false },
  { key: 'exam.external_id',   label: 'ID externo do exame',    required: false },
];

@Component({
  selector: 'app-wizard',
  standalone: true,
  imports: [
    FormsModule, ReactiveFormsModule, MatStepperModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, MatIconModule
  ],
  template: `
    <div class="wizard-page">
      <div class="wizard-header">
        <button class="back-btn" (click)="cancel()">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div>
          <h1 class="page-title">Nova Integração</h1>
          <span class="page-subtitle">INTEGRATION STUDIO &middot; CONFIGURAÇÃO</span>
        </div>
      </div>

      <div class="wizard-card">
        <mat-stepper [linear]="true" #stepper class="wizard-stepper">

          <!-- STEP 1: Choose mode -->
          <mat-step label="Tipo de integração">
            <div class="step-content">
              <p class="step-desc">Selecione como seu sistema envia dados para o GenomaFlow.</p>
              <div class="mode-grid">
                @for (m of modes; track m.key) {
                  <div class="mode-card"
                    [class.mode-selected]="selectedMode === m.key"
                    [class.mode-disabled]="!m.available"
                    (click)="m.available && (selectedMode = m.key)">
                    <mat-icon class="mode-icon">{{ m.icon }}</mat-icon>
                    <span class="mode-label">{{ m.label }}</span>
                    <span class="mode-sub">{{ m.sub }}</span>
                    @if (!m.available) {
                      <span class="coming-soon">EM BREVE</span>
                    }
                  </div>
                }
              </div>
              <div class="step-actions">
                <button class="wizard-btn" [disabled]="!selectedMode" matStepperNext>
                  Continuar <mat-icon>arrow_forward</mat-icon>
                </button>
              </div>
            </div>
          </mat-step>

          <!-- STEP 2: Configure connection -->
          <mat-step label="Configurar conexão" [stepControl]="connectionForm">
            <form [formGroup]="connectionForm">
              <div class="step-content">
                <p class="step-desc">Informe os dados de conexão com seu sistema.</p>

                <mat-form-field appearance="outline" class="field">
                  <mat-label>Nome da integração</mat-label>
                  <input matInput formControlName="name" placeholder="Ex: Tasy HIS" />
                </mat-form-field>

                <mat-form-field appearance="outline" class="field">
                  <mat-label>URL do Swagger / OpenAPI</mat-label>
                  <input matInput formControlName="swagger_url"
                    placeholder="https://sistema.hospital.com/api/docs/swagger.json" />
                  <mat-hint>Suporta OpenAPI 2.x e 3.x</mat-hint>
                </mat-form-field>

                <mat-form-field appearance="outline" class="field">
                  <mat-label>Tipo de autenticação</mat-label>
                  <mat-select formControlName="auth_type">
                    <mat-option value="none">Sem autenticação</mat-option>
                    <mat-option value="bearer">Bearer Token</mat-option>
                    <mat-option value="api_key">API Key</mat-option>
                    <mat-option value="basic">Basic Auth</mat-option>
                  </mat-select>
                </mat-form-field>

                @if (connectionForm.value.auth_type === 'bearer') {
                  <mat-form-field appearance="outline" class="field">
                    <mat-label>Bearer Token</mat-label>
                    <input matInput formControlName="auth_value" type="password" />
                  </mat-form-field>
                }
                @if (connectionForm.value.auth_type === 'api_key') {
                  <mat-form-field appearance="outline" class="field">
                    <mat-label>API Key</mat-label>
                    <input matInput formControlName="auth_value" />
                  </mat-form-field>
                }
                @if (connectionForm.value.auth_type === 'basic') {
                  <mat-form-field appearance="outline" class="field">
                    <mat-label>Usuário:Senha (user:password)</mat-label>
                    <input matInput formControlName="auth_value" placeholder="admin:secret" />
                  </mat-form-field>
                }

                <div class="step-actions">
                  <button class="wizard-btn-ghost" type="button" matStepperPrevious>Voltar</button>
                  <button class="wizard-btn" type="button"
                    [disabled]="connectionForm.invalid || parsing"
                    (click)="parseSwagger()">
                    {{ parsing ? 'Analisando...' : 'Analisar API' }}
                    @if (!parsing) { <mat-icon>search</mat-icon> }
                  </button>
                </div>

                @if (parseError) {
                  <div class="error-box">{{ parseError }}</div>
                }
              </div>
            </form>
          </mat-step>

          <!-- STEP 3: Map fields -->
          <mat-step label="Mapear campos">
            <div class="step-content">
              <p class="step-desc">
                {{ discoveredFields.length }} campos descobertos. Mapeie os campos do seu sistema
                para os campos do GenomaFlow.
              </p>

              <div class="field-map-table">
                <div class="field-map-header">
                  <span>CAMPO GENOMAFLOW</span>
                  <span>CAMPO DO SEU SISTEMA</span>
                </div>
                @for (tf of targetFields; track tf.key) {
                  <div class="field-map-row">
                    <div class="target-field">
                      <span class="target-key">{{ tf.label }}</span>
                      @if (tf.required) { <span class="required-badge">*</span> }
                    </div>
                    <mat-form-field appearance="outline" class="source-select">
                      <mat-select [(ngModel)]="fieldMap[tf.key]" [ngModelOptions]="{standalone: true}">
                        <mat-option value="">— não mapear —</mat-option>
                        @for (f of discoveredFields; track f) {
                          <mat-option [value]="'$.' + f">{{ f }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                  </div>
                }
              </div>

              <div class="step-actions">
                <button class="wizard-btn-ghost" matStepperPrevious>Voltar</button>
                <button class="wizard-btn" matStepperNext
                  [disabled]="!fieldMap['patient.name']">
                  Continuar <mat-icon>arrow_forward</mat-icon>
                </button>
              </div>
            </div>
          </mat-step>

          <!-- STEP 4: Activate -->
          <mat-step label="Ativar">
            <div class="step-content">
              <div class="activate-summary">
                <div class="summary-row">
                  <span class="summary-label">Nome</span>
                  <span class="summary-value">{{ connectionForm.value.name }}</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">Modo</span>
                  <span class="summary-value">REST / Swagger</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">API URL</span>
                  <span class="summary-value mono">{{ connectionForm.value.swagger_url }}</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">Campos mapeados</span>
                  <span class="summary-value">{{ mappedCount }} de {{ targetFields.length }}</span>
                </div>
              </div>

              <div class="webhook-info">
                <p class="webhook-label">WEBHOOK INBOUND</p>
                <p class="webhook-url mono">POST {{ apiUrl }}/integrations/&#123;id&#125;/ingest</p>
                <p class="webhook-hint">
                  Após ativar, configure seu sistema legado para enviar eventos para este endpoint.
                  O secret HMAC será exibido após salvar.
                </p>
              </div>

              @if (saveError) {
                <div class="error-box">{{ saveError }}</div>
              }

              <div class="step-actions">
                <button class="wizard-btn-ghost" matStepperPrevious>Voltar</button>
                <button class="wizard-btn wizard-btn-activate"
                  [disabled]="saving"
                  (click)="activate()">
                  {{ saving ? 'Ativando...' : 'Ativar integração' }}
                  @if (!saving) { <mat-icon>check_circle</mat-icon> }
                </button>
              </div>
            </div>
          </mat-step>

        </mat-stepper>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; background: #0b1326; min-height: 100vh; padding: 2rem; }

    .wizard-header {
      display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem;
    }
    .back-btn {
      background: none; border: 1px solid rgba(70,69,84,0.25); border-radius: 4px;
      padding: 0.5rem; cursor: pointer; color: #908fa0; display: flex; align-items: center;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .back-btn:hover { background: #131b2e; color: #dae2fd; }

    .page-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.5rem; color: #dae2fd; margin: 0 0 0.25rem;
    }
    .page-subtitle {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; color: #464554; letter-spacing: 0.08em;
    }

    .wizard-card {
      background: #131b2e; border: 1px solid rgba(70,69,84,0.15);
      border-radius: 8px; overflow: hidden;
    }

    .step-content { padding: 1.5rem 0; max-width: 600px; }
    .step-desc {
      font-family: 'Inter', sans-serif; font-size: 14px; color: #908fa0;
      margin: 0 0 1.5rem;
    }

    .mode-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem;
    }
    .mode-card {
      display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
      padding: 1.5rem 1rem; border: 1px solid rgba(70,69,84,0.25); border-radius: 8px;
      cursor: pointer; text-align: center; position: relative;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1); background: #0b1326;
    }
    .mode-card:hover:not(.mode-disabled) { border-color: rgba(192,193,255,0.4); background: #171f33; }
    .mode-selected { border-color: #494bd6 !important; background: #171f33 !important; }
    .mode-disabled { opacity: 0.4; cursor: not-allowed; }
    .mode-icon { font-size: 2rem; width: 2rem; height: 2rem; color: #c0c1ff; }
    .mode-label {
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 0.875rem; color: #dae2fd;
    }
    .mode-sub { font-family: 'Inter', sans-serif; font-size: 12px; color: #908fa0; }
    .coming-soon {
      position: absolute; top: 0.5rem; right: 0.5rem;
      font-family: 'JetBrains Mono', monospace; font-size: 8px;
      text-transform: uppercase; background: #2d3449; color: #908fa0;
      padding: 2px 6px; border-radius: 3px; letter-spacing: 0.08em;
    }

    .field { width: 100%; margin-bottom: 0.5rem; }

    .field-map-table { margin-bottom: 1.5rem; }
    .field-map-header {
      display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.1em; color: #464554;
      padding: 0 0 0.5rem; border-bottom: 1px solid rgba(70,69,84,0.15);
      margin-bottom: 0.5rem;
    }
    .field-map-row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
      align-items: center; margin-bottom: 0.25rem;
    }
    .target-field { display: flex; align-items: center; gap: 0.375rem; }
    .target-key {
      font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #c7c4d7;
    }
    .required-badge {
      font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #ffb4ab;
    }
    .source-select { width: 100%; }

    .step-actions { display: flex; align-items: center; gap: 0.75rem; margin-top: 1.5rem; }

    .wizard-btn {
      display: flex; align-items: center; gap: 0.5rem;
      background: #c0c1ff; color: #1000a9; border: none; border-radius: 4px;
      padding: 0.625rem 1.25rem; font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 0.8125rem; text-transform: uppercase;
      letter-spacing: 0.06em; cursor: pointer;
      transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .wizard-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .wizard-btn:hover:not(:disabled) { opacity: 0.88; }
    .wizard-btn-activate { background: #10b981; color: #052e16; }
    .wizard-btn-ghost {
      background: none; color: #908fa0; border: 1px solid rgba(70,69,84,0.25);
      border-radius: 4px; padding: 0.625rem 1rem; font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 0.8125rem; text-transform: uppercase;
      cursor: pointer; transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .wizard-btn-ghost:hover { background: #131b2e; color: #dae2fd; }

    .error-box {
      margin-top: 1rem; padding: 0.625rem 0.875rem; border-radius: 4px;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #ffb4ab;
      background: rgba(147,0,10,0.12); border: 1px solid rgba(255,180,171,0.2);
    }

    .activate-summary {
      background: #0b1326; border: 1px solid rgba(70,69,84,0.15); border-radius: 8px;
      padding: 1.25rem; margin-bottom: 1.5rem;
    }
    .summary-row {
      display: grid; grid-template-columns: 140px 1fr; gap: 1rem;
      padding: 0.5rem 0; border-bottom: 1px solid rgba(70,69,84,0.08);
    }
    .summary-row:last-child { border-bottom: none; }
    .summary-label {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.08em; color: #464554;
      align-self: center;
    }
    .summary-value { font-family: 'Inter', sans-serif; font-size: 14px; color: #c7c4d7; }
    .summary-value.mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    .mono { font-family: 'JetBrains Mono', monospace; }

    .webhook-info {
      background: rgba(73,75,214,0.06); border: 1px solid rgba(73,75,214,0.2);
      border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem;
    }
    .webhook-label {
      font-family: 'JetBrains Mono', monospace; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.1em; color: #464554; margin: 0 0 0.5rem;
    }
    .webhook-url {
      font-family: 'JetBrains Mono', monospace; font-size: 12px;
      color: #c0c1ff; margin: 0 0 0.5rem;
    }
    .webhook-hint {
      font-family: 'Inter', sans-serif; font-size: 12px; color: #908fa0; margin: 0;
    }

    /* Override Material Stepper colors for dark theme */
    ::ng-deep .wizard-stepper .mat-stepper-horizontal { background: transparent; }
    ::ng-deep .wizard-stepper .mat-step-header { padding: 1rem 1.5rem; }
    ::ng-deep .wizard-stepper .mat-horizontal-stepper-header-container {
      border-bottom: 1px solid rgba(70,69,84,0.15);
    }
    ::ng-deep .wizard-stepper .mat-horizontal-content-container { padding: 0 1.5rem 1.5rem; }
    ::ng-deep .wizard-stepper .mat-step-label { color: #908fa0; font-family: 'Space Grotesk', sans-serif; }
    ::ng-deep .wizard-stepper .mat-step-label.mat-step-label-active { color: #dae2fd; }
    ::ng-deep .wizard-stepper .mat-step-icon { background-color: #2d3449; color: #908fa0; }
    ::ng-deep .wizard-stepper .mat-step-icon.mat-step-icon-selected,
    ::ng-deep .wizard-stepper .mat-step-icon.mat-step-icon-state-edit { background-color: #494bd6; color: #fff; }
    ::ng-deep .wizard-stepper .mat-stepper-horizontal-line { border-top-color: rgba(70,69,84,0.2); }
  `]
})
export class WizardComponent {
  private http = inject(HttpClient);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  readonly apiUrl = environment.apiUrl;
  readonly targetFields = TARGET_FIELDS;

  modes = [
    { key: 'swagger', label: 'REST / Swagger', sub: 'Tasy, MV SOUL, iClinic', icon: 'api', available: true },
    { key: 'hl7',     label: 'HL7 v2.x',       sub: 'HIS/LIS hospitalar',     icon: 'local_hospital', available: false },
    { key: 'file',    label: 'File Drop',       sub: 'SFTP / S3 / ZIP',        icon: 'folder_open', available: false },
  ];

  selectedMode = 'swagger';
  discoveredFields: string[] = [];
  fieldMap: Record<string, string> = {};

  parsing = false;
  parseError = '';
  saving = false;
  saveError = '';

  connectionForm = this.fb.group({
    name:        ['', Validators.required],
    swagger_url: ['', Validators.required],
    auth_type:   ['none'],
    auth_value:  ['']
  });

  get mappedCount(): number {
    return Object.values(this.fieldMap).filter(v => !!v).length;
  }

  cancel(): void { this.router.navigate(['/clinic/integrations']); }

  parseSwagger(): void {
    const url = this.connectionForm.value.swagger_url!;
    this.parsing = true;
    this.parseError = '';
    this.http.post<SwaggerParseResult>(`${environment.apiUrl}/integrations/swagger/parse`, { url })
      .subscribe({
        next: r => {
          this.parsing = false;
          this.discoveredFields = r.fields;
          // Navigate to next step via stepper — trigger from template with matStepperNext
          // We do it programmatically below
          document.querySelector<HTMLElement>('[matStepperNext]')?.click();
        },
        error: err => {
          this.parsing = false;
          this.parseError = err.error?.error ?? 'Falha ao analisar a URL do Swagger';
        }
      });
  }

  activate(): void {
    this.saving = true;
    this.saveError = '';

    const { name, swagger_url, auth_type, auth_value } = this.connectionForm.value;
    const config: Record<string, string> = { swagger_url: swagger_url! };
    if (auth_type && auth_type !== 'none') {
      config['auth_type'] = auth_type;
      config['auth_value'] = auth_value ?? '';
    }

    // Filter out empty mappings
    const field_map: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.fieldMap)) {
      if (v) field_map[k] = v;
    }

    this.http.post<{ id: string }>(
      `${environment.apiUrl}/integrations`,
      { name, mode: 'swagger', config, field_map }
    ).pipe(
      // Activate immediately after creation
    ).subscribe({
      next: connector => {
        this.http.put(`${environment.apiUrl}/integrations/${connector.id}`, { status: 'active' })
          .subscribe({
            next: () => {
              this.saving = false;
              this.router.navigate(['/clinic/integrations']);
            },
            error: () => {
              this.saving = false;
              this.router.navigate(['/clinic/integrations']);
            }
          });
      },
      error: err => {
        this.saving = false;
        this.saveError = err.error?.error ?? 'Erro ao salvar integração';
      }
    });
  }
}
