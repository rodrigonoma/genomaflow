'use strict';

/**
 * GitHub PR helper via Octokit. Assume que commits foram feitos
 * localmente via git CLI; este módulo só cria a branch ref + abre o PR.
 *
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §7
 */

let _client = null;
function _resetClient() { _client = null; }

function getClient() {
  if (_client) return _client;
  const token = process.env.GITHUB_BOT_TOKEN;
  if (!token) throw new Error('GITHUB_BOT_TOKEN ausente');
  const { Octokit } = require('@octokit/rest');
  _client = new Octokit({ auth: token });
  return _client;
}

function _parseRepo() {
  const repo = process.env.GITHUB_REPO || 'rodrigonoma/genomaflow';
  const [owner, name] = repo.split('/');
  return { owner, repo: name };
}

async function createBranchAndPR({ branchName, baseBranch = 'main', title, body }) {
  const client = getClient();
  const { owner, repo } = _parseRepo();

  const baseRef = await client.rest.git.getRef({
    owner, repo, ref: `heads/${baseBranch}`,
  });
  const baseSha = baseRef.data.object.sha;

  try {
    await client.rest.git.createRef({
      owner, repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });
  } catch (e) {
    if (!String(e.message).includes('Reference already exists')) {
      throw e;
    }
  }

  const pr = await client.rest.pulls.create({
    owner, repo, title, body,
    head: branchName,
    base: baseBranch,
  });

  return { url: pr.data.html_url, number: pr.data.number };
}

async function commitAndPushBranch({ repoRoot, branchName, message, gitUser = 'GenomaFlow Bot', gitEmail = 'bot@genomaflow.com.br' }) {
  const { spawn } = require('child_process');
  function run(args) {
    return new Promise((resolve, reject) => {
      const p = spawn('git', args, { cwd: repoRoot });
      let stderr = '';
      p.stderr.on('data', (d) => { stderr += d.toString(); });
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`git ${args.join(' ')} exit ${code}: ${stderr}`));
      });
    });
  }
  await run(['config', 'user.name', gitUser]);
  await run(['config', 'user.email', gitEmail]);
  await run(['checkout', '-b', branchName]);
  await run(['add', '-A']);
  await run(['commit', '-m', message]);
  const token = process.env.GITHUB_BOT_TOKEN;
  const { owner, repo } = _parseRepo();
  await run(['push', `https://x-access-token:${token}@github.com/${owner}/${repo}.git`, branchName]);
}

module.exports = {
  createBranchAndPR,
  commitAndPushBranch,
  _resetClient,
};
