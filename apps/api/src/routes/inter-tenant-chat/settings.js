const { withTenant } = require('../../db/tenant');

const ADMIN_ONLY = async function (request, reply) {
  if (request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Chat entre tenants é restrito a admins.' });
  }
};

module.exports = async function (fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const row = await withTenant(fastify.pg, tenant_id, async (client) => {
      let { rows } = await client.query(
        `SELECT tenant_id, visible_in_directory, notify_on_invite_email,
                notify_on_message_email, message_email_quiet_after_minutes,
                created_at, updated_at
         FROM tenant_chat_settings
         WHERE tenant_id = $1`,
        [tenant_id]
      );
      if (rows.length === 0) {
        const ins = await client.query(
          `INSERT INTO tenant_chat_settings (tenant_id) VALUES ($1)
           RETURNING tenant_id, visible_in_directory, notify_on_invite_email,
                     notify_on_message_email, message_email_quiet_after_minutes,
                     created_at, updated_at`,
          [tenant_id]
        );
        rows = ins.rows;
      }
      return rows[0];
    });
    return row;
  });

  fastify.put('/', { preHandler: [fastify.authenticate, ADMIN_ONLY] }, async (request, reply) => {
    const { tenant_id } = request.user;
    const body = request.body || {};

    const fields = {};
    for (const k of ['visible_in_directory', 'notify_on_invite_email', 'notify_on_message_email']) {
      if (k in body) {
        if (typeof body[k] !== 'boolean') {
          return reply.status(400).send({ error: `${k} deve ser boolean` });
        }
        fields[k] = body[k];
      }
    }
    if ('message_email_quiet_after_minutes' in body) {
      const n = body.message_email_quiet_after_minutes;
      if (!Number.isInteger(n) || n < 0 || n > 1440) {
        return reply.status(400).send({ error: 'message_email_quiet_after_minutes deve ser inteiro 0..1440' });
      }
      fields.message_email_quiet_after_minutes = n;
    }

    if (Object.keys(fields).length === 0) {
      return reply.status(400).send({ error: 'Nenhum campo válido enviado.' });
    }

    const cols = ['tenant_id', ...Object.keys(fields)];
    const vals = [tenant_id, ...Object.values(fields)];
    const params = vals.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = Object.keys(fields).map((k, i) => `${k} = $${i + 2}`).join(', ');

    const row = await withTenant(fastify.pg, tenant_id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO tenant_chat_settings (${cols.join(', ')})
         VALUES (${params})
         ON CONFLICT (tenant_id) DO UPDATE SET ${updateSet}, updated_at = NOW()
         WHERE tenant_chat_settings.tenant_id = $1
         RETURNING tenant_id, visible_in_directory, notify_on_invite_email,
                   notify_on_message_email, message_email_quiet_after_minutes,
                   updated_at`,
        vals
      );
      return rows[0];
    });
    return row;
  });
};
