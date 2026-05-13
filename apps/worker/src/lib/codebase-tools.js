// apps/worker/src/lib/codebase-tools.js
'use strict';

/**
 * Codebase tools — read/list/grep + edit/create + run_tests + run_lint.
 * Allowlist explícita de paths editáveis pra proteger infra crítica.
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §7
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MAX_FILE_SIZE = 50 * 1024;
const GREP_MAX_RESULTS = 200;

const EDITABLE_PREFIXES = [
  'apps/api/src/',
  'apps/worker/src/',
  'apps/web/src/',
  'docs/',
  'apps/api/tests/',
  'apps/worker/tests/',
  'apps/web/src/',
];

const BLOCKED_PATTERNS = [
  /^infra\//,
  /^\.github\//,
  /^aws\//,
  /^node_modules\//,
  /\/migrations\/.*\.sql$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^Dockerfile$/,
];

function isEditableAllowed(relPath) {
  if (!relPath || typeof relPath !== 'string') return false;
  if (relPath.includes('..')) return false;
  const p = relPath.replace(/\\/g, '/');
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(p)) return false;
  }
  return EDITABLE_PREFIXES.some(prefix => p.startsWith(prefix));
}

function _resolveSafe(repoRoot, relPath) {
  if (relPath.includes('..')) {
    const err = new Error('PATH_TRAVERSAL');
    err.code = 'PATH_TRAVERSAL';
    throw err;
  }
  return path.resolve(repoRoot, relPath);
}

async function readFile({ path: relPath, repoRoot }) {
  const abs = _resolveSafe(repoRoot, relPath);
  const stat = await fs.stat(abs);
  if (stat.size > MAX_FILE_SIZE) {
    const err = new Error(`FILE_TOO_LARGE: ${stat.size} bytes (max ${MAX_FILE_SIZE})`);
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }
  return await fs.readFile(abs, 'utf8');
}

async function listFiles({ dir, repoRoot }) {
  const abs = _resolveSafe(repoRoot, dir);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  return entries
    .filter(e => e.isFile())
    .map(e => path.join(dir, e.name).replace(/\\/g, '/'));
}

async function grep({ pattern, dir = '.', repoRoot }) {
  const startDir = _resolveSafe(repoRoot, dir);
  const re = new RegExp(pattern);
  const results = [];

  async function walk(d) {
    if (results.length >= GREP_MAX_RESULTS) return;
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const ent of entries) {
      if (results.length >= GREP_MAX_RESULTS) return;
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (['node_modules', 'dist', '.git', 'cdk.out'].includes(ent.name)) continue;
        await walk(abs);
      } else if (ent.isFile()) {
        try {
          const stat = await fs.stat(abs);
          if (stat.size > MAX_FILE_SIZE * 4) continue;
          const content = await fs.readFile(abs, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
              results.push({ path: rel, line: i + 1, text: lines[i].slice(0, 200) });
              if (results.length >= GREP_MAX_RESULTS) return;
            }
          }
        } catch { /* skip */ }
      }
    }
  }
  await walk(startDir);
  return results;
}

async function editFile({ path: relPath, oldString, newString, repoRoot }) {
  if (!isEditableAllowed(relPath)) {
    const err = new Error(`NOT_EDITABLE: ${relPath}`);
    err.code = 'NOT_EDITABLE';
    throw err;
  }
  const abs = _resolveSafe(repoRoot, relPath);
  const content = await fs.readFile(abs, 'utf8');
  const idx = content.indexOf(oldString);
  if (idx === -1) {
    const err = new Error('OLD_STRING_NOT_FOUND');
    err.code = 'OLD_STRING_NOT_FOUND';
    throw err;
  }
  if (content.indexOf(oldString, idx + 1) !== -1) {
    const err = new Error('AMBIGUOUS_MATCH: old_string aparece >1 vez');
    err.code = 'AMBIGUOUS_MATCH';
    throw err;
  }
  const next = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
  await fs.writeFile(abs, next, 'utf8');
  return { ok: true, path: relPath };
}

async function createFile({ path: relPath, content, repoRoot }) {
  if (!isEditableAllowed(relPath)) {
    const err = new Error(`NOT_EDITABLE: ${relPath}`);
    err.code = 'NOT_EDITABLE';
    throw err;
  }
  const abs = _resolveSafe(repoRoot, relPath);
  if (fsSync.existsSync(abs)) {
    const err = new Error(`FILE_EXISTS: ${relPath}`);
    err.code = 'FILE_EXISTS';
    throw err;
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  return { ok: true, path: relPath };
}

async function runTests({ scope, repoRoot }) {
  return await _spawnCmd('npm', ['test'], path.join(repoRoot, `apps/${scope}`));
}

async function runLint({ scope, repoRoot }) {
  return await _spawnCmd('npm', ['run', 'lint', '--if-present'], path.join(repoRoot, `apps/${scope}`));
}

function _spawnCmd(cmd, args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, shell: process.platform === 'win32' });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code,
        stdout: stdout.slice(-10000),
        stderr: stderr.slice(-10000),
      });
    });
  });
}

function getToolSchemas({ readOnly = false } = {}) {
  const base = [
    {
      name: 'read_file',
      description: 'Lê o conteúdo de um arquivo do codebase (max 50KB).',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path relativo ao repo root' } },
        required: ['path'],
      },
    },
    {
      name: 'list_files',
      description: 'Lista arquivos de um diretório (não recursivo).',
      input_schema: {
        type: 'object',
        properties: { dir: { type: 'string', description: 'Path relativo ao repo root' } },
        required: ['dir'],
      },
    },
    {
      name: 'grep',
      description: 'Busca pattern regex no codebase. Retorna até 200 ocorrências com path+line.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern JS' },
          dir: { type: 'string', description: 'Limita busca a um diretório' },
        },
        required: ['pattern'],
      },
    },
  ];

  if (readOnly) return base;

  return [...base,
    {
      name: 'edit_file',
      description: 'Substitui old_string por new_string em um arquivo. old_string deve aparecer exatamente UMA vez.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    {
      name: 'create_file',
      description: 'Cria arquivo novo. Falha se arquivo já existe.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'run_tests',
      description: 'Roda npm test no scope (api | worker | web). Retorna { success, exitCode, stdout, stderr }.',
      input_schema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['api', 'worker', 'web'] },
        },
        required: ['scope'],
      },
    },
    {
      name: 'run_lint',
      description: 'Roda npm run lint --if-present. Retorna { success, exitCode, stdout, stderr }.',
      input_schema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['api', 'worker', 'web'] },
        },
        required: ['scope'],
      },
    },
  ];
}

module.exports = {
  readFile, listFiles, grep, editFile, createFile,
  runTests, runLint,
  isEditableAllowed, getToolSchemas,
  EDITABLE_PREFIXES, BLOCKED_PATTERNS, MAX_FILE_SIZE,
};
