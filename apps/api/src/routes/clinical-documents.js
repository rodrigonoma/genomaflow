'use strict';

/**
 * Documentos clínicos — atestado, pedido_exame, encaminhamento, relatorio,
 * termo_consentimento. Templates por tenant. Multi-módulo (humano + vet).
 *
 * Endpoints (todos preHandler: [fastify.authenticate]):
 *   GET    /clinical-documents/templates?doc_type=    lista templates ativos do tenant
 *   POST   /clinical-documents/templates              cria template
 *   PUT    /clinical-documents/templates/:id          edita template
 *   DELETE /clinical-documents/templates/:id          remove template (soft via active=false não — hard delete; UI confirma)
 *
 *   GET    /clinical-documents?subject_id=&doc_type= lista documentos do paciente
 *   POST   /clinical-documents                       emite documento (a partir de template ou ad-hoc)
 *   GET    /clinical-documents/:id                   detalhe
 *   PATCH  /clinical-documents/:id                   atualiza (24h se não signed)
 *   POST   /clinical-documents/:id/sign              vira imutável
 *   POST   /clinical-documents/:id/upload-pdf        anexa S3 key do PDF gerado
 */

const { withTenant } = require('../db/tenant');

const VALID_DOC_TYPES = ['atestado', 'pedido_exame', 'encaminhamento', 'relatorio', 'termo_consentimento'];
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// ── Validators ────────────────────────────────────────────────────────────

function validateTemplateBody(body, isUpdate = false) {
  if (!body || typeof body !== 'object') return 'body inválido';
  if (!isUpdate) {
    if (!body.doc_type) return 'doc_type obrigatório';
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) return 'name obrigatório';
    if (!body.body || typeof body.body !== 'string') return 'body obrigatório';
  }
  if (body.doc_type && !VALID_DOC_TYPES.includes(body.doc_type)) {
    return `doc_type inválido (use: ${VALID_DOC_TYPES.join(', ')})`;
  }
  if (body.name && body.name.length > 200) return 'name excede 200 chars';
  if (body.body && body.body.length > 50000) return 'body excede 50.000 chars';
  return null;
}

function validateDocumentBody(body, isUpdate = false) {
  if (!body || typeof body !== 'object') return 'body inválido';
  if (!isUpdate) {
    if (!body.subject_id) return 'subject_id obrigatório';
    if (!body.doc_type) return 'doc_type obrigatório';
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) return 'title obrigatório';
    if (!body.body || typeof body.body !== 'string') return 'body obrigatório';
  }
  if (body.doc_type && !VALID_DOC_TYPES.includes(body.doc_type)) {
    return `doc_type inválido (use: ${VALID_DOC_TYPES.join(', ')})`;
  }
  if (body.title && body.title.length > 300) return 'title excede 300 chars';
  if (body.body && body.body.length > 100000) return 'body excede 100.000 chars';
  return null;
}

// ── Module ────────────────────────────────────────────────────────────────

module.exports = async function (fastify) {

  // ─── Templates ───────────────────────────────────────────────────────

  fastify.get('/templates', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    const { doc_type } = request.query || {};
    let sql = `
      SELECT id, doc_type, name, body, active, created_by, created_at, updated_at
      FROM clinical_document_templates
      WHERE tenant_id = $1 AND active = TRUE
    `;
    const params = [tenant_id];
    if (doc_type && VALID_DOC_TYPES.includes(doc_type)) {
      sql += ` AND doc_type = $2`;
      params.push(doc_type);
    }
    sql += ` ORDER BY doc_type, name`;
    const { rows } = await fastify.pg.query(sql, params);
    return { items: rows };
  });

  fastify.post('/templates', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, role } = request.user;
    if (role !== 'admin' && role !== 'master') return reply.status(403).send({ error: 'Apenas admin' });
    const err = validateTemplateBody(request.body || {}, false);
    if (err) return reply.status(400).send({ error: err });
    const { doc_type, name, body } = request.body;

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO clinical_document_templates (tenant_id, doc_type, name, body, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [tenant_id, doc_type, name.trim(), body, user_id]
      );
      return rows[0];
    }, { userId: user_id, channel: 'ui' });
    return reply.status(201).send(result);
  });

  fastify.put('/templates/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, role } = request.user;
    if (role !== 'admin' && role !== 'master') return reply.status(403).send({ error: 'Apenas admin' });
    const { id } = request.params;
    const err = validateTemplateBody(request.body || {}, true);
    if (err) return reply.status(400).send({ error: err });
    const body = request.body;

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE clinical_document_templates SET
           doc_type = COALESCE($1, doc_type),
           name     = COALESCE($2, name),
           body     = COALESCE($3, body),
           active   = COALESCE($4, active)
         WHERE id = $5 AND tenant_id = $6
         RETURNING *`,
        [body.doc_type ?? null, body.name?.trim() ?? null, body.body ?? null,
         body.active ?? null, id, tenant_id]
      );
      return rows[0] || null;
    }, { userId: user_id, channel: 'ui' });
    if (!result) return reply.status(404).send({ error: 'template not found' });
    return result;
  });

  fastify.delete('/templates/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id, role } = request.user;
    if (role !== 'admin' && role !== 'master') return reply.status(403).send({ error: 'Apenas admin' });
    const { id } = request.params;

    const deleted = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `DELETE FROM clinical_document_templates WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenant_id]
      );
      return rows[0] || null;
    }, { userId: user_id, channel: 'ui' });
    if (!deleted) return reply.status(404).send({ error: 'template not found' });
    return reply.status(204).send();
  });

  // ─── Documents ───────────────────────────────────────────────────────

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { subject_id, doc_type } = request.query || {};
    if (!subject_id || typeof subject_id !== 'string') {
      return reply.status(400).send({ error: 'subject_id obrigatório' });
    }

    let sql = `
      SELECT d.id, d.doc_type, d.title, d.encounter_id, d.template_id,
             d.pdf_s3_key, d.signed_at, d.created_at, d.updated_at,
             d.professional_user_id,
             u.email AS professional_email
      FROM clinical_documents d
      LEFT JOIN users u ON u.id = d.professional_user_id
      WHERE d.tenant_id = $1 AND d.subject_id = $2
    `;
    const params = [tenant_id, subject_id];
    if (doc_type && VALID_DOC_TYPES.includes(doc_type)) {
      sql += ` AND d.doc_type = $3`;
      params.push(doc_type);
    }
    sql += ` ORDER BY d.created_at DESC LIMIT 200`;
    const { rows } = await fastify.pg.query(sql, params);
    return { items: rows };
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `SELECT d.*, u.email AS professional_email
       FROM clinical_documents d
       LEFT JOIN users u ON u.id = d.professional_user_id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [id, tenant_id]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'document not found' });
    return rows[0];
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const err = validateDocumentBody(request.body || {}, false);
    if (err) return reply.status(400).send({ error: err });
    const body = request.body;

    try {
      const result = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows: subRows } = await client.query(
          `SELECT id FROM subjects WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          [body.subject_id, tenant_id]
        );
        if (subRows.length === 0) {
          const e = new Error('subject_invalid'); e.code = 'SUBJECT_INVALID'; throw e;
        }

        if (body.encounter_id) {
          const { rows: encRows } = await client.query(
            `SELECT id FROM clinical_encounters WHERE id = $1 AND tenant_id = $2`,
            [body.encounter_id, tenant_id]
          );
          if (encRows.length === 0) {
            const e = new Error('encounter_invalid'); e.code = 'ENCOUNTER_INVALID'; throw e;
          }
        }

        if (body.template_id) {
          const { rows: tmpRows } = await client.query(
            `SELECT id FROM clinical_document_templates WHERE id = $1 AND tenant_id = $2`,
            [body.template_id, tenant_id]
          );
          if (tmpRows.length === 0) {
            const e = new Error('template_invalid'); e.code = 'TEMPLATE_INVALID'; throw e;
          }
        }

        const { rows } = await client.query(
          `INSERT INTO clinical_documents (
             tenant_id, subject_id, professional_user_id, encounter_id,
             doc_type, title, body, template_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [
            tenant_id, body.subject_id, user_id, body.encounter_id || null,
            body.doc_type, body.title.trim(), body.body, body.template_id || null,
          ]
        );
        return rows[0];
      }, { userId: user_id, channel: 'ui' });
      return reply.status(201).send(result);
    } catch (err) {
      if (err.code === 'SUBJECT_INVALID') return reply.status(400).send({ error: 'subject_id inválido' });
      if (err.code === 'ENCOUNTER_INVALID') return reply.status(400).send({ error: 'encounter_id inválido' });
      if (err.code === 'TEMPLATE_INVALID') return reply.status(400).send({ error: 'template_id inválido' });
      throw err;
    }
  });

  fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;
    const err = validateDocumentBody(request.body || {}, true);
    if (err) return reply.status(400).send({ error: err });
    const body = request.body;

    try {
      const result = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows: existing } = await client.query(
          `SELECT id, professional_user_id, signed_at, created_at
           FROM clinical_documents WHERE id = $1 AND tenant_id = $2`,
          [id, tenant_id]
        );
        if (existing.length === 0) {
          const e = new Error('not_found'); e.code = 'NOT_FOUND'; throw e;
        }
        const doc = existing[0];
        if (doc.signed_at) {
          const e = new Error('signed'); e.code = 'SIGNED'; throw e;
        }
        if (doc.professional_user_id !== user_id) {
          const e = new Error('forbidden'); e.code = 'FORBIDDEN'; throw e;
        }
        const ageMs = Date.now() - new Date(doc.created_at).getTime();
        if (ageMs > EDIT_WINDOW_MS) {
          const e = new Error('window'); e.code = 'WINDOW'; throw e;
        }

        const setParts = [];
        const values = [];
        let i = 1;
        for (const f of ['doc_type', 'title', 'body']) {
          if (body[f] !== undefined) {
            setParts.push(`${f} = $${i++}`);
            values.push(body[f]);
          }
        }
        if (setParts.length === 0) return doc;
        values.push(id, tenant_id);
        const { rows } = await client.query(
          `UPDATE clinical_documents SET ${setParts.join(', ')}
           WHERE id = $${i++} AND tenant_id = $${i++} RETURNING *`,
          values
        );
        return rows[0];
      }, { userId: user_id, channel: 'ui' });
      return result;
    } catch (err) {
      if (err.code === 'NOT_FOUND') return reply.status(404).send({ error: 'document not found' });
      if (err.code === 'SIGNED') return reply.status(409).send({ error: 'documento assinado é imutável' });
      if (err.code === 'FORBIDDEN') return reply.status(403).send({ error: 'apenas o autor pode editar' });
      if (err.code === 'WINDOW') return reply.status(409).send({ error: 'janela de edição expirou (24h)' });
      throw err;
    }
  });

  fastify.post('/:id/sign', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;

    try {
      const result = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows: existing } = await client.query(
          `SELECT id, professional_user_id, signed_at FROM clinical_documents
           WHERE id = $1 AND tenant_id = $2`, [id, tenant_id]
        );
        if (existing.length === 0) { const e = new Error('not_found'); e.code = 'NOT_FOUND'; throw e; }
        if (existing[0].signed_at) { const e = new Error('signed'); e.code = 'ALREADY'; throw e; }
        if (existing[0].professional_user_id !== user_id) {
          const e = new Error('forbidden'); e.code = 'FORBIDDEN'; throw e;
        }
        const { rows } = await client.query(
          `UPDATE clinical_documents SET signed_at = NOW(), signed_by_user_id = $1
           WHERE id = $2 AND tenant_id = $3 RETURNING *`,
          [user_id, id, tenant_id]
        );
        return rows[0];
      }, { userId: user_id, channel: 'ui' });
      return result;
    } catch (err) {
      if (err.code === 'NOT_FOUND') return reply.status(404).send({ error: 'document not found' });
      if (err.code === 'ALREADY') return reply.status(409).send({ error: 'já assinado' });
      if (err.code === 'FORBIDDEN') return reply.status(403).send({ error: 'apenas o autor pode assinar' });
      throw err;
    }
  });

  fastify.post('/:id/upload-pdf', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, user_id } = request.user;
    const { id } = request.params;
    const { s3_key } = request.body || {};
    if (!s3_key || typeof s3_key !== 'string' || !s3_key.startsWith('clinical-documents/')) {
      return reply.status(400).send({ error: 's3_key inválido (deve começar com clinical-documents/)' });
    }

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `UPDATE clinical_documents SET pdf_s3_key = $1
         WHERE id = $2 AND tenant_id = $3 RETURNING id, pdf_s3_key`,
        [s3_key, id, tenant_id]
      );
      return rows[0] || null;
    }, { userId: user_id, channel: 'ui' });
    if (!result) return reply.status(404).send({ error: 'document not found' });
    return result;
  });
};
