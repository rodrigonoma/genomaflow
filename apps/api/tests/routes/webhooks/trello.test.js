'use strict';
const { describe, test, expect, beforeEach } = require('@jest/globals');
const Fastify = require('fastify');
const crypto = require('crypto');

const mockEnqueue = jest.fn();
jest.mock('../../../src/queues/trello-qa-queue', () => ({
  enqueue: (...args) => mockEnqueue(...args),
}));

function signBody(body, callbackUrl, secret) {
  return crypto.createHmac('sha1', secret).update(body + callbackUrl).digest('base64');
}

async function buildApp() {
  mockEnqueue.mockReset();
  mockEnqueue.mockResolvedValue({ id: 'job1' });

  process.env.TRELLO_WEBHOOK_SECRET = 'sec';
  process.env.TRELLO_QA_LIST_ID = 'list-qa';
  process.env.TRELLO_API_KEY = 'k';
  process.env.TRELLO_API_TOKEN = 't';
  process.env.WEBHOOK_CALLBACK_URL = 'https://app.example.com/api/webhooks/trello';

  const app = Fastify({ logger: false });
  await app.register(require('../../../src/routes/webhooks/trello'), { prefix: '/api/webhooks' });
  return app;
}

describe('GET /api/webhooks/trello — healthcheck', () => {
  test('200 OK (Trello verifica endpoint na criação do webhook)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/webhooks/trello' });
    expect(res.statusCode).toBe(200);
  });

  test('HEAD também responde', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'HEAD', url: '/api/webhooks/trello' });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/webhooks/trello — signature', () => {
  test('401 sem header X-Trello-Webhook', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: { action: {} },
    });
    expect(res.statusCode).toBe(401);
  });

  test('401 assinatura inválida', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: { action: {} },
      headers: { 'x-trello-webhook': 'wrong-sig' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('200 + enqueue triage quando card movido pra coluna QA', async () => {
    const app = await buildApp();
    const body = {
      action: {
        id: 'action-1',
        type: 'updateCard',
        data: {
          card: { id: 'card-1', idShort: 42, name: 'Bug X' },
          listAfter: { id: 'list-qa' },
          listBefore: { id: 'list-todo' },
        },
        memberCreator: { username: 'qa1' },
      },
    };
    const bodyStr = JSON.stringify(body);
    const sig = signBody(bodyStr, process.env.WEBHOOK_CALLBACK_URL, 'sec');

    const res = await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: bodyStr,
      headers: {
        'content-type': 'application/json',
        'x-trello-webhook': sig,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      event: 'triage',
      card_id: 'card-1',
      card_short_id: '42',
      action_id: 'action-1',
    }));
  });

  test('200 SEM enqueue se card moveu pra coluna diferente de QA', async () => {
    const app = await buildApp();
    const body = {
      action: {
        id: 'a2', type: 'updateCard',
        data: {
          card: { id: 'c2', idShort: 43, name: 'X' },
          listAfter: { id: 'list-DONE' },
          listBefore: { id: 'list-qa' },
        },
        memberCreator: { username: 'x' },
      },
    };
    const bodyStr = JSON.stringify(body);
    const sig = signBody(bodyStr, process.env.WEBHOOK_CALLBACK_URL, 'sec');
    const res = await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: bodyStr,
      headers: { 'content-type': 'application/json', 'x-trello-webhook': sig },
    });
    expect(res.statusCode).toBe(200);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test('200 + enqueue fix quando comentário /fix aprovado', async () => {
    const app = await buildApp();
    const body = {
      action: {
        id: 'a3', type: 'commentCard',
        data: {
          card: { id: 'c3', idShort: 50, name: 'Y' },
          text: '/fix aprovado',
        },
        memberCreator: { username: 'po1' },
      },
    };
    const bodyStr = JSON.stringify(body);
    const sig = signBody(bodyStr, process.env.WEBHOOK_CALLBACK_URL, 'sec');
    const res = await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: bodyStr,
      headers: { 'content-type': 'application/json', 'x-trello-webhook': sig },
    });
    expect(res.statusCode).toBe(200);
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      event: 'fix',
      slash_command: 'aprovado',
      member_username: 'po1',
    }));
  });

  test('parse /fix retry: hint extrai hint', async () => {
    const app = await buildApp();
    const body = {
      action: {
        id: 'a4', type: 'commentCard',
        data: {
          card: { id: 'c4', idShort: 51, name: 'Z' },
          text: '/fix retry: usar getById em vez de getByName',
        },
        memberCreator: { username: 'dev' },
      },
    };
    const bodyStr = JSON.stringify(body);
    const sig = signBody(bodyStr, process.env.WEBHOOK_CALLBACK_URL, 'sec');
    await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: bodyStr,
      headers: { 'content-type': 'application/json', 'x-trello-webhook': sig },
    });
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      event: 'fix',
      slash_command: 'retry',
      hint: 'usar getById em vez de getByName',
    }));
  });

  test('comentário SEM /fix → não enqueue', async () => {
    const app = await buildApp();
    const body = {
      action: {
        id: 'a5', type: 'commentCard',
        data: { card: { id: 'c5', idShort: 52, name: 'W' }, text: 'comentário normal' },
        memberCreator: { username: 'x' },
      },
    };
    const bodyStr = JSON.stringify(body);
    const sig = signBody(bodyStr, process.env.WEBHOOK_CALLBACK_URL, 'sec');
    await app.inject({
      method: 'POST', url: '/api/webhooks/trello',
      payload: bodyStr,
      headers: { 'content-type': 'application/json', 'x-trello-webhook': sig },
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
