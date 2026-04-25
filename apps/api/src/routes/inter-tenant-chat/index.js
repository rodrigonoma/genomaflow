/**
 * Plugin raiz do chat entre tenants. Registra os sub-recursos sob /inter-tenant-chat.
 *
 * Spec: docs/superpowers/specs/2026-04-23-inter-tenant-chat-design.md
 * Plano Phase 2: docs/superpowers/plans/2026-04-23-inter-tenant-chat-phase2.md
 */
module.exports = async function (fastify) {
  fastify.register(require('./settings'),      { prefix: '/settings' });
  fastify.register(require('./directory'),     { prefix: '/directory' });
  fastify.register(require('./invitations'),   { prefix: '/invitations' });
  fastify.register(require('./blocks'),        { prefix: '/blocks' });
  fastify.register(require('./conversations'), { prefix: '/conversations' });
  fastify.register(require('./messages'),      { prefix: '' });
  fastify.register(require('./reads'),         { prefix: '' });
  fastify.register(require('./reports'),       { prefix: '/reports' });
  fastify.register(require('./image-redact'),  { prefix: '/images' });
};
