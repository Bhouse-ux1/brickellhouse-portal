begin;

-- Add nullable processor-neutral fields for a future Stripe checkout path.
-- Existing Square code does not write these columns yet, so no historical
-- payment records are relabeled by this migration.
alter table public.orders
  add column if not exists payment_provider text
    check (payment_provider in ('square', 'stripe', 'none')),
  add column if not exists payment_processor_reference text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id text;

alter table public.payment_events
  add column if not exists payment_provider text
    check (payment_provider in ('square', 'stripe', 'none')),
  add column if not exists processor_event_id text,
  add column if not exists processor_payment_id text,
  add column if not exists event_type text;

-- Prepare idempotency protection for future Stripe webhook handling without
-- constraining existing Square rows, which have null Stripe/generic IDs.
create unique index if not exists orders_stripe_checkout_session_id_uidx
on public.orders (stripe_checkout_session_id)
where stripe_checkout_session_id is not null;

create unique index if not exists orders_stripe_payment_intent_id_uidx
on public.orders (stripe_payment_intent_id)
where stripe_payment_intent_id is not null;

create unique index if not exists orders_stripe_charge_id_uidx
on public.orders (stripe_charge_id)
where stripe_charge_id is not null;

create unique index if not exists payment_events_processor_event_id_uidx
on public.payment_events (processor_event_id)
where processor_event_id is not null;

create index if not exists orders_payment_provider_idx
on public.orders (payment_provider)
where payment_provider is not null;

create index if not exists payment_events_payment_provider_idx
on public.payment_events (payment_provider)
where payment_provider is not null;

comment on column public.orders.payment_provider is
  'Future payment provider marker. Nullable to avoid relabeling existing records; expected values are square, stripe, or none.';
comment on column public.orders.payment_processor_reference is
  'Future processor-neutral payment reference for Management and reconciliation.';
comment on column public.orders.stripe_checkout_session_id is
  'Future Stripe Checkout Session ID. Never store Stripe IDs in square_payment_id.';
comment on column public.orders.stripe_payment_intent_id is
  'Future Stripe PaymentIntent ID for reconciliation and idempotency.';
comment on column public.orders.stripe_charge_id is
  'Future Stripe Charge ID when available.';
comment on column public.payment_events.payment_provider is
  'Future payment event provider marker. Nullable for existing Square/no-payment events.';
comment on column public.payment_events.processor_event_id is
  'Future processor event ID for webhook idempotency, such as a Stripe event ID.';
comment on column public.payment_events.processor_payment_id is
  'Future processor payment object ID associated with this payment event.';
comment on column public.payment_events.event_type is
  'Future processor event type, such as checkout.session.completed or payment_intent.succeeded.';

commit;
