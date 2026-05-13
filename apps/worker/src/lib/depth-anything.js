'use strict';

/**
 * depth-anything — estimator de mapa de profundidade.
 *
 * V2 Fase 3 F3.1-B.2: Depth-Anything-V2-Small ONNX via onnxruntime-node.
 *
 * Modelo baixado no Dockerfile build (~100MB), carregado lazy na primeira
 * inference (sessão cacheada singleton). CPU-bound, leva ~30-60s por foto
 * em Fargate small — se virar gargalo, upgrade pra c6i/c7i (AVX512).
 *
 * Contrato preservado da F3.1-B.1 (mock): retorna `{ depthPng, width,
 * height, providerVersion, processingMs }`. Frontend e processor não mudam.
 *
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase3-design.md §7
 */

const ort = require('onnxruntime-node');
const sharp = require('sharp');

const PROVIDER_VERSION = 'depth-anything-v2-small@1.0';
const MODEL_PATH = process.env.DEPTH_ANYTHING_MODEL_PATH || '/app/models/depth-anything-v2-small.onnx';

// Depth-Anything-V2 espera input 518x518 (modelo treinado nessa resolução).
// Output: mesmo H×W (relative depth, higher = closer).
const INPUT_SIZE = 518;
const OUTPUT_SIZE = 512;  // Pra storage final (alinha com convenção F3.1-B.1)

// ImageNet normalization (padrão pra modelos ONNX vision)
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let _session = null;

async function getSession() {
  if (_session) return _session;
  _session = await ort.InferenceSession.create(MODEL_PATH);
  return _session;
}

/**
 * Resize + RGB-only + ImageNet normalize + HWC→CHW.
 * Retorna ort.Tensor float32 shape [1, 3, 518, 518].
 */
async function preprocess(photoBuffer) {
  const { data, info } = await sharp(photoBuffer)
    .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  const channels = info.channels || 3;
  if (channels !== 3) {
    throw Object.assign(new Error(`Expected 3 channels, got ${channels}`), { code: 'PREPROCESS_FAIL' });
  }

  const tensor = new Float32Array(3 * H * W);
  // HWC uint8 → CHW float32 com normalize ImageNet
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const hwcBase = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        const chwIdx = c * H * W + y * W + x;
        tensor[chwIdx] = (data[hwcBase + c] / 255 - MEAN[c]) / STD[c];
      }
    }
  }

  return new ort.Tensor('float32', tensor, [1, 3, H, W]);
}

/**
 * Normaliza depth raw → 0-255 uint8, resize pro OUTPUT_SIZE, retorna PNG buffer.
 */
async function postprocess(outputTensor) {
  const data = outputTensor.data;
  // Encontrar min/max pra normalize 0-1
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = (max - min) || 1;

  // Output do modelo é [1, H, W] (ou [1, 1, H, W] dependendo da export).
  // Pegar H/W das dims pra resize aware.
  const dims = outputTensor.dims;
  const outH = dims[dims.length - 2];
  const outW = dims[dims.length - 1];

  const grayBuffer = Buffer.alloc(outH * outW);
  for (let i = 0; i < grayBuffer.length; i++) {
    grayBuffer[i] = Math.round(((data[i] - min) / range) * 255);
  }

  return await sharp(grayBuffer, {
    raw: { width: outW, height: outH, channels: 1 },
  })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE)
    .png()
    .toBuffer();
}

/**
 * Gera mapa de profundidade real a partir do buffer da foto.
 *
 * @param {Buffer} photoBuffer  JPEG/PNG buffer
 * @returns {Promise<{ depthPng: Buffer, width: number, height: number, providerVersion: string, processingMs: number }>}
 */
async function generateDepthMap(photoBuffer) {
  const startMs = Date.now();

  const session = await getSession();
  const inputTensor = await preprocess(photoBuffer);

  // Modelo Depth-Anything geralmente expõe input chamado 'image' ou 'pixel_values';
  // usamos o primeiro inputName via introspection pra robustez.
  const inputName = session.inputNames[0];
  const result = await session.run({ [inputName]: inputTensor });
  const outputName = session.outputNames[0];
  const outputTensor = result[outputName];

  const depthPng = await postprocess(outputTensor);

  return {
    depthPng,
    width: OUTPUT_SIZE,
    height: OUTPUT_SIZE,
    providerVersion: PROVIDER_VERSION,
    processingMs: Date.now() - startMs,
  };
}

module.exports = {
  generateDepthMap,
  preprocess,
  postprocess,
  getSession,
  PROVIDER_VERSION,
  INPUT_SIZE,
  OUTPUT_SIZE,
  DEPTH_WIDTH: OUTPUT_SIZE,   // backward compat com tests F3.1-B.1
  DEPTH_HEIGHT: OUTPUT_SIZE,
};
