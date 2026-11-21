# Runbook

For whoever operates the platform. Alarm meanings and health checks: [operations.md](operations.md).

## Architecture in one picture

```
Candidates' phones ──HTTPS──► WAF ► Load balancer ► web (ECS Fargate, 2–6 tasks) ──► PostgreSQL (RDS, Multi-AZ)
Recruiters' browsers ─┘                                   │                     ──► Redis (ElastiCache)
                                                          │                     ──► S3 audio bucket (KMS)
Office GPU PCs ──HTTPS (office IPs only)──► /api/worker   │
                                 scoring worker (ECS) ────┴──► OpenAI (masked text only)
                                 maintenance worker (ECS): retention, deletion notices
```

Everything runs in AWS Mumbai (ap-south-1). Audio and transcripts never leave AWS Mumbai and the office PCs.

## First-time setup (once per environment)

1. **AWS account**: enable MFA on the root user; create an admin IAM Identity Center user; turn on
   CloudTrail (all regions) and GuardDuty.
2. **Terraform state bucket** (versioned, encrypted, private) in ap-south-1; put its name in
   `infra/terraform/environments/<env>.backend.hcl`.
3. **Domain + certificate**: request an ACM certificate for the domain in ap-south-1 (DNS validation).
   Fill in `environments/<env>.tfvars`: domain, certificate ARN, alarm email, office IPs, budget.
4. **Create the infrastructure** (from `infra/terraform`, with Terraform 1.10+ and AWS credentials):
   ```bash
   terraform init -backend-config=environments/staging.backend.hcl
   terraform apply -var-file=environments/staging.tfvars -var image_tag=bootstrap
   ```
   The first apply creates repositories, database and secrets; services stay unhealthy until the
   first real deploy pushes images. Then point the domain at `load_balancer_dns` (output).
5. **OpenAI key**: `aws secretsmanager put-secret-value --secret-id interview-staging/openai-api-key --secret-string 'sk-...'`
   and set a monthly spend limit in the OpenAI dashboard.
6. **Confirm the alarm email** (SNS sends a confirmation link).
7. **GitHub**: create a deploy role trusted by GitHub OIDC for this repository, with permissions for
   ECR push, ECS, Terraform state and the resources above; store its ARN as the repository variable
   `AWS_DEPLOY_ROLE_ARN`. Create GitHub environments `staging` and `production`; require a reviewer on
   `production`.
8. **First deploy**: Actions → Deploy → staging.
9. **First super admin**, from a one-off ECS task with the jobs image:
   `scripts/create-super-admin.mts <email> "<name>"` (prints a one-time set-password link). They set a
   password and 2-step login on first sign-in.
10. **Transcription PCs**: Super admin → Transcription → Register a PC (copy the token once), then
    install the worker (`worker/README.md`, `worker/service/`). Add the office's public IP to
    `office_ip_cidrs` and re-apply, or the WAF blocks the worker.

Repeat for production. Never copy a database or secrets from production to staging.

## Releasing

1. Merge to `main` with CI green (lint, types, 100+ tests incl. cross-tenant isolation, audit, Terraform scan).
2. Actions → Deploy → **staging**. Check: sign in, open a job, `npm run e2e-test` against staging
   (APP_URL=https://staging..., DATABASE_ADMIN_URL from Secrets Manager via a bastion/one-off task).
3. Actions → Deploy → **production** (needs approval). The pipeline builds images tagged with the
   commit, runs migrations (release stops if they fail), then rolls the services. A web release that
   fails health checks rolls back by itself.
4. Watch the Super admin overview and the `web-5xx` / `health-check` alarms for 15 minutes.

**Migrations must be backwards-compatible** (add columns/tables; never drop or rename in the same
release that stops using them), because old and new web tasks run side by side during a roll-out.

**Rolling back code**: run Deploy again on the previous commit (Actions → Deploy → "Use workflow from"
an older ref is not supported; instead `git revert` and deploy, which keeps history honest).

## Incidents

| Symptom | First checks |
|---|---|
| Site down / `health-check` alarm | ECS → web service events; target group health; RDS status. `/api/health` with the token says which part is down. |
| Candidates report uploads failing | WAF → sampled requests (blocked?); `web` logs for `request failed`; S3 errors. |
| Answers not being transcribed | Super admin → Transcription: PCs online? Office internet? Office IP changed (WAF blocks unknown IPs)? |
| Scores not appearing | `scoring` logs; tenant budget paused (AI & usage page); OpenAI status / key / spend limit. |
| Slow pages | RDS Performance Insights (top SQL); ECS CPU (auto-scales to `web_max_count`). |
| Suspected breach | See below. |

**Suspected data breach**: (1) contain: disable the affected accounts (Users page / Staff page),
revoke worker tokens, rotate secrets (below); (2) preserve: snapshot RDS, export the audit log, don't
delete logs; (3) assess scope with the audit log (who viewed or exported what); (4) DPDP: the tenant
(Data Fiduciary) must inform the Data Protection Board and affected candidates without delay, so tell
affected tenants within 24 hours with the facts so far. Keep a written timeline.

## Routine

| When | What |
|---|---|
| Daily | Glance at the Super admin overview (alarms, queue). Check `deletion_log` grew if deletions were due. |
| Weekly | Privacy requests nearing 30 days (each tenant's Privacy requests page). `npm audit` results from CI. |
| Monthly | Restore drill (`scripts/backup-restore-test.sh` against a restored RDS snapshot). Calibration report per active job. AWS + OpenAI costs vs budget. |
| Quarterly | Rotate secrets. Review staff accounts and roles. Review office IP list. |

## Secret rotation

| Secret | How |
|---|---|
| Database app password | `terraform apply -replace=random_password.db_app`, then run the migrate task (it re-sets the password), then force a new deployment of all services. |
| Redis auth token | `-replace=random_password.redis` (ElastiCache rotates in place), then redeploy services. |
| Health token | `-replace=random_password.health_token`, redeploy; the canary reads the new value itself. |
| Data encryption key | **Do not replace casually**: it encrypts stored 2FA secrets and tenant OpenAI keys. Replacing it means every admin re-enrols 2-step login. |
| OpenAI key | New key in the OpenAI dashboard → `put-secret-value` → redeploy `scoring` → delete the old key. |
| Worker tokens | Super admin → Transcription → disable the PC, register it again, update its `.env`. |

## Restore from backup

- **Point in time** (e.g. someone deleted data at 14:05): RDS → Restore to point in time (14:04) into a
  new instance; check it; then either copy the missing rows across, or switch `database-url` /
  `database-admin-url` secrets to the new host and redeploy.
- **Audio**: S3 keeps deleted versions for 7 days (then purges them, for DPDP). Restore a version from
  the console within that window.
- Remember: data deleted under a candidate's deletion request must **not** be restored. After a
  restore, re-run the deletions recorded in `deletion_log` since the restore point.
