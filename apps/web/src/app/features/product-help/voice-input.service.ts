import { Injectable, signal } from '@angular/core';

/**
 * Wrapper sobre Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 *
 * - 100% client-side: áudio nunca sai do browser, transcrição local
 * - lang='pt-BR'
 * - Modo CONTÍNUO: ao detectar fim de fala, callback recebe texto final E o
 *   reconhecimento reinicia automaticamente — usuário pode falar de novo
 *   sem clicar no mic. Permanece ativo até stop() explícito (clique no mic
 *   ou close do panel).
 * - Browsers suportam continuous=true mas comportamento varia. Pra
 *   robustez, também restartamos no onend caso pare por inatividade.
 *
 * Não persiste nada nem manda nada pro backend; backend recebe só o texto
 * final (igual digitação manual).
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

  // Distingue parada manual (usuário clicou) vs parada automática
  // (silêncio prolongado ou bug do browser). Manual NÃO reinicia.
  private stopRequested = false;

  constructor() {
    const SR = (typeof window !== 'undefined')
      ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
      : null;
    this.supported = !!SR;
    if (SR) {
      this.recognition = new SR();
      this.recognition.lang = 'pt-BR';
      // continuous=true mantém escuta entre frases, sem fechar após primeira
      this.recognition.continuous = true;
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
          // Reset interim quando final chega — próximo trecho começa do zero visualmente
          this.interim.set('');
          this.finalCallback(finalText.trim());
        }
      };

      this.recognition.onend = () => {
        // Se NÃO foi pedida parada manual, reinicia o reconhecimento.
        // Cobre dois casos:
        //  1) browser parou após silêncio (mesmo com continuous=true alguns browsers fazem)
        //  2) erro transitório que matou o stream
        if (this.stopRequested) {
          this.recording.set(false);
          this.interim.set('');
          return;
        }
        try {
          this.recognition.start();
          // Mantém recording() = true (não reseta sinal)
        } catch (_) {
          // start() pode jogar se chamado em estado errado — sinaliza fim
          this.recording.set(false);
          this.interim.set('');
        }
      };

      this.recognition.onerror = (e: any) => {
        // 'no-speech' e 'aborted' são normais — onend cuida do restart se aplicável
        if (e.error === 'not-allowed') {
          this.stopRequested = true;
          this.recording.set(false);
          this.interim.set('');
          if (this.finalCallback) {
            this.finalCallback('__PERMISSION_DENIED__');
          }
        } else if (e.error === 'audio-capture' || e.error === 'service-not-allowed') {
          this.stopRequested = true;
          this.recording.set(false);
          this.interim.set('');
        }
        // Outros erros (no-speech, network transitório): deixa onend reiniciar
      };
    }
  }

  /**
   * Começa a gravar em modo contínuo. Permanece ativo até stop() ser chamado.
   * onFinal é invocado a cada trecho de fala finalizado (pode ser várias vezes
   * numa mesma sessão de gravação).
   * Em caso de permissão negada, onFinal é chamado uma vez com '__PERMISSION_DENIED__'.
   */
  start(onFinal: (text: string) => void): void {
    if (!this.supported || this.recording()) return;
    this.finalCallback = onFinal;
    this.stopRequested = false;
    this.interim.set('');
    try {
      this.recognition.start();
      this.recording.set(true);
    } catch (e) {
      this.recording.set(false);
    }
  }

  stop(): void {
    if (!this.supported || !this.recording()) return;
    this.stopRequested = true;
    try {
      this.recognition.stop();
    } catch (_) { /* ignore */ }
    // onend cuida de setar recording = false e limpar interim
  }

  getInterim(): string {
    return this.interim();
  }
}
