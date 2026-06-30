begin;

create table if not exists public.luna_insights (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  detected_language text not null default 'unknown'
    check (detected_language in ('en', 'es', 'unknown')),
  detected_topic text not null default 'unknown',
  category text not null default 'Unknown',
  confidence integer not null default 0
    check (confidence >= 0 and confidence <= 100),
  clarification_requested boolean not null default false,
  outcome text not null default 'answered'
    check (outcome in ('answered', 'unknown', 'clarification', 'protected', 'error')),
  source text not null default 'model'
    check (source in ('deterministic', 'model', 'error')),
  redacted_question_snippet text
    check (redacted_question_snippet is null or length(redacted_question_snippet) <= 240),
  response_kind text not null default 'answered',
  history_message_count integer not null default 0
    check (history_message_count >= 0),
  privacy_redacted boolean not null default true
);

alter table public.luna_insights drop column if exists question;
alter table public.luna_insights drop column if exists response;
alter table public.luna_insights drop column if exists raw_question;
alter table public.luna_insights drop column if exists raw_response;
alter table public.luna_insights drop column if exists full_conversation;
alter table public.luna_insights drop column if exists full_response;
alter table public.luna_insights drop column if exists resident_email;
alter table public.luna_insights drop column if exists resident_phone;
alter table public.luna_insights drop column if exists resident_unit;
alter table public.luna_insights drop column if exists ip_address;
alter table public.luna_insights drop column if exists user_agent;
alter table public.luna_insights drop column if exists session_id;
alter table public.luna_insights drop column if exists conversation_id;

alter table public.luna_insights add column if not exists detected_language text not null default 'unknown';
alter table public.luna_insights add column if not exists detected_topic text not null default 'unknown';
alter table public.luna_insights add column if not exists category text not null default 'Unknown';
alter table public.luna_insights add column if not exists confidence integer not null default 0;
alter table public.luna_insights add column if not exists clarification_requested boolean not null default false;
alter table public.luna_insights add column if not exists outcome text not null default 'answered';
alter table public.luna_insights add column if not exists source text not null default 'model';
alter table public.luna_insights add column if not exists redacted_question_snippet text;
alter table public.luna_insights add column if not exists response_kind text not null default 'answered';
alter table public.luna_insights add column if not exists history_message_count integer not null default 0;
alter table public.luna_insights add column if not exists privacy_redacted boolean not null default true;

comment on table public.luna_insights is
  'Management-only Luna analytics. Does not store raw conversations, full resident questions, full Luna responses, resident identifiers, IP addresses, or permanent resident memory.';
comment on column public.luna_insights.redacted_question_snippet is
  'Heavily redacted short snippet only for unknown or low-confidence questions. Never raw conversation text.';

create index if not exists idx_luna_insights_created_at
  on public.luna_insights (created_at desc);
create index if not exists idx_luna_insights_category
  on public.luna_insights (category);
create index if not exists idx_luna_insights_outcome
  on public.luna_insights (outcome);
create index if not exists idx_luna_insights_language
  on public.luna_insights (detected_language);

alter table public.luna_insights enable row level security;

drop policy if exists "Management users can read Luna insights" on public.luna_insights;
create policy "Management users can read Luna insights"
on public.luna_insights
for select
to authenticated
using (public.is_management_user());

revoke all on public.luna_insights from anon, authenticated;
grant select on public.luna_insights to authenticated;

create or replace function public.purge_old_luna_insights()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.luna_insights
  where created_at < now() - interval '365 days';
$$;

revoke all on function public.purge_old_luna_insights() from public;

commit;
