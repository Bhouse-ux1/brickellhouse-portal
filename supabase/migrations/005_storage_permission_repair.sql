begin;

grant usage on schema public to anon, authenticated, service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public
grant all privileges on tables to service_role;

alter default privileges in schema public
grant all privileges on sequences to service_role;

grant insert on table public.feedback to anon, authenticated;
grant select, update, delete on table public.feedback to authenticated;

grant select, insert, update, delete on table public.orders to authenticated;
grant select, insert, update, delete on table public.order_items to authenticated;
grant select, insert, update on table public.payment_events to authenticated;
grant select, insert, update, delete on table public.products to authenticated;
grant select, insert, update, delete on table public.portal_settings to authenticated;
grant select, insert on table public.audit_logs to authenticated;

alter table public.feedback enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_events enable row level security;

drop policy if exists "Residents can submit feedback" on public.feedback;
create policy "Residents can submit feedback"
on public.feedback
for insert
to anon, authenticated
with check (
  status = 'New'
  and coalesce(management_response, '') = ''
  and coalesce(internal_notes, '') = ''
  and responded_at is null
);

drop policy if exists "Management can access feedback" on public.feedback;
create policy "Management can access feedback"
on public.feedback
for all
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

drop policy if exists "Management can access orders" on public.orders;
create policy "Management can access orders"
on public.orders
for all
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

drop policy if exists "Management can access order items" on public.order_items;
create policy "Management can access order items"
on public.order_items
for all
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

drop policy if exists "Management can access payment events" on public.payment_events;
create policy "Management can access payment events"
on public.payment_events
for all
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

commit;
