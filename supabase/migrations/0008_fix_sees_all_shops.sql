-- 0008_fix_sees_all_shops.sql
--
-- Fixes a business-logic divergence from the prototype (execution correction C7).
--
-- The prototype computes:
--     canSeeAllShops = admin
--                   || shopAccess === 'all'
--                   || dashboardPermissions[role].seeAllShops
--
-- Migration 0007 implemented only the first two clauses. Because
-- `app_users.sees_all_shops` defaults to false, and the third clause was never
-- read, every `exec` user was silently scoped to their explicitly-granted shops
-- even though the seed sets dashboard_widget/seeAllShops = true for `exec`.
-- That seeded permission row was dead data.
--
-- Fixing it here (rather than by flipping app_users.sees_all_shops in the seed)
-- keeps the behavior config-as-data and editable through the Permissions UI,
-- per spec section 7.
--
-- Must stay in sync with lib/auth/buildSessionContext.ts.

create or replace function current_user_sees_all_shops() returns boolean
language sql stable security definer as $$
  select current_user_role() = 'admin'
    or coalesce((select sees_all_shops from app_users where id = auth.uid()), false)
    or coalesce((
      select allowed
      from role_permissions
      where role_id = current_user_role()
        and permission_type = 'dashboard_widget'
        and permission_key = 'seeAllShops'
    ), false);
$$;
