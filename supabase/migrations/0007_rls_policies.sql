-- supabase/migrations/0007_rls_policies.sql
create or replace function current_user_role() returns text
language sql stable security definer as $$
  select role_id from app_users where id = auth.uid();
$$;

create or replace function current_user_sees_all_shops() returns boolean
language sql stable security definer as $$
  select current_user_role() = 'admin'
    or coalesce((select sees_all_shops from app_users where id = auth.uid()), false);
$$;

create or replace function current_user_shops() returns setof text
language sql stable security definer as $$
  select id from shops where current_user_sees_all_shops()
  union
  select shop_id from user_shop_access where user_id = auth.uid();
$$;

create or replace function current_user_can(cap text) returns boolean
language sql stable security definer as $$
  select current_user_role() = 'admin' or coalesce((
    select allowed from role_permissions
    where role_id = current_user_role() and permission_type = 'module_capability' and permission_key = cap
  ), false);
$$;

create or replace function current_user_has_nav(nav_key text) returns boolean
language sql stable security definer as $$
  select current_user_role() = 'admin' or coalesce((
    select allowed from role_permissions
    where role_id = current_user_role() and permission_type = 'nav' and permission_key = nav_key
  ), false);
$$;

-- shop-scoped operational tables
alter table tickets enable row level security;
create policy tickets_rw on tickets for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()) and current_user_has_nav('list'));

alter table ticket_items enable row level security;
create policy ticket_items_rw on ticket_items for all
  using (ticket_id in (select id from tickets where shop_id in (select current_user_shops())))
  with check (ticket_id in (select id from tickets where shop_id in (select current_user_shops())));

alter table ticket_item_positions enable row level security;
create policy ticket_item_positions_rw on ticket_item_positions for all
  using (ticket_item_id in (
    select ti.id from ticket_items ti join tickets t on t.id = ti.ticket_id
    where t.shop_id in (select current_user_shops())
  ));

alter table ticket_payments enable row level security;
create policy ticket_payments_rw on ticket_payments for all
  using (ticket_id in (select id from tickets where shop_id in (select current_user_shops())));

alter table ticket_status_history enable row level security;
create policy ticket_status_history_rw on ticket_status_history for all
  using (ticket_id in (select id from tickets where shop_id in (select current_user_shops())));

alter table orders enable row level security;
create policy orders_rw on orders for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()) and current_user_has_nav('wholesale'));

alter table order_items enable row level security;
create policy order_items_rw on order_items for all
  using (order_id in (select id from orders where shop_id in (select current_user_shops())));

alter table order_returns enable row level security;
create policy order_returns_rw on order_returns for all
  using (order_id in (select id from orders where shop_id in (select current_user_shops())));

alter table order_payments enable row level security;
create policy order_payments_rw on order_payments for all
  using (order_id in (select id from orders where shop_id in (select current_user_shops())));

alter table order_adjustments enable row level security;
create policy order_adjustments_rw on order_adjustments for all
  using (order_id in (select id from orders where shop_id in (select current_user_shops())));

alter table stock enable row level security;
create policy stock_rw on stock for all
  using (shop_id in (select current_user_shops()))
  with check (shop_id in (select current_user_shops()));

alter table withdrawals enable row level security;
create policy withdrawals_rw on withdrawals for all
  using (shop_id in (select current_user_shops()));

alter table commission_rules enable row level security;
create policy commission_rules_rw on commission_rules for all
  using (shop_id is null or shop_id in (select current_user_shops()));

alter table commission_rule_teams enable row level security;
create policy commission_rule_teams_rw on commission_rule_teams for all
  using (commission_rule_id in (
    select id from commission_rules where shop_id is null or shop_id in (select current_user_shops())
  ));

alter table expenses enable row level security;
create policy expenses_rw on expenses for all
  using (shop_id in (select current_user_shops()));

alter table petty_cash enable row level security;
create policy petty_cash_rw on petty_cash for all
  using (shop_id in (select current_user_shops()));

-- Freely readable/insertable by any authenticated user (matches today's UI, where any
-- role filling out a form can add a new dropdown option). Editing/deleting shared
-- status/permission config stays gated to whoever the Permissions module's nav
-- permission allows (default: admin only), mirroring the prototype's existing nav gate.
alter table option_lists enable row level security;
create policy option_lists_select on option_lists for select using (auth.uid() is not null);
create policy option_lists_write on option_lists for insert with check (auth.uid() is not null);
create policy option_lists_modify on option_lists for update using (auth.uid() is not null);
create policy option_lists_delete on option_lists for delete using (auth.uid() is not null);

alter table statuses enable row level security;
create policy statuses_select on statuses for select using (auth.uid() is not null);
create policy statuses_write on statuses for insert with check (current_user_has_nav('permissions'));
create policy statuses_modify on statuses for update using (current_user_has_nav('permissions'));
create policy statuses_delete on statuses for delete using (current_user_has_nav('permissions'));

alter table ws_statuses enable row level security;
create policy ws_statuses_select on ws_statuses for select using (auth.uid() is not null);
create policy ws_statuses_write on ws_statuses for all using (current_user_has_nav('permissions'));

alter table roles enable row level security;
create policy roles_select on roles for select using (auth.uid() is not null);
create policy roles_write on roles for insert with check (current_user_has_nav('permissions'));
create policy roles_modify on roles for update using (current_user_has_nav('permissions'));

alter table role_permissions enable row level security;
create policy role_permissions_select on role_permissions for select using (auth.uid() is not null);
create policy role_permissions_write on role_permissions for all using (current_user_has_nav('permissions'));

alter table shop_info enable row level security;
create policy shop_info_select on shop_info for select using (auth.uid() is not null);
create policy shop_info_write on shop_info for update using (current_user_has_nav('permissions'));

alter table shops enable row level security;
create policy shops_select on shops for select using (auth.uid() is not null);

alter table app_users enable row level security;
create policy app_users_select on app_users for select using (auth.uid() is not null);
create policy app_users_write on app_users for all using (current_user_has_nav('permissions'));

alter table user_shop_access enable row level security;
create policy user_shop_access_select on user_shop_access for select using (auth.uid() is not null);
create policy user_shop_access_write on user_shop_access for all using (current_user_has_nav('permissions'));

alter table car_models enable row level security;
create policy car_models_rw on car_models for all using (auth.uid() is not null);
alter table price_matrix enable row level security;
create policy price_matrix_rw on price_matrix for all using (auth.uid() is not null);
alter table film_price_matrix enable row level security;
create policy film_price_matrix_rw on film_price_matrix for all using (auth.uid() is not null);
alter table corporate_buyers enable row level security;
create policy corporate_buyers_rw on corporate_buyers for all using (auth.uid() is not null);
alter table retail_customers enable row level security;
create policy retail_customers_rw on retail_customers for all using (auth.uid() is not null);
alter table wholesale_customers enable row level security;
create policy wholesale_customers_rw on wholesale_customers for all using (auth.uid() is not null);
