'use strict';

const { describe, test, expect } = require('@jest/globals');
const sharp = require('sharp');

// Mocks ESM-only libs (dynamic import não roda em Jest CommonJS sem
// experimental-vm-modules). Worker em prod usa Node nativo, sem essa
// limitação. Aqui só validamos a lógica de negócio.

jest.mock('@gltf-transform/core', () => {
  // Mock simulando shape Document + NodeIO.writeBinary
  class MockAccessor {
    setType() { return this; }
    setArray(arr) { this._array = arr; return this; }
    setBuffer() { return this; }
  }
  class MockTexture {
    setImage() { return this; }
    setMimeType() { return this; }
  }
  class MockMaterial {
    setBaseColorTexture() { return this; }
    setMetallicFactor() { return this; }
    setRoughnessFactor() { return this; }
  }
  class MockPrimitive {
    setAttribute() { return this; }
    setIndices() { return this; }
    setMaterial() { return this; }
  }
  class MockMesh {
    addPrimitive() { return this; }
  }
  class MockNode {
    setMesh() { return this; }
  }
  class MockScene {
    addChild() { return this; }
  }
  class MockDocument {
    createBuffer() { return {}; }
    createAccessor() { return new MockAccessor(); }
    createTexture() { return new MockTexture(); }
    createMaterial() { return new MockMaterial(); }
    createPrimitive() { return new MockPrimitive(); }
    createMesh() { return new MockMesh(); }
    createNode() { return new MockNode(); }
    createScene() { return new MockScene(); }
  }
  class MockNodeIO {
    async writeBinary() {
      // GLB magic bytes: "glTF" + version + length
      const buf = Buffer.alloc(20);
      buf.write('glTF', 0);
      buf.writeUInt32LE(2, 4);   // version
      buf.writeUInt32LE(20, 8);  // length
      return new Uint8Array(buf);
    }
  }
  return { Document: MockDocument, NodeIO: MockNodeIO };
}, { virtual: true });

jest.mock('delaunator', () => {
  // Mock Delaunator constructor que devolve triangles array
  class MockDelaunator {
    constructor(flat2d) {
      const N = flat2d.length / 2;
      // Sintético: gera ~2*(N-2) triangles (lower bound de Delaunay convex)
      const triCount = Math.max(0, 2 * (N - 2));
      const tris = new Uint32Array(triCount * 3);
      for (let i = 0; i < triCount; i++) {
        tris[i * 3]     = i % N;
        tris[i * 3 + 1] = (i + 1) % N;
        tris[i * 3 + 2] = (i + 2) % N;
      }
      this.triangles = tris;
    }
  }
  return { __esModule: true, default: MockDelaunator };
}, { virtual: true });

const { generateFaceMesh3D, sampleDepthBilinear, PROVIDER_VERSION } =
  require('../../src/lib/face-mesh-3d');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeFakePhotoJpeg(w = 100, h = 100, color = { r: 200, g: 100, b: 50 }) {
  return await sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function makeFakeDepthPng(w = 64, h = 64, value = 128) {
  const buf = Buffer.alloc(w * h, value);
  return await sharp(buf, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
}

// 468 landmarks fake distribuídos em grid 22x22 → cobre face inteira
function makeFakeLandmarks468() {
  const pts = [];
  const N = 468;
  // Distribuir em uma "elipse" simulando rosto
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2;
    const r = 0.3 + 0.15 * Math.sin(i * 3.7);  // ruído
    pts.push({
      x: 0.5 + r * Math.cos(angle) * 0.6,
      y: 0.5 + r * Math.sin(angle) * 0.8,
      z: 0,
    });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Constantes / API
// ---------------------------------------------------------------------------

describe('face-mesh-3d module', () => {
  test('PROVIDER_VERSION começa com face-mesh-3d', () => {
    expect(PROVIDER_VERSION).toMatch(/^face-mesh-3d/);
  });
});

// ---------------------------------------------------------------------------
// sampleDepthBilinear
// ---------------------------------------------------------------------------

describe('sampleDepthBilinear', () => {
  test('depth=255 → Z=+0.5 (mais próximo)', () => {
    const buf = new Uint8Array(4 * 4).fill(255);
    expect(sampleDepthBilinear(buf, 4, 4, 0.5, 0.5)).toBeCloseTo(0.5, 2);
  });

  test('depth=0 → Z=-0.5 (mais distante)', () => {
    const buf = new Uint8Array(4 * 4).fill(0);
    expect(sampleDepthBilinear(buf, 4, 4, 0.5, 0.5)).toBeCloseTo(-0.5, 2);
  });

  test('depth=128 → Z≈0 (neutro)', () => {
    const buf = new Uint8Array(4 * 4).fill(128);
    expect(Math.abs(sampleDepthBilinear(buf, 4, 4, 0.5, 0.5))).toBeLessThan(0.05);
  });

  test('coords fora de [0,1] clamp', () => {
    const buf = new Uint8Array(4 * 4).fill(200);
    const v = sampleDepthBilinear(buf, 4, 4, -1, 2);
    expect(typeof v).toBe('number');
    expect(Number.isFinite(v)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateFaceMesh3D end-to-end
// ---------------------------------------------------------------------------

describe('generateFaceMesh3D', () => {
  test('retorna GLB buffer válido + counts coerentes', async () => {
    const photoJpeg = await makeFakePhotoJpeg();
    const depthPng = await makeFakeDepthPng();
    const landmarks = makeFakeLandmarks468();

    const result = await generateFaceMesh3D({
      frontalPhotoJpeg: photoJpeg,
      landmarks,
      depthPng,
    });

    // GLB magic bytes (4 bytes "glTF")
    expect(result.glb).toBeInstanceOf(Buffer);
    expect(result.glb[0]).toBe(0x67); // 'g'
    expect(result.glb[1]).toBe(0x6C); // 'l'
    expect(result.glb[2]).toBe(0x54); // 'T'
    expect(result.glb[3]).toBe(0x46); // 'F'

    expect(result.vertexCount).toBe(468);
    expect(result.triangleCount).toBeGreaterThan(800);  // Delaunay de 468 pts dá ~900
    expect(result.triangleCount).toBeLessThan(1100);
    expect(typeof result.processingMs).toBe('number');
    expect(result.processingMs).toBeGreaterThanOrEqual(0);
    expect(result.providerVersion).toMatch(/face-mesh-3d/);
  });

  test('rejeita landmarks vazio com NO_LANDMARKS', async () => {
    const photoJpeg = await makeFakePhotoJpeg();
    const depthPng = await makeFakeDepthPng();
    await expect(generateFaceMesh3D({
      frontalPhotoJpeg: photoJpeg,
      landmarks: [],
      depthPng,
    })).rejects.toMatchObject({ code: 'NO_LANDMARKS' });
  });

  test('aceita landmarks com menos de 468 (não trava)', async () => {
    const photoJpeg = await makeFakePhotoJpeg();
    const depthPng = await makeFakeDepthPng();
    const fewLandmarks = makeFakeLandmarks468().slice(0, 50);
    const result = await generateFaceMesh3D({
      frontalPhotoJpeg: photoJpeg,
      landmarks: fewLandmarks,
      depthPng,
    });
    expect(result.vertexCount).toBe(50);
    expect(result.glb[0]).toBe(0x67); // GLB válido
  });
});
