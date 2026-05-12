'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');

const MODEL = process.env.AESTHETIC_VISION_MODEL || 'claude-sonnet-4-6';
const TIMEOUT_MS = 30_000;
const MAX_REGIONS = 5;
const BLUR_SIGMA = 30;       // strong gaussian blur
const PIXELATE_BLOCKS = 16;  // pixelate block count (downscale → upscale nearest)

const PROMPT_INSTRUCTIONS = `Você é um sistema de proteção de privacidade pra fotos médicas/estéticas.

TAREFA: identifique áreas sensíveis nesta foto que devem ser BORRADAS antes do uso clínico:
- Mamilo / aréola
- Genitália
- Área anal

RETORNE JSON ESTRITO no formato:
{
  "regions": [
    { "type": "nipple"|"genital"|"areolar"|"other", "x": 0.0-1.0, "y": 0.0-1.0, "w": 0.0-1.0, "h": 0.0-1.0, "confidence": 0.0-1.0 }
  ]
}

Coordenadas em fração da imagem (0=topo/esquerda, 1=baixo/direita).
Se NENHUMA área sensível for detectada, retorne: { "regions": [] }
NÃO inclua explicação fora do JSON.`;

/**
 * Extract the first JSON object from a string (tolerant parser).
 * Throws with code BAD_LLM_OUTPUT on failure.
 */
function parseJSON(text) {
  if (!text || typeof text !== 'string') {
    throw Object.assign(new Error('BAD_LLM_OUTPUT: empty'), { code: 'BAD_LLM_OUTPUT' });
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    throw Object.assign(new Error('BAD_LLM_OUTPUT: no JSON found'), { code: 'BAD_LLM_OUTPUT' });
  }
  let parsed;
  try {
    parsed = JSON.parse(m[0]);
  } catch (e) {
    throw Object.assign(new Error('BAD_LLM_OUTPUT: invalid JSON'), { code: 'BAD_LLM_OUTPUT' });
  }
  if (!parsed || !Array.isArray(parsed.regions)) {
    throw Object.assign(new Error('BAD_LLM_OUTPUT: missing regions[]'), { code: 'BAD_LLM_OUTPUT' });
  }
  return parsed;
}

/** Clamp a value to [0, 1]. Returns null for non-finite. */
function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

const VALID_TYPES = new Set(['nipple', 'genital', 'areolar', 'other']);

/**
 * Sanitize raw LLM regions: clamp coords, whitelist types, drop invalid entries,
 * cap at MAX_REGIONS.
 */
function sanitizeRegions(parsed) {
  const out = [];
  for (const r of parsed.regions.slice(0, MAX_REGIONS)) {
    if (!r || typeof r !== 'object') continue;
    const x = clamp01(r.x);
    const y = clamp01(r.y);
    const w = clamp01(r.w);
    const h = clamp01(r.h);
    // Drop if any coord is null or dimensions are zero
    if (x === null || y === null || w === null || h === null) continue;
    if (w <= 0 || h <= 0) continue;
    const confidence = typeof r.confidence === 'number'
      ? Math.min(1, Math.max(0, r.confidence))
      : null;
    out.push({
      type: VALID_TYPES.has(r.type) ? r.type : 'other',
      x, y, w, h,
      confidence,
    });
  }
  return out;
}

/**
 * Call Sonnet Vision to detect sensitive regions in the image.
 * Returns sanitized array of regions (may be empty).
 * Throws on API failure or BAD_LLM_OUTPUT.
 */
async function detectSensitiveRegions({ buffer, mime }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error('ANTHROPIC_API_KEY ausente'), { code: 'CONFIG_ERROR' });

  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS });
  const base64 = buffer.toString('base64');

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
        { type: 'text', text: PROMPT_INSTRUCTIONS },
      ],
    }],
  });

  const text = (res.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');

  const parsed = parseJSON(text);
  return sanitizeRegions(parsed);
}

/**
 * Apply blur/pixelate to the specified regions of a buffer using sharp.
 * Uses composite overlays — does not re-encode the full image multiple times.
 *
 * @param {object} opts
 * @param {Buffer} opts.buffer  - Original image buffer
 * @param {Array}  opts.regions - Sanitized region array [{x,y,w,h}]
 * @param {'pixelate'|'blur'} opts.mode - Blur mode (default 'pixelate')
 * @returns {{ buffer: Buffer, applied: number }}
 */
async function applyBlur({ buffer, regions, mode = 'pixelate' }) {
  if (!Array.isArray(regions) || regions.length === 0) {
    return { buffer, applied: 0 };
  }

  const meta = await sharp(buffer).metadata();
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) {
    throw Object.assign(new Error('IMG_DIMENSIONS_UNKNOWN'), { code: 'IMG_DIMENSIONS_UNKNOWN' });
  }

  const overlays = [];
  for (const r of regions) {
    const left   = Math.max(0, Math.round(r.x * W));
    const top    = Math.max(0, Math.round(r.y * H));
    const width  = Math.min(W - left, Math.max(1, Math.round(r.w * W)));
    const height = Math.min(H - top,  Math.max(1, Math.round(r.h * H)));
    if (width <= 0 || height <= 0) continue;

    let tile = sharp(buffer).extract({ left, top, width, height });

    if (mode === 'blur') {
      tile = tile.blur(BLUR_SIGMA);
    } else {
      // Pixelate: downscale to small → upscale back (nearest-neighbor)
      const small = Math.max(1, Math.floor(Math.min(width, height) / PIXELATE_BLOCKS));
      tile = tile
        .resize(small, small, { fit: 'fill', kernel: 'nearest' })
        .resize(width, height, { fit: 'fill', kernel: 'nearest' });
    }

    const tileBuf = await tile.toBuffer();
    overlays.push({ input: tileBuf, left, top });
  }

  if (overlays.length === 0) return { buffer, applied: 0 };

  const composed = await sharp(buffer).composite(overlays).toBuffer();
  return { buffer: composed, applied: overlays.length };
}

/**
 * Main entry point: detect sensitive regions via Vision, then apply blur/pixelate.
 *
 * Non-fatal: if detection throws, returns original buffer + error message in result.
 * The caller should log the error but MUST NOT abort the upload.
 *
 * @param {object} opts
 * @param {Buffer} opts.buffer
 * @param {string} opts.mime      - MIME type (e.g. 'image/jpeg')
 * @param {'pixelate'|'blur'} opts.mode
 * @returns {{ buffer: Buffer, applied: number, regions: Array, error?: string }}
 */
async function autoCropSensitive({ buffer, mime, mode = 'pixelate' }) {
  let regions = [];
  try {
    regions = await detectSensitiveRegions({ buffer, mime });
  } catch (e) {
    // Detection failure is non-fatal — return original buffer
    return { buffer, applied: 0, regions: [], error: e.message };
  }

  if (regions.length === 0) {
    return { buffer, applied: 0, regions };
  }

  const { buffer: out, applied } = await applyBlur({ buffer, regions, mode });
  return { buffer: out, applied, regions };
}

module.exports = {
  detectSensitiveRegions,
  applyBlur,
  autoCropSensitive,
  parseJSON,
  sanitizeRegions,
  MAX_REGIONS,
  BLUR_SIGMA,
  PIXELATE_BLOCKS,
};
