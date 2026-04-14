const bcrypt = require('bcrypt');

// Dummy hash used to perform a constant-time comparison when the user is not
// found, preventing email enumeration via response-time differences.
const DUMMY_HASH = '$2b$10$invalidhashfortimingprotection0000000000000000000000000';

module.exports = async function (fastify) {
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body;

    const { rows } = await fastify.pg.query(
      'SELECT id, tenant_id, password_hash, role FROM users WHERE email = $1',
      [email]
    );

    if (rows.length === 0) {
      // Always run bcrypt to prevent timing-based email enumeration
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
      role: user.role
    });

    return { token };
  });
};
