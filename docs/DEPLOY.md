# Deploy — GenomaFlow

> Leia antes de subir qualquer coisa. Este documento existe porque a produção
> **mudou de lugar** em agosto/2026 e boa parte do que está no repositório ainda
> descreve o mundo antigo.

---

## ⚠️ A produção NÃO está mais na AWS

A stack migrou de **AWS (ECS Fargate + RDS + ElastiCache + S3 + ALB)** para uma
**VPS Hostinger no Brasil**, e a AWS foi desligada depois
(`docs/vps-migration.md`, commits `1cfe4ec` → `b4be79e`).

| | Onde é hoje |
|---|---|
| Servidor | **`2.25.163.251`** (Hostinger, Ubuntu 24.04) |
| Diretório | `/opt/genomaflow` |
| Orquestração | `docker compose -f docker-compose.prod.yml` |
| Proxy + TLS | **Caddy** (Let's Encrypt automático) |
| Contêineres | `genomaflow-{caddy,web,api,worker,postgres,redis,minio}` |
| Branch em produção | **`feat/vps-migration`** (não é a `main`) |
| AWS que sobrou | **nada funcional** — o Chime SDK era a última dependência e sua credencial foi apagada no cleanup (vídeo consulta desligada) |

### ~~Armadilha nº 1 — o CI aponta para a AWS~~ — resolvida em 24/08/2026

`.github/workflows/deploy.yml` foi reescrito: os três jobs de ECR/ECS viraram
um job **`deploy-vps`** por SSH. Os gates de teste e o `concurrency` continuam
como estavam — só o destino da entrega mudou.

⚠️ **Ainda faltam dois passos para o pipeline funcionar de ponta a ponta:**

1. **Cadastrar os segredos** em Settings → Secrets and variables → Actions:

   | Segredo | Valor |
   |---|---|
   | `VPS_SSH_KEY` | conteúdo de `~/.ssh/genomaflow_vps` (chave **privada**) |
   | `VPS_KNOWN_HOSTS` | saída de `ssh-keyscan 2.25.163.251` |
   | `VPS_HOST` | `2.25.163.251` |

2. **Alinhar a branch da VPS com a `main`** (ver armadilha nº 2).

O job aborta com mensagem explícita se faltar qualquer um — não entrega pela
metade nem reporta sucesso falso.

**O que o deploy remoto faz, em ordem:** aborta se a VPS estiver numa branch
diferente da entregue → `git merge --ff-only` (**nunca** `reset --hard`: o
Caddyfile da VPS está alterado na mão e serve três produtos) → build só do que
mudou, com `--build-arg CACHEBUST=<sha>` → migrations na imagem recém
construída **antes** de trocar os contêineres → `up -d` → espera cada
contêiner ficar `healthy`, com log e falha se não ficar em 5 min.

### ⚠️ Armadilha nº 2 — produção roda de uma branch de feature

O clone em `/opt/genomaflow` está em **`feat/vps-migration`**, não em `main`.
Quem der `git pull` esperando `main` não traz nada. E há **6 arquivos alterados
localmente** na VPS — confira antes de puxar, para não perder ajuste feito na
mão durante a migração:

```bash
cd /opt/genomaflow && git status --porcelain
```

### ⚠️ Armadilha nº 3 — a VPS é COMPARTILHADA

A mesma máquina hospeda **Auditty** e **Auditty-Sales** (`/opt/auditty`,
`/opt/auditty-sales`), com os domínios deles no **mesmo Caddyfile**. São 18
contêineres no total.

Mexer no `Caddyfile` mexe em produtos que não são o GenomaFlow. Há backups
datados ao lado (`Caddyfile.bak.*`) — faça um antes de editar.

---

## Onde estão as credenciais

⚠️ **Nenhum segredo está no git, e não deve estar.** Aqui está **onde**
encontrar, nunca o valor.

| O quê | Onde |
|---|---|
| Chave SSH da VPS | `%USERPROFILE%\.ssh\genomaflow_vps` (Windows) |
| Segredos da aplicação | `/opt/genomaflow/.env` **na VPS** |
| Credenciais AWS (só Chime) | `C:\Projetos\Genomaflow\genomaflow\aws\credentials` — ver `docs/claude-memory/project_aws_credentials_location.md` |

```bash
ssh -i ~/.ssh/genomaflow_vps root@2.25.163.251
```

⚠️ **No WSL, a chave copiada do Windows vem com permissão 0777 e o SSH a
ignora** ("UNPROTECTED PRIVATE KEY FILE"). Copie e ajuste antes:

```bash
cp /mnt/c/Users/<voce>/.ssh/genomaflow_vps /tmp/gf_key && chmod 600 /tmp/gf_key
ssh -i /tmp/gf_key root@2.25.163.251
```

⚠️ Para AWS (Chime), as credenciais **não estão em `~/.aws/`** — é preciso
apontar `AWS_SHARED_CREDENTIALS_FILE` para o arquivo dentro do projeto.

---

## O procedimento manual (fallback)

Desde 24/08/2026 o caminho normal é o CI (job `deploy-vps`). Este procedimento
continua valendo para quando o CI estiver indisponível ou para intervenção na
mão — e é literalmente o que o job faz remotamente.

```bash
ssh -i ~/.ssh/genomaflow_vps root@2.25.163.251
cd /opt/genomaflow

# 1. Ver o que está alterado na mão antes de puxar
git status --porcelain

# 2. Trazer o código (atenção à branch)
git pull origin feat/vps-migration

# 3. Construir só o que mudou
docker compose -f docker-compose.prod.yml build api worker    # ou web

# 4. Subir
docker compose -f docker-compose.prod.yml --env-file .env up -d api worker

# 5. Acompanhar
docker compose -f docker-compose.prod.yml logs -f --tail 50 api
```

⚠️ **O primeiro build leva ~10 min** (é na própria VPS, não há registry).

⚠️ **Migração de banco** roda por dentro do contêiner, com os arquivos numerados
de `src/db/migrations/` — ver
`docs/claude-memory/feedback_db_migrations.md`. Dev e prod têm de ficar
**idênticos**; nunca alterar schema fora de um arquivo de migração numerado.

---

## Verificar — sempre DE FORA

```bash
for u in https://genomaflow.com.br https://app.genomaflow.com.br; do
  printf '%-36s ' "$u"; curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 "$u"
done
```

### ⚠️ O domínio não resolve — e a causa foi encontrada em 24/08/2026

`genomaflow.com.br` e `app.genomaflow.com.br` respondem **SERVFAIL** em
qualquer resolver. A stack está de pé na VPS, mas **ninguém chega nela pelo
nome**.

**Não é falta de registro `A`. É a delegação apontando para um lugar que
deixou de existir.** O registro.br continua delegando o domínio para quatro
nameservers do **Route 53**:

```
ns-1307.awsdns-35.org   ns-1830.awsdns-36.co.uk
ns-392.awsdns-49.com    ns-684.awsdns-21.net
```

A hosted zone foi apagada no cleanup da AWS, então esses servidores hoje
respondem **`REFUSED`** para o domínio — e RDAP do registro.br confirma:

```
delegation check ....... 2026-08-21  status: "ns query refused"
last correct delegation  2026-07-13
```

Ou seja: **quebrado desde ~13/07/2026**. O cleanup da AWS derrubou o DNS junto
e ninguém percebeu, porque o produto continuou de pé — só inalcançável.

Para verificar você mesmo:

```bash
curl -s https://rdap.registro.br/domain/genomaflow.com.br | grep -o '"status":\[[^]]*\]'
nslookup -type=NS genomaflow.com.br a.dns.br     # o que o TLD .br delega
```

**⏰ Isto tem prazo.** O certificado do Caddy foi emitido em 02/06 e vale até
**31/08/2026**. O Caddy só renova depois que o DNS apontar para a VPS —
passando dessa data, o erro deixa de ser "site não encontrado" e vira "site
inseguro", que é pior.

**A correção** (decidido em 24/08: hospedar a zona na Hostinger) — criar estes
seis registros, todos para `2.25.163.251`, e trocar os nameservers no
registro.br para os da Hostinger:

| Nome | Tipo | Valor |
|---|---|---|
| `@` | A | `2.25.163.251` |
| `www` | A | `2.25.163.251` |
| `app` | A | `2.25.163.251` |
| `api` | A | `2.25.163.251` |
| `s3` | A | `2.25.163.251` |
| `minio-console` | A | `2.25.163.251` |

São exatamente os domínios que o Caddy da VPS serve — nenhum a mais, nenhum a
menos.

⚠️ O editor de DNS da Hostinger só funciona depois que o domínio aponta para
os nameservers dela: crie a zona no hPanel **antes** de trocar o NS, para não
ficar nenhum minuto sem resposta.

⚠️ Se houver e-mail entrante em `@genomaflow.com.br`, o registro `MX` também
estava no Route 53 e foi embora — precisa ser recriado na zona nova. O e-mail
**transacional** (verificação, reset de senha, NPS) sai por SMTP do Zoho e não
depende de MX aqui.

---

## ~~O healthcheck da API está quebrado~~ — corrigido em 24/08/2026

Ficou 6 dias marcando `unhealthy` com `FailingStreak` de **17.731** enquanto a
API funcionava normalmente. O comando tinha **dois** defeitos, e cada um
sozinho já reprovaria:

1. **`localhost` resolve para `::1` primeiro** (IPv6) e a aplicação escuta em
   IPv4 → `Connection refused`.
2. **`/api/auth/me` exige autenticação** e devolve 401 sem token.

Ou seja: nunca poderia passar. E um alarme sempre vermelho é pior que alarme
nenhum — ninguém mais olha, e a pane real chega sem avisar. O `web` tinha o
mesmo problema de IPv6 (a rota `/health` do nginx existe e responde `ok`).

A API agora tem duas rotas públicas (`apps/api/src/routes/health.js`):

| Rota | Para quê |
|---|---|
| `GET /api/health` | **liveness** — 200 sempre que o processo responde. **Não** toca em banco nem Redis de propósito: reiniciar a API não conserta Postgres fora do ar, só troca uma pane por duas. É esta que o Docker usa. |
| `GET /api/health/ready` | **readiness** — 200 só com pg **e** redis vivos, 503 caso contrário, com timeout de 2s por check. Para monitoramento. |

São rotas públicas na borda: a resposta não carrega versão, hostname, env nem
mensagem de erro — só `status` e os booleanos dos checks. Há teste cobrindo
exatamente isso.

⚠️ **A correção só chega à produção no próximo deploy** — os contêineres que
estão rodando ainda têm o healthcheck antigo.

---

## Lições que já custaram horas

Estão em `docs/claude-memory/` e continuam valendo, mesmo com a mudança de
infraestrutura. As que mais aparecem:

| Arquivo | O que evita |
|---|---|
| `feedback_ecs_s3_deploy.md` | verificar o que está REALMENTE rodando antes de debugar; `force-new-deployment` não troca imagem; `ARG CACHEBUST` nos Dockerfiles |
| `feedback_ci_concurrency.md` | workflow de deploy sem `concurrency.group` acumulou **20 runs simultâneos por 10h** e nenhum chegou em produção |
| `feedback_db_migrations.md` | schema só muda por arquivo de migração numerado; dev e prod idênticos |
| `feedback_code_editing_rules.md` | nada de afirmar sem verificar; conferir stash no início da sessão |

⚠️ **Cache de camada do Docker pode reutilizar código antigo em silêncio.** Os
Dockerfiles têm `ARG CACHEBUST` antes do `COPY src` justamente por isso — não
remova. Se um deploy "não pegou", suspeite disso antes de suspeitar do código.

---

## Integração com a plataforma FazGo

O GenomaFlow é prospectado pela **FazGo** (`app.fazgo.com.br`), que roda em
**outra VPS** (`72.60.63.64`). Não há acoplamento de deploy: subir um não afeta o
outro.

O que existe é **dependência em tempo de execução** — a FazGo vai chamar um
endpoint daqui para criar a conta de teste de 15 dias. Esse endpoint ainda não
existe; as decisões que precedem o código estão em
`docs/claude-memory/project_prospeccao_fazgo.md` e na spec
`docs/superpowers/specs/2026-08-23-provisionamento-trial-plataforma-design.md`.

Se ele quebrar depois de pronto, o prospect **não** recebe link quebrado: a
plataforma segura, dispara alarme e passa a conversa para um humano.
