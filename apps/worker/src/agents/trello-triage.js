// apps/worker/src/agents/trello-triage.js
'use strict';

/**
 * Triage agent — Claude Tool Use loop read-only. Produz análise JSON
 * estruturada que vira comentário markdown no card.
 * Spec: docs/superpowers/specs/2026-05-13-trello-qa-agent-design.md §3.1, §8
 */

const Anthropic = require('@anthropic-ai/sdk').default;
const tools = require('../lib/codebase-tools');

const MODEL = process.env.TRELLO_TRIAGE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 20;

const SYSTEM_PROMPT = `Você é o agente de triagem do GenomaFlow para a coluna QA do Trello.

Sua tarefa: ler o card (nome + descrição), explorar o codebase quando necessário, e produzir uma análise estruturada em JSON.

Tipos válidos: "bug" | "feature" | "copy" | "ux" | "documentation" | "configuration" | "infra" | "other"
makes_sense: "yes" | "partial" | "no"
risk: "low" | "medium" | "high"

Princípios:
- Seja crítico: se a tarefa não faz sentido, diga (makes_sense="no" com explicação clara)
- Identifique impacto cross-feature concretamente (cite componentes/funções)
- Plano de testes deve cobrir caso principal + edge cases
- Detalhes técnicos concretos: cite arquivo:linha quando possível
- NUNCA invente: se não tem informação, pesquise no codebase com tools

Ao terminar, retorne APENAS um JSON válido com este shape:
{
  "type": "bug|feature|...",
  "makes_sense": "yes|partial|no",
  "opinion": "1-3 frases explicando sua avaliação",
  "technical_details": ["Item 1", "Item 2", ...],
  "impact": ["Componente X afetado", ...],
  "test_plan": ["Teste 1", ...],
  "risk": "low|medium|high"
}

Sem texto fora do JSON.`;

async function triageCard({ card, repoRoot, anthropicClient }) {
  const client = anthropicClient || new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 120_000,
  });

  let totalIn = 0, totalOut = 0;
  const messages = [
    { role: 'user', content: `Analise este card Trello da coluna QA:

# ${card.name} (#${card.idShort})

${card.desc || '(sem descrição)'}` },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`[trello-triage] iter ${i + 1}/${MAX_ITERATIONS} model=${MODEL} msgs=${messages.length}`);
    const t0 = Date.now();
    let resp;
    try {
      resp = await Promise.race([
        client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          tools: tools.getToolSchemas({ readOnly: true }),
          messages,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ANTHROPIC_TIMEOUT_60S')), 60_000)),
      ]);
    } catch (err) {
      console.error(`[trello-triage] iter ${i + 1} FAIL after ${Date.now() - t0}ms: ${err.message}`);
      throw err;
    }
    console.log(`[trello-triage] iter ${i + 1} OK in ${Date.now() - t0}ms stop=${resp.stop_reason} usage=in${resp.usage?.input_tokens}/out${resp.usage?.output_tokens}`);

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

    const textBlock = resp.content.find(b => b.type === 'text');
    const text = textBlock?.text || '';
    let parsed;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch {
      throw Object.assign(new Error('BAD_LLM_OUTPUT'), {
        code: 'BAD_LLM_OUTPUT',
        raw: text.slice(0, 500),
      });
    }
    return {
      analysis: parsed,
      tokens_input: totalIn,
      tokens_output: totalOut,
      iterations: i + 1,
    };
  }

  throw Object.assign(new Error('MAX_ITERATIONS atingido'), {
    code: 'MAX_ITERATIONS',
    tokens_input: totalIn,
    tokens_output: totalOut,
  });
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

function buildAnalysisComment(a) {
  const typeMap = {
    bug: 'Bug', feature: 'Feature', copy: 'Copy/Texto', ux: 'UX',
    documentation: 'Documentação', configuration: 'Configuração',
    infra: 'Infra', other: 'Outro',
  };
  const senseMap = {
    yes: '✅ Sim',
    partial: '⚠️ Parcialmente',
    no: '❌ Não recomendado',
  };
  const riskMap = { low: 'Baixo', medium: 'Médio', high: 'Alto' };

  return `## 🤖 Análise Automática (GenomaFlow Agent)

**Tipo:** ${typeMap[a.type] || a.type}
**Faz sentido?** ${senseMap[a.makes_sense] || a.makes_sense} — ${a.opinion}

### Detalhes técnicos
${(a.technical_details || []).map(d => `- ${d}`).join('\n') || '_(sem detalhes específicos identificados)_'}

### Impacto cross-feature
${(a.impact || []).map(d => `- ⚠️ ${d}`).join('\n') || '_(sem impacto cross-feature identificado)_'}

### Plano de testes
${(a.test_plan || []).map(d => `- [ ] ${d}`).join('\n') || '_(definir antes do fix)_'}

**Risco:** ${riskMap[a.risk] || a.risk}

---

### Próximos passos

Para que o agente implemente o fix, comente:
- \`/fix aprovado\` — agente edita código + roda testes + abre PR
- \`/fix retry\` — só após attempt anterior; re-tenta com mesma análise
- \`/fix retry: <hint>\` — re-tenta com sua dica (ex: \`/fix retry: usa getById em vez de getByName\`)
- \`/fix detalhe\` — agente explica análise profunda
- \`/fix cancel\` — desiste, marca pra dev humano`;
}

module.exports = { triageCard, buildAnalysisComment };
