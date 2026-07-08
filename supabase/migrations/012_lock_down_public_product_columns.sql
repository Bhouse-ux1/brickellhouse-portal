-- Lock down product table reads so public residents cannot query internal accounting columns directly.
-- Public catalog access must go through /api/products, which returns only resident-safe fields.
-- Management users keep full product access through authenticated Supabase sessions and RLS.
-- Server-side APIs keep trusted catalog access through the service_role key.

drop policy if exists "Residents can read active products" on public.products;
drop policy if exists "Management can read products" on public.products;

create policy "Management can read products"
on public.products for select
to authenticated
using (public.is_management_user());

revoke select on table public.products from anon;
grant select on table public.products to authenticated;

