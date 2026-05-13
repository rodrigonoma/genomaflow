---
name: Mobile test gaps — o que jsdom + Jest NÃO pegam
description: Bug Capture mobile Safari 2026-05-13 não pego pelos tests porque jsdom não tem video real, getUserMedia, WebGL, latency mobile. Padrão "bug uma vez = teste pra sempre" + extração de helpers puros.
type: feedback
---

# Mobile test gaps — limitações de jsdom + Jest

Tests unitários no GenomaFlow rodam em **jsdom** (Node simulando DOM). jsdom **não tem**:
- `<video>` com MediaStream real
- `navigator.mediaDevices.getUserMedia`
- WebGL (MediaPipe usa)
- WebAssembly em condições realistas
- Latency / timing real de mobile (Safari iOS, Android low-end)
- DOMException nativa de devices

Resultado: **bugs específicos de mobile passam direto pelo CI verde**.

## Incidente 2026-05-13 V2-F3 CaptureGuide

Bug: "Erro inesperado" no mobile Safari ao capturar foto.

Causas-raiz (3 simultâneas):
1. `_humanizeError` fallback genérico não cobria `HttpErrorResponse` com `error: null` (network error), `DOMException`, status `>=400` com statusText. Caía em "Erro inesperado" sem stack trace visível.
2. `_loop` MediaPipe sem `try/catch` — `detectFaceForVideo` lançando silenciosamente parava raF, deixava UI travada sem feedback.
3. `_snapshotJpeg` usava `video.videoWidth || 640` como fallback — iOS Safari reporta `videoWidth=0` nos primeiros frames mesmo com `readyState >= 2`. Resultado: canvas vazio capturado.

Nenhum dos tests existentes pegou porque:
- Tests do `CaptureGuideFacial` mockam `MediaPipeLoaderService.getFaceLandmarker` → landmarker que sempre funciona
- Mockam `uploadPhotoV2` retornando `{ id }` direto
- Nunca exercitam `_loop` com landmarker que throws
- jsdom não tem video com videoWidth flutuando

## Padrão de resposta — "Bug uma vez = teste pra sempre"

Quando um bug aparece em prod e nenhum teste pegou:

1. **Identifica os caminhos exatos** — quais funções, quais inputs específicos
2. **Extrai a lógica em função pura testável** — se está dentro de component privado, refatora pra service/helper
3. **Escreve matriz de tests** cobrindo:
   - Caminho exato do bug original
   - Variações próximas (mesma classe de erro)
   - Caminhos legítimos pra não regredir
4. **Inclui logs** no helper pra debug remoto futuro (`console.error` sempre antes de retornar string genérica)
5. **Documenta o gap** aqui pra próxima vez

Exemplo concreto desse incidente:
- Extraído `humanizeError(e, logTag)` + `waitForVideoDimensions(video, maxMs, fallbackW, fallbackH)` pra `apps/web/.../services/capture-error-handling.ts`
- 25 tests cobrindo: Error instance, string throw, HttpErrorResponse com error.message, network status=0, status>=400, DOMException, null/undefined/number, side effect console.error
- `waitForVideoDimensions` testa dimensões válidas, espera assíncrona, timeout, fallback default
- Components `_humanizeError` ficaram só `return humanizeError(e, '[CaptureGuideFacial]')`

## O que tests unitários cobrem agora

✅ Regressão dos 3 bugs específicos (humanize matriz + wait video timeout)
✅ Refactor seguro de `humanizeError` — qualquer mudança que regrida algum caso conhecido falha
✅ Documenta CONTRATO (quais tipos de erro são esperados) — onboarding mais fácil

## O que ainda NÃO cobrem

❌ Bugs futuros do mesmo TIPO mas com input não previsto (ex: nova DOMException do iOS 18)
❌ Performance issues sem throw (MediaPipe travando main thread)
❌ Race conditions específicas do device
❌ getUserMedia retornando vs prompt vs erro
❌ Capacitor WebView vs Safari mobile vs Chrome Android diferenças

## Próximos níveis se precisarmos

| Camada | Pega o quê | Custo |
|---|---|---|
| Tests unitários (atual) | Caminhos conhecidos de erro | Baixo |
| Camada 2 integration (Postgres real) | Schema/RLS/migrations | Baixo |
| Playwright E2E Chrome com fake media | Fluxo completo + UI binding | Médio (~1 sem setup) |
| BrowserStack iOS Safari real | iOS-specific bugs | Alto (US$100/mês + manutenção) |

Justificativa pra ficar onde estamos: B2B com poucos tenants em onboarding, smoke test manual em mobile pós-deploy é viável. Quando volume crescer (>1000 análises/dia), Camada 3 vira boa ideia.

## Heurística de quando escalar testing

- 1ª vez aparecer bug similar → unit test pra esse caso específico (feito neste incidente)
- 2ª vez aparecer bug similar de classe diferente → considera E2E Playwright
- 3ª vez aparecer bug só em iOS → considera BrowserStack

Não escalar prematuramente. Manutenção de E2E é cara — flaky tests minam confiança no CI.
