---
name: Docker COPY .git extraheader leak
description: actions/checkout carimba http.extraheader no .git/config com GITHUB_TOKEN do runner. Quando Dockerfile faz COPY .git, esse extraheader vaza pro container e contamina futuros git push. Incidente 2026-05-14.
type: feedback
---

# `actions/checkout` extraheader contamina containers que COPYam `.git`

**Regra:** se o Dockerfile faz `COPY .git /caminho/.git`, **SEMPRE** rodar:
```dockerfile
RUN cd /caminho && git config --unset-all http.https://github.com/.extraheader 2>/dev/null || true
```
imediatamente após o COPY.

**Why:** o step `actions/checkout` no GitHub Actions runner adiciona em
`.git/config`:
```
[http "https://github.com/"]
  extraheader = AUTHORIZATION: basic <BASE64(GITHUB_TOKEN)>
```
pra autenticar como `github-actions[bot]` durante a job. Esse arquivo
fica BAKED em qualquer imagem Docker construída a partir do workspace.

Em runtime, qualquer `git push` desse container vira:
- Se push usa URL-embedded auth (`https://x-access-token:PAT@github.com/...`):
  → extraheader cached **sobrescreve** a URL auth → autentica como
    github-actions[bot] → "denied" se o branch protection não permitir
- Se push usa http.extraheader Bearer:
  → GitHub recebe **2 Authorization headers** → erro 400 "Duplicate header"

**Sintomas:**
- `Permission to <owner>/<repo>.git denied to github-actions[bot]`
- `remote: Duplicate header: "Authorization"`
- `fatal: unable to access '...': The requested URL returned error: 400`

**Detectar:** `git config --get http.https://github.com/.extraheader` dentro
do container retorna uma string (deveria ser vazio).

**Como aplicar:**

1. No Dockerfile (recomendado — limpa baked):
```dockerfile
COPY .git /app/repo/.git
RUN cd /app/repo && git config --unset-all http.https://github.com/.extraheader 2>/dev/null || true
```

2. Runtime (defesa em profundidade):
```js
try {
  await execGit(['config', '--unset-all', 'http.https://github.com/.extraheader']);
} catch (_) { /* não existe — ok */ }
```

**Pacotes/cenários afetados:**
- Worker Docker images que precisam de `.git` (Trello QA Agent — para `git commit`/`push` em runtime)
- Qualquer container que pretende fazer `git push` autenticado
- NÃO afeta containers que só fazem read (clone, log)

## Não regredir

❌ Não remover o `git config --unset-all` do Dockerfile do worker Trello
❌ Não confiar só na URL-embedded auth — extraheader cached sobrescreve
❌ Não confiar no `--unset extraheader` sem `--unset-all` — extraheader pode ter múltiplas entries

✅ Sempre unset extraheader logo após COPY .git
✅ Validar com `git push --dry-run` em smoke test pós-deploy
