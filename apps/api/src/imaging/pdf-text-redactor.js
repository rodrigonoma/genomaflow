'use strict';
/**
 * Redação de PII em PDFs com text layer.
 *
 * Diferente do V1.5 (que rasterizava todo o PDF e rodava OCR — lento + saída
 * gigante), este módulo:
 *   1. Extrai texto + posições de cada item via pdfjs-dist (rápido, exato)
 *   2. Identifica PII via regex + Haiku (reusa lógica do redactor.js)
 *   3. Desenha retângulos pretos diretamente nas coordenadas via pdf-lib
 *      (sem rasterizar — text layer permanece, output mantém tamanho original)
 *
 * PDFs sem text layer (escaneados) retornam { hasTextLayer: false }.
 * Caller (route handler) decide: bloquear ou pedir confirmação do usuário.
 */

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Mesmos padrões do redactor.js (mantidos sincronizados manualmente — evita
// dep cruzada com OCR-specific code)
const PII_PATTERNS = [
  { kind: 'cpf',    re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/ },
  { kind: 'cnpj',   re: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/ },
  { kind: 'rg',     re: /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dXx]\b/ },
  { kind: 'phone',  re: /\b(?:\+?55\s?)?\(?(?:1[1-9]|[2-9][0-9])\)?[\s-]?9?\d{4}[\s-]?\d{4}\b/ },
  { kind: 'email',  re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { kind: 'cep',    re: /\b\d{5}-?\d{3}\b/ },
  { kind: 'date',   re: /\b\d{2}\/\d{2}\/\d{4}\b/ },
];

// Heurística pra detectar PDF escaneado: poucos chars de texto pra muitas páginas
const MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER = 30;

async function extractTextWithPositions(pdfBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    isEvalSupported: false,
    useSystemFonts: false,
  });
  const pdf = await loadingTask.promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });
    const items = textContent.items
      .filter(it => it && typeof it.str === 'string' && it.str.length > 0)
      .map(it => ({
        str: it.str,
        // pdfjs transform: [a,b,c,d,e,f]; (e, f) é a posição de origem do glyph
        x: it.transform[4],
        y: it.transform[5],
        width: it.width,
        height: it.height,
      }));
    pages.push({
      pageNumber: i,
      pageWidth: viewport.width,
      pageHeight: viewport.height,
      items,
    });
  }
  await pdf.destroy();
  return pages;
}

function classifyByRegexInItems(items) {
  const matched = new Map(); // idx → kind
  if (items.length === 0) return matched;

  // Calcula offsets no fullText (cada item separado por espaço)
  const offsets = [];
  let pos = 0;
  for (const it of items) {
    offsets.push({ start: pos, end: pos + it.str.length });
    pos += it.str.length + 1;
  }
  const fullText = items.map(i => i.str).join(' ');

  for (const { kind, re } of PII_PATTERNS) {
    const reG = new RegExp(re.source, 'g');
    let m;
    while ((m = reG.exec(fullText)) !== null) {
      const ms = m.index;
      const me = m.index + m[0].length;
      for (let i = 0; i < items.length; i++) {
        if (items[i].str.length < 2) continue;
        const o = offsets[i];
        if (o.start < me && o.end > ms) {
          if (!matched.has(i)) matched.set(i, kind);
        }
      }
    }
  }
  return matched;
}

/**
 * Roda Haiku pra identificar nomes próprios de pessoa/animal nos items
 * remanescentes (não cobertos por regex). Retorna Map<itemIdx, 'name'>.
 *
 * Estratégia: candidatos elegíveis (palavras com 3+ chars, alfa) + uma chamada
 * por documento (todos os itens não-classificados em uma chamada — minimiza
 * roundtrips a Haiku).
 */
async function classifyByLlmInItems(items, alreadyMatched) {
  const candidates = items
    .map((it, idx) => ({ idx, text: it.str.trim() }))
    .filter(c => !alreadyMatched.has(c.idx))
    .filter(c => c.text.length >= 3 && /^[A-Za-zÀ-ÿ' -]{3,}$/.test(c.text));

  if (candidates.length === 0) return new Map();
  if (candidates.length > 300) candidates.length = 300; // hard cap

  const prompt = `Você é um classificador conservador de PII em items extraídos de um PDF de exame médico/veterinário (laudo, RM, RX, TC, US, ECG, etc). Sua tarefa: identificar APENAS items que são **nome próprio de pessoa** (primeiro nome, sobrenome, ou "nome sobrenome" combinados) ou **nome próprio de animal de estimação**.

REGRA DE OURO: NA DÚVIDA, NÃO MARCAR.

NUNCA marcar (mesmo se parecer nome):
- Termos médicos / anatômicos / abreviações (ACL, MCL, PCL, LCA, ECA, AVC, RM, TC, etc)
- Sequências/protocolos de RM (T1, T2, FLAIR, STIR, DWI, etc)
- Vistas/orientações (AX, AXIAL, SAG, COR, CORONAL, OBLIQ, etc)
- Parâmetros técnicos (TR, TE, TI, FOV, NEX, etc)
- Marcas de aparelho (Siemens, GE, Philips, Toshiba)
- Tipos de exame (HEMOGRAMA, GLICEMIA, ULTRASSOM, etc)
- Medicamentos / princípios ativos
- Unidades (mg/dL, mmol/L, kg, cm, mm, °C)
- Diagnósticos / patologias
- Cidades, estados, países
- Nomes de clínicas, laboratórios, hospitais (têm "Clínica", "Lab", "Hospital", "Centro Médico")
- Dias da semana, meses
- Termos de relatório (CONCLUSÃO, IMPRESSÃO, INDICAÇÃO, ACHADOS, COMPARAÇÃO, TÉCNICA, RESULTADO)
- Labels comuns ("Paciente", "Nome", "Solicitante", "Médico", "Dr", "Dra", "Sr", "Sra")
- Palavras genéricas em português ou inglês

Marcar APENAS:
- Nome próprio de pessoa (ex: "Maria", "João", "Silva", "Santos", "Maria Silva", "João da Silva")
- Nome próprio de pet (ex: "Rex", "Bidu", "Mel")

Responda APENAS com array JSON dos índices dos items que são nome próprio. Nada mais. Exemplos: [], [3, 7].

Items (formato "índice: texto"):
${candidates.map(c => `${c.idx}: ${c.text}`).join('\n')}`;

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content?.[0]?.text?.trim() ?? '';
    const m = text.match(/\[[\s\S]*?\]/);
    if (!m) return new Map();
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return new Map();
    const out = new Map();
    for (const idx of arr) {
      if (typeof idx === 'number' && idx >= 0 && idx < items.length) {
        out.set(idx, 'name');
      }
    }
    return out;
  } catch (_err) {
    return new Map();
  }
}

/**
 * Pipeline principal.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<{
 *   hasTextLayer: boolean,
 *   redactedBuffer?: Buffer,
 *   summary?: Record<string, number>,  // ex: { name: 3, cpf: 1, phone: 2 }
 *   totalRegions?: number,
 *   pageCount?: number,
 *   reasoning?: string,                 // explicação quando hasTextLayer=false
 * }>}
 */
async function redactPiiInTextLayerPdf(pdfBuffer) {
  const pages = await extractTextWithPositions(pdfBuffer);
  const totalChars = pages.reduce(
    (sum, p) => sum + p.items.reduce((s, i) => s + i.str.length, 0),
    0
  );
  const minExpected = pages.length * MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER;

  if (totalChars < minExpected) {
    return {
      hasTextLayer: false,
      pageCount: pages.length,
      reasoning: `${totalChars} chars em ${pages.length} páginas (esperado ≥ ${minExpected})`,
    };
  }

  // Classifica PII em todos os items, mantendo associação item → page
  const allItemsWithPage = [];
  for (const page of pages) {
    for (const item of page.items) {
      allItemsWithPage.push({ pageNumber: page.pageNumber, item });
    }
  }
  const flatItems = allItemsWithPage.map(x => x.item);

  // Regex
  const regexMatched = classifyByRegexInItems(flatItems);
  // Haiku (item-level)
  const llmMatched = await classifyByLlmInItems(flatItems, regexMatched);

  // Merge — regex tem precedência por kind
  const finalMatched = new Map();
  for (const [idx, kind] of regexMatched) finalMatched.set(idx, kind);
  for (const [idx, kind] of llmMatched) {
    if (!finalMatched.has(idx)) finalMatched.set(idx, kind);
  }

  // Summary por kind
  const summary = {};
  for (const kind of finalMatched.values()) {
    summary[kind] = (summary[kind] || 0) + 1;
  }
  const totalRegions = finalMatched.size;

  // Desenha retângulos via pdf-lib
  const { PDFDocument, rgb } = require('pdf-lib');
  const doc = await PDFDocument.load(pdfBuffer);
  const docPages = doc.getPages();
  const PAD = 1.5;

  for (let flatIdx = 0; flatIdx < flatItems.length; flatIdx++) {
    if (!finalMatched.has(flatIdx)) continue;
    const { pageNumber, item } = allItemsWithPage[flatIdx];
    const docPage = docPages[pageNumber - 1];
    if (!docPage) continue;
    // pdf-lib origin é bottom-left, mesma do pdfjs transform[5].
    // Item.y é a baseline do texto. Cobre baseline-pad até baseline+height+pad.
    docPage.drawRectangle({
      x: item.x - PAD,
      y: item.y - PAD,
      width: item.width + 2 * PAD,
      height: item.height + 2 * PAD,
      color: rgb(0, 0, 0),
      borderColor: rgb(0, 0, 0),
      borderWidth: 0,
    });
  }

  const redactedBytes = await doc.save({ useObjectStreams: false });
  return {
    hasTextLayer: true,
    redactedBuffer: Buffer.from(redactedBytes),
    summary,
    totalRegions,
    pageCount: pages.length,
  };
}

module.exports = {
  redactPiiInTextLayerPdf,
  MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER,
  // Exportados pra teste — funções puras sem side effects
  _internals: { classifyByRegexInItems, PII_PATTERNS },
};
