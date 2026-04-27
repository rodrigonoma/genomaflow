import { VoiceInputService } from './voice-input.service';

/**
 * Testa o timeout de inatividade do mic — se nenhum onresult chegar em
 * IDLE_TIMEOUT_MS, o serviço deve auto-encerrar (sem precisar de clique).
 *
 * Mock manual de SpeechRecognition: capturamos os handlers (onresult, onend,
 * onerror) ao instanciar e chamamos manualmente nos testes pra simular fala.
 */

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  start = jest.fn();
  stop = jest.fn(() => {
    // Comportamento real: stop() dispara onend assincronamente. Pra teste
    // simulamos stop síncrono — chamamos onend manualmente quando precisar.
  });

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }
}

function fakeResultEvent(text: string, isFinal = false) {
  return {
    resultIndex: 0,
    results: [
      Object.assign([{ transcript: text }], {
        isFinal,
        length: 1,
      }),
    ] as any,
  };
}

describe('VoiceInputService — idle timeout', () => {
  let service: VoiceInputService;
  let recognition: MockSpeechRecognition;

  beforeEach(() => {
    jest.useFakeTimers();
    MockSpeechRecognition.instances = [];
    (window as any).SpeechRecognition = MockSpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
    service = new VoiceInputService();
    recognition = MockSpeechRecognition.instances[0];
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (window as any).SpeechRecognition;
  });

  it('configures continuous + pt-BR + interimResults', () => {
    expect(recognition.lang).toBe('pt-BR');
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
  });

  it('start() arms idle timer; expires after 15s and auto-stops', () => {
    const cb = jest.fn();
    service.start(cb);
    expect(service.recording()).toBe(true);
    expect(recognition.start).toHaveBeenCalledTimes(1);

    // Avança 14.999s — ainda gravando, sem chamar stop()
    jest.advanceTimersByTime(14_999);
    expect(recognition.stop).not.toHaveBeenCalled();
    expect(service.recording()).toBe(true);

    // Cruza os 15s — auto-stop dispara
    jest.advanceTimersByTime(2);
    expect(recognition.stop).toHaveBeenCalledTimes(1);
  });

  it('onresult interim resets idle timer (mic não fecha em 15s se houver fala)', () => {
    service.start(jest.fn());

    // 10s de silêncio
    jest.advanceTimersByTime(10_000);
    expect(recognition.stop).not.toHaveBeenCalled();

    // Fala chega (interim) — reseta timer
    recognition.onresult!(fakeResultEvent('oi', false));

    // Mais 14.999s desde o reset (24.999s desde start) — ainda gravando
    jest.advanceTimersByTime(14_999);
    expect(recognition.stop).not.toHaveBeenCalled();

    // Cruza os 15s desde o reset — agora sim auto-stop
    jest.advanceTimersByTime(2);
    expect(recognition.stop).toHaveBeenCalledTimes(1);
  });

  it('onresult final também reseta idle timer', () => {
    const cb = jest.fn();
    service.start(cb);

    jest.advanceTimersByTime(10_000);
    recognition.onresult!(fakeResultEvent('agendar amanhã', true));
    expect(cb).toHaveBeenCalledWith('agendar amanhã');

    jest.advanceTimersByTime(14_999);
    expect(recognition.stop).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2);
    expect(recognition.stop).toHaveBeenCalledTimes(1);
  });

  it('stop() manual cancela o idle timer (sem chamadas duplicadas)', () => {
    service.start(jest.fn());
    service.stop();
    // Simula onend natural após stop()
    recognition.onend!();

    // Mesmo passando 30s, stop() não é chamado de novo via timer
    jest.advanceTimersByTime(30_000);
    expect(recognition.stop).toHaveBeenCalledTimes(1);
  });

  it('restart silencioso (onend sem stopRequested) NÃO reseta timer', () => {
    service.start(jest.fn());

    // 10s passam, browser dispara onend silencioso (silêncio detectado)
    jest.advanceTimersByTime(10_000);
    recognition.onend!();
    // Service reinicia recognition
    expect(recognition.start).toHaveBeenCalledTimes(2);

    // Apenas mais 5s (15s totais desde start) — timer original ainda contando
    jest.advanceTimersByTime(5_001);
    expect(recognition.stop).toHaveBeenCalledTimes(1);
  });

  it('permission denied limpa timer e não auto-stop depois', () => {
    const cb = jest.fn();
    service.start(cb);
    recognition.onerror!({ error: 'not-allowed' });
    expect(cb).toHaveBeenCalledWith('__PERMISSION_DENIED__');
    expect(service.recording()).toBe(false);

    // Timer foi limpo — mesmo passando 30s nada novo dispara
    jest.advanceTimersByTime(30_000);
    expect(recognition.stop).not.toHaveBeenCalled();
  });

  it('IDLE_TIMEOUT_MS é 15000', () => {
    expect(VoiceInputService.IDLE_TIMEOUT_MS).toBe(15_000);
  });
});

describe('VoiceInputService — quando SpeechRecognition não disponível', () => {
  beforeEach(() => {
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
  });

  it('supported = false; start/stop são no-op', () => {
    const service = new VoiceInputService();
    expect(service.supported).toBe(false);
    const cb = jest.fn();
    service.start(cb);
    expect(service.recording()).toBe(false);
    service.stop(); // não joga
  });
});
