begin;

create table if not exists public.management_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'manager' check (role in ('admin', 'manager', 'accounting')),
  active boolean not null default true,
  force_password_change boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_management_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_management_users_updated_at on public.management_users;
create trigger touch_management_users_updated_at
before update on public.management_users
for each row
execute function public.touch_management_users_updated_at();

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

drop policy if exists "Management users can read their own approval" on public.management_users;
create policy "Management users can read their own approval"
on public.management_users
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Management users can clear their password flag" on public.management_users;
create policy "Management users can clear their password flag"
on public.management_users
for update
to authenticated
using (user_id = (select auth.uid()) and active = true)
with check (user_id = (select auth.uid()) and active = true);

revoke all on public.management_users from anon, authenticated;
grant select on public.management_users to authenticated;
grant update (force_password_change) on public.management_users to authenticated;

insert into public.management_users (user_id, email, role, active, force_password_change)
select
  id,
  lower(email),
  'admin',
  true,
  false
from auth.users
where lower(email) = 'admin@brickellhouse.net'
on conflict (user_id) do update
set
  email = excluded.email,
  role = 'admin',
  active = true,
  updated_at = now();

commit;
