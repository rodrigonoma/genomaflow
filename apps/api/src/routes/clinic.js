const { uploadFile } = require('../storage/s3');

module.exports = async function (fastify) {

  // GET /clinic/profile
  fastify.get('/profile', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenant_id } = request.user;
    const { rows } = await fastify.pg.query(
      `SELECT id, name, module, cnpj, clinic_logo_url FROM tenants WHERE id = $1`,
      [tenant_id]
    );
    return rows[0] ?? {};
  });

  // PUT /clinic/profile — atualizar nome e CNPJ
  fastify.put('/profile', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Acesso restrito a administradores' });

    const { name, cnpj } = request.body || {};
    if (!name?.trim()) return reply.status(400).send({ error: 'Nome da clínica é obrigatório' });

    const { rows } = await fastify.pg.query(
      `UPDATE tenants SET name = $1, cnpj = $2 WHERE id = $3
       RETURNING id, name, cnpj, clinic_logo_url, module`,
      [name.trim(), cnpj?.trim() ?? null, tenant_id]
    );
    return rows[0];
  });

  // POST /clinic/logo — upload do logo para S3
  fastify.post('/logo', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id, role } = request.user;
    if (role !== 'admin') return reply.status(403).send({ error: 'Acesso restrito a administradores' });

    const parts = request.parts();
    let fileBuffer = null;
    let mimetype = '';
    let filename = 'logo';

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'file') {
        mimetype = part.mimetype;
        filename = part.filename || filename;
        const chunks = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
      }
    }

    if (!fileBuffer) return reply.status(400).send({ error: 'file é obrigatório' });
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(mimetype)) {
      return reply.status(400).send({ error: 'Apenas imagens PNG ou JPEG são aceitas' });
    }
    if (fileBuffer.length > 2 * 1024 * 1024) {
      return reply.status(400).send({ error: 'Imagem deve ter no máximo 2MB' });
    }

    const ext = mimetype === 'image/png' ? 'png' : 'jpg';
    const key = `logos/${tenant_id}/logo.${ext}`;
    const s3Path = await uploadFile(key, fileBuffer, mimetype);

    const { rows } = await fastify.pg.query(
      `UPDATE tenants SET clinic_logo_url = $1 WHERE id = $2 RETURNING id, clinic_logo_url`,
      [s3Path, tenant_id]
    );
    return rows[0];
  });
};
