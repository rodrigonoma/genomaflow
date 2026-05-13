// apps/worker/tests/lib/github-pr.test.js
'use strict';
const { describe, test, expect, beforeEach } = require('@jest/globals');

const mockOctokit = {
  rest: {
    repos: {
      get: jest.fn(),
      getBranch: jest.fn(),
    },
    git: {
      getRef: jest.fn(),
      createRef: jest.fn(),
    },
    pulls: { create: jest.fn() },
  },
};

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn(() => mockOctokit),
}));

const { createBranchAndPR, _resetClient } = require('../../src/lib/github-pr');

beforeEach(() => {
  mockOctokit.rest.git.getRef.mockReset();
  mockOctokit.rest.git.createRef.mockReset();
  mockOctokit.rest.pulls.create.mockReset();
  process.env.GITHUB_BOT_TOKEN = 'gh-pat-xxx';
  process.env.GITHUB_REPO = 'owner/repo';
  _resetClient();
});

describe('createBranchAndPR', () => {
  test('happy path: cria branch, abre PR, retorna url', async () => {
    mockOctokit.rest.git.getRef.mockResolvedValueOnce({
      data: { object: { sha: 'main-sha-1' } },
    });
    mockOctokit.rest.git.createRef.mockResolvedValueOnce({});
    mockOctokit.rest.pulls.create.mockResolvedValueOnce({
      data: { html_url: 'https://github.com/owner/repo/pull/42', number: 42 },
    });

    const r = await createBranchAndPR({
      branchName: 'trello/abc/fix-1',
      baseBranch: 'main',
      title: '[Trello #abc] Bug X',
      body: 'fix descrição',
    });

    expect(r.url).toBe('https://github.com/owner/repo/pull/42');
    expect(r.number).toBe(42);

    expect(mockOctokit.rest.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'refs/heads/trello/abc/fix-1',
        sha: 'main-sha-1',
      })
    );
    expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '[Trello #abc] Bug X',
        head: 'trello/abc/fix-1',
        base: 'main',
      })
    );
  });

  test('throw quando GITHUB_BOT_TOKEN ausente', async () => {
    delete process.env.GITHUB_BOT_TOKEN;
    _resetClient();
    await expect(createBranchAndPR({
      branchName: 'x', title: 'y', body: 'z',
    })).rejects.toThrow(/GITHUB_BOT_TOKEN/);
  });
});
