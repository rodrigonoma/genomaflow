'use strict';
/**
 * Pipeline de redação de PII em PDFs anexados ao chat.
 *
 * Estende o redactor de imagens: cada página do PDF é renderizada como PNG e
 * passa pelo mesmo pipeline (Tesseract → regex+Haiku → Sharp).
 *
 * Limitações:
 *   - Máx 20 páginas (proteção de tempo/custo)
 *   - PDF é convertido em imagem; texto-layer original é descartado no output
 *     final (resultado é um PDF de imagens). É o trade-off aceito pra garantir
 *     redação visual confiável.
 */

const { redactPiiFromImage } = require('./redactor');

const MAX_PAGES = 20;
const PAGE_CONCURRENCY = parseInt(process.env.PDF_PAGE_CONCURRENCY || '2', 10);

/**
 * Roda fn em items com no máximo `concurrency` em paralelo.
 * Mantém ordem dos resultados.
 */
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array(Math.min(concurrency, items.length)).fill(0).map(() => worker())
  );
  return results;
}

/**
 * Renderiza páginas do PDF como PNG buffers.
 * Importação dinâmica do pdf-to-png-converter (módulo pesado, evita custo se
 * essa rota nunca for chamada em quem não usa).
 */
async function renderPdfToPngs(pdfBuffer) {
  const { pdfToPng } = require('pdf-to-png-converter');
  const pages = await pdfToPng(pdfBuffer, {
    viewportScale: 2.0, // boa nitidez pra OCR
    outputFolder: undefined, // só em memória
    outputFileMask: 'page',
  });
  return pages.map(p => ({
    pageNumber: p.pageNumber,
    name: p.name,
    content: p.content, // Buffer
  }));
}

/**
 * Pipeline completo de PDF.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<{
 *   pageCount: number,
 *   pages: Array<{
 *     pageNumber: number,
 *     originalBuffer: Buffer,
 *     redactedBuffer: Buffer,
 *     regions: Array<{x,y,w,h,kind,text,confidence}>,
 *     engine: string,
 *     ocrWordCount: number,
 *   }>,
 *   truncated: boolean,
 * }>}
 */
async function redactPiiFromPdf(pdfBuffer) {
  const allPages = await renderPdfToPngs(pdfBuffer);
  const truncated = allPages.length > MAX_PAGES;
  const pagesToProcess = allPages.slice(0, MAX_PAGES);

  // Processa páginas em paralelo com concorrência limitada.
  // PAGE_CONCURRENCY=2 (default): ~2x mais rápido que serial sem saturar CPU
  // do container Fargate (256-512 vCPU). Com 9 páginas: ~9s vs ~18s antes.
  const results = await mapWithConcurrency(pagesToProcess, PAGE_CONCURRENCY, async (page) => {
    const r = await redactPiiFromImage(page.content);
    return {
      pageNumber: page.pageNumber,
      originalBuffer: page.content,
      redactedBuffer: r.redactedBuffer,
      regions: r.regions,
      engine: r.engine,
      ocrWordCount: r.ocrWordCount,
    };
  });

  return {
    pageCount: allPages.length,
    pages: results,
    truncated,
  };
}

module.exports = { redactPiiFromPdf, MAX_PAGES };
