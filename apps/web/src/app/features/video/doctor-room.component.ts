import {
  Component, OnInit, OnDestroy, inject, signal, ElementRef, ViewChild, AfterViewInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { VideoService, ConsultationFile } from './video.service';
import { environment } from '../../../environments/environment';
import { interval, Subscription } from 'rxjs';
import {
  ConsoleLogger, DefaultDeviceController, DefaultMeetingSession,
  LogLevel, MeetingSessionConfiguration,
} from 'amazon-chime-sdk-js';

@Component({
  selector: 'app-doctor-room',
  standalone: true,
  imports: [
    CommonModule, RouterModule, MatIconModule, MatButtonModule,
    MatSnackBarModule, MatTabsModule, MatProgressSpinnerModule,
  ],
  styles: [`
    :host { display:flex; height:100vh; background:#0b1326; color:#dae2fd; overflow:hidden; }

    .room-layout { display:flex; width:100%; height:100%; }

    .video-area {
      flex:1; display:flex; flex-direction:column;
      background:#060d1a; position:relative; overflow:hidden;
    }
    .remote-video { flex:1; background:#000; object-fit:cover; width:100%; }
    .self-video {
      position:absolute; bottom:20px; right:16px;
      width:160px; height:110px; border-radius:8px;
      border:2px solid rgba(192,193,255,0.3); object-fit:cover; background:#111;
      transition:bottom 200ms ease;
      z-index:2;
    }
    .video-area:hover .self-video { bottom:80px; }

    .controls {
      position:absolute; bottom:0; left:0; right:0; z-index:3;
      padding:.875rem 0 1.25rem;
      background:linear-gradient(transparent, rgba(6,13,26,0.9));
      display:flex; align-items:center; justify-content:center; gap:1rem;
      opacity:0; transition:opacity 200ms ease;
    }
    .video-area:hover .controls { opacity:1; }

    .ctrl-btn {
      width:46px; height:46px; border-radius:50%; border:1px solid rgba(255,255,255,0.15);
      background:rgba(17,25,41,0.85); backdrop-filter:blur(8px);
      color:#dae2fd; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      transition:background 120ms, transform 100ms;
    }
    .ctrl-btn:hover { background:rgba(36,48,80,0.95); transform:scale(1.08); }
    .ctrl-btn.active { background:rgba(192,193,255,0.9); color:#1000a9; border-color:#c0c1ff; }
    .ctrl-btn.end {
      width:52px; height:52px;
      background:rgba(220,38,38,0.85); color:#fff; border-color:rgba(239,68,68,0.5);
    }
    .ctrl-btn.end:hover { background:rgba(239,68,68,0.95); }

    .panel {
      width:340px; background:#111929; border-left:1px solid rgba(70,69,84,0.25);
      display:flex; flex-direction:column; overflow:hidden;
    }
    .panel-header {
      padding:.75rem 1rem; border-bottom:1px solid rgba(70,69,84,0.2);
      font-family:'JetBrains Mono',monospace; font-size:10px;
      text-transform:uppercase; letter-spacing:.1em; color:#6e6d80;
    }
    .panel-content { flex:1; overflow-y:auto; padding:.75rem 1rem; }

    .status-bar {
      padding:.5rem 1rem; font-family:'JetBrains Mono',monospace;
      font-size:11px; background:#0b1326;
      border-bottom:1px solid rgba(70,69,84,0.2); color:#6e6d80;
    }
    .status-bar .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
    .dot.active { background:#22c55e; }
    .dot.waiting { background:#f59e0b; }
    .dot.ended { background:#6e6d80; }

    .exam-card {
      background:#171f33; border:1px solid rgba(70,69,84,0.2);
      border-radius:6px; padding:.625rem .75rem; margin-bottom:.5rem; cursor:pointer;
    }
    .exam-card:hover { border-color:rgba(192,193,255,0.3); }
    .exam-label { font-size:.7rem; color:#a09fb2; font-family:'JetBrains Mono',monospace; }
    .exam-name { font-size:.8rem; color:#dae2fd; margin:.25rem 0; }
    .exam-date { font-size:.65rem; color:#6e6d80; }
    .alert-badge { background:#7f1d1d; color:#fca5a5; font-size:.6rem; padding:1px 5px; border-radius:3px; }

    .file-card {
      background:#171f33; border:1px solid rgba(70,69,84,0.15);
      border-radius:5px; padding:.5rem .75rem; margin-bottom:.375rem;
      display:flex; align-items:center; gap:.5rem;
    }
    .file-name { font-size:.75rem; color:#c0c1ff; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .file-who { font-size:.65rem; color:#6e6d80; }

    .upload-btn {
      width:100%; margin-top:.5rem; padding:.5rem;
      background:#1a2440; border:1px dashed rgba(192,193,255,0.3);
      border-radius:5px; color:#c0c1ff; font-size:.75rem; cursor:pointer;
      display:flex; align-items:center; justify-content:center; gap:.5rem;
    }
    .upload-btn:hover { background:#202e4a; }

    .transcribing-banner {
      margin:1rem; padding:.75rem; background:rgba(192,193,255,0.08);
      border:1px solid rgba(192,193,255,0.2); border-radius:6px;
      font-family:'JetBrains Mono',monospace; font-size:.7rem; color:#c0c1ff;
      display:flex; align-items:center; gap:.5rem;
    }
    .done-banner {
      margin:1rem; padding:.75rem; background:rgba(34,197,94,0.08);
      border:1px solid rgba(34,197,94,0.3); border-radius:6px;
      font-size:.8rem; color:#86efac;
    }
    .done-banner a { color:#c0c1ff; cursor:pointer; text-decoration:underline; }

    .pip-hint { font-size:.65rem; color:#6e6d80; text-align:center; padding:.25rem 0; }

    .patient-link-bar {
      padding:.5rem 1rem; background:#0d1520;
      border-bottom:1px solid rgba(70,69,84,0.2);
      display:flex; align-items:center; gap:.5rem;
    }
    .patient-link-text {
      flex:1; font-family:'JetBrains Mono',monospace; font-size:.65rem;
      color:#6e6d80; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }
    .copy-btn {
      flex-shrink:0; padding:3px 8px; border-radius:4px;
      background:#1a2440; border:1px solid rgba(192,193,255,0.25);
      color:#c0c1ff; font-size:.65rem; cursor:pointer;
      display:flex; align-items:center; gap:3px;
    }
    .copy-btn:hover { background:#202e4a; }

    /* Material tab body precisa de overflow-y:auto para scroll funcionar */
    ::ng-deep .panel .mat-mdc-tab-body-content {
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    ::ng-deep .panel .mat-mdc-tab-body-wrapper { flex: 1; overflow: hidden; }

    @media (max-width:767px) {
      .panel { display:none; }
    }
  `],
  template: `
    <div class="room-layout">
      <!-- Área de vídeo -->
      <div class="video-area">
        <div class="status-bar">
          <span class="dot" [class.active]="status()==='active'" [class.waiting]="status()==='waiting'" [class.ended]="['ended','done','transcribing'].includes(status())"></span>
          {{ statusLabel() }}
          @if (duration() > 0) { &nbsp;·&nbsp; {{ formatDuration() }} }
        </div>

        <video #remoteVideo class="remote-video" autoplay playsinline></video>
        <video #selfVideo class="self-video" autoplay playsinline muted></video>

        <div class="controls">
          <button class="ctrl-btn" [class.active]="!audioMuted()" (click)="toggleAudio()" title="Mute">
            <mat-icon>{{ audioMuted() ? 'mic_off' : 'mic' }}</mat-icon>
          </button>
          <button class="ctrl-btn" [class.active]="!videoOff()" (click)="toggleVideo()" title="Câmera">
            <mat-icon>{{ videoOff() ? 'videocam_off' : 'videocam' }}</mat-icon>
          </button>
          <button class="ctrl-btn" (click)="pipToggle()" title="Picture-in-Picture">
            <mat-icon>picture_in_picture</mat-icon>
          </button>
          <button class="ctrl-btn end" (click)="endCall()" [disabled]="ending()" title="Encerrar">
            <mat-icon>call_end</mat-icon>
          </button>
        </div>
      </div>

      <!-- Painel lateral -->
      <div class="panel">
        <div class="panel-header">Cockpit Clínico</div>

        @if (joinUrl()) {
          <div class="patient-link-bar">
            <mat-icon style="font-size:14px;color:#6e6d80;flex-shrink:0;">link</mat-icon>
            <span class="patient-link-text" title="{{ joinUrl() }}">{{ joinUrl() }}</span>
            <button class="copy-btn" (click)="copyLink()" title="Copiar link do paciente">
              <mat-icon style="font-size:12px;">content_copy</mat-icon>
              Copiar
            </button>
          </div>
        }

        <mat-tab-group animationDuration="0ms" style="flex:1;overflow:hidden;">

          <mat-tab label="📋 Perfil">
            <div class="panel-content">
              @if (subject()) {
                <div style="font-size:.8rem;line-height:1.7;">
                  <div style="font-weight:700;color:#c0c1ff;font-size:.9rem;margin-bottom:.625rem;">{{ subject()!.name }}</div>

                  @if (subject()!.birth_date || subject()!.sex || subject()!.blood_type) {
                    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem;">
                      @if (subject()!.birth_date) {
                        <span style="background:#171f33;border:1px solid rgba(70,69,84,.3);border-radius:4px;padding:2px 7px;font-size:.7rem;color:#a09fb2;">
                          {{ subject()!.birth_date | date:'dd/MM/yyyy' }}
                        </span>
                      }
                      @if (subject()!.sex) {
                        <span style="background:#171f33;border:1px solid rgba(70,69,84,.3);border-radius:4px;padding:2px 7px;font-size:.7rem;color:#a09fb2;">
                          {{ subject()!.sex === 'M' ? 'Masc.' : subject()!.sex === 'F' ? 'Fem.' : 'Outro' }}
                        </span>
                      }
                      @if (subject()!.blood_type) {
                        <span style="background:#171f33;border:1px solid rgba(70,69,84,.3);border-radius:4px;padding:2px 7px;font-size:.7rem;color:#c0c1ff;">
                          {{ subject()!.blood_type }}
                        </span>
                      }
                    </div>
                  }

                  @if (subject()!.phone) {
                    <div class="exam-label">Telefone: <span style="color:#dae2fd;">{{ subject()!.phone }}</span></div>
                  }

                  @if (subject()!.subject_type === 'animal') {
                    @if (subject()!.species) {
                      <div class="exam-label" style="margin-top:.375rem;">Espécie: <span style="color:#dae2fd;">{{ subject()!.species }}</span>
                        @if (subject()!.breed) { &nbsp;·&nbsp; {{ subject()!.breed }} }
                      </div>
                    }
                    @if (subject()!.weight) {
                      <div class="exam-label">Peso: <span style="color:#dae2fd;">{{ subject()!.weight }} kg</span></div>
                    }
                    @if (subject()!.owner_name) {
                      <div class="exam-label" style="margin-top:.375rem;">Tutor: <span style="color:#dae2fd;">{{ subject()!.owner_name }}</span></div>
                      @if (subject()!.owner_phone) {
                        <div class="exam-label">Tel. tutor: <span style="color:#dae2fd;">{{ subject()!.owner_phone }}</span></div>
                      }
                    }
                  }

                  @if (subject()!.comorbidities) {
                    <div style="margin-top:.5rem;">
                      <div class="exam-label">Comorbidades</div>
                      <div style="font-size:.75rem;color:#dae2fd;">{{ subject()!.comorbidities }}</div>
                    </div>
                  }
                  @if (subject()!.allergies || subject()!.allergies_text) {
                    <div style="margin-top:.5rem;">
                      <div class="exam-label">Alergias</div>
                      <div style="font-size:.75rem;color:#fca5a5;">{{ subject()!.allergies_text || subject()!.allergies }}</div>
                    </div>
                  }
                  @if (subject()!.notes) {
                    <div style="margin-top:.5rem;">
                      <div class="exam-label">Observações</div>
                      <div style="font-size:.75rem;color:#a09fb2;">{{ subject()!.notes }}</div>
                    </div>
                  }
                  @if (subject()!.emergency_contact_name) {
                    <div style="margin-top:.5rem;">
                      <div class="exam-label">Contato emergência</div>
                      <div style="font-size:.75rem;color:#dae2fd;">{{ subject()!.emergency_contact_name }}
                        @if (subject()!.emergency_contact_phone) { · {{ subject()!.emergency_contact_phone }} }
                      </div>
                    </div>
                  }
                  @if (subject()!.insurance_name) {
                    <div class="exam-label" style="margin-top:.375rem;">Plano: <span style="color:#dae2fd;">{{ subject()!.insurance_name }}</span></div>
                  }
                </div>
              } @else {
                <div style="font-size:.75rem;color:#6e6d80;">Carregando perfil...</div>
              }
            </div>
          </mat-tab>

          <mat-tab label="📊 Exames">
            <div class="panel-content">
              @for (exam of exams(); track exam.id) {
                <div class="exam-card" (click)="openExam(exam.id)">
                  <div class="exam-label">
                    {{ exam.file_type || exam.source || 'Exame' }}
                    @if (examMaxSeverity(exam) === 'critical') {
                      <span class="alert-badge">crítico</span>
                    } @else if (examMaxSeverity(exam) === 'high') {
                      <span class="alert-badge" style="background:#78350f;color:#fde68a;">alto</span>
                    }
                  </div>
                  <div class="exam-name">{{ examName(exam) }}</div>
                  <div class="exam-date">{{ exam.created_at | date:'dd/MM/yy' }} · {{ exam.status === 'done' ? 'Analisado' : exam.status }}</div>
                </div>
              }
              @if (exams().length === 0) {
                <div style="font-size:.75rem;color:#6e6d80;">Nenhum exame encontrado.</div>
              }
            </div>
          </mat-tab>

          <mat-tab label="📁 Arquivos">
            <div class="panel-content">
              @for (f of files(); track f.id) {
                <div class="file-card">
                  <mat-icon style="font-size:16px;color:#c0c1ff;">attach_file</mat-icon>
                  <span class="file-name">{{ f.filename }}</span>
                  <span class="file-who">{{ f.uploaded_by === 'doctor' ? 'você' : 'paciente' }}</span>
                </div>
              }
              <label class="upload-btn">
                <mat-icon style="font-size:18px;">upload</mat-icon>
                Enviar arquivo
                <input type="file" style="display:none" (change)="uploadFile($event)" accept="image/*,.pdf"/>
              </label>
              <p class="pip-hint">Arquivos são salvos no prontuário ao encerrar</p>
            </div>
          </mat-tab>

        </mat-tab-group>
      </div>
    </div>
  `
})
export class DoctorRoomComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('remoteVideo') remoteVideoEl!: ElementRef<HTMLVideoElement>;
  @ViewChild('selfVideo') selfVideoEl!: ElementRef<HTMLVideoElement>;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);
  private snack = inject(MatSnackBar);
  private videoSvc = inject(VideoService);

  consultationId = '';
  status = signal<string>('waiting');
  audioMuted = signal(false);
  videoOff = signal(false);
  ending = signal(false);
  encounterId = signal<string | null>(null);
  joinUrl = signal<string>('');
  subject = signal<any | null>(null);
  exams = signal<any[]>([]);
  files = signal<ConsultationFile[]>([]);
  duration = signal(0);

  private meetingSession: any = null;
  private localStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private recordingChunks: Blob[] = [];
  private timerSub?: Subscription;
  private startTime?: Date;

  ngOnInit() {
    this.consultationId = this.route.snapshot.paramMap.get('consultationId') || '';
    this.initChime();
    this.startTimer();
  }

  ngAfterViewInit() { }

  ngOnDestroy() {
    this.timerSub?.unsubscribe();
    this.meetingSession?.audioVideo?.stop();
    this.localStream?.getTracks().forEach(t => t.stop());
    this.recorder?.state !== 'inactive' && this.recorder?.stop();
  }

  statusLabel(): string {
    const map: Record<string, string> = {
      waiting: 'Aguardando paciente', active: 'Em consulta',
      ended: 'Encerrada', transcribing: 'Transcrevendo...', done: 'Concluída', failed: 'Falha',
    };
    return map[this.status()] ?? this.status();
  }

  formatDuration(): string {
    const s = this.duration();
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  private startTimer() {
    this.startTime = new Date();
    this.timerSub = interval(1000).subscribe(() => {
      if (this.startTime && this.status() === 'active') {
        this.duration.set(Math.floor((Date.now() - this.startTime.getTime()) / 1000));
      }
    });
  }

  private async initChime() {
    this.videoSvc.getTokens(this.consultationId).subscribe({
      next: async (tokens) => {
        this.status.set(tokens.status);
        if (tokens.join_url) this.joinUrl.set(tokens.join_url);
        await this.joinMeeting(tokens.meeting, tokens.doctor_attendee);
        this.videoSvc.startConsultation(this.consultationId).subscribe();
        this.status.set('active');
        this.startTime = new Date();
        this.loadSidePanel();
      },
      error: () => this.snack.open('Erro ao entrar na sala de vídeo', 'Fechar', { duration: 5000 }),
    });
  }

  private async joinMeeting(
    meeting: { MeetingId: string; MediaPlacement: Record<string, string> },
    attendee: Record<string, string>
  ) {
    try {
      const logger = new ConsoleLogger('ChimeDoctor', LogLevel.ERROR);
      const deviceController = new DefaultDeviceController(logger);
      const config = new MeetingSessionConfiguration(meeting, attendee);
      this.meetingSession = new DefaultMeetingSession(config, logger, deviceController);

      // Observer DEVE ser registrado antes do start() pra capturar o tile local
      this.meetingSession.audioVideo.addObserver({
        videoTileDidUpdate: (tileState: any) => {
          if (!tileState.boundAttendeeId) return;
          const targetEl = tileState.localTile
            ? this.selfVideoEl?.nativeElement
            : this.remoteVideoEl?.nativeElement;
          if (targetEl) {
            this.meetingSession.audioVideo.bindVideoElement(tileState.tileId, targetEl);
          }
        },
      });

      // Lista e seleciona devices via Chime SDK (Chime gerencia o stream — getUserMedia
      // direto não roteia áudio/vídeo até o outro participante)
      const audioInputs = await deviceController.listAudioInputDevices();
      const videoInputs = await deviceController.listVideoInputDevices();
      if (audioInputs.length > 0) {
        await this.meetingSession.audioVideo.startAudioInput(audioInputs[0].deviceId);
      }
      if (videoInputs.length > 0) {
        await this.meetingSession.audioVideo.startVideoInput(videoInputs[0].deviceId);
      }

      // Inicia sessão Chime
      this.meetingSession.audioVideo.start();
      this.meetingSession.audioVideo.startLocalVideoTile();

      // Grava áudio para transcrição (via getUserMedia separado — Chime SDK não expõe stream cru)
      try {
        const recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.localStream = recStream;
        this.startRecording(recStream);
      } catch (err) {
        console.warn('[DoctorRoom] gravação local falhou (transcrição indisponível):', err);
      }

    } catch (err: any) {
      console.error('[DoctorRoom] Chime join error:', err);
      const msg = (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError')
        ? 'Permissão de câmera/microfone negada. Habilite nas configurações do navegador e recarregue.'
        : `Erro ao conectar à sala: ${err?.message || err?.name || 'verifique o console'}. Se a consulta expirou, crie uma nova.`;
      this.snack.open(msg, 'Fechar', { duration: 10000 });
    }
  }

  private startRecording(stream: MediaStream) {
    try {
      this.recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      this.recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordingChunks.push(e.data);
      };
      this.recorder.start(5000); // chunk a cada 5s
    } catch { /* MediaRecorder não suportado — transcrição sem áudio */ }
  }

  private async uploadRecording(): Promise<string | undefined> {
    if (!this.recordingChunks.length) return undefined;
    try {
      this.recorder?.stop();
      await new Promise(r => setTimeout(r, 500));
      const blob = new Blob(this.recordingChunks, { type: 'audio/webm' });
      const { upload_url, s3_key } = await this.videoSvc
        .getUploadUrl(this.consultationId, 'recording.webm', 'audio/webm')
        .toPromise() as any;
      await fetch(upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'audio/webm' } });
      return s3_key;
    } catch (err) {
      console.error('[DoctorRoom] upload recording failed:', err);
      return undefined;
    }
  }

  private loadSidePanel() {
    // subject_id vem da consulta (JOIN appointments) — não do query param
    this.videoSvc.getStatus(this.consultationId).subscribe({
      next: (res: any) => {
        const subjectId = res.subject_id;
        if (subjectId) {
          this.http.get<any>(`${environment.apiUrl}/patients/${subjectId}`).subscribe({
            next: (s) => this.subject.set(s),
            error: () => {},
          });
          this.http.get<any[]>(`${environment.apiUrl}/exams?subject_id=${subjectId}&limit=20`).subscribe({
            next: (e) => this.exams.set(e || []),
            error: () => {},
          });
        }
      },
      error: () => {},
    });
    this.loadFiles();
  }

  private loadFiles() {
    this.videoSvc.getFiles(this.consultationId).subscribe({
      next: (f) => this.files.set(f),
      error: () => {},
    });
  }

  toggleAudio() {
    const next = !this.audioMuted();
    this.audioMuted.set(next);
    if (next) this.meetingSession?.audioVideo?.realtimeMuteLocalAudio();
    else this.meetingSession?.audioVideo?.realtimeUnmuteLocalAudio();
  }

  toggleVideo() {
    const next = !this.videoOff();
    this.videoOff.set(next);
    if (next) {
      this.meetingSession?.audioVideo?.stopLocalVideoTile();
    } else {
      this.meetingSession?.audioVideo?.startLocalVideoTile();
    }
  }

  async pipToggle() {
    const el = this.remoteVideoEl?.nativeElement;
    if (!el) return;
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => {});
    } else {
      await el.requestPictureInPicture().catch(() => {
        this.snack.open('PiP não suportado neste navegador', '', { duration: 2000 });
      });
    }
  }

  async endCall() {
    if (this.ending()) return;
    this.ending.set(true);
    const s3Key = await this.uploadRecording();
    this.meetingSession?.audioVideo?.stop();
    this.localStream?.getTracks().forEach(t => t.stop());
    this.videoSvc.endConsultation(this.consultationId, s3Key).subscribe({
      next: (res) => {
        const msg = res.status === 'transcribing'
          ? `Consulta encerrada (${res.credits_debited} créditos). Transcrição e prontuário IA sendo gerados em segundo plano.`
          : `Consulta encerrada. ${res.credits_debited} créditos debitados.`;
        this.snack.open(msg, '', { duration: 5000 });
        // Redireciona para a agenda após 2s — transcrição e IA rodam no worker em background
        setTimeout(() => this.router.navigate(['/clinic/appointments']), 2000);
      },
      error: () => {
        this.ending.set(false);
        this.snack.open('Erro ao encerrar consulta', 'Fechar', { duration: 4000 });
      },
    });
  }

  goToEncounter() {
    const encId = this.encounterId();
    if (encId) this.router.navigate(['/clinic/encounters', encId]);
  }

  copyLink() {
    const url = this.joinUrl();
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      this.snack.open('Link copiado!', '', { duration: 2000 });
    }).catch(() => {
      this.snack.open('Não foi possível copiar automaticamente — selecione e copie manualmente.', 'Fechar', { duration: 5000 });
    });
  }

  openExam(examId: string) {
    window.open(`/results/${examId}`, '_blank');
  }

  examName(exam: any): string {
    if (!exam.file_path) return 'Exame';
    const filename = exam.file_path.split('/').pop() || '';
    // remove timestamp prefix (ex: 1715123456789-nome.pdf → nome.pdf)
    return filename.replace(/^\d{10,}-/, '') || 'Exame';
  }

  examMaxSeverity(exam: any): string | null {
    if (!exam.results?.length) return null;
    const order = ['critical', 'high', 'medium', 'low'];
    for (const level of order) {
      for (const r of exam.results) {
        if (r.alerts?.some((a: any) => a.severity === level)) return level;
      }
    }
    return null;
  }

  async uploadFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const { upload_url, s3_key } = await this.videoSvc
        .getUploadUrl(this.consultationId, file.name, file.type)
        .toPromise() as any;
      await fetch(upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      await this.videoSvc
        .notifyFileUploaded(this.consultationId, s3_key, file.name, file.type, file.size)
        .toPromise();
      this.loadFiles();
      this.snack.open(`${file.name} enviado`, '', { duration: 2000 });
    } catch {
      this.snack.open('Erro ao enviar arquivo', 'Fechar', { duration: 4000 });
    }
    input.value = '';
  }
}
