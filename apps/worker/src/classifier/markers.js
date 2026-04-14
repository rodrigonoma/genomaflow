const AGENT_MARKERS = {
  metabolic: [
    /glicemia/i, /glicose/i, /hba1c/i, /hemoglobina\s+glicada/i,
    /insulina/i, /tsh/i, /t4/i, /tireoide/i
  ],
  cardiovascular: [
    /colesterol/i, /ldl/i, /hdl/i, /vldl/i,
    /triglicér/i, /trigliceri/i, /pcr/i, /proteína\s+c\s+reativa/i
  ],
  hematology: [
    /hemoglobina/i, /hematoc?r[ií]to/i, /eritr[oó]citos/i, /leuc[oó]citos/i,
    /plaquetas/i, /neutr[oó]filos/i, /linf[oó]citos/i, /hemograma/i
  ]
};

/**
 * Returns which clinical agents should analyze the given exam text.
 * @param {string} text
 * @returns {string[]} e.g. ['metabolic', 'cardiovascular']
 */
function classifyAgents(text) {
  return Object.entries(AGENT_MARKERS)
    .filter(([, patterns]) => patterns.some(p => p.test(text)))
    .map(([agent]) => agent);
}

module.exports = { classifyAgents };
