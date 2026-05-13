'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

// Mock withTenant para chamar fn(client) diretamente (sem transaction real)
jest.mock('../../src/db/tenant', () => ({
  withTenant: jest.fn(async (pg, _tenantId, fn) => fn(pg)),
}));

const {
  createSession,
  listForSubject,
  getById,
  softDelete,
  VALID_SESSION_TYPES,
} = require('../../src/services/aesthetic-sessions');

function makeMockPg(queryResult) {
  return { query: jest.fn().mockResolvedValueOnce({ rows: queryResult }) };
}

describe('aesthetic-sessions service', () => {
  // -------------------------------------------------------------------------
  // VALID_SESSION_TYPES whitelist
  // -------------------------------------------------------------------------
  test('whitelist tem apenas facial_analysis e body_analysis', () => {
    expect([...VALID_SESSION_TYPES].sort()).toEqual(['body_analysis', 'facial_analysis']);
  });

  // -------------------------------------------------------------------------
  // createSession
  // -------------------------------------------------------------------------
  test('createSession rejeita session_type inválido com status 400', async () => {
    await expect(createSession({}, {
      tenantId: 't1', subjectId: 's1', userId: 'u1',
      sessionType: 'invalid_type',
    })).rejects.toMatchObject({
      message: 'INVALID_SESSION_TYPE',
      status: 400,
    });
  });

  test('createSession aceita facial_analysis + INSERT correto', async () => {
    const expected = {
      id: 'uuid-1', tenant_id: 't1', subject_id: 's1', user_id: 'u1',
      session_date: '2026-05-12T00:00:00Z', session_type: 'facial_analysis',
      notes: 'first', created_at: '2026-05-12T00:00:00Z',
    };
    const pg = makeMockPg([expected]);

    const result = await createSession(pg, {
      tenantId: 't1', subjectId: 's1', userId: 'u1',
      sessionType: 'facial_analysis', notes: 'first',
    });

    expect(result).toEqual(expected);
    const sql = pg.query.mock.calls[0][0];
    expect(sql).toMatch(/INSERT INTO aesthetic_sessions/);
    expect(pg.query.mock.calls[0][1]).toEqual(['t1', 's1', 'u1', 'facial_analysis', 'first']);
  });

  test('createSession converte notes vazio para null', async () => {
    const pg = makeMockPg([{ id: 'x', notes: null }]);
    await createSession(pg, {
      tenantId: 't', subjectId: 's', userId: 'u',
      sessionType: 'body_analysis',
      // notes omitido
    });
    expect(pg.query.mock.calls[0][1][4]).toBeNull();
  });

  // -------------------------------------------------------------------------
  // listForSubject
  // -------------------------------------------------------------------------
  test('listForSubject query com filtros + ORDER BY session_date DESC', async () => {
    const rows = [
      { id: 'a', session_date: '2026-05-12T10:00:00Z', session_type: 'facial_analysis' },
      { id: 'b', session_date: '2026-05-11T10:00:00Z', session_type: 'body_analysis' },
    ];
    const pg = makeMockPg(rows);

    const result = await listForSubject(pg, {
      tenantId: 't1', subjectId: 's1', limit: 10, offset: 5,
    });

    expect(result).toEqual(rows);
    const sql = pg.query.mock.calls[0][0];
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(sql).toMatch(/ORDER BY session_date DESC/);
    expect(pg.query.mock.calls[0][1]).toEqual(['t1', 's1', 10, 5]);
  });

  test('listForSubject defaults: limit=20, offset=0', async () => {
    const pg = makeMockPg([]);
    await listForSubject(pg, { tenantId: 't', subjectId: 's' });
    const params = pg.query.mock.calls[0][1];
    expect(params[2]).toBe(20);
    expect(params[3]).toBe(0);
  });

  // -------------------------------------------------------------------------
  // getById
  // -------------------------------------------------------------------------
  test('getById retorna row quando encontra', async () => {
    const row = { id: 'sess-1', tenant_id: 't1', subject_id: 's1', session_type: 'facial_analysis' };
    const pg = makeMockPg([row]);
    const result = await getById(pg, { tenantId: 't1', sessionId: 'sess-1' });
    expect(result).toEqual(row);
  });

  test('getById retorna null quando vazio', async () => {
    const pg = makeMockPg([]);
    const result = await getById(pg, { tenantId: 't1', sessionId: 'inexistente' });
    expect(result).toBeNull();
  });

  test('getById filtra deleted_at IS NULL', async () => {
    const pg = makeMockPg([]);
    await getById(pg, { tenantId: 't1', sessionId: 's1' });
    expect(pg.query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/);
  });

  // -------------------------------------------------------------------------
  // softDelete
  // -------------------------------------------------------------------------
  test('softDelete retorna true quando UPDATE afeta 1 row', async () => {
    const pg = makeMockPg([{ id: 'sess-1' }]);
    const result = await softDelete(pg, {
      tenantId: 't1', sessionId: 'sess-1', userId: 'u1',
    });
    expect(result).toBe(true);
    expect(pg.query.mock.calls[0][0]).toMatch(/UPDATE aesthetic_sessions/);
    expect(pg.query.mock.calls[0][0]).toMatch(/SET deleted_at = NOW\(\)/);
  });

  test('softDelete retorna false quando 0 rows afetadas', async () => {
    const pg = makeMockPg([]);
    const result = await softDelete(pg, {
      tenantId: 't1', sessionId: 'inexistente', userId: 'u1',
    });
    expect(result).toBe(false);
  });
});
