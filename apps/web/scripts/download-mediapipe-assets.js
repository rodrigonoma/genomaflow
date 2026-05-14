#!/usr/bin/env node
/**
 * Baixa WASM + modelos do MediaPipe pra hosting próprio em public/mediapipe/.
 *
 * Motivação: usar CDNs públicos (cdn.jsdelivr.net, storage.googleapis.com)
 * deixa o app vulnerável a:
 * - Brave Shields + uBlock Origin bloqueando como "third-party tracking"
 * - Corporate firewalls bloqueando CDNs externos
 * - CDN outages
 *
 * Self-hosting elimina cross-origin → carrega sempre.
 *
 * Rodado via npm postinstall ANTES de ng build (em dev local e Docker build CI).
 * Idempotente: skip se arquivos já existem com tamanho ok.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const TARGET_DIR = path.join(__dirname, '..', 'public', 'mediapipe');
const WASM_DIR = path.join(TARGET_DIR, 'wasm');

// Lê a versão exata do node_modules pra alinhar WASM com o package npm.
// Fallback pra package.json caso node_modules não esteja populado ainda
// (ex: primeira execução durante npm install).
function _resolveVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-vision', 'package.json');
    return require(pkgPath).version;
  } catch (_) {
    const wsPkg = require(path.join(__dirname, '..', 'package.json'));
    const declared = wsPkg.dependencies?.['@mediapipe/tasks-vision']
      || wsPkg.devDependencies?.['@mediapipe/tasks-vision']
      || '';
    return declared.replace(/^[\^~]/, '') || '0.10.35';
  }
}
const VERSION = _resolveVersion();
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

const MODELS = [
  {
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    dest: path.join(TARGET_DIR, 'face_landmarker.task'),
    minSize: 1_000_000,  // ≥1MB sanity
  },
  {
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    dest: path.join(TARGET_DIR, 'pose_landmarker_lite.task'),
    minSize: 1_000_000,
  },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp`;
    const file = fs.createWriteStream(tmp);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(tmp);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(tmp);
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(tmp, dest);
          resolve();
        });
      });
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(tmp); } catch (_) {}
      reject(err);
    });
  });
}

function isCached(dest, minSize = 1) {
  try {
    const stat = fs.statSync(dest);
    return stat.size >= minSize;
  } catch (_) {
    return false;
  }
}

(async () => {
  console.log(`[mediapipe-assets] version=${VERSION} target=${TARGET_DIR}`);
  fs.mkdirSync(WASM_DIR, { recursive: true });

  // WASM (4 arquivos)
  for (const f of WASM_FILES) {
    const dest = path.join(WASM_DIR, f);
    if (isCached(dest, 10_000)) {
      console.log(`  ✓ cached: wasm/${f}`);
      continue;
    }
    process.stdout.write(`  ↓ downloading: wasm/${f}...`);
    try {
      await download(`${WASM_BASE}/${f}`, dest);
      const sz = fs.statSync(dest).size;
      console.log(` ok (${(sz / 1024).toFixed(0)}KB)`);
    } catch (err) {
      console.log(` FAIL: ${err.message}`);
      process.exit(1);
    }
  }

  // Modelos (2 arquivos)
  for (const m of MODELS) {
    const name = path.basename(m.dest);
    if (isCached(m.dest, m.minSize)) {
      console.log(`  ✓ cached: ${name}`);
      continue;
    }
    process.stdout.write(`  ↓ downloading: ${name}...`);
    try {
      await download(m.url, m.dest);
      const sz = fs.statSync(m.dest).size;
      console.log(` ok (${(sz / 1024 / 1024).toFixed(1)}MB)`);
    } catch (err) {
      console.log(` FAIL: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('[mediapipe-assets] done.');
})();
