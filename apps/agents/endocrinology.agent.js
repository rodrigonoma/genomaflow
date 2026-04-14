
async function endocrinologyAgent(ctx) {
  return {
    flow: "endocrinology",
    risk_level: "MEDIUM",
    summary: "Possível alteração glicêmica. Procure um endocrinologista. Esta análise não substitui avaliação médica."
  };
}

module.exports = { endocrinologyAgent };
