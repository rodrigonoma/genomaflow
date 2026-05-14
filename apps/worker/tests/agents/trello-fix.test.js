'use strict';
const { describe, test, expect } = require('@jest/globals');

const mockMessages = { create: jest.fn() };
jest.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = mockMessages; },
}));

const mockTools = {
  readFile: jest.fn(async () => 'file'),
  listFiles: jest.fn(async () => []),
  grep: jest.fn(async () => []),
  editFile: jest.fn(async () => ({ ok: true })),
  createFile: jest.fn(async () => ({ ok: true })),
  runTests: jest.fn(),
  runLint: jest.fn(async () => ({ success: true })),
  getToolSchemas: jest.fn(() => []),
};
jest.mock('../../src/lib/codebase-tools', () => mockTools);

const mockPr = {
  createBranchAndPR: jest.fn(),
  commitAndPushBranch: jest.fn(async () => undefined),
  commitAndPushToMain: jest.fn(async () => ({ sha: 'abc123' })),
};
jest.mock('../../src/lib/github-pr', () => mockPr);

const { fixCard } = require('../../src/agents/trello-fix');

beforeEach(() => {
  mockMessages.create.mockReset();
  mockTools.runTests.mockReset();
  mockPr.createBranchAndPR.mockReset();
  mockPr.commitAndPushBranch.mockReset();
  mockPr.commitAndPushToMain.mockReset();
  mockPr.commitAndPushToMain.mockResolvedValue({ sha: 'abc123' });
});

describe('fixCard', () => {
  test('happy path: edits + tests passam + push direto em main', async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'FIX_DONE' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 2000, output_tokens: 800 },
    });
    mockTools.runTests.mockResolvedValueOnce({
      success: true,
      exitCode: 0,
      stdout: 'Tests: 50 passed, 1 skipped',
      stderr: '',
    });
    mockPr.commitAndPushToMain.mockResolvedValueOnce({ sha: 'deadbeef' });

    const r = await fixCard({
      card: { id: 'c1', idShort: 42, name: 'Bug X', desc: 'desc' },
      attempt: 1,
      hint: null,
      memberUsername: 'po1',
      repoRoot: '/tmp/repo',
      scope: 'api',
    });

    expect(r.status).toBe('pushed_to_main');
    expect(r.commit_sha).toBe('deadbeef');
    expect(r.test_summary).toMatchObject({ success: true });
    expect(mockPr.commitAndPushToMain).toHaveBeenCalled();
    expect(mockPr.createBranchAndPR).not.toHaveBeenCalled();
    expect(mockPr.commitAndPushBranch).not.toHaveBeenCalled();
  });

  test('testes falham: SEM push, retorna tests_failed', async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'FIX_DONE' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    mockTools.runTests.mockResolvedValueOnce({
      success: false,
      exitCode: 1,
      stdout: 'Tests: 3 failed',
      stderr: 'AssertionError',
    });

    const r = await fixCard({
      card: { id: 'c1', idShort: 42, name: 'Bug X', desc: 'd' },
      attempt: 1,
      hint: null,
      memberUsername: 'po',
      repoRoot: '/tmp/repo',
      scope: 'api',
    });

    expect(r.status).toBe('tests_failed');
    expect(r.commit_sha).toBeUndefined();
    expect(mockPr.commitAndPushToMain).not.toHaveBeenCalled();
  });

  test('hint humano injetado no prompt', async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'OK' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockTools.runTests.mockResolvedValueOnce({
      success: true, exitCode: 0, stdout: '', stderr: '',
    });
    mockPr.commitAndPushToMain.mockResolvedValueOnce({ sha: 'x' });

    await fixCard({
      card: { id: 'c1', idShort: 42, name: 'X', desc: 'd' },
      attempt: 2,
      hint: 'usa getById em vez de getByName',
      memberUsername: 'dev',
      repoRoot: '/tmp/repo',
      scope: 'api',
    });

    const callMsg = mockMessages.create.mock.calls[0][0];
    const userText = callMsg.messages[0].content;
    expect(userText).toContain('usa getById em vez de getByName');
  });

  test('commit message inclui card short id + member username', async () => {
    mockMessages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'OK' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockTools.runTests.mockResolvedValueOnce({ success: true, exitCode: 0, stdout: '', stderr: '' });
    mockPr.commitAndPushToMain.mockResolvedValueOnce({ sha: 'beef' });

    await fixCard({
      card: { id: 'c1', idShort: 99, name: 'Card title', desc: 'd' },
      attempt: 3,
      hint: null,
      memberUsername: 'po',
      repoRoot: '/tmp/repo',
      scope: 'worker',
    });

    expect(mockPr.commitAndPushToMain).toHaveBeenCalledWith(
      expect.objectContaining({
        repoRoot: '/tmp/repo',
        message: expect.stringContaining('fix(trello-99): Card title'),
      })
    );
    const callArgs = mockPr.commitAndPushToMain.mock.calls[0][0];
    expect(callArgs.message).toContain('Trello #99');
    expect(callArgs.message).toContain('Approved by @po');
    expect(callArgs.message).toContain('attempt 3');
  });
});
