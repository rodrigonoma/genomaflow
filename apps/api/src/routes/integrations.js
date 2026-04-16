'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { Queue } = require('bullmq');
const { withTenant } = require('../db/tenant');
const { fetchAndParseSwagger, resolveFieldMap } = require('../services/swagger-parser');

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/uploads';

/** Download a file from URL and save to dest path. Returns promise. */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    protocol.get(url, res => {
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

/** Verify HMAC-SHA256 webhook signature. */
function verifySignature(secret, body, header) {
  if (!header) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    return false;
  }
}

module.exports = async function (fastify) {
  const examQueue = new Queue('exam-processing', { connection: fastify.redis });

  // ----- Swagger parse -----

  fastify.post('/swagger/parse', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { url } = request.body;
    if (!url) return reply.status(400).send({ error: 'url is required' });
    try {
      const { fields } = await fetchAndParseSwagger(url);
      return { fields };
    } catch (err) {
      return reply.status(422).send({ error: err.message });
    }
  });

  // ----- CRUD -----

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { name, mode, config = {}, field_map = {} } = request.body;

    if (!name) return reply.status(400).send({ error: 'name is required' });
    if (!['swagger', 'hl7', 'file_drop'].includes(mode))
      return reply.status(400).send({ error: 'mode must be swagger, hl7, or file_drop' });

    const fullConfig = mode === 'swagger'
      ? { ...config, webhook_secret: config.webhook_secret || crypto.randomBytes(32).toString('hex') }
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

    return reply.status(201).send(connector);
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
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

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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

  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const { name, config, field_map, status } = request.body;

    const connector = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE integration_connectors
         SET name = COALESCE($2, name),
             config = COALESCE($3::jsonb, config),
             field_map = COALESCE($4::jsonb, field_map),
             status = COALESCE($5, status),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, mode, field_map, status, last_sync_at, sync_count, error_msg, updated_at`,
        [id, name || null, config ? JSON.stringify(config) : null,
         field_map ? JSON.stringify(field_map) : null, status || null]
      );
      return rows[0] || null;
    });
    if (!connector) return reply.status(404).send({ error: 'Connector not found' });
    return connector;
  });

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    await withTenant(fastify.pg, tenant_id, async (client) => {
      await client.query('DELETE FROM integration_connectors WHERE id = $1', [id]);
    });
    return reply.status(204).send();
  });

  // ----- Test connection -----

  fastify.post('/:id/test', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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
        const { fields } = await fetchAndParseSwagger(swagger_url);
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
           VALUES ($1, $2, 'error', 'error', $3, $4)`,
          [id, tenant_id, err.message, duration_ms]
        );
      });
      return reply.status(422).send({ ok: false, error: err.message });
    }
  });

  // ----- Logs -----

  fastify.get('/:id/logs', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const limit = Math.min(Number(request.query.limit) || 50, 200);

    // First verify connector exists and belongs to tenant
    const connector = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id FROM integration_connectors WHERE id = $1`, [id]
      );
      return rows[0] || null;
    });
    if (!connector) return reply.status(404).send({ error: 'Connector not found' });

    const logs = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, event_type, status, records_in, records_out, error_detail, duration_ms, created_at
         FROM integration_logs
         WHERE connector_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [id, limit]
      );
      return rows;
    });
    return logs;
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

    // Verify HMAC
    const sig = request.headers['x-genomaflow-signature'];
    if (!verifySignature(connector.config.webhook_secret, request.body, sig)) {
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const start = Date.now();
    const { tenant_id, field_map } = connector;
    const payload = request.body;

    try {
      const mapped = resolveFieldMap(field_map, payload);
      let examId;

      await withTenant(fastify.pg, tenant_id, async (client) => {
        // Find admin user for uploaded_by
        const { rows: adminRows } = await client.query(
          `SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' LIMIT 1`, [tenant_id]
        );
        const uploadedBy = adminRows[0]?.id;

        // Find or create patient by name
        let patientId;
        const { rows: existing } = await client.query(
          `SELECT id FROM patients WHERE name = $1 LIMIT 1`, [mapped['patient.name']]
        );
        if (existing.length > 0) {
          patientId = existing[0].id;
        } else {
          const { rows: created } = await client.query(
            `INSERT INTO patients (tenant_id, name, birth_date, sex)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [tenant_id, mapped['patient.name'] || 'Desconhecido',
             mapped['patient.birth_date'] || null, mapped['patient.sex'] || null]
          );
          patientId = created[0].id;
        }

        // Download file if file_url provided
        let filePath = null;
        const fileUrl = mapped['exam.file_url'];
        if (fileUrl) {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
          const filename = `integration-${Date.now()}-${mapped['exam.external_id'] || id}.pdf`;
          filePath = path.join(UPLOADS_DIR, filename);
          await downloadFile(fileUrl, filePath);
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

      await examQueue.add('process-exam', { exam_id: examId, tenant_id, file_path: null });

      return reply.status(202).send({ ok: true });
    } catch (err) {
      fastify.log.error(err);
      const errClient = await fastify.pg.connect();
      try {
        await errClient.query(
          `INSERT INTO integration_logs (connector_id, tenant_id, event_type, status, error_detail, duration_ms)
           VALUES ($1, $2, 'error', 'error', $3, $4)`,
          [id, tenant_id, err.message, Date.now() - start]
        );
      } finally {
        errClient.release();
      }
      throw err;
    }
  });
};
