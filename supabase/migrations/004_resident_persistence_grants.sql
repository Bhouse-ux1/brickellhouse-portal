begin;

grant usage on schema public to anon, authenticated, service_role;

grant all privileges on table public.orders to service_role;
grant all privileges on table public.order_items to service_role;
grant all privileges on table public.payment_events to service_role;
grant all privileges on table public.feedback to service_role;
grant all privileges on table public.products to service_role;
grant all privileges on table public.portal_settings to service_role;
grant all privileges on table public.audit_logs to service_role;

grant insert on table public.feedback to anon, authenticated;

alter table public.feedback enable row level security;

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

drop policy if exists "Residents cannot read feedback" on public.feedback;
drop policy if exists "Residents cannot update feedback" on public.feedback;
drop policy if exists "Residents cannot delete feedback" on public.feedback;

commit;
