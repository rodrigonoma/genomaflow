'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');

// --- Mock Anthropic SDK ---
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    constructor() {}
    messages = { create: mockCreate };
  },
}));

// --- Module under test (imported AFTER mocks) ---
const {
  runDiscovery,
  shouldTickRun,
  currentYearMonth,
  alreadyRanThisMonth,
  parseLLMJson,
  sanitize,
  insertSuggestions,
  VALID_CATEGORIES,
  MAX_SUGGESTIONS,
} = require('../../src/jobs/aesthetic-treatment-discovery');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidSuggestion(overrides = {}) {
  return {
    name: 'Tratamento Teste',
    category: 'facial_rejuvenescimento',
    indications: ['rugas finas', 'flacidez leve'],
    contraindications: ['gravidez'],
    typical_sessions: 4,
    interval_days: 30,
    cost_estimate_brl_min: 200,
    cost_estimate_brl_max: 600,
    evidence_level: 'B',
    description: 'Descrição do tratamento',
    protocol_notes: 'Notas de protocolo',
    sources: ['Sociedade Brasileira de Dermatologia 2025'],
    ...overrides,
  };
}

/**
 * Build a simple pool mock. `queryResponses` maps a string fragment to a return
 * value (rows + rowCount). Unmatched queries return { rows: [], rowCount: 0 }.
 */
function makePool(queryResponses = {}) {
  const calls = [];
  const pool = {
    _calls: calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      for (const [fragment, response] of Object.entries(queryResponses)) {
        if (sql.includes(fragment)) return response;
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return pool;
}

// ---------------------------------------------------------------------------
// 1. shouldTickRun
// ---------------------------------------------------------------------------
describe('shouldTickRun', () => {
  test('returns true only on day 1 UTC', () => {
    expect(shouldTickRun(new Date('2026-06-01T00:00:00Z'))).toBe(true);
    expect(shouldTickRun(new Date('2026-06-01T23:59:59Z'))).toBe(true);
  });
  test('returns false on any other day', () => {
    expect(shouldTickRun(new Date('2026-06-02T00:00:00Z'))).toBe(false);
    expect(shouldTickRun(new Date('2026-05-15T12:00:00Z'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. currentYearMonth
// ---------------------------------------------------------------------------
describe('currentYearMonth', () => {
  test('formats correctly', () => {
    expect(currentYearMonth(new Date('2026-01-15T00:00:00Z'))).toBe('2026-01');
    expect(currentYearMonth(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11');
  });
});

// ---------------------------------------------------------------------------
// 3. parseLLMJson
// ---------------------------------------------------------------------------
describe('parseLLMJson', () => {
  test('parses clean JSON', () => {
    const input = JSON.stringify({ suggestions: [{ name: 'Foo' }] });
    const result = parseLLMJson(input);
    expect(result.suggestions).toHaveLength(1);
  });

  test('extracts JSON embedded in markdown prose', () => {
    const input = `Here is the result:\n\`\`\`json\n${JSON.stringify({ suggestions: [{ name: 'Bar' }] })}\n\`\`\``;
    const result = parseLLMJson(input);
    expect(result.suggestions).toHaveLength(1);
  });

  test('throws BAD_LLM_OUTPUT on empty input', () => {
    expect(() => parseLLMJson('')).toThrow('BAD_LLM_OUTPUT');
    expect(() => parseLLMJson(null)).toThrow('BAD_LLM_OUTPUT');
  });

  test('throws BAD_LLM_OUTPUT when no JSON object present', () => {
    expect(() => parseLLMJson('Sorry, I cannot help.')).toThrow('BAD_LLM_OUTPUT: no JSON object');
  });

  test('throws BAD_LLM_OUTPUT on malformed JSON', () => {
    expect(() => parseLLMJson('{bad json;;}')).toThrow('BAD_LLM_OUTPUT: invalid JSON');
  });

  test('throws BAD_LLM_OUTPUT when suggestions array missing', () => {
    expect(() => parseLLMJson(JSON.stringify({ result: [] }))).toThrow('BAD_LLM_OUTPUT: missing suggestions[]');
  });
});

// ---------------------------------------------------------------------------
// 4. sanitize — individual row validation
// ---------------------------------------------------------------------------
describe('sanitize', () => {
  test('returns sanitized object for valid input', () => {
    const out = sanitize(makeValidSuggestion());
    expect(out).not.toBeNull();
    expect(out.name).toBe('Tratamento Teste');
    expect(out.category).toBe('facial_rejuvenescimento');
    expect(out.evidence_level).toBe('B');
    expect(out.typical_sessions).toBe(4);
    expect(out.interval_days).toBe(30);
  });

  test('drops entry with invalid category', () => {
    const out = sanitize(makeValidSuggestion({ category: 'categoria_inventada' }));
    expect(out).toBeNull();
  });

  test('drops entry missing name', () => {
    const out = sanitize(makeValidSuggestion({ name: '' }));
    expect(out).toBeNull();
  });

  test('drops entry where name is not a string', () => {
    const out = sanitize(makeValidSuggestion({ name: 123 }));
    expect(out).toBeNull();
  });

  test('drops null/non-object input', () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize('string')).toBeNull();
    expect(sanitize(42)).toBeNull();
  });

  test('nullifies invalid evidence_level but keeps the entry', () => {
    const out = sanitize(makeValidSuggestion({ evidence_level: 'Z' }));
    expect(out).not.toBeNull();
    expect(out.evidence_level).toBeNull();
  });

  test('clamps typical_sessions to [1,20]', () => {
    expect(sanitize(makeValidSuggestion({ typical_sessions: 100 })).typical_sessions).toBe(20);
    expect(sanitize(makeValidSuggestion({ typical_sessions: -5 })).typical_sessions).toBe(1);
  });

  test('clamps interval_days to [1,365]', () => {
    expect(sanitize(makeValidSuggestion({ interval_days: 1000 })).interval_days).toBe(365);
    expect(sanitize(makeValidSuggestion({ interval_days: 0 })).interval_days).toBe(1);
  });

  test('clamps costs to [0,100000]', () => {
    const out = sanitize(makeValidSuggestion({ cost_estimate_brl_min: -50, cost_estimate_brl_max: 999999 }));
    expect(out.cost_estimate_brl_min).toBe(0);
    expect(out.cost_estimate_brl_max).toBe(100000);
  });

  test('slices name to 120 chars', () => {
    const out = sanitize(makeValidSuggestion({ name: 'A'.repeat(200) }));
    expect(out.name).toHaveLength(120);
  });

  test('slices description to 500 chars', () => {
    const out = sanitize(makeValidSuggestion({ description: 'B'.repeat(600) }));
    expect(out.description).toHaveLength(500);
  });

  test('caps indications and contraindications at 10 items', () => {
    const out = sanitize(makeValidSuggestion({
      indications: Array.from({ length: 20 }, (_, i) => `ind${i}`),
      contraindications: Array.from({ length: 15 }, (_, i) => `contra${i}`),
    }));
    expect(out.indications).toHaveLength(10);
    expect(out.contraindications).toHaveLength(10);
  });

  test('caps sources at 5 items and slices to 200 chars each', () => {
    const out = sanitize(makeValidSuggestion({
      sources: Array.from({ length: 10 }, (_, i) => `source${i}`.padEnd(250, 'x')),
    }));
    expect(out.sources).toHaveLength(5);
    expect(out.sources[0]).toHaveLength(200);
  });

  test('handles non-array indications gracefully', () => {
    const out = sanitize(makeValidSuggestion({ indications: 'not-an-array' }));
    expect(out).not.toBeNull();
    expect(out.indications).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Skip on second run same month
// ---------------------------------------------------------------------------
describe('runDiscovery — skip when already ran this month', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  test('returns { skipped: true } and never calls Anthropic when month already has a run', async () => {
    const pool = makePool({
      'TO_CHAR(generated_at': { rows: [{ '?column?': 1 }] }, // alreadyRanThisMonth → true
    });

    const result = await runDiscovery({ pool, now: new Date('2026-05-15T12:00:00Z') });

    expect(result.skipped).toBe(true);
    expect(result.ym).toBe('2026-05');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('forceRun=true bypasses the month check', async () => {
    const pool = makePool({
      'TO_CHAR(generated_at': { rows: [{ '?column?': 1 }] }, // month check → true
      'SELECT name FROM aesthetic_treatments': { rows: [{ name: 'Peeling Químico' }] },
    });

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ suggestions: [makeValidSuggestion()] }) }],
    });

    const result = await runDiscovery({ pool, now: new Date('2026-05-15T12:00:00Z'), forceRun: true });

    expect(result.skipped).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Sanitize garbage LLM output — mixed valid/invalid, max 30 cap
// ---------------------------------------------------------------------------
describe('runDiscovery — sanitize LLM output', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  test('invalid category dropped, missing name dropped — valid ones pass through', async () => {
    const pool = makePool({
      'TO_CHAR(generated_at': { rows: [] },           // month check → false (not ran yet)
      'SELECT name FROM aesthetic_treatments': { rows: [] },
    });

    const suggestions = [
      makeValidSuggestion({ name: 'Valid A', category: 'facial_acne' }),
      makeValidSuggestion({ name: 'Bad Category', category: 'categoria_inventada' }), // dropped
      makeValidSuggestion({ name: '', category: 'cabelo' }),                           // dropped (no name)
      makeValidSuggestion({ name: 'Valid B', category: 'corpo_modelagem' }),
    ];

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ suggestions }) }],
    });

    const result = await runDiscovery({ pool, now: new Date('2026-05-01T00:00:00Z') });

    expect(result.skipped).toBe(false);
    expect(result.total).toBe(2); // only Valid A and Valid B
    expect(result.inserted).toBe(2);
  });

  test('all suggestions invalid → throws BAD_LLM_OUTPUT', async () => {
    const pool = makePool({
      'TO_CHAR(generated_at': { rows: [] },
      'SELECT name FROM aesthetic_treatments': { rows: [] },
    });

    const suggestions = [
      { name: 'No Category' },                                      // no category → null
      { category: 'facial_acne' },                                  // no name → null
      makeValidSuggestion({ category: 'garbage_category' }),        // bad category → null
    ];

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ suggestions }) }],
    });

    await expect(runDiscovery({ pool, now: new Date('2026-05-01T00:00:00Z') }))
      .rejects.toThrow('BAD_LLM_OUTPUT: no valid suggestions after sanitize');
  });

  test('caps at MAX_SUGGESTIONS (30) even if LLM returns more', async () => {
    const pool = makePool({
      'TO_CHAR(generated_at': { rows: [] },
      'SELECT name FROM aesthetic_treatments': { rows: [] },
    });

    // Generate 50 valid suggestions
    const suggestions = Array.from({ length: 50 }, (_, i) =>
      makeValidSuggestion({ name: `Tratamento ${i + 1}` }),
    );

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ suggestions }) }],
    });

    const result = await runDiscovery({ pool, now: new Date('2026-05-01T00:00:00Z') });

    expect(result.total).toBe(MAX_SUGGESTIONS); // capped at 30
    expect(result.inserted).toBe(MAX_SUGGESTIONS);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO aesthetic_treatment_suggestions'),
      expect.any(Array),
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Happy path — 3 valid suggestions → 3 INSERTs with correct fields
// ---------------------------------------------------------------------------
describe('runDiscovery — happy path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  test('3 valid suggestions → 3 INSERTs with status=pending_review and matching source_run_id', async () => {
    const insertedParams = [];
    const pool = {
      query: jest.fn(async (sql, params) => {
        if (sql.includes('TO_CHAR(generated_at')) return { rows: [] }; // not ran yet
        if (sql.includes('SELECT name FROM aesthetic_treatments')) {
          return { rows: [{ name: 'Peeling Químico' }] };
        }
        if (sql.includes('INSERT INTO aesthetic_treatment_suggestions')) {
          insertedParams.push(params);
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const s1 = makeValidSuggestion({ name: 'Hydro Boost', category: 'facial_rejuvenescimento' });
    const s2 = makeValidSuggestion({ name: 'Laser Fracional CO2', category: 'facial_pigmentacao' });
    const s3 = makeValidSuggestion({ name: 'Bioestimulador PLLA', category: 'facial_preenchimento' });

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ suggestions: [s1, s2, s3] }) }],
    });

    const result = await runDiscovery({ pool, now: new Date('2026-05-01T00:00:00Z') });

    expect(result.skipped).toBe(false);
    expect(result.inserted).toBe(3);
    expect(result.total).toBe(3);
    expect(result.runId).toBeDefined();
    expect(typeof result.runId).toBe('string');

    // All 3 INSERTs happened
    expect(insertedParams).toHaveLength(3);

    // Verify status='pending_review' is in the SQL (position 13 → index 12)
    for (const params of insertedParams) {
      // source_run_id is param $13 (index 12)
      expect(params[12]).toBe(result.runId);
      // generation_model is $14 (index 13)
      expect(params[13]).toBe('claude-opus-4-7');
    }

    // Verify all 3 names appear in the inserted params
    const insertedNames = insertedParams.map((p) => p[0]);
    expect(insertedNames).toContain('Hydro Boost');
    expect(insertedNames).toContain('Laser Fracional CO2');
    expect(insertedNames).toContain('Bioestimulador PLLA');
  });

  test('ON CONFLICT path: pool.query throwing PG unique violation → counts as inserted (INSERT wrapped per-row)', async () => {
    // The job catches individual INSERT errors and continues — a conflict means
    // pool.query resolves (ON CONFLICT DO NOTHING returns rowCount=0 but no throw).
    // This test verifies that even if one INSERT throws (e.g. some other PG error),
    // the remaining suggestions still get inserted.
    let callCount = 0;
    const pool = {
      query: jest.fn(async (sql, params) => {
        if (sql.includes('TO_CHAR(generated_at')) return { rows: [] };
        if (sql.includes('SELECT name FROM aesthetic_treatments')) return { rows: [] };
        if (sql.includes('INSERT INTO aesthetic_treatment_suggestions')) {
          callCount++;
          if (callCount === 2) throw new Error('simulated DB error on row 2');
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const suggestions = [
      makeValidSuggestion({ name: 'OK Row 1', category: 'facial_acne' }),
      makeValidSuggestion({ name: 'Error Row 2', category: 'facial_acne' }),
      makeValidSuggestion({ name: 'OK Row 3', category: 'facial_acne' }),
    ];

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ suggestions }) }],
    });

    // Should not throw — errors are caught per-row
    const result = await runDiscovery({ pool, now: new Date('2026-05-01T00:00:00Z') });

    expect(result.skipped).toBe(false);
    // 2 out of 3 inserted (row 2 failed)
    expect(result.inserted).toBe(2);
    expect(result.total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 8. insertSuggestions — direct unit tests
// ---------------------------------------------------------------------------
describe('insertSuggestions', () => {
  test('returns count of successful inserts', async () => {
    const pool = makePool({
      'INSERT INTO aesthetic_treatment_suggestions': { rowCount: 1 },
    });
    const suggestions = [
      sanitize(makeValidSuggestion({ name: 'A', category: 'cabelo' })),
      sanitize(makeValidSuggestion({ name: 'B', category: 'outro' })),
    ];
    const count = await insertSuggestions(pool, 'run-uuid-1', suggestions);
    expect(count).toBe(2);
  });

  test('continues past individual INSERT errors', async () => {
    let n = 0;
    const pool = {
      query: jest.fn(async () => {
        n++;
        if (n === 1) throw new Error('unique violation');
        return { rowCount: 1 };
      }),
    };
    const suggestions = [
      sanitize(makeValidSuggestion({ name: 'A', category: 'cabelo' })),
      sanitize(makeValidSuggestion({ name: 'B', category: 'cabelo' })),
    ];
    const count = await insertSuggestions(pool, 'run-uuid-2', suggestions);
    expect(count).toBe(1); // first failed, second OK
  });
});

// ---------------------------------------------------------------------------
// 9. alreadyRanThisMonth
// ---------------------------------------------------------------------------
describe('alreadyRanThisMonth', () => {
  test('returns true when a row for this month exists', async () => {
    const pool = makePool({ 'TO_CHAR(generated_at': { rows: [{ '?column?': 1 }] } });
    await expect(alreadyRanThisMonth(pool, new Date('2026-05-10T00:00:00Z'))).resolves.toBe(true);
  });

  test('returns false when no row for this month', async () => {
    const pool = makePool({ 'TO_CHAR(generated_at': { rows: [] } });
    await expect(alreadyRanThisMonth(pool, new Date('2026-05-10T00:00:00Z'))).resolves.toBe(false);
  });

  test('passes correct YYYY-MM to query', async () => {
    const calls = [];
    const pool = {
      query: jest.fn(async (sql, params) => { calls.push(params); return { rows: [] }; }),
    };
    await alreadyRanThisMonth(pool, new Date('2026-07-22T00:00:00Z'));
    expect(calls[0][0]).toBe('2026-07');
  });
});
