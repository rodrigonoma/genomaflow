'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { Queue } = require('bullmq');
const { withTenant } = require('../db/tenant');
const { assertSafeUrl, fetchAndParseSwagger, resolveFieldMap } = require('../services/swagger-parser');

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/uploads';
const DOWNLOAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024; // 50 MB cap
const INGEST_MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB cap on raw body buffering
const EXTERNAL_ID_SAFE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Download a file from URL and save to dest path.
 * Validates URL is safe (SSRF), rejects non-2xx responses,
 * enforces a size cap, and times out after DOWNLOAD_TIMEOUT_MS.
 */
function downloadFile(url, dest) {
  assertSafeUrl(url); // SSRF guard — throws on private/loopback addresses
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const req = protocol.get(url, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        file.destroy();
        fs.unlink(dest, () => {});
        return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
      }
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        if (received > DOWNLOAD_MAX_BYTES) {
          req.destroy();
          file.destroy();
          fs.unlink(dest, () => {});
          reject(new Error('Downloaded file exceeds size limit'));
        }
      });
      res.on('error', err => {
        file.destroy();
        fs.unlink(dest, () => {});
        reject(err);
      });
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', err => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy();
      fs.unlink(dest, () => {});
      reject(new Error('File download timed out'));
    });
    req.on('error', err => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

/** Verify HMAC-SHA256 webhook signature over raw body bytes. */
function verifySignature(secret, rawBody, header) {
  if (!header) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(header),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

/** Admin-only guard — must be used after fastify.authenticate. */
async function adminGuard(request, reply) {
  if (request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}

module.exports = async function (fastify) {
  const examQueue = new Queue('exam-processing', { connection: fastify.redis });

  // Capture raw body ONLY for the webhook ingest route (POST /:id/ingest).
  // Gated by URL suffix and method to avoid buffering GET/DELETE/etc. into memory.
  // Also enforces a 1 MB size cap to prevent memory DoS.
  fastify.addHook('preParsing', (request, reply, payload, done) => {
    if (request.method !== 'POST' || !request.url.endsWith('/ingest')) {
      return done(null, payload);
    }
    const { Readable } = require('stream');
    const chunks = [];
    let totalBytes = 0;
    payload.on('data', chunk => {
      totalBytes += chunk.length;
      if (totalBytes > INGEST_MAX_BODY_BYTES) {
        payload.destroy(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    payload.on('end', () => {
      const buf = Buffer.concat(chunks);
      request.rawBody = buf.toString('utf8');
      const newPayload = Readable.from(buf);
      newPayload.headers = payload.headers;
      done(null, newPayload);
    });
    payload.on('error', done);
  });

  // ----- Swagger parse -----

  fastify.post('/swagger/parse', { preHandler: [fastify.authenticate, adminGuard] }, async (request, reply) => {
    const { url, auth_type, auth_value } = request.body;
    if (!url) return reply.status(400).send({ error: 'url is required' });
    try {
      const { fields } = await fetchAndParseSwagger(url, { authType: auth_type, authValue: auth_value });
      return { fields };
    } catch (err) {
      return reply.status(422).send({ error: err.message });
    }
  });

  // ----- CRUD -----

  fastify.post('/', { preHandler: [fastify.authenticate, adminGuard] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { name, mode, config = {}, field_map = {} } = request.body;

    if (!name) return reply.status(400).send({ error: 'name is required' });
    if (!['swagger', 'hl7', 'file_drop'].includes(mode))
      return reply.status(400).send({ error: 'mode must be swagger, hl7, or file_drop' });

    const webhookSecret = crypto.randomBytes(32).toString('hex');
    const fullConfig = mode === 'swagger'
      ? { ...config, webhook_secret: config.webhook_secret || webhookSecret }
      : config;

    const connector = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO integration_connectors (tenant_id, name, mode, config, field_map)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, mode, field_map, status, sync_count, last_sync_at, error_msg, created_at, updated_at`,
        [tenant_id, name, mode, JSON.stringify(fullConfig), JSON.stringify(field_map)]
      );
      return rows[0];
    });

    // Return webhook_secret once on creation so the admin can configure their HIS
    return reply.status(201).send({ ...connector, webhook_secret: fullConfig.webhook_secret });
  });

  fastify.get('/', { preHandler: [fastify.authenticate, adminGuard] }, async (request) => {
    const { tenant_id } = request.user;
    return withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, mode, field_map, status, last_sync_at, sync_count, error_msg, created_at, updated_at
         FROM integration_connectors
         ORDER BY created_at DESC`
      );
      return rows;
    });
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate, adminGuard] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const connector = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, mode, field_map, status, last_sync_at, sync_count, error_msg, created_at, updated_at
         FROM integration_connectors WHERE id = $1`,
        [id]
      );
      return rows[0] || null;
    });
    if (!connector) return reply.status(404).send({ error: 'Connector not found' });
    return connector;
  });

  fastify.put('/:id', { preHandler: [fastify.authenticate, adminGuard] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const { name, config, field_map, status } = request.body;

    if (status !== undefined && !['active', 'inactive', 'error'].includes(status))
      return reply.status(400).send({ error: 'status must be active, inactive, or error' });

    const connector = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE integration_connectors
         SET name      = COALESCE($2, name),
             config    = COALESCE($3::jsonb, config),
             field_map = COALESCE($4::jsonb, field_map),
             status    = COALESCE($5, status),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, mode, field_map, status, last_sync_at, sync_count, error_msg, updated_at`,
        [
          id,
          name !== undefined ? name : null,
          config !== undefined ? JSON.stringify(config) : null,
          field_map !== undefined ? JSON.stringify(field_map) : null,
          status !== undefined ? status : null
        ]
      );
      return rows[0] || null;
    });
    if (!connector) return reply.status(404).send({ error: 'Connector not found' });
    return connector;
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate, adminGuard] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    await withTenant(fastify.pg, tenant_id, async (client) => {
      await client.query('DELETE FROM integration_connectors WHERE id = $1', [id]);
    });
    return reply.status(204).send();
  });

  // ----- Test connection -----

  fastify.post('/:id/test', { preHandler: [fastify.authenticate, adminGuard] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const start = Date.now();

    const connector = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, mode, config FROM integration_connectors WHERE id = $1`, [id]
      );
      return rows[0] || null;
    });
    if (!connector) return reply.status(404).send({ error: 'Connector not found' });

    try {
      if (connector.mode === 'swagger') {
        const { swagger_url } = connector.config;
        if (!swagger_url) return reply.status(422).send({ error: 'swagger_url not configured' });
        const { fields } = await fetchAndParseSwagger(swagger_url, {
          authType: connector.config.auth_type,
          authValue: connector.config.auth_value
        });
        const duration_ms = Date.now() - start;
        await withTenant(fastify.pg, tenant_id, async (client) => {
          await client.query(
            `INSERT INTO integration_logs (connector_id, tenant_id, event_type, status, duration_ms)
             VALUES ($1, $2, 'test', 'success', $3)`,
            [id, tenant_id, duration_ms]
          );
        });
        return { ok: true, fields_discovered: fields.length, duration_ms };
      }
      return reply.status(422).send({ error: `Test not supported for mode: ${connector.mode}` });
    } catch (err) {
      const duration_ms = Date.now() - start;
      await withTenant(fastify.pg, tenant_id, async (client) => {
        await client.query(
          `INSERT INTO integration_logs (connector_id, tenant_id, event_type, status, error_detail, duration_ms)
           VALUES ($1, $2, 'test', 'error', $3, $4)`,
          [id, tenant_id, err.message, duration_ms]
        );
      });
      return reply.status(422).send({ ok: false, error: err.message });
    }
  });

  // ----- Logs -----

  fastify.get('/:id/logs', { preHandler: [fastify.authenticate, adminGuard] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const limit = Math.min(Number(request.query.limit) || 50, 200);

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT l.id, l.event_type, l.status, l.records_in, l.records_out,
                l.error_detail, l.duration_ms, l.created_at
         FROM integration_connectors c
         JOIN integration_logs l ON l.connector_id = c.id
         WHERE c.id = $1
         ORDER BY l.created_at DESC
         LIMIT $2`,
        [id, limit]
      );
      const { rows: connRows } = await client.query(
        `SELECT id FROM integration_connectors WHERE id = $1`, [id]
      );
      return { logs: rows, exists: connRows.length > 0 };
    });

    if (!result.exists) return reply.status(404).send({ error: 'Connector not found' });
    return result.logs;
  });

  // ----- Webhook inbound (no JWT — HMAC only) -----

  fastify.post('/:id/ingest', async (request, reply) => {
    const { id } = request.params;

    // Fetch connector without tenant context (we validate via HMAC)
    const pgClient = await fastify.pg.connect();
    let connector;
    try {
      const { rows } = await pgClient.query(
        `SELECT id, tenant_id, mode, config, field_map, status FROM integration_connectors WHERE id = $1`,
        [id]
      );
      connector = rows[0];
    } finally {
      pgClient.release();
    }

    if (!connector) return reply.status(404).send({ error: 'Connector not found' });
    if (connector.status !== 'active') return reply.status(403).send({ error: 'Connector is not active' });
    if (connector.mode !== 'swagger') return reply.status(400).send({ error: 'Ingest only supported for swagger mode' });

    // Verify HMAC over raw request body bytes
    const sig = request.headers['x-genomaflow-signature'];
    const rawBody = request.rawBody ?? '';
    if (!verifySignature(connector.config.webhook_secret, rawBody, sig)) {
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const start = Date.now();
    const { tenant_id, field_map } = connector;
    const payload = request.body;
    const mapped = resolveFieldMap(field_map, payload);

    // Sanitize external_id to prevent path traversal in filename
    const rawExternalId = mapped['exam.external_id'];
    const safeExternalId = rawExternalId && EXTERNAL_ID_SAFE.test(String(rawExternalId))
      ? String(rawExternalId)
      : id;

    // Download file BEFORE opening the DB transaction (avoids holding connection during I/O)
    // assertSafeUrl is called inside downloadFile — SSRF-safe
    let filePath = null;
    const fileUrl = mapped['exam.file_url'];
    if (fileUrl) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      const filename = `integration-${Date.now()}-${safeExternalId}.pdf`;
      filePath = path.join(UPLOADS_DIR, filename);
      try {
        await downloadFile(fileUrl, filePath);
      } catch (err) {
        filePath = null; // Continue without file; worker will handle missing file
        fastify.log.warn({ err, connector_id: id }, 'Failed to download exam file');
      }
    }

    try {
      let examId;
      await withTenant(fastify.pg, tenant_id, async (client) => {
        // Find admin user for uploaded_by
        const { rows: adminRows } = await client.query(
          `SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' LIMIT 1`, [tenant_id]
        );
        const uploadedBy = adminRows[0]?.id;

        // Find or create patient — match on name + birth_date when available
        let patientId;
        const patientName = mapped['patient.name'] || 'Desconhecido';
        const birthDate = mapped['patient.birth_date'] || null;
        const { rows: existing } = await client.query(
          `SELECT id FROM patients
           WHERE name = $1 AND (birth_date = $2 OR ($2 IS NULL AND birth_date IS NULL))
           LIMIT 1`,
          [patientName, birthDate]
        );
        if (existing.length > 0) {
          patientId = existing[0].id;
        } else {
          const { rows: created } = await client.query(
            `INSERT INTO patients (tenant_id, name, birth_date, sex)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [tenant_id, patientName, birthDate, mapped['patient.sex'] || null]
          );
          patientId = created[0].id;
        }

        const { rows: examRows } = await client.query(
          `INSERT INTO exams (tenant_id, patient_id, uploaded_by, file_path, raw_data, status, source)
           VALUES ($1, $2, $3, $4, $5, 'pending', 'integration')
           RETURNING id`,
          [tenant_id, patientId, uploadedBy, filePath, JSON.stringify(payload)]
        );
        examId = examRows[0].id;

        await client.query(
          `INSERT INTO integration_logs (connector_id, tenant_id, event_type, status, records_in, records_out, duration_ms)
           VALUES ($1, $2, 'ingest', 'success', 1, 1, $3)`,
          [id, tenant_id, Date.now() - start]
        );

        await client.query(
          `UPDATE integration_connectors SET sync_count = sync_count + 1, last_sync_at = NOW() WHERE id = $1`,
          [id]
        );
      });

      // Enqueue AFTER commit so a transaction rollback never leaves a zombie job.
      // If the server crashes between commit and this line, the exam stays 'pending'
      // and can be re-queued by a recovery cron.
      await examQueue.add('process-exam', { exam_id: examId, tenant_id, file_path: filePath });

      return reply.status(202).send({ ok: true });
    } catch (err) {
      fastify.log.error(err);
      // Log error inside withTenant so RLS policy on integration_logs is satisfied
      await withTenant(fastify.pg, tenant_id, async (client) => {
        await client.query(
          `INSERT INTO integration_logs (connector_id, tenant_id, event_type, status, error_detail, duration_ms)
           VALUES ($1, $2, 'ingest', 'error', $3, $4)`,
          [id, tenant_id, err.message, Date.now() - start]
        );
      });
      throw err;
    }
  });
};
