-- Candidates have no account: their personal link carries a token whose hash identifies the invitation.
-- Before we know the tenant, this narrow function resolves a token hash to what the landing page shows.
CREATE FUNCTION invitation_by_token(p_token_hash text)
RETURNS TABLE (invitation_id uuid, tenant_id uuid, tenant_name text, tenant_status tenant_status,
               candidate_name text, job_title text, job_status job_status, languages text[],
               status invitation_status, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, t.id, t.name, t.status, c.name, j.title, j.status, j.languages, i.status, i.expires_at
  FROM invitations i
  JOIN candidates c ON c.id = i.candidate_id
  JOIN jobs j ON j.id = c.job_id
  JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token_hash = p_token_hash
$$;
REVOKE ALL ON FUNCTION invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invitation_by_token(text) TO app_user;
