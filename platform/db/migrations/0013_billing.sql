-- Online billing with Razorpay Subscriptions: tenants pick a plan, pay by card / UPI AutoPay / netbanking
-- mandate on Razorpay's page, and are charged automatically every period. Razorpay tells us what happened
-- through signed webhooks; this schema records it.

-- Plans the tenant admin may choose and pay for themselves (others are assigned by platform staff).
ALTER TABLE plans ADD COLUMN self_serve boolean NOT NULL DEFAULT false;
-- Razorpay plans can't change price, so we remember which Razorpay plan matches which price.
ALTER TABLE plans ADD COLUMN razorpay_plan_id text, ADD COLUMN razorpay_plan_price_inr integer;

-- How a tenant pays: 'manual' (assigned by staff, invoiced outside the platform: the default, so existing
-- tenants are untouched) or 'razorpay'. Only Razorpay tenants are suspended or reactivated by payments.
CREATE TYPE billing_mode AS ENUM ('manual', 'razorpay');
ALTER TABLE tenants
  ADD COLUMN billing_mode          billing_mode NOT NULL DEFAULT 'manual',
  ADD COLUMN suspended_for_billing boolean NOT NULL DEFAULT false,   -- a payment lifts only this kind of suspension
  ADD COLUMN billing_name          text,
  ADD COLUMN billing_email         text,
  ADD COLUMN billing_phone         text,
  ADD COLUMN gstin                 text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$'),
  ADD COLUMN billing_address       text;

-- One row per Razorpay subscription (a tenant has at most one live one, plus possibly one scheduled
-- to start when the current period ends, after a plan change).
CREATE TABLE billing_subscriptions (
  id                        bigserial PRIMARY KEY,
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id                   uuid NOT NULL REFERENCES plans(id),
  razorpay_subscription_id  text NOT NULL UNIQUE,
  status                    text NOT NULL DEFAULT 'created',   -- Razorpay's: created, authenticated, active, pending, halted, cancelled, completed, expired, paused
  price_inr                 integer NOT NULL,
  billing_period            billing_period NOT NULL,
  checkout_url              text,                              -- Razorpay's hosted payment page
  starts_at                 timestamptz,                       -- first charge (after a trial or the current period)
  current_start             timestamptz,
  current_end               timestamptz,
  cancel_at_period_end      boolean NOT NULL DEFAULT false,
  created_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_subscriptions_tenant ON billing_subscriptions(tenant_id, created_at DESC);

CREATE TABLE billing_payments (
  id                    bigserial PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id       bigint REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
  razorpay_payment_id   text NOT NULL UNIQUE,
  razorpay_invoice_id   text,
  invoice_url           text,
  amount_inr            numeric(12, 2) NOT NULL,
  status                text NOT NULL,                         -- captured | failed | refunded
  method                text,                                  -- card, upi, netbanking, …
  error                 text,
  period_start          timestamptz,
  period_end            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_payments_tenant ON billing_payments(tenant_id, created_at DESC);

-- Webhook deliveries already handled (Razorpay retries, and may send one event more than once).
CREATE TABLE billing_webhook_events (
  event_id     text PRIMARY KEY,
  event        text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

-- Tenants can read their own billing; only the platform context (webhooks, staff, and billing actions
-- after their own permission check) writes it.
ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON billing_subscriptions USING (is_super_admin() OR tenant_id = current_tenant_id()) WITH CHECK (is_super_admin());
CREATE POLICY tenant_read ON billing_payments USING (is_super_admin() OR tenant_id = current_tenant_id()) WITH CHECK (is_super_admin());
GRANT SELECT, INSERT, UPDATE ON billing_subscriptions, billing_payments TO app_user;
GRANT USAGE ON SEQUENCE billing_subscriptions_id_seq, billing_payments_id_seq TO app_user;
GRANT SELECT, INSERT, DELETE ON billing_webhook_events TO app_user;

-- The tenant layout needs to know whether a suspension is for non-payment (it points admins to Billing).
DROP FUNCTION tenant_by_slug(text);
CREATE FUNCTION tenant_by_slug(p_slug text)
RETURNS TABLE (id uuid, slug text, name text, status tenant_status, trial_ends_at timestamptz, suspended_for_billing boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, slug, name, status, trial_ends_at, suspended_for_billing FROM tenants WHERE slug = p_slug
$$;
REVOKE ALL ON FUNCTION tenant_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_by_slug(text) TO app_user;
