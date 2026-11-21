-- At login we need "which tenants does this user belong to?" before any tenant is chosen, which RLS
-- would hide. This narrow function answers only that question, for one user id.
CREATE FUNCTION user_memberships(p_user_id uuid)
RETURNS TABLE (tenant_id uuid, slug text, name text, status tenant_status, role member_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, t.name, t.status, m.role
  FROM memberships m JOIN tenants t ON t.id = m.tenant_id
  WHERE m.user_id = p_user_id
  ORDER BY t.name
$$;
REVOKE ALL ON FUNCTION user_memberships(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_memberships(uuid) TO app_user;

-- Same for resolving a tenant from its URL slug.
CREATE FUNCTION tenant_by_slug(p_slug text)
RETURNS TABLE (id uuid, slug text, name text, status tenant_status, trial_ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, slug, name, status, trial_ends_at FROM tenants WHERE slug = p_slug
$$;
REVOKE ALL ON FUNCTION tenant_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_by_slug(text) TO app_user;
