'use strict';

/**
 * face-mesh-3d — gera mesh 3D facial GLB a partir de:
 *  - foto frontal (textura UV)
 *  - landmarks frontais MediaPipe (468 pts normalizados 0-1)
 *  - depth map PNG da frontal (heightmap Z por pixel)
 *
 * V2 Fase 3.2-B (entrega rotação 360°).
 *
 * Estratégia MVP:
 *  1. Pra cada landmark frontal (468), sample Z do depth map em (x, y)
 *  2. Delaunay 2D triangulation dos 468 vértices (usa biblioteca `delaunator`)
 *  3. UV map: cada vértice ganha UV = (x, 1 - y) da posição frontal
 *  4. Exporta GLB binário via @gltf-transform/core com texture = foto frontal
 *
 * Frontend carrega .glb via three/examples GLTFLoader e renderiza com
 * OrbitControls rotação 360° (sem clamp).
 *
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase3-design.md §4 (F3.2)
 */

const sharp = require('sharp');

// @gltf-transform/core e delaunator são ESM-only. Dynamic import lazy.
let _gltfCore = null;
let _delaunator = null;

async function getGltf() {
  if (_gltfCore) return _gltfCore;
  _gltfCore = await import('@gltf-transform/core');
  return _gltfCore;
}

async function getDelaunator() {
  if (_delaunator) return _delaunator;
  const mod = await import('delaunator');
  _delaunator = mod.default || mod;
  return _delaunator;
}

const PROVIDER_VERSION = 'face-mesh-3d-v1-delaunay';

/**
 * Faz sample bilinear do depth map em coords normalizadas (x, y ∈ [0, 1]).
 * Retorna Z normalizado em [-0.5, 0.5] (centrado em 0; magnitude controla
 * deslocamento do "rosto pra frente" no mesh).
 *
 * Z positivo = mais próximo da câmera (convenção heightmap herdada).
 * Magnitude 0.5 evita deformação grotesca.
 */
function sampleDepthBilinear(depthBuffer, w, h, x, y) {
  const xc = Math.max(0, Math.min(w - 1, x * w));
  const yc = Math.max(0, Math.min(h - 1, y * h));
  const x0 = Math.floor(xc), y0 = Math.floor(yc);
  const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
  const dx = xc - x0, dy = yc - y0;
  const p00 = depthBuffer[y0 * w + x0];
  const p10 = depthBuffer[y0 * w + x1];
  const p01 = depthBuffer[y1 * w + x0];
  const p11 = depthBuffer[y1 * w + x1];
  const v = p00 * (1 - dx) * (1 - dy)
          + p10 * dx       * (1 - dy)
          + p01 * (1 - dx) * dy
          + p11 * dx       * dy;
  return (v / 255) - 0.5; // 0..1 → -0.5..0.5
}

/**
 * @param {Object} opts
 * @param {Buffer} opts.frontalPhotoJpeg  JPEG buffer da foto frontal (vira textura)
 * @param {Array<{x:number,y:number,z:number}>} opts.landmarks  468 pts normalizados
 * @param {Buffer} opts.depthPng  PNG grayscale da frontal (depth heightmap)
 * @returns {Promise<{ glb: Buffer, vertexCount: number, triangleCount: number, processingMs: number, providerVersion: string }>}
 */
async function generateFaceMesh3D({ frontalPhotoJpeg, landmarks, depthPng }) {
  const startMs = Date.now();

  if (!Array.isArray(landmarks) || landmarks.length === 0) {
    throw Object.assign(new Error('landmarks vazio'), { code: 'NO_LANDMARKS' });
  }

  // 1. Decode depth PNG grayscale → raw bytes (1 channel)
  const { data: depthRaw, info: depthInfo } = await sharp(depthPng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const dW = depthInfo.width;
  const dH = depthInfo.height;
  // Se ensureAlpha forçou 4 canais, pegar só o R (grayscale: R==G==B)
  const channels = depthInfo.channels;
  const grayBuf = new Uint8Array(dW * dH);
  for (let i = 0; i < dW * dH; i++) {
    grayBuf[i] = depthRaw[i * channels];
  }

  // 2. Sample Z pra cada landmark
  // Vértices em escala [-0.75, 0.75] horizontal (matches PlaneGeometry F3.1)
  const N = landmarks.length;
  const positions = new Float32Array(N * 3);  // [x, y, z, x, y, z, ...]
  const uvs = new Float32Array(N * 2);
  const SCALE = 1.5; // Plane "width" em world units

  for (let i = 0; i < N; i++) {
    const lm = landmarks[i];
    const nx = lm.x;       // 0..1
    const ny = lm.y;       // 0..1
    const z = sampleDepthBilinear(grayBuf, dW, dH, nx, ny);

    // GLTF convenção: Y up, Z back. World coord:
    // x = (nx - 0.5) * SCALE   (centra em 0)
    // y = (0.5 - ny) * SCALE   (flip Y — landmark y cresce pra baixo, world up)
    // z = depth_scaled         (positivo = pra frente)
    positions[i * 3]     = (nx - 0.5) * SCALE;
    positions[i * 3 + 1] = (0.5 - ny) * SCALE;
    positions[i * 3 + 2] = z * 0.4; // magnitude controlada

    // UV: x igual, y flipped (textura GL usa origem bottom-left)
    uvs[i * 2]     = nx;
    uvs[i * 2 + 1] = 1 - ny;
  }

  // 3. Delaunay 2D triangulation (usa só x/y dos landmarks)
  const Delaunator = await getDelaunator();
  const flat2d = new Float64Array(N * 2);
  for (let i = 0; i < N; i++) {
    flat2d[i * 2]     = landmarks[i].x;
    flat2d[i * 2 + 1] = landmarks[i].y;
  }
  const delaunay = new Delaunator(flat2d);
  const triangles = delaunay.triangles; // Uint32Array (3 indices por triangle)

  // Filter triangles cuja média de área seja muito pequena (zero-area artifacts)
  // ou que cruzam buracos (olhos/boca). Pra MVP, deixar todos — visualmente
  // funcional pra rotações pequenas-médias.

  // 4. Build GLTF document (lazy ESM import)
  const { Document, NodeIO } = await getGltf();
  const doc = new Document();
  const buffer = doc.createBuffer();

  const posAccessor = doc.createAccessor()
    .setType('VEC3')
    .setArray(positions)
    .setBuffer(buffer);

  const uvAccessor = doc.createAccessor()
    .setType('VEC2')
    .setArray(uvs)
    .setBuffer(buffer);

  const idxAccessor = doc.createAccessor()
    .setType('SCALAR')
    .setArray(new Uint32Array(triangles))
    .setBuffer(buffer);

  // Texture (foto frontal JPEG)
  const texture = doc.createTexture()
    .setImage(frontalPhotoJpeg)
    .setMimeType('image/jpeg');

  const material = doc.createMaterial()
    .setBaseColorTexture(texture)
    .setMetallicFactor(0)
    .setRoughnessFactor(0.85);

  const primitive = doc.createPrimitive()
    .setAttribute('POSITION', posAccessor)
    .setAttribute('TEXCOORD_0', uvAccessor)
    .setIndices(idxAccessor)
    .setMaterial(material);

  const mesh = doc.createMesh().addPrimitive(primitive);
  const node = doc.createNode().setMesh(mesh);
  doc.createScene().addChild(node);

  // 5. Serialize → GLB binário
  const io = new NodeIO();
  const glb = await io.writeBinary(doc);

  return {
    glb: Buffer.from(glb),
    vertexCount: N,
    triangleCount: triangles.length / 3,
    processingMs: Date.now() - startMs,
    providerVersion: PROVIDER_VERSION,
  };
}

module.exports = {
  generateFaceMesh3D,
  PROVIDER_VERSION,
  sampleDepthBilinear,
};
