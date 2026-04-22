---
name: Histórico de stashes e código recuperado
description: Registro de stashes WIP que existiram e o que foi recuperado de cada um — referência para não perder código novamente
type: project
originSessionId: 70201c53-e120-4e84-a6d1-e96d8946598d
---
## Stashes WIP identificados no histórico (git log --all)

### `b559156a` e `412fe26d` — "WIP on main: 585d161"
Criado em: 2026-04-20 12:33
Base: commit `585d161` (docs: security premises)
48 arquivos — maior stash do projeto.

**Já recuperado em `65dcc28a` (2026-04-21 00:00):**
- apps/landing/index.html
- apps/web/.../chat-panel.component.ts
- apps/web/.../exam-upload.component.ts
- apps/web/.../patient-detail.component.ts
- apps/web/.../patient-list.component.ts
- apps/worker/src/rag/indexer.js

**Recuperado em `585ac952` (2026-04-21, esta sessão):**
- FeedbackDialogComponent: preview de screenshot com área de drop, preview inline, validação 5MB, botão de remoção

**Recuperado em `1f33949c` (2026-04-21, esta sessão):**
- `publishSubjectUpserted` em patients.js (POST human, POST veterinary, PUT /:id)
- Subscriber pub/sub no worker (subject:upserted:*, billing:updated:*)
- `s.cpf_last4` no SELECT da listagem de pacientes

**NÃO aplicado (stash era mais antigo/pior que HEAD):**
- exams.js com filesystem /tmp em vez de S3 (regressão)
- api/Dockerfile sem ARG CACHEBUST (regressão)
- endpoint `/retry` em vez de `/reprocess` (bug)

### `fb1773d5` — "WIP: fix(patient-detail)"
Criado em: 2026-04-21 00:58
1 arquivo: patient-detail.component.ts (+6 linhas de WS subscription)
**Status:** Já incorporado nas correções desta sessão via fix/imaging-ws-report-bugs.

## Como verificar stashes no início de cada sessão

```bash
git stash list
git log --all --oneline | grep -i "wip\|stash"
```

Se encontrar stash não listado aqui, analisar com:
```bash
git show <commit> --stat
git diff HEAD <commit> -- <arquivo>
```

Antes de aplicar qualquer código do stash, verificar se o HEAD já tem versão mais recente do mesmo código.
