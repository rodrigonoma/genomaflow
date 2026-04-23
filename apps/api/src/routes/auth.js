const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');
const { withTenant } = require('../db/tenant');
const { VALID_DOCTOR_SPECIALTIES, VALID_MODULES } = require('../constants');

const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 dias

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

    // jti único por sessão — sobrescreve qualquer sessão anterior do mesmo usuário.
    // A próxima requisição da sessão antiga receberá 401 (session_replaced).
    const jti = randomUUID();
    const token = fastify.jwt.sign({
      user_id: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      module: user.module || 'human',
      jti
    });

    await fastify.redis.set(`session:${user.id}`, jti, 'EX', SESSION_TTL_SECONDS);

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
      `SELECT u.id, u.email, u.role, u.specialty, u.created_at,
              u.crm_number, u.crm_uf, u.professional_data_confirmed_at,
              t.module
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 AND u.tenant_id = $2`,
      [user_id, tenant_id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'User not found' });
    return rows[0];
  });

  // POST /auth/professional-info
  // Registra CRM/CRMV + UF + declaração de veracidade. Requer checkbox de consentimento.
  // IP e user-agent são registrados como evidência documental.
  const VALID_UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
  fastify.post('/professional-info', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id } = request.user;
    const { crm_number, crm_uf, truthfulness_confirmed } = request.body || {};

    if (!crm_number || typeof crm_number !== 'string' || !/^\d{3,10}$/.test(crm_number.trim())) {
      return reply.status(400).send({ error: 'Número do registro profissional inválido. Use apenas dígitos.' });
    }
    if (!crm_uf || !VALID_UFS.includes(String(crm_uf).toUpperCase())) {
      return reply.status(400).send({ error: 'UF inválida.' });
    }
    if (truthfulness_confirmed !== true) {
      return reply.status(400).send({ error: 'É obrigatório confirmar a veracidade das informações.' });
    }

    const xff = request.headers['x-forwarded-for'];
    const ip = xff ? xff.split(',')[0].trim() : request.ip;
    const ua = request.headers['user-agent'] || null;

    const { rows } = await fastify.pg.query(
      `UPDATE users
         SET crm_number = $1,
             crm_uf = $2,
             professional_data_confirmed_at = NOW(),
             professional_data_confirmed_ip = $3,
             professional_data_user_agent = $4
       WHERE id = $5
       RETURNING id, crm_number, crm_uf, professional_data_confirmed_at`,
      [crm_number.trim(), String(crm_uf).toUpperCase(), ip, ua, user_id]
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
