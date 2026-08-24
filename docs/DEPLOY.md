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
| AWS que sobrou | só o **Chime SDK**, para vídeo consulta |

### ⚠️ Armadilha nº 1 — o CI ainda aponta para a AWS

`.github/workflows/deploy.yml` dispara em **push para `main`** e faz build →
ECR → ECS. **Esse caminho não existe mais.** Um push para `main` hoje não leva
nada para produção: no melhor caso falha, no pior gasta tempo e dá a impressão
de que subiu.

**Enquanto o workflow não for reescrito para a VPS, o deploy é manual** (abaixo).

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

## O procedimento (manual, hoje)

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

### ⚠️ Estado em 23/08/2026: o domínio não resolve

`genomaflow.com.br` e `app.genomaflow.com.br` **não têm DNS nenhum** — nem
registro `A`, nem `NS`. A stack está de pé na VPS há dias, mas **ninguém
consegue chegar nela pelo nome**.

O Caddy só emite certificado quando o DNS aponta para a VPS, então enquanto isso
não for resolvido não há HTTPS. A fase 4 de `docs/vps-migration.md` lista os
registros necessários.

---

## ⚠️ O healthcheck da API está quebrado (e mascara pane de verdade)

Constatado em 23/08/2026: `genomaflow-api` aparece como **unhealthy** há 6 dias,
com `FailingStreak` de **17.731** — mas **a API está funcionando**.

```yaml
# docker-compose.prod.yml (como está hoje)
test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/auth/me"]
```

São **dois** defeitos no mesmo comando, e cada um sozinho já reprovaria:

1. **`localhost` resolve para `::1` primeiro** (IPv6) e a aplicação escuta em
   IPv4. Resultado: `Connection refused`. Por `127.0.0.1` a API responde
   normalmente.
2. **`/api/auth/me` exige autenticação** e devolve **401** sem token. Mesmo pelo
   IPv4 correto, o `wget` sairia com erro.

Ou seja: **este healthcheck nunca poderia passar.** E um alarme que está sempre
vermelho é pior que alarme nenhum — ninguém mais olha, e a pane real chega sem
avisar.

**Correção mínima** (não exige mexer no código da aplicação):

```yaml
healthcheck:
  # `nc -z` prova que o processo está aceitando conexão. Não prova que a
  # aplicação está correta, mas é honesto — e infinitamente melhor que um
  # teste que não tem como passar. Use 127.0.0.1: `localhost` tenta IPv6.
  test: ["CMD-SHELL", "nc -z 127.0.0.1 3000"]
  interval: 30s
  timeout: 5s
  retries: 3
```

**Correção certa**, quando houver oportunidade: criar um endpoint `/health` que
responda **200 sem autenticação** e apontar o healthcheck para ele por
`127.0.0.1`. Hoje esse endpoint **não existe** na API.

⚠️ O mesmo cuidado vale para o `web`, que usa
`http://localhost/health` — vale conferir se essa rota existe de fato.

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
