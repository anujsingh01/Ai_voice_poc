# Operations: health checks, alarms, backups

## Health endpoint

`GET /api/health`

| Caller | Sends | Gets |
|---|---|---|
| Load balancer / uptime check | nothing | `{"status":"ok"}` (200) or `{"status":"down"}` (503) |
| Monitoring (CloudWatch Synthetics, UptimeRobot, Grafana) | `Authorization: Bearer $HEALTH_TOKEN` | full report: DB and Redis latency, queue depths, workers online, active alarms |

The detailed report is behind a token because queue sizes and worker counts tell an outsider how busy the platform is.
`HEALTH_TOKEN` is set in `.env.local` (generate with `openssl rand -hex 32`).

```bash
curl -s -H "Authorization: Bearer $HEALTH_TOKEN" https://app.example.com/api/health | jq
```

Poll every minute. Status `degraded` (200) means warnings; `down` (503) means at least one critical alarm.
The same alarms appear as banners on the super-admin overview page.

## Alarm rules

Thresholds live in `src/lib/health.ts` (`ALARMS`).

| Code | Level | Fires when | What to do |
|---|---|---|---|
| `db_down` | critical | Postgres doesn't answer within 3 s | Check the RDS instance / container. Candidates can't start or upload. |
| `db_slow` | warning | `SELECT 1` takes over 500 ms | Look for long-running queries (`pg_stat_activity`), connection exhaustion, CPU. |
| `redis_down` | critical | Redis doesn't answer `PING` | Logins and rate limits fail. Restart Redis / ElastiCache node. |
| `no_workers` | critical | Answers waiting and no transcription worker seen in 2 min | Start the GPU PC worker (`worker/README.md`). Uploads keep queuing safely meanwhile. |
| `worker_offline` | warning | Some enabled workers silent for 2 min | Check that PC: power, network, `transcribe_worker.py` log. Disable it in Super admin → Workers if retired. |
| `transcription_backlog` | warning | Oldest queued answer waited > 30 min | Add a worker, or check that the existing ones aren't stuck. |
| `expired_leases` | warning | A worker took a job and never finished it | Usually a crash. The job is retried automatically; repeated → read the worker log. |
| `scoring_backlog` | warning | Oldest interview waited > 60 min for scoring | Is `npm run scoring-worker` running? Is the tenant over budget (paused)? Is OpenAI up? |
| `batch_late` | warning | An OpenAI Batch has been out > 26 h | Check the batch on the OpenAI dashboard; cancel and re-queue in Fast mode if needed. |
| `failures` | critical | More than 10 transcription + scoring jobs failed in an hour | Read `error` on the failed rows in `transcription_jobs` / `scoring_jobs`. Common: bad audio, OpenAI key revoked, quota. |

Also alarm on (from AWS, not this endpoint):

- **Disk / S3**: storage bucket errors in CloudWatch, or local disk over 80%.
- **TLS certificate** expiring within 14 days.
- **AI spend**: the platform already moves a tenant to Batch at 90% of budget and pauses at 100%; send an email to the tenant admin at both points.

## Background processes that must be running

| Process | Command | If it stops |
|---|---|---|
| Web app | `npm run start` | Site down (`/api/health` unreachable) |
| Scoring worker | `npm run scoring-worker` | `scoring_backlog` fires |
| Maintenance (retention, notices) | `npm run maintenance` | Deletions overdue: DPDP risk. Check `deletion_log` daily. |
| Message sender (SMS, email) | `npm run message-worker` | Invites stay "queued" on the Messages page; failures show there with the reason |
| Transcription worker(s), GPU PC | `python transcribe_worker.py` | `no_workers` / `worker_offline` fires |

## Backups

See `scripts/backup-restore-test.sh`. Production: RDS automated backups (7–35 days) plus point-in-time recovery, and S3 versioning on the audio bucket.
Restore test monthly: restore into a scratch database, compare row counts, sign in.

## Pre-release checks

| Check | Command | Last result (local, Mac, production build) |
|---|---|---|
| Unit + integration tests | `npm test` | 97 passed |
| End-to-end (real worker, real audio) | `npm run e2e-test` | 21/21 checks passed; 9 answers transcribed in ~66 s |
| Load: 200 candidates at once, no pauses | `npm run load-test -- 200` | 200/200 completed, 2,200 requests, p95 ≈ 0.55 s, max 0.6 s, no errors |
| Backup + restore drill | `scripts/backup-restore-test.sh` | 36 tables match, RLS/policies/grants intact |
| Dependencies | `npm audit` | 21 moderate, all one `minimatch` ReDoS in lint tooling and exceljs's zip writer (never sees user input); PostCSS and uuid pinned to patched versions via `overrides` |

The load test is deliberately harsher than reality: every candidate uploads all 9 answers back to back,
where real candidates spend ~1 minute per answer. 200 truly simultaneous interviews produce ~3 uploads/s.
