const { withTenant } = require('../db/tenant');

module.exports = async function (fastify) {

  // GET /prescription-templates?agent_type=therapeutic
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { agent_type } = request.query || {};

    if (agent_type && !['therapeutic', 'nutrition'].includes(agent_type)) {
      return reply.status(400).send({ error: 'agent_type inválido. Use: therapeutic ou nutrition' });
    }

    const rows = await withTenant(fastify.pg, tenant_id, async (client) => {
      const q = agent_type
        ? `SELECT id, name, agent_type, items, notes, created_at, updated_at
           FROM prescription_templates
           WHERE agent_type = $1
           ORDER BY name ASC`
        : `SELECT id, name, agent_type, items, notes, created_at, updated_at
           FROM prescription_templates
           ORDER BY agent_type, name ASC`;
      const params = agent_type ? [agent_type] : [];
      const result = await client.query(q, params);
      return result.rows;
    });

    return rows;
  });

  // POST /prescription-templates
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { name, agent_type, items, notes } = request.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return reply.status(400).send({ error: 'name é obrigatório' });
    }
    if (!agent_type || !['therapeutic', 'nutrition'].includes(agent_type)) {
      return reply.status(400).send({ error: 'agent_type inválido. Use: therapeutic ou nutrition' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return reply.status(400).send({ error: 'items deve ser um array não-vazio' });
    }

    try {
      const tpl = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO prescription_templates (tenant_id, created_by, name, agent_type, items, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, name, agent_type, items, notes, created_at`,
          [tenant_id, user_id, name.trim(), agent_type, JSON.stringify(items), notes ?? null]
        );
        return rows[0];
      });
      return reply.status(201).send(tpl);
    } catch (err) {
      if (err.code === '23505') {
        return reply.status(409).send({ error: 'Já existe um template com este nome para este tipo.' });
      }
      throw err;
    }
  });

  // PUT /prescription-templates/:id
  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;
    const { name, items, notes } = request.body || {};

    try {
      const tpl = await withTenant(fastify.pg, tenant_id, async (client) => {
        const { rows } = await client.query(
          `UPDATE prescription_templates
             SET name  = COALESCE($1, name),
                 items = COALESCE($2, items),
                 notes = COALESCE($3, notes),
                 updated_at = NOW()
           WHERE id = $4
           RETURNING id, name, agent_type, items, notes, updated_at`,
          [name?.trim() ?? null, items ? JSON.stringify(items) : null, notes ?? null, id]
        );
        return rows[0] || null;
      });
      if (!tpl) return reply.status(404).send({ error: 'Template não encontrado' });
      return tpl;
    } catch (err) {
      if (err.code === '23505') {
        return reply.status(409).send({ error: 'Já existe um template com este nome para este tipo.' });
      }
      throw err;
    }
  });

  // DELETE /prescription-templates/:id
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const { id } = request.params;

    const deleted = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `DELETE FROM prescription_templates WHERE id = $1 RETURNING id`,
        [id]
      );
      return rows[0] || null;
    });
    if (!deleted) return reply.status(404).send({ error: 'Template não encontrado' });
    return reply.status(204).send();
  });
};
