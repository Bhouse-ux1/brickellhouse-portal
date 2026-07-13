# BrickellHouse Portal Permanent Technical Handoff

Last rewritten: 2026-07-13

Project folder: `C:\Users\Admin\Documents\brickellhouse-portal`

Production site: `https://portal.brickellhouse.org/`

This is the authoritative project memory for the BrickellHouse Portal. A new Codex conversation must read this file completely before making changes. Treat it as a technical handoff, but verify relevant source and current Git status before editing.

## 1. Current Production State

BrickellHouse Portal is a live production resident-services application. It is in post-launch hardening and operational improvement, not prototype development.

Current major systems:

- Resident Portal and Supabase-backed Resident Store.
- Dedicated checkout page at `checkout.html`.
- Live Stripe Embedded Checkout.
- Live Stripe card payments and Apple Pay working in production.
- Google Pay enabled where Stripe, browser, device, and wallet eligibility allow it.
- Trusted server-side pricing and payment verification.
- Supabase orders, order items, payment events, products, settings, feedback, audit data, Auth/RLS, legacy Luna Insights schema, and active Luna Review.
- Resend resident and Management paid-order emails.
- Management Portal with products, orders, revenue, feedback, settings, exports, audit behavior, and Luna Review.
- Luna assistant with deterministic routing, approved server-side knowledge, OpenAI fallback, Spanish support, typo normalization, Concierge Brain behavior, privacy rules, and rate protection.
- Cloudflare in front of `portal.brickellhouse.org`.
- Vercel Hobby hosting/functions, with payment-route consolidation to conserve function count.

Square is retired from the active application. The Square routes and frontend SDK integration were removed. Historical Square database fields and Management reporting compatibility remain intentionally.

Owner-confirmed production migration state:

- `008_luna_insights_redacted.sql`: applied successfully.
- `009_luna_insights_service_role_grants.sql`: applied successfully.
- `010_luna_conversation_reviews.sql`: applied successfully.
- `011_stripe_parallel_foundation.sql`: applied successfully.
- `012_lock_down_public_product_columns.sql`: applied successfully.

None of migrations 009-012 is pending.

## 2. Highest-Priority Continuation Rules

1. Do not casually change working Stripe payment verification, Session creation, webhook handling, confirmation, idempotency, or paid-order fulfillment.
2. Do not change trusted server-side pricing or accept client prices/totals/GL values.
3. Do not weaken Supabase RLS, grants, Management approval checks, or service-role boundaries.
4. Do not expose GL codes, internal names, private accounting fields, service-role data, resident records, or secrets publicly.
5. Do not merge resident and Management browser bundles.
6. Do not switch production back to test keys or Square.
7. Do not run migrations or deploy without explicit approval.
8. Do not make Luna read reviewed conversations, learn automatically, create resident profiles, or use review records as memory/knowledge/training.
9. Do not expose Stripe secret keys, webhook secrets, Supabase service-role keys, Resend keys, OpenAI keys, passwords, or real environment values.
10. Preserve historical Square schema/reporting compatibility even though Square is inactive.
11. Preserve mandatory legal review and acceptance before checkout submission.
12. Start future work by reading this file, inspecting Git status, and reading the relevant implementation.

## 3. Technology And Architecture

The project uses plain HTML, CSS, vanilla JavaScript, and Node.js CommonJS serverless handlers. There is no React, Vue, Next.js, module bundler, or application build step.

Infrastructure:

- Vercel Hobby: static hosting and serverless API execution.
- Supabase: Postgres, Auth, RLS, browser anon access for approved Management workflows, and server-side service-role access.
- Stripe: Embedded Checkout, PaymentIntent/Checkout Session data, webhook fulfillment, cards, and eligible wallets.
- Resend: resident and Management paid-order emails.
- OpenAI: Luna model fallback after deterministic routing.
- Cloudflare: production domain/edge layer and Luna abuse protection.

High-level flow:

1. Resident loads `index.html`.
2. Resident-safe `app.js` renders cached/fallback catalog state and refreshes `/api/products`.
3. Cart stores product IDs/quantities in localStorage.
4. Continue navigates to `checkout.html`.
5. Checkout refreshes `/api/products`, reconciles the cart, validates resident details, and requires legal review/acceptance.
6. Paid checkout calls the consolidated `/api/stripe?action=session` route.
7. Server reloads trusted products, recalculates amounts, creates Pending order/order items, then creates and links a Stripe Session.
8. Stripe Embedded Checkout mounts in the resident page.
9. Confirm or signed webhook retrieves Stripe state and fulfills only a verified paid matching order.
10. Supabase records payment status/events and Resend sends paid-order emails.
11. Management uses Supabase Auth plus active `management_users` approval and RLS.
12. Luna calls `/api/chat`; deterministic logic answers first, otherwise OpenAI receives only selected approved server-side knowledge and temporary validated history.
13. Each current Luna resident message/reply pair is appended to the Management-only 90-day Luna Review under an anonymous conversation UUID.

## 4. Frontend Ownership And Script Separation

### Resident home

`index.html` loads, in order:

- `legal.js`
- `public-nav.js`
- `app.js`
- `roadmap.js`
- `chat.js`

Responsibilities:

- `app.js`: resident-only catalog, product rendering, search/categories, cart, localStorage, catalog reconciliation, general resident UI, and legal-content rendering helpers.
- `roadmap.js`: resident-only checkout client, Stripe UI, return confirmation, order tracking, feedback, legal-review state, and payment-focused state.
- `chat.js`: Luna resident client, temporary in-memory conversation history, and anonymous conversation UUID in sessionStorage.
- `public-nav.js`: public navigation.
- `legal.js`: authoritative versioned Legal Notice content.

### Dedicated checkout

`checkout.html` loads:

- `legal.js`
- `app.js`
- `roadmap.js`

It does not load `chat.js`, `public-nav.js`, Management scripts, or the Management Supabase client. `app.js` skips homepage reveal/parallax behavior on `.checkout-page`.

### Management

`management/dashboard.html` loads:

- `legal.js`
- `management/dashboard.js`

It does not load resident `app.js` or `roadmap.js`. `management/dashboard.js` is self-contained for Management authentication/session checks, products, internal GL/accounting, orders, exports, feedback, settings, revenue, audit behavior, and Luna Review.

`management/login.html` loads the Supabase browser library and `auth.js` for login/recovery.

Security consequence:

- Resident-loaded scripts contain no GL codes, internal names, Management Supabase/table logic, Management exports, or Luna Review UI logic.
- Management retains private accounting functionality in its dedicated bundle.
- Server-side trusted catalog remains the authority for checkout and Stripe.

Do not reverse this separation.

## 5. Repository And Active Files

Important root files:

- `index.html`: resident portal, Store/cart, tracking, feedback, success state, and Luna shell.
- `checkout.html`: dedicated checkout, legal review, Stripe mount target, and checkout confirmation layout.
- `styles.css`: shared visual styles with resident, checkout, Management, Luna, and responsive sections.
- `app.js`: resident-only Store/cart/catalog behavior.
- `roadmap.js`: resident checkout/Stripe/tracking/feedback behavior.
- `chat.js`: Luna frontend.
- `legal.js`: complete Legal Notice and version.
- `auth.js`: Management login/recovery logic.
- `management/dashboard.js`: Management-only application bundle.
- `.env.example`: placeholder-only source-confirmed environment names.
- `package.json`: runtime dependency currently includes `resend`.

Active API handlers:

- `api/products.js`: sanitized public product catalog.
- `api/create-order.js`: trusted zero-dollar order flow.
- `api/order-status.js`: public-safe order lookup.
- `api/feedback.js`: validated/database-rate-limited feedback insert.
- `api/chat.js`: Luna backend and Luna Review writer.
- `api/luna-insights.js`: Management-authenticated Luna Review GET/PATCH route; historical filename retained.
- `api/stripe.js`: consolidated Stripe config/session/confirm/webhook handler.
- `api/supabase-config.js`: browser-safe Supabase URL/anon-key response.

Server helpers:

- `api/_catalog.js`: trusted catalog, GL mapping, public catalog sanitization.
- `api/_stripe-checkout.js`: Stripe key gate, API calls, Session/order lifecycle, verification, events, and emails.
- `api/_supabase.js`: service-role Supabase REST helper.
- `api/_rate-limit.js`: in-memory instance-local rate limiting.
- `api/order-emails.js`: Resend email construction/sending helper.

There is no active `/api/create-payment` or `/api/square-config` route.

Because Vercel Hobby has function limits, inspect the deployed function count before adding new API files. Prefer careful consolidation where ownership remains clear.

## 6. Resident Portal And Store

Resident features:

- Luxury home experience and public building information.
- Store product cards, category filters, search, inventory status, and cart.
- Dedicated checkout.
- Public-safe order tracking by BrickellHouse order number.
- Feedback submission.
- Luna assistant.

LocalStorage is temporary resident UI/cache state only:

- `bh_products`: resident-safe product cache.
- `bh_cart`: product IDs and quantities.
- `bh_fee_settings`: public fee display settings only.
- `bh_catalog_version`: cache compatibility marker.

`publicProduct()` strips data to resident-safe fields: ID, resident name, category, description, price, inventory, image, and active state. Old browser order storage is removed.

Catalog behavior:

- `/api/products` returns only active products with inventory above zero.
- Successful catalog refresh reconciles saved cart quantities against the current active catalog.
- Inactive, missing, zero-inventory, or invalid saved-cart products are removed.
- Products remain in Supabase for future Management reactivation; active/inactive state is not hardcoded into architectural docs or resident logic.
- Product images use the API `image` field, preserving valid Supabase image URLs and falling back only when missing.

The Store may render local fallback data while the public API is unavailable, but dedicated checkout will not proceed unless current product availability is confirmed successfully.

## 7. Product, Price, And Accounting Trust Flow

Exact trust flow:

1. Approved Management users edit products through `management/dashboard.js` and authenticated Supabase access.
2. Supabase stores resident name, internal name, GL code, price cents, inventory, image URL, and active status.
3. Migration 012 removes anon read access to full `public.products` rows.
4. `/api/products` uses service role to load the trusted catalog, filters inactive/out-of-stock rows, and returns resident-safe fields only.
5. Resident Store/cart uses that sanitized response.
6. Checkout sends product IDs and quantities only. Browser prices/totals are display-only.
7. `api/_stripe-checkout.js` or `api/create-order.js` reloads the trusted server catalog.
8. Server validates product existence, active state, inventory, integer quantity, and bounds.
9. Server computes subtotal and `PROCESSING_FEE_PERCENT`; client-submitted price/fee/total values are ignored.
10. Stripe and Supabase receive server-derived values.

Accounting rules:

- Standard purchasable products use GL `40090`.
- Valet products use GL `40033`.
- The server-side mapping in `api/_catalog.js` is authoritative for checkout.
- Stripe customer-facing product names and descriptions are clean resident names.
- Stripe Session and PaymentIntent metadata contain `gl_code` as `40090`, `40033`, or `40090,40033` depending on the order.
- Metadata also contains order number, legal version, compact item IDs/quantities, and trusted calculated totals.
- Stripe metadata does not contain resident name, email, phone, unit, or legal acceptance timestamp.
- Supabase `order_items` keeps resident-name, internal-name, and GL snapshots.
- Management and exports retain internal accounting names and GL codes.
- Resident Store, resident checkout, resident confirmation, resident email, Luna, and `/api/products` remain clean.

## 8. Dedicated Checkout And Legal Review

Navigation and reconciliation:

- Store cart/bag Continue navigates to `checkout.html`.
- Cart survives navigation through localStorage.
- Checkout refreshes `/api/products` before enabling submission.
- Inactive, missing, unavailable, and invalid-quantity items are reconciled out.
- Empty and catalog-unavailable states block checkout safely.

Before Stripe mount, the page shows:

- Order Summary.
- Resident/contact information.
- Secure checkout notice.
- Amount due.
- Legal-review state.
- Continue to secure payment button.

Mandatory legal flow:

1. Legal state begins unaccepted; there is no directly operable checkbox.
2. Resident opens Review Legal Terms.
3. The modal shows the complete existing `legal.js` content and current version without rewriting or summarizing it.
4. Accept Legal Terms starts disabled.
5. Resident must scroll the actual legal-content container to the bottom. Bottom detection uses a 12-pixel tolerance.
6. Reaching the bottom only enables Accept; it does not accept automatically.
7. Resident must explicitly click Accept Legal Terms.
8. That click records the current legal version and exact acceptance timestamp, closes the modal, and updates the accepted state.
9. Cancel, close, Escape, or backdrop close before acceptance leaves the state unaccepted and resets scroll progress to the top.
10. Continue remains disabled until resident fields, cart/catalog, and accepted legal state are all valid.

Accessibility/responsiveness:

- Focus enters the legal panel and returns to the opening control.
- Keyboard focus is contained while the dialog is open.
- Escape cancels without accepting.
- Background page scrolling is locked.
- Mobile uses a near-full-height panel with its own touch-scrolling legal container.
- No heavy backdrop blur is used.

Submission and focused payment state:

- Resident must intentionally submit once after validation.
- `paymentInProgress` and existing `stripeEmbeddedCheckout` guards block duplicate form submission.
- Stripe mounts only after successful server Session creation.
- After mount, resident/contact fields, legal state, secure notice, Continue button, and pre-payment fine print are removed from layout.
- Order Summary and amount due remain visible.
- Stripe becomes primary content.
- The page scrolls once per mounted checkout instance to Stripe, smoothly unless reduced motion is requested.
- There is no Edit contact details flow after Session creation. Submitted resident details are locked for that attempt.
- If Session creation or mount fails, the pre-payment state is restored and the resident-safe error is shown.

## 9. Stripe Payments

### Active consolidated route

- `GET /api/stripe?action=config`
- `POST /api/stripe?action=session`
- `POST /api/stripe?action=confirm`
- `POST /api/stripe?action=webhook`

Config response contains only browser-safe enabled/provider/mode state and the publishable key when enabled. Secret/webhook keys never reach the browser.

### Provider and key gate

- Paid Stripe operations require `CHECKOUT_PROVIDER=stripe`.
- Missing, invalid, or non-Stripe provider values fail closed and do not create/reconcile Stripe orders.
- Matching test keys are accepted without the live gate.
- Matching live keys require `STRIPE_MODE=live` or `STRIPE_ALLOW_LIVE=true`.
- Mixed test/live key pairs and unknown prefixes are rejected.
- Production live payments currently work. Do not switch production to test keys casually.

### Session creation

1. Enforce 5 Session attempts per IP per 10 minutes.
2. Verify required Supabase Stripe columns/tables are available.
3. Validate resident, email, normalized U.S. phone, cart, and legal evidence.
4. Reload trusted products and compute amounts.
5. Create the Pending Supabase `orders` row.
6. Create all related `order_items` snapshots.
7. If order-item insertion fails, delete the incomplete Pending header when possible and do not create Stripe Session.
8. Create Stripe Embedded Checkout Session only after order/items exist.
9. Patch the Pending order with Session/PaymentIntent references.

### Fulfillment

Both confirm and webhook retrieve Stripe Session state server-side. Fulfillment requires:

- `payment_status=paid`.
- USD currency.
- Existing matching Pending/paid Stripe order.
- Matching Stripe Checkout Session ID.
- At least one stored order item.
- Stripe amount equal to stored trusted total.

Fulfillment writes Stripe IDs only to processor-neutral/Stripe columns, never `square_payment_id`, marks the order Paid, and sends resident/Management emails.

Webhook details:

- Not application-rate-limited.
- Fails closed unless provider is Stripe.
- Requires `STRIPE_WEBHOOK_SECRET`.
- Verifies timestamp/signature against the raw body with a five-minute tolerance and timing-safe comparison.
- Processes paid `checkout.session.completed` events.

Idempotency:

- Confirm and webhook derive the same logical processor payment event reference: `stripe_payment_<payment-intent-or-session>`.
- Migration 011 unique indexes prevent duplicate Stripe Session/PaymentIntent/charge/order-event identifiers.
- Repeated confirm/webhook fulfillment reuses the existing order rather than creating another paid order.
- Resend uses payment/order-derived idempotency keys for resident and Management messages.

Current return URL:

```text
/?stripe_session_id={CHECKOUT_SESSION_ID}
```

This intentionally returns to `index.html`, not `checkout.html`. Root `roadmap.js` confirms the Session, clears the cart after verified success, removes the query parameter, and shows the polished confirmation. Do not change this casually.

### Square retirement

- No active Square config/payment route exists.
- No Square SDK is initialized by resident pages.
- Missing/invalid provider may still normalize to a historical `square` label as a fail-closed state; this does not provide Square checkout.
- Keep `square_payment_id` and historical reporting support.
- See `SQUARE_SETUP.md` for the archived notice.

## 10. Zero-Dollar Orders

`POST /api/create-order` is retained for orders whose trusted server total is zero.

It validates resident/contact/legal/cart data, reloads trusted products, computes totals, rejects any positive total, and writes order/order-item/payment-event records with `No Payment Required` status.

Known follow-up: free/zero-dollar order email behavior requires verification/fix. The current zero-dollar route does not call the paid-order Resend helper.

## 11. Management Portal

Auth model:

- Supabase Auth validates the user/session.
- The authenticated user must also have an active matching `management_users` row.
- Unapproved/inactive users are rejected and signed out.
- Supabase RLS protects Management tables; hiding the URL/UI is not the security boundary.
- `api/luna-insights.js` independently validates Bearer token and active Management approval.
- MFA schema fields exist from earlier migrations, but do not enforce MFA unless the corresponding UI/process is verified.

Management capabilities:

- Overview metrics and low inventory.
- Monthly revenue chart, year selector, order count, tooltips, and product-level month drill-down.
- Profit-margin axis remains a placeholder; do not invent cost/margin data.
- Product creation/editing, price, inventory, active status, internal name, and GL code.
- Orders, status, public/private notes, legal evidence, processor references, and search.
- Order and feedback CSV/Excel-compatible exports.
- Feedback filtering, response, internal notes, status, and deletion.
- Processing-fee settings.
- Best-effort audit logging.
- Luna Review queue, thread view, status, Management note, and export.

Historical Square and current Stripe identifiers remain compatible in order mapping/reporting.

## 12. Supabase And Migrations

Supabase roles:

- Browser resident: no direct product-table reads after migration 012; uses `/api/products`.
- Browser Management: anon key plus authenticated user JWT, restricted by RLS and `is_management_user()`.
- Server routes: service-role key through `api/_supabase.js`.

Main tables:

- `management_users`, `management_user_requests`.
- `products`, `portal_settings`.
- `orders`, `order_items`, `payment_events`.
- `feedback`, `audit_logs`.
- Legacy privacy-safe `luna_insights`.
- Active `luna_conversation_reviews`.

Migration summary:

1. `001_management_auth_rls.sql`: core schema/RLS.
2. `002_management_users_auth.sql`: Management Auth/profile refinements.
3. `003_management_security_hardening.sql`: table/policy/grant hardening, requests/events/admin functions.
4. `004_resident_persistence_grants.sql`: service-role persistence grants and feedback insert repair.
5. `005_storage_permission_repair.sql`: service-role/default privilege and policy repair.
6. `006_feedback_completed_status.sql`: Completed feedback status.
7. `007_feedback_rate_limit.sql`: normalized feedback identifiers/IP and rate-limit indexes.
8. `008_luna_insights_redacted.sql`: legacy privacy-safe aggregate Luna Insights schema and 365-day purge.
9. `009_luna_insights_service_role_grants.sql`: service-role Luna Insights and Management-user grants. Applied.
10. `010_luna_conversation_reviews.sql`: anonymous 90-day raw conversation review table/RPCs/RLS. Applied.
11. `011_stripe_parallel_foundation.sql`: provider-neutral/Stripe columns and unique indexes while preserving Square history. Applied.
12. `012_lock_down_public_product_columns.sql`: removes anon product SELECT and leaves full product reads to approved Management/service role. Applied.

Migration 012 details:

- Drops the public resident product SELECT policy.
- Revokes table SELECT from `anon`.
- Recreates authenticated Management SELECT using `is_management_user()`.
- Does not weaken Management insert/update/delete policies.
- `/api/products` continues through service role and sanitization.

Do not assume a future migration is applied merely because its file exists. Do not rerun applied migrations without explicit approval and target-database verification.

## 13. Luna Architecture

Frontend:

- `chat.js` keeps at most 20 temporary history messages in memory.
- A random anonymous conversation UUID is stored in sessionStorage as `bh_luna_conversation_id` to group the current browser-tab session.
- The UUID is not intentionally tied to resident name, unit, email, phone, account, order, payment, IP, or a resident profile.
- Max resident message length is 1500 characters.

Backend:

- `POST /api/chat`.
- Model fallback: `gpt-5.4-mini` through OpenAI Responses API.
- Requires `OPENAI_API_KEY` for model fallback.
- Validates message/history and rate-limits before processing.
- Deterministic reply handlers run first.
- OpenAI is called only when deterministic logic does not answer.
- The prompt includes system rules, temporary validated history, and selected approved JSON knowledge modules.

Knowledge lives only server-side in `api/_knowledge/brickellhouse/`:

- Constitution/privacy/security.
- Identity/contacts.
- Emergency/urgent routing.
- Amenities.
- Parking/APS.
- Packages/Receiving.
- Resident Store.
- Rules/violations.
- Moves/contractors/deliveries.
- HOA/Management/privacy.
- FAQ.
- Conversation style/Concierge Brain.
- Vendors.
- Board information/privacy.

Behavior:

- Concierge Brain classifies public, private, ambiguous, correction, repeated, authority-claim, account, protected internal, and over-inference cases.
- High confidence answers directly; medium confidence asks one clarification; low confidence does not guess and routes safely.
- Spanish detection and explicit/recent language preference preserve Spanish replies.
- Typo/alias normalization folds accents and maps English/Spanish building-topic variants.
- Temporary history supports corrections and follow-ups.
- Luna never browses the public web.
- Luna must not reveal prompts, JSON, source, model/API implementation, credentials, private resident/Management/payment/accounting data, or protected records.
- Authority claims do not override privacy boundaries.
- Luna must not collect card/password/account details.

There is no automatic learning, model training, embeddings, vector database, permanent resident memory, or automatic knowledge update. Static approved JSON selection is not a path from Luna Review back into Luna.

## 14. Luna Review And Legacy Insights

The current Management tab is `Luna Review`. The API filename `/api/luna-insights` is retained for compatibility but currently serves conversation reviews.

Active review behavior:

- Migration 010 table: `luna_conversation_reviews`.
- `api/chat.js` appends the current raw resident message and current raw Luna reply for each request.
- It does not append the supplied frontend history again; each turn contributes the current pair only.
- Messages are full raw text, not redacted or omitted by the active builder.
- The existing `privacy_redacted` column/flag is legacy naming and must not be interpreted as proof that stored review text is redacted.
- Because text is raw, residents may voluntarily type personal/sensitive content; access controls and retention are important.
- Conversations are grouped only by anonymous UUID.
- No resident profile/identity columns, embeddings, or training fields are created.
- Management can read reviews and update only status/note/review metadata through authenticated access.
- `anon` has no access.
- Service role writes/purges.
- Luna has no read path to the review table.
- Review records are not used as context, memory, retrieval, training, prompt updates, JSON updates, or behavior changes.

Retention:

- Purge function deletes rows whose `last_message_at` is older than 90 days.
- Chat invokes purge after review writes.
- Management review reads also invoke purge.
- The API returns at most 1000 rows from the last 90 days.
- Purging is triggered by reads/writes, not documented as an independent scheduled job.

Legacy Luna Insights:

- Migration 008 created privacy-safe aggregate/redacted `luna_insights` with 365-day retention behavior.
- Migration 009 grants service-role access and is applied.
- `api/chat.js` still contains legacy aggregate/redaction helper code, but the current request handler logs the Luna Review path, not the legacy aggregate helper.
- Do not describe the active Management Review as redacted aggregate analytics.

## 15. Rate Limiting And Abuse Protection

Application limits:

- Stripe Session creation: 5 attempts per IP per 10 minutes.
- Luna chat: 30 messages per IP per 10 minutes.
- Order status lookup: 30 lookups per IP per 10 minutes.
- Feedback: database-backed maximum 2 matching submissions per 96 hours across normalized email, phone, unit, or request IP.
- Stripe config, confirm, and webhook are not application-rate-limited; webhook must remain unthrottled by the in-app limiter for reliable processor delivery.
- Management functions are not covered by the public in-memory limiter; they rely on Auth/RLS/server checks.

`api/_rate-limit.js` stores buckets in process memory. Serverless instances do not share the map, so these limits are conservative local-instance protection, not globally distributed enforcement.

Cloudflare owner-confirmed Luna rule:

- 5 requests per IP per 10 seconds.
- 10-second block when exceeded.

This external rule is not represented by repository source. Do not change it without explicit infrastructure approval.

## 16. Security State

Current protections:

- Migration 012 blocks direct anon full-row product reads.
- `/api/products` returns a sanitized active catalog only.
- Resident bundles contain no GL/internal/Management accounting logic.
- Management uses dedicated authenticated code and Supabase RLS.
- Server-only keys remain server-side.
- Only the Stripe publishable key and Supabase anon key are expected browser-visible credentials.
- Stripe webhook verifies raw-body signatures and fails closed without provider/secret/signature.
- Client cannot set trusted product price, subtotal, fee, total, GL code, payment status, or paid state.
- Public order lookup returns only order number, public status/note, and created time.
- Luna Review requires approved Management access.
- `.env`, `.env.*`, `.env.local`, and `.vercel` are ignored; `.env.example` is tracked intentionally and contains placeholders only.
- Old Square `privateAccounting` response route no longer exists because the Square payment route was removed.

Important caveats:

- Public/browser JavaScript is always inspectable; do not put secrets/private fields in it.
- Frontend legal scroll gating is a UI/legal-review requirement. Backend independently requires legal acceptance/version evidence but cannot prove physical reading behavior.
- In-memory rate limits are not globally distributed.
- CSP and RLS changes require careful review.

## 17. Environment Variables

Use `.env.example` for names only. Never document real values.

Checkout/Stripe:

- `CHECKOUT_PROVIDER`
- `STRIPE_MODE`
- `STRIPE_ALLOW_LIVE`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_API_VERSION` (source default `2025-06-30.basil`)
- `PROCESSING_FEE_PERCENT` (source default 3)

Supabase:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Email/AI:

- `RESEND_API_KEY`
- `OPENAI_API_KEY`

Optional Management bootstrap script:

- `MANAGEMENT_EMAIL`
- `MANAGEMENT_TEMP_PASSWORD`

Resend sender and Management recipient addresses are currently source constants, not environment variables.

There are no active Square environment variables.

## 18. Deployment And Local Development

Vercel:

- Plan: Hobby.
- Project root: repository root.
- Framework: Other/static.
- No build command.
- Keep function count within Hobby limits; inspect before adding handlers.
- Static assets use cache-version query strings. Update only necessary page references when resident JS/CSS changes.

Full local development:

```powershell
npm install
npx vercel dev --listen 4173
```

Open `http://localhost:4173/`.

Static-only servers cannot exercise Vercel API routes, Stripe, Supabase server access, Luna, feedback persistence, order lookup, or Management Auth.

Controlled deployment:

1. Read this file.
2. Inspect `git status --short` and exact diff.
3. Confirm only authorized files changed.
4. Confirm no secrets/private exports are staged.
5. Run relevant syntax/static/manual checks.
6. Check Vercel function count.
7. Commit/push reviewed work.
8. Use preview where safe.
9. Deploy production only after explicit approval.
10. Do not submit a production payment unless explicitly authorized.

Rollback:

- Redeploy last known-good Vercel deployment or revert the reviewed commit.
- Restore previously approved environment/Cloudflare settings rather than improvising.
- Never use destructive Supabase rollback; prepare reviewed compensating SQL after backup.

## 19. Known Follow-Ups

1. Free/zero-dollar order email behavior requires verification/fix.
2. Abandoned/stale Pending Stripe order cleanup remains a future operational improvement.
3. Stripe payment-event ordering cleanup is non-blocking future work. Current fulfillment records the idempotent payment event before all pending-order match/line-item/amount checks complete.
4. Generic public API error-message cleanup remains pending; avoid exposing backend permission/storage detail.
5. Production monitoring, uptime checks, error aggregation, and alerting are recommended.
6. Privacy-policy destination/disclosure remains to be completed.
7. Old encoding/mojibake and accessibility cleanup remain lower-priority separate work.
8. Legacy/dormant Square labels, archived pages, CSS selectors, and compatibility variable names remain in some source. Do not confuse them with an active Square path, and do not remove historical compatibility casually.
9. Some localStorage operations and newer browser syntax may still merit a separate Safari resilience review.
10. Legacy aggregate Luna Insights helper code remains in `api/chat.js` but is not the active review logger.

## 20. Protected File Areas

Require explicit task scope and careful review:

- `api/stripe.js`
- `api/_stripe-checkout.js`
- `api/_catalog.js`
- `api/_supabase.js`
- `api/create-order.js`
- `api/order-emails.js`
- `api/chat.js`
- `api/luna-insights.js`
- `api/feedback.js`
- `auth.js`
- `management/dashboard.js`
- Supabase migrations/RLS/grants
- `legal.js` and checkout acceptance flow
- Product synchronization and GL mapping
- CSP meta tags
- Environment/deployment/Cloudflare configuration

UI-only work must not spill into these systems unless the task explicitly requires it.

## 21. Safe Continuation Checklist

For every new Codex conversation:

1. Open `C:\Users\Admin\Documents\brickellhouse-portal`.
2. Read `SESSION_RESUME.md` completely.
3. Run `git status --short` and preserve unrelated user changes.
4. Inspect relevant source instead of relying only on documentation.
5. Use `.env.example` for names; do not print `.env.local`.
6. Remember 009, 010, 011, and 012 are already applied.
7. Remember Square is inactive and live Stripe works.
8. Preserve resident/Management separation and public GL privacy.
9. Preserve mandatory legal review and payment-focused checkout.
10. If touching Luna Review, remember it stores raw current message/reply pairs for 90 days and Luna cannot read them.
11. Do not deploy, run migrations, change live settings, or submit payments without approval.

Recommended non-destructive smoke checks after authorized changes:

- Resident home/Store/cart render.
- `/api/products` contains no internal/GL fields.
- Checkout reconciliation and legal review work.
- Continue stays disabled until all requirements are satisfied.
- Payment-focused state activates only after successful Stripe mount.
- Management login/approval and RLS remain effective.
- Products/orders/revenue/feedback/settings/exports/Luna Review load.
- Luna answers approved questions, refuses protected requests, and maintains Spanish context.
- No resident bundle contains GL/internal/Management terms.

## 22. Final State Statement

As of 2026-07-13, BrickellHouse Portal is a live Vercel Hobby/Supabase application using production Stripe Embedded Checkout, Resend, OpenAI-backed Luna, Cloudflare protection, a dedicated legal-gated checkout, separated resident/Management bundles, protected internal accounting, and Management-only 90-day Luna Review.

The most important continuation facts are:

- Live Stripe cards and Apple Pay work; eligible Google Pay is enabled.
- Square is retired from active checkout.
- Migrations 009-012 have already been run successfully.
- Migration 012 blocks anon full product reads.
- Luna Review stores raw current message/reply pairs under anonymous UUIDs for 90 days; Luna cannot read them and no automatic learning occurs.
- Working payment verification, trusted pricing, RLS, resident/Management separation, GL privacy, and live key configuration are protected systems.
