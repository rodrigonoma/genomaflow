---
name: Nome de serviço colide entre redes Docker na VPS compartilhada
description: O Caddy serve três produtos e está em duas redes; usar `api`/`web`/`minio` como upstream fez o GenomaFlow entregar tráfego para os contêineres do Auditty
type: feedback
---

# Upstream de proxy: nome de contêiner, nunca nome de serviço

**Incidente 24/08/2026.** Assim que o DNS voltou, os quatro domínios do
GenomaFlow deram **502** e `s3.genomaflow.com.br` entregou o **MinIO do
Auditty**.

O contêiner do Caddy está em **duas** redes (`genomaflow_genomaflow` e
`auditty`), porque serve os domínios dos três produtos da VPS. Cada compose
registra aliases pelo nome do serviço, e o DNS interno do Docker resolvia em
favor do Auditty:

```
api    -> 172.16.1.6  auditty-api      (esperado: 172.18.0.8  genomaflow-api)
web    -> 172.16.1.7  auditty-web      (esperado: 172.18.0.5  genomaflow-web)
minio  -> 172.16.1.2  auditty-minio    (esperado: 172.18.0.6  genomaflow-minio)
```

**Why:** nome de serviço só é único **dentro de um compose**. Num contêiner
ligado a mais de uma rede ele deixa de ser endereçável sem ambiguidade, e a
ordem de resolução não é algo em que se deva confiar. Nome de contêiner é único
no host inteiro.

O detalhe que denuncia: os blocos do Auditty e do Sales **no mesmo arquivo** já
usavam `auditty-api:3001`, `sales-web:3100`. Só os do GenomaFlow estavam
ambíguos — e só o GenomaFlow quebrou.

**How to apply:**

- Em VPS compartilhada, **todo `reverse_proxy` usa nome de contêiner**
  (`genomaflow-api:3000`), nunca o nome curto do serviço.
- Vale para qualquer contêiner ligado a duas redes — não é específico do Caddy.
- Para conferir o que um proxy realmente enxerga:
  ```bash
  docker exec <proxy> getent hosts api
  docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}({{$v.IPAddress}}) aliases={{$v.Aliases}} {{end}}' <container>
  ```

## Duas armadilhas de operação que apareceram junto

**1. `sed -i` não chega no contêiner.** O bind mount de um **arquivo** liga o
inode. `sed -i` grava um temporário e renomeia por cima → inode novo → o
contêiner continua lendo o antigo. O `caddy reload` retornava **exit 0**
aplicando a config velha. Conferir sempre pelo lado de dentro:

```bash
docker exec <container> grep <padrao> /caminho/no/container
docker exec <container> wget -qO- http://127.0.0.1:2019/config/ | grep -o '"dial":"[^"]*"'
```

Para aplicar sem reiniciar: `docker cp` do arquivo para `/tmp` no contêiner e
`caddy reload --config /tmp/<arquivo>`. Um restart também resolve — o mount
re-resolve no start — mas derruba os outros produtos por alguns segundos.

**2. `$?` depois de um pipe é do último comando do pipe.**
`docker exec ... | tail -3; echo $?` mostra o exit do `tail`, não do comando.
Foi assim que um `reload` falho pareceu bem-sucedido. Redirecionar para arquivo
e ler `$?` antes de qualquer pipe.

**3. Teste de conectividade com `wget` mente.** `wget` sai com erro em 404 e
403 também — um MinIO saudável foi reprovado por isso. Ler a mensagem
(`connected` / `unable to connect` / `refused`), não o exit code.

Ver também: [[project_retomada_2026_08]], `../DEPLOY.md` (armadilha nº 3 — a
VPS é compartilhada).
