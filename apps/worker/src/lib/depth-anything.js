'use strict';

/**
 * depth-anything — estimator de mapa de profundidade.
 *
 * IMPLEMENTAÇÃO F3.1-B (MVP scaffold): MOCK gradient vertical.
 * Permite UI viewer Three.js validar pipeline end-to-end sem ainda
 * depender de onnxruntime-node + modelo ONNX 25MB. Substituir pelo
 * inference real em F3.1-B.2 (TODO marcado abaixo).
 *
 * Por que mock primeiro:
 * 1. Reduz risco de deploy worker (Dockerfile +25MB modelo)
 * 2. UI viewer pode ser testado em prod com depth real estruturado
 *    (gradient = rosto inclinado pra frente, suficiente pra render 3D)
 * 3. Quando swap acontecer, contrato (Buffer PNG grayscale) já está
 *    estabilizado — frontend não muda
 *
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase3-design.md §7.2-7.3
 */

const sharp = require('sharp');

const PROVIDER_VERSION = 'mock-gradient-v1';
const DEPTH_WIDTH = 512;
const DEPTH_HEIGHT = 512;

/**
 * Gera mapa de profundidade a partir de buffer de foto.
 *
 * Saída: PNG buffer grayscale 8-bit, mesma dimensão DEPTH_WIDTH x DEPTH_HEIGHT.
 * Pixels: 0 = mais distante, 255 = mais próximo (convenção heightmap).
 *
 * @param {Buffer} photoBuffer  JPEG/PNG buffer da foto frontal
 * @returns {Promise<{ depthPng: Buffer, width: number, height: number, providerVersion: string, processingMs: number }>}
 */
async function generateDepthMap(photoBuffer) {
  const startMs = Date.now();

  // TODO(F3.1-B.2): substituir por onnxruntime-node + Depth-Anything-V2-Small
  // const session = await getSession();
  // const tensor = await preprocess(photoBuffer);  // 518x518 NCHW float32
  // const { output } = await session.run({ image: tensor });
  // const depthRaw = output.data;  // Float32Array
  // const depthPng = await depthToGrayscalePng(depthRaw, DEPTH_WIDTH, DEPTH_HEIGHT);

  // MOCK F3.1-B.1: gradient vertical (rosto mais "perto" no centro, mais
  // "longe" nas bordas). Suficiente pra heightmap displacement render.
  const w = DEPTH_WIDTH;
  const h = DEPTH_HEIGHT;
  const buffer = Buffer.alloc(w * h);
  const cx = w / 2;
  const cy = h / 2;
  const maxDist = Math.hypot(cx, cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Distância normalizada ao centro (0 = centro, 1 = canto)
      const dist = Math.hypot(x - cx, y - cy) / maxDist;
      // Centro = 255 (próximo), bordas = 80 (distante mas visível)
      buffer[y * w + x] = Math.round(80 + (1 - dist) * 175);
    }
  }

  const depthPng = await sharp(buffer, {
    raw: { width: w, height: h, channels: 1 },
  })
    .png()
    .toBuffer();

  return {
    depthPng,
    width: w,
    height: h,
    providerVersion: PROVIDER_VERSION,
    processingMs: Date.now() - startMs,
  };
}

module.exports = {
  generateDepthMap,
  PROVIDER_VERSION,
  DEPTH_WIDTH,
  DEPTH_HEIGHT,
};
