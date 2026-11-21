-- Tenant setup: jobs, versioned question banks with per-language audio, versioned rubrics and consent
-- notices, candidates, invitations and an outbox of messages to send. Every table is tenant-scoped with RLS.

CREATE TYPE job_status AS ENUM ('draft', 'active', 'closed');
CREATE TYPE question_type AS ENUM ('question', 'objection');
CREATE TYPE invitation_status AS ENUM ('pending', 'opened', 'completed', 'expired', 'revoked');
CREATE TYPE message_channel AS ENUM ('sms', 'whatsapp', 'email');
CREATE TYPE message_status AS ENUM ('queued', 'sent', 'failed');

-- A bank is a named set of questions; each Excel upload creates a new immutable version.
CREATE TABLE question_banks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE question_bank_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bank_id      uuid NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  file_name    text,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_id, version)
);

CREATE TABLE questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_id      uuid NOT NULL REFERENCES question_bank_versions(id) ON DELETE CASCADE,
  code            text NOT NULL,                    -- question_id from the sheet, e.g. Q07
  type            question_type NOT NULL,
  category        text NOT NULL,
  weight          integer NOT NULL CHECK (weight BETWEEN 1 AND 5),
  texts           jsonb NOT NULL,                   -- { "hi": "...", "en": "...", "ta": "..." }
  good_answer     text NOT NULL,
  average_answer  text NOT NULL,
  poor_answer     text NOT NULL,
  must_mention    text[] NOT NULL DEFAULT '{}',
  knockout        boolean NOT NULL DEFAULT false,
  knockout_rule   text,
  position        integer NOT NULL,
  UNIQUE (version_id, code),
  CHECK (NOT knockout OR knockout_rule IS NOT NULL)
);

-- Recorded question audio belongs to the bank + question code + language, so it carries over to new
-- versions of the bank as long as the question keeps its code.
CREATE TABLE question_audio (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bank_id      uuid NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
  code         text NOT NULL,
  language     text NOT NULL,
  storage_key  text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   integer NOT NULL,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_id, code, language)
);

CREATE TABLE jobs (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title                      text NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  location                   text,
  description                text,
  status                     job_status NOT NULL DEFAULT 'draft',
  languages                  text[] NOT NULL,
  bank_id                    uuid REFERENCES question_banks(id) ON DELETE SET NULL,
  questions_per_interview    integer NOT NULL DEFAULT 6 CHECK (questions_per_interview BETWEEN 1 AND 20),
  objections_per_interview   integer NOT NULL DEFAULT 3 CHECK (objections_per_interview BETWEEN 0 AND 10),
  answer_seconds             integer NOT NULL DEFAULT 90 CHECK (answer_seconds BETWEEN 30 AND 300),
  invite_valid_days          integer NOT NULL DEFAULT 7 CHECK (invite_valid_days BETWEEN 1 AND 30),
  created_by                 uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_tenant ON jobs(tenant_id, status);

-- Scoring rubric per job. Each save is a new version; scores record the version they used.
CREATE TABLE rubrics (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id            uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  version           integer NOT NULL,
  dimensions        jsonb NOT NULL,     -- [{ key, label, weight, source: 'ai' | 'measured' }]
  shortlist_cutoff  integer NOT NULL CHECK (shortlist_cutoff BETWEEN 0 AND 100),
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, version)
);

-- Privacy notice + consent wording shown and played to candidates (DPDP Rule 3). Versioned per tenant.
CREATE TABLE consent_texts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  texts       jsonb NOT NULL,           -- { "hi": "...", "en": "..." }
  grievance_contact text NOT NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version)
);

CREATE TABLE candidates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name        text NOT NULL,
  phone       text,                     -- E.164, e.g. +919876543210
  email       text,
  language    text,                     -- preferred interview language, if known
  source      text NOT NULL DEFAULT 'import',
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX candidates_job_phone ON candidates(job_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX candidates_job_email ON candidates(job_id, email) WHERE email IS NOT NULL;

CREATE TABLE invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id  uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,   -- only the hash; the link itself goes out in the message
  status        invitation_status NOT NULL DEFAULT 'pending',
  expires_at    timestamptz NOT NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_candidate ON invitations(candidate_id);
CREATE INDEX invitations_tenant_month ON invitations(tenant_id, created_at);

-- Messages waiting for (or handed to) the SMS / WhatsApp / email provider.
CREATE TABLE outbox (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel     message_channel NOT NULL,
  to_address  text NOT NULL,
  subject     text,
  body        text NOT NULL,
  status      message_status NOT NULL DEFAULT 'queued',
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX outbox_queued ON outbox(status, created_at) WHERE status = 'queued';

-- ---------- Row-level security: one policy shape for every tenant-owned table ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['question_banks', 'question_bank_versions', 'questions', 'question_audio', 'jobs',
                           'rubrics', 'consent_texts', 'candidates', 'invitations', 'outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (is_super_admin() OR tenant_id = current_tenant_id())
                    WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE outbox_id_seq TO app_user;

-- Versions and their questions are immutable once saved (past interviews keep the version they used).
REVOKE UPDATE, DELETE ON question_bank_versions, questions, rubrics, consent_texts FROM app_user;
