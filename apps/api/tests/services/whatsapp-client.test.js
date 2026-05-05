/**
 * Unit tests do whatsapp-client (sem rede — mock mode).
 */

const whatsapp = require('../../src/services/whatsapp-client');

describe('normalizePhone', () => {
  test('11 dígitos com DDD adiciona 55', () => {
    expect(whatsapp.normalizePhone('11999999999')).toBe('5511999999999');
  });
  test('formato BR completo retorna como digits', () => {
    expect(whatsapp.normalizePhone('5511999999999')).toBe('5511999999999');
  });
  test('com pontuação remove e mantém formato', () => {
    expect(whatsapp.normalizePhone('+55 (11) 99999-9999')).toBe('5511999999999');
  });
  test('vazio retorna null', () => {
    expect(whatsapp.normalizePhone('')).toBe(null);
    expect(whatsapp.normalizePhone(null)).toBe(null);
    expect(whatsapp.normalizePhone(undefined)).toBe(null);
  });
});

describe('isMock', () => {
  test('ZAPI_MOCK=1 = mock mode', () => {
    process.env.ZAPI_MOCK = '1';
    expect(whatsapp.isMock()).toBe(true);
  });
  test('sem ZAPI_MOCK = não mock', () => {
    delete process.env.ZAPI_MOCK;
    expect(whatsapp.isMock()).toBe(false);
  });
});

describe('sendText em mock', () => {
  beforeEach(() => { process.env.ZAPI_MOCK = '1'; });
  test('retorna messageId fake', async () => {
    const r = await whatsapp.sendText({ phone: '11999999999', body: 'oi' });
    expect(r.messageId).toMatch(/^mock-/);
    expect(r.status).toBe('sent');
  });
  test('phone inválido lança erro', async () => {
    await expect(whatsapp.sendText({ phone: '', body: 'oi' })).rejects.toThrow(/phone/);
  });
});

describe('verifyWebhook', () => {
  test('em mock aceita tudo', () => {
    process.env.ZAPI_MOCK = '1';
    expect(whatsapp.verifyWebhook({})).toBe(true);
  });
  test('sem ZAPI_CLIENT_TOKEN aceita (degrade gracefully)', () => {
    delete process.env.ZAPI_MOCK;
    delete process.env.ZAPI_CLIENT_TOKEN;
    expect(whatsapp.verifyWebhook({})).toBe(true);
  });
  test('com token aceita match', () => {
    delete process.env.ZAPI_MOCK;
    process.env.ZAPI_CLIENT_TOKEN = 'secret-abc';
    expect(whatsapp.verifyWebhook({ 'x-token': 'secret-abc' })).toBe(true);
    expect(whatsapp.verifyWebhook({ 'x-token': 'wrong' })).toBe(false);
  });
});
