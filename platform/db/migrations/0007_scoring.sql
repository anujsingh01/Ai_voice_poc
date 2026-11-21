-- Scoring: one structured AI call per interview on masked text, totals computed in code, every score
-- versioned (model, prompt, rubric) so it can be explained and reproduced. Usage is metered per tenant.

CREATE TYPE score_status AS ENUM ('waiting', 'queued', 'scoring', 'scored', 'needs_review', 'paused_budget', 'failed');
CREATE TYPE scoring_job_status AS ENUM ('queued', 'running', 'submitted', 'done', 'failed');

ALTER TABLE interviews
  ADD COLUMN score_status  score_status NOT NULL DEFAULT 'waiting',
  ADD COLUMN final_score   numeric(5, 1),          -- 0–100, average of the passes
  ADD COLUMN score_flags   jsonb NOT NULL DEFAULT '[]';   -- why a person should look: close call, knockout, low confidence…

-- Each scoring pass (1 = first, 2 = independent second opinion for close calls).
CREATE TABLE scores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interview_id     uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  pass             integer NOT NULL CHECK (pass IN (1, 2)),
  model            text NOT NULL,
  prompt_version   text NOT NULL,
  rubric_id        uuid NOT NULL REFERENCES rubrics(id),
  dimensions       jsonb NOT NULL,      -- { key: { score 1–5 | null, weight, source } }
  answers          jsonb NOT NULL,      -- per answer: scores, quotes, quote_verified, knockout, must_mention
  total            numeric(5, 1) NOT NULL,
  summary          text NOT NULL,
  strengths        jsonb NOT NULL DEFAULT '[]',
  concerns         jsonb NOT NULL DEFAULT '[]',
  quote_failures   integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_id, pass)
);

CREATE TABLE scoring_jobs (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interview_id  uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  pass          integer NOT NULL CHECK (pass IN (1, 2)),
  mode          scoring_mode NOT NULL,
  status        scoring_job_status NOT NULL DEFAULT 'queued',
  attempts      integer NOT NULL DEFAULT 0,
  batch_id      text,                    -- OpenAI Batch id while waiting (Batch mode)
  leased_until  timestamptz,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  UNIQUE (interview_id, pass)
);
CREATE INDEX scoring_jobs_open ON scoring_jobs(status, created_at) WHERE status IN ('queued', 'running', 'submitted');

-- Every paid AI call, with tokens and cost, billed to the platform or to the tenant's own key.
CREATE TABLE usage_ledger (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interview_id   uuid REFERENCES interviews(id) ON DELETE SET NULL,
  kind           text NOT NULL,                  -- 'scoring'
  model          text NOT NULL,
  batch          boolean NOT NULL DEFAULT false,
  input_tokens   integer NOT NULL,
  output_tokens  integer NOT NULL,
  cost_inr       numeric(10, 4) NOT NULL,
  billed_to      text NOT NULL CHECK (billed_to IN ('platform', 'tenant')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_ledger_tenant_month ON usage_ledger(tenant_id, created_at);

-- A tenant's own OpenAI key (optional, allowed by the super admin), encrypted with AES-256-GCM.
CREATE TABLE tenant_secrets (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  openai_key_enc  text,
  openai_key_hint text,                          -- last 4 characters, to show which key is set
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['scores', 'scoring_jobs', 'usage_ledger', 'tenant_secrets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (is_super_admin() OR tenant_id = current_tenant_id())
                    WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON scores, usage_ledger TO app_user;          -- scores and costs are never rewritten
GRANT SELECT, INSERT, UPDATE ON scoring_jobs TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_secrets TO app_user;
GRANT USAGE ON SEQUENCE scoring_jobs_id_seq, usage_ledger_id_seq TO app_user;
