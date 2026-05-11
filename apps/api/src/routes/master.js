'use strict';

const crypto = require('crypto');
const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const { withTenant } = require('../db/tenant');
const {
  resolveTargetTenants,
  deliverToTenant,
  VALID_SEGMENT_KINDS,
  VALID_MODULES,
  MASTER_TENANT_ID,
} = require('../services/master-broadcasts');
const { uploadFile } = require('../storage/s3');

const BROADCAST_BODY_MAX = 2000;
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ATTACHMENT_KIND_MIME = {
  image: ['image/jpeg', 'image/png'],
  pdf: ['application/pdf'],
};
const MAX_ATTACHMENTS = 5;

function masterOnly(fastify) {
  return async (request, reply) => {
    await fastify.authenticate(request, reply);
    if (request.user.role !== 'master') {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  };
}

module.exports = async function masterRoutes(fastify) {
  const auth = () => ({ preHandler: [masterOnly(fastify)] });

  // ── Tenants ──────────────────────────────────────────────────────────────

  fastify.get('/tenants', auth(), async (request, reply) => {
    const { rows } = await fastify.pg.query(`
      SELECT
        t.id, t.name, t.type, t.module, t.plan, t.active, t.created_at,
        COUNT(DISTINCT u.id) FILTER (WHERE u.role != 'master') AS user_count,
        COALESCE(SUM(cl.amount), 0) AS balance,
        MAX(cl.created_at) FILTER (WHERE cl.kind IN ('subscription_bonus','topup','topup_recurring','adjustment')) AS last_purchase_at,
        ARRAY_AGG(DISTINCT ts.agent_type) FILTER (WHERE ts.agent_type IS NOT NULL) AS specialties
      FROM tenants t
      LEFT JOIN users u ON u.tenant_id = t.id
      LEFT JOIN credit_ledger cl ON cl.tenant_id = t.id
      LEFT JOIN tenant_specialties ts ON ts.tenant_id = t.id
      WHERE t.id != '00000000-0000-0000-0000-000000000001'
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `);
    return rows;
  });

  fastify.patch('/tenants/:id/activate', auth(), async (request, reply) => {
    const { id } = request.params;
    const { rowCount } = await fastify.pg.query(
      'UPDATE tenants SET active = true WHERE id = $1 AND id != $2',
      [id, '00000000-0000-0000-0000-000000000001']
    );
    if (!rowCount) return reply.status(404).send({ error: 'Tenant not found' });
    return { ok: true };
  });

  fastify.patch('/tenants/:id/deactivate', auth(), async (request, reply) => {
    const { id } = request.params;
    const { rowCount } = await fastify.pg.query(
      'UPDATE tenants SET active = false WHERE id = $1 AND id != $2',
      [id, '00000000-0000-0000-0000-000000000001']
    );
    if (!rowCount) return reply.status(404).send({ error: 'Tenant not found' });
    return { ok: true };
  });

  fastify.get('/tenants/:id/users', auth(), async (request, reply) => {
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `SELECT id, email, role, specialty, active, created_at
       FROM users WHERE tenant_id = $1 AND role != 'master'
       ORDER BY created_at`,
      [id]
    );
    return rows;
  });

  fastify.patch('/tenants/:id/users/:userId/toggle', auth(), async (request, reply) => {
    const { userId } = request.params;
    const { rows } = await fastify.pg.query(
      `UPDATE users SET active = NOT active
       WHERE id = $1 AND role != 'master'
       RETURNING id, email, active`,
      [userId]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'User not found' });
    return rows[0];
  });

  // ── Errors ───────────────────────────────────────────────────────────────

  // GET /master/errors
  // Default `severity=high` filtra erros graves (5xx + nulos) e ignora ruído
  // (401, 403, 404, etc). Use `severity=all` para ver tudo.
  fastify.get('/errors', auth(), async (request, reply) => {
    const page  = Math.max(1, parseInt(request.query.page)  || 1);
    const limit = Math.min(200, parseInt(request.query.limit) || 50);
    const offset = (page - 1) * limit;
    const severity = (request.query.severity || 'high').toLowerCase();

    const where = severity === 'all'
      ? '1=1'
      : '(el.status_code IS NULL OR el.status_code >= 500)';

    const [rows, countRes] = await Promise.all([
      fastify.pg.query(
        `SELECT el.id, el.url, el.method, el.status_code, el.error_message, el.created_at,
                t.name AS tenant_name, u.email AS user_email
         FROM error_log el
         LEFT JOIN tenants t ON t.id = el.tenant_id
         LEFT JOIN users u ON u.id = el.user_id
         WHERE ${where}
         ORDER BY el.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      fastify.pg.query(`SELECT COUNT(*) FROM error_log el WHERE ${where}`)
    ]);

    return { items: rows.rows, total: parseInt(countRes.rows[0].count), page, limit, severity };
  });

  // GET /master/errors/:id — detalhe completo (stack trace + body + user agent)
  fastify.get('/errors/:id', auth(), async (request, reply) => {
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `SELECT el.id, el.url, el.method, el.status_code, el.error_message,
              el.stack_trace, el.user_agent, el.request_body, el.created_at,
              el.tenant_id, el.user_id,
              t.name AS tenant_name, u.email AS user_email
       FROM error_log el
       LEFT JOIN tenants t ON t.id = el.tenant_id
       LEFT JOIN users u ON u.id = el.user_id
       WHERE el.id = $1`,
      [id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Erro não encontrado' });
    return rows[0];
  });

  // ── Feedback / Suggestions ───────────────────────────────────────────────

  fastify.get('/feedback', auth(), async (request, reply) => {
    const rawType = request.query.type;
    const type    = rawType === 'bug' || rawType === 'feature' ? rawType : null;
    const page    = Math.max(1, parseInt(request.query.page)  || 1);
    const limit   = Math.min(200, parseInt(request.query.limit) || 50);
    const offset  = (page - 1) * limit;

    const [rows, countRes] = await Promise.all([
      fastify.pg.query(
        `SELECT f.id, f.type, f.message, f.screenshot_url, f.created_at,
                t.name AS tenant_name, u.email AS user_email
         FROM feedback f
         LEFT JOIN tenants t ON t.id = f.tenant_id
         LEFT JOIN users u ON u.id = f.user_id
         WHERE ($3::text IS NULL OR f.type = $3)
         ORDER BY f.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset, type]
      ),
      fastify.pg.query(
        `SELECT COUNT(*) FROM feedback WHERE ($1::text IS NULL OR type = $1)`,
        [type]
      )
    ]);

    return { items: rows.rows, total: parseInt(countRes.rows[0].count), page, limit };
  });

  // ── Exams ─────────────────────────────────────────────────────────────────

  fastify.get('/tenants/:id/exams', auth(), async (request, reply) => {
    const { id } = request.params;
    // patients foi renomeada → subjects + exams.patient_id → exams.subject_id
    // pela migration 012_patients_to_subjects. Esse endpoint estava com SQL legado.
    const { rows } = await fastify.pg.query(
      `SELECT e.id, e.status, e.file_path, e.created_at,
              s.name AS patient_name, s.species
       FROM exams e
       JOIN subjects s ON s.id = e.subject_id
       WHERE s.tenant_id = $1
       ORDER BY e.created_at DESC
       LIMIT 100`,
      [id]
    );
    return rows;
  });

  fastify.patch('/exams/:examId/reset', auth(), async (request, reply) => {
    const { examId } = request.params;
    const { rows } = await fastify.pg.query(
      `UPDATE exams SET status = 'error' WHERE id = $1
       RETURNING id, status, patient_id`,
      [examId]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Exam not found' });
    return { ok: true, exam_id: rows[0].id, status: rows[0].status };
  });

  // ── Credits ──────────────────────────────────────────────────────────────

  fastify.post('/credits', auth(), async (request, reply) => {
    const { tenant_id, amount, description } = request.body || {};
    if (!tenant_id || !amount) {
      return reply.status(400).send({ error: 'tenant_id e amount são obrigatórios' });
    }
    const n = parseInt(amount);
    if (!n || Math.abs(n) > 100000) {
      return reply.status(400).send({ error: 'amount inválido (máx ±100000)' });
    }

    const tenantCheck = await fastify.pg.query(
      'SELECT id, name FROM tenants WHERE id = $1', [tenant_id]
    );
    if (!tenantCheck.rows[0]) return reply.status(404).send({ error: 'Tenant não encontrado' });

    const { rows } = await fastify.pg.query(
      `INSERT INTO credit_ledger (tenant_id, amount, kind, description)
       VALUES ($1, $2, 'adjustment', $3)
       RETURNING id, amount, created_at`,
      [tenant_id, n, description || `Ajuste manual: ${n} créditos`]
    );

    fastify.redis.publish(`billing:updated:${tenant_id}`, '{}').catch(() => {});
    return { ok: true, ...rows[0], tenant_name: tenantCheck.rows[0].name };
  });

  // ── Criar tenant manualmente (master bypass do flow Stripe) ───────────────
  // Cria tenant + user admin em uma transação, com opções de:
  //  - initial_credits (positivo, lança em credit_ledger)
  //  - mark_email_verified (pula etapa de verificação SES)
  //  - accept_all_terms (registra aceite dos 5 documentos legais ativos)
  //  - active (default true — diferente do /auth/register que cria inativo)
  // Não envia email de verificação automaticamente (master controla o flow).
  fastify.post('/tenants', auth(), async (request, reply) => {
    const {
      clinic_name, email: rawEmail, password,
      module: mod, professional_type: ptype = 'medico',
      initial_credits = 0,
      mark_email_verified = true,
      accept_all_terms = true,
      active = true,
      require_password_change = true,
    } = request.body || {};

    if (!clinic_name || !rawEmail || !password || !mod) {
      return reply.status(400).send({ error: 'clinic_name, email, password, module obrigatórios' });
    }
    if (password.length < 8) return reply.status(400).send({ error: 'password deve ter mínimo 8 caracteres' });
    const { VALID_MODULES, VALID_PROFESSIONAL_TYPES } = require('../constants');
    if (!VALID_MODULES.includes(mod)) return reply.status(400).send({ error: `module deve ser ${VALID_MODULES.join('|')}` });
    if (!VALID_PROFESSIONAL_TYPES.includes(ptype)) return reply.status(400).send({ error: `professional_type inválido` });
    if (typeof initial_credits !== 'number' || initial_credits < 0 || initial_credits > 100000) {
      return reply.status(400).send({ error: 'initial_credits inválido (0-100000)' });
    }

    const email = rawEmail.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return reply.status(400).send({ error: 'Email inválido' });

    const dup = await fastify.pg.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (dup.rows.length > 0) return reply.status(409).send({ error: 'Email já cadastrado' });

    const password_hash = await bcrypt.hash(password, 12);
    const client = await fastify.pg.connect();
    let tenant_id, user_id;
    try {
      await client.query('BEGIN');

      const t = await client.query(
        `INSERT INTO tenants (name, type, module, active)
         VALUES ($1, 'clinic', $2, $3)
         RETURNING id`,
        [clinic_name, mod, !!active]
      );
      tenant_id = t.rows[0].id;

      // RLS de users requer app.tenant_id setado
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant_id]);
      const u = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, role, professional_type,
                            email_verified_at, password_change_required, active)
         VALUES ($1, $2, $3, 'admin', $4, $5, $6, true)
         RETURNING id`,
        [tenant_id, email, password_hash, ptype,
         mark_email_verified ? new Date() : null,
         !!require_password_change]
      );
      user_id = u.rows[0].id;

      if (initial_credits > 0) {
        await client.query(
          `INSERT INTO credit_ledger (tenant_id, amount, kind, description)
           VALUES ($1, $2, 'adjustment', 'Créditos iniciais (criação manual)')`,
          [tenant_id, initial_credits]
        );
      }

      if (accept_all_terms) {
        // Catálogo dos 5 docs legais — espelhado de routes/terms.js (mesmas versões/hashes)
        const DOCS = [
          { type: 'contrato_saas',          version: '1.2', hash: '55d768782660c012bb0b957f2d8542718d1ee1b9f17422ad29041c59874acf60' },
          { type: 'dpa',                    version: '1.2', hash: 'b3313f53a8a804a735a343b53520abf83598851d8c17268ead188dfc050c110c' },
          { type: 'politica_incidentes',    version: '1.2', hash: '116fb20d8aefeeea3a8327eaf3e9fd2ea7740aecff0cb6c0e35e7a82f91a23a1' },
          { type: 'politica_seguranca',     version: '1.2', hash: '3b5b2dd66a3824b09e16964b52420d09c92d2f0da60e3f617b22663b1c2c76a8' },
          { type: 'politica_uso_aceitavel', version: '1.2', hash: 'b624af09829fb0b4095a37f252f93f6032f087465f5c792cb78b47dc8d9c28c5' },
        ];
        for (const d of DOCS) {
          await client.query(
            `INSERT INTO terms_acceptance (user_id, tenant_id, document_type, version, content_hash, ip, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (user_id, document_type, version) DO NOTHING`,
            [user_id, tenant_id, d.type, d.version, d.hash, request.ip || '0.0.0.0', 'master/manual-create']
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      request.log.error({ err }, '[master/create-tenant] falhou');
      return reply.status(500).send({ error: err.message || 'Falha ao criar tenant' });
    } finally {
      client.release();
    }

    return reply.status(201).send({ tenant_id, user_id, email, active, initial_credits });
  });

  // ── Impersonate: master atua como admin do tenant sem derrubar sessão real ─
  // Retorna um JWT especial com claim `impersonated_by: master_id`. O auth
  // middleware reconhece esse claim e PULA a verificação single-session JTI,
  // ou seja:
  //  - Não toca no `session:{user_id}` do Redis (user real continua logado)
  //  - O master não é derrubado (continua na sua sessão master em outra aba)
  //  - O JWT de impersonate vive por 1h e morre sozinho
  //
  // Audit: cada request com `impersonated_by` carrega esse claim — qualquer
  // mutação fica rastreável (request.user.impersonated_by no audit_log).
  //
  // Frontend deve usar sessionStorage (não localStorage) pra esse token —
  // assim a aba de impersonate é isolada da aba do master.
  fastify.post('/tenants/:id/impersonate', auth(), async (request, reply) => {
    const { id: tenant_id } = request.params;
    const master_id = request.user.user_id;

    const t = await fastify.pg.query(
      `SELECT t.id, t.name, t.module, t.active,
              u.id AS admin_user_id, u.email AS admin_email
       FROM tenants t
       JOIN users u ON u.tenant_id = t.id AND u.role = 'admin' AND u.active = true
       WHERE t.id = $1
       ORDER BY u.created_at LIMIT 1`,
      [tenant_id]
    );
    if (!t.rows[0]) return reply.status(404).send({ error: 'Tenant ou admin ativo não encontrado' });
    const target = t.rows[0];

    if (!target.active) {
      return reply.status(409).send({ error: 'Tenant está inativo — ative antes de impersonar' });
    }

    // JWT separado, jti único, TTL curto (1h). NÃO toca no Redis session do user real.
    const impersonation_jti = randomUUID();
    const token = fastify.jwt.sign({
      user_id:         target.admin_user_id,
      tenant_id:       target.id,
      role:            'admin',
      module:          target.module || 'human',
      jti:             impersonation_jti,
      impersonated_by: master_id,
    }, { expiresIn: '1h' });

    request.log.info(
      { master_id, target_user: target.admin_user_id, target_tenant: target.id, jti: impersonation_jti },
      '[master/impersonate] sessão de impersonate emitida'
    );

    return reply.status(201).send({
      token,
      tenant_id:  target.id,
      tenant_name: target.name,
      tenant_module: target.module,
      user_id:    target.admin_user_id,
      user_email: target.admin_email,
      expires_in_seconds: 3600,
    });
  });

  // ── Gerar link de pagamento Stripe (assinatura ou crédito avulso) ─────────
  // Cria Checkout Session apontando pro tenant existente. Webhook atual já
  // reconhece via metadata.tenant_id (não precisa de ramo novo).
  // Suporta desconto via coupon ad-hoc (1x) ou percent_off por N meses.
  fastify.post('/tenants/:id/payment-link', auth(), async (request, reply) => {
    const { id: tenant_id } = request.params;
    const {
      mode = 'subscription', // 'subscription' ou 'topup'
      discount_percent,      // opcional: 0-100
      duration_months,       // opcional: 1+ (default 'once' se não passar)
      topup_credits,         // só pra mode='topup'
      topup_amount_cents,    // só pra mode='topup' (preço total)
    } = request.body || {};

    if (!['subscription', 'topup'].includes(mode)) {
      return reply.status(400).send({ error: "mode deve ser 'subscription' ou 'topup'" });
    }
    if (discount_percent != null && (discount_percent < 1 || discount_percent > 100)) {
      return reply.status(400).send({ error: 'discount_percent inválido (1-100)' });
    }

    const t = await fastify.pg.query(
      `SELECT t.id, t.name, u.email
       FROM tenants t
       JOIN users u ON u.tenant_id = t.id AND u.role = 'admin' AND u.active = true
       WHERE t.id = $1
       ORDER BY u.created_at LIMIT 1`,
      [tenant_id]
    );
    if (!t.rows[0]) return reply.status(404).send({ error: 'Tenant ou admin não encontrado' });
    const { name: tenantName, email: adminEmail } = t.rows[0];

    const stripeClient = require('../services/stripe-client');
    const stripe = stripeClient.getClient();
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.genomaflow.com.br';

    // Coupon ad-hoc se houver desconto
    let couponId = null;
    if (discount_percent != null && discount_percent > 0) {
      const couponDuration = duration_months && duration_months > 0 ? 'repeating' : 'once';
      const coupon = await stripe.coupons.create({
        percent_off: discount_percent,
        duration: couponDuration,
        ...(couponDuration === 'repeating' ? { duration_in_months: duration_months } : {}),
        name: `Desconto ${discount_percent}% — ${tenantName}`,
        metadata: { tenant_id, master_generated: 'true' },
      });
      couponId = coupon.id;
    }

    // Customer Stripe — busca por email ou cria
    const customer = await stripeClient.findOrCreateCustomer({
      email: adminEmail, name: tenantName, tenantId: tenant_id,
    });

    let session;
    if (mode === 'subscription') {
      const priceId = process.env.STRIPE_PRICE_SUBSCRIPTION;
      if (!priceId) return reply.status(500).send({ error: 'STRIPE_PRICE_SUBSCRIPTION não configurado' });
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customer.id,
        line_items: [{ price: priceId, quantity: 1 }],
        payment_method_types: ['card'],
        client_reference_id: tenant_id,
        metadata: { tenant_id, plan: 'starter', master_generated: 'true' },
        subscription_data: { metadata: { tenant_id } },
        ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
        success_url: `${frontendUrl}/login?activated=true`,
        cancel_url: `${frontendUrl}/login?cancelled=true`,
      });
    } else {
      // topup — créditos avulsos
      if (!topup_credits || !topup_amount_cents) {
        return reply.status(400).send({ error: 'topup_credits e topup_amount_cents obrigatórios em mode=topup' });
      }
      const finalAmount = couponId
        ? Math.round(topup_amount_cents * (1 - discount_percent / 100))
        : topup_amount_cents;
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: customer.id,
        line_items: [{
          price_data: {
            currency: 'brl',
            product_data: { name: `Créditos GenomaFlow (${topup_credits})${discount_percent ? ` — ${discount_percent}% desc` : ''}` },
            unit_amount: finalAmount,
          },
          quantity: 1,
        }],
        payment_method_types: ['card'],
        client_reference_id: tenant_id,
        metadata: { tenant_id, credits: String(topup_credits), kind: 'topup', master_generated: 'true' },
        success_url: `${frontendUrl}/billing?topup=success`,
        cancel_url: `${frontendUrl}/billing?topup=cancel`,
      });
    }

    return reply.status(201).send({
      url: session.url,
      session_id: session.id,
      expires_at: session.expires_at,
      coupon_id: couponId,
      discount_percent: discount_percent || 0,
    });
  });

  // ── Tenant detail (visão consolidada — info, saldo, users) ────────────────
  fastify.get('/tenants/:id/detail', auth(), async (request, reply) => {
    const { id } = request.params;
    const t = await fastify.pg.query(
      `SELECT t.id, t.name, t.module, t.type, t.active, t.created_at
       FROM tenants t WHERE t.id = $1`,
      [id]
    );
    if (!t.rows[0]) return reply.status(404).send({ error: 'Tenant não encontrado' });

    const [bal, users, recent] = await Promise.all([
      fastify.pg.query(
        `SELECT COALESCE(SUM(amount),0)::int AS balance FROM credit_ledger WHERE tenant_id = $1`,
        [id]
      ),
      fastify.pg.query(
        `SELECT id, email, role, specialty, professional_type, active,
                email_verified_at, password_change_required, created_at
         FROM users WHERE tenant_id = $1 AND role != 'master'
         ORDER BY created_at`,
        [id]
      ),
      fastify.pg.query(
        `SELECT id, amount, kind, description, created_at
         FROM credit_ledger WHERE tenant_id = $1
         ORDER BY created_at DESC LIMIT 30`,
        [id]
      ),
    ]);

    return {
      tenant: t.rows[0],
      balance: bal.rows[0].balance,
      users: users.rows,
      credit_history: recent.rows,
    };
  });

  // ── User actions (master gerencia users de qualquer tenant) ───────────────

  // Marca email como verificado (não envia link, master pula a etapa de verificação)
  fastify.post('/users/:userId/verify-email', auth(), async (request, reply) => {
    const { userId } = request.params;
    const { rowCount, rows } = await fastify.pg.query(
      `UPDATE users SET email_verified_at = NOW()
       WHERE id = $1 AND role != 'master' AND email_verified_at IS NULL
       RETURNING id, email, email_verified_at`,
      [userId]
    );
    if (!rowCount) {
      // Pode estar já verificado OU não existe OU é master (não permitido)
      const check = await fastify.pg.query(
        `SELECT id, email, email_verified_at, role FROM users WHERE id = $1`,
        [userId]
      );
      if (!check.rows[0]) return reply.status(404).send({ error: 'Usuário não encontrado' });
      if (check.rows[0].role === 'master') return reply.status(403).send({ error: 'Não permitido em conta master' });
      return reply.status(409).send({ error: 'Email já verificado', user: check.rows[0] });
    }
    return { ok: true, user: rows[0] };
  });

  // Reseta senha (master define ou gera temporária) + opção de forçar troca no 1º login
  fastify.post('/users/:userId/reset-password', auth(), async (request, reply) => {
    const { userId } = request.params;
    const { password, require_change = true } = request.body || {};
    if (!password || typeof password !== 'string' || password.length < 8) {
      return reply.status(400).send({ error: 'password obrigatório (mín 8 caracteres)' });
    }

    const userCheck = await fastify.pg.query(
      `SELECT id, email, role, tenant_id FROM users WHERE id = $1`, [userId]
    );
    if (!userCheck.rows[0]) return reply.status(404).send({ error: 'Usuário não encontrado' });
    if (userCheck.rows[0].role === 'master') {
      return reply.status(403).send({ error: 'Use o fluxo próprio para resetar senha master' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const { rows } = await fastify.pg.query(
      `UPDATE users
         SET password_hash = $1,
             password_change_required = $2
       WHERE id = $3
       RETURNING id, email, password_change_required`,
      [password_hash, !!require_change, userId]
    );

    // Invalida sessão atual (single-session JTI) — força novo login
    try {
      await fastify.redis.del(`session:${userId}`);
    } catch { /* ok */ }

    return { ok: true, user: rows[0] };
  });

  // Força (ou cancela) troca de senha no próximo login — sem mudar a senha
  fastify.patch('/users/:userId/require-password-change', auth(), async (request, reply) => {
    const { userId } = request.params;
    const { required = true } = request.body || {};
    const { rows, rowCount } = await fastify.pg.query(
      `UPDATE users SET password_change_required = $1
       WHERE id = $2 AND role != 'master'
       RETURNING id, email, password_change_required`,
      [!!required, userId]
    );
    if (!rowCount) return reply.status(404).send({ error: 'Usuário não encontrado ou é master' });
    return { ok: true, user: rows[0] };
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  fastify.get('/stats', auth(), async (request, reply) => {
    const [tenants, errors, feedbacks, credits] = await Promise.all([
      fastify.pg.query(`SELECT COUNT(*) FROM tenants WHERE id != '00000000-0000-0000-0000-000000000001'`),
      // Stats só conta erros graves (5xx ou status null) — ignora ruído (401/403/404)
      fastify.pg.query(
        `SELECT COUNT(*) FROM error_log
         WHERE created_at > NOW() - INTERVAL '24 hours'
           AND (status_code IS NULL OR status_code >= 500)`
      ),
      fastify.pg.query(`SELECT COUNT(*) FROM feedback`),
      fastify.pg.query(`SELECT COALESCE(SUM(amount),0) AS total FROM credit_ledger`)
    ]);
    return {
      total_tenants: parseInt(tenants.rows[0].count),
      errors_24h: parseInt(errors.rows[0].count),
      total_feedback: parseInt(feedbacks.rows[0].count),
      total_credits_issued: parseInt(credits.rows[0].total)
    };
  });

  // ── Copilot help analytics ────────────────────────────────────────────────
  fastify.get('/help-analytics', auth(), async (request, reply) => {
    const days = Math.min(90, parseInt(request.query.days) || 30);
    const { rows: topRoutes } = await fastify.pg.query(
      `SELECT route, COUNT(*)::int AS n, AVG(latency_ms)::int AS avg_latency_ms,
              COUNT(*) FILTER (WHERE was_helpful = false)::int AS unhelpful_count
       FROM help_questions
       WHERE created_at > NOW() - INTERVAL '1 day' * $1
       GROUP BY route
       ORDER BY n DESC
       LIMIT 20`,
      [days]
    );
    const { rows: recent } = await fastify.pg.query(
      `SELECT hq.id, hq.route, hq.component, hq.user_role, hq.question, hq.answer_preview,
              hq.was_helpful, hq.created_at, t.name AS tenant_name, u.email AS user_email
       FROM help_questions hq
       LEFT JOIN tenants t ON t.id = hq.tenant_id
       LEFT JOIN users u ON u.id = hq.user_id
       ORDER BY hq.created_at DESC
       LIMIT 100`
    );
    return { top_routes: topRoutes, recent };
  });

  // ── Audit log (todas mutações UI + Copilot + sistema) ─────────────────────
  fastify.get('/audit-log', auth(), async (request, reply) => {
    const q = request.query || {};
    const limit = Math.min(200, Math.max(1, parseInt(q.limit) || 100));
    const days = Math.min(180, Math.max(1, parseInt(q.days) || 30));

    const params = [days];
    const filters = [];
    if (q.entity_type) {
      params.push(String(q.entity_type));
      filters.push(`a.entity_type = $${params.length}`);
    }
    if (q.entity_id) {
      params.push(String(q.entity_id));
      filters.push(`a.entity_id = $${params.length}`);
    }
    if (q.actor_user_id) {
      params.push(String(q.actor_user_id));
      filters.push(`a.actor_user_id = $${params.length}`);
    }
    if (q.actor_channel) {
      params.push(String(q.actor_channel));
      filters.push(`a.actor_channel = $${params.length}`);
    }
    if (q.tenant_id) {
      params.push(String(q.tenant_id));
      filters.push(`a.tenant_id = $${params.length}`);
    }
    if (q.action) {
      params.push(String(q.action));
      filters.push(`a.action = $${params.length}`);
    }
    const whereExtra = filters.length > 0 ? ` AND ${filters.join(' AND ')}` : '';

    const { rows } = await fastify.pg.query(
      `SELECT a.id, a.tenant_id, a.entity_type, a.entity_id, a.action,
              a.actor_user_id, a.actor_channel, a.changed_fields, a.created_at,
              t.name AS tenant_name,
              u.email AS actor_email
       FROM audit_log a
       LEFT JOIN tenants t ON t.id = a.tenant_id
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.created_at > NOW() - INTERVAL '1 day' * $1${whereExtra}
       ORDER BY a.created_at DESC
       LIMIT ${limit}`,
      params
    );
    return { results: rows, filters: q, days, limit };
  });

  // GET /audit-log/:id — detalhes (old_data + new_data) pra drill-down
  fastify.get('/audit-log/:id', auth(), async (request, reply) => {
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `SELECT a.id, a.tenant_id, a.entity_type, a.entity_id, a.action,
              a.actor_user_id, a.actor_channel, a.old_data, a.new_data,
              a.changed_fields, a.created_at,
              t.name AS tenant_name, u.email AS actor_email
       FROM audit_log a
       LEFT JOIN tenants t ON t.id = a.tenant_id
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.id = $1`,
      [id]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Audit entry not found' });
    return rows[0];
  });

  // ── Master broadcasts (canal "Administrador GenomaFlow" → tenants) ───────
  fastify.post('/broadcasts', {
    ...auth(),
    // Body limit alto pra acomodar até 5 anexos de 10MB cada em base64
    // (inflate ~33% = ~67MB em pior caso). Sem isso Fastify rejeita com 413
    // ANTES da nossa validação, perdendo o erro 400 informativo.
    bodyLimit: 80 * 1024 * 1024,
    config: { rateLimit: { max: 20, timeWindow: '1 day' } },
  }, async (request, reply) => {
    const body = (request.body && typeof request.body.body === 'string') ? request.body.body.trim() : '';
    const segment = request.body?.segment;
    const attachmentsInput = Array.isArray(request.body?.attachments) ? request.body.attachments : [];

    // Validação de body
    if (!body) {
      return reply.status(400).send({ error: 'body é obrigatório' });
    }
    if (body.length > BROADCAST_BODY_MAX) {
      return reply.status(400).send({ error: `body excede ${BROADCAST_BODY_MAX} caracteres` });
    }

    // Validação de segment
    if (!segment || typeof segment !== 'object') {
      return reply.status(400).send({ error: 'segment é obrigatório' });
    }
    if (!VALID_SEGMENT_KINDS.includes(segment.kind)) {
      return reply.status(400).send({ error: 'segment.kind inválido' });
    }
    if (segment.kind === 'module' && !VALID_MODULES.includes(segment.value)) {
      return reply.status(400).send({ error: 'segment.value inválido pra kind=module' });
    }
    if (segment.kind === 'tenant' && !segment.value) {
      return reply.status(400).send({ error: 'segment.value obrigatório pra kind=tenant' });
    }

    // Validação de attachments — antes de qualquer query DB ou upload S3
    if (attachmentsInput.length > MAX_ATTACHMENTS) {
      return reply.status(400).send({ error: `máximo ${MAX_ATTACHMENTS} anexos por broadcast` });
    }

    const stagedAttachments = [];
    for (const a of attachmentsInput) {
      if (!a || typeof a !== 'object') {
        return reply.status(400).send({ error: 'anexo inválido' });
      }
      if (!ATTACHMENT_KIND_MIME[a.kind]) {
        return reply.status(400).send({ error: `anexo.kind inválido: ${a.kind}` });
      }
      if (!a.filename || typeof a.filename !== 'string') {
        return reply.status(400).send({ error: 'anexo.filename obrigatório' });
      }
      if (!a.mime_type || !ATTACHMENT_KIND_MIME[a.kind].includes(a.mime_type)) {
        return reply.status(400).send({
          error: `anexo.mime_type inválido pra kind=${a.kind}`,
          allowed: ATTACHMENT_KIND_MIME[a.kind],
        });
      }
      if (!a.data_base64 || typeof a.data_base64 !== 'string') {
        return reply.status(400).send({ error: 'anexo.data_base64 obrigatório' });
      }
      let buf;
      try { buf = Buffer.from(a.data_base64, 'base64'); }
      catch (_) { return reply.status(400).send({ error: 'anexo.data_base64 inválido' }); }
      if (buf.length === 0) return reply.status(400).send({ error: 'anexo vazio' });
      if (buf.length > ATTACHMENT_MAX_BYTES) {
        return reply.status(400).send({ error: `anexo excede 10MB (${a.filename})` });
      }
      stagedAttachments.push({
        kind: a.kind,
        filename: a.filename,
        mime_type: a.mime_type,
        buffer: buf,
        size_bytes: buf.length,
      });
    }

    // Resolve targets (sem tenant_id setado — master vê tudo)
    const targets = await resolveTargetTenants(fastify.pg, segment);
    if (targets.length === 0) {
      return reply.status(400).send({ error: 'Nenhum tenant elegível pra esse segmento' });
    }

    // INSERT canonical broadcast row (sem RLS context — master-only policy permite)
    const { rows: [bc] } = await fastify.pg.query(
      `INSERT INTO master_broadcasts (sender_user_id, body, segment_kind, segment_value, recipient_count)
       VALUES ($1, $2, $3, $4, 0)
       RETURNING id, created_at`,
      [request.user.user_id, body, segment.kind, segment.value || null]
    );

    // Upload attachments to S3 once + INSERT canonical rows (compartilhados
    // entre tenants — 1 S3 obj p/ N entregas)
    const uploadedAttachments = [];
    for (const sa of stagedAttachments) {
      const ext = sa.filename.split('.').pop() || (sa.kind === 'pdf' ? 'pdf' : 'jpg');
      const safeName = `${crypto.randomUUID()}.${ext}`;
      const s3Key = `master-broadcasts/${bc.id}/${safeName}`;
      try {
        await uploadFile(s3Key, sa.buffer, sa.mime_type);
      } catch (err) {
        request.log.error({ err, broadcast_id: bc.id, filename: sa.filename }, 'master broadcast s3 upload failed');
        return reply.status(500).send({ error: 'Falha ao subir anexo para storage' });
      }
      const { rows: [att] } = await fastify.pg.query(
        `INSERT INTO master_broadcast_attachments (broadcast_id, kind, filename, s3_key, size_bytes, mime_type)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [bc.id, sa.kind, sa.filename, s3Key, sa.size_bytes, sa.mime_type]
      );
      uploadedAttachments.push({ id: att.id, kind: sa.kind, filename: sa.filename, s3_key: s3Key, size_bytes: sa.size_bytes });
    }

    // Fan-out síncrono — pra cada tenant, withTenant cria conv+msg+delivery.
    // RLS context = MASTER_TENANT_ID porque master é o sender em tenant_messages
    // (tm_insert exige sender_tenant_id = app.tenant_id). Master também é
    // tenant_a_id na conversa, então tc_insert passa. As policies master-only
    // (mb/mba/mbd) aceitam master tenant id via 059.
    let delivered = 0;
    for (const t of targets) {
      try {
        const { conversationId, messageId } = await withTenant(
          fastify.pg, MASTER_TENANT_ID,
          (client) => deliverToTenant(client, {
            broadcastId: bc.id,
            masterUserId: request.user.user_id,
            recipientTenant: t,
            body,
            attachments: uploadedAttachments,
            pg: fastify.pg,
          }),
          { userId: request.user.user_id, channel: 'system' }
        );
        delivered += 1;

        // WS notify via Redis pub/sub — usa os MESMOS nomes de evento do chat
        // existente (chat:message_received + chat:unread_change) pra que o
        // WsService → app.component.refreshChatUnread → badge global no menu
        // lateral atualize. Evento dedicado novo NÃO é escutado em lugar
        // nenhum no front.
        const previewBase = body.length > 80 ? body.slice(0, 77) + '...' : body;
        const preview = uploadedAttachments.length > 0
          ? (previewBase || '[anexo]')
          : previewBase;
        await fastify.redis.publish(
          `chat:event:${t.id}`,
          JSON.stringify({
            event: 'chat:message_received',
            conversation_id: conversationId,
            message_id: messageId,
            sender_tenant_id: MASTER_TENANT_ID,
            body_preview: preview,
            created_at: new Date().toISOString(),
          })
        );
        await fastify.redis.publish(
          `chat:event:${t.id}`,
          JSON.stringify({
            event: 'chat:unread_change',
            conversation_id: conversationId,
            delta: 1,
          })
        );
      } catch (err) {
        request.log.error({ err, tenant_id: t.id, broadcast_id: bc.id }, 'master broadcast delivery failed');
      }
    }

    // Atualiza recipient_count com o que foi efetivamente entregue
    await fastify.pg.query(
      'UPDATE master_broadcasts SET recipient_count = $1 WHERE id = $2',
      [delivered, bc.id]
    );

    return {
      broadcast_id: bc.id,
      recipient_count: delivered,
      target_count: targets.length,
      created_at: bc.created_at,
    };
  });

  // GET /master/broadcasts — histórico paginado com métricas (lidos/total)
  fastify.get('/broadcasts', auth(), async (request, reply) => {
    const days = Math.min(180, Math.max(1, parseInt(request.query?.days) || 90));
    const limit = Math.min(200, Math.max(1, parseInt(request.query?.limit) || 50));

    const { rows } = await fastify.pg.query(
      `SELECT
         mb.id, mb.body, mb.segment_kind, mb.segment_value, mb.recipient_count,
         mb.created_at, u.email AS sender_email,
         COUNT(DISTINCT mbd.tenant_id) FILTER (
           WHERE tcr.last_read_at >= mbd.delivered_at
         )::int AS read_count,
         (SELECT COUNT(*)::int FROM master_broadcast_attachments mba
           WHERE mba.broadcast_id = mb.id) AS attachment_count
       FROM master_broadcasts mb
       JOIN users u ON u.id = mb.sender_user_id
       LEFT JOIN master_broadcast_deliveries mbd ON mbd.broadcast_id = mb.id
       LEFT JOIN tenant_conversation_reads tcr
         ON tcr.conversation_id = mbd.conversation_id AND tcr.tenant_id = mbd.tenant_id
       WHERE mb.created_at > NOW() - INTERVAL '1 day' * $1
       GROUP BY mb.id, u.email
       ORDER BY mb.created_at DESC
       LIMIT $2`,
      [days, limit]
    );
    return { results: rows, days, limit };
  });

  // GET /master/broadcasts/:id — detalhe + lista de tenants e flag lido
  fastify.get('/broadcasts/:id', auth(), async (request, reply) => {
    const { id } = request.params;
    const { rows: broadcast } = await fastify.pg.query(
      `SELECT mb.id, mb.body, mb.segment_kind, mb.segment_value, mb.recipient_count,
              mb.created_at, u.email AS sender_email
       FROM master_broadcasts mb
       JOIN users u ON u.id = mb.sender_user_id
       WHERE mb.id = $1`,
      [id]
    );
    if (broadcast.length === 0) return reply.status(404).send({ error: 'Broadcast não encontrado' });

    const { rows: deliveries } = await fastify.pg.query(
      `SELECT mbd.tenant_id, t.name AS tenant_name, t.module,
              mbd.conversation_id, mbd.message_id, mbd.delivered_at,
              (tcr.last_read_at >= mbd.delivered_at) AS read_by_tenant,
              tcr.last_read_at
       FROM master_broadcast_deliveries mbd
       JOIN tenants t ON t.id = mbd.tenant_id
       LEFT JOIN tenant_conversation_reads tcr
         ON tcr.conversation_id = mbd.conversation_id AND tcr.tenant_id = mbd.tenant_id
       WHERE mbd.broadcast_id = $1
       ORDER BY t.name`,
      [id]
    );

    const { rows: attachments } = await fastify.pg.query(
      `SELECT id, kind, filename, mime_type, size_bytes, created_at
       FROM master_broadcast_attachments WHERE broadcast_id = $1
       ORDER BY created_at`,
      [id]
    );

    return { ...broadcast[0], deliveries, attachments };
  });

  // GET /master/conversations — inbox de master_broadcast conversations com unread reply count
  fastify.get('/conversations', auth(), async (request, reply) => {
    const { rows } = await fastify.pg.query(
      `SELECT c.id AS conversation_id,
              c.tenant_b_id AS tenant_id,
              t.name AS tenant_name, t.module,
              c.last_message_at, c.created_at,
              (SELECT body FROM tenant_messages
                WHERE conversation_id = c.id AND deleted_at IS NULL
                ORDER BY created_at DESC LIMIT 1) AS last_message_preview,
              (SELECT sender_tenant_id FROM tenant_messages
                WHERE conversation_id = c.id AND deleted_at IS NULL
                ORDER BY created_at DESC LIMIT 1) AS last_sender_tenant_id,
              (SELECT count(*)::int FROM tenant_messages tm
                WHERE tm.conversation_id = c.id
                  AND tm.sender_tenant_id <> $1
                  AND tm.deleted_at IS NULL
                  AND tm.created_at > COALESCE(
                    (SELECT last_read_at FROM tenant_conversation_reads
                       WHERE conversation_id = c.id AND tenant_id = $1),
                    '1970-01-01'::timestamptz
                  )
              ) AS unread_count
       FROM tenant_conversations c
       JOIN tenants t ON t.id = c.tenant_b_id
       WHERE c.kind = 'master_broadcast' AND c.tenant_a_id = $1
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
       LIMIT 200`,
      [MASTER_TENANT_ID]
    );
    return { results: rows };
  });

  // GET /master/conversations/:id/messages — thread completa pra master visualizar
  fastify.get('/conversations/:id/messages', auth(), async (request, reply) => {
    const { id } = request.params;
    const limit = Math.min(200, Math.max(1, parseInt(request.query?.limit) || 100));

    // Confirma que a conversa é master_broadcast antes de devolver
    const { rows: conv } = await fastify.pg.query(
      `SELECT id, kind FROM tenant_conversations WHERE id = $1 AND kind = 'master_broadcast'`,
      [id]
    );
    if (conv.length === 0) return reply.status(404).send({ error: 'Conversa master não encontrada' });

    const { rows } = await fastify.pg.query(
      `SELECT m.id, m.conversation_id, m.sender_tenant_id, m.sender_user_id,
              m.body, m.has_attachment, m.created_at,
              COALESCE(
                (SELECT jsonb_agg(jsonb_build_object(
                  'id', a.id, 'kind', a.kind, 's3_key', a.s3_key,
                  'original_size_bytes', a.original_size_bytes
                ))
                 FROM tenant_message_attachments a WHERE a.message_id = m.id),
                '[]'::jsonb
              ) AS attachments
       FROM tenant_messages m
       WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
       ORDER BY m.created_at ASC
       LIMIT $2`,
      [id, limit]
    );
    return { results: rows };
  });

  // ── Aesthetic Treatments — catálogo global (master CRUD) ─────────────────
  //
  // Rows globais têm tenant_id = NULL (catálogo GenomaFlow curado pelo master).
  // Rows proprietárias (tenant_id != NULL) são geridas pelo admin do próprio tenant.
  // Master pode listar tudo (global + tenant), mas só edita/deleta rows globais.
  //
  // Audit trail: usa withTenant(MASTER_TENANT_ID) pra audit_trigger_fn não violar
  // NOT NULL de audit_log.tenant_id. A migration 094 também adiciona fallback
  // NULL→MASTER_TENANT_ID direto na função de trigger como defesa em profundidade.

  const aestheticTreatmentsService = require('../services/aesthetic-treatments');

  // GET /master/aesthetic-treatments?category=&active=
  // Lista todos (global + tenant). Default = só ativos. active=false ou active=all = inclui inativos.
  fastify.get('/aesthetic-treatments', auth(), async (request, reply) => {
    const { category, active } = request.query;
    const params = [];
    const conditions = [];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    // active=all ou active=false → inclui inativos; default (undefined/true) → só ativos
    if (active !== 'all' && active !== 'false') {
      conditions.push('is_active = true');
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    const { rows } = await fastify.pg.query(
      `SELECT id, tenant_id, name, category, indications, contraindications,
              typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
              evidence_level, description, protocol_notes, requires_medico, is_active,
              usage_count_30d, created_at, updated_at
       FROM aesthetic_treatments
       WHERE ${where}
       ORDER BY tenant_id NULLS FIRST, name ASC
       LIMIT 500`,
      params
    );
    return reply.send({ items: rows });
  });

  // POST /master/aesthetic-treatments
  // Cria row global (tenant_id = NULL hardcoded).
  fastify.post('/aesthetic-treatments', auth(), async (request, reply) => {
    const err = aestheticTreatmentsService.validate(request.body);
    if (err) return reply.status(400).send({ error: err });

    const body = request.body;

    const row = await withTenant(
      fastify.pg,
      MASTER_TENANT_ID,
      async (client) => {
        const { rows } = await client.query(
          `INSERT INTO aesthetic_treatments
             (tenant_id, name, category, indications, contraindications,
              typical_sessions, interval_days, cost_estimate_brl_min, cost_estimate_brl_max,
              evidence_level, description, protocol_notes, requires_medico)
           VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [
            body.name.slice(0, 200),
            body.category,
            body.indications || [],
            body.contraindications || [],
            body.typical_sessions || null,
            body.interval_days || null,
            body.cost_estimate_brl_min || null,
            body.cost_estimate_brl_max || null,
            body.evidence_level || null,
            body.description ? body.description.slice(0, 2000) : null,
            body.protocol_notes ? body.protocol_notes.slice(0, 2000) : null,
            !!body.requires_medico,
          ]
        );
        return rows[0];
      },
      { userId: request.user.user_id, channel: 'ui' }
    );

    return reply.status(201).send(row);
  });

  // PUT /master/aesthetic-treatments/:id
  // Atualiza row global (tenant_id IS NULL). 404 se row é proprietária de tenant.
  fastify.put('/aesthetic-treatments/:id', auth(), async (request, reply) => {
    const { id } = request.params;
    const body = request.body || {};

    // Validação parcial — só valida campos enviados
    if (body.category !== undefined &&
        !aestheticTreatmentsService.VALID_CATEGORIES.has(body.category)) {
      return reply.status(400).send({ error: 'category inválido' });
    }
    if (body.evidence_level !== undefined && body.evidence_level !== null &&
        !aestheticTreatmentsService.VALID_EVIDENCE.has(body.evidence_level)) {
      return reply.status(400).send({ error: 'evidence_level inválido (A|B|C|D)' });
    }

    const row = await withTenant(
      fastify.pg,
      MASTER_TENANT_ID,
      async (client) => {
        const { rows } = await client.query(
          `UPDATE aesthetic_treatments SET
             name               = COALESCE($2, name),
             category           = COALESCE($3, category),
             indications        = COALESCE($4, indications),
             contraindications  = COALESCE($5, contraindications),
             typical_sessions   = COALESCE($6, typical_sessions),
             interval_days      = COALESCE($7, interval_days),
             cost_estimate_brl_min = COALESCE($8, cost_estimate_brl_min),
             cost_estimate_brl_max = COALESCE($9, cost_estimate_brl_max),
             evidence_level     = COALESCE($10, evidence_level),
             description        = COALESCE($11, description),
             protocol_notes     = COALESCE($12, protocol_notes),
             requires_medico    = COALESCE($13, requires_medico),
             updated_at         = NOW()
           WHERE id = $1 AND tenant_id IS NULL
           RETURNING *`,
          [
            id,
            body.name ? body.name.slice(0, 200) : null,
            body.category || null,
            Array.isArray(body.indications) ? body.indications : null,
            Array.isArray(body.contraindications) ? body.contraindications : null,
            body.typical_sessions ?? null,
            body.interval_days ?? null,
            body.cost_estimate_brl_min ?? null,
            body.cost_estimate_brl_max ?? null,
            body.evidence_level ?? null,
            body.description ? body.description.slice(0, 2000) : null,
            body.protocol_notes ? body.protocol_notes.slice(0, 2000) : null,
            typeof body.requires_medico === 'boolean' ? body.requires_medico : null,
          ]
        );
        return rows[0] || null;
      },
      { userId: request.user.user_id, channel: 'ui' }
    );

    if (!row) return reply.status(404).send({ error: 'Tratamento global não encontrado' });
    return reply.send(row);
  });

  // DELETE /master/aesthetic-treatments/:id
  // Soft delete (is_active = false). Só rows globais (tenant_id IS NULL).
  fastify.delete('/aesthetic-treatments/:id', auth(), async (request, reply) => {
    const { id } = request.params;

    const deleted = await withTenant(
      fastify.pg,
      MASTER_TENANT_ID,
      async (client) => {
        const { rowCount } = await client.query(
          `UPDATE aesthetic_treatments
             SET is_active = false, updated_at = NOW()
           WHERE id = $1 AND tenant_id IS NULL AND is_active = true`,
          [id]
        );
        return rowCount > 0;
      },
      { userId: request.user.user_id, channel: 'ui' }
    );

    if (!deleted) return reply.status(404).send({ error: 'Tratamento global não encontrado ou já inativo' });
    return reply.status(204).send();
  });

  // POST /master/conversations/:id/reply — master responde diretamente em uma
  // conversation existente (sem criar broadcast canonical row). Útil pra
  // responder solicitações de melhoria de tenants individuais.
  fastify.post('/conversations/:id/reply', {
    ...auth(),
    config: { rateLimit: { max: 100, timeWindow: '1 day' } },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = (request.body && typeof request.body.body === 'string') ? request.body.body.trim() : '';
    if (!body) return reply.status(400).send({ error: 'body é obrigatório' });
    if (body.length > BROADCAST_BODY_MAX) {
      return reply.status(400).send({ error: `body excede ${BROADCAST_BODY_MAX} caracteres` });
    }

    const { rows: conv } = await fastify.pg.query(
      `SELECT id, tenant_b_id FROM tenant_conversations
       WHERE id = $1 AND kind = 'master_broadcast' AND tenant_a_id = $2`,
      [id, MASTER_TENANT_ID]
    );
    if (conv.length === 0) return reply.status(404).send({ error: 'Conversa master não encontrada' });
    const recipientTenantId = conv[0].tenant_b_id;

    const result = await withTenant(
      fastify.pg, MASTER_TENANT_ID,
      async (client) => {
        const msgRes = await client.query(
          `INSERT INTO tenant_messages (conversation_id, sender_tenant_id, sender_user_id, body)
           VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
          [id, MASTER_TENANT_ID, request.user.user_id, body]
        );
        await client.query(
          'UPDATE tenant_conversations SET last_message_at = NOW() WHERE id = $1',
          [id]
        );
        return msgRes.rows[0];
      },
      { userId: request.user.user_id, channel: 'system' }
    );

    // WS notify pro recipient — usa eventos do chat existente pra que badge
    // global e sidebar atualizem (igual fan-out do POST /broadcasts).
    const previewBase = body.length > 80 ? body.slice(0, 77) + '...' : body;
    await fastify.redis.publish(
      `chat:event:${recipientTenantId}`,
      JSON.stringify({
        event: 'chat:message_received',
        conversation_id: id,
        message_id: result.id,
        sender_tenant_id: MASTER_TENANT_ID,
        body_preview: previewBase,
        created_at: result.created_at,
      })
    );
    await fastify.redis.publish(
      `chat:event:${recipientTenantId}`,
      JSON.stringify({
        event: 'chat:unread_change',
        conversation_id: id,
        delta: 1,
      })
    );

    return { message_id: result.id, created_at: result.created_at };
  });
};
