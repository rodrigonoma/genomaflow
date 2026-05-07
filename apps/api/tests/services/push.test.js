'use strict';

// Mock firebase-admin antes de importar push.js
const mockSendEach = jest.fn();
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: { cert: jest.fn(() => ({})) },
  messaging: () => ({ sendEach: mockSendEach })
}));

const push = require('../../src/services/push');

const mockPg = {
  query: jest.fn()
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
    type: 'service_account',
    project_id: 'test',
    private_key: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----\n',
    client_email: 'test@test.iam.gserviceaccount.com'
  });
});

describe('push.sendToUser', () => {
  it('não faz nada se usuário não tiver tokens', async () => {
    mockPg.query.mockResolvedValueOnce({ rows: [] });
    await push.sendToUser(mockPg, 'user-1', { title: 'T', body: 'B', data: {} });
    expect(mockSendEach).not.toHaveBeenCalled();
  });

  it('envia para todos os tokens do usuário', async () => {
    mockPg.query.mockResolvedValueOnce({
      rows: [{ token: 'tok-android' }, { token: 'tok-ios' }]
    });
    mockSendEach.mockResolvedValueOnce({
      responses: [{ success: true }, { success: true }]
    });

    await push.sendToUser(mockPg, 'user-1', { title: 'Exame', body: 'Pronto', data: { route: '/doctor/patients/123' } });

    expect(mockSendEach).toHaveBeenCalledWith([
      expect.objectContaining({ token: 'tok-android', notification: { title: 'Exame', body: 'Pronto' } }),
      expect.objectContaining({ token: 'tok-ios' })
    ]);
  });

  it('remove tokens expirados quando FCM retorna registration-not-registered', async () => {
    mockPg.query
      .mockResolvedValueOnce({ rows: [{ token: 'tok-expired' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // DELETE

    mockSendEach.mockResolvedValueOnce({
      responses: [{
        success: false,
        error: { code: 'messaging/registration-token-not-registered' }
      }]
    });

    await push.sendToUser(mockPg, 'user-1', { title: 'T', body: 'B', data: {} });

    expect(mockPg.query).toHaveBeenCalledWith(
      'DELETE FROM device_tokens WHERE token = ANY($1)',
      [['tok-expired']]
    );
  });

  it('não lança erro se FCM falhar (best-effort)', async () => {
    mockPg.query.mockResolvedValueOnce({ rows: [{ token: 'tok-1' }] });
    mockSendEach.mockRejectedValueOnce(new Error('FCM down'));

    await expect(
      push.sendToUser(mockPg, 'user-1', { title: 'T', body: 'B', data: {} })
    ).resolves.not.toThrow();
  });
});
