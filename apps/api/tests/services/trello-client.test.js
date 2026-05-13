// apps/api/tests/services/trello-client.test.js
'use strict';
const { describe, test, expect, beforeEach } = require('@jest/globals');

const mockFetch = jest.fn();
global.fetch = mockFetch;

const {
  verifyWebhookSignature, getCard, addComment, addLabel, getCardComments,
} = require('../../src/services/trello-client');

beforeEach(() => {
  mockFetch.mockReset();
  process.env.TRELLO_API_KEY = 'fake-key';
  process.env.TRELLO_API_TOKEN = 'fake-token';
  process.env.TRELLO_WEBHOOK_SECRET = 'secret-shared';
});

describe('verifyWebhookSignature', () => {
  test('signature válida retorna true', () => {
    const callbackUrl = 'https://app.genomaflow.com.br/api/webhooks/trello';
    const body = '{"hello":"world"}';
    const crypto = require('crypto');
    const expected = crypto
      .createHmac('sha1', 'secret-shared')
      .update(body + callbackUrl)
      .digest('base64');

    expect(verifyWebhookSignature({
      body, signature: expected, callbackUrl,
    })).toBe(true);
  });

  test('signature inválida retorna false', () => {
    expect(verifyWebhookSignature({
      body: '{}', signature: 'wrong', callbackUrl: 'x',
    })).toBe(false);
  });

  test('signature ausente retorna false', () => {
    expect(verifyWebhookSignature({
      body: '{}', signature: '', callbackUrl: 'x',
    })).toBe(false);
  });
});

describe('getCard', () => {
  test('GET /cards/:id?fields=...', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'c1', name: 'Bug X', desc: 'detalhes...' }),
    });
    const card = await getCard('c1');
    expect(card.name).toBe('Bug X');
    expect(mockFetch.mock.calls[0][0]).toMatch(/cards\/c1\?key=fake-key&token=fake-token/);
  });

  test('throw em status não-OK', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'not found',
    });
    await expect(getCard('nope')).rejects.toThrow(/404/);
  });
});

describe('addComment', () => {
  test('POST /cards/:id/actions/comments com text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'comment-1' }),
    });
    const r = await addComment('c1', 'olá!');
    expect(r.id).toBe('comment-1');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    expect(mockFetch.mock.calls[0][0]).toMatch(/cards\/c1\/actions\/comments/);
  });

  test('truncate comentário > 16384 chars (limite Trello)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'c' }) });
    const longText = 'x'.repeat(20000);
    await addComment('c1', longText);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text.length).toBeLessThanOrEqual(16384);
  });
});

describe('addLabel', () => {
  test('POST /cards/:id/idLabels', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await addLabel('c1', 'label-abc');
    expect(mockFetch.mock.calls[0][0]).toMatch(/cards\/c1\/idLabels/);
  });
});

describe('getCardComments', () => {
  test('GET /cards/:id/actions?filter=commentCard', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { id: 'a1', data: { text: '/fix aprovado' }, memberCreator: { username: 'dev1' } },
      ]),
    });
    const c = await getCardComments('c1');
    expect(c.length).toBe(1);
    expect(c[0].data.text).toBe('/fix aprovado');
  });
});
