const bcrypt = require('bcrypt');

const DUMMY_HASH = '$2b$10$invalidhashfortimingprotection0000000000000000000000000';

module.exports = async function (fastify) {
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body;

    const { rows } = await fastify.pg.query(
      `SELECT u.id, u.tenant_id, u.password_hash, u.role, t.module, t.active
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = $1`,
      [email]
    );

    if (rows.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH).catch(() => {});
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const user = rows[0];

    if (!user.active) {
      return reply.status(403).send({ error: 'Conta pendente de ativação. Verifique seu pagamento.' });
    }

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

  fastify.post('/register', async (request, reply) => {
    const { clinic_name, email, password, module: mod } = request.body || {};

    if (!clinic_name || !email || !password || !mod) {
      return reply.status(400).send({ error: 'Campos obrigatórios: clinic_name, email, password, module' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return reply.status(400).send({ error: 'Formato de email inválido' });
    }

    if (password.length < 8) {
      return reply.status(400).send({ error: 'Senha deve ter no mínimo 8 caracteres' });
    }

    if (!['human', 'veterinary'].includes(mod)) {
      return reply.status(400).send({ error: 'Módulo inválido. Use: human ou veterinary' });
    }

    const existing = await fastify.pg.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: 'Email já cadastrado' });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const tenantRes = await fastify.pg.query(
      "INSERT INTO tenants (name, type, module, active) VALUES ($1, 'clinic', $2, false) RETURNING id",
      [clinic_name, mod]
    );
    const tenant_id = tenantRes.rows[0].id;

    const userRes = await fastify.pg.query(
      "INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id",
      [tenant_id, email, password_hash]
    );
    const user_id = userRes.rows[0].id;

    return reply.status(201).send({ tenant_id, user_id, email });
  });

  fastify.post('/activate', async (request, reply) => {
    const { tenant_id } = request.body || {};

    if (!tenant_id) {
      return reply.status(400).send({ error: 'tenant_id é obrigatório' });
    }

    const res = await fastify.pg.query(
      'UPDATE tenants SET active = true WHERE id = $1 RETURNING id',
      [tenant_id]
    );
    if (res.rowCount === 0) {
      return reply.status(404).send({ error: 'Tenant não encontrado' });
    }
    return reply.status(200).send({ ok: true });
  });
};
