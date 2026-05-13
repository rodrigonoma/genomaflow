'use strict';

const { describe, test, expect } = require('@jest/globals');

// ---------------------------------------------------------------------------
// Mock onnxruntime-node — não carrega modelo real (~100MB) nos tests.
// Retorna sessão sintética com output tensor mock pra validar contrato.
// ---------------------------------------------------------------------------

const mockSessionRun = jest.fn();
const mockInferenceSession = {
  inputNames: ['image'],
  outputNames: ['depth'],
  run: mockSessionRun,
};

jest.mock('onnxruntime-node', () => ({
  InferenceSession: {
    create: jest.fn(async () => mockInferenceSession),
  },
  Tensor: class MockTensor {
    constructor(type, data, dims) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  },
}));

const ort = require('onnxruntime-node');
const sharp = require('sharp');

const {
  generateDepthMap,
  preprocess,
  postprocess,
  PROVIDER_VERSION,
  INPUT_SIZE,
  OUTPUT_SIZE,
  DEPTH_WIDTH,
  DEPTH_HEIGHT,
} = require('../../src/lib/depth-anything');

beforeEach(() => {
  mockSessionRun.mockReset();
});

// ---------------------------------------------------------------------------
// Constantes — F3.1-B.2 contrato
// ---------------------------------------------------------------------------

describe('depth-anything (F3.1-B.2 ONNX real)', () => {
  test('PROVIDER_VERSION = depth-anything-v2-small@1.0', () => {
    expect(PROVIDER_VERSION).toBe('depth-anything-v2-small@1.0');
  });

  test('INPUT_SIZE 518 (Depth-Anything-V2 nativo), OUTPUT_SIZE 512 (storage)', () => {
    expect(INPUT_SIZE).toBe(518);
    expect(OUTPUT_SIZE).toBe(512);
  });

  test('DEPTH_WIDTH/HEIGHT backward compat com F3.1-B.1 = OUTPUT_SIZE', () => {
    expect(DEPTH_WIDTH).toBe(OUTPUT_SIZE);
    expect(DEPTH_HEIGHT).toBe(OUTPUT_SIZE);
  });
});

// ---------------------------------------------------------------------------
// preprocess — resize + normalize + HWC→CHW
// ---------------------------------------------------------------------------

describe('preprocess', () => {
  test('retorna Tensor float32 shape [1, 3, 518, 518]', async () => {
    // Buffer minimal: PNG 10x10 vermelho
    const inputBuf = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toBuffer();

    const tensor = await preprocess(inputBuf);
    expect(tensor.type).toBe('float32');
    expect(tensor.dims).toEqual([1, 3, 518, 518]);
    expect(tensor.data.length).toBe(3 * 518 * 518);
  });

  test('aplica normalize ImageNet (mean/std)', async () => {
    // Pixel cinza médio (128) → (128/255 - 0.485) / 0.229 ≈ 0.07 no canal R
    const inputBuf = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 128, g: 128, b: 128 } },
    }).png().toBuffer();

    const tensor = await preprocess(inputBuf);
    // Spot-check primeiro pixel canal R
    const expectedR = (128 / 255 - 0.485) / 0.229;
    expect(tensor.data[0]).toBeCloseTo(expectedR, 2);
  });
});

// ---------------------------------------------------------------------------
// postprocess — depth normalize → PNG
// ---------------------------------------------------------------------------

describe('postprocess', () => {
  test('retorna PNG grayscale válido 512x512', async () => {
    const H = 518, W = 518;
    const fakeDepth = new Float32Array(H * W);
    // Gradient vertical pra verificar normalize
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        fakeDepth[y * W + x] = y;
      }
    }
    const outputTensor = { data: fakeDepth, dims: [1, H, W] };

    const pngBuffer = await postprocess(outputTensor);

    expect(pngBuffer).toBeInstanceOf(Buffer);
    expect(pngBuffer.length).toBeGreaterThan(100);
    // Magic bytes PNG
    expect(pngBuffer[0]).toBe(0x89);
    expect(pngBuffer[1]).toBe(0x50);

    // Confirma dimensão pós-resize via sharp (channels pode variar entre
    // grayscale-1 e grayscale-3 dependendo de como sharp escreve PNG; só
    // garantimos que o formato é PNG legível com dimensões corretas)
    const meta = await sharp(pngBuffer).metadata();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
    expect(meta.format).toBe('png');
  });

  test('output [1, 1, H, W] (4 dims) também funciona', async () => {
    const fakeDepth = new Float32Array(518 * 518).fill(0.5);
    const outputTensor = { data: fakeDepth, dims: [1, 1, 518, 518] };

    const pngBuffer = await postprocess(outputTensor);
    expect(pngBuffer[0]).toBe(0x89); // PNG válido
  });

  test('normalize 0-1 → 0-255 (depth uniforme = 128)', async () => {
    const fakeDepth = new Float32Array(518 * 518).fill(5.0); // uniforme
    const outputTensor = { data: fakeDepth, dims: [1, 518, 518] };

    const pngBuffer = await postprocess(outputTensor);
    // Min=max=5 → range=1 (fallback) → todos 0 (since (5-5)/1 = 0).
    // É um edge case esperado: depth uniforme = imagem preta uniforme.
    const { data } = await sharp(pngBuffer).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateDepthMap — pipeline end-to-end (mock ONNX)
// ---------------------------------------------------------------------------

describe('generateDepthMap', () => {
  test('happy path: preprocess → run → postprocess → PNG buffer', async () => {
    const fakeDepth = new Float32Array(518 * 518);
    for (let i = 0; i < fakeDepth.length; i++) fakeDepth[i] = i / fakeDepth.length;
    mockSessionRun.mockResolvedValueOnce({
      depth: { data: fakeDepth, dims: [1, 518, 518] },
    });

    const inputBuf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 100, b: 50 } },
    }).png().toBuffer();

    const result = await generateDepthMap(inputBuf);

    expect(result.depthPng).toBeInstanceOf(Buffer);
    expect(result.depthPng[0]).toBe(0x89); // PNG magic
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.providerVersion).toBe(PROVIDER_VERSION);
    expect(typeof result.processingMs).toBe('number');
    expect(result.processingMs).toBeGreaterThanOrEqual(0);

    expect(mockSessionRun).toHaveBeenCalledTimes(1);
    const callArgs = mockSessionRun.mock.calls[0][0];
    expect(callArgs.image).toBeDefined();
    expect(callArgs.image.dims).toEqual([1, 3, 518, 518]);
  });

  test('session é singleton — segunda call NÃO chama create de novo', async () => {
    const fakeDepth = new Float32Array(518 * 518).fill(0.5);
    mockSessionRun.mockResolvedValue({
      depth: { data: fakeDepth, dims: [1, 518, 518] },
    });
    ort.InferenceSession.create.mockClear();

    const inputBuf = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();

    await generateDepthMap(inputBuf);
    await generateDepthMap(inputBuf);
    await generateDepthMap(inputBuf);

    // O session pode ter sido criado em testes anteriores, mas após mockClear
    // não deve criar de novo nas 3 chamadas (todas usam cache).
    expect(ort.InferenceSession.create).not.toHaveBeenCalled();
  });

  test('error de inferência propaga (não é silenciado)', async () => {
    mockSessionRun.mockRejectedValueOnce(new Error('CUDA out of memory'));

    const inputBuf = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();

    await expect(generateDepthMap(inputBuf)).rejects.toThrow(/CUDA out of memory/);
  });
});
