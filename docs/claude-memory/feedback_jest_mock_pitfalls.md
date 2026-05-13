---
name: Jest mock pitfalls — armadilhas no CI que não aparecem localmente
description: Dois bugs de testes que passaram local mas quebraram CI em 2026-05-13 V2 Fase 1. Regex sobre SQL multi-linha e jest.mock module-level com contagem cumulativa.
type: feedback
---

# Jest mock pitfalls — bugs CI-only

Dois bugs de testes V2 Fase 1 (2026-05-13) que **passaram local mas quebraram CI**. Padrão comum: a forma como o teste é executado isolado esconde o bug.

## Bug 1: regex `.*` em mock pg sobre SQL multi-linha

### Sintoma
Testes assertam `res.statusCode === 201` mas recebem `400`/`404` em CI. Localmente passam.

### Causa raiz
Mock pg comum em route tests:
```js
app.decorate('pg', {
  query: jest.fn(async (sql, params) => {
    if (/SELECT .* FROM aesthetic_sessions/i.test(sql)) {
      // retorna row
    }
    return { rows: [] };  // fallback
  }),
});
```

`.` em regex sem flag `s` NÃO casa newline. O SQL real é multi-linha:
```sql
SELECT id, tenant_id, subject_id, user_id,
       session_date, session_type, notes, created_at
  FROM aesthetic_sessions
 WHERE id = $1 ...
```

O `.*` para na primeira newline. Match falha. Cai no fallback `{ rows: [] }`. Rota retorna 404 ou 400. Teste falha.

### Por que passa local
Roda só esse arquivo isolado, ou o SQL no service muda pra single-line, ou outra heurística entra antes.

### Fix
Trocar `.*` por `[\s\S]*` (qualquer char incluindo newline) **OU** usar flag `s` (`/SELECT .* FROM/is`).

```js
if (/SELECT [\s\S]* FROM aesthetic_sessions/i.test(sql)) {  // ✅
```

### Como prevenir
- Quando escrever mock pg que detecta SQL por regex, **sempre** `[\s\S]*` em vez de `.*`
- Considerar mock por nome de tabela apenas: `/aesthetic_sessions/i.test(sql)` sem `SELECT` (mais frágil mas evita o problema)
- Test runner Camada 2 (integration tests com Postgres real) **pega** esse bug — usar quando possível pra schemas críticos

---

## Bug 2: `jest.mock` module-level com contagem cumulativa

### Sintoma
Test assertion `expect(mockFn).toHaveBeenCalledTimes(1)` falha com `Received: 2` quando outros testes do mesmo arquivo já tocaram no mock. Local roda isolado e passa.

### Causa raiz
```js
jest.mock('@mediapipe/tasks-vision', () => ({
  FaceLandmarker: { createFromOptions: jest.fn(...) },
}));

describe('MediaPipeLoaderService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [MediaPipeLoaderService] });
    service = TestBed.inject(MediaPipeLoaderService);
  });

  it('test A', async () => {
    await service.getFaceLandmarker();
    expect(lib.FaceLandmarker.createFromOptions).toHaveBeenCalledTimes(1); // ✅ ok
  });

  it('test B', async () => {
    await service.getFaceLandmarker();
    expect(lib.FaceLandmarker.createFromOptions).toHaveBeenCalledTimes(1); // ❌ FAIL: 2
  });
});
```

`jest.mock` é declarado a nível de módulo. O `jest.fn()` retornado mantém contadores **acumulados entre testes** do mesmo arquivo. TestBed cria nova instância do service, mas o mock externo persiste.

### Por que passa local
`npx jest --testPathPattern=esse-arquivo` rodando só os testes que o dev tocou ativamente. Quando dev testa Test B isolado em modo `it.only`, counter está em 0.

### Fix
```js
beforeEach(() => {
  jest.clearAllMocks();           // ✅ zera contadores
  TestBed.resetTestingModule();   // ✅ reset Angular DI também (safer)
  TestBed.configureTestingModule({ providers: [...] });
  service = TestBed.inject(...);
});
```

### Como prevenir
- Padrão: **sempre** `jest.clearAllMocks()` em beforeEach quando há `jest.mock(...)` declarado no topo do arquivo
- Para mocks que retornam objetos com instâncias (ex: `createFromOptions` retorna mesma instance), `mockResolvedValueOnce` por teste é alternativa mais explícita
- Verificar testes em ordem reversa local também: `npx jest --reverse` (não-trivial, mas force) — Jest expor `--randomize` se disponível

---

## Lição geral

**Bug CI-only** = bug que só aparece em ambiente com ordenação determinística e tudo rodando junto. Local + isolado esconde:

| Padrão | Local passa porque | CI quebra porque |
|---|---|---|
| Regex `.*` em mock SQL | Single test, SQL mockado linha única | SQL real multi-linha do service |
| jest.mock contagem cumulativa | Test isolado, counter=0 | Testes anteriores no arquivo herdam counter |
| Order-dependent state | Test isolado | Outros testes mutam estado global antes |
| Timing/async sem await | Loop event diferente local | CI mais lento expõe race |

**Validação útil antes de pushar:** rodar `npm test` no app inteiro (não só o spec alterado) — pelo menos uma vez por PR. CI é a fonte da verdade mas dá um feedback de minutos vs feedback do CI.

## Tests Camada 1 + Camada 2 ainda são o filtro definitivo

Não atalhar. Já tivemos 2 incidentes (2026-05-12 ref_id, 2026-05-13 V2 Fase 1) onde local verde e CI vermelho. Em ambos: regex mock + module-level mock contagem.

Camada 2 (integration tests Postgres real) **não pega** esses bugs — eles são em testes unitários mockados que existem por motivos diferentes (velocidade, isolamento). A correção tem que vir do *padrão dos testes unitários*.
