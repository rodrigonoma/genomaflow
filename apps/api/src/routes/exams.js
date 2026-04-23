const { Queue } = require('bullmq');
const { withTenant } = require('../db/tenant');
const { uploadFile } = require('../storage/s3');

module.exports = async function (fastify) {
  const examQueue = new Queue('exam-processing', { connection: fastify.redis });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const parts = request.parts();

    let subject_id = null;
    let fileData = null;
    let selected_agents = null;
    let chief_complaint = '';
    let current_symptoms = '';

    // Collect ALL parts before processing (field order may vary)
    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'patient_id') {
        subject_id = part.value;
      } else if (part.type === 'field' && part.fieldname === 'selected_agents') {
        try {
          const parsed = JSON.parse(part.value);
          if (Array.isArray(parsed)) selected_agents = parsed;
        } catch (_) {}
      } else if (part.type === 'field' && part.fieldname === 'chief_complaint') {
        chief_complaint = part.value || '';
      } else if (part.type === 'field' && part.fieldname === 'current_symptoms') {
        current_symptoms = part.value || '';
      } else if (part.type === 'file' && part.fieldname === 'file') {
        fileData = part;
        // Must consume the stream to avoid hanging
        const chunks = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileData._buffer = Buffer.concat(chunks);
      }
    }

    if (!subject_id) return reply.status(400).send({ error: 'patient_id is required' });
    if (!fileData) return reply.status(400).send({ error: 'file is required' });

    const fileExt  = (fileData.filename || '').toLowerCase().split('.').pop();
    const isDicom  = fileExt === 'dcm' || fileExt === 'dicom' || fileData.mimetype === 'application/dicom';
    const isImage  = ['jpg', 'jpeg', 'png', 'tiff', 'tif'].includes(fileExt);
    const isPdf    = fileData.mimetype === 'application/pdf' || fileExt === 'pdf';

    if (!isDicom && !isImage && !isPdf) {
      return reply.status(400).send({ error: 'Formato não suportado. Envie PDF, DICOM (.dcm), JPG ou PNG.' });
    }

    const file_type   = isDicom ? 'dicom' : isImage ? 'image' : 'pdf';
    const contentType = isPdf   ? 'application/pdf' : isDicom ? 'application/octet-stream' : fileData.mimetype;

    const key = `uploads/${tenant_id}/${Date.now()}-${fileData.filename}`;
    const s3Path = await uploadFile(key, fileData._buffer, contentType);

    try {
      const exam = await withTenant(fastify.pg, tenant_id, async (client) => {
        // Verify subject belongs to this tenant and matches contracted module
        const { rows: subjectRows } = await client.query(
          `SELECT s.id, s.subject_type, t.module
           FROM subjects s
           JOIN tenants t ON t.id = s.tenant_id
           WHERE s.id = $1 AND s.tenant_id = $2`,
          [subject_id, tenant_id]
        );
        if (subjectRows.length === 0) {
          const err = new Error('Patient not found');
          err.statusCode = 404;
          throw err;
        }

        const { subject_type, module } = subjectRows[0];
        const expectedType = module === 'human' ? 'human' : 'animal';
        if (subject_type !== expectedType) {
          const err = new Error(
            `Module mismatch: tenant has module "${module}" but subject is "${subject_type}". ` +
            `Only ${expectedType} subjects can be processed by this clinic.`
          );
          err.statusCode = 422;
          throw err;
        }

        const { rows } = await client.query(
          `INSERT INTO exams (tenant_id, subject_id, uploaded_by, file_path, status, source, file_type)
           VALUES ($1, $2, $3, $4, 'pending', 'upload', $5)
           RETURNING id, status`,
          [tenant_id, subject_id, user_id, s3Path, file_type]
        );
        return rows[0];
      });

      await examQueue.add('process-exam', {
        exam_id: exam.id,
        tenant_id,
        file_path: s3Path,
        file_type,
        selected_agents: selected_agents || null,
        chief_complaint,
        current_symptoms
      });

      return reply.status(202).send({ exam_id: exam.id, status: 'pending' });
    } catch (err) {
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      if (err.statusCode === 422) return reply.status(422).send({ error: err.message });
      throw err;
    }
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;

    const exams = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT e.id, e.subject_id, e.status, e.source, e.file_path, e.error_message,
                e.created_at, e.updated_at,
                json_agg(
                  json_build_object(
                    'agent_type', cr.agent_type,
                    'interpretation', cr.interpretation,
                    'risk_scores', cr.risk_scores,
                    'alerts', cr.alerts,
                    'disclaimer', cr.disclaimer
                  )
                ) FILTER (WHERE cr.id IS NOT NULL) AS results
         FROM exams e
         LEFT JOIN clinical_results cr ON cr.exam_id = e.id
         WHERE e.tenant_id = $1
         GROUP BY e.id, e.subject_id, e.status, e.source, e.file_path, e.error_message,
                  e.created_at, e.updated_at
         ORDER BY e.created_at DESC`,
        [tenant_id]
      );
      return rows;
    });

    return exams;
  });

  fastify.get('/review-queue', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;

    const exams = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(`
        WITH exam_alerts AS (
          SELECT
            cr.exam_id,
            MAX(CASE
              WHEN alert->>'severity' = 'critical' THEN 4
              WHEN alert->>'severity' = 'high'     THEN 3
              WHEN alert->>'severity' = 'medium'   THEN 2
              WHEN alert->>'severity' = 'low'      THEN 1
              ELSE 0
            END) AS max_severity_score
          FROM clinical_results cr,
            jsonb_array_elements(cr.alerts) AS alert
          WHERE cr.tenant_id = $1
          GROUP BY cr.exam_id
        )
        SELECT
          e.id, e.subject_id, e.status, e.source, e.review_status,
          e.reviewed_by, e.reviewed_at, e.created_at, e.updated_at,
          COALESCE(ea.max_severity_score, 0) AS max_severity_score,
          json_agg(
            json_build_object(
              'agent_type', cr.agent_type,
              'interpretation', cr.interpretation,
              'risk_scores', cr.risk_scores,
              'alerts', cr.alerts,
              'disclaimer', cr.disclaimer
            )
          ) FILTER (WHERE cr.id IS NOT NULL) AS results
        FROM exams e
        LEFT JOIN clinical_results cr ON cr.exam_id = e.id AND cr.tenant_id = $1
        LEFT JOIN exam_alerts ea ON ea.exam_id = e.id
        WHERE e.tenant_id = $1 AND e.status = 'done' AND e.review_status = 'pending'
        GROUP BY e.id, e.subject_id, e.status, e.source, e.review_status,
                 e.reviewed_by, e.reviewed_at, e.created_at, e.updated_at,
                 ea.max_severity_score
        ORDER BY ea.max_severity_score DESC NULLS LAST, e.created_at ASC
      `, [tenant_id]);
      return rows;
    });

    return exams;
  });

  fastify.get('/review-queue/count', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;

    const result = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM exams WHERE tenant_id = $1 AND status = 'done' AND review_status = 'pending'`,
        [tenant_id]
      );
      return rows[0];
    });

    return { count: result.count };
  });

  fastify.get('/review-queue/navigate', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { current_id, direction } = request.query;

    if (!current_id || !['next', 'prev'].includes(direction)) {
      return reply.status(400).send({ error: 'current_id and direction (next|prev) are required' });
    }

    const exam = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(`
        WITH exam_alerts AS (
          SELECT cr.exam_id,
            MAX(CASE
              WHEN alert->>'severity' = 'critical' THEN 4
              WHEN alert->>'severity' = 'high'     THEN 3
              WHEN alert->>'severity' = 'medium'   THEN 2
              WHEN alert->>'severity' = 'low'      THEN 1
              ELSE 0
            END) AS max_severity_score
          FROM clinical_results cr,
            jsonb_array_elements(cr.alerts) AS alert
          WHERE cr.tenant_id = $1
          GROUP BY cr.exam_id
        )
        SELECT e.id
        FROM exams e
        LEFT JOIN exam_alerts ea ON ea.exam_id = e.id
        WHERE e.tenant_id = $1 AND e.status = 'done' AND e.review_status IN ('pending', 'viewed')
        ORDER BY ea.max_severity_score DESC NULLS LAST, e.created_at ASC
      `, [tenant_id]);

      const idx = rows.findIndex(r => r.id === current_id);
      const targetIdx = direction === 'next' ? idx + 1 : idx - 1;
      if (targetIdx < 0 || targetIdx >= rows.length) return null;
      return { id: rows[targetIdx].id };
    });

    if (!exam) return reply.status(404).send({ error: 'No more exams in that direction' });
    return exam;
  });

  fastify.patch('/:id/review-status', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { id } = request.params;
    const { review_status: toStatus } = request.body;

    if (!['viewed', 'reviewed'].includes(toStatus)) {
      return reply.status(400).send({ error: 'Invalid review_status. Must be viewed or reviewed.' });
    }

    // Transação controlada manualmente (precisa BEGIN antes de set_config true),
    // com tenant_id parametrizado (nunca interpolação) e filtro explícito em toda query.
    let client;
    try {
      client = await fastify.pg.connect();
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant_id]);

      const { rows } = await client.query(
        `SELECT review_status FROM exams WHERE id = $1 AND tenant_id = $2`,
        [id, tenant_id]
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Exam not found' });
      }
      const fromStatus = rows[0].review_status;

      const validTransitions = { pending: ['viewed', 'reviewed'], viewed: ['reviewed'] };
      if (!validTransitions[fromStatus]?.includes(toStatus)) {
        await client.query('ROLLBACK');
        return reply.status(409).send({
          error: `Cannot transition from '${fromStatus}' to '${toStatus}'`
        });
      }

      const isReviewed = toStatus === 'reviewed';
      const { rows: updated } = await client.query(
        `UPDATE exams SET review_status = $1, updated_at = NOW()
         ${isReviewed ? ', reviewed_by = $4, reviewed_at = NOW()' : ''}
         WHERE id = $2 AND tenant_id = $3
         RETURNING id, review_status, reviewed_by, reviewed_at`,
        isReviewed ? [toStatus, id, tenant_id, user_id] : [toStatus, id, tenant_id]
      );

      await client.query(
        `INSERT INTO review_audit_log (exam_id, tenant_id, user_id, from_status, to_status)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, tenant_id, user_id, fromStatus, toStatus]
      );

      await client.query('COMMIT');
      return updated[0];
    } catch (err) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      if (client) client.release();
    }
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const exam = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT e.id, e.subject_id, e.status, e.source, e.file_path, e.file_type,
                e.created_at, e.updated_at,
                json_agg(
                  json_build_object(
                    'agent_type', cr.agent_type,
                    'interpretation', cr.interpretation,
                    'risk_scores', cr.risk_scores,
                    'alerts', cr.alerts,
                    'recommendations', cr.recommendations,
                    'disclaimer', cr.disclaimer,
                    'metadata', cr.metadata
                  )
                ) FILTER (WHERE cr.id IS NOT NULL) AS results
         FROM exams e
         LEFT JOIN clinical_results cr ON cr.exam_id = e.id AND cr.tenant_id = $2
         WHERE e.id = $1 AND e.tenant_id = $2
         GROUP BY e.id, e.subject_id, e.status, e.source, e.file_path, e.file_type,
                  e.created_at, e.updated_at`,
        [id, tenant_id]
      );
      return rows[0] || null;
    });

    if (!exam) return reply.status(404).send({ error: 'Exam not found' });
    return exam;
  });

  fastify.get('/:id/image', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const row = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT cr.metadata
         FROM clinical_results cr
         JOIN exams e ON e.id = cr.exam_id AND e.tenant_id = $2
         WHERE e.id = $1 AND cr.tenant_id = $2
           AND cr.agent_type LIKE 'imaging_%'
           AND cr.metadata->>'original_image_url' IS NOT NULL
         LIMIT 1`,
        [id, tenant_id]
      );
      return rows[0] ?? null;
    });

    if (!row?.metadata?.original_image_url) {
      return reply.status(404).send({ error: 'Imagem não encontrada para este exame' });
    }

    const { downloadFile, keyFromPath } = require('../storage/s3');
    const buffer = await downloadFile(keyFromPath(row.metadata.original_image_url));

    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(buffer);
  });

  fastify.post('/:id/reprocess', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { tenant_id } = request.user;

    const exam = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT id, file_path, file_type, status FROM exams WHERE id = $1 AND tenant_id = $2`,
        [id, tenant_id]
      );
      return rows[0];
    });

    if (!exam) return reply.status(404).send({ error: 'Exam not found' });
    if (exam.status !== 'error') return reply.status(409).send({ error: 'Only exams with status error can be reprocessed' });
    if (!exam.file_path) return reply.status(422).send({ error: 'Exam has no file — please upload again' });

    await withTenant(fastify.pg, tenant_id, async (client) => {
      await client.query(
        `UPDATE exams SET status = 'pending' WHERE id = $1 AND tenant_id = $2`,
        [id, tenant_id]
      );
    });

    await examQueue.add('process-exam', { exam_id: exam.id, tenant_id, file_path: exam.file_path, file_type: exam.file_type || 'pdf' });

    return { ok: true, exam_id: exam.id, status: 'pending' };
  });

  fastify.get('/subscribe', {
    websocket: true,
    preHandler: [fastify.authenticate]
  }, (connection, request) => {
    const { tenant_id } = request.user;
    fastify.registerWsClient(tenant_id, connection.socket);
  });
};
