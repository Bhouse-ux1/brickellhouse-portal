# BrickellHouse Portal Master Project Handoff

Last repository verification: 2026-07-16

Project folder: `C:\Users\Admin\Documents\brickellhouse-portal`

Production site: `https://portal.brickellhouse.org/`

This is the authoritative technical handoff and single source of truth for the BrickellHouse Portal. Every new Codex conversation must read this file completely, then verify the current Git status and the source relevant to its task before making changes. This document records the current verified repository and production state; it is not a changelog or roadmap.

## 1. Current State

BrickellHouse Portal is a live resident-services application in production hardening and operational refinement.

Current major systems:

- Public Resident Portal with English and Spanish interfaces.
- Supabase-backed Resident Store with a sanitized public catalog.
- Dedicated legal-gated checkout page.
- Live Stripe Embedded Checkout with working card and Apple Pay flows.
- Supabase orders, order items, payment events, products, settings, feedback, audit data, Auth/RLS, and Luna Review data.
- Resend transactional emails for paid orders.
- Authenticated Management operations portal.
- Luna resident assistant with deterministic routing, approved server knowledge, OpenAI fallback, Spanish support, typo/alias normalization, privacy rules, and abuse protection.
- Vercel Hobby hosting/functions, Cloudflare edge services, and enforced route-specific CSP.

### Applied migration state

- Migrations `001` through `012`: applied.
- Migration `014_restore_management_product_privileges.sql`: applied.

Do not run any migration without explicit approval and target-database verification.

## Active Production Systems

The current live production systems are:

- Stripe Embedded Checkout.
- Stripe card payments.
- Apple Pay.
- Server-authoritative order creation and fulfillment.
- Resend transactional emails.
- Supabase database, Auth, RLS, REST, and server-side service-role access.
- Luna resident assistant.
- Resident Portal.
- Management Portal.
- Route-specific enforced Content Security Policy.
- Cloudflare edge services.
- Server-generated `BH-XXXXX` order references.
- Vercel Hobby static hosting and serverless functions.

Stripe is the only active payment system. Browser-submitted prices, totals, product state, accounting data, and payment state are never authoritative.

## Legacy Compatibility

Legacy compatibility preserves historical records; it does not identify systems to use for new development.

### Payments and records

- Square is inactive and must not be used for new payments. Stripe is the only active payment system.
- Historical Square-related database fields, exports, records, identifiers, and compatibility paths must remain intact unless their removal is explicitly approved.
- Do not restore Square Sandbox configuration.
- Do not reintroduce Square environment variables, SDKs, checkout logic, API routes, or active setup instructions.
- Stripe identifiers must continue to use Stripe or provider-neutral fields and must never be written to `square_payment_id`.

### Order references

- New orders use server-generated `BH-XXXXX` references.
- Historical long-form order numbers must remain supported for tracking, Management display, exports, and stored records.
- Existing historical records must never be rewritten merely for cosmetic consistency.

### Archived and retired material

- Archived restore backups, including `restore-backup-20260616-125800/` and `oversized-backup/`, are excluded from deployment and are not current production code or architecture.
- Retired implementation notes are historical reference only and are not active setup instructions.
- Legacy Luna Insights migrations 008 and 009, schema, aggregate/redaction helpers, and naming remain only for compatibility. The active Management workflow is Luna Review, served by `api/luna-insights.js` under its retained filename.

### Unapplied migration

- Migration `013_luna_trusted_conversation_context.sql` exists in the repository but remains unapplied in production unless the owner separately confirms otherwise.
- Do not assume an unapplied migration is active because its SQL or related application code exists.
- Related Phase 2 code in `api/_luna-context.js` and `api/chat.js` is repository implementation, not confirmation of production activation.
- The deferred design uses anonymous UUID-bound context, a two-hour sliding TTL, a maximum of 10 trusted turns / 20 messages, server-side redaction, fixed safe context state, approved references, HMAC-signed conversation tokens, and atomic request reservation.
- Activation requires explicit approval for the migration and `LUNA_CONTEXT_SIGNING_SECRET`, applied in the verified target environment and correct order. Missing prerequisites must continue to disable persistence safely while basic Luna remains operational.
- If applied later, migration 013 forces RLS on its context tables, revokes direct public/browser access, and permits only the required service-role reads and RPC execution.

Never infer that a legacy-compatible field, file, migration, backup, or historical code path is currently active.

Before modifying anything marked legacy:

1. Inspect its present runtime use.
2. Confirm whether it is still required for historical records.
3. Stop and report before deleting or modernizing it.

## Current Launch Checklist

### Completed

- Resident Portal.
- Management Portal redesign.
- Bilingual interface.
- Stripe card payments.
- Apple Pay.
- Secure checkout.
- Mandatory legal review.
- Trusted server-side pricing.
- Server-generated `BH-XXXXX` order references.
- Premium transactional emails.
- Luna.
- CSP enforcement.
- Security headers.
- Deployment exclusions.
- Lifestyle video optimization.

### Pending or deferred

- Google Pay eligibility verification.
- Final feature inventory and product audit.
- Monthly accounting automation.
- Migration `013_luna_trusted_conversation_context.sql` remains unapplied unless separately approved.

## 2. Non-Negotiable Continuation Rules

1. Do not casually change working Stripe Session creation, verification, webhook handling, confirmation, idempotency, email triggering, or paid-order fulfillment.
2. Never trust browser prices, totals, fees, product availability, GL codes, payment state, or order state.
3. Do not weaken Supabase RLS, grants, Management approval checks, MFA-aware rules, or service-role boundaries.
4. Do not expose internal product names, GL/accounting fields, resident records, Management records, service-role data, or secrets to public code or responses.
5. Keep resident and Management browser code separated.
6. Preserve mandatory legal review and explicit acceptance before creating a paid checkout Session.
7. Preserve every requirement in the Legacy Compatibility section.
8. Luna Review must never become Luna memory, retrieval, training, knowledge, or an automatic behavior-update path.
9. Do not deploy, run migrations, change production configuration, or submit a payment without explicit authorization.
10. Keep changes narrow. Verify the diff, tests, and protected-system boundaries before reporting completion.

## 3. Architecture

### Stack

- Frontend: static HTML, CSS, and vanilla JavaScript.
- Backend: Node.js CommonJS Vercel serverless handlers.
- Hosting: Vercel Hobby.
- Edge/DNS/analytics: Cloudflare.
- Database/Auth: Supabase Postgres, Auth, RLS, REST, and service-role server access.
- Payments: Stripe Embedded Checkout.
- Email: Resend.
- AI: OpenAI Responses API plus deterministic server-side Luna routing and JSON knowledge.
- Package manager: npm; runtime dependency currently includes `resend`.
- Build system: none. There is no React, Next.js, Vue, bundler, or application build step.

### System communication

1. Resident pages load static assets from Vercel.
2. The Store requests `/api/products`, which reads Supabase with the service role and returns only resident-safe active catalog fields.
3. The resident cart stores only public product data and quantities locally.
4. Checkout reconciles the cart against the current public catalog, validates resident details, and requires legal review and acceptance.
5. `/api/stripe?action=session` reloads the trusted server catalog, calculates all amounts, creates a Pending order and order items, then creates Stripe Embedded Checkout.
6. Stripe confirmation or a signed webhook retrieves and verifies processor state before fulfillment.
7. Fulfillment updates Supabase and sends resident and Management emails through Resend.
8. Management uses a Supabase Auth JWT plus active Management approval and RLS to access private data.
9. Luna calls `/api/chat`; deterministic rules answer first, and OpenAI receives only the current request and selected approved server knowledge in the owner-confirmed production state.

### Coding philosophy

- Prefer server authority over browser claims.
- Prefer the existing plain-JavaScript architecture over new frameworks or broad abstractions.
- Use additive reviewed migrations; never edit an already-applied migration to change production behavior.
- Preserve narrow ownership boundaries and the documented Legacy Compatibility requirements.
- Treat UI-only tasks as UI-only unless the request explicitly authorizes protected backend changes.
- Test in proportion to risk and keep rollback simple.

## 4. Repository Map

### Public pages and scripts

- `index.html`: Resident Portal, Store, tracking, feedback, and Luna shell.
- `checkout.html`: dedicated legal-gated Stripe checkout.
- `lifestyle.html`: Lifestyle experience and video.
- `styles.css`: resident, checkout, and shared public presentation.
- `i18n.js`: English/Spanish dictionaries and language state.
- `public-nav.js`: public navigation.
- `app.js`: resident-only catalog, Store, cart, and general UI.
- `roadmap.js`: checkout, Stripe client, confirmation, tracking, and feedback.
- `chat.js`: Luna resident client and local transcript UX.
- `legal.js`: authoritative versioned Legal Notice.
- `lifestyle.js`: visibility-aware Lifestyle video playback.

### Management

- `management/login.html`: Management sign-in page.
- `auth.js`: Management login/recovery behavior.
- `management/dashboard.html`: Management application shell.
- `management/dashboard.css`: Management-only visual system.
- `management/dashboard.js`: self-contained Management application.

### Public API handlers

- `api/products.js`: sanitized public product catalog.
- `api/create-order.js`: trusted zero-dollar order route.
- `api/order-status.js`: public-safe order status lookup.
- `api/feedback.js`: validated feedback submission and database-backed abuse control.
- `api/chat.js`: Luna backend and Luna Review writer.
- `api/luna-insights.js`: Management-authenticated API for the current Luna Review workflow.
- `api/stripe.js`: consolidated Stripe config, Session, confirm, and webhook actions.
- `api/supabase-config.js`: browser-safe Supabase URL and anon key.

### Server helpers

- `api/_catalog.js`: trusted product catalog, accounting mapping, and public sanitization.
- `api/_stripe-checkout.js`: Stripe key gates, Session/order lifecycle, verification, events, and emails.
- `api/_supabase.js`: service-role Supabase REST helper.
- `api/_rate-limit.js`: instance-local public endpoint rate limiting.
- `api/order-emails.js`: transactional email rendering and Resend delivery.
- `server/order-number.js`: server-generated public order references.

Because Vercel Hobby has a function limit, inspect deployment behavior before adding API files. Stripe actions are intentionally consolidated into `api/stripe.js`.

## 5. Resident Portal

### Capabilities

- Resident Store with product cards, search, category filtering, inventory state, images, and shopping bag.
- Dedicated checkout and legal review.
- Public-safe order tracking.
- Feedback submission.
- Lifestyle page.
- Luna assistant.
- Responsive desktop/mobile navigation and layouts.

There is no resident login, resident account, or resident profile system. Resident UI state is browser-local and is not an authenticated resident account.

### Language support

- English and Spanish are supported through `i18n.js`.
- The preference key is `bh_language` in localStorage.
- Blocked or unavailable storage fails safely.
- `document.documentElement.lang` follows the selected language.
- Language changes dispatch `bh:language-changed` and update Store, checkout, tracking, feedback, Lifestyle, and Luna presentation.
- Spanish product presentation is resident-facing only; trusted product identity and server pricing remain unchanged.

### Store and cart

- `/api/products` is the public catalog authority.
- The response contains only resident-safe fields and only active, in-stock products.
- The browser cache and cart are reconciled against the current catalog.
- Missing, inactive, invalid, or out-of-stock items are removed from saved carts.
- Product image URLs are normalized to the resident-safe `image` field; genuinely missing images use a fallback.
- Dedicated checkout blocks if current catalog availability cannot be confirmed.
- Checkout uses an immutable cart snapshot. Quantities are locked for the active checkout attempt.

Current inactive repository fallback products:

- `svc5` - Trash Compactor Replacement.
- `svc7` - Lockout Assistance.
- `svc8` - Faucet Repair.
- `svc10` - Portable AC Unit Rental.
- `svc12` - Annual AC Filter Subscription.
- `svc15` - Premium Resident Care Plan.

They remain preserved for later reactivation and are not eligible for resident rendering or trusted checkout while inactive.

### Tracking

- Residents look up an order by its stored BrickellHouse order number.
- `/api/order-status` is rate-limited and returns only `order_number`, `status`, `public_note`, and `created_at`.
- It does not expose resident contact data, order items, payment details, internal notes, GL data, or processor references.

### Feedback

- Feedback is submitted through the public resident UI and validated server-side.
- Database-backed abuse protection limits matching submissions across normalized email, phone, unit, or request IP to two per 96 hours.
- Management receives private workflow controls without exposing feedback records publicly.

### Current UI state

- The resident experience is a polished, bilingual, responsive portal rather than a marketing landing page.
- Homepage Store, tracking, feedback, Lifestyle, and Luna remain separate workflows.
- Checkout is a dedicated page; the old modal is not the active checkout path.
- Resident-loaded scripts contain no Management Supabase logic, exports, Luna Review logic, internal product names, or GL/accounting constants.

## 6. Management Portal

### Security and initialization

- Management uses Supabase Auth.
- A valid session alone is insufficient: `management_users` must contain an active approved record.
- `public.is_management_user()` enforces approval and the configured MFA requirement; an MFA-required profile must have an `aal2` JWT.
- RLS is the data boundary. A guessed Management URL or hidden frontend control does not grant data access.
- `api/luna-insights.js` independently validates the Bearer token and active Management approval.
- The service-role key is never used in the browser.

### Current operations workspace

- Overview command center with current metrics, open work, low inventory, feedback/Luna queues, quick actions, and current activity.
- Orders workspace with search, status/date filters, grouped details, resident contact data, public/private notes, legal evidence, payment references, and status updates.
- Products workspace with search/filtering, resident presentation, inventory, availability, image preservation, internal names, GL codes, creation, editing, and active/inactive toggles.
- Feedback inbox with search, status/category filters, response, internal notes, details, deletion, and export.
- Reports workspace with revenue analytics and exports.
- Settings for processing fee and session/administrative information.
- Luna Review queue, thread view, filters, review status, Management notes, and export.
- Global search and command palette, including `Ctrl+K`.
- Responsive sidebar, mobile overlay, drawers, dialogs, and workspace layouts.

### Products

- Product updates use the authenticated Management Supabase client.
- Table privileges restored by migration 014 do not bypass RLS.
- Active/inactive updates change only `active` and `updated_at`, require exactly one matching returned database row, and update local state only after confirmation.
- Seed-only fallback products are not silently created or treated as editable database records.
- Full edits preserve valid `internal_name` and current GL rules.

### Reports and exports

- Monthly revenue chart supports year selection, tooltips, order counts, and product-level monthly drill-down.
- The right-side profit-margin axis is intentionally a placeholder until verified cost/margin data exists. No margin is fabricated.
- Order, feedback, and Luna Review exports are Management-only.
- Internal product/accounting names and GL snapshots remain available in Management order views and exports.

### Expected console message

The following Management console message is informational, not an application error:

```text
[Management products] Seed-only products are not backed by editable Supabase rows.
```

It identifies local fallback products that have no matching editable Supabase row. Do not weaken RLS or silently upsert products to remove this message.

## 7. Product and Pricing Trust Flow

1. Approved Management users edit database-backed products through authenticated Supabase access.
2. Supabase stores resident-facing fields plus private `internal_name`, `gl_code`, price, inventory, image, and active state.
3. Migration 012 blocks anon full-row reads from `public.products`.
4. `/api/products` uses the service role, filters unavailable rows, and returns only resident-safe fields.
5. Store and checkout send product IDs and quantities, not trusted prices.
6. Server routes reload the trusted catalog and validate IDs, active state, inventory, and integer quantity bounds.
7. The server computes subtotal, processing fee, and total. Browser values are ignored.
8. Supabase and Stripe receive only server-derived amounts.

Accounting rules:

- Monthly Valet Service uses GL `40033`.
- Other purchasable products use GL `40090`.
- `api/_catalog.js` is the trusted server mapping.
- Stripe line-item names and descriptions remain clean resident names.
- Stripe Session/PaymentIntent metadata receives the aggregate `gl_code` value: `40090`, `40033`, or `40090,40033`.
- Metadata also contains the stored order number, legal version, compact item IDs/quantities, and trusted totals.
- Resident name, email, phone, unit, and legal acceptance timestamp are not placed in Stripe metadata.
- `order_items` preserves resident name, internal name, and GL snapshots for Management and exports.

## 8. Checkout and Stripe

### Dedicated checkout

- `checkout.html` loads `i18n.js`, `legal.js`, `app.js`, and `roadmap.js` in that order.
- It does not load Luna, homepage animation/navigation code, or Management scripts.
- Stripe.js is loaded by checkout, not by the homepage.
- The Store cart persists through localStorage and is reconciled on entry.

### Mandatory legal review

1. Legal acceptance starts false.
2. The resident opens the complete versioned Legal Notice from `legal.js`.
3. Accept remains disabled until the legal-content container is scrolled to the bottom.
4. Reaching the bottom enables the button but does not accept automatically.
5. The resident must explicitly click Accept Legal Terms.
6. Checkout stores the accepted version and timestamp for the submitted attempt.
7. Cancel, close, Escape, or backdrop dismissal before acceptance leaves it unaccepted.
8. Required resident fields, a valid catalog/cart, legal acceptance, and intentional form submission are all required before Session creation.

### Embedded Checkout behavior

- `/api/stripe?action=config` exposes only enabled/provider/mode and the publishable key when valid.
- `paymentInProgress` and an existing `stripeEmbeddedCheckout` guard prevent duplicate submission.
- Pending order and order items are stored before Stripe Session creation.
- Stripe Embedded Checkout mounts only after one valid server Session is returned.
- After a successful mount, Order Summary remains visible while resident/contact fields, legal controls, notice, and Continue button are removed from layout.
- The page scrolls once to the Stripe area; reduced-motion users receive immediate rather than smooth scrolling.
- There is no Edit contact details path after mount and no flow that destroys/recreates a Session for editing.
- Mount/Session failure restores the pre-payment form and shows resident-safe wording.

### Provider and key gates

- Paid Stripe actions require `CHECKOUT_PROVIDER=stripe`.
- Matching test keys work without a live gate.
- Matching live keys additionally require `STRIPE_MODE=live` or `STRIPE_ALLOW_LIVE=true`.
- Mixed test/live keys, unknown prefixes, missing provider, and invalid configuration fail closed.
- Secret and webhook keys never reach the browser.

### Paid order flow

1. Apply five Session attempts per IP per 10 minutes.
2. Validate resident/contact/legal/cart input.
3. Reload trusted products and calculate amounts.
4. Generate and insert the Pending Supabase order.
5. Insert all `order_items` snapshots.
6. If item insertion fails, attempt to remove the incomplete header and do not create a Stripe Session.
7. Create the Stripe Session only after order and items exist.
8. Patch the Pending order with Stripe Session/PaymentIntent references.
9. Mount Embedded Checkout.
10. Confirm or webhook retrieves Stripe state server-side.
11. Fulfillment requires paid status, USD, exact stored order/session match, at least one stored line item, and exact trusted amount.
12. Mark the order Paid, record the idempotent payment event, and send emails.

### Verification and idempotency

- Webhook requires the Stripe provider, `STRIPE_WEBHOOK_SECRET`, a valid raw-body signature, timing-safe comparison, and a five-minute timestamp tolerance.
- Confirm and webhook use the same logical payment-event reference: `stripe_payment_<payment-intent-or-session>`.
- Migration 011 unique indexes protect Session, PaymentIntent, charge, and event identifiers.
- Repeated confirms, webhook retries, and Resend delivery retries do not intentionally create another paid order.
- Browser errors are generic; raw Supabase/PostgreSQL text is logged safely server-side and not returned to residents.

### Wallets and return behavior

- Production card payments and Apple Pay are verified working.
- Other Stripe wallets/payment options appear only when Stripe, account configuration, device, browser, and resident eligibility allow them.
- The return URL is `/?stripe_session_id={CHECKOUT_SESSION_ID}`.
- Root `roadmap.js` confirms the Session, clears the cart after verified success, removes the query parameter, and renders the polished confirmation.

### Zero-dollar orders

- `POST /api/create-order` accepts only a server-calculated zero total.
- It uses the same trusted catalog, legal evidence, order-number generator, and order/item persistence model.
- A positive trusted total is rejected and must use Stripe.
- This route currently does not call the paid-order email helper.

## 9. Order Numbers

New public order references are generated only on the server in `server/order-number.js`.

- Exact format: `BH-XXXXX`.
- Exact alphabet: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- Ambiguous `0`, `1`, `I`, and `O` are excluded.
- Randomness: Node `crypto.randomBytes(5)` with a uniform 32-character alphabet selection.
- The browser does not generate or control the stored order number.
- `public.orders.order_number` remains the uniqueness authority.
- Only PostgreSQL unique violation code `23505` triggers regeneration.
- Maximum allocation attempts: 10.
- Other database errors do not retry and return a resident-safe generic failure.
- The successful stored value is used by confirmation, emails, tracking, Management, exports, Stripe metadata, and `client_reference_id`.
- Internal UUID primary keys and processor references are unchanged.

## 10. Transactional Emails

Transactional order email code lives in `api/order-emails.js`.

### Delivery

- Provider: Resend.
- Sender: `BrickellHouse <orders@brickellhouse.org>`.
- Resident recipient: the validated order email.
- Management recipient: `admin@brickellhouse.net`.
- Resident subject: `BrickellHouse Order Confirmation`.
- Management subject: `New BrickellHouse Store Order`.
- Paid fulfillment sends both messages.
- Resend idempotency keys are derived from the payment/order reference.

### Design and compatibility

- Both templates include responsive table-based HTML and complete plain-text alternatives.
- The palette uses high-contrast near-black and white surfaces with restrained olive/gold accents.
- Supported color-scheme metadata is present, but the design does not depend on forced custom dark mode.
- The header uses a handcrafted email-safe HTML/CSS `BH` monogram and exact `BrickellHouse` wordmark.
- Resident subtitle: `Resident Services`; Management subtitle: `Management`.
- No PNG/SVG logo, white logo tile, JavaScript, canvas, web font, gradient, or shadow is required.
- Dynamic order values are escaped before HTML insertion.

### Privacy and accounting separation

- Resident email uses clean product names and no GL/internal accounting names.
- Management email may include internal names, GL snapshots, resident contact details, legal evidence, and payment references required for operations.
- No secret, service-role value, card data, or webhook secret is included.
- Email wording, recipients, triggers, payment behavior, and plain-text output are protected behavior.

Local email preview/test scripts are development-only and excluded from Vercel deployment by `.vercelignore`. Never send a real test email without explicit authorization.

## 11. Luna

### Current production-safe core

- Endpoint: `POST /api/chat`.
- Model: `gpt-5.6-luna` through the OpenAI Responses API.
- OpenAI storage: `store:false`.
- Deterministic intent/routing handlers run before model fallback.
- The fallback receives selected approved server-side JSON knowledge, not public web results or Management data.
- Luna supports English/Spanish, explicit and recent language persistence, typo/alias normalization, corrections, follow-ups, and Concierge Brain intent handling.
- Generic price/cost language alone does not retrieve the Store; valid Store/product intent does.
- Catalog retrieval failures return temporary resident-safe wording.
- High-confidence known facts answer directly; ambiguous cases clarify; low-confidence/private cases do not guess.

Approved server knowledge is under `api/_knowledge/brickellhouse/` and covers constitutional/privacy rules, identity/contacts, emergency routing, amenities, parking, packages, Store, rules, moves/contractors, HOA privacy, FAQ, conversation style, vendors, and Board information.

### Browser and privacy protections

- `chat.js` stores a temporary local transcript only for resident UX, capped at 20 messages with a two-hour expiry.
- sessionStorage failures and malformed content fail safely.
- Browser-supplied assistant, system, developer, and history content is not trusted by the server; the current browser request sends no history.
- Clear Chat invalidates all in-flight responses, removes the prior UUID and transcript, and starts a fresh anonymous conversation identity.
- Late responses from an invalidated generation cannot restore history or identity.
- Error responses preserve the current anonymous UUID when safe.
- Luna refuses prompts, source/JSON, backend implementation, credentials, private resident data, Management data, payment/accounting data, and protected contact information.
- Authority or identity claims do not unlock private data.

### Luna Review

- Migration 010 is applied.
- Current resident/assistant turn pairs are stored as raw text under an anonymous conversation UUID for 90 days.
- Raw text is not redacted by the active review builder; residents may voluntarily type sensitive content.
- Management can read records and update review status/note through authenticated Management access.
- Public/anon users have no access; service role writes/purges.
- Luna has no read path to the review table.
- Review data is not memory, retrieval, training, embeddings, a resident profile, prompt editing, JSON editing, or automatic learning.
- Purge runs on review writes/Management reads; it is event-driven rather than a documented scheduled job.

Current Luna verification: `npm run test:luna` passes 195/195 local checks with no production/network calls.

## 12. Supabase and Data Security

### Role boundaries

- Public residents do not query full product rows directly.
- `/api/products` uses service role and sanitizes the catalog.
- Management uses the public anon key only to initialize Supabase, then operates with the authenticated user JWT under RLS.
- Server routes use `SUPABASE_SERVICE_ROLE_KEY`; it is never returned to the browser.

### Product restrictions

- Migration 012 removes the resident product SELECT policy and revokes anon table SELECT.
- Authenticated users receive table privileges needed for Management, but RLS still requires `public.is_management_user()`.
- Migration 014 restores authenticated product CRUD table privileges without granting public/anon access or changing Management policies.
- Approved active Management users can read/create/update/delete products; ordinary authenticated users remain blocked by RLS.

### Main data areas

- Management approval/requests and audit logs.
- Products and portal settings.
- Orders, order items, and payment events.
- Feedback and abuse-control identifiers.
- Luna Review.

## 13. HTTP and Application Security

### Enforced CSP

`vercel.json` contains enforcing `Content-Security-Policy` headers, not Report-Only headers, for 11 HTML route rules:

- `/`
- `/index.html`
- `/lifestyle.html`
- `/payment-success.html`
- `/payment-failure.html`
- `/login.html`
- `/checkout.html`
- `/management/login.html`
- `/management/dashboard.html`
- `/management`
- `/management/`

No active HTML meta CSP remains. No CSP is assigned specifically to `/api/*`.

Policy philosophy:

- Default to self.
- `base-uri 'self'`, `object-src 'none'`, `frame-ancestors 'self'`, `form-action 'self'`, and `script-src-attr 'none'` remain standard.
- External origins are route-specific and minimal.
- Checkout alone allows required Stripe scripts, connections, images, and frames.
- Management alone allows jsDelivr for the Supabase browser library and the exact Supabase project origin.
- Cloudflare Web Analytics/Browser Insights loader origin `https://static.cloudflareinsights.com` is explicitly allowed where needed.
- Management allows `style-src-attr 'unsafe-inline'` because its current UI assigns dynamic style attributes; script attributes remain blocked.
- No script `unsafe-inline`, `unsafe-eval`, wildcard origin, or broad external source was added.

### Global headers

Every route receives:

- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), accelerometer=(), gyroscope=(), magnetometer=(), usb=(), bluetooth=(), browsing-topics=()`

Production HSTS is edge-delivered rather than defined in `vercel.json`; verify it after edge/infrastructure changes.

### Public abuse protection

- Stripe Session creation: 5 attempts per IP per 10 minutes.
- Luna chat/identity requests: 30 per IP per 10 minutes.
- Order status lookup: 30 per IP per 10 minutes.
- Feedback: 2 matching submissions per 96 hours using database-backed normalized identifiers/IP.
- Stripe webhook is not application-rate-limited.
- Management workflows are not covered by the public in-memory limiter; Auth/RLS provide their access boundary.
- `_rate-limit.js` buckets are Vercel-instance-local, not globally distributed.

### Secret and response rules

- Expected browser-visible credentials are limited to the Stripe publishable key and Supabase anon key.
- Stripe secret/webhook keys, Supabase service role, Resend key, OpenAI key, and signing secrets remain server-only.
- Browser/API responses must not include GL/internal accounting data, `privateAccounting`, resident records, service-role data, raw database errors, tokens, or secrets.
- Public JavaScript is always inspectable; never treat obscurity as security.

## 14. Lifestyle

- `lifestyle.html` uses exactly one video element and one MP4 source: `BHouse_Drone_Web_Optimized.mp4`.
- The video is muted, looped, inline on iOS, and uses `preload="metadata"` with `brickell-pool.webp` as poster.
- The same video instance attempts autoplay on mobile and desktop when at least 45% visible.
- Autoplay rejection is caught silently so the poster remains a safe fallback.
- Playback pauses offscreen, when the document is hidden, and on `pagehide`.
- Returning to visibility resumes the same instance without resetting `currentTime`.
- `prefers-reduced-motion: reduce` disables autoplay and leaves the video paused/poster-visible.
- There is no coarse-pointer/mobile poster-only override.
- No moving-video blur or duplicate source/instance is used.

The production MP4 is a lossless fast-start remux:

- H.264 High profile, `yuv420p`.
- 1920 x 1080, 30 fps.
- Approximately 13.8 seconds / 414 frames.
- No audio stream.
- Size: 8,510,837 bytes.
- `moov` begins immediately after `ftyp` and before `mdat`, allowing progressive startup.
- No re-encoding occurred.

## 15. Performance State

Recently completed optimizations:

- Dedicated checkout avoids rendering the homepage beneath a modal and removes nested modal scrolling.
- The homepage does not load Stripe.js; only checkout does.
- Resident and Management scripts are separate, preventing Management/accounting code from loading publicly.
- Checkout removes pre-payment sections after Stripe mount while preserving Order Summary.
- Catalog/cart reconciliation prevents stale unavailable products from reaching checkout.
- Cache-version query strings force updated resident/Management scripts when behavior changes.
- Lifestyle uses fast-start MP4 metadata, `preload="metadata"`, a poster, one source, offscreen/hidden-tab pause, reduced-motion handling, and no heavy blur.
- `.vercelignore` removes development tooling, previews, backups, migrations, and Markdown from deployed static output.
- Stripe API consolidation keeps Vercel Hobby function usage controlled.

## 16. Deployment

### Vercel

- Plan: Hobby.
- Project root: repository root.
- Framework: Other/static.
- Build command: none.
- Static pages/assets and Node serverless API routes deploy from the same repository.
- Asset query versions are deliberate cache busting; update only references for files whose browser behavior changed.

### `.vercelignore`

The following are intentionally excluded from deployment:

- `scripts/`
- Archived backup directories identified in Legacy Compatibility.
- `supabase/`
- all `*.md` files

Consequences:

- Local email preview/test tools are not public.
- Migration SQL and technical handoff Markdown are not statically served.
- Only the optimized Lifestyle MP4 remains a production video source.

### Environment variable names

Stripe/checkout:

- `CHECKOUT_PROVIDER`
- `STRIPE_MODE`
- `STRIPE_ALLOW_LIVE`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_API_VERSION`
- `PROCESSING_FEE_PERCENT`

Supabase:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Email/AI:

- `RESEND_API_KEY`
- `OPENAI_API_KEY`

Optional Management bootstrap tooling:

- `MANAGEMENT_EMAIL`
- `MANAGEMENT_TEMP_PASSWORD`

Never record real values in documentation or output.

### Deployment workflow

1. Read this handoff and inspect `git status --short`.
2. Inspect the exact diff and preserve unrelated user changes.
3. Confirm only authorized files changed and no secret/private export is staged.
4. Run relevant syntax, JSON, tests, and `git diff --check`.
5. Inspect Vercel function implications before adding or splitting routes.
6. Commit and push only reviewed work.
7. Use a preview where safe.
8. Deploy production only after explicit approval.
9. Do not submit a production payment or write production data unless explicitly authorized.

Rollback should be isolated: redeploy the last known-good Vercel deployment or revert the reviewed commit. For database changes, use reviewed compensating SQL after backup; never improvise a destructive rollback.

## 17. Known Expected Behaviors and Current Caveats

Expected, not bugs:

- The seed-only Management product console message documented above.
- Profit margin is intentionally blank/placeholder until verified cost data exists.
- Stripe wallet visibility varies by Stripe configuration, browser, device, region, and resident eligibility.
- Inactive products can remain visible to Management while absent from resident Store/API/checkout.
- Luna Review stores raw text for 90 days but is isolated from Luna memory/training/retrieval.
- Luna Review purge is triggered by reads/writes, not by a documented scheduler.
- In-memory endpoint rate limits are per serverless instance.
- Abandoned Stripe attempts may leave Pending orders for later operational cleanup.
- The zero-dollar route does not currently send the paid-order email templates.

Legacy Compatibility requirements are expected behavior, not broad cleanup targets.

## 18. Protected Systems

Require explicit scope and focused review:

- `api/stripe.js` and `api/_stripe-checkout.js`.
- Trusted pricing and `api/_catalog.js`.
- Order creation, order items, payment events, order-number generation, and fulfillment.
- `api/order-emails.js` and Resend triggers/idempotency.
- Supabase schema, migrations, grants, RLS, and `api/_supabase.js`.
- Management Auth, approval, MFA-aware checks, and product access.
- `legal.js` and the legal acceptance flow.
- Product synchronization, GL mapping, and accounting snapshots.
- Luna knowledge, prompts, routing, Luna Review isolation, privacy rules, and the deferred context implementation identified in Legacy Compatibility.
- Enforced CSP, security headers, Vercel, Cloudflare, and environment configuration.
- Resident/Management script separation.

For UI-only work, do not touch these systems unless the task expressly requires it.

## 19. Verification Standards

Minimum workflow for future Codex tasks:

1. Read this file completely.
2. Inspect Git status and recent history.
3. Read the current implementation relevant to the request.
4. State what will change before editing.
5. Keep the diff tightly scoped.
6. Run `node --check` on every modified JavaScript file.
7. Parse modified JSON and SQL-review migrations without running them.
8. Run `npm run test:luna` for Luna changes; current baseline is 195/195.
9. Run `git diff --check`.
10. Search resident-loaded source for prohibited Management/internal fields after ownership changes.
11. Perform manual smoke checks appropriate to the affected workflow.
12. Report files changed, behavior changed, checks run, protected systems preserved, and deploy/migration status.

High-value smoke checks:

- Resident language selection, Store, search, filters, images, cart, tracking, feedback, Lifestyle, and Luna.
- Checkout catalog reconciliation, legal review, duplicate guard, Stripe mount, return confirmation, and cart clearing.
- Sanitized `/api/products` response with no internal/GL fields.
- Management login/approval, products, orders, feedback, revenue, settings, exports, and Luna Review.
- Enforced CSP with no legitimate browser violations on affected routes.
- No resident-loaded source contains Management Supabase logic or accounting fields.

## 20. Final Continuation Summary

As of the 2026-07-16 repository verification, BrickellHouse Portal is a live Vercel Hobby/Supabase application using production Stripe Embedded Checkout, Resend transactional email, an authenticated Management operations portal, enforced route-specific CSP, a bilingual resident experience, an optimized Lifestyle video, server-generated `BH-XXXXX` order references, and OpenAI-backed Luna with deterministic safety routing.

The most important facts for the next conversation are:

- Stripe is the only active payment system; production card payments and Apple Pay work.
- Server pricing, payment verification, order creation, RLS, and GL privacy are protected.
- Public products are sanitized through `/api/products`; anon full-table product reads are blocked.
- Management uses its own bundle, Supabase Auth, approval checks, and RLS.
- Transactional emails use the HTML/CSS BrickellHouse wordmark and separate resident/internal accounting content.
- Luna runs `gpt-5.6-luna` with `store:false`, rejects browser history, and keeps Luna Review isolated.
- `.vercelignore` prevents local scripts, backups, migrations, and Markdown from being deployed.
- Do not deploy, migrate, reconfigure production, or submit payments without explicit authorization.
