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
import { switchMap, takeWhile } from 'rxjs/operators';

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
      background:#060d1a; position:relative;
    }
    .remote-video { flex:1; background:#000; object-fit:cover; }
    .self-video {
      position:absolute; bottom:80px; right:16px;
      width:160px; height:110px; border-radius:8px;
      border:2px solid rgba(192,193,255,0.3); object-fit:cover; background:#111;
    }
    .controls {
      height:64px; background:#111929;
      display:flex; align-items:center; justify-content:center; gap:1rem;
      border-top:1px solid rgba(70,69,84,0.3);
    }
    .ctrl-btn {
      width:44px; height:44px; border-radius:50%; border:1px solid rgba(70,69,84,0.4);
      background:#1a2440; color:#dae2fd; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      transition:background 120ms;
    }
    .ctrl-btn:hover { background:#243050; }
    .ctrl-btn.active { background:#c0c1ff; color:#1000a9; border-color:#c0c1ff; }
    .ctrl-btn.end { background:rgba(239,68,68,0.15); color:#ef4444; border-color:rgba(239,68,68,0.4); }
    .ctrl-btn.end:hover { background:rgba(239,68,68,0.3); }

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

        @if (status() === 'ended' || status() === 'transcribing') {
          <div class="transcribing-banner">
            <mat-spinner diameter="16"></mat-spinner>
            Consulta encerrada. Transcrição em andamento...
          </div>
        }
        @if (status() === 'done' && encounterId()) {
          <div class="done-banner">
            ✅ Prontuário pré-preenchido pela IA pronto.
            <a (click)="goToEncounter()">Abrir prontuário →</a>
          </div>
        }

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
        <mat-tab-group animationDuration="0ms" style="flex:1;overflow:hidden;">

          <mat-tab label="📋 Perfil">
            <div class="panel-content">
              @if (subject()) {
                <div style="font-size:.8rem;line-height:1.6;">
                  <div style="font-weight:700;color:#c0c1ff;margin-bottom:.5rem;">{{ subject()!.name }}</div>
                  @if (subject()!.birth_date) {
                    <div class="exam-label">Nascimento: {{ subject()!.birth_date | date:'dd/MM/yyyy' }}</div>
                  }
                  @if (subject()!.comorbidities) {
                    <div style="margin-top:.5rem;">
                      <div class="exam-label">Comorbidades</div>
                      <div style="font-size:.75rem;color:#dae2fd;">{{ subject()!.comorbidities }}</div>
                    </div>
                  }
                  @if (subject()!.allergies) {
                    <div style="margin-top:.5rem;">
                      <div class="exam-label">Alergias</div>
                      <div style="font-size:.75rem;color:#fca5a5;">{{ subject()!.allergies }}</div>
                    </div>
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
                    {{ exam.file_type || 'Exame' }}
                    @if (exam.alert_level === 'critical' || exam.alert_level === 'high') {
                      <span class="alert-badge">{{ exam.alert_level }}</span>
                    }
                  </div>
                  <div class="exam-name">{{ exam.description || 'Sem descrição' }}</div>
                  <div class="exam-date">{{ exam.exam_date | date:'dd/MM/yy' }}</div>
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
  subject = signal<any | null>(null);
  exams = signal<any[]>([]);
  files = signal<ConsultationFile[]>([]);
  duration = signal(0);

  private meetingSession: any = null;
  private localStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private recordingChunks: Blob[] = [];
  private timerSub?: Subscription;
  private pollSub?: Subscription;
  private startTime?: Date;

  ngOnInit() {
    this.consultationId = this.route.snapshot.paramMap.get('consultationId') || '';
    this.initChime();
    this.startTimer();
  }

  ngAfterViewInit() { }

  ngOnDestroy() {
    this.timerSub?.unsubscribe();
    this.pollSub?.unsubscribe();
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
        await this.joinMeeting(tokens.meeting_id, tokens.doctor_attendee);
        this.videoSvc.startConsultation(this.consultationId).subscribe();
        this.status.set('active');
        this.startTime = new Date();
        this.loadSidePanel();
      },
      error: () => this.snack.open('Erro ao entrar na sala de vídeo', 'Fechar', { duration: 5000 }),
    });
  }

  private async joinMeeting(meetingId: string, attendee: Record<string, string>) {
    try {
      const {
        ConsoleLogger, DefaultDeviceController, DefaultMeetingSession,
        LogLevel, MeetingSessionConfiguration,
      } = await import('amazon-chime-sdk-js');

      const logger = new ConsoleLogger('ChimeDoctor', LogLevel.ERROR);
      const deviceController = new DefaultDeviceController(logger);
      const config = new MeetingSessionConfiguration(
        { MeetingId: meetingId, MediaPlacement: attendee['MediaPlacement'] ?? {} },
        attendee
      );
      this.meetingSession = new DefaultMeetingSession(config, logger, deviceController);

      // Câmera e microfone locais
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      this.localStream = stream;
      if (this.selfVideoEl?.nativeElement) {
        this.selfVideoEl.nativeElement.srcObject = stream;
      }

      // Inicia sessão Chime
      this.meetingSession.audioVideo.start();
      this.meetingSession.audioVideo.startLocalVideoTile();

      // Recebe vídeo remoto
      this.meetingSession.audioVideo.addObserver({
        videoTileDidUpdate: (tileState: any) => {
          if (!tileState.localTile && this.remoteVideoEl?.nativeElement) {
            this.meetingSession.audioVideo.bindVideoElement(
              tileState.tileId, this.remoteVideoEl.nativeElement
            );
          }
        },
      });

      // Grava áudio mixed para transcrição
      this.startRecording(stream);

    } catch (err) {
      console.error('[DoctorRoom] Chime join error:', err);
      this.snack.open('Erro ao acessar câmera/microfone', 'Fechar', { duration: 5000 });
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
    const subjectId = this.route.snapshot.queryParamMap.get('subject_id');
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
    this.loadFiles();
  }

  private loadFiles() {
    this.videoSvc.getFiles(this.consultationId).subscribe({
      next: (f) => this.files.set(f),
      error: () => {},
    });
  }

  toggleAudio() {
    this.audioMuted.set(!this.audioMuted());
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = !this.audioMuted(); });
  }

  toggleVideo() {
    this.videoOff.set(!this.videoOff());
    this.localStream?.getVideoTracks().forEach(t => { t.enabled = !this.videoOff(); });
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
        this.status.set(res.status);
        this.snack.open(`Consulta encerrada. ${res.credits_debited} créditos debitados.`, '', { duration: 4000 });
        if (res.status === 'transcribing') {
          this.pollTranscription();
        }
      },
      error: () => {
        this.ending.set(false);
        this.snack.open('Erro ao encerrar consulta', 'Fechar', { duration: 4000 });
      },
    });
  }

  private pollTranscription() {
    this.pollSub = interval(10_000).pipe(
      switchMap(() => this.videoSvc.getStatus(this.consultationId)),
      takeWhile((r) => r.status !== 'done' && r.status !== 'failed', true),
    ).subscribe({
      next: (r) => {
        this.status.set(r.status);
        if (r.encounter_id) this.encounterId.set(r.encounter_id);
      },
    });
  }

  goToEncounter() {
    const encId = this.encounterId();
    if (encId) this.router.navigate(['/clinic/encounters', encId]);
  }

  openExam(examId: string) {
    this.router.navigate(['/results', examId]);
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
