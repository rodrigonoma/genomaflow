#!/usr/bin/env bash
# backup-pg.sh — Backup diário do PostgreSQL + sync pra storage externo.
#
# Roda na VPS via cron (definido em vps-setup.sh): /etc/cron.d/genomaflow-backup
# Executa às 03:00 BRT diário.
#
# Estratégia:
#   - pg_dump custom format direto do container postgres
#   - Comprimido + retenção 7 dias locais
#   - Upload pra Backblaze B2 (ou MinIO de outra VPS, ou S3 externo)
#   - Logs em /var/log/genomaflow-backup.log
#
# Variáveis esperadas no .env:
#   B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET (opcional — se ausente, skipa upload)

set -euo pipefail

cd /opt/genomaflow

# Carregar .env
set -a
source .env
set +a

BACKUP_DIR=/var/backups/genomaflow
mkdir -p "$BACKUP_DIR"
DATE=$(date +%Y%m%d-%H%M%S)
DUMP="$BACKUP_DIR/db-$DATE.sql.gz"

log() { echo "[$(date +%Y-%m-%d\ %H:%M:%S)] $*"; }

log "=== Iniciando backup ==="

# ─── 1. pg_dump ──────────────────────────────────────────────────────────────
log "pg_dump..."
docker exec -e PGPASSWORD="$DB_PASSWORD" genomaflow-postgres \
  pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --format=custom --no-owner --no-acl \
  | gzip > "$DUMP"

DUMP_SIZE=$(du -h "$DUMP" | cut -f1)
log "Dump criado: $DUMP ($DUMP_SIZE)"

# ─── 2. Upload Backblaze B2 (se configurado) ────────────────────────────────
if [ -n "${B2_KEY_ID:-}" ] && [ -n "${B2_APPLICATION_KEY:-}" ] && [ -n "${B2_BUCKET:-}" ]; then
  log "Uploading para B2 ($B2_BUCKET)..."

  # Instalar b2 CLI se não tiver
  if ! command -v b2 &>/dev/null; then
    curl -fsSL https://github.com/Backblaze/B2_Command_Line_Tool/releases/latest/download/b2-linux \
      -o /usr/local/bin/b2
    chmod +x /usr/local/bin/b2
  fi

  b2 account authorize "$B2_KEY_ID" "$B2_APPLICATION_KEY" >/dev/null
  b2 file upload "$B2_BUCKET" "$DUMP" "backups/$(basename "$DUMP")"
  log "Upload OK: backups/$(basename "$DUMP")"
else
  log "B2 não configurado — pulando upload externo (backup só local)"
fi

# ─── 3. Retenção local (7 dias) ─────────────────────────────────────────────
log "Limpando backups locais > 7 dias..."
find "$BACKUP_DIR" -name "db-*.sql.gz" -mtime +7 -delete -print

# ─── 4. Sync MinIO bucket (incremental) ─────────────────────────────────────
# Backup do storage de uploads também (clinical PDFs, video files, etc).
# Em volume Docker — usar mc mirror pra outra VPS ou snapshot do disk.
# Por padrão, NÃO faz nada aqui — depende do volume de uploads.
# Considerar: snapshot Hostinger automatic (incluído no plano).

log "=== Backup concluído ==="
