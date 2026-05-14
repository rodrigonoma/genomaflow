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

// SECURITY: redact tokens (GitHub PAT, x-access-token URLs) de qualquer string
// antes de incluir em erro ou log. Evita vazamento via comentário no card Trello
// quando agente reporta falha (incidente 2026-05-14: PAT vazou em card #21).
function _redactSecrets(str) {
  if (!str) return str;
  return String(str)
    // x-access-token URLs: https://x-access-token:TOKEN@github.com/...
    .replace(/x-access-token:[^@\s]+@/g, 'x-access-token:[REDACTED]@')
    // GitHub fine-grained PATs (github_pat_...) e classic (ghp_...) standalone
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[REDACTED_PAT]')
    .replace(/\bghp_[A-Za-z0-9]+/g, '[REDACTED_PAT]')
    // Trello/anthropic keys também
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED_KEY]')
    .replace(/ATTA[A-Za-z0-9]+/g, '[REDACTED_TRELLO_TOKEN]');
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
        else reject(new Error(_redactSecrets(`git ${args.join(' ')} exit ${code}: ${stderr}`)));
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

/**
 * Commit + push DIRETO em main (sem PR). Usado quando user pede skip de
 * code review humano. Pré-requisito: working tree em /repoRoot já tem os
 * edits do agente; testes locais passaram; main remoto não divergiu desde
 * o último build do worker image. Retorna o SHA do commit pra logar.
 *
 * NOTA: bypassa code review humano. CI deploy.yml dispara automaticamente.
 * Branch protection do GitHub precisa permitir push do bot user (sem PR).
 */
async function commitAndPushToMain({ repoRoot, message, gitUser = 'GenomaFlow Bot', gitEmail = 'bot@genomaflow.com.br' }) {
  const { spawn } = require('child_process');
  function run(args, captureStdout = false) {
    return new Promise((resolve, reject) => {
      // GIT_TERMINAL_PROMPT=0 força non-interactive: se push 401, falha em vez
      // de prompt waiting forever em container (incidente 2026-05-14 — push
      // travou 80+min porque git tentou perguntar credentials).
      // Timeout 60s no spawn cobre casos onde rede trava.
      const p = spawn('git', args, {
        cwd: repoRoot,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      let stdout = '', stderr = '';
      p.stdout.on('data', (d) => { stdout += d.toString(); });
      p.stderr.on('data', (d) => { stderr += d.toString(); });
      const timeout = setTimeout(() => {
        p.kill('SIGKILL');
        reject(new Error(`git ${args[0]} TIMEOUT after 60s`));
      }, 60_000);
      p.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(_redactSecrets(`git ${args.join(' ')} exit ${code}: ${stderr}`)));
      });
    });
  }
  await run(['config', 'user.name', gitUser]);
  await run(['config', 'user.email', gitEmail]);
  await run(['add', '-A']);
  await run(['commit', '-m', message]);
  const sha = await run(['rev-parse', 'HEAD']);
  const token = process.env.GITHUB_BOT_TOKEN;
  const { owner, repo } = _parseRepo();
  // Usa http.extraheader pra autenticar via Authorization: Bearer.
  // Evita ambiguidade do username `x-access-token:` (que o GitHub às vezes
  // interpreta como App installation token → identidade github-actions[bot]
  // ao invés do user dono do PAT). Bearer é universalmente aceito p/ fine-
  // grained PATs e classic.
  await run([
    '-c', `http.https://github.com/.extraheader=Authorization: Bearer ${token}`,
    'push', `https://github.com/${owner}/${repo}.git`, 'HEAD:main',
  ]);
  return { sha };
}

module.exports = {
  createBranchAndPR,
  commitAndPushBranch,
  commitAndPushToMain,
  _resetClient,
};
