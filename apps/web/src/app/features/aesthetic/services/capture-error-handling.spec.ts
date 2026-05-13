import { humanizeError, waitForVideoDimensions } from './capture-error-handling';

// Silencia console.error nos testes (humanizeError sempre loga)
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

// ===========================================================================
// humanizeError — matriz cobrindo todos os tipos de erro vistos em produção
// ===========================================================================

describe('humanizeError', () => {
  // -------------------------------------------------------------------------
  // Caminhos felizes / cobertos
  // -------------------------------------------------------------------------

  test('Error instance → e.message', () => {
    expect(humanizeError(new Error('Falha de teste'))).toBe('Falha de teste');
  });

  test('Error sem message → message vazio (não "Erro inesperado")', () => {
    const e = new Error();
    expect(humanizeError(e)).toBe(''); // Error vazio retorna ''
  });

  test('string lançada → o próprio valor', () => {
    expect(humanizeError('falha bruta')).toBe('falha bruta');
  });

  test('TypeError → message', () => {
    expect(humanizeError(new TypeError('Cannot read x of null')))
      .toBe('Cannot read x of null');
  });

  // -------------------------------------------------------------------------
  // HttpErrorResponse do Angular (caso mais comum em prod)
  // -------------------------------------------------------------------------

  test('HttpErrorResponse com error.message do backend', () => {
    const err = {
      status: 400,
      statusText: 'Bad Request',
      error: { error: 'INVALID_POSE', message: 'Pose inválida: xyz' },
    };
    expect(humanizeError(err)).toBe('Pose inválida: xyz');
  });

  test('HttpErrorResponse com error.error string mas sem message', () => {
    const err = {
      status: 400,
      error: { error: 'CONSENT_MISSING' },
    };
    expect(humanizeError(err)).toBe('CONSENT_MISSING');
  });

  test('HttpErrorResponse network status=0', () => {
    const err = { status: 0, statusText: '', error: null };
    expect(humanizeError(err)).toMatch(/Sem conex/);
  });

  test('HttpErrorResponse 502 sem error body', () => {
    const err = { status: 502, statusText: 'Bad Gateway', error: null };
    expect(humanizeError(err)).toBe('Erro 502: Bad Gateway');
  });

  test('HttpErrorResponse 500 sem statusText', () => {
    const err = { status: 500, error: null };
    expect(humanizeError(err)).toBe('Erro 500: erro');
  });

  test('HttpErrorResponse 403 com error.error sem message', () => {
    const err = {
      status: 403,
      statusText: 'Forbidden',
      error: { error: 'CONSENT_REINFORCED_MISSING' },
    };
    // Prioriza error.error string sobre status genérico
    expect(humanizeError(err)).toBe('CONSENT_REINFORCED_MISSING');
  });

  // -------------------------------------------------------------------------
  // DOMException (mobile Safari)
  // -------------------------------------------------------------------------

  test('DOMException via .name + .message', () => {
    // DOMException é instanceof Error em browsers reais, mas pra cobertura
    // testamos o caminho de objeto também
    const dom = { name: 'NotAllowedError', message: 'Permission denied' };
    expect(humanizeError(dom)).toBe('Permission denied');
  });

  test('Objeto com name mas sem message → "name: sem detalhes"', () => {
    expect(humanizeError({ name: 'AbortError' })).toBe('AbortError: sem detalhes');
  });

  // -------------------------------------------------------------------------
  // Casos degenerados que antes caíam no fallback "Erro inesperado"
  // -------------------------------------------------------------------------

  test('null → fallback genérico (não crash)', () => {
    expect(humanizeError(null)).toMatch(/Erro inesperado/);
  });

  test('undefined → fallback genérico', () => {
    expect(humanizeError(undefined)).toMatch(/Erro inesperado/);
  });

  test('number lançado → fallback genérico', () => {
    expect(humanizeError(42)).toMatch(/Erro inesperado/);
  });

  test('objeto vazio → fallback genérico', () => {
    expect(humanizeError({})).toMatch(/Erro inesperado/);
  });

  test('mensagem fallback aponta pro console', () => {
    expect(humanizeError(null)).toContain('console');
  });

  // -------------------------------------------------------------------------
  // Side effect — sempre loga via console.error
  // -------------------------------------------------------------------------

  test('console.error é chamado SEMPRE (debug remoto)', () => {
    humanizeError(new Error('x'));
    expect(console.error).toHaveBeenCalled();
  });

  test('console.error usa o logTag passado', () => {
    humanizeError(new Error('x'), '[CustomTag]');
    expect(console.error).toHaveBeenCalledWith('[CustomTag] erro:', expect.any(Error));
  });

  test('default logTag é [CaptureGuide]', () => {
    humanizeError(new Error('x'));
    expect(console.error).toHaveBeenCalledWith('[CaptureGuide] erro:', expect.any(Error));
  });
});

// ===========================================================================
// waitForVideoDimensions — protege contra iOS Safari videoWidth=0
// ===========================================================================

describe('waitForVideoDimensions', () => {
  test('video com dimensões válidas → retorna direto sem timeout', async () => {
    const video = { videoWidth: 720, videoHeight: 1280 } as HTMLVideoElement;
    const r = await waitForVideoDimensions(video, 2000);
    expect(r.width).toBe(720);
    expect(r.height).toBe(1280);
    expect(r.timedOut).toBe(false);
  });

  test('video com videoWidth=0 → aguarda até dimensões aparecerem', async () => {
    const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;

    // Simula dimensões aparecerem após 150ms
    setTimeout(() => {
      Object.assign(video, { videoWidth: 640, videoHeight: 480 });
    }, 150);

    const r = await waitForVideoDimensions(video, 2000);
    expect(r.width).toBe(640);
    expect(r.height).toBe(480);
    expect(r.timedOut).toBe(false);
  });

  test('timeout (videoWidth=0 não aparece) → fallback + timedOut=true', async () => {
    const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
    const t0 = Date.now();
    const r = await waitForVideoDimensions(video, 300, 999, 888);
    const dt = Date.now() - t0;

    expect(r.width).toBe(999);
    expect(r.height).toBe(888);
    expect(r.timedOut).toBe(true);
    // Esperou aproximadamente maxMs (com tolerância)
    expect(dt).toBeGreaterThanOrEqual(280);
    expect(dt).toBeLessThan(500);
  });

  test('default fallback 640x480 (facial portrait)', async () => {
    const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
    const r = await waitForVideoDimensions(video, 100);
    expect(r.width).toBe(640);
    expect(r.height).toBe(480);
  });

  test('só uma dimensão chegou (videoHeight=0) ainda aguarda', async () => {
    const video = { videoWidth: 640, videoHeight: 0 } as HTMLVideoElement;
    setTimeout(() => { Object.assign(video, { videoHeight: 480 }); }, 100);
    const r = await waitForVideoDimensions(video, 1000);
    expect(r.height).toBe(480);
    expect(r.timedOut).toBe(false);
  });
});
