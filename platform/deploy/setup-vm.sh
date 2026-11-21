#!/usr/bin/env bash
# One-time VM setup (Ubuntu 22.04/24.04). Run on the VM: bash setup-vm.sh
set -euo pipefail

# Docker + compose plugin
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# Firewall (the Azure NSG must also allow 80 and 443)
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw --force enable

sudo mkdir -p /opt/ai-voice && sudo chown "$USER" /opt/ai-voice
cd /opt/ai-voice

if [ ! -f .env ]; then
  cat > .env <<EOF
DOMAIN=CHANGE_ME.centralindia.cloudapp.azure.com
GHCR_OWNER=anujsingh01
IMAGE_TAG=latest
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_DB_PASSWORD=$(openssl rand -hex 24)
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)
HEALTH_TOKEN=$(openssl rand -hex 32)
OPENAI_API_KEY=
EMAIL_DRIVER=dev
SMS_DRIVER=dev
EOF
  chmod 600 .env
  echo "Created /opt/ai-voice/.env with random secrets. Edit DOMAIN and OPENAI_API_KEY, and BACK UP DATA_ENCRYPTION_KEY."
fi
echo "Done. Log out and back in once so the docker group applies."
