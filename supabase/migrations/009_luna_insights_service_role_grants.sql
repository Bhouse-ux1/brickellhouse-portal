begin;

grant usage on schema public to service_role;

grant insert, select, delete on table public.luna_insights to service_role;
grant select on table public.management_users to service_role;

commit;
