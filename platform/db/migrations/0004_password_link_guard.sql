-- A tenant admin may issue set-password links only for accounts that belong to their tenant alone.
-- Otherwise one tenant could take over an account that also has access to another tenant (or the
-- super admin). RLS hides other tenants' memberships, so this narrow function answers just that.
CREATE FUNCTION user_is_exclusive_to_tenant(p_user_id uuid, p_tenant_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND is_super_admin)
     AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = p_user_id AND tenant_id <> p_tenant_id)
$$;
REVOKE ALL ON FUNCTION user_is_exclusive_to_tenant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_is_exclusive_to_tenant(uuid, uuid) TO app_user;
