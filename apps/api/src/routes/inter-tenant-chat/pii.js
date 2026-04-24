const Anthropic = require('@anthropic-ai/sdk');

// Regex PII patterns — determinísticos, alta confiança
const PATTERNS = {
  cpf:   /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
  cnpj:  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,
  phone: /\b(?:\+?55\s*)?(?:\(?\d{2}\)?[\s-]?)?(?:9?\d{4})[\s-]?\d{4}\b/g,
  email: /\b[\w._%+-]+@[\w.-]+\.[a-z]{2,}\b/gi,
  cep:   /\b\d{5}-?\d{3}\b/g,
  rg:    /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dxX]\b/g,
};

function scanWithRegex(text) {
  const detected = [];
  if (!text) return detected;
  for (const [kind, re] of Object.entries(PATTERNS)) {
    const matches = text.match(re);
    if (matches && matches.length > 0) detected.push({ kind, count: matches.length });
  }
  return detected;
}

let anthropicClient = null;
function getAnthropic() {
  if (!anthropicClient && process.env.ANTHROPIC_API_KEY) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

async function scanWithLLM(text) {
  if (!text || text.trim().length === 0) return { has_pii: false, kinds: [] };
  const client = getAnthropic();
  if (!client) return { has_pii: false, kinds: [] };

  const prompt = `Você é um classificador de PII (Informações Pessoais Identificáveis) brasileiras para LGPD.

Analise o texto abaixo e identifique se contém:
- Nome próprio de pessoa física (ex: "João da Silva", "Dr. Maria")
- Endereço físico (rua, número, bairro específico)
- Número de prontuário ou identificador hospitalar específico
- Foto ou referência visual a pessoa identificável
- Data de nascimento completa (dd/mm/yyyy de um indivíduo específico)

NÃO considere PII:
- Idade em faixas (ex: "paciente de 60 anos")
- Termos médicos genéricos
- Nomes de medicamentos, patologias, agentes clínicos
- Datas de consulta ou exame
- Dados clínicos numéricos (hemoglobina, pressão arterial, etc.)

Responda APENAS em JSON válido (sem texto antes ou depois):
{"has_pii": true|false, "kinds": ["name","address","medical_record","photo","birthdate"]}

Texto:
"""
${text.slice(0, 5000)}
"""`;

  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = res.content?.[0]?.text || '{}';
    const jsonStart = raw.indexOf('{');
    const jsonEnd   = raw.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < 0) return { has_pii: false, kinds: [] };
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    return {
      has_pii: !!parsed.has_pii,
      kinds: Array.isArray(parsed.kinds) ? parsed.kinds : [],
    };
  } catch (_) {
    return { has_pii: false, kinds: [] };
  }
}

async function checkPii(text) {
  const regexDetected = scanWithRegex(text);
  const llmResult = await scanWithLLM(text);

  const allKinds = new Set();
  let regionCount = 0;
  for (const d of regexDetected) {
    allKinds.add(d.kind);
    regionCount += d.count;
  }
  for (const k of llmResult.kinds) allKinds.add(k);
  if (llmResult.has_pii && regionCount === 0) regionCount = 1;

  return {
    has_pii: allKinds.size > 0,
    detected_kinds: [...allKinds],
    region_count: regionCount,
  };
}

async function extractPdfText(buffer) {
  const pdfParse = require('pdf-parse');
  try {
    const data = await pdfParse(buffer);
    return (data.text || '').trim();
  } catch (_) {
    return '';
  }
}

module.exports = { checkPii, scanWithRegex, scanWithLLM, extractPdfText, PATTERNS };
