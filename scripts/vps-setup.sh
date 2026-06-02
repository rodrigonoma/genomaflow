#!/usr/bin/env bash
# vps-setup.sh — Bootstrap inicial da VPS Hostinger (Ubuntu 24.04).
#
# Idempotente: pode rodar várias vezes. Setup mínimo seguro pra produção:
#   - swap (4GB)
#   - unattended-upgrades (security patches automáticos)
#   - ufw (firewall: só 22, 80, 443)
#   - fail2ban (proteção SSH brute force)
#   - Docker Engine + Docker Compose plugin
#   - Usuário non-root pra deploy (opcional, padrão: continua root)
#
# Uso (na VPS, como root):
#   curl -fsSL https://raw.githubusercontent.com/rodrigonoma/genomaflow/main/scripts/vps-setup.sh | bash
#   # OU local:
#   bash scripts/vps-setup.sh

set -euo pipefail

log() { echo -e "\n\e[1;32m[$(date +%H:%M:%S)] $*\e[0m"; }

# ─── 1. Swap (4GB) ──────────────────────────────────────────────────────────
if ! swapon --show | grep -q .; then
  log "Criando swapfile de 4GB..."
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
  sysctl --system >/dev/null
else
  log "Swap já configurado: $(free -h | awk '/^Swap:/ {print $2}')"
fi

# ─── 2. Atualizar sistema + unattended-upgrades ─────────────────────────────
log "Atualizando pacotes do sistema..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  ca-certificates \
  curl \
  gnupg \
  ufw \
  fail2ban \
  unattended-upgrades \
  apt-listchanges \
  htop \
  ncdu \
  jq \
  postgresql-client-16

log "Configurando unattended-upgrades..."
cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins {
  "${distro_id}:${distro_codename}-security";
  "${distro_id}ESMApps:${distro_codename}-apps-security";
  "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades

# ─── 3. UFW firewall (só 22, 80, 443) ───────────────────────────────────────
log "Configurando UFW..."
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (Caddy will redirect to HTTPS)'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 443/udp comment 'HTTP/3 QUIC'
ufw --force enable
ufw status verbose | head -20

# ─── 4. Fail2ban (SSH protection) ───────────────────────────────────────────
log "Configurando fail2ban..."
cat > /etc/fail2ban/jail.d/sshd.conf <<'EOF'
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = %(sshd_log)s
backend = %(sshd_backend)s
maxretry = 3
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

# ─── 5. Docker Engine + Compose plugin ──────────────────────────────────────
if ! command -v docker &>/dev/null; then
  log "Instalando Docker Engine..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  log "Docker já instalado: $(docker --version)"
fi

# ─── 6. SSH hardening (caso ainda não tenha sido feito) ─────────────────────
log "Verificando SSH hardening..."
if grep -q "^PasswordAuthentication yes" /etc/ssh/sshd_config 2>/dev/null \
   || ! grep -q "^PasswordAuthentication no" /etc/ssh/sshd_config 2>/dev/null; then
  echo "⚠️  AVISO: PasswordAuthentication ainda permitido."
  echo "    Pra desligar (depois de garantir chave SSH funcionando):"
  echo "    sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config"
  echo "    systemctl reload sshd"
else
  echo "✅ PasswordAuthentication desabilitado."
fi

# ─── 7. Diretório do projeto ────────────────────────────────────────────────
mkdir -p /opt/genomaflow
log "Diretório /opt/genomaflow criado. Clone o repo aqui:"
echo "   cd /opt/genomaflow"
echo "   git clone https://github.com/rodrigonoma/genomaflow.git ."
echo "   cp .env.vps.template .env"
echo "   nano .env  # preencher segredos"

# ─── 8. Backup automático (cron) ────────────────────────────────────────────
log "Configurando cron de backup diário às 03:00 BRT..."
cat > /etc/cron.d/genomaflow-backup <<'EOF'
# Backup diário PostgreSQL + MinIO state às 03:00 BRT.
# Script só roda se /opt/genomaflow/scripts/backup-pg.sh existir.
0 3 * * * root [ -x /opt/genomaflow/scripts/backup-pg.sh ] && /opt/genomaflow/scripts/backup-pg.sh >> /var/log/genomaflow-backup.log 2>&1
EOF

log "Setup VPS concluído. Próximos passos:"
echo "  1. Configurar chave SSH e desabilitar PasswordAuthentication (se ainda não fez)"
echo "  2. cd /opt/genomaflow && git clone . (clonar este repo)"
echo "  3. cp .env.vps.template .env && nano .env (preencher segredos)"
echo "  4. cp Caddyfile docker-compose.prod.yml /opt/genomaflow/"
echo "  5. Apontar DNS (genomaflow.com.br, app, s3, minio-console) pro IP da VPS"
echo "  6. docker compose -f docker-compose.prod.yml --env-file .env up -d"
echo "  7. Setup MinIO bucket + credentials (ver docs/vps-migration.md)"
echo "  8. Rodar scripts/migrate-data.sh pra trazer DB + S3 da AWS"
