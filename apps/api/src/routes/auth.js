const bcrypt = require('bcrypt');
const { withTenant } = require('../db/tenant');
const { VALID_DOCTOR_SPECIALTIES, VALID_MODULES } = require('../constants');

const DUMMY_HASH = '$2b$10$invalidhashfortimingprotection0000000000000000000000000';

module.exports = async function (fastify) {
  fastify.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { email: rawEmail, password } = request.body;
    const email = rawEmail?.toLowerCase().trim();

    const { rows } = await fastify.pg.query(
      `SELECT u.id, u.tenant_id, u.password_hash, u.role, u.active AS user_active, t.module, t.active AS tenant_active
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE LOWER(u.email) = $1`,
      [email]
    );

    if (rows.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH).catch(() => {});
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const user = rows[0];

    if (!user.user_active) {
      return reply.status(403).send({ error: 'Usuário desativado. Entre em contato com o suporte.' });
    }

    if (!user.tenant_active) {
      return reply.status(403).send({ error: 'Conta pendente de ativação. Aguarde a liberação pelo administrador.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = fastify.jwt.sign({
      user_id: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      module: user.module || 'human'
    });

    return { token };
  });

  fastify.post('/check-email', {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } }
  }, async (request, reply) => {
    const { email: rawEmail } = request.body || {};
    if (!rawEmail) return reply.status(400).send({ error: 'Email obrigatório' });
    const email = rawEmail.toLowerCase().trim();
    const { rows } = await fastify.pg.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    if (rows.length > 0) return reply.status(409).send({ error: 'Email já cadastrado. Faça login ou use outro email.' });
    return reply.send({ available: true });
  });

  fastify.post('/register', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } }
  }, async (request, reply) => {
    const { clinic_name, email: rawEmail, password, module: mod } = request.body || {};
    const email = rawEmail?.toLowerCase().trim();

    if (!clinic_name || !rawEmail || !password || !mod) {
      return reply.status(400).send({ error: 'Campos obrigatórios: clinic_name, email, password, module' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return reply.status(400).send({ error: 'Formato de email inválido' });
    }

    if (password.length < 8) {
      return reply.status(400).send({ error: 'Senha deve ter no mínimo 8 caracteres' });
    }

    if (!VALID_MODULES.includes(mod)) {
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

    const { rows: userRows } = await withTenant(fastify.pg, tenant_id, async (client) => {
      return client.query(
        "INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id",
        [tenant_id, email, password_hash]
      );
    });
    const user_id = userRows[0].id;

    return reply.status(201).send({ tenant_id, user_id, email });
  });

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { rows } = await fastify.pg.query(
      `SELECT u.id, u.email, u.role, u.specialty, u.created_at, t.module
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 AND u.tenant_id = $2`,
      [user_id, tenant_id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'User not found' });
    return rows[0];
  });

  fastify.put('/me/specialty', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id } = request.user;
    const { specialty } = request.body;

    if (!specialty || !VALID_DOCTOR_SPECIALTIES.includes(specialty)) {
      return reply.status(400).send({ error: 'Especialidade inválida', valid: VALID_DOCTOR_SPECIALTIES });
    }

    const { rows } = await fastify.pg.query(
      `UPDATE users SET specialty = $1 WHERE id = $2 RETURNING id, email, role, specialty`,
      [specialty, user_id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'User not found' });
    return rows[0];
  });
};
