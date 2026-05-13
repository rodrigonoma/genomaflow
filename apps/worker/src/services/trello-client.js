'use strict';

/**
 * Trello REST client wrapper. Sem lib oficial Node confiável — usa fetch direto.
 *
 * DUPLICATA controlada de apps/api/src/services/trello-client.js.
 * Containers Docker isolados (API + Worker) → mesma lógica copiada em ambos.
 * Se editar um, editar o outro. Tests cobrem o lado API
 * (apps/api/tests/services/trello-client.test.js); este lado é pure-copy.
 *
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §4
 */

const crypto = require('crypto');

const TRELLO_BASE = 'https://api.trello.com/1';
const COMMENT_MAX_LENGTH = 16384;

function _credentials() {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_API_TOKEN;
  if (!key || !token) throw new Error('TRELLO_API_KEY/TOKEN não configurados');
  return { key, token };
}

function _authQuery() {
  const { key, token } = _credentials();
  return `key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
}

function verifyWebhookSignature({ body, signature, callbackUrl }) {
  const secret = process.env.TRELLO_WEBHOOK_SECRET;
  if (!secret || !signature || !body || !callbackUrl) return false;
  const expected = crypto
    .createHmac('sha1', secret)
    .update(body + callbackUrl)
    .digest('base64');
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function _request(path, opts = {}) {
  const auth = _authQuery();
  const urlFinal = path.includes('?')
    ? `${TRELLO_BASE}${path.replace('?', `?${auth}&`)}`
    : `${TRELLO_BASE}${path}?${auth}`;
  const res = await fetch(urlFinal, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    method: opts.method || 'GET',
    body: opts.body || undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Trello API ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.json();
}

async function getCard(cardId) {
  const id = encodeURIComponent(cardId);
  return await _request(`/cards/${id}?fields=id,idShort,name,desc,idBoard,idList,labels`);
}

async function getCardComments(cardId) {
  const id = encodeURIComponent(cardId);
  return await _request(`/cards/${id}/actions?filter=commentCard&limit=50`);
}

async function addComment(cardId, text) {
  const id = encodeURIComponent(cardId);
  const truncated = text.length > COMMENT_MAX_LENGTH
    ? text.slice(0, COMMENT_MAX_LENGTH - 100) + '\n\n... [truncado]'
    : text;
  return await _request(`/cards/${id}/actions/comments`, {
    method: 'POST',
    body: JSON.stringify({ text: truncated }),
  });
}

async function addLabel(cardId, labelId) {
  const id = encodeURIComponent(cardId);
  return await _request(`/cards/${id}/idLabels`, {
    method: 'POST',
    body: JSON.stringify({ value: labelId }),
  });
}

async function listBoardLabels(boardId) {
  const id = encodeURIComponent(boardId);
  return await _request(`/boards/${id}/labels`);
}

module.exports = {
  verifyWebhookSignature,
  getCard,
  getCardComments,
  addComment,
  addLabel,
  listBoardLabels,
  COMMENT_MAX_LENGTH,
};
