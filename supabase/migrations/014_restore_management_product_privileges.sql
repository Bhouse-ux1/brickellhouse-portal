-- Restore the table privileges required by the existing Management-only product RLS policies.
-- Public catalog reads continue through /api/products; anon receives no direct table access.

begin;

alter table public.products enable row level security;

revoke all privileges on table public.products from public, anon;

grant select, insert, update, delete
on table public.products
to authenticated;

grant all privileges
on table public.products
to service_role;

commit;
