-- Day 5: recruiter decisions and score overrides, reviewer comments, candidate rights requests (DPDP
-- Sections 11–13), and automatic deletion when the retention period ends (DPDP Rule 8).

CREATE TYPE decision_kind AS ENUM ('shortlist', 'hold', 'reject');
CREATE TYPE rights_kind AS ENUM ('access', 'correction', 'deletion', 'withdraw', 'complaint');
CREATE TYPE rights_status AS ENUM ('open', 'in_progress', 'closed');

-- A recruiter's decision on an interview. Every change is a new row (latest wins), so the history stays.
CREATE TABLE decisions (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interview_id  uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  decision      decision_kind NOT NULL,
  reason        text NOT NULL CHECK (length(reason) BETWEEN 3 AND 2000),
  decided_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decisions_interview ON decisions(interview_id, id DESC);

-- A recruiter's override of the AI total, always with a reason; feeds calibration on Day 6.
CREATE TABLE score_overrides (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interview_id  uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  ai_score      numeric(5, 1),
  new_score     numeric(5, 1) NOT NULL CHECK (new_score BETWEEN 0 AND 100),
  reason        text NOT NULL CHECK (length(reason) BETWEEN 10 AND 2000),
  overridden_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX score_overrides_interview ON score_overrides(interview_id, id DESC);

CREATE TABLE comments (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interview_id  uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  position      integer,                               -- answer number, or null for the whole interview
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  author_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_interview ON comments(interview_id, id);

-- Candidate requests, tracked to closure. They survive the candidate's deletion (candidate_id set null)
-- so the company can show it handled them.
CREATE TABLE rights_requests (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id  uuid REFERENCES candidates(id) ON DELETE SET NULL,
  candidate_ref text NOT NULL,                         -- name + masked contact, kept after deletion
  kind          rights_kind NOT NULL,
  details       text CHECK (length(details) <= 2000),
  status        rights_status NOT NULL DEFAULT 'open',
  due_at        timestamptz NOT NULL,
  resolution    text,
  handled_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);
CREATE INDEX rights_requests_open ON rights_requests(tenant_id, status, due_at);

-- Retention: when the 48-hour deletion notice went out, and when data must be gone.
ALTER TABLE candidates
  ADD COLUMN delete_after      timestamptz,
  ADD COLUMN deletion_notified_at timestamptz;

-- What was deleted and when (no personal data), as proof that erasure happened.
CREATE TABLE deletion_log (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reason        text NOT NULL,                         -- 'retention' | 'withdrawn' | 'request'
  candidates    integer NOT NULL,
  files         integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['decisions', 'score_overrides', 'comments', 'rights_requests', 'deletion_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (is_super_admin() OR tenant_id = current_tenant_id())
                    WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON decisions, score_overrides, comments, deletion_log TO app_user;   -- history is never rewritten
GRANT SELECT, INSERT, UPDATE ON rights_requests TO app_user;
GRANT USAGE ON SEQUENCE decisions_id_seq, score_overrides_id_seq, comments_id_seq, rights_requests_id_seq, deletion_log_id_seq TO app_user;
-- Deletion removes candidates (cascading to interviews, answers, scores…) and their consent records.
GRANT DELETE ON candidates, consent_records TO app_user;

-- Existing completed interviews get a deletion date from their tenant's retention period.
UPDATE candidates c SET delete_after = iv.completed_at + make_interval(days => l.retention_days)
FROM interviews iv, tenant_limits l
WHERE iv.candidate_id = c.id AND l.tenant_id = c.tenant_id AND iv.completed_at IS NOT NULL;
