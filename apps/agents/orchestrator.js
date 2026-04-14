
const { endocrinologyAgent } = require('./endocrinology.agent');

async function orchestrate(ctx) {
  if (ctx.message.includes('sede') || ctx.message.includes('cansaço')) {
    return endocrinologyAgent(ctx);
  }

  return {
    flow: "triage",
    summary: "Encaminhado para triagem geral"
  };
}

module.exports = { orchestrate };
