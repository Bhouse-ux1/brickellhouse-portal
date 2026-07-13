begin;

create or replace function public.is_approved_luna_context_entity(p_type text, p_id text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  approved_registry constant jsonb := '{"board":["guillermo-ponce","juan-carlos-ahmad","luis-garino","manuel-agras","manuel-cervera","marco-cevenini","ricardo-de-olivera","victoriia-agapitov","walter-colatosi"],"staff":["administrator","assistant-manager","general-manager"],"vendor":["aaa-miami-locksmith","aj-appliance-refrigeration","all-comp","american-handy-paint-clean-co","bay-plumbing","brickell-locksmith","cam-seer-service","caraballo-locksmith","ciao-moving-storage","curtains-blinds-inc","island-plumbing","locksmith-in-miami","orion-electric","raircon","rapetti-shower","rushmore-movers","switchgear","us-contracting","world-of-eagles"],"amenity":["bbq","business_center","clubroom_lounge","gym_fitness_center","owners_lounge","party_event_room","pool_spa","rooftop_terrace","sauna","theater"],"parking":["aps","parking-attendant","valet"],"contact":["front_desk","maintenance","management","receiving"]}'::jsonb;
begin
  return coalesce((approved_registry -> p_type) ? p_id, false);
end;
$$;

create or replace function public.is_valid_luna_context_state(p_state jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_state is null
     or jsonb_typeof(p_state) <> 'object'
     or octet_length(convert_to(p_state::text, 'UTF8')) > 4096
     or not (p_state ?& array['activeTopic', 'entities', 'candidateReferents', 'lastRequestedAttribute'])
     or (p_state - array['activeTopic', 'entities', 'candidateReferents', 'lastRequestedAttribute']) <> '{}'::jsonb
     or jsonb_typeof(p_state -> 'activeTopic') <> 'string'
     or (p_state ->> 'activeTopic') not in (
       'constitution', 'emergencyUrgent', 'vendors', 'residentStore',
       'packagesReceiving', 'parkingAps', 'movesContractorsDeliveries',
       'amenities', 'rulesViolations', 'hoaManagementPrivacy', 'board',
       'faq', 'identityContacts', 'conversationStyle', 'unknown'
     )
     or jsonb_typeof(p_state -> 'entities') <> 'array'
     or jsonb_array_length(p_state -> 'entities') > 10
     or jsonb_typeof(p_state -> 'candidateReferents') <> 'array'
     or jsonb_array_length(p_state -> 'candidateReferents') > 10
     or jsonb_typeof(p_state -> 'lastRequestedAttribute') <> 'string'
     or (p_state ->> 'lastRequestedAttribute') not in (
       'position', 'email', 'phone', 'hours', 'price', 'policy',
       'contact', 'availability', 'location', 'unknown'
     ) then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements((p_state -> 'entities') || (p_state -> 'candidateReferents')) as entity(value)
    where jsonb_typeof(entity.value) <> 'object'
       or not (entity.value ?& array['type', 'id'])
       or (entity.value - array['type', 'id']) <> '{}'::jsonb
       or jsonb_typeof(entity.value -> 'type') <> 'string'
       or (entity.value ->> 'type') not in ('board', 'staff', 'vendor', 'amenity', 'parking', 'contact', 'product')
       or jsonb_typeof(entity.value -> 'id') <> 'string'
       or char_length(entity.value ->> 'id') not between 1 and 80
       or (entity.value ->> 'id') !~ '^[a-z][a-z0-9_-]{0,79}$'
       or (
         (entity.value ->> 'type') <> 'product'
         and not public.is_approved_luna_context_entity(entity.value ->> 'type', entity.value ->> 'id')
       )
  ) then
    return false;
  end if;

  return true;
end;
$$;

create table if not exists public.luna_conversation_contexts (
  conversation_id uuid primary key,
  version bigint not null default 0 check (version >= 0),
  context_state jsonb not null default '{"activeTopic":"unknown","entities":[],"candidateReferents":[],"lastRequestedAttribute":"unknown"}'::jsonb
    check (public.is_valid_luna_context_state(context_state)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  check (updated_at >= created_at),
  check (expires_at > updated_at)
);

create table if not exists public.luna_conversation_request_keys (
  conversation_id uuid not null references public.luna_conversation_contexts(conversation_id) on delete cascade,
  request_id uuid not null,
  sequence bigint check (sequence is null or sequence > 0),
  status text not null default 'processing' check (status in ('processing', 'completed')),
  reservation_id uuid not null,
  reserved_at timestamptz not null default now(),
  reservation_expires_at timestamptz not null,
  completed_at timestamptz,
  assistant_content text check (assistant_content is null or char_length(assistant_content) between 1 and 900),
  created_at timestamptz not null default now(),
  primary key (conversation_id, request_id),
  unique (conversation_id, sequence),
  check (
    (status = 'processing'
      and sequence is null
      and completed_at is null
      and assistant_content is null
      and reservation_expires_at > reserved_at)
    or
    (status = 'completed'
      and sequence is not null
      and completed_at is not null)
  )
);

create table if not exists public.luna_conversation_turns (
  conversation_id uuid not null references public.luna_conversation_contexts(conversation_id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  request_id uuid not null,
  user_content text not null check (char_length(user_content) between 1 and 900),
  assistant_content text not null check (char_length(assistant_content) between 1 and 900),
  created_at timestamptz not null default now(),
  primary key (conversation_id, sequence),
  unique (conversation_id, request_id),
  foreign key (conversation_id, request_id)
    references public.luna_conversation_request_keys(conversation_id, request_id)
    on delete cascade
);

comment on table public.luna_conversation_contexts is
  'Server-only two-hour Luna context keyed by an anonymous UUID and protected by a dedicated server signing secret. Separate from Luna Review, training, profiles, and long-term memory.';
comment on table public.luna_conversation_turns is
  'The latest ten server-accepted Luna turn pairs. Roles are fixed by the user_content and assistant_content columns; no browser-supplied assistant content is accepted.';
comment on table public.luna_conversation_request_keys is
  'Server-only request reservation and idempotency ledger. Completed replies remain only while their retained turn exists; trimmed request IDs stay blocked without transcript content.';

create index if not exists idx_luna_conversation_contexts_expires_at
  on public.luna_conversation_contexts (expires_at);
create index if not exists idx_luna_conversation_contexts_updated_at
  on public.luna_conversation_contexts (updated_at desc);
create index if not exists idx_luna_conversation_request_keys_reservation_expiry
  on public.luna_conversation_request_keys (reservation_expires_at)
  where status = 'processing';
create index if not exists idx_luna_conversation_turns_recent
  on public.luna_conversation_turns (conversation_id, sequence desc);

alter table public.luna_conversation_contexts enable row level security;
alter table public.luna_conversation_contexts force row level security;
alter table public.luna_conversation_request_keys enable row level security;
alter table public.luna_conversation_request_keys force row level security;
alter table public.luna_conversation_turns enable row level security;
alter table public.luna_conversation_turns force row level security;

revoke all on public.luna_conversation_contexts from public, anon, authenticated;
revoke all on public.luna_conversation_request_keys from public, anon, authenticated;
revoke all on public.luna_conversation_turns from public, anon, authenticated;
revoke all on public.luna_conversation_contexts from service_role;
revoke all on public.luna_conversation_request_keys from service_role;
revoke all on public.luna_conversation_turns from service_role;
grant usage on schema public to service_role;
grant select on public.luna_conversation_contexts to service_role;
grant select on public.luna_conversation_request_keys to service_role;
grant select on public.luna_conversation_turns to service_role;

create or replace function public.trim_luna_conversation_turns()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  delete from public.luna_conversation_turns
  where conversation_id = new.conversation_id
    and sequence not in (
      select recent.sequence
      from public.luna_conversation_turns as recent
      where recent.conversation_id = new.conversation_id
      order by recent.sequence desc
      limit 10
    );

  update public.luna_conversation_request_keys as request_key
  set assistant_content = null
  where request_key.conversation_id = new.conversation_id
    and request_key.status = 'completed'
    and request_key.assistant_content is not null
    and not exists (
      select 1
      from public.luna_conversation_turns as retained_turn
      where retained_turn.conversation_id = request_key.conversation_id
        and retained_turn.request_id = request_key.request_id
    );
  return null;
end;
$$;

drop trigger if exists trim_luna_conversation_turns_after_insert on public.luna_conversation_turns;
create trigger trim_luna_conversation_turns_after_insert
after insert on public.luna_conversation_turns
for each row execute function public.trim_luna_conversation_turns();

create or replace function public.reserve_luna_conversation_request(
  p_conversation_id uuid,
  p_request_id uuid,
  p_reservation_id uuid
)
returns table (
  result_status text,
  result_sequence bigint,
  result_version bigint,
  result_expires_at timestamptz,
  result_assistant_content text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_context public.luna_conversation_contexts%rowtype;
  request_key public.luna_conversation_request_keys%rowtype;
  next_reservation_expiry timestamptz;
begin
  if p_reservation_id is null then
    raise exception 'invalid reservation identifier' using errcode = '22023';
  end if;

  insert into public.luna_conversation_contexts (conversation_id)
  values (p_conversation_id)
  on conflict (conversation_id) do nothing;

  select context.*
  into current_context
  from public.luna_conversation_contexts as context
  where context.conversation_id = p_conversation_id
  for update;

  if current_context.expires_at <= now() then
    return query select 'expired'::text, null::bigint, current_context.version,
      current_context.expires_at, null::text;
    return;
  end if;

  select existing_key.*
  into request_key
  from public.luna_conversation_request_keys as existing_key
  where existing_key.conversation_id = p_conversation_id
    and existing_key.request_id = p_request_id
  for update;

  if not found then
    next_reservation_expiry := now() + interval '2 minutes';
    insert into public.luna_conversation_request_keys (
      conversation_id, request_id, status, reservation_id, reserved_at, reservation_expires_at
    ) values (
      p_conversation_id, p_request_id, 'processing', p_reservation_id, now(), next_reservation_expiry
    );
    return query select 'reserved'::text, null::bigint, current_context.version,
      current_context.expires_at, null::text;
    return;
  end if;

  if request_key.status = 'completed' then
    return query select 'completed'::text, request_key.sequence, current_context.version,
      current_context.expires_at, request_key.assistant_content;
    return;
  end if;

  if request_key.reservation_id = p_reservation_id
     and request_key.reservation_expires_at > now() then
    next_reservation_expiry := now() + interval '2 minutes';
    update public.luna_conversation_request_keys
    set reserved_at = now(),
        reservation_expires_at = next_reservation_expiry
    where conversation_id = p_conversation_id
      and request_id = p_request_id;
    return query select 'reserved'::text, null::bigint, current_context.version,
      current_context.expires_at, null::text;
    return;
  end if;

  if request_key.reservation_expires_at <= now() then
    next_reservation_expiry := now() + interval '2 minutes';
    update public.luna_conversation_request_keys
    set reservation_id = p_reservation_id,
        reserved_at = now(),
        reservation_expires_at = next_reservation_expiry
    where conversation_id = p_conversation_id
      and request_id = p_request_id;
    return query select 'reserved'::text, null::bigint, current_context.version,
      current_context.expires_at, null::text;
    return;
  end if;

  return query select 'processing'::text, null::bigint, current_context.version,
    current_context.expires_at, null::text;
end;
$$;

create or replace function public.append_luna_conversation_turn(
  p_conversation_id uuid,
  p_request_id uuid,
  p_reservation_id uuid,
  p_expected_version bigint,
  p_user_content text,
  p_assistant_content text,
  p_context_state jsonb
)
returns table (
  result_status text,
  result_sequence bigint,
  result_version bigint,
  result_expires_at timestamptz,
  result_assistant_content text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_context public.luna_conversation_contexts%rowtype;
  request_key public.luna_conversation_request_keys%rowtype;
  next_sequence bigint;
  next_expiry timestamptz;
begin
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'invalid expected context version' using errcode = '22023';
  end if;
  if not public.is_valid_luna_context_state(p_context_state) then
    raise exception 'invalid context state' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(
      (p_context_state -> 'entities') || (p_context_state -> 'candidateReferents')
    ) as entity(value)
    where entity.value ->> 'type' = 'product'
      and not exists (
        select 1
        from public.products as product
        where product.id = entity.value ->> 'id'
          and product.active is true
          and product.inventory > 0
      )
  ) then
    raise exception 'invalid product context entity' using errcode = '22023';
  end if;

  select context.*
  into current_context
  from public.luna_conversation_contexts as context
  where context.conversation_id = p_conversation_id
  for update;

  if not found then
    return query select 'reservation_missing'::text, null::bigint, 0::bigint,
      null::timestamptz, null::text;
    return;
  end if;

  if current_context.expires_at <= now() then
    return query select 'expired'::text, null::bigint, current_context.version,
      current_context.expires_at, null::text;
    return;
  end if;

  select existing_key.*
  into request_key
  from public.luna_conversation_request_keys as existing_key
  where existing_key.conversation_id = p_conversation_id
    and existing_key.request_id = p_request_id
  for update;

  if not found then
    return query select 'reservation_missing'::text, null::bigint, current_context.version,
      current_context.expires_at, null::text;
    return;
  end if;

  if request_key.status = 'completed' then
    return query select 'duplicate'::text, request_key.sequence, current_context.version,
      current_context.expires_at, request_key.assistant_content;
    return;
  end if;

  if request_key.reservation_id <> p_reservation_id
     or request_key.reservation_expires_at <= now() then
    return query select 'reservation_lost'::text, null::bigint, current_context.version,
      current_context.expires_at, null::text;
    return;
  end if;

  if current_context.version <> p_expected_version then
    return query select 'conflict'::text, null::bigint, current_context.version,
      current_context.expires_at, null::text;
    return;
  end if;

  next_sequence := current_context.version + 1;
  next_expiry := now() + interval '2 hours';

  insert into public.luna_conversation_turns (
    conversation_id, sequence, request_id, user_content, assistant_content
  ) values (
    p_conversation_id, next_sequence, p_request_id, p_user_content, p_assistant_content
  );

  update public.luna_conversation_request_keys
  set status = 'completed',
      sequence = next_sequence,
      completed_at = now(),
      assistant_content = p_assistant_content
  where conversation_id = p_conversation_id
    and request_id = p_request_id;

  update public.luna_conversation_contexts
  set version = next_sequence,
      context_state = p_context_state,
      updated_at = now(),
      expires_at = next_expiry
  where conversation_id = p_conversation_id;

  return query select 'appended'::text, next_sequence, next_sequence,
    next_expiry, p_assistant_content;
end;
$$;

create or replace function public.delete_expired_luna_conversation_context(
  p_conversation_id uuid,
  p_observed_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  deleted_count integer;
begin
  delete from public.luna_conversation_contexts
  where conversation_id = p_conversation_id
    and expires_at = p_observed_expires_at
    and expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

create or replace function public.purge_expired_luna_conversation_contexts()
returns void
language sql
security definer
set search_path = pg_catalog
as $$
  delete from public.luna_conversation_contexts
  where expires_at <= now();
$$;

revoke all on function public.is_approved_luna_context_entity(text, text) from public, anon, authenticated;
revoke all on function public.is_valid_luna_context_state(jsonb) from public, anon, authenticated;
revoke all on function public.trim_luna_conversation_turns() from public, anon, authenticated;
revoke all on function public.reserve_luna_conversation_request(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.append_luna_conversation_turn(uuid, uuid, uuid, bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.delete_expired_luna_conversation_context(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.purge_expired_luna_conversation_contexts() from public, anon, authenticated;
grant execute on function public.reserve_luna_conversation_request(uuid, uuid, uuid) to service_role;
grant execute on function public.append_luna_conversation_turn(uuid, uuid, uuid, bigint, text, text, jsonb) to service_role;
grant execute on function public.delete_expired_luna_conversation_context(uuid, timestamptz) to service_role;
grant execute on function public.purge_expired_luna_conversation_contexts() to service_role;

commit;
