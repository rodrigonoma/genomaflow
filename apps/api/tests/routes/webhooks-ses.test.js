/**
 * Validação isolada do webhook /webhooks/ses (Fastify isolado, sem DB real).
 * Mock pg.query pra simular insert.
 */

const Fastify = require('fastify');
const sesWebhook = require('../../src/routes/webhooks/ses');

function buildApp() {
  const app = Fastify({ logger: false });
  const queries = [];
  app.decorate('pg', {
    query: jest.fn().mockImplementation((sql, params) => {
      queries.push({ sql, params });
      return Promise.resolve({ rows: [{ id: 'mock-id' }] });
    }),
  });
  app.register(sesWebhook, { prefix: '/webhooks' });
  return { app, queries };
}

describe('POST /webhooks/ses', () => {
  test('sem header x-amz-sns-message-type → 400', async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/webhooks/ses', payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('SubscriptionConfirmation sem SubscribeURL → 400', async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/webhooks/ses',
      headers: { 'x-amz-sns-message-type': 'SubscriptionConfirmation' },
      payload: { Type: 'SubscriptionConfirmation' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/SubscribeURL/);
    await app.close();
  });

  test('SubscriptionConfirmation com SubscribeURL → tenta confirmar (mock fetch)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/webhooks/ses',
      headers: { 'x-amz-sns-message-type': 'SubscriptionConfirmation' },
      payload: { Type: 'SubscriptionConfirmation', SubscribeURL: 'https://sns.aws/confirm' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().action).toBe('subscription_confirmed');
    expect(global.fetch).toHaveBeenCalledWith('https://sns.aws/confirm', { method: 'GET' });
    await app.close();
  });

  test('Notification — Bounce permanent → suprime emails', async () => {
    const { app, queries } = buildApp();
    await app.ready();
    const sesPayload = {
      notificationType: 'Bounce',
      bounce: {
        bounceType: 'Permanent',
        bounceSubType: 'NoEmail',
        bouncedRecipients: [
          { emailAddress: 'invalid@example.com' },
          { emailAddress: 'foo@bar.fake' },
        ],
      },
    };
    const res = await app.inject({
      method: 'POST', url: '/webhooks/ses',
      headers: { 'x-amz-sns-message-type': 'Notification' },
      payload: { Type: 'Notification', Message: JSON.stringify(sesPayload) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().action).toBe('bounce_processed');
    expect(res.json().suppressed).toBe(2);
    // 2 INSERTs em email_suppressions
    const inserts = queries.filter(q => /INSERT INTO email_suppressions/i.test(q.sql));
    expect(inserts.length).toBe(2);
    await app.close();
  });

  test('Notification — Bounce transient NÃO suprime', async () => {
    const { app, queries } = buildApp();
    await app.ready();
    const sesPayload = {
      notificationType: 'Bounce',
      bounce: {
        bounceType: 'Transient',
        bounceSubType: 'MailboxFull',
        bouncedRecipients: [{ emailAddress: 'temporary@x.com' }],
      },
    };
    const res = await app.inject({
      method: 'POST', url: '/webhooks/ses',
      headers: { 'x-amz-sns-message-type': 'Notification' },
      payload: { Type: 'Notification', Message: JSON.stringify(sesPayload) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suppressed).toBe(0);  // não suprime transient
    const inserts = queries.filter(q => /INSERT INTO email_suppressions/i.test(q.sql));
    expect(inserts.length).toBe(0);
    await app.close();
  });

  test('Notification — Complaint → sempre suprime', async () => {
    const { app, queries } = buildApp();
    await app.ready();
    const sesPayload = {
      notificationType: 'Complaint',
      complaint: {
        complaintFeedbackType: 'abuse',
        complainedRecipients: [{ emailAddress: 'angry@user.com' }],
      },
    };
    const res = await app.inject({
      method: 'POST', url: '/webhooks/ses',
      headers: { 'x-amz-sns-message-type': 'Notification' },
      payload: { Type: 'Notification', Message: JSON.stringify(sesPayload) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().action).toBe('complaint_processed');
    expect(res.json().suppressed).toBe(1);
    await app.close();
  });

  test('Notification — Delivery → log apenas, não suprime', async () => {
    const { app, queries } = buildApp();
    await app.ready();
    const sesPayload = {
      notificationType: 'Delivery',
      delivery: { recipients: ['ok@valid.com'] },
    };
    const res = await app.inject({
      method: 'POST', url: '/webhooks/ses',
      headers: { 'x-amz-sns-message-type': 'Notification' },
      payload: { Type: 'Notification', Message: JSON.stringify(sesPayload) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().action).toBe('logged');
    const inserts = queries.filter(q => /INSERT INTO email_suppressions/i.test(q.sql));
    expect(inserts.length).toBe(0);
    await app.close();
  });

  test('Notification com Message inválido (não-JSON) → 400', async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/webhooks/ses',
      headers: { 'x-amz-sns-message-type': 'Notification' },
      payload: { Type: 'Notification', Message: 'isso não é json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Message inválido/);
    await app.close();
  });

  test('messageType desconhecido → 400', async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/webhooks/ses',
      headers: { 'x-amz-sns-message-type': 'WeirdType' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/messageType desconhecido/);
    await app.close();
  });
});
