'use strict';

/**
 * Webhook receiver Trello + dispatch BullMQ.
 *
 * Suporta 3 colunas / 3 prefixos de slash command (mesma lógica de fix
 * agent, só varia o "kind" no job data pra tracking + futuros prompts
 * especializados):
 *   - QA            → /fix      (kind=qa)
 *   - Ideias        → /ideia    (kind=ideia)
 *   - Roadmap       → /roadmap  (kind=roadmap)
 *
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §3
 */

const { verifyWebhookSignature } = require('../../services/trello-client');
const { enqueue } = require('../../queues/trello-qa-queue');

// Mapping: prefix de slash command → "kind". Mesmas subcommands (aprovado/retry/detalhe/cancel)
// pra todos os 3 prefixos.
const SLASH_COMMAND_RE = /^\/(fix|ideia|roadmap)\s+(aprovado|retry|detalhe|cancel)(?::\s*(.+))?$/i;
const PREFIX_TO_KIND = { fix: 'qa', ideia: 'ideia', roadmap: 'roadmap' };

function _resolveKind(listId) {
  if (listId === process.env.TRELLO_QA_LIST_ID) return 'qa';
  if (listId === process.env.TRELLO_IDEIAS_LIST_ID) return 'ideia';
  if (listId === process.env.TRELLO_ROADMAP_LIST_ID) return 'roadmap';
  return null;
}

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

    // Event 1: card movido pra uma das 3 listas monitoradas → triage
    if (action.type === 'updateCard' && action.data.listAfter) {
      const kind = _resolveKind(action.data.listAfter.id);
      if (kind) {
        await enqueue({
          event: 'triage',
          kind,
          card_id: card.id,
          card_short_id: String(card.idShort),
          action_id: actionId,
          triggered_by: member,
        });
        return reply.send({ ok: true, queued: 'triage', kind });
      }
      // Lista não monitorada — ignorar
    }

    // Event 2: comment /fix|/ideia|/roadmap em qualquer card
    if (action.type === 'commentCard' && action.data.text) {
      const text = String(action.data.text).trim();
      const m = SLASH_COMMAND_RE.exec(text);
      if (!m) return reply.send({ ok: true, ignored: 'not_slash_command' });

      const prefix = m[1].toLowerCase();
      const subcommand = m[2].toLowerCase();
      const hint = (m[3] || '').trim() || undefined;
      const kind = PREFIX_TO_KIND[prefix];

      await enqueue({
        event: 'fix',
        kind,
        command_prefix: prefix,  // pra montar mensagens de retorno com o prefix certo
        card_id: card.id,
        card_short_id: String(card.idShort),
        action_id: actionId,
        slash_command: subcommand,
        hint,
        member_username: member,
        triggered_by: member,
      });
      return reply.send({ ok: true, queued: 'fix', kind, subcommand });
    }

    return reply.send({ ok: true, ignored: 'unhandled_action_type' });
  });
};
