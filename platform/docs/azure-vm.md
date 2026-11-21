# Azure VM deployment (POC)

Everything runs with Docker Compose in `/opt/ai-voice` on one Ubuntu VM (see `docker-compose.prod.yml`).
This replaces the AWS Terraform stack for the POC.

## Where the data lives (Docker volumes, project name `ai-voice`)

| Volume | Holds |
|---|---|
| `ai-voice_pgdata` | PostgreSQL data |
| `ai-voice_storage` | Candidate audio files |
| `ai-voice_redisdata` | Valkey (sessions, rate limits) |
| `ai-voice_caddy_data` | HTTPS certificates |

Never run `docker compose down -v` or `docker volume prune`: they delete these volumes.
A normal deploy (`up -d`) or `docker compose down` keeps the data.

## Backups

`deploy/backup.sh` is copied to `/opt/ai-voice/backup.sh` by the deploy workflow. One-time on the VM:

```bash
chmod +x /opt/ai-voice/backup.sh
/opt/ai-voice/backup.sh                     # test run; check /opt/ai-voice/backups
( crontab -l 2>/dev/null; echo '0 2 * * * /opt/ai-voice/backup.sh >> /opt/ai-voice/backups/backup.log 2>&1' ) | crontab -
```

Daily at 02:00 (VM time): database dump, audio archive and a copy of `.env` (it holds `DATA_ENCRYPTION_KEY`,
without which encrypted data can't be read). The last 7 days are kept in `/opt/ai-voice/backups`.

Backups on the same VM don't survive losing the VM. Also turn on **Azure Backup** for the VM
(VM → Backup + disaster recovery) or copy `/opt/ai-voice/backups` off the VM regularly.

## Restore

```bash
cd /opt/ai-voice
docker compose -f docker-compose.prod.yml stop web scoring-worker maintenance-worker message-worker
# database
docker compose -f docker-compose.prod.yml exec -T postgres dropdb -U postgres interview
docker compose -f docker-compose.prod.yml exec -T postgres createdb -U postgres interview
docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U postgres -d interview --no-owner < backups/db-<stamp>.dump
# audio files
docker run --rm -v ai-voice_storage:/data -v /opt/ai-voice/backups:/backup alpine sh -c "cd /data && tar xzf /backup/storage-<stamp>.tar.gz"
docker compose -f docker-compose.prod.yml up -d      # migrate re-creates the app_user grants
```

## Create the first super admin

```bash
cd /opt/ai-voice
docker compose -f docker-compose.prod.yml run --rm --no-deps --entrypoint npx migrate tsx scripts/create-super-admin.mts you@company.com "Your Name"
```
