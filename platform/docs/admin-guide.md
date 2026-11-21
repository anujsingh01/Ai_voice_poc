# Admin guide

## Platform staff (Super admin console, `/super`)

Your company runs the platform; each customer company is a **tenant**.

| Role | Can |
|---|---|
| Owner | Everything, including staff accounts and plans |
| Admin | Tenants, plans, transcription PCs; not staff accounts |
| Billing | Plans, moving tenants between plans, trial/active/suspended status; read everything else |
| Support | Read-only, including viewing a tenant "as" them (every view is in the audit log) |

All staff use 2-step login (an authenticator app). Staff accounts are separate from tenant accounts:
use a different email for each.

**Your own account**: click your name at the bottom of the menu to change your password, make new
backup codes, or move 2-step login to a new phone. When 2-step login is set up you get 10 one-time
backup codes: print or download them and keep them away from the phone.

**Someone is locked out**:
- *Forgot password*: they click "Forgot your password?" on the sign-in page and get a 1-hour link
  by email. Or create a "Password link" for them (Tenants → tenant, or Staff) and send it yourself.
- *Lost phone*: they sign in with one of their backup codes, then use "Move to a new phone" on their
  account page. No backup codes either: click "Reset 2-step" next to their name (tenant page or
  Staff); they scan a new QR code at their next sign-in. Check it's really them first (call them),
  as this is the one step that bypasses the phone.

**New customer**: Tenants → New tenant → name, web address (`/t/<address>`), plan, and their first
admin's email. Copy the one-time set-password link from the tenant page and send it to them yourself
(link expires in 7 days).

**Plans**: Plans → edit limits (interviews per month, active jobs, recruiter seats, languages, AI
budget, retention). "Apply to tenants" updates everyone on that plan except tenants with custom limits.

**Online billing (Razorpay)**: on a plan, tick "Tenant admins can choose and pay for this plan online".
Tenant admins then see it on their **Billing** page, fill in billing details (GSTIN optional) and pay
on Razorpay's page by card, UPI AutoPay or netbanking. After that it runs by itself:
- Each successful monthly/yearly charge keeps the tenant active on that plan (limits applied).
- A failed charge: Razorpay retries for a few days and the tenant admins get an email. If every retry
  fails, the tenant is suspended "for non-payment"; paying on the Billing page reopens it at once.
- Plan change: takes effect when the current paid period ends (nothing is charged twice).
- Cancel: renewal stops; access continues to the end of the paid period, then the tenant is suspended.
- Tenants you manage by hand ("Manual" in their Billing panel) are never touched by any of this, and a
  suspension you set yourself is never lifted by a payment.
Prices on plans include GST. Changing a plan's price applies to new subscriptions only.

**Transcription PCs**: Transcription → Register a PC. Shows each PC online/offline and the queue.
Disable a PC to cut it off immediately.

**Usage & costs**: interviews and AI spend per tenant this month. **Audit log**: every sign-in,
change, export and "view as".

Alarms (database, Redis, workers offline, backlogs, failures) appear at the top of the overview.

## Tenant admins (`/t/<your-company>`)

Your recruiters and reviewers work here. As tenant admin you also set things up.

1. **Consent notice** (do this first): the text candidates see before the interview, per language.
   `{company}` and `{days}` are filled in. Have it reviewed by your legal/HR contact and give a
   grievance contact (name + email/phone).
2. **Users**: invite recruiters and reviewers. Copy each person's set-password link and send it to
   them. Admins must set up 2-step login. If a colleague loses their phone and their backup codes,
   "Reset 2-step" next to their name makes them set it up again at their next sign-in.

   | Role | Can |
   |---|---|
   | Tenant admin | Everything: users, jobs, question banks, rubric, consent notice, AI settings, privacy requests, plus all recruiter work |
   | Recruiter | Candidates and invitations, decisions, score overrides, exports, blind calibration ratings |
   | Reviewer | View interviews and results, comment; no decisions |

3. **Question banks**: download the Excel template, fill one column per language, upload. Each row is
   checked before anything is saved; each upload is a new version (past interviews keep theirs).
   Upload recorded audio for each question if you want candidates to hear it.
4. **Jobs**: title, languages, question bank, number of questions/objections, answer time, the
   scoring rubric (dimension weights and shortlist cut-off). **Go live** checks everything is ready.
5. **AI & usage**: monthly AI budget usage. At 90% scoring switches to Batch (slower, half price); at
   100% it pauses until next month or a higher budget. You can use your own OpenAI key instead.
6. **Privacy requests**: candidates' DPDP requests (copy of data, correction, deletion, complaint,
   consent withdrawal). Answer within 30 days. "Export" gives the candidate's data as a file;
   "Delete" removes audio, transcripts and scores permanently (recorded in the deletion log).
7. **Activity log**: who did what, when.

Data is deleted automatically after your retention period (set on your plan); candidates get 48
hours' notice first.
