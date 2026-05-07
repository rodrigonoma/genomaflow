const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');
const { withTenant } = require('../db/tenant');
const { sendEmailVerification } = require('../mailer/verification');
const { VALID_DOCTOR_SPECIALTIES, VALID_MODULES, VALID_PROFESSIONAL_TYPES } = require('../constants');

const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 dias

const DUMMY_HASH = '$2b$10$invalidhashfortimingprotection0000000000000000000000000';

module.exports = async function (fastify) {
  fastify.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { email: rawEmail, password } = request.body;
    const email = rawEmail?.toLowerCase().trim();

    const { rows } = await fastify.pg.query(
      `SELECT u.id, u.tenant_id, u.password_hash, u.role, u.active AS user_active,
              u.email_verified_at, t.module, t.active AS tenant_active
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

    // E-mail não verificado bloqueia o login. Frontend mostra botão "reenviar".
    if (!user.email_verified_at) {
      return reply.status(403).send({
        error: 'EMAIL_NOT_VERIFIED',
        message: 'Verifique seu e-mail antes de entrar. Reenvie o link se não recebeu.',
        email,
      });
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
    const { clinic_name, email: rawEmail, password, module: mod, professional_type: ptype } = request.body || {};
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

    // professional_type opcional — default 'medico' (compat retro pra register human/vet existente).
    // Estetica deve sempre passar explícito; senão herda 'medico' (médico-dermato é caso comum).
    const professional_type = ptype && VALID_PROFESSIONAL_TYPES.includes(ptype) ? ptype : 'medico';

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
        "INSERT INTO users (tenant_id, email, password_hash, role, professional_type) VALUES ($1, $2, $3, 'admin', $4) RETURNING id",
        [tenant_id, email, password_hash, professional_type]
      );
    });
    const user_id = userRows[0].id;

    // Dispara o email de verificação. Se falhar, logamos mas devolvemos sucesso —
    // o usuário pode clicar "reenviar" depois. Deixar o registro travar por falha
    // de SES é pior UX.
    try {
      await sendEmailVerification(fastify.pg, user_id, email);
    } catch (err) {
      request.log.error({ err, user_id }, 'falha ao enviar email de verificação no register');
    }

    // /auth/register é usado pelo register.component.ts (rota legada /register).
    // Onboarding pago (R$ 199 + Stripe) usa POST /onboarding/checkout single-shot
    // e cria tenant+user só no webhook — vide routes/onboarding-checkout.js.
    return reply.status(201).send({
      tenant_id,
      user_id,
      email,
      email_verification_required: true,
    });
  });

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { rows } = await fastify.pg.query(
      `SELECT u.id, u.email, u.role, u.specialty, u.created_at,
              u.crm_number, u.crm_uf, u.professional_data_confirmed_at,
              u.professional_type,
              t.module, t.name AS tenant_name, t.billing_status
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
  //
  // CRM/CRMV é OBRIGATÓRIO pra medico/dentista (mantém audit trail clínico).
  // OPCIONAL pra esteticista/biomedico/outro (não tem registro CFM/CFO; podem
  // ter registro CFT mas não validamos formato), mas truthfulness_confirmed
  // continua obrigatório (declaração de veracidade pesa pra todos).
  const VALID_UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
  fastify.post('/professional-info', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { crm_number, crm_uf, truthfulness_confirmed } = request.body || {};

    // Carrega professional_type do user — controla se CRM é obrigatório.
    const userQ = await fastify.pg.query(
      'SELECT professional_type FROM users WHERE id = $1 AND tenant_id = $2',
      [user_id, tenant_id]
    );
    if (!userQ.rows[0]) return reply.status(404).send({ error: 'User not found' });
    const ptype = userQ.rows[0].professional_type || 'medico';
    const requiresCrm = ptype === 'medico' || ptype === 'dentista';

    if (truthfulness_confirmed !== true) {
      return reply.status(400).send({ error: 'É obrigatório confirmar a veracidade das informações.' });
    }

    let crmValue = null;
    let ufValue = null;

    if (requiresCrm) {
      if (!crm_number || typeof crm_number !== 'string' || !/^\d{3,10}$/.test(crm_number.trim())) {
        return reply.status(400).send({ error: 'Número do registro profissional inválido. Use apenas dígitos.' });
      }
      if (!crm_uf || !VALID_UFS.includes(String(crm_uf).toUpperCase())) {
        return reply.status(400).send({ error: 'UF inválida.' });
      }
      crmValue = crm_number.trim();
      ufValue = String(crm_uf).toUpperCase();
    } else {
      // Opcional pra non-medico/dentista — se vier, valida formato; se vazio/null, OK
      if (crm_number && typeof crm_number === 'string' && crm_number.trim()) {
        if (!/^\d{3,10}$/.test(crm_number.trim())) {
          return reply.status(400).send({ error: 'Número do registro profissional inválido. Use apenas dígitos.' });
        }
        crmValue = crm_number.trim();
      }
      if (crm_uf && String(crm_uf).trim()) {
        if (!VALID_UFS.includes(String(crm_uf).toUpperCase())) {
          return reply.status(400).send({ error: 'UF inválida.' });
        }
        ufValue = String(crm_uf).toUpperCase();
      }
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
       WHERE id = $5 AND tenant_id = $6
       RETURNING id, crm_number, crm_uf, professional_data_confirmed_at`,
      [crmValue, ufValue, ip, ua, user_id, tenant_id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'User not found' });
    return rows[0];
  });

  fastify.put('/me/specialty', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { specialty } = request.body;

    if (!specialty || !VALID_DOCTOR_SPECIALTIES.includes(specialty)) {
      return reply.status(400).send({ error: 'Especialidade inválida', valid: VALID_DOCTOR_SPECIALTIES });
    }

    const { rows } = await fastify.pg.query(
      `UPDATE users SET specialty = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id, email, role, specialty`,
      [specialty, user_id, tenant_id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'User not found' });
    return rows[0];
  });

  // POST /auth/device-token — registra device token para push notifications
  fastify.post('/device-token', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { token, platform } = request.body || {};

    if (!token || !platform || !['android', 'ios'].includes(platform)) {
      return reply.status(400).send({ error: 'token e platform (android|ios) são obrigatórios' });
    }

    await fastify.pg.query(
      `INSERT INTO device_tokens (user_id, tenant_id, token, platform)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, created_at = NOW()`,
      [user_id, tenant_id, token, platform]
    );

    return reply.status(204).send();
  });

  // DELETE /auth/device-token — remove token no logout
  fastify.delete('/device-token', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id } = request.user;
    const { token } = request.body || {};

    if (!token) return reply.status(400).send({ error: 'token obrigatório' });

    await fastify.pg.query(
      'DELETE FROM device_tokens WHERE user_id = $1 AND token = $2',
      [user_id, token]
    );
    return reply.status(204).send();
  });
};
