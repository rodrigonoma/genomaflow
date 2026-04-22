const { withTenant } = require('../db/tenant');
const { uploadFile } = require('../storage/s3');

module.exports = async function (fastify) {

  // POST /prescriptions — criar receita
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { subject_id, exam_id, agent_type, items, notes } = request.body || {};

    if (!subject_id || !exam_id || !agent_type || !items) {
      return reply.status(400).send({ error: 'subject_id, exam_id, agent_type e items são obrigatórios' });
    }
    if (!['therapeutic', 'nutrition'].includes(agent_type)) {
      return reply.status(400).send({ error: 'agent_type inválido. Use: therapeutic ou nutrition' });
    }
    if (!Array.isArray(items)) {
      return reply.status(400).send({ error: 'items deve ser um array' });
    }

    const { rows } = await withTenant(fastify.pg, tenant_id, async (client) => {
      return client.query(
        `INSERT INTO prescriptions (tenant_id, subject_id, exam_id, created_by, agent_type, items, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, tenant_id, subject_id, exam_id, agent_type, items, notes, pdf_url, created_at`,
        [tenant_id, subject_id, exam_id, user_id, agent_type, JSON.stringify(items), notes ?? null]
      );
    });

    return reply.status(201).send(rows[0]);
  });

  // GET /prescriptions/exams/:examId — listar receitas do exame
  fastify.get('/exams/:examId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { examId } = request.params;

    const { rows } = await withTenant(fastify.pg, tenant_id, async (client) => {
      return client.query(
        `SELECT p.id, p.agent_type, p.items, p.notes, p.pdf_url, p.created_at,
                u.email as created_by_email
         FROM prescriptions p
         LEFT JOIN users u ON u.id = p.created_by
         WHERE p.exam_id = $1
         ORDER BY p.created_at DESC`,
        [examId]
      );
    });

    return rows;
  });

  // GET /prescriptions/subjects/:subjectId — todas as receitas do paciente/animal
  fastify.get('/subjects/:subjectId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { subjectId } = request.params;

    const { rows } = await withTenant(fastify.pg, tenant_id, async (client) => {
      return client.query(
        `SELECT p.id, p.subject_id, p.exam_id, p.agent_type, p.items, p.notes, p.pdf_url, p.created_at,
                e.created_at AS exam_created_at
         FROM prescriptions p
         JOIN exams e ON e.id = p.exam_id
         WHERE p.subject_id = $1
         ORDER BY p.created_at DESC`,
        [subjectId]
      );
    });

    return rows;
  });

  // GET /prescriptions/:id — detalhe
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const { rows } = await withTenant(fastify.pg, tenant_id, async (client) => {
      return client.query(
        `SELECT p.*, u.email as created_by_email
         FROM prescriptions p
         LEFT JOIN users u ON u.id = p.created_by
         WHERE p.id = $1`,
        [id]
      );
    });

    if (!rows.length) return reply.status(404).send({ error: 'Receita não encontrada' });
    return rows[0];
  });

  // PUT /prescriptions/:id — atualizar receita (items, notes, pdf_url)
  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const { items, notes, pdf_url } = request.body || {};

    const { rows } = await withTenant(fastify.pg, tenant_id, async (client) => {
      return client.query(
        `UPDATE prescriptions
         SET items = COALESCE($1, items),
             notes = COALESCE($2, notes),
             pdf_url = COALESCE($3, pdf_url),
             updated_at = NOW()
         WHERE id = $4
         RETURNING id, items, notes, pdf_url, updated_at`,
        [items ? JSON.stringify(items) : null, notes ?? null, pdf_url ?? null, id]
      );
    });

    if (!rows.length) return reply.status(404).send({ error: 'Receita não encontrada' });
    return rows[0];
  });

  // DELETE /prescriptions/:id
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    await withTenant(fastify.pg, tenant_id, async (client) => {
      await client.query('DELETE FROM prescriptions WHERE id = $1', [id]);
    });

    return reply.status(204).send();
  });

  // POST /prescriptions/:id/pdf — upload do PDF gerado no browser para S3
  fastify.post('/:id/pdf', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const parts = request.parts();
    let fileBuffer = null;
    let filename = 'receita.pdf';

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'file') {
        filename = part.filename || filename;
        const chunks = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
      }
    }

    if (!fileBuffer) return reply.status(400).send({ error: 'file é obrigatório' });

    const key = `prescriptions/${tenant_id}/${Date.now()}-${filename}`;
    const s3Path = await uploadFile(key, fileBuffer, 'application/pdf');

    const { rows } = await withTenant(fastify.pg, tenant_id, async (client) => {
      return client.query(
        `UPDATE prescriptions SET pdf_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id, pdf_url`,
        [s3Path, id]
      );
    });

    if (!rows.length) return reply.status(404).send({ error: 'Receita não encontrada' });
    return rows[0];
  });

  // POST /prescriptions/:id/send-email — infra pronta, provider TBD
  fastify.post('/:id/send-email', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
    return reply.status(501).send({
      error: 'Envio por email será ativado em breve. Configure o provider de email nas configurações da clínica.'
    });
  });
};
