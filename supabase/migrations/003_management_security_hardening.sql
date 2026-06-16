begin;

create table if not exists public.management_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'manager' check (role in ('admin', 'manager', 'accounting')),
  active boolean not null default true,
  force_password_change boolean not null default false,
  mfa_required boolean not null default false,
  mfa_enrolled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.management_users add column if not exists mfa_required boolean not null default false;
alter table public.management_users add column if not exists mfa_enrolled_at timestamptz;

create table if not exists public.management_user_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  requested_role text not null default 'manager' check (requested_role in ('admin', 'manager', 'accounting')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  notes text not null default ''
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  action text not null,
  record_type text not null,
  record_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  resident_name text not null,
  internal_name text not null,
  gl_code text not null,
  description text not null,
  category text not null,
  price_cents integer not null check (price_cents >= 0),
  inventory integer not null default 0 check (inventory >= 0),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  resident_name text not null,
  unit_number text not null,
  email text not null,
  phone text,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  processing_fee_cents integer not null default 0 check (processing_fee_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  status text not null default 'Received' check (status in ('Received', 'Processing', 'Ready for Pickup', 'Completed', 'Cancelled')),
  public_note text not null default '',
  internal_note text not null default '',
  payment_status text not null default 'Pending',
  square_payment_id text,
  payment_at timestamptz,
  legal_accepted boolean not null default false,
  legal_accepted_at timestamptz,
  legal_notice_version text,
  terms_version text,
  privacy_policy_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text references public.products(id),
  resident_name_snapshot text not null,
  internal_name_snapshot text not null,
  gl_code_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  resident_name text not null,
  unit_number text not null,
  email text,
  category text not null,
  message text not null,
  status text not null default 'New' check (status in ('New', 'In Review', 'Answered', 'Closed')),
  management_response text not null default '',
  internal_notes text not null default '',
  submitted_at timestamptz not null default now(),
  responded_at timestamptz
);

create table if not exists public.portal_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  order_number text,
  square_payment_id text,
  status text not null,
  amount_cents integer not null default 0 check (amount_cents >= 0),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_management_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.management_users
    where user_id = (select auth.uid())
      and active = true
      and (
        mfa_required = false
        or coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
      )
  );
$$;

create or replace function public.is_management_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.management_users
    where user_id = (select auth.uid())
      and active = true
      and role = 'admin'
      and (
        mfa_required = false
        or coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
      )
  );
$$;

create or replace function public.approve_management_user(target_email text, target_role text default 'manager')
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_user_id uuid;
begin
  if not public.is_management_admin() then
    raise exception 'Only management admins can approve management users.';
  end if;
  if target_role not in ('admin', 'manager', 'accounting') then
    raise exception 'Invalid management role.';
  end if;
  select id into target_user_id
  from auth.users
  where lower(email) = lower(target_email)
  limit 1;
  if target_user_id is null then
    raise exception 'Supabase Auth user not found for %', target_email;
  end if;
  insert into public.management_users (user_id, email, role, active, force_password_change)
  values (target_user_id, lower(target_email), target_role, true, true)
  on conflict (user_id) do update
  set email = excluded.email,
      role = excluded.role,
      active = true,
      force_password_change = true,
      updated_at = now();
  update public.management_user_requests
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by = (select auth.uid())
  where lower(email) = lower(target_email)
    and status = 'pending';
  insert into public.audit_logs (actor_user_id, action, record_type, record_id, after_data)
  values ((select auth.uid()), 'management_user_approved', 'management_user', target_user_id::text, jsonb_build_object('email', lower(target_email), 'role', target_role));
  return target_user_id;
end;
$$;

create or replace function public.disable_management_user(target_email text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_user_id uuid;
begin
  if not public.is_management_admin() then
    raise exception 'Only management admins can disable management users.';
  end if;
  select user_id into target_user_id
  from public.management_users
  where lower(email) = lower(target_email)
  limit 1;
  if target_user_id is null then
    raise exception 'Management user not found for %', target_email;
  end if;
  update public.management_users
  set active = false,
      updated_at = now()
  where user_id = target_user_id;
  insert into public.audit_logs (actor_user_id, action, record_type, record_id, after_data)
  values ((select auth.uid()), 'management_user_disabled', 'management_user', target_user_id::text, jsonb_build_object('email', lower(target_email)));
end;
$$;

revoke all on function public.is_management_user() from public;
revoke all on function public.is_management_admin() from public;
revoke all on function public.approve_management_user(text, text) from public;
revoke all on function public.disable_management_user(text) from public;
grant execute on function public.is_management_user() to authenticated;
grant execute on function public.is_management_admin() to authenticated;
grant execute on function public.approve_management_user(text, text) to authenticated;
grant execute on function public.disable_management_user(text) to authenticated;

alter table public.management_users enable row level security;
alter table public.management_user_requests enable row level security;
alter table public.audit_logs enable row level security;
alter table public.payment_events enable row level security;
alter table if exists public.products enable row level security;
alter table if exists public.orders enable row level security;
alter table if exists public.order_items enable row level security;
alter table if exists public.feedback enable row level security;
alter table if exists public.portal_settings enable row level security;

drop policy if exists "Management users can read their own approval" on public.management_users;
create policy "Management users can read their own approval"
on public.management_users for select
to authenticated
using (user_id = (select auth.uid()) or public.is_management_admin());

drop policy if exists "Management users can clear their password flag" on public.management_users;
create policy "Management users can clear their password flag"
on public.management_users for update
to authenticated
using (user_id = (select auth.uid()) and active = true)
with check (user_id = (select auth.uid()) and active = true);

drop policy if exists "Management admins can manage approvals" on public.management_users;
create policy "Management admins can manage approvals"
on public.management_users for all
to authenticated
using (public.is_management_admin())
with check (public.is_management_admin());

drop policy if exists "Anyone can request management review" on public.management_user_requests;
create policy "Anyone can request management review"
on public.management_user_requests for insert
to anon, authenticated
with check (status = 'pending');

drop policy if exists "Management admins can review access requests" on public.management_user_requests;
create policy "Management admins can review access requests"
on public.management_user_requests for all
to authenticated
using (public.is_management_admin())
with check (public.is_management_admin());

drop policy if exists "Management can read audit logs" on public.audit_logs;
create policy "Management can read audit logs"
on public.audit_logs for select
to authenticated
using (public.is_management_user());

drop policy if exists "Management can create audit logs" on public.audit_logs;
create policy "Management can create audit logs"
on public.audit_logs for insert
to authenticated
with check (public.is_management_user() and actor_user_id = (select auth.uid()));

drop policy if exists "Management can access payment events" on public.payment_events;
create policy "Management can access payment events"
on public.payment_events for all
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

drop policy if exists "Residents can read active products" on public.products;
create policy "Residents can read active products"
on public.products for select
to anon, authenticated
using (active = true or public.is_management_user());

drop policy if exists "Management can insert products" on public.products;
create policy "Management can insert products"
on public.products for insert
to authenticated
with check (public.is_management_user());

drop policy if exists "Management can update products" on public.products;
create policy "Management can update products"
on public.products for update
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

drop policy if exists "Management can delete products" on public.products;
create policy "Management can delete products"
on public.products for delete
to authenticated
using (public.is_management_user());

drop policy if exists "Management can access orders" on public.orders;
create policy "Management can access orders"
on public.orders for all
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

drop policy if exists "Management can access order items" on public.order_items;
create policy "Management can access order items"
on public.order_items for all
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

drop policy if exists "Management can access feedback" on public.feedback;
create policy "Management can access feedback"
on public.feedback for all
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

drop policy if exists "Residents can submit feedback" on public.feedback;
create policy "Residents can submit feedback"
on public.feedback for insert
to anon
with check (
  status = 'New'
  and management_response = ''
  and internal_notes = ''
  and responded_at is null
);

drop policy if exists "Management can access settings" on public.portal_settings;
create policy "Management can access settings"
on public.portal_settings for all
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

revoke all on public.management_users from anon, authenticated;
grant select on public.management_users to authenticated;
grant update (force_password_change) on public.management_users to authenticated;

revoke all on public.management_user_requests from anon, authenticated;
grant insert on public.management_user_requests to anon, authenticated;
grant select, update, delete on public.management_user_requests to authenticated;

revoke all on public.audit_logs from anon, authenticated;
grant select, insert on public.audit_logs to authenticated;

revoke all on public.payment_events from anon, authenticated;
grant select, insert, update on public.payment_events to authenticated;

revoke all on public.products from anon, authenticated;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

revoke all on public.orders from anon, authenticated;
grant select, insert, update, delete on public.orders to authenticated;

revoke all on public.order_items from anon, authenticated;
grant select, insert, update, delete on public.order_items to authenticated;

revoke all on public.feedback from anon, authenticated;
grant insert on public.feedback to anon;
grant select, insert, update, delete on public.feedback to authenticated;

revoke all on public.portal_settings from anon, authenticated;
grant select, insert, update, delete on public.portal_settings to authenticated;

insert into public.management_users (user_id, email, role, active, force_password_change)
select id, lower(email), 'admin', true, false
from auth.users
where lower(email) = 'admin@brickellhouse.net'
on conflict (user_id) do update
set email = excluded.email,
    role = 'admin',
    active = true,
    updated_at = now();

commit;
