# Padrões de teste do projeto

## Regras

**CI gate é obrigatório.** `.github/workflows/deploy.yml` tem job `test` que roda antes do `deploy`:
- `apps/api` → `npm run test:unit` (subset sem DB)
- `apps/worker` → `npm test` (suite completa)
- `apps/web` → `npm test` (Jest + jsdom)

Falha em qualquer um bloqueia deploy. Nunca remover esse gate.

**Testes que precisam de DB ficam FORA do `test:unit`.** Em `apps/api/package.json`:
- `test` = suite completa (DB-dependent, dev local)
- `test:unit` = lista explícita de paths sem dependência de DB (CI)

Adicionar novo arquivo de teste ao `test:unit` exige que ele rode sem Postgres ativo. Se precisar de DB → vai pro `test` mas não bloqueia CI.

**Funções puras críticas devem ser testadas.** Padrão estabelecido:
- PII patterns (regex match/noMatch)
- ACL gates (role check)
- Validação de body (strict equality em flags LGPD)
- Anonimização (allowlist de chaves do output)

**Skip honesto.** Quando teste legado quebra por refatoração e reescrever está fora de escopo, marcar com `describe.skip` + comentário `TODO(test-debt):` explicando causa e quando reabilitar (geralmente "quando alguém tocar no componente"). Nunca deletar — visibilidade da dívida importa.

**Padrão de mock pra Fastify isolado.** Pra testar route validation sem DB:
1. Build Fastify mínimo com `fastify.decorate('authenticate', stubFn)` que lê role de header
2. `fastify.decorate('pg', { query: jest.fn(...) })` retornando mock
3. Stub joga erro se chamado em request rejeitada — sinal de regressão silenciosa do gate
4. `app.inject({ method, url, payload })` em vez de supertest (Fastify nativo)

Modelos vivos: `tests/security/master-acl.test.js`, `tests/routes/billing-validation.test.js`, `tests/routes/inter-tenant-chat/messages-validation.test.js`.

## Why

V1.5 da redação de PDF subiu pra prod com zero teste e quebrou em produção (3min processing). V2 subiu também sem teste. Sem CI gate, regressões só apareciam por reporte de usuário.

Bugs específicos que tests agora pegam:
- Bug 2026-04-23: `role !== 'admin'` em vez de `'master'` em feedback.js — agora `master-acl.test.js` regressão.
- Strict equality em `user_confirmed_scanned` / `user_confirmed_anonymized`: bypass via `"true"` ou `1` rejeitado — `messages-validation.test.js`.
- Allowlist em `anonymizeAiAnalysis`: campo PII novo no subject sem excluir = teste vermelho.
- Worker test bitrot: agentes mudaram return shape pra `{result, usage}` mas tests não — fixado e protegido.

## How to apply

**Escrevendo feature nova:**
- Se mexe em rota com auth/role → escreve teste de ACL no mesmo PR
- Se adiciona campo flag de segurança → escreve teste de strict equality
- Se adiciona pattern PII / regra de validação → escreve match/noMatch matrix
- Se modifica anonymize/redact → roda allowlist test (catch field-add esquecido)

**Refatorando código com test legado:**
- Roda `npm test` antes da mudança. Se passa: ótimo, mantém.
- Se quebra: tenta corrigir o teste alinhando com novo shape (ver shift `{result, usage}` nos agentes do worker como exemplo).
- Se reescrita do teste é maior que a refatoração: skip com TODO claro. Não silenciar.

**Adicionando teste novo no CI gate:**
- API: appendar path em `test:unit` script de `apps/api/package.json`
- Worker: arquivo cai automaticamente (`testMatch: tests/**/*.test.js`)
- Web: arquivo cai automaticamente (`testMatch: **/*.spec.ts`)

**ESM no Jest é teto baixo.** Módulos com dynamic import (`pdfjs-dist`, deps em pipeline DICOM) precisam `--experimental-vm-modules`. Por ora, esses casos = skip com TODO. Se virar bloqueador real, configurar global ESM no jest.

## Cobertura atual (snapshot 2026-04-25)

- **API**: 176 testes verdes, 3 skipped (3 integração ESM)
- **Worker**: 30 verdes, 1 skipped (processExam — dynamic import)
- **Web**: 10 verdes, 3 skipped (Login + PatientList — refatoração inject/FormGroup)
- **Total**: 216 verdes / 7 skipped

Áreas com cobertura: PII patterns (PDF + image), classifyByRegex, drawRedaction, ACL master-only, anonymizeAiAnalysis, messages.js validation, billing admin-gate + credit packages, prescriptions agent_type whitelist + items shape, constants whitelists.

Áreas SEM cobertura unitária (precisam DB ou são UI complexa): auth/login, exams, patients, users, alerts, integrations, dashboard, prescription PDF, master credit grant, todas as telas Angular além dos 4 specs básicos.

## Red flags

- PR de feature nova em área crítica (auth, RLS, billing, PII) sem teste novo → questionar antes de aprovar
- `describe.skip` ou `it.skip` sem comentário TODO explicando causa → exigir comentário
- Adicionar novo path em `test:unit` que precisa de DB → quebra CI gate; deve ir pro `test` completo
- Remover `npm test` ou `npm run test:unit` do `.github/workflows/deploy.yml` → bloquear PR
- Criar mock de função externa via `jest.mock('@anthropic-ai/sdk', ...)` sem cobrir a forma `.default` ou direta — inspirar em `pdf-text-redactor.test.js` e `redactor.test.js` que mostram os dois jeitos
