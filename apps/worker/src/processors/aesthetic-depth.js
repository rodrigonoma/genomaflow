'use strict';

/**
 * Processor de depth model generation (V2 Fase 3 F3.1 heightmap MVP).
 *
 * Pipeline:
 *  1. Marca status processing
 *  2. Fetch foto frontal (advanced tier sempre tem pose='frontal')
 *  3. Download S3 → buffer
 *  4. depth-anything generateDepthMap (mock por enquanto, ONNX real em F3.1-B.2)
 *  5. Upload PNG depth ao S3 (aesthetic-depth/{tenant}/{analysis}.png)
 *  6. Marca status done com s3_keys + metadata
 *  7. Redis publish aesthetic:event:{tenant} { kind: 'depth_ready' }
 *
 * Falha → marca status error com error_code. Sem retry automático (depth é caro).
 * Spec: docs/superpowers/specs/2026-05-13-aesthetic-v2-fase3-design.md §7.4
 */

const { Pool } = require('pg');
const Redis = require('ioredis');
const { downloadFile, uploadFile } = require('../storage/s3');
const { generateDepthMap, PROVIDER_VERSION } = require('../lib/depth-anything');

// Worker e API são containers ECS separados — não compartilham filesystem.
// Funções de UPDATE direto via pg client (mesma estratégia do processor
// aesthetic-analysis.js). Tenant context via set_config no início.

async function markProcessing(client, depthId) {
  await client.query(
    `UPDATE aesthetic_depth_models SET status = 'processing' WHERE id = $1`,
    [depthId]
  );
}

async function markDone(client, depthId, fields) {
  await client.query(
    `UPDATE aesthetic_depth_models
        SET status = 'done',
            s3_key_depth = $2,
            s3_key_glb = $3,
            s3_key_texture = $4,
            provider_version = $5,
            metadata = $6::jsonb,
            completed_at = NOW()
      WHERE id = $1`,
    [
      depthId,
      fields.s3KeyDepth || null,
      fields.s3KeyGlb || null,
      fields.s3KeyTexture || null,
      fields.providerVersion || null,
      fields.metadata ? JSON.stringify(fields.metadata) : null,
    ]
  );
}

async function markError(client, depthId, { errorCode, errorMessage }) {
  await client.query(
    `UPDATE aesthetic_depth_models
        SET status = 'error',
            error_code = $2,
            error_message = $3,
            completed_at = NOW()
      WHERE id = $1`,
    [depthId, errorCode || 'UNKNOWN', String(errorMessage || '').slice(0, 500)]
  );
}

const _pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

let _publisher;
function publisher() {
  if (!_publisher) {
    _publisher = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return _publisher;
}

const S3_DEPTH_PREFIX = 'aesthetic-depth';

async function processDepthGeneration({ pool, data } = {}) {
  pool = pool || _pool;
  const { depth_id, tenant_id, analysis_id, model_type } = data;

  const client = await pool.connect();
  let stage = 'init';

  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant_id]);

    stage = 'mark_processing';
    await markProcessing(client, depth_id);

    // V2 Fase 3.2-A: Fetch TODAS as fotos com pose declarada da análise
    // (advanced sempre tem 5 facial: frontal/profile_L/profile_R/45_L/45_R).
    // Frontend ganha dropdown pra trocar entre as 5 vistas heightmap.
    stage = 'fetch_photos';
    const { rows: photos } = await client.query(
      `SELECT p.id, p.s3_key, p.pose
         FROM aesthetic_photos p
         JOIN aesthetic_analyses a ON a.id = $1
        WHERE p.id = ANY(a.photo_ids)
          AND p.tenant_id = $2
          AND p.pose IS NOT NULL
          AND p.deleted_at IS NULL
        ORDER BY
          CASE p.pose
            WHEN 'frontal' THEN 0
            WHEN 'profile_left' THEN 1
            WHEN 'profile_right' THEN 2
            WHEN '45_left' THEN 3
            WHEN '45_right' THEN 4
            ELSE 99
          END`,
      [analysis_id, tenant_id]
    );

    const frontalPhoto = photos.find(p => p.pose === 'frontal');
    if (!frontalPhoto) {
      throw Object.assign(new Error('No frontal photo found for analysis'), { code: 'NO_FRONTAL_PHOTO' });
    }

    // Gera depth pra cada pose presente. Multi-view por enquanto não funde
    // os depths em mesh — apenas gera N PNGs separados pra UI trocar vista.
    // F3.2-B vai fazer o mesh GLTF real fundindo os 5 via landmarks.
    stage = 'generate_depths';
    const posesDepths = {};      // pose → s3_key
    const posesTextures = {};    // pose → photo.s3_key
    const posesProcessingMs = {};
    let providerVersionFinal;
    let lastWidth, lastHeight;

    for (const photo of photos) {
      const buf = await downloadFile(photo.s3_key);
      const r = await generateDepthMap(buf);
      const poseSafe = photo.pose.replace(/[^a-z0-9_-]/gi, '_');
      const s3Key = `${S3_DEPTH_PREFIX}/${tenant_id}/${analysis_id}/${poseSafe}.png`;
      await uploadFile(s3Key, r.depthPng, 'image/png');
      posesDepths[photo.pose] = s3Key;
      posesTextures[photo.pose] = photo.s3_key;
      posesProcessingMs[photo.pose] = r.processingMs;
      providerVersionFinal = r.providerVersion;
      lastWidth = r.width;
      lastHeight = r.height;
    }

    // Chave canônica do depth da frontal mantida pra backward compat
    const s3KeyDepth = posesDepths.frontal;

    stage = 'mark_done';
    await markDone(client, depth_id, {
      s3KeyDepth,
      s3KeyGlb: null,                       // F3.2-B virá com mesh GLTF real
      s3KeyTexture: frontalPhoto.s3_key,    // foto frontal vira textura default
      providerVersion: providerVersionFinal || PROVIDER_VERSION,
      metadata: {
        photo_used: frontalPhoto.id,
        processing_ms: Object.values(posesProcessingMs).reduce((a, b) => a + b, 0),
        depth_resolution: `${lastWidth}x${lastHeight}`,
        model_type,
        // V2 Fase 3.2-A multi-view: maps pra UI trocar vista
        poses_depths: posesDepths,
        poses_textures: posesTextures,
        poses_processing_ms: posesProcessingMs,
        poses_count: photos.length,
      },
    });

    stage = 'notify';
    publisher().publish(`aesthetic:event:${tenant_id}`, JSON.stringify({
      kind: 'depth_ready',
      depth_id,
      analysis_id,
    }));

    console.log(`[aesthetic-depth][${depth_id}] done (processing_ms=${processingMs})`);
  } catch (err) {
    const errorCode = err.code || 'UNKNOWN';
    console.error(`[aesthetic-depth][${depth_id}] error stage=${stage} code=${errorCode}: ${err.message}`);

    try {
      await markError(client, depth_id, {
        errorCode,
        errorMessage: err.message,
      });
      publisher().publish(`aesthetic:event:${tenant_id}`, JSON.stringify({
        kind: 'depth_failed',
        depth_id,
        analysis_id,
        error_code: errorCode,
      }));
    } catch (e2) {
      console.error(`[aesthetic-depth][${depth_id}] error persist falhou: ${e2.message}`);
    }
    // Não re-throw: depth é best-effort, evita BullMQ retry infinito
  } finally {
    client.release();
  }
}

module.exports = { processDepthGeneration };
