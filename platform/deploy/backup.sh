#!/usr/bin/env bash
# Daily backup of the Docker volumes on the VM: Postgres dump, audio files, and .env (holds DATA_ENCRYPTION_KEY).
# Cron (as azureuser):  0 2 * * * /opt/ai-voice/backup.sh >> /opt/ai-voice/backups/backup.log 2>&1
# Restore steps: platform/docs/azure-vm.md
set -euo pipefail

APP_DIR=/opt/ai-voice
BACKUP_DIR=$APP_DIR/backups
KEEP_DAYS=${KEEP_DAYS:-7}
STAMP=$(date +%Y%m%d-%H%M%S)
COMPOSE="docker compose -f $APP_DIR/docker-compose.prod.yml"

umask 077
mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

# 1. Database (custom format: restore with pg_restore)
$COMPOSE exec -T postgres pg_dump -U postgres -Fc interview > "$BACKUP_DIR/db-$STAMP.dump"
[ -s "$BACKUP_DIR/db-$STAMP.dump" ] || { echo "empty database dump"; rm -f "$BACKUP_DIR/db-$STAMP.dump"; exit 1; }

# 2. Audio files volume (compose project name = folder name "ai-voice")
docker run --rm -v ai-voice_storage:/data:ro -v "$BACKUP_DIR":/backup alpine \
  tar czf "/backup/storage-$STAMP.tar.gz" -C /data .

# 3. Settings and encryption key
cp .env "$BACKUP_DIR/env-$STAMP"

# 4. Delete backups older than KEEP_DAYS
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*' -o -name 'storage-*' -o -name 'env-*' \) -mtime +"$KEEP_DAYS" -delete

echo "$(date -Is) backup ok: db-$STAMP.dump ($(du -h "$BACKUP_DIR/db-$STAMP.dump" | cut -f1))"
