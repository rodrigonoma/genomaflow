---
name: Redact secrets em mensagens user-facing
description: Erros de subprocess (git push, curl, openssl) frequentemente incluem URLs com tokens. Sempre redact antes de mandar pra UI (Trello card, Slack, e-mail). Incidente 2026-05-14: PAT vazou em comment Trello.
type: feedback
---

# Sempre redact secrets em error messages user-facing

**Regra:** qualquer string que vai pra UI (comment Trello, mensagem
Slack, e-mail, audit log público, webhook response) **DEVE** passar
por `_redactSecrets()` antes.

```js
function redactSecrets(str) {
  if (!str) return str;
  return String(str)
    // x-access-token URLs: https://x-access-token:TOKEN@github.com/...
    .replace(/x-access-token:[^@\s]+@/g, 'x-access-token:[REDACTED]@')
    // GitHub fine-grained PATs (github_pat_...) e classic (ghp_...)
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[REDACTED_PAT]')
    .replace(/\bghp_[A-Za-z0-9]+/g, '[REDACTED_PAT]')
    // Anthropic API keys
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED_KEY]')
    // OpenAI keys
    .replace(/sk-[A-Za-z0-9]+/g, '[REDACTED_KEY]')
    // Trello tokens (ATTA prefix)
    .replace(/ATTA[A-Za-z0-9]+/g, '[REDACTED_TRELLO_TOKEN]');
}
```

**Why:** subprocesses muitas vezes incluem o comando completo (com
auth credentials inline) no erro. Exemplos:
- `git push https://x-access-token:<PAT>@github.com/.../HEAD:main exit 128: ...`
- `curl -H "Authorization: Bearer <KEY>" ...`
- `psql postgresql://user:pass@host/db ...`

Quando o código faz `reject(new Error(`cmd ${args.join(' ')}: ${stderr}`))`,
o token vaza pro err.message. Sem saneamento, esse string vai pro Trello
comment, Slack, log público — visível pra qualquer um com acesso ao
canal.

**Incidente real (2026-05-14, Trello QA Agent):**
Worker `commitAndPushToMain` falhou no push. err.message tinha:
```
git push https://x-access-token:github_pat_11ABU4OAI02...8WLaQCqFBIYXZ3CEmJm974R4@github.com/...
```
Esse erro foi comentado no card Trello em texto puro. PAT exposto.

**Onde aplicar (Genomaflow):**
- `apps/worker/src/lib/github-pr.js` — `_redactSecrets` no reject() das funções de push
- `apps/worker/src/processors/trello-qa.js` — `_redactSecrets(err.message)` nos 3 catch que comentam no Trello
- Qualquer rota da API que retorna error string: pensar se tem secrets

**Patterns conhecidos a redactar:**

| Tipo | Regex |
|---|---|
| GitHub fine-grained PAT | `github_pat_[A-Za-z0-9_]+` |
| GitHub classic PAT | `\bghp_[A-Za-z0-9]+` |
| GitHub OAuth app token | `\bgho_[A-Za-z0-9]+` |
| GitHub user-to-server token | `\bghu_[A-Za-z0-9]+` |
| GitHub server-to-server | `\bghs_[A-Za-z0-9]+` |
| Anthropic API key | `sk-ant-[A-Za-z0-9_-]+` |
| OpenAI API key | `sk-[A-Za-z0-9]+` |
| Trello token | `ATTA[A-Za-z0-9]+` |
| Stripe secret | `sk_live_[A-Za-z0-9]+` |
| AWS access key | `AKIA[A-Z0-9]{16}` |
| URL com basic auth | `https?://[^:]+:[^@\s]+@` |
| URL com x-access-token | `x-access-token:[^@\s]+@` |

## Resposta ao incidente

Quando um secret vaza:
1. **Revogar imediatamente** no provedor (GitHub, Anthropic, etc.)
2. Apagar o comment/mensagem que tem o secret (Trello, Slack, etc.)
3. Gerar novo secret, atualizar SSM
4. Force-new-deployment do serviço afetado pra picar o secret novo
5. Adicionar regex de redaction se ainda não estava coberto

## Não regredir

❌ Não comentar `err.message` direto no Trello/Slack/UI sem redact
❌ Não logar `err.message` em CloudWatch de error tem secrets (CloudWatch tem retenção longa)
❌ Não retornar `error.message` raw em response da API

✅ Sempre `redactSecrets(err.message)` antes de qualquer surface user-facing
✅ Sempre incluir teste unit do redactor com os patterns esperados
✅ Sempre revogar + rotacionar quando suspeitar de vazamento (mesmo se "só você acessa")
