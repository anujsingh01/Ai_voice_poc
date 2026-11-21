-- Calibration (plan section 5C): recruiters rate interviews blind (without seeing the AI score) so the
-- platform can measure how closely the AI agrees with them before go-live, and again every month.

CREATE TABLE calibration_ratings (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interview_id  uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  rater_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dimensions    jsonb NOT NULL,          -- { key: 1–5 }
  shortlist     boolean NOT NULL,        -- would this rater shortlist the candidate?
  notes         text CHECK (length(notes) <= 2000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_id, rater_id)
);
CREATE INDEX calibration_ratings_tenant ON calibration_ratings(tenant_id, interview_id);

ALTER TABLE calibration_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON calibration_ratings USING (is_super_admin() OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON calibration_ratings TO app_user;
GRANT USAGE ON SEQUENCE calibration_ratings_id_seq TO app_user;
