begin;

create extension if not exists pgcrypto;

create table if not exists public.management_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'manager' check (role in ('admin', 'manager', 'accounting')),
  active boolean not null default true,
  force_password_change boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  );
$$;

revoke all on function public.is_management_user() from public;
grant execute on function public.is_management_user() to authenticated;

alter table public.management_users enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.feedback enable row level security;
alter table public.portal_settings enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "Management users can read their own approval" on public.management_users;
create policy "Management users can read their own approval"
on public.management_users for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Management users can clear their password flag" on public.management_users;
create policy "Management users can clear their password flag"
on public.management_users for update
to authenticated
using (user_id = (select auth.uid()) and active = true)
with check (user_id = (select auth.uid()) and active = true);

drop policy if exists "Residents can read active products" on public.products;
create policy "Residents can read active products"
on public.products for select
to anon, authenticated
using (active = true or public.is_management_user());

drop policy if exists "Management can insert products" on public.products;
create policy "Management can insert products"
on public.products for insert to authenticated
with check (public.is_management_user());
drop policy if exists "Management can update products" on public.products;
create policy "Management can update products"
on public.products for update to authenticated
using (public.is_management_user()) with check (public.is_management_user());
drop policy if exists "Management can delete products" on public.products;
create policy "Management can delete products"
on public.products for delete to authenticated
using (public.is_management_user());

drop policy if exists "Management can access orders" on public.orders;
create policy "Management can access orders"
on public.orders for all to authenticated
using (public.is_management_user()) with check (public.is_management_user());

drop policy if exists "Management can access order items" on public.order_items;
create policy "Management can access order items"
on public.order_items for all to authenticated
using (public.is_management_user()) with check (public.is_management_user());

drop policy if exists "Management can access feedback" on public.feedback;
create policy "Management can access feedback"
on public.feedback for all to authenticated
using (public.is_management_user()) with check (public.is_management_user());

drop policy if exists "Residents can submit feedback" on public.feedback;
create policy "Residents can submit feedback"
on public.feedback for insert to anon
with check (
  status = 'New'
  and management_response = ''
  and internal_notes = ''
  and responded_at is null
);

drop policy if exists "Management can access settings" on public.portal_settings;
create policy "Management can access settings"
on public.portal_settings for all to authenticated
using (public.is_management_user()) with check (public.is_management_user());

drop policy if exists "Management can read audit logs" on public.audit_logs;
create policy "Management can read audit logs"
on public.audit_logs for select to authenticated
using (public.is_management_user());
drop policy if exists "Management can create audit logs" on public.audit_logs;
create policy "Management can create audit logs"
on public.audit_logs for insert to authenticated
with check (public.is_management_user() and actor_user_id = (select auth.uid()));

revoke all on public.management_users from anon, authenticated;
grant select on public.management_users to authenticated;
grant update (force_password_change) on public.management_users to authenticated;

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.order_items to authenticated;
grant select, insert, update, delete on public.feedback to authenticated;
grant insert on public.feedback to anon;
grant select, insert, update, delete on public.portal_settings to authenticated;
grant select, insert on public.audit_logs to authenticated;

commit;
