#!/usr/bin/env bash
# migrate-data.sh — Migra DB (RDS) e Storage (S3) da AWS pra VPS.
#
# Roda LOCALMENTE (no Windows via Git Bash ou WSL). Precisa de:
#   - AWS CLI configurada (AWS_SHARED_CREDENTIALS_FILE)
#   - SSH key pra VPS em $SSH_KEY (default ~/.ssh/genomaflow_vps)
#   - VPS_IP setado (IP da VPS Hostinger)
#   - Stack docker-compose já rodando na VPS (postgres + minio acessíveis)
#
# Uso:
#   export VPS_IP=2.25.163.251
#   export SSH_KEY=~/.ssh/genomaflow_vps
#   export AWS_SHARED_CREDENTIALS_FILE=/c/Projetos/Genomaflow/genomaflow/aws/credentials
#   export AWS_DEFAULT_REGION=us-east-1
#   bash scripts/migrate-data.sh

set -euo pipefail

VPS_IP="${VPS_IP:?VPS_IP env var required}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/genomaflow_vps}"
AWS_RDS_INSTANCE="${AWS_RDS_INSTANCE:-genomaflow-rds-postgres9dc8bb04-xgwkcttjv3sb}"
AWS_S3_BUCKET="${AWS_S3_BUCKET:-genomaflow-uploads-prod}"
DUMP_FILE="/tmp/genomaflow-dump-$(date +%Y%m%d-%H%M%S).sql"

log() { echo -e "\n\e[1;32m[$(date +%H:%M:%S)] $*\e[0m"; }
err() { echo -e "\n\e[1;31m[$(date +%H:%M:%S)] ERRO: $*\e[0m" >&2; }

# ─── 1. Validações ─────────────────────────────────────────────────────────
log "Validando pré-requisitos..."
command -v aws &>/dev/null     || { err "aws CLI não encontrada"; exit 1; }
command -v pg_dump &>/dev/null || { err "pg_dump não encontrado (instala postgresql-client)"; exit 1; }
[ -f "$SSH_KEY" ] || { err "SSH key não encontrada em $SSH_KEY"; exit 1; }
ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=5 "root@$VPS_IP" 'echo ok' >/dev/null \
  || { err "SSH pra $VPS_IP falhou"; exit 1; }

# ─── 2. Pegar credenciais do RDS atual ─────────────────────────────────────
log "Obtendo endpoint + senha do RDS AWS..."
RDS_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier "$AWS_RDS_INSTANCE" \
  --query 'DBInstances[0].Endpoint.Address' --output text)
echo "RDS endpoint: $RDS_ENDPOINT"

RDS_SECRET_ARN=$(aws secretsmanager list-secrets \
  --query "SecretList[?Name=='/genomaflow/prod/rds-credentials'].ARN | [0]" \
  --output text)
RDS_SECRET=$(aws secretsmanager get-secret-value --secret-id "$RDS_SECRET_ARN" \
  --query SecretString --output text)
RDS_USER=$(echo "$RDS_SECRET" | jq -r .username)
RDS_PASS=$(echo "$RDS_SECRET" | jq -r .password)
RDS_DB=$(echo "$RDS_SECRET" | jq -r .dbname)
echo "RDS user: $RDS_USER / db: $RDS_DB"

# ─── 3. pg_dump do RDS ─────────────────────────────────────────────────────
log "Tirando dump completo do RDS (pode levar alguns minutos)..."
PGPASSWORD="$RDS_PASS" pg_dump \
  --host="$RDS_ENDPOINT" \
  --port=5432 \
  --username="$RDS_USER" \
  --dbname="$RDS_DB" \
  --format=custom \
  --no-owner \
  --no-acl \
  --verbose \
  --file="$DUMP_FILE" 2>&1 | tail -20

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
log "Dump completo: $DUMP_FILE ($DUMP_SIZE)"

# ─── 4. Upload do dump pra VPS ─────────────────────────────────────────────
log "Enviando dump pra VPS..."
scp -i "$SSH_KEY" "$DUMP_FILE" "root@$VPS_IP:/tmp/"

# ─── 5. Restore na VPS (no container postgres do docker-compose) ───────────
log "Restaurando dump na VPS (dentro do container postgres)..."
ssh -i "$SSH_KEY" "root@$VPS_IP" bash <<EOF
set -e
DUMP_FILE_VPS=/tmp/$(basename "$DUMP_FILE")
cd /opt/genomaflow

# Garantir que docker-compose tá rodando
docker compose -f docker-compose.prod.yml ps postgres | grep -q "Up" || {
  echo "Postgres container não está rodando. Subindo..."
  docker compose -f docker-compose.prod.yml up -d postgres
  sleep 10
}

# Copiar dump pra dentro do container
docker cp "\$DUMP_FILE_VPS" genomaflow-postgres:/tmp/dump.sql

# Restore. --clean dropa objetos existentes antes de criar. Cuidado: dropa
# dados existentes na VPS! Se já restaurou antes, vai recriar do zero.
docker exec -e PGPASSWORD="\$(grep ^DB_PASSWORD .env | cut -d= -f2)" \
  genomaflow-postgres \
  pg_restore -U \$(grep ^DB_USER .env | cut -d= -f2) \
             -d \$(grep ^DB_NAME .env | cut -d= -f2) \
             --clean --if-exists --no-owner --no-acl --verbose \
             /tmp/dump.sql 2>&1 | tail -30

# Garantir que extensão vector está instalada
docker exec genomaflow-postgres psql -U \$(grep ^DB_USER .env | cut -d= -f2) \
  -d \$(grep ^DB_NAME .env | cut -d= -f2) \
  -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"

# Limpar dump
rm -f "\$DUMP_FILE_VPS"
docker exec genomaflow-postgres rm -f /tmp/dump.sql

echo "✅ Restore concluído"
EOF

# ─── 6. Sync do S3 pra MinIO ───────────────────────────────────────────────
log "Sincronizando S3 -> MinIO via VPS..."

# Pega creds MinIO do .env da VPS
MC_HOST=$(ssh -i "$SSH_KEY" "root@$VPS_IP" "grep ^S3_ACCESS_KEY_ID /opt/genomaflow/.env | cut -d= -f2")
MC_SECRET=$(ssh -i "$SSH_KEY" "root@$VPS_IP" "grep ^S3_SECRET_ACCESS_KEY /opt/genomaflow/.env | cut -d= -f2")
MC_BUCKET=$(ssh -i "$SSH_KEY" "root@$VPS_IP" "grep ^S3_BUCKET /opt/genomaflow/.env | cut -d= -f2")

# Sync na VPS — mais rápido porque tira da rede da VPS direto pra MinIO local.
# Usar mc (MinIO Client) que é otimizado pra MinIO.
ssh -i "$SSH_KEY" "root@$VPS_IP" bash <<EOF
set -e
cd /opt/genomaflow

# Instalar mc se não tiver
if ! command -v mc &>/dev/null; then
  curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
  chmod +x /usr/local/bin/mc
fi

# Configurar alias pro AWS S3 (usando creds AWS_*)
mc alias set aws https://s3.us-east-1.amazonaws.com \
  "\$(grep ^AWS_ACCESS_KEY_ID .env | cut -d= -f2)" \
  "\$(grep ^AWS_SECRET_ACCESS_KEY .env | cut -d= -f2)"

# Configurar alias pro MinIO local
mc alias set local http://localhost:9000 "$MC_HOST" "$MC_SECRET"

# Criar bucket se não existir
mc mb --ignore-existing local/$MC_BUCKET

# Sync (mirror): copia tudo do AWS S3 pra MinIO. --overwrite mantém versão mais nova.
mc mirror --preserve --overwrite aws/$AWS_S3_BUCKET local/$MC_BUCKET
mc ls --recursive --summarize local/$MC_BUCKET | tail -5
EOF

# ─── 7. Limpeza local ──────────────────────────────────────────────────────
rm -f "$DUMP_FILE"
log "Migração concluída! Próximos passos:"
echo "  1. SSH na VPS e validar que app sobe: docker compose logs api"
echo "  2. Testar /api/auth/me retornando 401 (esperado sem token)"
echo "  3. Testar login admin via https://app.genomaflow.com.br"
echo "  4. Cutover DNS pra IP da VPS (Cloudflare ou Route 53)"
echo "  5. Aguardar 24h estável antes de desligar AWS (mantém RDS + S3 read-only)"
