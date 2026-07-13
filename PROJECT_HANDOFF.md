# BrickellHouse Portal Project Handoff

Last updated: 2026-07-13

Start every new development conversation by reading `SESSION_RESUME.md` completely. It is the authoritative project memory and protected-systems guide.

## Current Phase

BrickellHouse Portal is a live production resident-services application in post-launch hardening and operational improvement. It is not a static prototype.

Live Stripe card payments and Apple Pay are working in production. Google Pay is enabled where Stripe and the resident's browser/device are eligible. Do not describe payments as pending verification or unavailable.

## Stack

- Static HTML/CSS/vanilla JavaScript.
- Vercel Hobby hosting and serverless functions.
- Supabase Postgres, Auth, RLS, and service-role backend access.
- Stripe Embedded Checkout.
- Resend order notifications.
- OpenAI fallback for Luna.
- Cloudflare for the production domain and Luna edge rate protection.

Production: `https://portal.brickellhouse.org/`

## Frontend Ownership

- `index.html`, `app.js`, and `roadmap.js`: resident catalog, cart, public workflows, tracking, feedback, and return confirmation.
- `checkout.html`: dedicated resident checkout and mandatory legal-review UI.
- `chat.js`: resident Luna client and anonymous session conversation ID.
- `management/dashboard.html` and `management/dashboard.js`: Management-only products, GL/accounting, orders, exports, feedback, settings, revenue, audit behavior, and Luna Review.
- `auth.js`: Management login/recovery page logic.

Resident scripts contain no GL codes, internal names, Management Supabase logic, Management exports, or Luna Review logic. Do not merge the resident and Management bundles.

## Store And Product Trust Flow

1. Management edits products through authenticated Supabase access under RLS.
2. Supabase `products` is the managed source of active status, inventory, price, resident name, internal name, GL code, and image URL.
3. Migration 012 blocks anon reads of full `public.products` rows.
4. `/api/products` uses service role and returns a sanitized active/in-stock catalog.
5. Resident `app.js` stores only resident-safe product fields and reconciles the saved cart after catalog refresh.
6. Checkout sends product IDs and quantities only.
7. Stripe and zero-dollar server routes reload the trusted catalog and recalculate all amounts.

Standard products use GL `40090`; valet products use GL `40033`. Residents see clean names. Stripe receives clean line-item names/descriptions and Session/PaymentIntent `gl_code` metadata. Supabase order-item snapshots, Management, and exports retain internal names and GL codes.

## Dedicated Checkout

- The bag's Continue action navigates to `checkout.html`.
- Cart state is preserved in localStorage.
- Checkout requires a successful `/api/products` refresh and removes inactive/missing items.
- The resident must complete contact fields, open the complete legal notice, scroll its real content container to the bottom, and explicitly select Accept Legal Terms.
- Legal acceptance captures the current notice version and acceptance timestamp.
- One intentional submission creates the Pending order/order items and then a Stripe Session.
- After Stripe mounts, contact/legal/instruction controls hide, Order Summary remains visible, and a one-time reduced-motion-aware scroll brings payment into view.
- No Edit contact details flow exists after Session creation.
- Checkout does not load homepage animations, Luna, or Management code.

## Active Stripe Flow

All active Stripe operations use `api/stripe.js`:

- `GET ?action=config`
- `POST ?action=session`
- `POST ?action=confirm`
- `POST ?action=webhook`

The server validates resident/legal data, reloads trusted products, computes fees/totals, creates a Pending Supabase order and order items before creating the Stripe Session, and then links Stripe IDs. Fulfillment retrieves Stripe state, requires paid USD status, verifies the Pending order, line items, Session ID, and amount, then marks the order Paid and sends resident/Management emails.

Webhook signatures are verified. Confirm and webhook use the same processor-payment event reference for idempotency. Stripe IDs never go into `square_payment_id`.

Current return URL intentionally points to `/?stripe_session_id=...`; the resident root confirms and displays success. Do not casually change it.

Square routes and frontend SDK code are retired. Historical Square columns/reporting remain compatible; see `SQUARE_SETUP.md`.

## Management

Supabase Auth plus an active approved `management_users` row is required. Direct navigation alone does not grant data access; RLS and server checks protect private data.

Management includes Overview/revenue, products, orders, exports, feedback, settings, audit logging, and Luna Review. Historical Square and current Stripe references remain visible where needed for reconciliation.

## Luna And Luna Review

Luna uses deterministic routing first, then OpenAI with selected approved server-side JSON knowledge. It supports Spanish persistence, typo/alias normalization, Concierge Brain intent handling, corrections, privacy refusals, and prompt/internal-system protection.

There is no automatic learning, model training, embedding/vector retrieval, permanent resident memory, or knowledge update from reviewed conversations.

The active Luna Review system stores each current raw resident message and Luna reply under an anonymous session UUID. It does not append frontend history on each call. Reviews are Management-only, retained for 90 days, and used only for manual review/status/notes. Luna cannot read this table.

The route retains the historical name `/api/luna-insights`; the Management tab is Luna Review.

## Applied Migrations

Owner-confirmed as successfully applied:

- 009 Luna Insights service-role grants.
- 010 Luna conversation review.
- 011 Stripe parallel foundation.
- 012 public product-table lockdown.

Migration 008 was previously applied. None of 009-012 is pending.

## Rate Limits

- Stripe Session: 5 attempts/IP/10 minutes (in-memory serverless bucket).
- Luna: 30 messages/IP/10 minutes (in-memory serverless bucket).
- Order lookup: 30 attempts/IP/10 minutes (in-memory serverless bucket).
- Feedback: database-backed maximum 2 matching submissions per 96 hours across normalized email, phone, unit, or IP.
- Cloudflare Luna rule: 5 requests/IP/10 seconds with a 10-second block.
- Stripe webhook is not rate limited.

In-memory limits are instance-local and not globally distributed.

## Known Follow-Ups

- Verify/fix email behavior for free/zero-dollar orders.
- Add stale Pending Stripe order cleanup.
- Improve Stripe payment-event ordering; non-blocking.
- Make generic public API error messages safer.
- Add production monitoring, uptime checks, and alerting.
- Complete the privacy-policy destination/disclosure.
- Address old encoding and accessibility cleanup separately.

## Protected Rules

- Do not casually change working Stripe verification, trusted pricing, webhook handling, or live keys.
- Do not weaken RLS or Management approval checks.
- Do not expose GL/internal data publicly.
- Do not merge resident and Management scripts.
- Do not run migrations or deploy without explicit approval.
- Do not make Luna read review conversations or learn automatically.
- Preserve historical Square database compatibility while keeping Square inactive.
