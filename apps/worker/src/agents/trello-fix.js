// apps/worker/src/agents/trello-fix.js
'use strict';

/**
 * Fix agent — Claude Tool Use loop full (read+edit+test).
 * SE testes passam: cria branch, commit, push, abre PR.
 * SE testes falham: SEM PR, retorna tests_failed pro processor comentar no card.
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §3.2
 */

const Anthropic = require('@anthropic-ai/sdk').default;
const tools = require('../lib/codebase-tools');
const githubPr = require('../lib/github-pr');

const MODEL = process.env.TRELLO_FIX_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;
const MAX_ITERATIONS = 30;

const SYSTEM_PROMPT = `Você é o agente de fix do GenomaFlow.

Sua tarefa: ler o card, explorar o codebase, fazer as edições necessárias.

REGRAS CRÍTICAS:
- Use edit_file pra mudar UMA ocorrência por vez (old_string deve ser único no arquivo)
- Use create_file pra arquivos novos
- NÃO crie migrations SQL (bloqueado)
- NÃO edite infra/ ou .github/ (bloqueado)
- Faça mudanças MÍNIMAS — só o que o card pede
- Quando terminar, responda apenas \`FIX_DONE\` em texto

O processor vai rodar npm test depois. SE falhar, ele NÃO cria PR.
Você só edita; testes e PR são responsabilidade do processor.`;

function _userPrompt(card, hint) {
  let p = `Card Trello pra implementar:\n\n# ${card.name} (#${card.idShort})\n\n${card.desc || '(sem descrição)'}`;
  if (hint) {
    p += `\n\n---\n\nHINT do dev/PO (attempt anterior falhou): ${hint}`;
  }
  return p;
}

async function fixCard({
  card, attempt, hint, memberUsername, repoRoot, scope = 'api',
  anthropicClient,
}) {
  const client = anthropicClient || new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 300_000,
  });

  let totalIn = 0, totalOut = 0;
  const messages = [
    { role: 'user', content: _userPrompt(card, hint) },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`[trello-fix] iter ${i + 1}/${MAX_ITERATIONS} model=${MODEL} msgs=${messages.length}`);
    const t0 = Date.now();
    let resp;
    try {
      resp = await Promise.race([
        client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          tools: tools.getToolSchemas({ readOnly: false }),
          messages,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ANTHROPIC_TIMEOUT_180S')), 180_000)),
      ]);
    } catch (err) {
      console.error(`[trello-fix] iter ${i + 1} FAIL after ${Date.now() - t0}ms: ${err.message}`);
      throw err;
    }
    console.log(`[trello-fix] iter ${i + 1} OK in ${Date.now() - t0}ms stop=${resp.stop_reason} usage=in${resp.usage?.input_tokens}/out${resp.usage?.output_tokens}`);
    totalIn += resp.usage?.input_tokens || 0;
    totalOut += resp.usage?.output_tokens || 0;

    if (resp.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of resp.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try {
          result = await _executeTool(block.name, block.input, repoRoot);
        } catch (e) {
          result = { error: e.message || String(e) };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result).slice(0, 5000),
        });
      }
      messages.push({ role: 'assistant', content: resp.content });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    break;
  }

  const testResult = await tools.runTests({ scope, repoRoot });
  const testSummary = _parseTestSummary(testResult);

  if (!testResult.success) {
    return {
      status: 'tests_failed',
      test_summary: testSummary,
      tokens_input: totalIn,
      tokens_output: totalOut,
      stdout: testResult.stdout?.slice(-3000),
      stderr: testResult.stderr?.slice(-3000),
    };
  }

  const branchName = `trello/${card.idShort}/fix-${attempt}`;
  const commitMessage = `fix(trello-${card.idShort}): ${card.name}\n\nTrello #${card.idShort}\nApproved by @${memberUsername}\n${hint ? '\nHint: ' + hint : ''}`;

  await githubPr.commitAndPushBranch({
    repoRoot, branchName, message: commitMessage,
  });

  const pr = await githubPr.createBranchAndPR({
    branchName,
    baseBranch: 'main',
    title: `[Trello #${card.idShort}] ${card.name}`,
    body: `Closes Trello card https://trello.com/c/${card.idShort}\n\nGerado automaticamente pelo GenomaFlow Trello QA Agent — attempt ${attempt}.\nAprovado por @${memberUsername} via \`/fix aprovado\`${hint ? '\n\nHint do revisor: ' + hint : ''}\n\n**Revise os testes localmente antes de mergear.**`,
  });

  return {
    status: 'pr_opened',
    pr_url: pr.url,
    pr_number: pr.number,
    branch_name: branchName,
    test_summary: testSummary,
    tokens_input: totalIn,
    tokens_output: totalOut,
  };
}

function _parseTestSummary(testResult) {
  const out = (testResult.stdout || '') + (testResult.stderr || '');
  const passed = (out.match(/(\d+) passed/) || [])[1];
  const failed = (out.match(/(\d+) failed/) || [])[1];
  const skipped = (out.match(/(\d+) skipped/) || [])[1];
  return {
    success: testResult.success,
    passed: passed ? parseInt(passed) : null,
    failed: failed ? parseInt(failed) : null,
    skipped: skipped ? parseInt(skipped) : null,
    exit_code: testResult.exitCode,
  };
}

async function _executeTool(name, input, repoRoot) {
  switch (name) {
    case 'read_file': return await tools.readFile({ ...input, repoRoot });
    case 'list_files': return await tools.listFiles({ ...input, repoRoot });
    case 'grep': return await tools.grep({ ...input, repoRoot });
    case 'edit_file': return await tools.editFile({ ...input, repoRoot });
    case 'create_file': return await tools.createFile({ ...input, repoRoot });
    case 'run_tests': return await tools.runTests({ ...input, repoRoot });
    case 'run_lint': return await tools.runLint({ ...input, repoRoot });
    default: throw new Error(`Tool desconhecida: ${name}`);
  }
}

module.exports = { fixCard };
