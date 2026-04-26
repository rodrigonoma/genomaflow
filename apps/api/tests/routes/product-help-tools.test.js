'use strict';
/**
 * Integration tests pra POST /product-help/ask com enable_agenda_tools=true.
 *
 * Mock do Anthropic SDK pra controlar respostas com tool_use blocks.
 * Mock pg pra retriever + tools + log.
 *
 * Foco:
 *  - enable_agenda_tools=false (default) preserva path original (streaming)
 *  - enable_agenda_tools=true entra no loop de tools
 *  - Tools executadas com tenant_id/user_id do JWT (não do input do LLM)
 *  - Hard cap de 5 iterações respeitado
 *  - Erros de tool reportados via SSE
 */

// Mock do Anthropic SDK ANTES do require do produto
const mockMessagesCreate = jest.fn();
const mockMessagesStream = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: mockMessagesCreate,
      stream: mockMessagesStream,
    },
  }));
});

// Mock do retriever (não queremos rodar embeddings real)
jest.mock('../../src/rag/product-help-retriever', () => ({
  retrieveProductHelp: jest.fn(async () => []),
}));

const Fastify = require('fastify');

function buildApp() {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async function (request, reply) {
    const role = request.headers['x-test-role'];
    if (!role) return reply.status(401).send({ error: 'no auth' });
    request.user = {
      user_id: 'USER-FROM-JWT',
      tenant_id: 'TENANT-FROM-JWT',
      role,
      module: request.headers['x-test-module'] || 'human',
    };
  });

  app.decorate('pg', {
    query: jest.fn(async () => ({ rows: [] })),
    connect: jest.fn(async () => ({
      query: jest.fn(async () => ({ rows: [{}] })),
      release: jest.fn(),
    })),
  });

  return app;
}

async function makeApp() {
  const app = buildApp();
  await app.register(require('../../src/routes/product-help'), { prefix: '/product-help' });
  await app.ready();
  return app;
}

beforeEach(() => {
  mockMessagesCreate.mockReset();
  mockMessagesStream.mockReset();
});

describe('POST /product-help/ask — input validation', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  test('sem auth → 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/product-help/ask', payload: { question: 'oi' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('question muito curta → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/product-help/ask',
      headers: { 'x-test-role': 'admin' },
      payload: { question: 'a' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('question muito longa → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/product-help/ask',
      headers: { 'x-test-role': 'admin' },
      payload: { question: 'a'.repeat(1001) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /product-help/ask — enable_agenda_tools=true', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  test('quando LLM retorna texto sem tool_use, devolve resposta direto', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Olá! Posso te ajudar.' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const res = await app.inject({
      method: 'POST', url: '/product-help/ask',
      headers: { 'x-test-role': 'admin' },
      payload: { question: 'oi tudo bem?', enable_agenda_tools: true },
    });

    expect(res.statusCode).toBe(200);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    // Stream NÃO foi chamado — modo tools usa create
    expect(mockMessagesStream).not.toHaveBeenCalled();
    expect(res.body).toContain('Olá! Posso te ajudar.');
  });

  test('quando LLM chama tool, executa e roda 2ª iteração', async () => {
    // 1ª resposta: chama list_my_agenda
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'list_my_agenda', input: { preset: 'today' } },
      ],
      usage: { input_tokens: 20, output_tokens: 10 },
    });
    // 2ª resposta: texto final
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Hoje você tem 0 agendamentos.' }],
      usage: { input_tokens: 30, output_tokens: 8 },
    });

    const res = await app.inject({
      method: 'POST', url: '/product-help/ask',
      headers: { 'x-test-role': 'admin' },
      payload: { question: 'o que tenho hoje?', enable_agenda_tools: true },
    });

    expect(res.statusCode).toBe(200);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
    expect(res.body).toContain('Hoje você tem 0 agendamentos');
    expect(res.body).toContain('tool_call_started');
    expect(res.body).toContain('list_my_agenda');
  });

  test('hard cap de 5 iterações é respeitado', async () => {
    // Sempre retorna tool_use — simula loop "infinito"
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu_x', name: 'list_my_agenda', input: { preset: 'today' } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const res = await app.inject({
      method: 'POST', url: '/product-help/ask',
      headers: { 'x-test-role': 'admin' },
      payload: { question: 'loop?', enable_agenda_tools: true },
    });

    expect(res.statusCode).toBe(200);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(5);
  });

  test('tool execution usa tenant_id/user_id do JWT (não dos args do LLM)', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{
        type: 'tool_use', id: 'tu_evil', name: 'find_subject',
        // LLM tenta injetar tenant_id e user_id maliciosos
        input: { name: 'Maria', tenant_id: 'TENANT-EVIL', user_id: 'USER-EVIL' },
      }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Encontrei.' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const localApp = buildApp();
    localApp.pg.query.mockResolvedValueOnce({ rows: [] }); // find_subject query
    await localApp.register(require('../../src/routes/product-help'), { prefix: '/product-help' });
    await localApp.ready();

    await localApp.inject({
      method: 'POST', url: '/product-help/ask',
      headers: { 'x-test-role': 'admin' },
      payload: { question: 'busca Maria', enable_agenda_tools: true },
    });

    // pg.query chamada com tenant do JWT (TENANT-FROM-JWT), não TENANT-EVIL
    const findSubjectCalls = localApp.pg.query.mock.calls.filter(c =>
      c[0]?.includes && c[0].includes('subjects')
    );
    expect(findSubjectCalls.length).toBeGreaterThan(0);
    expect(findSubjectCalls[0][1][0]).toBe('TENANT-FROM-JWT');
    expect(findSubjectCalls[0][1][0]).not.toBe('TENANT-EVIL');
    await localApp.close();
  });

  test('conversation_history é preservado (cap 10 messages)', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'continuando.' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const longHistory = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
    }));

    await app.inject({
      method: 'POST', url: '/product-help/ask',
      headers: { 'x-test-role': 'admin' },
      payload: {
        question: 'ok continua',
        enable_agenda_tools: true,
        conversation_history: longHistory,
      },
    });

    const callArgs = mockMessagesCreate.mock.calls[0][0];
    // history (10) + nova question (1) = 11 messages no total
    expect(callArgs.messages.length).toBe(11);
  });
});

describe('POST /product-help/ask — modo SEM tools mantém comportamento atual', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  test('enable_agenda_tools=false (default) usa stream, não create', async () => {
    // Stream mock: async iterator simples
    mockMessagesStream.mockReturnValueOnce({
      [Symbol.asyncIterator]() {
        let done = false;
        return {
          next() {
            if (done) return Promise.resolve({ value: undefined, done: true });
            done = true;
            return Promise.resolve({
              value: {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'Resposta texto puro' },
              },
              done: false,
            });
          },
        };
      },
    });

    const res = await app.inject({
      method: 'POST', url: '/product-help/ask',
      headers: { 'x-test-role': 'admin' },
      payload: { question: 'pergunta normal' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockMessagesStream).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});
