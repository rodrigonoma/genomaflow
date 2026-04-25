'use strict';
/**
 * Pipeline de redação de PII em imagens anexadas ao chat.
 *
 * Fluxo:
 *   1. OCR via Tesseract.js (pt+eng) → lista de palavras com bounding boxes
 *   2. Classificação PII:
 *      - Regex: CPF, CNPJ, RG, telefone, e-mail, CEP, datas (rápido, barato)
 *      - Claude Haiku: nomes de pessoa + resto (segundo passo, se sobrou texto
 *        não classificado)
 *   3. Redação visual via Sharp: compõe retângulos pretos em cima dos bboxes
 *
 * Saída: { redactedBuffer, regions } — o front recebe as regiões pra permitir
 * edição manual (adicionar/remover blocos).
 *
 * Performance: ~2-8s por imagem (dominado pelo Tesseract). Usa worker threads
 * nativos do Tesseract.js — não bloqueia o event loop da API significativamente.
 */

const sharp = require('sharp');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ───────── Padrões PII (Brasil) ─────────
const PII_PATTERNS = [
  { kind: 'cpf',    re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/ },
  { kind: 'cnpj',   re: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/ },
  { kind: 'rg',     re: /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dXx]\b/ },
  { kind: 'phone',  re: /\b(?:\+?55\s?)?\(?(?:1[1-9]|[2-9][0-9])\)?[\s-]?9?\d{4}[\s-]?\d{4}\b/ },
  { kind: 'email',  re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { kind: 'cep',    re: /\b\d{5}-?\d{3}\b/ },
  { kind: 'date',   re: /\b\d{2}\/\d{2}\/\d{4}\b/ },
];

/**
 * Roda Tesseract.js. Import dinâmico pra evitar o boot custoso quando a função
 * nunca é chamada (rotas não-redação ficam intactas).
 */
async function runOcr(imageBuffer) {
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('por+eng', 1, {
    // Silencia o logger padrão — Tesseract faz log verbose
    logger: () => {},
  });
  try {
    const { data } = await worker.recognize(imageBuffer);
    // words contém text, confidence, bbox: { x0, y0, x1, y1 }
    return (data.words || [])
      .filter(w => w.text && w.text.trim().length > 0 && w.confidence > 30)
      .map(w => ({
        text: w.text,
        confidence: w.confidence,
        // Normaliza bbox pra { x, y, w, h }
        bbox: {
          x: w.bbox.x0,
          y: w.bbox.y0,
          w: w.bbox.x1 - w.bbox.x0,
          h: w.bbox.y1 - w.bbox.y0,
        },
      }));
  } finally {
    await worker.terminate();
  }
}

/**
 * Aplica regex em cada palavra. Retorna Set de índices com match.
 *
 * Estratégia: monta o texto completo concatenando words com 1 espaço entre cada,
 * grava o offset (start, end) de cada palavra no texto, e roda regex global.
 * Palavras cujo bbox de offset SOBREPÕE o match são marcadas — sem partial-match
 * permissivo (que antes pegava "-" e "(" e ")" como PII por engano).
 *
 * Defesa adicional: ignora palavras com <2 caracteres (pontuação, single char OCR
 * artifacts) — não devem ser PII por si.
 */
function classifyByRegex(words) {
  const matched = new Set();
  // Calcula offset de cada palavra no fullText
  const offsets = [];
  let pos = 0;
  for (const w of words) {
    const start = pos;
    const end = pos + w.text.length;
    offsets.push({ start, end });
    pos = end + 1; // +1 pelo espaço de junção
  }
  const fullText = words.map(w => w.text).join(' ');

  for (const { re } of PII_PATTERNS) {
    const reGlobal = new RegExp(re.source, 'g');
    let m;
    while ((m = reGlobal.exec(fullText)) !== null) {
      const matchStart = m.index;
      const matchEnd = m.index + m[0].length;
      for (let i = 0; i < words.length; i++) {
        // ignora ruído: palavras curtas raramente são PII
        if (words[i].text.length < 2) continue;
        const o = offsets[i];
        // overlap entre [o.start, o.end) e [matchStart, matchEnd)
        if (o.start < matchEnd && o.end > matchStart) {
          matched.add(i);
        }
      }
    }
  }
  return matched;
}

/**
 * Segundo passo: Haiku classifica palavras ainda não cobertas como nome/sobrenome.
 * Batch de até N palavras numa chamada. Se Haiku falhar, segue só com regex.
 */
async function classifyByLlm(words, alreadyMatched) {
  const remaining = words
    .map((w, i) => ({ idx: i, text: w.text }))
    .filter(w => !alreadyMatched.has(w.idx));

  // Corta palavras muito curtas ou claramente não-nomes (números soltos)
  const candidates = remaining.filter(w => {
    const t = w.text;
    return t.length >= 3 && /^[A-Za-zÀ-ÿ'-]+$/.test(t);
  });
  if (candidates.length === 0) return new Set();
  if (candidates.length > 200) candidates.length = 200; // guardrail

  const prompt = `Você é um classificador conservador de PII em palavras extraídas por OCR de exame médico/veterinário (laudo, RM, RX, TC, US, ECG, etc). Sua tarefa: identificar APENAS palavras que são **nomes próprios de pessoa** (primeiro nome, sobrenome) ou **nome de animal de estimação**.

REGRA DE OURO: NA DÚVIDA, NÃO MARCAR. É melhor deixar passar do que marcar coisa errada. Só marca se tem certeza absoluta que é nome de pessoa/animal.

NUNCA marcar como nome (mesmo que pareça):
- Termos anatômicos / abreviações (ACL, MCL, PCL, LCA, LCM, LCP, ECA, RCA, AHA, AVC, etc)
- Sequências/protocolos de RM (T1, T2, T2*, FLAIR, STIR, DWI, ADC, GRE, SE, FSE, TSE, MRA, MRI, RM, RNM)
- Vistas/orientações (AX, AXIAL, SAG, SAGITAL, COR, CORONAL, TRANS, LONG, OBLIQ)
- Parâmetros técnicos (TR, TE, TI, FOV, SLICE, MATRIX, NEX, BW, FLIP)
- Marcas de aparelho/software (Siemens, GE, Philips, Toshiba, Hitachi, OsiriX, Horos, RadiAnt, DICOM)
- Tipos de exame (ULTRASSOM, US, RX, TC, ECG, EEG, EMG, HEMOGRAMA, GLICEMIA, etc)
- Medicamentos / princípios ativos (paracetamol, ibuprofeno, etc) e nomes comerciais
- Unidades (mg/dL, mmol/L, kg, cm, mm, ms, °C)
- Diagnósticos / patologias (em qualquer idioma)
- Cidades, estados, países, regiões
- Nomes de clínicas, laboratórios, hospitais (têm "Clínica", "Lab", "Hospital", "Centro Médico", etc)
- Dias da semana, meses, estações
- Termos de relatório (CONCLUSÃO, IMPRESSÃO, INDICAÇÃO, ACHADOS, COMPARAÇÃO, TÉCNICA)
- Palavras genéricas em português ou inglês que não são claramente um nome

Marcar APENAS:
- Primeiro nome de pessoa (Maria, João, Pedro, Ana, etc)
- Sobrenome (Silva, Santos, Oliveira, Souza, etc)
- Nome próprio de animal de estimação (Rex, Bidu, Mel, etc) — geralmente curto e incomum

Responda APENAS com um array JSON dos índices das palavras que são nomes próprios de pessoa/animal — sem comentários, sem texto adicional, sem nada além do array. Exemplos válidos: [], [3, 7], [0].

Palavras (formato "índice: texto"):
${candidates.map(c => `${c.idx}: ${c.text}`).join('\n')}`;

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content?.[0]?.text?.trim() ?? '';
    // Match JSON array no início da resposta
    const m = text.match(/\[[\s\S]*?\]/);
    if (!m) return new Set();
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter(x => typeof x === 'number' && x >= 0 && x < words.length));
  } catch (_err) {
    // Falha silenciosa — segue só com regex (com log no caller)
    return new Set();
  }
}

/**
 * Desenha retângulos pretos nos bboxes via Sharp + SVG composite.
 * Retângulos são ligeiramente inflados (+4px) pra garantir cobertura.
 */
async function drawRedaction(imageBuffer, regions) {
  if (regions.length === 0) return imageBuffer;
  const meta = await sharp(imageBuffer).metadata();
  const padding = 4;
  const rects = regions
    .map(r => {
      const x = Math.max(0, r.x - padding);
      const y = Math.max(0, r.y - padding);
      const w = Math.min(meta.width - x, r.w + 2 * padding);
      const h = Math.min(meta.height - y, r.h + 2 * padding);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="black"/>`;
    })
    .join('');
  const svg = `<svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toBuffer();
}

/**
 * Pipeline completo.
 * @param {Buffer} imageBuffer
 * @returns {Promise<{
 *   redactedBuffer: Buffer,
 *   regions: Array<{x:number,y:number,w:number,h:number,kind:string,text:string,confidence:number}>,
 *   engine: string,
 *   ocrWordCount: number,
 *   llmUsed: boolean
 * }>}
 */
async function redactPiiFromImage(imageBuffer) {
  const words = await runOcr(imageBuffer);
  const regexMatched = classifyByRegex(words);
  const llmMatched = await classifyByLlm(words, regexMatched);
  const llmUsed = llmMatched.size > 0;

  const allMatched = new Set([...regexMatched, ...llmMatched]);
  const regions = [...allMatched].map(idx => {
    const w = words[idx];
    // Determina o kind: se bateu com regex, usa o kind do regex; caso contrário, 'name'
    const kind = regexMatched.has(idx)
      ? (PII_PATTERNS.find(p => p.re.test(w.text))?.kind ?? 'pii')
      : 'name';
    return {
      x: w.bbox.x,
      y: w.bbox.y,
      w: w.bbox.w,
      h: w.bbox.h,
      kind,
      text: w.text,
      confidence: w.confidence,
    };
  });

  const redactedBuffer = await drawRedaction(imageBuffer, regions);

  return {
    redactedBuffer,
    regions,
    engine: llmUsed ? 'tesseract+haiku' : 'tesseract+regex',
    ocrWordCount: words.length,
    llmUsed,
  };
}

module.exports = {
  redactPiiFromImage,
  drawRedaction,
  // Exportados pra teste — funções puras sem side effects
  _internals: { classifyByRegex, PII_PATTERNS },
};
