---
name: Deploy verde que não entregou nada
description: Script remoto que chega por stdin pode ser engolido no meio por qualquer comando que leia stdin — o job sai 0 sem ter deployado; a defesa é uma sentinela de fim
type: feedback
---

# Um deploy que passa não é prova de que deployou

**Incidente 24/08/2026.** A primeira entrega pelo pipeline da VPS terminou
**verde** sem ter deployado. O log do job para logo depois de
`Migrations complete.` e nunca executa `up -d`. Em produção, a rota nova
continuava respondendo **404**.

## A mecânica

O script remoto chega no host pela **stdin**:

```bash
ssh host "bash -s -- $ARGS" <<'REMOTE'
...
REMOTE
```

O bash lê o corpo do script **de stdin, conforme executa**. Qualquer comando no
meio que leia stdin consome o resto do script. Aqui foi
`docker compose run --rm api node src/db/migrate.js` sem `-T`: ele anexa a
stdin, engole o restante, o bash chega ao fim do que sobrou e sai com o status
do último comando executado — **0**.

O mesmo vale para `ssh` aninhado, `docker exec` sem `-T`, `mysql`, `cat`,
`read`, e qualquer coisa interativa.

**Why:** é a pior falha possível num pipeline, porque o sinal está **invertido**.
Um deploy vermelho todo mundo investiga; um verde ninguém confere. O intervalo
entre "achamos que subiu" e "descobrimos que não" é onde moram os incidentes
caros.

## How to apply

**1. A causa — `< /dev/null` em todo comando do script remoto**, e `-T` nos
`docker compose run` / `docker exec`:

```bash
$COMPOSE run --rm -T api node src/db/migrate.js < /dev/null
$COMPOSE build ... < /dev/null
$COMPOSE up -d $SERVICES < /dev/null
```

**2. A defesa que não depende de lembrar da regra 1 — sentinela de fim.**
O script remoto termina imprimindo um marcador, e o job confere que veio:

```bash
# última linha do script remoto
echo "__DEPLOY_CHEGOU_AO_FIM__"
REMOTE
# ...
if ! grep -q "__DEPLOY_CHEGOU_AO_FIM__" /tmp/deploy.log; then
  echo "❌ O script remoto não chegou ao fim — saída truncada."
  exit 1
fi
```

⚠️ **Todo fim legítimo do script precisa imprimir a sentinela** — inclusive os
`exit 0` antecipados ("nada a construir"). Senão a verificação reprova deploy
correto. E **nenhum caminho de falha pode imprimi-la**.

⚠️ `set -o pipefail` junto: sem ele o `| tee` mascara a falha do próprio `ssh`.

**3. Verificar do lado de fora, sempre.** O que provou o problema não foi o log
do CI — foi `curl` na rota nova respondendo 404 com o job verde. Depois de todo
deploy, exercitar de fora algo que **só existe na versão nova**.

## O padrão maior

Isto é irmão de duas armadilhas já registradas aqui:

- `$?` depois de pipe é do último comando do pipe, não do que interessa
  ([[feedback_docker_alias_colisao_redes]])
- healthcheck apontando para rota autenticada nunca passa
  ([[feedback_healthcheck_honesto]])

Os três são a mesma família: **um sinal que parece informativo e não é**. Ao
construir automação, a pergunta não é "isso passa quando dá certo?", e sim
"**isso falha quando dá errado?**".

Ver também: [[project_retomada_2026_08]], `../DEPLOY.md`.
