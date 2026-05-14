// apps/api/tests/services/trello-fix-attempts.test.js
'use strict';
const { describe, test, expect } = require('@jest/globals');

const {
  createAttempt, markRunning, markCompleted, markFailed,
  getLastAttempt, countCompletedAttempts,
  VALID_TRIGGER_TYPES, VALID_STATUSES, MAX_ATTEMPTS,
} = require('../../src/services/trello-fix-attempts');

function makePg(rows) {
  return { query: jest.fn().mockResolvedValueOnce({ rows: rows || [], rowCount: rows?.length || 0 }) };
}

describe('VALID enums e MAX_ATTEMPTS', () => {
  test('trigger_types whitelist 5 valores', () => {
    expect([...VALID_TRIGGER_TYPES].sort()).toEqual(
      ['cancel', 'detalhe', 'fix', 'retry', 'triage'],
    );
  });
  test('status whitelist 8 valores', () => {
    expect(VALID_STATUSES.size).toBe(8);
  });
  test('MAX_ATTEMPTS = 5 por card (sem contar triage)', () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });
});

describe('createAttempt', () => {
  test('INSERT triage attempt=0 status queued', async () => {
    const pg = makePg([{ id: 'a1', card_id: 'c1', attempt: 0, status: 'queued' }]);
    const r = await createAttempt(pg, {
      cardId: 'c1', cardShortId: 'short1', attempt: 0,
      triggerType: 'triage', triggeredBy: 'system',
    });
    expect(r.id).toBe('a1');
    expect(pg.query.mock.calls[0][1][2]).toBe(0); // attempt
    expect(pg.query.mock.calls[0][1][3]).toBe('triage');
  });

  test('INSERT fix attempt com hint', async () => {
    const pg = makePg([{ id: 'a2', attempt: 1 }]);
    await createAttempt(pg, {
      cardId: 'c1', cardShortId: 's1', attempt: 1,
      triggerType: 'retry', triggeredBy: '@dev',
      hint: 'use getById',
    });
    expect(pg.query.mock.calls[0][1][5]).toBe('use getById');
  });

  test('rejeita triggerType inválido com status 400', async () => {
    await expect(createAttempt({}, {
      cardId: 'c1', cardShortId: 's1', attempt: 0,
      triggerType: 'invalid', triggeredBy: 'x',
    })).rejects.toMatchObject({ message: 'INVALID_TRIGGER_TYPE', status: 400 });
  });
});

describe('markRunning / markCompleted / markFailed', () => {
  test('markRunning UPDATE status=running', async () => {
    const pg = makePg([]);
    await markRunning(pg, 'a1');
    expect(pg.query.mock.calls[0][0]).toMatch(/SET status = 'running'/);
    expect(pg.query.mock.calls[0][1]).toEqual(['a1']);
  });

  test('markCompleted grava pr_url + branch + tokens + custo', async () => {
    const pg = makePg([]);
    await markCompleted(pg, 'a1', {
      status: 'pr_opened',
      prUrl: 'https://github.com/owner/repo/pull/42',
      branchName: 'trello/abc/fix-1',
      testSummary: { passed: 50, failed: 0, skipped: 1 },
      llmTokensInput: 10000,
      llmTokensOutput: 2500,
      llmCostUsd: 0.105,
      processingMs: 45000,
    });
    const params = pg.query.mock.calls[0][1];
    expect(params[1]).toBe('pr_opened');
    expect(params[2]).toBe('https://github.com/owner/repo/pull/42');
    expect(params[3]).toBe('trello/abc/fix-1');
  });

  test('markFailed grava error_code + truncate message 500 chars', async () => {
    const pg = makePg([]);
    await markFailed(pg, 'a1', {
      status: 'tests_failed',
      errorCode: 'TESTS_FAILED',
      errorMessage: 'x'.repeat(800),
    });
    expect(pg.query.mock.calls[0][1][3].length).toBe(500);
  });
});

describe('getLastAttempt', () => {
  test('retorna mais recente por card_id ORDER BY attempt DESC', async () => {
    const pg = makePg([{ id: 'a3', attempt: 2, status: 'tests_failed' }]);
    const r = await getLastAttempt(pg, { cardId: 'c1' });
    expect(r.attempt).toBe(2);
    expect(pg.query.mock.calls[0][0]).toMatch(/ORDER BY attempt DESC/);
    expect(pg.query.mock.calls[0][0]).toMatch(/LIMIT 1/);
  });

  test('retorna null quando vazio', async () => {
    const pg = makePg([]);
    expect(await getLastAttempt(pg, { cardId: 'nope' })).toBeNull();
  });
});

describe('countCompletedAttempts', () => {
  test('conta só fix com status terminal de LLM full (pr_opened/tests_failed), não llm_failed', async () => {
    const pg = { query: jest.fn().mockResolvedValueOnce({ rows: [{ count: '3' }] }) };
    const n = await countCompletedAttempts(pg, { cardId: 'c1' });
    expect(n).toBe(3);
    expect(pg.query.mock.calls[0][0]).toMatch(/trigger_type = 'fix'/);
    expect(pg.query.mock.calls[0][0]).toMatch(/status IN \('pr_opened', 'tests_failed'\)/);
  });
});
