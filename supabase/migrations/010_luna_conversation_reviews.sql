begin;

create table if not exists public.luna_conversation_reviews (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  detected_language text not null default 'unknown'
    check (detected_language in ('en', 'es', 'unknown')),
  detected_topic text not null default 'unknown',
  category text not null default 'Unknown',
  confidence integer not null default 0
    check (confidence >= 0 and confidence <= 100),
  status text not null default 'New'
    check (status in ('New', 'Reviewed', 'Resolved', 'Ignored')),
  management_note text not null default '',
  messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array'),
  privacy_redacted boolean not null default true,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

comment on table public.luna_conversation_reviews is
  'Management-only 90-day redacted Luna conversation review queue. Luna never reads from this table and it is not training, memory, retrieval, or knowledge update data.';
comment on column public.luna_conversation_reviews.messages is
  'Array of redacted or omitted resident/Luna messages. No raw resident conversations, resident profiles, unit/email/phone identity, embeddings, or model-training data.';

create index if not exists idx_luna_conversation_reviews_last_message
  on public.luna_conversation_reviews (last_message_at desc);
create index if not exists idx_luna_conversation_reviews_status
  on public.luna_conversation_reviews (status);
create index if not exists idx_luna_conversation_reviews_category
  on public.luna_conversation_reviews (category);
create index if not exists idx_luna_conversation_reviews_language
  on public.luna_conversation_reviews (detected_language);

alter table public.luna_conversation_reviews enable row level security;

drop policy if exists "Management can read Luna conversation reviews" on public.luna_conversation_reviews;
create policy "Management can read Luna conversation reviews"
on public.luna_conversation_reviews
for select
to authenticated
using (public.is_management_user());

drop policy if exists "Management can update Luna conversation reviews" on public.luna_conversation_reviews;
create policy "Management can update Luna conversation reviews"
on public.luna_conversation_reviews
for update
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

revoke all on public.luna_conversation_reviews from anon, authenticated;
grant select on public.luna_conversation_reviews to authenticated;
grant update (status, management_note, reviewed_at, reviewed_by, updated_at) on public.luna_conversation_reviews to authenticated;
grant insert, select, update, delete on public.luna_conversation_reviews to service_role;

create or replace function public.append_luna_conversation_review(
  p_conversation_id uuid,
  p_detected_language text,
  p_detected_topic text,
  p_category text,
  p_confidence integer,
  p_messages jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.luna_conversation_reviews (
    conversation_id,
    created_at,
    last_message_at,
    detected_language,
    detected_topic,
    category,
    confidence,
    messages,
    privacy_redacted
  )
  values (
    p_conversation_id,
    now(),
    now(),
    case when p_detected_language in ('en', 'es', 'unknown') then p_detected_language else 'unknown' end,
    coalesce(nullif(left(p_detected_topic, 120), ''), 'unknown'),
    coalesce(nullif(left(p_category, 120), ''), 'Unknown'),
    greatest(0, least(100, coalesce(p_confidence, 0))),
    case when jsonb_typeof(p_messages) = 'array' then p_messages else '[]'::jsonb end,
    true
  )
  on conflict (conversation_id) do update
  set last_message_at = now(),
      detected_language = excluded.detected_language,
      detected_topic = excluded.detected_topic,
      category = excluded.category,
      confidence = excluded.confidence,
      messages = public.luna_conversation_reviews.messages || excluded.messages,
      updated_at = now();
$$;

create or replace function public.purge_old_luna_conversation_reviews()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.luna_conversation_reviews
  where last_message_at < now() - interval '90 days';
$$;

revoke all on function public.append_luna_conversation_review(uuid, text, text, text, integer, jsonb) from public;
revoke all on function public.purge_old_luna_conversation_reviews() from public;
grant execute on function public.append_luna_conversation_review(uuid, text, text, text, integer, jsonb) to service_role;
grant execute on function public.purge_old_luna_conversation_reviews() to service_role;

commit;

