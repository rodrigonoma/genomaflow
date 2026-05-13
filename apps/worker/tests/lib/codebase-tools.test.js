// apps/worker/tests/lib/codebase-tools.test.js
'use strict';
const { describe, test, expect } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  readFile, listFiles, grep, editFile, createFile,
  isEditableAllowed, getToolSchemas,
} = require('../../src/lib/codebase-tools');

let tempRoot;
beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebase-tools-'));
  fs.mkdirSync(path.join(tempRoot, 'apps/api/src'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'apps/worker/src'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'infra'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'apps/api/src/foo.js'), 'function foo() {\n  return 42;\n}');
  fs.writeFileSync(path.join(tempRoot, 'apps/api/src/bar.js'), 'const x = "hello";');
  fs.writeFileSync(path.join(tempRoot, 'infra/danger.tf'), 'critical');
});
afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('isEditableAllowed', () => {
  test('allow apps/api/src', () => {
    expect(isEditableAllowed('apps/api/src/foo.js')).toBe(true);
  });
  test('allow apps/worker/src', () => {
    expect(isEditableAllowed('apps/worker/src/bar.js')).toBe(true);
  });
  test('allow apps/web/src', () => {
    expect(isEditableAllowed('apps/web/src/x.ts')).toBe(true);
  });
  test('allow docs/', () => {
    expect(isEditableAllowed('docs/anything.md')).toBe(true);
  });
  test('deny infra/', () => {
    expect(isEditableAllowed('infra/lib/ecs-stack.ts')).toBe(false);
  });
  test('deny .github/', () => {
    expect(isEditableAllowed('.github/workflows/deploy.yml')).toBe(false);
  });
  test('deny migrations sql', () => {
    expect(isEditableAllowed('apps/api/src/db/migrations/099_foo.sql')).toBe(false);
  });
  test('deny package.json root', () => {
    expect(isEditableAllowed('package.json')).toBe(false);
  });
  test('deny path traversal ../', () => {
    expect(isEditableAllowed('../etc/passwd')).toBe(false);
  });
});

describe('readFile', () => {
  test('lê conteúdo de arquivo dentro do repo', async () => {
    const c = await readFile({ path: 'apps/api/src/foo.js', repoRoot: tempRoot });
    expect(c).toContain('function foo');
  });

  test('rejeita path fora do repo (traversal)', async () => {
    await expect(readFile({ path: '../../../etc/passwd', repoRoot: tempRoot }))
      .rejects.toThrow(/PATH_TRAVERSAL/);
  });

  test('rejeita arquivo > 50KB', async () => {
    const big = path.join(tempRoot, 'apps/api/src/big.js');
    fs.writeFileSync(big, 'x'.repeat(60 * 1024));
    await expect(readFile({ path: 'apps/api/src/big.js', repoRoot: tempRoot }))
      .rejects.toThrow(/FILE_TOO_LARGE/);
  });
});

describe('listFiles', () => {
  test('lista files em diretório', async () => {
    const files = await listFiles({ dir: 'apps/api/src', repoRoot: tempRoot });
    expect(files).toEqual(expect.arrayContaining(['apps/api/src/foo.js', 'apps/api/src/bar.js']));
  });
});

describe('grep', () => {
  test('encontra ocorrências com line numbers', async () => {
    const r = await grep({ pattern: 'function foo', repoRoot: tempRoot });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]).toMatchObject({
      path: 'apps/api/src/foo.js',
      line: 1,
    });
  });

  test('retorna [] quando não encontra', async () => {
    const r = await grep({ pattern: 'wholeworld_unique_token_xyz', repoRoot: tempRoot });
    expect(r).toEqual([]);
  });
});

describe('editFile', () => {
  test('substitui old_string por new_string', async () => {
    await editFile({
      path: 'apps/api/src/foo.js',
      oldString: 'return 42',
      newString: 'return 43',
      repoRoot: tempRoot,
    });
    const c = await readFile({ path: 'apps/api/src/foo.js', repoRoot: tempRoot });
    expect(c).toContain('return 43');
  });

  test('rejeita edit em path NÃO permitido', async () => {
    await expect(editFile({
      path: 'infra/danger.tf',
      oldString: 'critical',
      newString: 'safe',
      repoRoot: tempRoot,
    })).rejects.toThrow(/NOT_EDITABLE/);
  });

  test('rejeita se old_string não encontrada', async () => {
    await expect(editFile({
      path: 'apps/api/src/bar.js',
      oldString: 'string-inexistente',
      newString: 'x',
      repoRoot: tempRoot,
    })).rejects.toThrow(/OLD_STRING_NOT_FOUND/);
  });

  test('rejeita se old_string ambígua (múltiplas ocorrências)', async () => {
    const f = path.join(tempRoot, 'apps/api/src/ambiguous.js');
    fs.writeFileSync(f, 'foo();\nfoo();\nfoo();');
    await expect(editFile({
      path: 'apps/api/src/ambiguous.js',
      oldString: 'foo();',
      newString: 'bar();',
      repoRoot: tempRoot,
    })).rejects.toThrow(/AMBIGUOUS_MATCH/);
  });
});

describe('createFile', () => {
  test('cria arquivo novo em path permitido', async () => {
    await createFile({
      path: 'apps/api/src/new-file.js',
      content: 'module.exports = {};',
      repoRoot: tempRoot,
    });
    expect(fs.existsSync(path.join(tempRoot, 'apps/api/src/new-file.js'))).toBe(true);
  });

  test('rejeita criar fora de allowlist', async () => {
    await expect(createFile({
      path: 'infra/new-bad.tf',
      content: 'x',
      repoRoot: tempRoot,
    })).rejects.toThrow(/NOT_EDITABLE/);
  });

  test('rejeita se arquivo já existe (anti-overwrite)', async () => {
    await expect(createFile({
      path: 'apps/api/src/foo.js',
      content: 'novo conteúdo',
      repoRoot: tempRoot,
    })).rejects.toThrow(/FILE_EXISTS/);
  });
});

describe('getToolSchemas', () => {
  test('retorna lista de schemas Claude Tool Use', () => {
    const schemas = getToolSchemas({ readOnly: false });
    const names = schemas.map(s => s.name);
    expect(names).toEqual(expect.arrayContaining([
      'read_file', 'list_files', 'grep', 'edit_file', 'create_file', 'run_tests', 'run_lint',
    ]));
  });

  test('readOnly=true exclui edit/create/run', () => {
    const schemas = getToolSchemas({ readOnly: true });
    const names = schemas.map(s => s.name);
    expect(names).toEqual(expect.arrayContaining(['read_file', 'list_files', 'grep']));
    expect(names).not.toContain('edit_file');
    expect(names).not.toContain('run_tests');
  });
});
