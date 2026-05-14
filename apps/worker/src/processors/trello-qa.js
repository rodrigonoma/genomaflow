'use strict';

/**
 * Processor BullMQ trello-qa: orchestra triage e fix.
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §3
 */

const { Pool } = require('pg');
const {
  createAttempt, markRunning, markCompleted, markFailed,
  countCompletedAttempts, MAX_ATTEMPTS,
} = require('../services/trello-fix-attempts');

const trelloClient = require('../services/trello-client');
const { triageCard, buildAnalysisComment } = require('../agents/trello-triage');
const { fixCard } = require('../agents/trello-fix');

// Mesma estratégia de poolConfig() de apps/api/src/plugins/postgres.js:
// task def ECS expõe DB_HOST/PORT/NAME/USER/PASSWORD individuais (NÃO
// DATABASE_URL). Usar só `connectionString: process.env.DATABASE_URL` fica
// undefined → pg.Pool tenta localhost:5432 → connect trava indefinidamente.
function _poolConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    };
  }
  return {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  };
}

const _pool = new Pool(_poolConfig());

const REPO_ROOT = process.env.TRELLO_REPO_ROOT || '/app';

async function processTrelloQA({ pool, data }) {
  pool = pool || _pool;
  const client = await pool.connect();
  const startMs = Date.now();

  try {
    if (data.event === 'triage') {
      await _handleTriage(client, data, startMs);
    } else if (data.event === 'fix') {
      await _handleFix(client, data, startMs);
    } else {
      throw new Error(`Unknown event: ${data.event}`);
    }
  } finally {
    client.release();
  }
}

async function _handleTriage(client, data, startMs) {
  const { card_id, card_short_id, triggered_by } = data;

  console.log(`[trello-qa] _handleTriage start card=${card_short_id}`);
  const attempt = await createAttempt(client, {
    cardId: card_id, cardShortId: card_short_id, attempt: 0,
    triggerType: 'triage', triggeredBy: triggered_by,
  });
  console.log(`[trello-qa] createAttempt OK attemptId=${attempt.id}`);
  await markRunning(client, attempt.id);
  console.log(`[trello-qa] markRunning OK`);

  try {
    console.log(`[trello-qa] calling trelloClient.getCard(${card_id})`);
    const card = await trelloClient.getCard(card_id);
    console.log(`[trello-qa] getCard OK name="${card.name?.slice(0, 50)}"`);

    console.log(`[trello-qa] calling triageCard (Claude loop)`);
    const r = await triageCard({ card, repoRoot: REPO_ROOT });
    console.log(`[trello-qa] triageCard OK iters=${r.iterations} tokens_in=${r.tokens_input} tokens_out=${r.tokens_output}`);

    const comment = buildAnalysisComment(r.analysis);
    console.log(`[trello-qa] calling addComment (${comment.length} chars)`);
    await trelloClient.addComment(card_id, comment);
    console.log(`[trello-qa] addComment OK`);

    await markCompleted(client, attempt.id, {
      status: 'completed',
      llmTokensInput: r.tokens_input,
      llmTokensOutput: r.tokens_output,
      llmCostUsd: _estimateCost(r.tokens_input, r.tokens_output),
      processingMs: Date.now() - startMs,
    });
    console.log(`[trello-qa] markCompleted OK total=${Date.now() - startMs}ms`);
  } catch (err) {
    console.error(`[trello-qa] ERROR card=${card_short_id} code=${err.code} msg=${err.message}`);
    console.error(err.stack);
    await markFailed(client, attempt.id, {
      status: 'llm_failed',
      errorCode: err.code || 'UNKNOWN',
      errorMessage: err.message,
    });
    try {
      await trelloClient.addComment(card_id,
        `🚨 Agente falhou na triagem: \`${err.code || 'UNKNOWN'}\` — ${err.message}\n\nUm dev humano vai revisar manualmente.`);
    } catch { /* best-effort */ }
  }
}

async function _handleFix(client, data, startMs) {
  const {
    card_id, card_short_id, slash_command, hint, member_username, triggered_by,
  } = data;

  // SEMÂNTICA dos slash commands:
  //   /fix aprovado         → APLICA o fix (edita código, roda testes, push main, deploy)
  //   /fix retry [: hint]   → RE-ANALISA (triagem nova, opcionalmente com hint humano)
  //   /fix detalhe          → stub (análise extra futura)
  //   /fix cancel           → marca card pra dev humano
  // Só `aprovado` mexe em código. `retry` é read-only (re-triagem).

  if (slash_command === 'detalhe') {
    await trelloClient.addComment(card_id,
      `🔍 Análise detalhada vai vir aqui em proxima versão. Use \`/fix retry: <hint>\` pra forçar uma re-análise com sua dica.`);
    return;
  }

  if (slash_command === 'cancel') {
    await createAttempt(client, {
      cardId: card_id, cardShortId: card_short_id, attempt: 0,
      triggerType: 'cancel', triggeredBy: triggered_by,
    });
    await trelloClient.addComment(card_id,
      `✋ Cancelado por @${member_username}. Card marcado pra dev humano. Não responderei mais aqui.`);
    return;
  }

  // /fix retry → RE-TRIAGEM (não conta como attempt de fix; não chega no MAX_ATTEMPTS)
  if (slash_command === 'retry') {
    const attempt = await createAttempt(client, {
      cardId: card_id, cardShortId: card_short_id, attempt: 0,
      triggerType: 'retry', triggeredBy: triggered_by, hint,
    });
    await markRunning(client, attempt.id);
    try {
      const card = await trelloClient.getCard(card_id);
      const r = await triageCard({ card, repoRoot: REPO_ROOT, hint });
      const comment = buildAnalysisComment(r.analysis);
      await trelloClient.addComment(card_id, comment);
      await markCompleted(client, attempt.id, {
        status: 'completed',
        llmTokensInput: r.tokens_input,
        llmTokensOutput: r.tokens_output,
        llmCostUsd: _estimateCost(r.tokens_input, r.tokens_output),
        processingMs: Date.now() - startMs,
      });
    } catch (err) {
      await markFailed(client, attempt.id, {
        status: 'llm_failed',
        errorCode: err.code || 'UNKNOWN',
        errorMessage: err.message,
      });
      try {
        await trelloClient.addComment(card_id,
          `🚨 Re-análise falhou: \`${err.code || 'UNKNOWN'}\` — ${err.message}`);
      } catch { /* best-effort */ }
    }
    return;
  }

  // /fix aprovado → APLICA fix (edita, testa, push main, CI deploy)
  const completedCount = await countCompletedAttempts(client, { cardId: card_id });
  if (completedCount >= MAX_ATTEMPTS) {
    await trelloClient.addComment(card_id,
      `🛑 Limite de ${MAX_ATTEMPTS} attempts atingido. Dev humano precisa intervir.`);
    return;
  }

  const newAttempt = completedCount + 1;

  const attempt = await createAttempt(client, {
    cardId: card_id, cardShortId: card_short_id, attempt: newAttempt,
    triggerType: 'fix', triggeredBy: triggered_by, hint,
  });
  await markRunning(client, attempt.id);

  try {
    const card = await trelloClient.getCard(card_id);
    const r = await fixCard({
      card, attempt: newAttempt, hint, memberUsername: member_username,
      repoRoot: REPO_ROOT,
      scope: 'api',
    });

    if (r.status === 'pushed_to_main') {
      const commitUrl = `https://github.com/rodrigonoma/genomaflow/commit/${r.commit_sha}`;
      await markCompleted(client, attempt.id, {
        status: 'pr_opened',  // mantém enum existente; semântica nova
        prUrl: commitUrl,
        branchName: 'main',
        testSummary: r.test_summary,
        llmTokensInput: r.tokens_input, llmTokensOutput: r.tokens_output,
        llmCostUsd: _estimateCost(r.tokens_input, r.tokens_output),
        processingMs: Date.now() - startMs,
      });
      await trelloClient.addComment(card_id,
        `✅ Mergeado direto em main: ${commitUrl}\n\nTestes verdes (test:unit). Deploy automático via deploy.yml — acompanhe em https://github.com/rodrigonoma/genomaflow/actions`);
    } else if (r.status === 'tests_failed') {
      await markCompleted(client, attempt.id, {
        status: 'tests_failed',
        testSummary: r.test_summary,
        llmTokensInput: r.tokens_input, llmTokensOutput: r.tokens_output,
        llmCostUsd: _estimateCost(r.tokens_input, r.tokens_output),
        processingMs: Date.now() - startMs,
      });
      const failedCount = r.test_summary?.failed || '?';
      await trelloClient.addComment(card_id,
        `❌ Testes falharam (${failedCount}). NÃO criei PR.\n\nSaída resumida:\n\`\`\`\n${(r.stdout || '').slice(-1500)}\n\`\`\`\n\nComente \`/fix retry: <hint>\` com sua dica ou \`/fix cancel\` se quiser dev humano.`);
    }
  } catch (err) {
    await markFailed(client, attempt.id, {
      status: 'llm_failed',
      errorCode: err.code || 'UNKNOWN',
      errorMessage: err.message,
    });
    await trelloClient.addComment(card_id,
      `🚨 Agente falhou: \`${err.code || 'UNKNOWN'}\` — ${err.message}\n\nComente \`/fix retry\` pra tentar de novo ou \`/fix cancel\`.`);
  }
}

function _estimateCost(input, output) {
  return ((input * 3) + (output * 15)) / 1_000_000;
}

module.exports = { processTrelloQA };
