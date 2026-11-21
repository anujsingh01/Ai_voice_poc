-- Account recovery (forgot password, 2-step backup codes) and real SMS / email sending.

-- One-time backup codes for 2-step login, for when the phone is lost. Only hashes are stored.
CREATE TABLE recovery_codes (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recovery_codes_user ON recovery_codes(user_id) WHERE used_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON recovery_codes TO app_user;
GRANT USAGE ON SEQUENCE recovery_codes_id_seq TO app_user;

-- The message sender claims queued rows, retries failures with back-off and records the provider's id.
-- `template` names the message kind; SMS in India must quote the DLT template it was registered under.
ALTER TABLE outbox
  ADD COLUMN template        text,
  ADD COLUMN attempts        int NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN provider_id     text;
DROP INDEX outbox_queued;
CREATE INDEX outbox_queued ON outbox(coalesce(next_attempt_at, created_at)) WHERE status = 'queued';
UPDATE outbox SET template = CASE WHEN body LIKE '%will permanently delete%' THEN 'deletion_notice' ELSE 'invite' END;

-- Development only: the "dev" sending driver puts messages here instead of sending them, and
-- /dev/mailbox shows them. The app refuses to start in production with that driver.
CREATE TABLE dev_mailbox (
  id         bigserial PRIMARY KEY,
  channel    message_channel NOT NULL,
  to_address text NOT NULL,
  subject    text,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON dev_mailbox TO app_user;
GRANT USAGE ON SEQUENCE dev_mailbox_id_seq TO app_user;
