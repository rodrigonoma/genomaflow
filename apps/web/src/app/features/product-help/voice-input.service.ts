import { Injectable, signal } from '@angular/core';

/**
 * Wrapper sobre Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 *
 * - 100% client-side: áudio nunca sai do browser, transcrição local
 * - lang='pt-BR'
 * - Estados expostos como signals: supported, recording, interim
 * - Hide do botão mic se !supported (Firefox sem flag)
 *
 * Não persiste nada nem manda nada pro backend; backend recebe só o texto
 * final (igual digitação).
 */

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    [index: number]: { transcript: string };
    length: number;
  }>;
}

@Injectable({ providedIn: 'root' })
export class VoiceInputService {
  readonly supported: boolean;
  readonly recording = signal(false);
  readonly interim = signal('');

  private recognition: any = null;
  private finalCallback: ((text: string) => void) | null = null;

  constructor() {
    const SR = (typeof window !== 'undefined')
      ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
      : null;
    this.supported = !!SR;
    if (SR) {
      this.recognition = new SR();
      this.recognition.lang = 'pt-BR';
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;

      this.recognition.onresult = (e: SpeechRecognitionEventLike) => {
        let interimText = '';
        let finalText = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const t = r[0]?.transcript ?? '';
          if (r.isFinal) finalText += t;
          else interimText += t;
        }
        if (interimText) this.interim.set(interimText);
        if (finalText && this.finalCallback) {
          this.finalCallback(finalText.trim());
        }
      };

      this.recognition.onend = () => {
        this.recording.set(false);
        // Mantém último interim como "rascunho" pro caso de não ter vindo final
        // Caller decide se usa o interim como texto via getInterim()
      };

      this.recognition.onerror = (e: any) => {
        this.recording.set(false);
        // Erros comuns: 'no-speech', 'aborted', 'not-allowed', 'network'
        // 'not-allowed' = usuário negou permissão
        if (e.error === 'not-allowed') {
          if (this.finalCallback) {
            this.finalCallback('__PERMISSION_DENIED__');
          }
        }
      };
    }
  }

  /**
   * Começa a gravar. Chama onFinal quando recebe transcrição final.
   * Em caso de permissão negada, chama onFinal com '__PERMISSION_DENIED__'.
   */
  start(onFinal: (text: string) => void): void {
    if (!this.supported || this.recording()) return;
    this.finalCallback = onFinal;
    this.interim.set('');
    try {
      this.recognition.start();
      this.recording.set(true);
    } catch (e) {
      // start() pode jogar se chamado em estado errado
      this.recording.set(false);
    }
  }

  stop(): void {
    if (!this.supported || !this.recording()) return;
    try {
      this.recognition.stop();
    } catch (_) { /* ignore */ }
    // onend cuida de setar recording = false
  }

  getInterim(): string {
    return this.interim();
  }
}
