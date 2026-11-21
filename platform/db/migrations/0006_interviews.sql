-- Interviews: consent records, the question plan each candidate gets, their recorded answers, and the
-- transcription queue the office GPU workers pull from.

CREATE TYPE interview_status AS ENUM ('in_progress', 'completed', 'abandoned');
CREATE TYPE transcription_status AS ENUM ('queued', 'leased', 'done', 'failed');

-- Proof of notice and consent (DPDP Section 6): which notice version, in which language, when, from where.
CREATE TABLE consent_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id      uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  invitation_id     uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  consent_text_id   uuid NOT NULL REFERENCES consent_texts(id),
  language          text NOT NULL,
  age_confirmed     boolean NOT NULL,
  accepted_at       timestamptz NOT NULL DEFAULT now(),
  withdrawn_at      timestamptz,
  ip                text,
  user_agent        text
);

CREATE TABLE interviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id             uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id       uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  invitation_id      uuid NOT NULL UNIQUE REFERENCES invitations(id) ON DELETE CASCADE,
  consent_record_id  uuid NOT NULL REFERENCES consent_records(id),
  bank_version_id    uuid NOT NULL REFERENCES question_bank_versions(id),
  rubric_id          uuid NOT NULL REFERENCES rubrics(id),
  language           text NOT NULL,
  answer_seconds     integer NOT NULL,
  status             interview_status NOT NULL DEFAULT 'in_progress',
  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);
CREATE INDEX interviews_job ON interviews(job_id, status);

-- The questions drawn for this interview, in the order they are asked.
CREATE TABLE interview_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interview_id  uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  position      integer NOT NULL,
  question_id   uuid NOT NULL REFERENCES questions(id),
  UNIQUE (interview_id, position)
);

-- One answer per question; a re-record replaces the audio (attempt 2) and re-queues transcription.
CREATE TABLE answers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interview_question_id  uuid NOT NULL UNIQUE REFERENCES interview_questions(id) ON DELETE CASCADE,
  attempt                integer NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 2),
  storage_key            text NOT NULL,
  mime_type              text NOT NULL,
  size_bytes             integer NOT NULL,
  duration_ms            integer NOT NULL,
  uploaded_at            timestamptz NOT NULL DEFAULT now(),
  transcript             text,
  asr_language           text,
  asr_model              text,
  asr_confidence         real,          -- 0..1, mean token probability
  low_confidence         boolean,       -- flagged for a human to listen; never auto-rejected
  metrics                jsonb,         -- speech_seconds, pauses, words_per_minute, fillers, …
  transcribed_at         timestamptz
);

-- Work queue for the office transcription PCs. Workers lease a job for a few minutes; if they die,
-- the lease expires and another worker picks it up. Nothing is lost.
CREATE TABLE transcription_jobs (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  answer_id     uuid NOT NULL UNIQUE REFERENCES answers(id) ON DELETE CASCADE,
  status        transcription_status NOT NULL DEFAULT 'queued',
  attempts      integer NOT NULL DEFAULT 0,
  leased_until  timestamptz,
  worker_id     uuid,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX transcription_jobs_ready ON transcription_jobs(created_at) WHERE status IN ('queued', 'leased');

-- Transcription workers belong to the platform (they serve every tenant), so no tenant_id / RLS here;
-- only the worker API and the super admin touch this table.
CREATE TABLE workers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  disabled      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  info          jsonb NOT NULL DEFAULT '{}'      -- model, device, version reported by the worker
);
GRANT SELECT, INSERT, UPDATE ON workers TO app_user;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consent_records', 'interviews', 'interview_questions', 'answers', 'transcription_jobs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (is_super_admin() OR tenant_id = current_tenant_id())
                    WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_user', t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE transcription_jobs_id_seq TO app_user;
GRANT DELETE ON answers TO app_user;
-- Consent records are evidence: the app may add them and mark withdrawal, never rewrite or delete them.
REVOKE UPDATE ON consent_records FROM app_user;
GRANT UPDATE (withdrawn_at) ON consent_records TO app_user;
