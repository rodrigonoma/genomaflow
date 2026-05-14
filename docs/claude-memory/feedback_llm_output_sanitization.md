---
name: Saneamento defensivo de output do LLM
description: LLM pode mentir/alucinar/falhar — backend NUNCA confia cegamente em JSON parseado. Pattern obrigatório pra qualquer feature de IA que produz dados estruturados
type: feedback
---

# Saneamento defensivo do output do LLM

LLMs (Claude/GPT) **podem retornar:**
- JSON com prefixo de texto (`"Aqui vai a análise:\n```json\n{...}\n```"`)
- JSON malformado (chaves faltando, vírgulas extras)
- Campos com tipos errados (string onde devia ser number)
- Valores fora de range (priority="urgent" quando só aceita high/medium/low)
- Arrays vazios em vez de objetos esperados
- Tokens absurdamente longos (10k chars num campo "title")
- Hallucinations (CIDs inexistentes, diretrizes que não existem)
- Falhar a chamada (timeout, 500, 429)

**O backend NUNCA pode confiar cegamente em `JSON.parse(response)`.** Aplicar saneamento em CADA feature de IA estruturada.

## Pattern obrigatório

```js
async function callLLM(input) {
  // ─── 1. Validação de entrada ───
  if (!isValidInput(input)) {
    const e = new Error('input_invalid');
    e.code = 'INPUT_INVALID';
    throw e;
  }

  // ─── 2. Call ao LLM ───
  const response = await client.messages.create({...});
  const text = response.content?.[0]?.text || '';

  // ─── 3. Parser tolerante (extrai JSON com prefixo de texto) ───
  let parsed;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch (err) {
    const e = new Error('LLM returned non-JSON output');
    e.code = 'BAD_LLM_OUTPUT';
    e.raw = text;
    throw e;
  }

  // ─── 4. Validação de schema (campos obrigatórios) ───
  if (!Array.isArray(parsed.suggestions)) {
    throw Object.assign(new Error('suggestions missing'), { code: 'BAD_LLM_OUTPUT' });
  }

  // ─── 5. Saneamento de cada entry ───
  const validPriorities = ['high', 'medium', 'low'];
  const cleaned = parsed.suggestions
    .filter(s => s && typeof s.title === 'string' && typeof s.rationale === 'string')
    .map(s => ({
      id: randomUUID(),
      title: s.title.slice(0, 120),               // slice de strings
      rationale: s.rationale.slice(0, 300),
      prob_score: Math.max(0, Math.min(1, Number(s.prob_score) || 0)), // clamp numérico
      priority: validPriorities.includes(s.priority) ? s.priority : 'medium', // whitelist
      icd10: typeof s.icd10 === 'string' ? s.icd10.slice(0, 20) : null,
    }))
    .slice(0, 5); // limite máximo de itens

  return cleaned;
}
```

## Checklist de saneamento

Pra qualquer feature de IA estruturada:

- [ ] Validação de entrada antes do call (tamanho mínimo, campos obrigatórios)
- [ ] Regex pra extrair JSON mesmo com prefixo (`/\{[\s\S]*\}/`)
- [ ] try/catch no `JSON.parse` → throw `BAD_LLM_OUTPUT`
- [ ] Verifica shape esperado (Array.isArray, typeof object) antes de iterar
- [ ] Filter entries malformados (sem campos obrigatórios)
- [ ] Whitelist de enums com fallback default
- [ ] Clamp numérico em ranges válidos
- [ ] Slice de strings (defesa contra prompt injection com tokens enormes)
- [ ] Limite máximo de itens (`.slice(0, N)`)
- [ ] Endpoint retorna 502 em `BAD_LLM_OUTPUT` (não 500 — não é nosso bug)
- [ ] Log do `raw` output em `BAD_LLM_OUTPUT` pra debug
- [ ] Disclaimer obrigatório no frontend ("⚕ Sugestões da IA. Médico decide.")

## Onde foi aplicado

- `apps/api/src/services/ai-suggestions.js` (Phase 4.3)
- `apps/api/src/services/encounter-copilot.js` (Phase 4.4)
- `apps/worker/src/parsers/image.js` (Phase 4.1 — output `medical_image|document|unknown` simples mas com fallback `unknown`)

## Tests obrigatórios

Cada feature de IA estruturada deve ter pelo menos:

- ✅ Parsing de JSON válido completo (happy path)
- ✅ JSON com prefixo de texto (extração via regex)
- ✅ Texto não-JSON → throw `BAD_LLM_OUTPUT`
- ✅ Campos faltando → entries filtrados
- ✅ Valor fora de range → fallback / clamp
- ✅ Arrays vazios → coerentes (não null)

Modelo: `tests/services/ai-suggestions.test.js` e `tests/services/encounter-copilot.test.js`.

## Custo de inference

LLM call não é grátis. Antes de adicionar uma feature de IA:

- [ ] Estimar custo médio por call
- [ ] Cache quando faz sentido (estado do paciente = TTL 24h)
- [ ] Rate limiting por tenant (`config: { rateLimit: { max: N, timeWindow: '1 minute' } }`)
- [ ] Considerar passar pra `credit_ledger` se for feature billable

## Disclaimers obrigatórios em features clínicas

Toda UI que mostra output de IA clínica DEVE ter:

- "⚕ Sugestões da IA. Médico decide." (footer do card)
- Linguagem de sugestão ("considere", "investigue", "exclua") — NUNCA afirmação ("é", "tem")
- Não usar verbos imperativos ("faça", "peça")
- Quando hipótese diagnóstica, mostrar prob_score como contexto (não certeza)

Princípio: a IA sugere, o médico decide. Sem isso, a clínica fica responsável por "diagnóstico de IA" — risco LGPD + CRM/CFM.
