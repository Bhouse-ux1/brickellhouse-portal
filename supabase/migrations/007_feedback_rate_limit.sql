begin;

alter table public.feedback
add column if not exists phone text,
add column if not exists normalized_email text,
add column if not exists normalized_phone text,
add column if not exists normalized_unit text,
add column if not exists request_ip text;

update public.feedback
set
  normalized_email = nullif(lower(trim(email)), ''),
  normalized_phone = case
    when phone is null or regexp_replace(phone, '\D', '', 'g') = '' then null
    when length(regexp_replace(phone, '\D', '', 'g')) = 10 then '+1' || regexp_replace(phone, '\D', '', 'g')
    when length(regexp_replace(phone, '\D', '', 'g')) = 11 and regexp_replace(phone, '\D', '', 'g') like '1%' then '+' || regexp_replace(phone, '\D', '', 'g')
    else '+' || regexp_replace(phone, '\D', '', 'g')
  end,
  normalized_unit = nullif(upper(regexp_replace(unit_number, '\s+', '', 'g')), '')
where normalized_email is null
   or normalized_phone is null
   or normalized_unit is null;

create index if not exists feedback_rate_limit_email_idx on public.feedback (normalized_email, submitted_at);
create index if not exists feedback_rate_limit_phone_idx on public.feedback (normalized_phone, submitted_at);
create index if not exists feedback_rate_limit_unit_idx on public.feedback (normalized_unit, submitted_at);
create index if not exists feedback_rate_limit_ip_idx on public.feedback (request_ip, submitted_at);

revoke insert on table public.feedback from anon, authenticated;
grant all privileges on table public.feedback to service_role;
grant select, update, delete on table public.feedback to authenticated;

commit;
