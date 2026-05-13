'use strict';

/**
 * Webhook receiver Trello + dispatch BullMQ.
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §3
 */

const { verifyWebhookSignature } = require('../../services/trello-client');
const { enqueue } = require('../../queues/trello-qa-queue');

const SLASH_COMMAND_RE = /^\/fix\s+(aprovado|retry|detalhe|cancel)(?::\s*(.+))?$/i;

module.exports = async function (fastify) {
  fastify.get('/trello', async () => ({ ok: true }));
  fastify.head('/trello', async (request, reply) => reply.code(200).send());

  fastify.post('/trello', {
    config: { rateLimit: { max: 600, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const signature = request.headers['x-trello-webhook'];
    if (!signature || typeof signature !== 'string') {
      return reply.status(401).send({ error: 'MISSING_SIGNATURE' });
    }

    // HMAC do Trello é calculado sobre os bytes exatos do request body. Usar
    // JSON.stringify(request.body) re-serializa e pode quebrar a assinatura
    // por ordem de chaves/whitespace diferente do que o Trello enviou. server.js
    // já expõe request.rawBody (Buffer com bytes originais) — preferir esse.
    const rawBody = request.rawBody
      ? request.rawBody.toString('utf8')
      : (typeof request.body === 'string' ? request.body : JSON.stringify(request.body));
    const callbackUrl = process.env.WEBHOOK_CALLBACK_URL;

    if (!verifyWebhookSignature({ body: rawBody, signature, callbackUrl })) {
      return reply.status(401).send({ error: 'INVALID_SIGNATURE' });
    }

    const action = request.body?.action;
    if (!action || !action.data?.card) {
      return reply.status(200).send({ ok: true, ignored: true });
    }

    const card = action.data.card;
    const member = action.memberCreator?.username || 'unknown';
    const actionId = action.id;
    const QA_LIST_ID = process.env.TRELLO_QA_LIST_ID;

    if (action.type === 'updateCard'
        && action.data.listAfter
        && action.data.listAfter.id === QA_LIST_ID) {
      await enqueue({
        event: 'triage',
        card_id: card.id,
        card_short_id: String(card.idShort),
        action_id: actionId,
        triggered_by: member,
      });
      return reply.send({ ok: true, queued: 'triage' });
    }

    if (action.type === 'commentCard' && action.data.text) {
      const text = String(action.data.text).trim();
      const m = SLASH_COMMAND_RE.exec(text);
      if (!m) return reply.send({ ok: true, ignored: 'not_slash_command' });

      const subcommand = m[1].toLowerCase();
      const hint = (m[2] || '').trim() || undefined;
      await enqueue({
        event: 'fix',
        card_id: card.id,
        card_short_id: String(card.idShort),
        action_id: actionId,
        slash_command: subcommand,
        hint,
        member_username: member,
        triggered_by: member,
      });
      return reply.send({ ok: true, queued: 'fix', subcommand });
    }

    return reply.send({ ok: true, ignored: 'unhandled_action_type' });
  });
};
