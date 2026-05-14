/**
 * capture-error-handling — helpers de erro pra CaptureGuide (V2 Fase 3+)
 *
 * Funções puras extraídas dos components pra ficarem testáveis sem
 * Angular TestBed. Cobre os caminhos de erro mais comuns em mobile
 * Safari/Chrome Android (bug forensicamente identificado 2026-05-13:
 * "Erro inesperado" fallback inútil sem cobrir HttpErrorResponse,
 * DOMException, network errors, etc).
 */

/**
 * Converte qualquer `unknown` lançado em mensagem human-friendly PT-BR.
 *
 * Sempre loga o erro original via console.error pra debug remoto
 * (DevTools mobile não mostra stack trace pra mensagem string).
 *
 * Cobertura:
 *   - Error instance → e.message
 *   - string → o próprio valor
 *   - HttpErrorResponse com error.message → mensagem do backend
 *   - HttpErrorResponse network (status=0) → "Sem conexão..."
 *   - HttpErrorResponse 4xx/5xx → "Erro NNN: statusText"
 *   - DOMException via name + message
 *   - Objects com .message → mensagem
 *
 * @param e Erro arbitrário
 * @param logTag Prefixo do console.error pra distinguir entre callsites
 * @returns Mensagem humana pra setar em signal de erro
 */
export function humanizeError(e: unknown, logTag = '[CaptureGuide]'): string {
  // Sempre loga pra debug remoto. CRÍTICO em mobile sem DevTools fácil.
  console.error(`${logTag} erro:`, e);

  if (e instanceof Error) return e.message;

  if (typeof e === 'string') return e;

  if (typeof e === 'object' && e !== null) {
    const obj = e as Record<string, unknown>;

    // HttpErrorResponse do Angular HttpClient: prioriza error.message do backend
    const inner = obj['error'] as Record<string, unknown> | undefined;
    if (inner && typeof inner === 'object') {
      if (typeof inner['message'] === 'string') return inner['message'] as string;
      if (typeof inner['error'] === 'string') return String(inner['error']);
    }

    // Network error / CORS: HttpErrorResponse com status = 0
    if (typeof obj['status'] === 'number' && obj['status'] === 0) {
      return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
    }

    // 4xx / 5xx: usa statusText
    if (typeof obj['status'] === 'number' && (obj['status'] as number) >= 400) {
      const text = (typeof obj['statusText'] === 'string' && obj['statusText']) || 'erro';
      return `Erro ${obj['status']}: ${text}`;
    }

    // DOMException: tem .name + .message
    if (typeof obj['message'] === 'string') return obj['message'] as string;
    if (typeof obj['name'] === 'string') {
      const msg = String(obj['message'] ?? 'sem detalhes');
      return `${obj['name']}: ${msg}`;
    }
  }

  // Fallback diagnóstico: ao menos retornar typeof + constructor pra dar
  // contexto. Incidente 2026-05-14: usuário viu só "Erro inesperado..." e
  // não tinha pistas de qual lib estava falhando.
  const ctor = (e && typeof e === 'object' && e.constructor?.name)
    ? ` ${e.constructor.name}`
    : '';
  return `Erro inesperado (${typeof e}${ctor}). Veja o console do navegador para mais detalhes.`;
}

/**
 * Aguarda video.videoWidth/videoHeight reportarem dimensões > 0.
 *
 * iOS Safari pode reportar 0 nos primeiros frames mesmo com
 * readyState >= 2. Sem espera, snapshot pega canvas vazio.
 *
 * @param video Elemento de vídeo
 * @param maxMs Timeout máximo de espera
 * @returns Dimensões reais (ou fallback se timeout)
 */
export async function waitForVideoDimensions(
  video: HTMLVideoElement,
  maxMs = 2000,
  fallbackW = 640,
  fallbackH = 480,
): Promise<{ width: number; height: number; timedOut: boolean }> {
  const t0 = Date.now();
  while ((!video.videoWidth || !video.videoHeight) && Date.now() - t0 < maxMs) {
    await new Promise(r => setTimeout(r, 100));
  }
  return {
    width: video.videoWidth || fallbackW,
    height: video.videoHeight || fallbackH,
    timedOut: !video.videoWidth || !video.videoHeight,
  };
}
