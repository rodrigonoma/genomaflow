// apps/api/tests/services/swagger-parser.test.js
'use strict';

const { fetchAndParseSwagger, resolveFieldMap } = require('../../src/services/swagger-parser');

describe('resolveFieldMap', () => {
  it('resolves simple path', () => {
    const result = resolveFieldMap({ 'patient.name': '$.nome' }, { nome: 'João' });
    expect(result['patient.name']).toBe('João');
  });

  it('resolves nested path', () => {
    const result = resolveFieldMap(
      { 'patient.name': '$.paciente.nome_completo' },
      { paciente: { nome_completo: 'Maria' } }
    );
    expect(result['patient.name']).toBe('Maria');
  });

  it('returns null for missing path', () => {
    const result = resolveFieldMap({ 'patient.name': '$.missing.field' }, {});
    expect(result['patient.name']).toBeNull();
  });

  it('resolves array-index path', () => {
    const result = resolveFieldMap(
      { 'patient.name': '$.results[0].name' },
      { results: [{ name: 'Ana' }] }
    );
    expect(result['patient.name']).toBe('Ana');
  });

  it('handles empty sourcePath', () => {
    const result = resolveFieldMap({ 'patient.name': '' }, { nome: 'X' });
    expect(result['patient.name']).toBeNull();
  });

  it('handles root-only path $', () => {
    const result = resolveFieldMap({ x: '$' }, { foo: 1 });
    expect(result.x).toBeNull();
  });
});

describe('fetchAndParseSwagger — URL validation (no network)', () => {
  it('throws on empty url', async () => {
    await expect(fetchAndParseSwagger('')).rejects.toThrow('non-empty string');
  });

  it('throws on non-http scheme', async () => {
    await expect(fetchAndParseSwagger('ftp://example.com/spec.json')).rejects.toThrow('http/https');
  });

  it('throws on localhost', async () => {
    await expect(fetchAndParseSwagger('http://localhost:3000/spec.json')).rejects.toThrow('Private/loopback');
  });

  it('throws on 127.0.0.1', async () => {
    await expect(fetchAndParseSwagger('http://127.0.0.1/spec.json')).rejects.toThrow('Private/loopback');
  });

  it('throws on 10.x address', async () => {
    await expect(fetchAndParseSwagger('http://10.0.0.1/spec.json')).rejects.toThrow('Private/loopback');
  });

  it('throws on 169.254.x.x (cloud metadata)', async () => {
    await expect(fetchAndParseSwagger('http://169.254.169.254/latest/meta-data/')).rejects.toThrow('Private/loopback');
  });

  it('throws on IPv6 loopback [::1]', async () => {
    await expect(fetchAndParseSwagger('http://[::1]/spec.json')).rejects.toThrow('Private/loopback');
  });

  it('throws on 0.0.0.0', async () => {
    await expect(fetchAndParseSwagger('http://0.0.0.0/spec.json')).rejects.toThrow('Private/loopback');
  });
});

describe('resolveFieldMap — null safety', () => {
  it('returns empty object for null fieldMap', () => {
    expect(resolveFieldMap(null, { foo: 1 })).toEqual({});
  });

  it('returns empty object for undefined fieldMap', () => {
    expect(resolveFieldMap(undefined, {})).toEqual({});
  });
});
