---
name: Healthcheck que não pode passar é pior que nenhum
description: O healthcheck da API ficou 6 dias vermelho com a aplicação funcionando; padrão liveness/readiness e as duas armadilhas que causaram isso
type: feedback
---

# Healthcheck tem que poder passar

**Incidente 24/08/2026.** `genomaflow-api` marcado `unhealthy` há 6 dias, com
`FailingStreak` de **17.731** — e a API funcionando normalmente o tempo todo.

```yaml
test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/auth/me"]
```

Dois defeitos no mesmo comando, cada um suficiente sozinho:

1. **`localhost` resolve `::1` (IPv6) primeiro** e a aplicação escuta em IPv4 →
   `Connection refused`. Por `127.0.0.1` responde normalmente.
2. **`/api/auth/me` exige autenticação** → 401 sem token, e o `wget` sai com
   erro.

O `web` tinha o mesmo problema de IPv6 — a rota `/health` do nginx existe e
responde `ok`, mas o healthcheck usava `localhost`.

**Why:** um alarme sempre vermelho é pior que alarme nenhum. Ninguém mais
olha, e quando a pane de verdade chega ela não se distingue do ruído. Seis dias
de sinal falso são seis dias sem monitoramento, com a aparência de ter.

**How to apply:**

- **Sempre `127.0.0.1` em healthcheck de contêiner**, nunca `localhost`. A
  aplicação Node escuta `0.0.0.0` (IPv4); `localhost` tenta `::1` primeiro.
- **Nunca apontar healthcheck para rota autenticada.** Se responde 401 sem
  token, não serve — por definição não pode passar.
- **Separar liveness de readiness:**

  | | O que responde | Quem usa |
  |---|---|---|
  | `GET /api/health` | 200 sempre que o processo responde. **Não toca em banco nem Redis.** | healthcheck do Docker |
  | `GET /api/health/ready` | 200 só com pg **e** redis vivos; 503 caso contrário, timeout 2s por check | monitoramento |

  Liveness não pode depender de banco: se o Postgres cai, reiniciar a API não
  conserta nada — só troca uma pane por duas.

- **Rota de health é pública na borda** (o Caddy roteia `/api/*`): a resposta
  não pode carregar versão, hostname, env nem mensagem de erro. Só `status` e
  os booleanos dos checks. O detalhe da falha vai para o log interno.
- **Timeout por check.** Um banco pendurado não pode segurar a resposta —
  "não respondeu a tempo" é exatamente o que se quer saber. E limpar o timer
  nos **dois** caminhos (`.finally`), senão sobra handle aberto.
- **Depois de mudar healthcheck, conferir de verdade:**
  `docker inspect -f '{{.State.Health.Status}}' <container>` — e o
  `FailingStreak`, que denuncia alarme cronicamente ignorado.

Implementação: `apps/api/src/routes/health.js`, testes em
`apps/api/tests/routes/health.test.js`.

Ver também: [[project_retomada_2026_08]], [[feedback_monitor_deploys]].
