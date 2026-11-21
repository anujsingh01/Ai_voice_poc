# Go-live checklist (Day 7)

Tick each item; any ✗ in **Must** means no-go.

## Must (go/no-go)

| | Item | Who | Status |
|---|---|---|---|
| ☐ | Legal/HR sign-off on the consent notice, privacy notice and processor agreement | You | |
| ☐ | Grievance contact filled in on the Consent notice page | Tenant admin | |
| ☐ | Calibration targets met: AI within 1 point ≥ 80%, shortlist agreement ≥ 85%, quote failures < 2%, ≥ 25 interviews rated by 2 recruiters | Recruiters | Report on each job's Calibration page |
| ☐ | Production infrastructure applied; CI green on the release commit; deployed via the pipeline | Engineering | |
| ☐ | OpenAI key in Secrets Manager with a monthly spend limit; one real interview scored end to end in staging | Engineering | Not yet run: no key available |
| ☐ | Alarm email confirmed; health canary green for 24 h | Engineering | |
| ☐ | At least 2 transcription PCs online in production (one can fail); office IPs in the WAF list | IT | |
| ☐ | First super admin and tenant admins have 2-step login set up and their backup codes stored safely | Admins | |
| ☐ | Restore drill done on production backups | Engineering | Done locally (`scripts/backup-restore-test.sh`) |
| ☐ | Load test passed (200 candidates at once) | Engineering | Passed locally: 200/200, p95 ≈ 0.55 s |
| ☐ | End-to-end test passed against staging | Engineering | Passed locally: 21/21 |
| ☐ | Security review findings fixed; CI dependency audit has no high/critical | Engineering | Done (Day 6) |

## Should (go with a dated plan)

| | Item | Note |
|---|---|---|
| ☐ | SMS/email sending switched on: SES domain verified (DKIM records from `terraform output ses_dkim_records`) and out of the SES sandbox; Gupshup DLT templates registered, then `sms_driver = "gupshup"` | Code done (message worker, retries). WhatsApp not built. Until switched on, recruiters share links with Copy/WhatsApp |
| ☐ | Candidate privacy page in Hindi/Tamil (the interview itself is already translated) | |
| ☑ | Composite tenant foreign keys (defence in depth; no known leak) | Done: migration 0012 |
| ☐ | Online billing: Razorpay account KYC done; GST details set in Razorpay; webhook added (URL `/api/billing/razorpay/webhook`, events `subscription.*` and `invoice.paid`); `billing_driver = "razorpay"`; one real ₹1 test plan paid and cancelled | Code done; leave off to bill tenants by hand |
| ☐ | External penetration test | Plan: week 2 |

## Launch day

1. Deploy the release commit to production; watch alarms for 15 minutes.
2. Onboarding session (1 hour): admins walk through [admin-guide.md](admin-guide.md), recruiters
   through [recruiter-guide.md](recruiter-guide.md), using a test job.
3. Invite the **first 100 real candidates** for one job.
4. Next morning: check every interview was transcribed and scored, look at "needs review" ones,
   check no candidate complaints. Then widen.
