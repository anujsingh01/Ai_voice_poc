-- Foundation: tenants, their limits, users, roles, sessions, audit log.
--
-- Tenant isolation is enforced by PostgreSQL row-level security (RLS), not only by application code.
-- The app connects as `app_user`, which does not own the tables, so RLS always applies to it.
-- Each request runs in a transaction that sets:
--   app.tenant_id       the tenant the request acts for (empty = none)
--   app.is_super_admin  'on' only for the platform owner
-- With neither set, tenant-scoped tables return no rows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION is_super_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.is_super_admin', true), '') = 'on' $$;

CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'trial');
CREATE TYPE member_role AS ENUM ('tenant_admin', 'recruiter', 'reviewer');
CREATE TYPE scoring_mode AS ENUM ('fast', 'batch');

CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  status        tenant_status NOT NULL DEFAULT 'active',
  trial_ends_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'trial' OR trial_ends_at IS NOT NULL)
);

CREATE TABLE tenant_limits (
  tenant_id             uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  interviews_per_month  integer NOT NULL DEFAULT 1000  CHECK (interviews_per_month >= 0),
  concurrent_jobs       integer NOT NULL DEFAULT 5     CHECK (concurrent_jobs >= 0),
  recruiter_seats       integer NOT NULL DEFAULT 5     CHECK (recruiter_seats >= 0),
  languages             text[]  NOT NULL DEFAULT ARRAY['hi', 'en'],
  ai_budget_inr         integer NOT NULL DEFAULT 5000  CHECK (ai_budget_inr >= 0),
  scoring_mode          scoring_mode NOT NULL DEFAULT 'fast',
  retention_days        integer NOT NULL DEFAULT 180   CHECK (retention_days BETWEEN 1 AND 730),
  own_openai_key        boolean NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Users are global: one person can belong to several tenants through memberships.
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE CHECK (email = lower(email)),
  name            text NOT NULL,
  password_hash   text,                          -- null until the user sets a password
  is_super_admin  boolean NOT NULL DEFAULT false,
  totp_secret     text,
  totp_enabled    boolean NOT NULL DEFAULT false,
  disabled        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        member_role NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);

-- Only a SHA-256 hash of each session token is stored, so a database leak does not leak sessions.
CREATE TABLE sessions (
  token_hash          text PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  two_factor_passed   boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  ip                  text,
  user_agent          text
);
CREATE INDEX sessions_user ON sessions(user_id);

-- One-time links to set a password (new users) or reset it.
CREATE TABLE password_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

-- Kept for at least one year (DPDP Rule 6). Append-only for the app.
CREATE TABLE audit_log (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid REFERENCES tenants(id) ON DELETE SET NULL,
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  target         text,
  details        jsonb NOT NULL DEFAULT '{}',
  ip             text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_time ON audit_log(tenant_id, created_at DESC);

-- ---------- Row-level security ----------

ALTER TABLE tenants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log     ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenants
  USING (is_super_admin() OR id = current_tenant_id())
  WITH CHECK (is_super_admin());

CREATE POLICY tenant_isolation ON tenant_limits
  USING (is_super_admin() OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin());

CREATE POLICY tenant_isolation ON memberships
  USING (is_super_admin() OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id());

-- Anyone may append an entry for their own tenant; only the super admin sees platform-level entries.
CREATE POLICY audit_read ON audit_log FOR SELECT
  USING (is_super_admin() OR (tenant_id IS NOT NULL AND tenant_id = current_tenant_id()));
CREATE POLICY audit_append ON audit_log FOR INSERT
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

-- ---------- Application role ----------
-- Created by the migration runner with a password from the environment; here we only grant.
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, tenant_limits, users, memberships, sessions, password_tokens TO app_user;
GRANT SELECT, INSERT ON audit_log TO app_user;           -- no UPDATE/DELETE: the log can't be altered by the app
GRANT USAGE ON SEQUENCE audit_log_id_seq TO app_user;
GRANT EXECUTE ON FUNCTION current_tenant_id(), is_super_admin() TO app_user;
