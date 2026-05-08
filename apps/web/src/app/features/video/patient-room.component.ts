import {
  Component, OnInit, OnDestroy, inject, signal, ElementRef, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { VideoService, PublicJoinInfo } from './video.service';

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

    .video-area { flex:1; display:flex; flex-direction:column; background:#060d1a; position:relative; }
    .remote-video { flex:1; object-fit:cover; background:#000; }
    .self-video {
      position:absolute; bottom:80px; right:12px;
      width:120px; height:85px; border-radius:8px;
      border:2px solid rgba(192,193,255,0.3); object-fit:cover; background:#111;
    }

    .controls {
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

    .upload-btn {
      padding:.5rem 1rem; background:#1a2440;
      border:1px solid rgba(192,193,255,0.3); border-radius:20px;
      color:#c0c1ff; font-size:.75rem; cursor:pointer;
      display:flex; align-items:center; gap:.375rem;
    }
    .upload-btn:hover { background:#202e4a; }

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
    } @else {
      <div class="video-area">
        <video #remoteVideo class="remote-video" autoplay playsinline></video>
        <video #selfVideo class="self-video" autoplay playsinline muted></video>

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
        </div>
      </div>
    }
  `
})
export class PatientRoomComponent implements OnInit, OnDestroy {
  @ViewChild('remoteVideo') remoteVideoEl!: ElementRef<HTMLVideoElement>;
  @ViewChild('selfVideo') selfVideoEl!: ElementRef<HTMLVideoElement>;

  private route = inject(ActivatedRoute);
  private snack = inject(MatSnackBar);
  private videoSvc = inject(VideoService);

  info = signal<PublicJoinInfo | null>(null);
  loadError = signal<string | null>(null);
  audioMuted = signal(false);
  videoOff = signal(false);

  private joinToken = '';
  private consultationId = '';
  private meetingSession: any = null;
  private localStream: MediaStream | null = null;

  ngOnInit() {
    this.joinToken = this.route.snapshot.paramMap.get('token') || '';
    this.videoSvc.getPublicJoinInfo(this.joinToken).subscribe({
      next: async (info) => {
        this.info.set(info);
        this.consultationId = info.consultation_id;
        await this.joinMeeting(info.meeting_id, info.patient_attendee);
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
    this.meetingSession?.audioVideo?.stop();
    this.localStream?.getTracks().forEach(t => t.stop());
  }

  private async joinMeeting(meetingId: string, attendee: Record<string, string>) {
    try {
      const {
        ConsoleLogger, DefaultDeviceController, DefaultMeetingSession,
        LogLevel, MeetingSessionConfiguration,
      } = await import('amazon-chime-sdk-js');

      const logger = new ConsoleLogger('ChimePatient', LogLevel.ERROR);
      const deviceController = new DefaultDeviceController(logger);
      const config = new MeetingSessionConfiguration(
        { MeetingId: meetingId, MediaPlacement: attendee['MediaPlacement'] ?? {} },
        attendee
      );
      this.meetingSession = new DefaultMeetingSession(config, logger, deviceController);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      this.localStream = stream;
      if (this.selfVideoEl?.nativeElement) {
        this.selfVideoEl.nativeElement.srcObject = stream;
      }

      this.meetingSession.audioVideo.start();
      this.meetingSession.audioVideo.startLocalVideoTile();

      this.meetingSession.audioVideo.addObserver({
        videoTileDidUpdate: (tileState: any) => {
          if (!tileState.localTile && this.remoteVideoEl?.nativeElement) {
            this.meetingSession.audioVideo.bindVideoElement(
              tileState.tileId, this.remoteVideoEl.nativeElement
            );
          }
        },
      });
    } catch (err) {
      console.error('[PatientRoom] join error:', err);
      this.snack.open('Erro ao acessar câmera/microfone', 'Fechar', { duration: 5000 });
    }
  }

  toggleAudio() {
    this.audioMuted.set(!this.audioMuted());
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = !this.audioMuted(); });
  }

  toggleVideo() {
    this.videoOff.set(!this.videoOff());
    this.localStream?.getVideoTracks().forEach(t => { t.enabled = !this.videoOff(); });
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
