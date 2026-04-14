/**
 * Strips PII from patient data before sending to Claude (LGPD compliance).
 * Removes name, CPF. Replaces birth_date with decade-based age_range.
 *
 * @param {{ name?: string, cpf_hash?: string, birth_date?: string, sex?: string }} patient
 * @returns {{ sex: string, age_range: string }}
 */
function anonymize(patient) {
  const result = { sex: patient.sex };

  if (patient.birth_date) {
    const age = new Date().getFullYear() - new Date(patient.birth_date).getFullYear();
    const decade = Math.floor(age / 10) * 10;
    result.age_range = `${decade}-${decade + 9}`;
  }

  return result;
}

module.exports = { anonymize };
