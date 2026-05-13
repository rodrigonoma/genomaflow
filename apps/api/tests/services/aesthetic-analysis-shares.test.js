'use strict';

const { describe, test, expect } = require('@jest/globals');

jest.mock('../../src/db/tenant', () => ({
  withTenant: jest.fn(async (pg, _t, fn) => fn(pg)),
}));

const {
  createShare, markSent, markFailed, listByAnalysis, findCachedPdfKey,
  VALID_CHANNELS, VALID_STATUS,
} = require('../../src/services/aesthetic-analysis-shares');

function makePg(rows) {
  return { query: jest.fn().mockResolvedValueOnce({ rows: rows || [], rowCount: rows?.length || 0 }) };
}

describe('VALID_CHANNELS / STATUS whitelists', () => {
  test('canais aceitos', () => {
    expect([...VALID_CHANNELS].sort()).toEqual(['email', 'whatsapp']);
  });
  test('status aceitos', () => {
    expect([...VALID_STATUS].sort()).toEqual(['delivered', 'failed', 'queued', 'sent']);
  });
});

describe('createShare', () => {
  test('happy path email + status queued', async () => {
    const pg = makePg([{ id: 's1', channel: 'email', status: 'queued', sent_at: 'now' }]);
    const r = await createShare(pg, {
      tenantId: 't1', analysisId: 'a1', userId: 'u1',
      channel: 'email', recipient: 'p@x.com',
    });
    expect(r.id).toBe('s1');
    expect(pg.query.mock.calls[0][1]).toEqual([
      't1', 'a1', 'u1', 'email', 'p@x.com', null, null,
    ]);
  });

  test('whatsapp + customMessage + s3KeyPdf', async () => {
    const pg = makePg([{ id: 's2', channel: 'whatsapp' }]);
    await createShare(pg, {
      tenantId: 't1', analysisId: 'a1', userId: 'u1',
      channel: 'whatsapp', recipient: '+5511999998888',
      customMessage: 'Olá!', s3KeyPdf: 'aesthetic-patient-pdf/t1/a1.pdf',
    });
    const args = pg.query.mock.calls[0][1];
    expect(args[5]).toBe('aesthetic-patient-pdf/t1/a1.pdf');
    expect(args[6]).toBe('Olá!');
  });

  test('channel inválido rejeita 400', async () => {
    await expect(createShare({}, {
      tenantId: 't1', analysisId: 'a1', userId: 'u1',
      channel: 'sms', recipient: 'x',
    })).rejects.toMatchObject({ message: 'INVALID_CHANNEL', status: 400 });
  });

  test('recipient vazio rejeita 400', async () => {
    await expect(createShare({}, {
      tenantId: 't1', analysisId: 'a1', userId: 'u1',
      channel: 'email', recipient: '',
    })).rejects.toMatchObject({ message: 'INVALID_RECIPIENT', status: 400 });
  });
});

describe('markSent / markFailed', () => {
  test('markSent UPDATE status=sent + provider_id', async () => {
    const pg = makePg([]);
    await markSent(pg, 's1', 'ses-xyz');
    expect(pg.query.mock.calls[0][0]).toMatch(/status = 'sent'/);
    expect(pg.query.mock.calls[0][1]).toEqual(['s1', 'ses-xyz']);
  });

  test('markSent sem provider_id → null', async () => {
    const pg = makePg([]);
    await markSent(pg, 's1');
    expect(pg.query.mock.calls[0][1][1]).toBeNull();
  });

  test('markFailed grava error_code + truncate message', async () => {
    const pg = makePg([]);
    const long = 'x'.repeat(600);
    await markFailed(pg, 's1', { errorCode: 'ZAPI_FAIL', errorMessage: long });
    expect(pg.query.mock.calls[0][1][1]).toBe('ZAPI_FAIL');
    expect(pg.query.mock.calls[0][1][2].length).toBe(500);
  });

  test('markFailed fallback UNKNOWN', async () => {
    const pg = makePg([]);
    await markFailed(pg, 's1', { errorMessage: 'erro' });
    expect(pg.query.mock.calls[0][1][1]).toBe('UNKNOWN');
  });
});

describe('listByAnalysis', () => {
  test('retorna rows ordenadas sent_at DESC', async () => {
    const pg = makePg([
      { id: 'a', channel: 'email', sent_at: '2026-05-13T10:00:00Z' },
      { id: 'b', channel: 'whatsapp', sent_at: '2026-05-13T09:00:00Z' },
    ]);
    const r = await listByAnalysis(pg, { tenantId: 't1', analysisId: 'a1' });
    expect(r.length).toBe(2);
    expect(pg.query.mock.calls[0][0]).toMatch(/ORDER BY sent_at DESC/);
  });

  test('limit default 50', async () => {
    const pg = makePg([]);
    await listByAnalysis(pg, { tenantId: 't1', analysisId: 'a1' });
    expect(pg.query.mock.calls[0][1][2]).toBe(50);
  });
});

describe('findCachedPdfKey', () => {
  test('retorna chave existente quando encontra', async () => {
    const pg = makePg([{ s3_key_pdf: 'aesthetic-patient-pdf/t1/a1.pdf' }]);
    const r = await findCachedPdfKey(pg, { tenantId: 't1', analysisId: 'a1' });
    expect(r).toBe('aesthetic-patient-pdf/t1/a1.pdf');
  });

  test('retorna null se nenhum share teve PDF', async () => {
    const pg = makePg([]);
    expect(await findCachedPdfKey(pg, { tenantId: 't1', analysisId: 'a1' })).toBeNull();
  });
});
