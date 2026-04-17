const bcrypt = require('bcrypt');

const DUMMY_HASH = '$2b$10$invalidhashfortimingprotection0000000000000000000000000';

module.exports = async function (fastify) {
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body;

    const { rows } = await fastify.pg.query(
      `SELECT u.id, u.tenant_id, u.password_hash, u.role, t.module
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = $1`,
      [email]
    );

    if (rows.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH).catch(() => {});
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = fastify.jwt.sign({
      user_id: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      module: user.module
    });

    return { token };
  });
};
