-- Subscription plans designed by the platform, assigned to tenants, with history; and platform staff
-- roles under the owner ("sub-admins").

-- ---------- Platform staff ----------
-- Everyone with is_super_admin = true can enter the platform console; platform_role says what they may do.
CREATE TYPE platform_role AS ENUM ('owner', 'admin', 'billing', 'support');
ALTER TABLE users ADD COLUMN platform_role platform_role;
UPDATE users SET platform_role = 'owner' WHERE is_super_admin;
ALTER TABLE users ADD CONSTRAINT platform_role_matches CHECK ((is_super_admin AND platform_role IS NOT NULL) OR (NOT is_super_admin AND platform_role IS NULL));

-- ---------- Plans ----------
CREATE TYPE billing_period AS ENUM ('monthly', 'yearly');

CREATE TABLE plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 60),
  description           text,
  price_inr             integer NOT NULL DEFAULT 0 CHECK (price_inr >= 0),
  billing_period        billing_period NOT NULL DEFAULT 'monthly',
  trial_days            integer NOT NULL DEFAULT 0 CHECK (trial_days BETWEEN 0 AND 90),
  interviews_per_month  integer NOT NULL CHECK (interviews_per_month >= 0),
  concurrent_jobs       integer NOT NULL CHECK (concurrent_jobs >= 0),
  recruiter_seats       integer NOT NULL CHECK (recruiter_seats >= 0),
  languages             text[]  NOT NULL,
  ai_budget_inr         integer NOT NULL CHECK (ai_budget_inr >= 0),
  scoring_mode          scoring_mode NOT NULL DEFAULT 'fast',
  retention_days        integer NOT NULL CHECK (retention_days BETWEEN 1 AND 730),
  own_openai_key        boolean NOT NULL DEFAULT false,
  sort_order            integer NOT NULL DEFAULT 0,
  archived              boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenants ADD COLUMN plan_id uuid REFERENCES plans(id);
-- true when the super admin changed this tenant's limits away from its plan's
ALTER TABLE tenant_limits ADD COLUMN custom boolean NOT NULL DEFAULT false;

-- Every plan change, for billing records and audit.
CREATE TABLE tenant_subscriptions (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id     uuid NOT NULL REFERENCES plans(id),
  price_inr   integer NOT NULL,
  billing_period billing_period NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  changed_by  uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX tenant_subscriptions_tenant ON tenant_subscriptions(tenant_id, started_at DESC);

-- Plans are platform data: only platform staff may change them; tenants may read their own plan.
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY plans_read ON plans FOR SELECT
  USING (is_super_admin() OR id = (SELECT plan_id FROM tenants WHERE id = current_tenant_id()));
CREATE POLICY plans_write ON plans FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_subscriptions
  USING (is_super_admin() OR tenant_id = current_tenant_id()) WITH CHECK (is_super_admin());

GRANT SELECT, INSERT, UPDATE ON plans TO app_user;
GRANT SELECT, INSERT, UPDATE ON tenant_subscriptions TO app_user;
GRANT USAGE ON SEQUENCE tenant_subscriptions_id_seq TO app_user;

-- Starter catalogue (editable in the console). Prices are placeholders to set before selling.
INSERT INTO plans (name, description, price_inr, trial_days, interviews_per_month, concurrent_jobs, recruiter_seats, languages, ai_budget_inr, scoring_mode, retention_days, own_openai_key, sort_order) VALUES
  ('Starter',    'Small teams trying voice screening',           9999, 14,  500,  2,  3, ARRAY['hi','en'],                 500, 'batch', 90,  false, 1),
  ('Growth',     'Regional hiring teams',                       29999, 14, 5000, 10, 10, ARRAY['hi','en','ta','te','kn'], 5000, 'fast', 180, false, 2),
  ('Enterprise', 'High-volume hiring, all languages, own AI key', 99999, 30, 30000, 50, 50,
     ARRAY['hi','en','ta','te','kn','ml','mr','bn','gu','pa','ur','as'], 25000, 'fast', 365, true, 3);
