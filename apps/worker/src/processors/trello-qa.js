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

  const attempt = await createAttempt(client, {
    cardId: card_id, cardShortId: card_short_id, attempt: 0,
    triggerType: 'triage', triggeredBy: triggered_by,
  });
  await markRunning(client, attempt.id);

  try {
    const card = await trelloClient.getCard(card_id);
    const r = await triageCard({ card, repoRoot: REPO_ROOT });
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
        `🚨 Agente falhou na triagem: \`${err.code || 'UNKNOWN'}\` — ${err.message}\n\nUm dev humano vai revisar manualmente.`);
    } catch { /* best-effort */ }
  }
}

async function _handleFix(client, data, startMs) {
  const {
    card_id, card_short_id, slash_command, hint, member_username, triggered_by,
  } = data;

  if (slash_command === 'detalhe') {
    await trelloClient.addComment(card_id,
      `🔍 Análise detalhada vai vir aqui em proxima versão. Veja o último teste falhado no GitHub Actions ou rode \`/fix retry: <hint>\`.`);
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

  const completedCount = await countCompletedAttempts(client, { cardId: card_id });
  if (completedCount >= MAX_ATTEMPTS) {
    await trelloClient.addComment(card_id,
      `🛑 Limite de ${MAX_ATTEMPTS} attempts atingido. Dev humano precisa intervir.`);
    return;
  }

  const newAttempt = completedCount + 1;
  const triggerType = slash_command === 'retry' ? 'retry' : 'fix';

  const attempt = await createAttempt(client, {
    cardId: card_id, cardShortId: card_short_id, attempt: newAttempt,
    triggerType, triggeredBy: triggered_by, hint,
  });
  await markRunning(client, attempt.id);

  try {
    const card = await trelloClient.getCard(card_id);
    const r = await fixCard({
      card, attempt: newAttempt, hint, memberUsername: member_username,
      repoRoot: REPO_ROOT,
      scope: 'api',
    });

    if (r.status === 'pr_opened') {
      await markCompleted(client, attempt.id, {
        status: 'pr_opened',
        prUrl: r.pr_url, branchName: r.branch_name,
        testSummary: r.test_summary,
        llmTokensInput: r.tokens_input, llmTokensOutput: r.tokens_output,
        llmCostUsd: _estimateCost(r.tokens_input, r.tokens_output),
        processingMs: Date.now() - startMs,
      });
      await trelloClient.addComment(card_id,
        `✅ PR aberto: ${r.pr_url}\n\nTestes verdes (${r.test_summary?.passed} passed). Revise antes de mergear.`);
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
