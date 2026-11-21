# Interview Platform

Multi-tenant SaaS for AI voice interviews (see `AI_Voice_Interview_Platform_Plan.pdf`).

## Run locally

Needs Docker Desktop and Node 26 (see `.nvmrc`).

```bash
docker compose up -d            # Postgres 18 (port 5433) and Valkey (port 6380)
npm install
npm run migrate                 # create tables, row-level security and the app_user role
npm run create-super-admin -- you@company.com "Your Name"   # prints a one-time set-password link
npm run dev -- -p 3001          # http://localhost:3001
```

`.env.local` holds local settings (copy `.env.example` and fill it in on a new machine; generate
`DATA_ENCRYPTION_KEY` with `openssl rand -base64 32`).

## Tests

```bash
npm test                        # tenant isolation tests against the local database
```

## How tenant isolation works

- Every tenant-owned table has PostgreSQL row-level security (`db/migrations`).
- The app connects as `app_user`, which is not a superuser and does not own the tables, so RLS always applies.
- All tenant queries go through `withContext()` in `src/db/index.ts`, which sets the tenant (or super admin)
  for one transaction. With no context, tenant tables return no rows.
- `tests/tenant-isolation.test.ts` tries to read, change and insert across tenants and must fail.

## Sign-in

- Email + password (bcrypt), sessions stored as SHA-256 hashes, 8-hour lifetime, 60-minute idle timeout.
- 2-step codes (authenticator app) are required for the Super Admin and tenant admins; secrets are encrypted
  with AES-256-GCM; each code works once.
- Login is rate-limited per account and per IP (Redis).
- New users get a one-time, 7-day set-password link instead of a password.
- `npm run dev-totp -- <email>` prints the current code for a local test account (development only).

## Production

| | |
|---|---|
| Containers | `Dockerfile`: targets `web` (Next.js) and `jobs` (scoring, maintenance and message workers, migrations) |
| AWS infrastructure | `infra/terraform` (Mumbai; staging + production tfvars) |
| CI / deploy | `.github/workflows/ci.yml`, `deploy.yml` |
| Transcription PCs | `worker/README.md`, `worker/service/` |
| Docs | [runbook](docs/runbook.md) · [operations & alarms](docs/operations.md) · [admin guide](docs/admin-guide.md) · [recruiter guide](docs/recruiter-guide.md) · [go-live checklist](docs/go-live-checklist.md) |
