'use strict';
const { TOOL_DEFINITIONS, executeTool } = require('../../src/services/clinical-chat-tools');

function ctx(overrides = {}) {
  const queryMock = jest.fn();
  return {
    fastify: {
      pg: { query: queryMock, connect: jest.fn() },
      redis: { publish: jest.fn(async () => 1) },
    },
    tenant_id: '00000000-0000-0000-0000-00000000000A',
    user_id: '00000000-0000-0000-0000-00000000000B',
    module: 'human',
    log: { error: jest.fn() },
    queryMock,
    ...overrides,
  };
}

describe('TOOL_DEFINITIONS', () => {
  test('4 tools registradas', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(4);
    const names = TOOL_DEFINITIONS.map(t => t.name).sort();
    expect(names).toEqual([
      'get_exam_summary',
      'get_prescription_details',
      'list_recent_exams',
      'list_recent_prescriptions',
    ]);
  });

  test('todas têm description + input_schema', () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(typeof t.description).toBe('string');
      expect(t.input_schema?.type).toBe('object');
    }
  });
});

describe('list_recent_exams', () => {
  test('default status=done + limit=10', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_recent_exams', {}, c);
    const sql = c.queryMock.mock.calls[0][0];
    const args = c.queryMock.mock.calls[0][1];
    expect(args[0]).toBe(c.tenant_id);
    expect(args[1]).toBe('done');
    expect(sql).toContain('LIMIT 10');
  });

  test('subject_id filtra adequadamente', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_recent_exams', { subject_id: 'p1' }, c);
    const args = c.queryMock.mock.calls[0][1];
    expect(args[2]).toBe('p1');
  });

  test('status fora do enum cai pro default (done)', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_recent_exams', { status: 'invalid' }, c);
    expect(c.queryMock.mock.calls[0][1][1]).toBe('done');
  });

  test('limit clamp a 30', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_recent_exams', { limit: 999 }, c);
    expect(c.queryMock.mock.calls[0][0]).toContain('LIMIT 30');
  });
});

describe('get_exam_summary', () => {
  test('exam_id obrigatório', async () => {
    const c = ctx();
    const r = await executeTool('get_exam_summary', {}, c);
    expect(r.result.error).toMatch(/exam_id/);
  });

  test('not found', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await executeTool('get_exam_summary', { exam_id: 'x' }, c);
    expect(r.result.error).toBe('not_found');
  });

  test('exam pending retorna mensagem sem tentar buscar análise', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'e1', subject_id: 's1', status: 'pending', review_status: 'pending',
        file_type: 'pdf', created_at: '2024-01-01', subject_name: 'Maria',
        subject_type: 'human', species: null, breed: null,
      }],
    });
    const r = await executeTool('get_exam_summary', { exam_id: 'e1' }, c);
    expect(r.result.status).toBe('pending');
    expect(r.result.message).toMatch(/análise concluída/i);
    // Não fez segunda query (clinical_results)
    expect(c.queryMock).toHaveBeenCalledTimes(1);
  });

  test('exam done retorna analyses + navigate_url', async () => {
    const c = ctx();
    c.queryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 'e1', subject_id: 's1', status: 'done', review_status: 'reviewed',
          file_type: 'pdf', created_at: '2024-01-01', subject_name: 'Maria',
          subject_type: 'human', species: null, breed: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          agent_type: 'cardiovascular',
          interpretation: 'OK',
          risk_scores: { cardiovascular: 'LOW' },
          alerts: [{ marker: 'col', value: '180', severity: 'low' }],
          model_version: 'v1',
          created_at: '2024-01-01',
        }],
      });
    const r = await executeTool('get_exam_summary', { exam_id: 'e1' }, c);
    expect(r.result.id).toBe('e1');
    expect(r.result.analyses).toHaveLength(1);
    expect(r.result.analyses[0].alerts_count).toBe(1);
    expect(r.result.navigate_url).toBe('/results/e1');
  });

  test('escopa por tenant_id mesmo se input tentar override', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('get_exam_summary', { exam_id: 'x', tenant_id: 'EVIL' }, c);
    expect(c.queryMock.mock.calls[0][1]).toEqual(['x', c.tenant_id]);
  });
});

describe('list_recent_prescriptions', () => {
  test('list sem filter retorna todas', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_recent_prescriptions', {}, c);
    expect(c.queryMock.mock.calls[0][1]).toEqual([c.tenant_id]);
  });

  test('agent_type filter aplica', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_recent_prescriptions', { agent_type: 'therapeutic' }, c);
    expect(c.queryMock.mock.calls[0][1]).toContain('therapeutic');
  });

  test('agent_type fora do enum não filtra (silently ignorado)', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_recent_prescriptions', { agent_type: 'evil' }, c);
    expect(c.queryMock.mock.calls[0][1]).toEqual([c.tenant_id]);
  });
});

describe('get_prescription_details', () => {
  test('prescription_id obrigatório', async () => {
    const c = ctx();
    const r = await executeTool('get_prescription_details', {}, c);
    expect(r.result.error).toMatch(/prescription_id/);
  });

  test('found retorna items + navigate_url do exam', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'rx1', subject_id: 's1', exam_id: 'e1', agent_type: 'therapeutic',
        items: [{ name: 'Losartana 50mg', dose: '1x ao dia' }],
        notes: 'tomar pela manhã',
        pdf_url: 'https://...',
        created_at: '2024-01-01',
        subject_name: 'Maria',
      }],
    });
    const r = await executeTool('get_prescription_details', { prescription_id: 'rx1' }, c);
    expect(r.result.id).toBe('rx1');
    expect(r.result.items).toHaveLength(1);
    expect(r.result.has_pdf).toBe(true);
    expect(r.result.navigate_url).toBe('/results/e1');
  });
});

describe('ACL — defesa em profundidade', () => {
  test('list_recent_exams ignora override de tenant', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_recent_exams', { tenant_id: 'EVIL' }, c);
    expect(c.queryMock.mock.calls[0][1][0]).toBe(c.tenant_id);
  });

  test('list_recent_prescriptions escopa por tenant', async () => {
    const c = ctx();
    c.queryMock.mockResolvedValueOnce({ rows: [] });
    await executeTool('list_recent_prescriptions', { tenant_id: 'EVIL' }, c);
    expect(c.queryMock.mock.calls[0][1][0]).toBe(c.tenant_id);
  });
});
