# Migração AWS → VPS Hostinger (BR)

Documento operacional pra migrar a stack do GenomaFlow de AWS (ECS Fargate + RDS + ElastiCache + S3 + ALB) pra uma VPS Hostinger no Brasil. Mantém **Chime SDK na AWS** pra vídeo consulta (arquitetura híbrida).

## Visão geral

```
┌──────────────────────────────────────────────────────────┐
│  VPS Hostinger BR (4 vCPU EPYC, 15GB RAM, 191GB SSD)     │
│  Ubuntu 24.04 LTS                                         │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Caddy (TLS Let's Encrypt + reverse proxy)           │ │
│  │   genomaflow.com.br → web (landing)                 │ │
│  │   app.* → web (Angular) + /api/* → api              │ │
│  │   s3.* → MinIO                                       │ │
│  └─────────────────────────────────────────────────────┘ │
│         ▲          ▲          ▲                           │
│    ┌────┴───┐  ┌───┴────┐ ┌──┴───┐                       │
│    │  api   │  │ worker │ │ web  │                       │
│    │ (3000) │  │        │ │ (80) │                       │
│    └─┬──┬───┘  └─┬──┬───┘ └──────┘                       │
│      │  │        │  │                                      │
│      ▼  ▼        ▼  ▼                                      │
│   ┌─────┐    ┌──────┐    ┌──────┐                         │
│   │ pg  │    │redis │    │minio │                         │
│   │ 15  │    │  7   │    │      │                         │
│   └─────┘    └──────┘    └──────┘                         │
└──────────────────────────────────────────────────────────┘
                       │
                       ▼ (HTTPS)
              ┌─────────────────┐
              │  AWS Chime SDK  │  ← apenas pra vídeo consulta
              │  (us-east-1)    │
              └─────────────────┘
```

## Pré-requisitos

- VPS Hostinger Ubuntu 24.04 LTS (root SSH ativo)
- Chave SSH ed25519 criada localmente (NUNCA usar senha em prod)
- DNS de `genomaflow.com.br` controlado (Route 53, Cloudflare ou Hostinger DNS)
- Conta AWS ativa só pra Chime (criar IAM user dedicado com policy mínima)
- AWS CLI local pra `pg_dump` do RDS e `aws s3 sync` pra MinIO

## Sequência de migração

Recomendação: rodar em **subdomínio staging primeiro** (`staging.genomaflow.com.br`) e só depois fazer cutover do `app.*`.

### Fase 1 — Bootstrap da VPS (~30 min)

```bash
# 1) Configurar SSH key (no Windows com OpenSSH habilitado)
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\genomaflow_vps -C "genomaflow-deploy" -N '""'
type $env:USERPROFILE\.ssh\genomaflow_vps.pub | ssh root@2.25.163.251 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && chmod 700 ~/.ssh"

# 2) Trocar senha root + desabilitar password auth
ssh -i $env:USERPROFILE\.ssh\genomaflow_vps root@2.25.163.251
passwd  # senha forte nova
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload sshd
exit
```

Reconectar agora SÓ funciona com `-i ~/.ssh/genomaflow_vps`. Confirmar antes de fechar a sessão atual.

### Fase 2 — Setup do sistema (~5 min)

```bash
# Na VPS:
cd /tmp
curl -fsSL https://raw.githubusercontent.com/rodrigonoma/genomaflow/feat/vps-migration/scripts/vps-setup.sh -o vps-setup.sh
bash vps-setup.sh
```

O script instala: swap 4GB, ufw, fail2ban, unattended-upgrades, Docker + Compose, cron de backup. **Idempotente** — pode rodar várias vezes.

### Fase 3 — Clone do repo + preencher .env (~10 min)

```bash
cd /opt/genomaflow
git clone https://github.com/rodrigonoma/genomaflow.git .
git checkout feat/vps-migration

cp .env.vps.template .env
nano .env  # preencher TODOS os XXX
```

**Origem dos segredos** (pegar do SSM/Secrets Manager AWS):

```bash
# Rodar localmente (Windows), com AWS_SHARED_CREDENTIALS_FILE setado
export AWS_DEFAULT_REGION=us-east-1
for KEY in jwt-secret anthropic-api-key openai-api-key stripe-secret-key \
           stripe-webhook-secret zapi-instance-id zapi-token zapi-client-token \
           trello-api-key trello-api-token trello-webhook-secret trello-board-id \
           trello-qa-list-id trello-ideias-list-id trello-roadmap-list-id \
           github-bot-token; do
  VAL=$(aws ssm get-parameter --name /genomaflow/prod/$KEY --with-decryption \
        --query Parameter.Value --output text 2>/dev/null)
  echo "$KEY=$VAL"
done

# RDS credentials
aws secretsmanager get-secret-value \
  --secret-id /genomaflow/prod/rds-credentials \
  --query SecretString --output text | jq

# SMTP password
aws secretsmanager get-secret-value \
  --secret-id /genomaflow/prod/smtp-password \
  --query SecretString --output text
```

Colar valores no `.env` da VPS via `nano /opt/genomaflow/.env`.

**Senhas a gerar do zero** (não migrar):
- `DB_PASSWORD` — usar `openssl rand -base64 32`
- `MINIO_ROOT_PASSWORD` — idem
- `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` — gerar via MinIO console depois do primeiro boot

**AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY**: criar IAM user novo na AWS Console com policy mínima (só Chime):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "chime:CreateMeeting", "chime:GetMeeting", "chime:DeleteMeeting",
      "chime:CreateAttendee", "chime:DeleteAttendee"
    ],
    "Resource": "*"
  }]
}
```

### Fase 4 — DNS apontar pra VPS (propagação ~5-60min)

DNS records (apontar pro IP da VPS, ex. `2.25.163.251`):

| Record | Tipo | Valor | Proxy CF? |
|---|---|---|---|
| `genomaflow.com.br` | A | IP da VPS | Sim (recomendado) |
| `www.genomaflow.com.br` | A | IP da VPS | Sim |
| `app.genomaflow.com.br` | A | IP da VPS | Sim |
| `api.genomaflow.com.br` | A | IP da VPS | Sim |
| `s3.genomaflow.com.br` | A | IP da VPS | **Não** (presigned URLs precisam de pass-through) |
| `minio-console.genomaflow.com.br` | A | IP da VPS | Sim |

Se usar Cloudflare como proxy:
- Modo SSL: **Full (strict)** — Caddy tem cert válido
- Always Use HTTPS: ON
- Min TLS Version: 1.2
- Brotli: ON

**Sair do Route 53**: depois de validar tudo, mover NS de `genomaflow.com.br` no registro.br pro Cloudflare (ou manter Route 53 com novos A records, à escolha).

### Fase 5 — Subir a stack (~5 min)

```bash
cd /opt/genomaflow

# Confirmar .env preenchido
grep -E "XXX|TBD" .env && echo "⚠️ FALTA preencher campos!" || echo "✅ .env ok"

# Build das imagens (na própria VPS — primeiro build leva ~10min)
docker compose -f docker-compose.prod.yml build

# Subir
docker compose -f docker-compose.prod.yml --env-file .env up -d

# Logs
docker compose -f docker-compose.prod.yml logs -f
```

Caddy vai pedir certs Let's Encrypt automaticamente assim que DNS estiver propagado.

### Fase 6 — Setup MinIO (uma vez só)

```bash
# Setup bucket + credential pro app (não usar root)
docker exec -it genomaflow-minio bash -c "
  mc alias set local http://localhost:9000 \$MINIO_ROOT_USER \$MINIO_ROOT_PASSWORD
  mc mb local/genomaflow-uploads --ignore-existing
  mc admin user add local genomaflow-app <ACCESS_KEY_NOVO> <SECRET_KEY_NOVO>
  mc admin policy attach local readwrite --user genomaflow-app
"

# Atualizar .env com as credentials novas:
nano /opt/genomaflow/.env  # setar S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY

# Restart api+worker pra picarem o novo .env
docker compose -f docker-compose.prod.yml restart api worker
```

### Fase 7 — Migração de dados (RDS → pg, S3 → MinIO)

**Local (Windows com Git Bash):**

```bash
export VPS_IP=2.25.163.251
export SSH_KEY=~/.ssh/genomaflow_vps
export AWS_SHARED_CREDENTIALS_FILE=/c/Projetos/Genomaflow/genomaflow/aws/credentials
export AWS_DEFAULT_REGION=us-east-1

bash scripts/migrate-data.sh
```

O script:
1. `pg_dump` do RDS → `/tmp/genomaflow-dump-*.sql`
2. `scp` pra VPS
3. `pg_restore` dentro do container postgres
4. `mc mirror` AWS S3 → MinIO local

Após terminar, validar:
```bash
# Na VPS
docker exec genomaflow-postgres psql -U genomaflow -d genomaflow -c "SELECT COUNT(*) FROM tenants;"
docker exec genomaflow-postgres psql -U genomaflow -d genomaflow -c "SELECT COUNT(*) FROM subjects;"
docker exec genomaflow-postgres psql -U genomaflow -d genomaflow -c "SELECT COUNT(*) FROM exams;"

# Smoke test do app
curl -fsS https://app.genomaflow.com.br/api/auth/me  # 401 esperado
curl -fsS https://app.genomaflow.com.br/             # 200 (Angular index)
curl -fsS https://genomaflow.com.br/health           # 200 (landing)
```

### Fase 8 — Cutover (decisão crítica)

Antes do cutover, deixar staging rodando em paralelo por **24-48h** com tráfego sintético (curl periódico, testar feature crítica). Quando validado:

1. **Reduzir TTL DNS** dos records `app.*`, `api.*` pra 60s (vai propagar em ~1min)
2. **Atualizar A record** `app.genomaflow.com.br` pra IP da VPS
3. **Reconfigurar webhooks externos**:
   - Stripe Dashboard → Developers → Webhooks → editar endpoint → trocar host
   - Z-API painel → trocar `https://app.genomaflow.com.br/api/notifications/whatsapp/inbound`
   - Trello → webhook não usa URL hardcoded, OK
4. **Validar SES desabilitado**: mailer detecta `SMTP_HOST` setado e usa Zoho. Conferir log `apps/api/src/mailer/index.js`
5. **Manter AWS RDS + S3 read-only por 72h** como fallback caso precise voltar

### Fase 9 — Desligar AWS (após 72h estável)

```bash
# Local, com AWS_SHARED_CREDENTIALS_FILE setado
export AWS_DEFAULT_REGION=us-east-1

# Reduzir ECS desired=0 nos services
aws ecs update-service --cluster genomaflow --service genomaflow-api --desired-count 0
aws ecs update-service --cluster genomaflow --service genomaflow-worker --desired-count 0
aws ecs update-service --cluster genomaflow --service genomaflow-web --desired-count 0

# Parar RDS (não deleta — fica stopped 7 dias)
aws rds stop-db-instance --db-instance-identifier genomaflow-rds-postgres9dc8bb04-xgwkcttjv3sb

# Snapshot final pré-delete
aws rds create-db-snapshot --db-instance-identifier genomaflow-rds-postgres9dc8bb04-xgwkcttjv3sb \
  --db-snapshot-identifier pre-vps-migration-final-$(date +%Y%m%d)

# S3 mantém em modo read-only por 30d como backup
# Depois: aws s3 rb s3://genomaflow-uploads-prod --force
```

**Não deletar:**
- IAM user pra Chime (continua usando)
- ECR repos (caso queira voltar emergencial — manter latest images por 90d)
- Route 53 zone se ainda em uso

**Pode deletar imediatamente:**
- ALB (custo $22/mês)
- ElastiCache Redis (custo $25/mês)
- ECS cluster genomaflow (sem tasks)
- VPC + subnets do genomaflow

## Rollback plan

Se algo der muito errado nas primeiras 72h:

1. **Cutover DNS reverso**: A record `app.*` volta pro ALB AWS
2. **Reativar ECS services**: `aws ecs update-service --desired-count 1` em api/worker/web
3. **Iniciar RDS**: `aws rds start-db-instance`
4. **Wait stable**: ~5-10min e app volta

Como S3 e RDS AWS foram mantidos read-only, todos os dados pré-migração estão lá. Dados criados na VPS durante a janela do cutover precisam ser **manualmente migrados de volta** via pg_dump reverso.

## Custo estimado pós-migração

| Item | Mensal |
|---|---:|
| VPS Hostinger KVM 4 | R$ 129 (~USD 25) |
| AWS Chime (vídeo) | USD 0-1 |
| Backup externo Backblaze B2 (opcional) | USD 1-2 |
| Cloudflare DNS + Proxy | USD 0 (free tier) |
| **Total** | **~USD 26-28/mês** |

Comparado com AWS atual (~USD 135/mês pós-Onda 2): **economia de ~USD 100/mês = ~BRL 500/mês**.

## Riscos conhecidos e mitigações

| Risco | Mitigação |
|---|---|
| VPS down = app down (sem HA) | Snapshot diário Hostinger + backup pg_dump em B2; restore em ~15min |
| Disco enche (~191GB) | Monitorar via `df -h`; mover backups antigos pra B2; alertar em 80% |
| Let's Encrypt rate limit | Caddy renova ~30 dias antes; cache em volume caddy_data sobrevive a restart |
| Zoho SMTP rate limit (150/dia free) | Upgrade Mail Lite ($1/mês = 500/dia) se passar do free |
| Falha do storage MinIO | Snapshot Hostinger + backup pra B2; pior caso: perde uploads não snapshotados |
| Bandwidth Hostinger (16TB/mês) | Cloudflare proxy reduz egress; monitorar via Hostinger panel |
| LGPD: dados fisicamente no BR? | Confirmar via painel Hostinger > Detalhes do servidor (deve ser BR) |

## Manutenção contínua

- **Updates de OS**: `unattended-upgrades` faz automático (não reinicia kernel — fazer manual mensal)
- **Backup verificação**: 1x/mês validar restore de backup
- **Logs**: `docker compose logs -f` em prod ou via `journalctl -u docker`
- **Cert renewal**: Caddy automático — só conferir email do admin de tempo em tempo
- **Snapshot Hostinger**: configurar no painel pra rodar diário

## Onde olhar quando algo dá errado

| Sintoma | Onde investigar |
|---|---|
| 502 no app.genomaflow.com.br | `docker compose logs caddy api` na VPS |
| Upload de exame falha | `docker compose logs api minio` |
| Email não envia | `docker compose logs api | grep mailer` |
| WebSocket cai | Caddy idle_timeout, ou Redis pub/sub |
| Vídeo consulta não conecta | AWS Chime — verificar `aws chime-sdk-meetings list-meetings` |
| DB lento | `docker exec postgres pg_stat_statements` ou `pg_top` |
