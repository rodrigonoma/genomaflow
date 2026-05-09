import {
  Component, OnInit, OnDestroy, inject, signal, computed, ElementRef, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { VideoService, PublicJoinInfo, ConsultationFile } from './video.service';
import {
  ConsoleLogger, DefaultDeviceController, DefaultMeetingSession,
  LogLevel, MeetingSessionConfiguration,
} from 'amazon-chime-sdk-js';
import { interval, Subscription } from 'rxjs';

@Component({
  selector: 'app-patient-room',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatSnackBarModule, MatProgressSpinnerModule],
  styles: [`
    :host {
      display:flex; flex-direction:column; height:100vh;
      background:#0b1326; color:#dae2fd; overflow:hidden;
    }
    .header {
      padding:.75rem 1.25rem; background:#111929;
      border-bottom:1px solid rgba(70,69,84,0.25);
      display:flex; align-items:center; gap:.75rem;
    }
    .header-logo { width:32px; height:32px; object-fit:contain; }
    .header-title { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:1rem; color:#c0c1ff; }
    .header-sub { font-family:'JetBrains Mono',monospace; font-size:.7rem; color:#6e6d80; }

    .video-area { flex:1; min-height:0; display:flex; flex-direction:column; background:#060d1a; position:relative; overflow:hidden; }
    /* min-height:0 + width:100% força <video> a respeitar o flex em vez de crescer pelo aspect ratio do stream */
    .remote-video { flex:1; min-height:0; width:100%; object-fit:cover; background:#000; }
    .self-video {
      position:absolute; bottom:80px; right:12px; z-index:2;
      width:120px; height:85px; border-radius:8px;
      border:2px solid rgba(192,193,255,0.3); object-fit:cover; background:#111;
    }
    .remote-audio { display:none; } /* hidden but bound for autoplay reliability */

    /* Controls absolute igual ao doctor-room — quando o stream remoto chega, o flex
       não é empurrado pra fora da viewport */
    .controls {
      position:absolute; bottom:0; left:0; right:0; z-index:3;
      height:64px; background:#111929;
      display:flex; align-items:center; justify-content:center; gap:1rem;
      border-top:1px solid rgba(70,69,84,0.3);
    }
    .ctrl-btn {
      width:44px; height:44px; border-radius:50%;
      border:1px solid rgba(70,69,84,0.4); background:#1a2440; color:#dae2fd;
      cursor:pointer; display:flex; align-items:center; justify-content:center;
      transition:background 120ms;
    }
    .ctrl-btn:hover { background:#243050; }
    .ctrl-btn.active { background:#c0c1ff; color:#1000a9; border-color:#c0c1ff; }
    .ctrl-btn.end { background:rgba(220,38,38,0.85); color:#fff; border-color:rgba(239,68,68,0.5); }
    .ctrl-btn.end:hover { background:rgba(239,68,68,0.95); }

    .left-state {
      flex:1; display:flex; align-items:center; justify-content:center;
      flex-direction:column; gap:.75rem; color:#dae2fd; padding:2rem;
      text-align:center;
    }
    .left-state .icon-circle {
      width:64px; height:64px; border-radius:50%;
      background:rgba(34,197,94,0.15); border:1px solid rgba(34,197,94,0.4);
      display:flex; align-items:center; justify-content:center;
    }
    .left-state .title { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:1.05rem; }
    .left-state .desc { font-size:.8rem; color:#a09fb2; max-width:340px; }

    .upload-btn {
      padding:.5rem 1rem; background:#1a2440;
      border:1px solid rgba(192,193,255,0.3); border-radius:20px;
      color:#c0c1ff; font-size:.75rem; cursor:pointer;
      display:flex; align-items:center; gap:.375rem;
    }
    .upload-btn:hover { background:#202e4a; }

    /* Barra de arquivos enviados pelo médico — overlay no topo da área de vídeo */
    .files-bar {
      position:absolute; top:12px; left:12px; right:12px; z-index:4;
      max-height:38vh; overflow-y:auto;
      background:rgba(11,19,38,0.92); backdrop-filter:blur(8px);
      border:1px solid rgba(70,69,84,0.4); border-radius:8px;
      padding:.625rem .75rem;
    }
    .files-bar-title {
      font-family:'JetBrains Mono',monospace; font-size:.6rem;
      text-transform:uppercase; letter-spacing:.12em; color:#7c7b8f;
      margin-bottom:.5rem;
    }
    .file-card {
      display:flex; align-items:center; gap:.5rem; padding:.5rem .625rem;
      background:#171f33; border:1px solid rgba(70,69,84,0.25);
      border-radius:6px; margin-bottom:.375rem; cursor:pointer;
      transition:border-color 120ms, background 120ms;
    }
    .file-card:hover { border-color:rgba(192,193,255,0.5); background:#1c2645; }
    .file-card.is-new { border-color:rgba(34,197,94,0.6); }
    .file-name { font-size:.75rem; color:#dae2fd; flex:1;
                 overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .file-new-badge {
      font-size:.55rem; font-family:'JetBrains Mono',monospace;
      background:rgba(34,197,94,0.18); color:#86efac;
      border:1px solid rgba(34,197,94,0.4); border-radius:3px;
      padding:1px 5px; text-transform:uppercase; letter-spacing:.08em;
    }

    .loading-state {
      flex:1; display:flex; align-items:center; justify-content:center;
      flex-direction:column; gap:1rem; color:#6e6d80;
    }
    .error-state {
      flex:1; display:flex; align-items:center; justify-content:center;
      flex-direction:column; gap:.5rem; color:#fca5a5;
      font-family:'JetBrains Mono',monospace; font-size:.8rem;
    }
  `],
  template: `
    <div class="header">
      <img class="header-logo" src="/logo_genoma.png" alt="GenomaFlow"/>
      <div>
        <div class="header-title">{{ info()?.clinic_name || 'Consulta por Vídeo' }}</div>
        @if (info()) {
          <div class="header-sub">{{ info()!.doctor_name }} · {{ info()!.start_at | date:'dd/MM HH:mm' }}</div>
        }
      </div>
    </div>

    @if (loadError()) {
      <div class="error-state">
        <mat-icon>error_outline</mat-icon>
        <div>{{ loadError() }}</div>
        <div style="font-size:.65rem;color:#6e6d80;">Verifique o link enviado pela clínica.</div>
      </div>
    } @else if (!info()) {
      <div class="loading-state">
        <mat-spinner diameter="40"></mat-spinner>
        <div>Carregando sala de vídeo...</div>
      </div>
    } @else if (hasLeft()) {
      <div class="left-state">
        <div class="icon-circle"><mat-icon style="color:#86efac;">check</mat-icon></div>
        <div class="title">Você saiu da consulta</div>
        <div class="desc">Pode fechar esta janela. Se precisar voltar, abra novamente o link enviado pela clínica.</div>
      </div>
    } @else {
      <div class="video-area">
        <video #remoteVideo class="remote-video" autoplay playsinline></video>
        <video #selfVideo class="self-video" autoplay playsinline muted></video>
        <audio #remoteAudio class="remote-audio" autoplay></audio>

        @if (doctorFiles().length > 0) {
          <div class="files-bar">
            <div class="files-bar-title">Arquivos enviados pelo médico ({{ doctorFiles().length }})</div>
            @for (f of doctorFiles(); track f.id) {
              <div class="file-card" [class.is-new]="newFileIds().has(f.id)" (click)="openFile(f.id)">
                <mat-icon style="font-size:16px;color:#c0c1ff;">attach_file</mat-icon>
                <span class="file-name">{{ f.filename }}</span>
                @if (newFileIds().has(f.id)) { <span class="file-new-badge">novo</span> }
              </div>
            }
          </div>
        }

        <div class="controls">
          <button class="ctrl-btn" [class.active]="!audioMuted()" (click)="toggleAudio()" title="Mute">
            <mat-icon>{{ audioMuted() ? 'mic_off' : 'mic' }}</mat-icon>
          </button>
          <button class="ctrl-btn" [class.active]="!videoOff()" (click)="toggleVideo()" title="Câmera">
            <mat-icon>{{ videoOff() ? 'videocam_off' : 'videocam' }}</mat-icon>
          </button>
          <label class="upload-btn" title="Enviar exame ou foto">
            <mat-icon style="font-size:18px;">attach_file</mat-icon>
            Enviar exame ou foto
            <input type="file" style="display:none" (change)="uploadFile($event)" accept="image/*,.pdf"/>
          </label>
          <button class="ctrl-btn end" (click)="leaveCall()" title="Sair da chamada">
            <mat-icon>call_end</mat-icon>
          </button>
        </div>
      </div>
    }
  `
})
export class PatientRoomComponent implements OnInit, OnDestroy {
  @ViewChild('remoteVideo') remoteVideoEl!: ElementRef<HTMLVideoElement>;
  @ViewChild('selfVideo') selfVideoEl!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteAudio') remoteAudioEl!: ElementRef<HTMLAudioElement>;

  private route = inject(ActivatedRoute);
  private snack = inject(MatSnackBar);
  private videoSvc = inject(VideoService);

  info = signal<PublicJoinInfo | null>(null);
  loadError = signal<string | null>(null);
  audioMuted = signal(false);
  videoOff = signal(false);
  hasLeft = signal(false);
  files = signal<ConsultationFile[]>([]);
  newFileIds = signal<Set<string>>(new Set());
  // Apenas arquivos enviados pelo médico (paciente vê os próprios na lista da clínica)
  doctorFiles = computed(() => this.files().filter(f => f.uploaded_by === 'doctor'));

  private joinToken = '';
  private consultationId = '';
  private meetingSession: any = null;
  private localStream: MediaStream | null = null;
  private filesPollSub?: Subscription;

  ngOnInit() {
    this.joinToken = this.route.snapshot.paramMap.get('token') || '';
    this.videoSvc.getPublicJoinInfo(this.joinToken).subscribe({
      next: async (info) => {
        this.info.set(info);
        this.consultationId = info.consultation_id;
        await this.joinMeeting(info.meeting, info.patient_attendee);
        this.startFilesPolling();
      },
      error: (err) => {
        this.loadError.set(
          err.status === 401 ? 'Link inválido ou expirado.'
          : err.status === 404 ? 'Consulta não encontrada.'
          : 'Erro ao carregar a sala. Tente novamente.'
        );
      },
    });
  }

  ngOnDestroy() {
    this.filesPollSub?.unsubscribe();
    this.stopMediaSession();
  }

  /** Para Chime SDK + libera devices (mic/cam) — usado em leaveCall e ngOnDestroy. */
  private stopMediaSession() {
    try {
      // stopAudioInput/stopVideoInput liberam as devices (apaga bolinha vermelha do Chrome)
      this.meetingSession?.audioVideo?.stopAudioInput?.();
      this.meetingSession?.audioVideo?.stopVideoInput?.();
      this.meetingSession?.audioVideo?.stopLocalVideoTile?.();
      this.meetingSession?.audioVideo?.stop?.();
    } catch { /* ok */ }
    this.localStream?.getTracks().forEach(t => t.stop());
    this.meetingSession = null;
    this.localStream = null;
  }

  /**
   * Polling a cada 5s do GET /files — paciente é público (sem WS), então não recebe
   * o evento video:file_shared. Polling cobre o gap até finalizar a consulta.
   * Para de pollar quando hasLeft() é true.
   */
  private startFilesPolling() {
    const poll = () => {
      if (this.hasLeft() || !this.consultationId) return;
      this.videoSvc.getFiles(this.consultationId, this.joinToken).subscribe({
        next: (newList) => {
          const prev = this.files();
          const prevIds = new Set(prev.map(f => f.id));
          this.files.set(newList);

          // Detecta arquivos novos do médico desde o último poll
          for (const f of newList) {
            if (f.uploaded_by !== 'doctor' || prevIds.has(f.id)) continue;
            // Não sinaliza no primeiro carregamento (prev.length === 0 e o paciente acabou de entrar)
            if (prev.length === 0) continue;
            this.newFileIds.update(s => new Set([...s, f.id]));
            this.snack.open(`📎 Médico enviou: ${f.filename}`, 'Abrir', { duration: 6000 })
              .onAction().subscribe(() => this.openFile(f.id));
          }
        },
        error: () => { /* silencioso — tenta de novo no próximo tick */ },
      });
    };
    poll(); // primeiro tick imediato (popula a lista)
    this.filesPollSub = interval(5000).subscribe(poll);
  }

  openFile(fileId: string) {
    this.newFileIds.update(s => { const c = new Set(s); c.delete(fileId); return c; });
    this.videoSvc.getFileDownloadUrl(this.consultationId, fileId, this.joinToken).subscribe({
      next: (res) => window.open(res.download_url, '_blank'),
      error: () => this.snack.open('Não foi possível abrir o arquivo', 'OK', { duration: 4000 }),
    });
  }

  private async joinMeeting(
    meeting: { MeetingId: string; MediaPlacement: Record<string, string> },
    attendee: Record<string, string>
  ) {
    try {
      const logger = new ConsoleLogger('ChimePatient', LogLevel.ERROR);
      const deviceController = new DefaultDeviceController(logger);
      const config = new MeetingSessionConfiguration(meeting, attendee);
      this.meetingSession = new DefaultMeetingSession(config, logger, deviceController);

      // Observer DEVE ser registrado antes do start() pra capturar o tile local quando ele aparece
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

      // 1 ÚNICO getUserMedia — passamos o stream direto pro Chime SDK (não chama
      // getUserMedia interno, evita disputa pela mesma device).
      let fullStream: MediaStream | null = null;
      try {
        fullStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        this.localStream = fullStream;
      } catch (err) {
        console.warn('[PatientRoom] getUserMedia negado:', err);
      }

      await deviceController.listAudioInputDevices().catch(() => []);
      await deviceController.listVideoInputDevices().catch(() => []);

      if (fullStream) {
        await this.meetingSession.audioVideo.startAudioInput(fullStream);
        await this.meetingSession.audioVideo.startVideoInput(fullStream);
      }

      // Bind do <audio> remoto pra garantir reprodução em navegadores com autoplay restrito
      if (this.remoteAudioEl?.nativeElement) {
        this.meetingSession.audioVideo.bindAudioElement?.(this.remoteAudioEl.nativeElement);
      }

      this.meetingSession.audioVideo.start();
      this.meetingSession.audioVideo.startLocalVideoTile();
    } catch (err) {
      console.error('[PatientRoom] join error:', err);
      this.snack.open('Erro ao acessar câmera/microfone', 'Fechar', { duration: 5000 });
    }
  }

  toggleAudio() {
    const next = !this.audioMuted();
    this.audioMuted.set(next);
    if (next) this.meetingSession?.audioVideo?.realtimeMuteLocalAudio();
    else this.meetingSession?.audioVideo?.realtimeUnmuteLocalAudio();
  }

  async toggleVideo() {
    const next = !this.videoOff();
    this.videoOff.set(next);
    if (next) {
      this.meetingSession?.audioVideo?.stopLocalVideoTile();
    } else {
      this.meetingSession?.audioVideo?.startLocalVideoTile();
    }
  }

  leaveCall() {
    // Paciente "sair" = encerra apenas o lado dele (médico continua na sala).
    // Não chama POST /end — esse endpoint exige auth e debita créditos; é o médico que encerra.
    this.stopMediaSession();
    this.filesPollSub?.unsubscribe();
    this.hasLeft.set(true);
  }

  async uploadFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const { upload_url, s3_key } = await this.videoSvc
        .getUploadUrl(this.consultationId, file.name, file.type, this.joinToken)
        .toPromise() as any;
      await fetch(upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      await this.videoSvc
        .notifyFileUploaded(this.consultationId, s3_key, file.name, file.type, file.size, this.joinToken)
        .toPromise();
      this.snack.open(`${file.name} enviado para o médico`, '', { duration: 3000 });
    } catch {
      this.snack.open('Erro ao enviar arquivo', 'Fechar', { duration: 4000 });
    }
    input.value = '';
  }
}
