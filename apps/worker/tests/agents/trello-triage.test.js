// apps/worker/tests/agents/trello-triage.test.js
'use strict';
const { describe, test, expect } = require('@jest/globals');

const mockMessages = { create: jest.fn() };
jest.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = mockMessages; },
}));

jest.mock('../../src/lib/codebase-tools', () => ({
  readFile: jest.fn(async () => 'file content'),
  listFiles: jest.fn(async () => ['x.js']),
  grep: jest.fn(async () => []),
  getToolSchemas: jest.fn(() => [
    { name: 'read_file', description: 'read', input_schema: {} },
    { name: 'list_files', description: 'list', input_schema: {} },
    { name: 'grep', description: 'grep', input_schema: {} },
  ]),
}));

const { triageCard, buildAnalysisComment } = require('../../src/agents/trello-triage');

beforeEach(() => mockMessages.create.mockReset());

describe('triageCard', () => {
  test('happy path: 1-shot Claude com end_turn retorna análise', async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        type: 'bug',
        makes_sense: 'yes',
        opinion: 'Faz sentido — alinhado com regra X',
        technical_details: ['Editar foo.js linha 42'],
        impact: ['Componente bar'],
        test_plan: ['Test unit cobrindo caso A'],
        risk: 'low',
      })}],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 500 },
    });

    const r = await triageCard({
      card: { id: 'c1', idShort: 42, name: 'Bug X', desc: 'algum desc' },
      repoRoot: '/tmp/repo',
    });

    expect(r.analysis.type).toBe('bug');
    expect(r.analysis.makes_sense).toBe('yes');
    expect(r.tokens_input).toBe(1000);
    expect(r.tokens_output).toBe(500);
  });

  test('Claude usa tools antes do end_turn (multi-turn loop)', async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'Vou ler o arquivo primeiro.' },
        { type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'apps/api/src/foo.js' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 500, output_tokens: 200 },
    });
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        type: 'bug', makes_sense: 'yes', opinion: 'OK',
        technical_details: [], impact: [], test_plan: [], risk: 'low',
      })}],
      stop_reason: 'end_turn',
      usage: { input_tokens: 800, output_tokens: 300 },
    });

    const r = await triageCard({
      card: { id: 'c1', idShort: 42, name: 'Bug X', desc: 'x' },
      repoRoot: '/tmp/repo',
    });

    expect(r.tokens_input).toBe(1300);
    expect(r.tokens_output).toBe(500);
    expect(mockMessages.create).toHaveBeenCalledTimes(2);
  });

  test('loop infinito breaker: max 20 iterações', async () => {
    mockMessages.create.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu', name: 'read_file', input: { path: 'x' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await expect(triageCard({
      card: { id: 'c1', idShort: 1, name: 'X', desc: 'y' },
      repoRoot: '/tmp/repo',
    })).rejects.toThrow(/MAX_ITERATIONS/);

    expect(mockMessages.create).toHaveBeenCalledTimes(20);
  });

  test('JSON malformado no texto → BAD_LLM_OUTPUT', async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'não é json válido' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await expect(triageCard({
      card: { id: 'c1', idShort: 1, name: 'X', desc: 'y' },
      repoRoot: '/tmp/repo',
    })).rejects.toMatchObject({ code: 'BAD_LLM_OUTPUT' });
  });
});

describe('buildAnalysisComment', () => {
  test('renderiza markdown com seções esperadas', () => {
    const md = buildAnalysisComment({
      type: 'bug',
      makes_sense: 'yes',
      opinion: 'OK',
      technical_details: ['Detalhe 1', 'Detalhe 2'],
      impact: ['Comp X'],
      test_plan: ['Test A'],
      risk: 'medium',
    });
    expect(md).toContain('🤖 Análise Automática');
    expect(md).toContain('Tipo:** Bug');
    expect(md).toContain('Detalhe 1');
    expect(md).toContain('Comp X');
    expect(md).toContain('Test A');
    expect(md).toContain('Próximos passos');
    expect(md).toContain('/fix aprovado');
    expect(md).toContain('Médio');
  });

  test('renderiza ⚠️ quando makes_sense=partial', () => {
    const md = buildAnalysisComment({
      type: 'feature',
      makes_sense: 'partial',
      opinion: 'preciso clarificar X',
      technical_details: [],
      impact: [],
      test_plan: [],
      risk: 'low',
    });
    expect(md).toContain('⚠️');
    expect(md).toContain('preciso clarificar X');
  });

  test('renderiza ❌ quando makes_sense=no', () => {
    const md = buildAnalysisComment({
      type: 'bug',
      makes_sense: 'no',
      opinion: 'conflita com Y',
      technical_details: [],
      impact: [],
      test_plan: [],
      risk: 'high',
    });
    expect(md).toContain('❌');
  });
});
