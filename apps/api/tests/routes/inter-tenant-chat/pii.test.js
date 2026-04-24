const { scanWithRegex, checkPii, PATTERNS } = require('../../../src/routes/inter-tenant-chat/pii');

describe('scanWithRegex', () => {
  it('detecta CPF formatado', () => {
    const out = scanWithRegex('Paciente CPF 123.456.789-01');
    expect(out.find(d => d.kind === 'cpf')).toBeTruthy();
  });

  it('detecta CPF sem formatação', () => {
    const out = scanWithRegex('12345678901 número');
    expect(out.find(d => d.kind === 'cpf')).toBeTruthy();
  });

  it('detecta CNPJ', () => {
    const out = scanWithRegex('CNPJ 12.345.678/0001-90');
    expect(out.find(d => d.kind === 'cnpj')).toBeTruthy();
  });

  it('detecta email', () => {
    const out = scanWithRegex('contato joao@exemplo.com.br');
    expect(out.find(d => d.kind === 'email')).toBeTruthy();
  });

  it('detecta telefone BR com DDD', () => {
    const out = scanWithRegex('tel (11) 98765-4321');
    expect(out.find(d => d.kind === 'phone')).toBeTruthy();
  });

  it('detecta CEP', () => {
    const out = scanWithRegex('endereço CEP 01310-100');
    expect(out.find(d => d.kind === 'cep')).toBeTruthy();
  });

  it('texto clínico limpo retorna vazio', () => {
    expect(scanWithRegex('Hemoglobina 14 g/dL, leucócitos 8000')).toEqual([]);
  });

  it('string vazia/null retorna vazio', () => {
    expect(scanWithRegex('')).toEqual([]);
    expect(scanWithRegex(null)).toEqual([]);
    expect(scanWithRegex(undefined)).toEqual([]);
  });
});

describe('checkPii (sem LLM key)', () => {
  it('texto clínico limpo → has_pii=false', async () => {
    const r = await checkPii('Paciente com hipertensão, pressão 140/90');
    expect(r.has_pii).toBe(false);
    expect(r.detected_kinds).toEqual([]);
  });

  it('CPF → has_pii=true', async () => {
    const r = await checkPii('CPF 123.456.789-01 do paciente');
    expect(r.has_pii).toBe(true);
    expect(r.detected_kinds).toContain('cpf');
    expect(r.region_count).toBeGreaterThan(0);
  });

  it('múltiplos PII → detected_kinds sem duplicatas', async () => {
    const r = await checkPii('Maria da Silva, CPF 123.456.789-01, tel (11) 98765-4321, maria@ex.com');
    expect(r.has_pii).toBe(true);
    expect(r.detected_kinds).toContain('cpf');
    expect(r.detected_kinds).toContain('phone');
    expect(r.detected_kinds).toContain('email');
    expect(new Set(r.detected_kinds).size).toBe(r.detected_kinds.length);
  });
});
