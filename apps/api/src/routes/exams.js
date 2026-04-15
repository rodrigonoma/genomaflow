const path = require('path');
const fs = require('fs');
const { Queue } = require('bullmq');
const { withTenant } = require('../db/tenant');

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/uploads';

module.exports = async function (fastify) {
  const examQueue = new Queue('exam-processing', { connection: fastify.redis });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const parts = request.parts();

    let patient_id = null;
    let fileData = null;

    // Collect ALL parts before processing (field order may vary)
    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'patient_id') {
        patient_id = part.value;
      } else if (part.type === 'file' && part.fieldname === 'file') {
        fileData = part;
        // Must consume the stream to avoid hanging
        const chunks = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileData._buffer = Buffer.concat(chunks);
      }
    }

    if (!patient_id) return reply.status(400).send({ error: 'patient_id is required' });
    if (!fileData) return reply.status(400).send({ error: 'file is required' });
    if (fileData.mimetype !== 'application/pdf') {
      return reply.status(400).send({ error: 'Only PDF files are accepted' });
    }

    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const filename = `${Date.now()}-${fileData.filename}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    // Write file to disk
    fs.writeFileSync(filePath, fileData._buffer);

    try {
      const exam = await withTenant(fastify.pg, tenant_id, async (client) => {
        // Verify the patient belongs to this tenant before inserting the exam
        const { rows: patientRows } = await client.query(
          'SELECT id FROM patients WHERE id = $1 AND tenant_id = $2',
          [patient_id, tenant_id]
        );
        if (patientRows.length === 0) {
          const err = new Error('Patient not found');
          err.statusCode = 404;
          throw err;
        }

        const { rows } = await client.query(
          `INSERT INTO exams (tenant_id, patient_id, uploaded_by, file_path, status, source)
           VALUES ($1, $2, $3, $4, 'pending', 'upload')
           RETURNING id, status`,
          [tenant_id, patient_id, user_id, filePath]
        );
        return rows[0];
      });

      await examQueue.add('process-exam', {
        exam_id: exam.id,
        tenant_id,
        file_path: filePath
      });

      return reply.status(202).send({ exam_id: exam.id, status: 'pending' });
    } catch (err) {
      // Clean up the uploaded file if DB operation failed
      fs.unlink(filePath, () => {});
      if (err.statusCode === 404) {
        return reply.status(404).send({ error: err.message });
      }
      throw err;
    }
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;

    const exams = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT e.id, e.patient_id, e.status, e.source, e.file_path, e.created_at, e.updated_at,
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
         GROUP BY e.id, e.patient_id, e.status, e.source, e.file_path, e.created_at, e.updated_at
         ORDER BY e.created_at DESC`,
        [tenant_id]
      );
      return rows;
    });

    return exams;
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const exam = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `SELECT e.id, e.patient_id, e.status, e.source, e.file_path, e.created_at, e.updated_at,
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
         WHERE e.id = $1
         GROUP BY e.id, e.patient_id, e.status, e.source, e.file_path, e.created_at, e.updated_at`,
        [id]
      );
      return rows[0] || null;
    });

    if (!exam) return reply.status(404).send({ error: 'Exam not found' });
    return exam;
  });

  fastify.get('/subscribe', {
    websocket: true,
    preHandler: [fastify.authenticate]
  }, (connection, request) => {
    const { tenant_id } = request.user;
    fastify.registerWsClient(tenant_id, connection.socket);
  });
};
