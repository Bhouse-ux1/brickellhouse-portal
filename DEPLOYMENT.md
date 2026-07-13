# BrickellHouse Portal Deployment

This is a protected production deployment. Do not deploy, change environment settings, run migrations, or submit payments without explicit approval.

## Production Architecture

- Domain: `https://portal.brickellhouse.org/`
- Hosting/functions: Vercel Hobby.
- Edge/DNS protection: Cloudflare.
- Database/Auth/RLS: Supabase.
- Payments: live Stripe Embedded Checkout.
- Email: Resend.
- AI: OpenAI for Luna fallback.
- Source: static HTML/CSS/JavaScript plus Node serverless handlers in `api/`.

Stripe operations are consolidated into `/api/stripe` to help remain within Vercel Hobby function limits.

## Repository Root

```text
C:\Users\Admin\Documents\brickellhouse-portal
```

Use the repository root as the Vercel project root. Framework preset: Other/static. There is no application build step.

## Environment Variables

Use `.env.example` for names only. Never put real values in documentation, frontend source, Git, screenshots, or chat output.

Confirmed source variables:

- `CHECKOUT_PROVIDER`
- `STRIPE_MODE`
- `STRIPE_ALLOW_LIVE`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_API_VERSION`
- `PROCESSING_FEE_PERCENT`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `OPENAI_API_KEY`
- `MANAGEMENT_EMAIL` (optional bootstrap script)
- `MANAGEMENT_TEMP_PASSWORD` (temporary bootstrap script)

`STRIPE_PUBLISHABLE_KEY` is expected in the browser-safe config response. Stripe secret and webhook keys must remain server-only.

The Stripe key gate accepts matching test keys by default. Matching live keys are accepted only when `CHECKOUT_PROVIDER=stripe` and either `STRIPE_MODE=live` or `STRIPE_ALLOW_LIVE=true`. Mixed test/live keys are rejected. Production is currently using working live payments; do not switch it back to test keys casually.

## Stripe Endpoints

- `GET /api/stripe?action=config`
- `POST /api/stripe?action=session`
- `POST /api/stripe?action=confirm`
- `POST /api/stripe?action=webhook`

Configure Stripe's webhook destination to the production `/api/stripe?action=webhook` URL. The webhook fails closed unless Stripe is the configured provider and the signature verifies with `STRIPE_WEBHOOK_SECRET`.

Stripe Embedded Checkout currently uses this server-generated return URL:

```text
https://portal.brickellhouse.org/?stripe_session_id={CHECKOUT_SESSION_ID}
```

The return goes to the resident root page, whose `roadmap.js` confirms the Session, clears the cart after verified success, and shows the confirmation state. Do not change this return behavior casually.

## Supabase Migration State

Owner-confirmed production state as of 2026-07-13:

- `008_luna_insights_redacted.sql`: applied.
- `009_luna_insights_service_role_grants.sql`: applied.
- `010_luna_conversation_reviews.sql`: applied.
- `011_stripe_parallel_foundation.sql`: applied.
- `012_lock_down_public_product_columns.sql`: applied.

Do not rerun or modify migrations merely because their files exist. Confirm the target database state and obtain explicit approval before any future migration.

## Controlled Deployment Process

1. Read `SESSION_RESUME.md`.
2. Run `git status --short` and inspect the exact diff.
3. Confirm only authorized files changed.
4. Confirm `.env`, `.env.local`, secrets, private exports, and `.vercel/` are not staged.
5. Run syntax/static checks appropriate to the change.
6. For frontend changes, update only necessary cache-version query strings.
7. Commit and push the reviewed change.
8. Use a Vercel preview when the change can be tested safely without production data.
9. Verify Vercel Hobby function usage remains within plan limits.
10. Deploy production only with explicit approval.
11. Perform non-destructive smoke tests. Do not submit a real payment unless specifically authorized.

## Production Smoke Tests

- Resident home page, navigation, Store, cart, tracking, feedback, and Luna render.
- `GET /api/products` returns active resident-safe fields only.
- Inactive or unavailable products are removed from refreshed catalog/cart state.
- Bag navigation opens `checkout.html` with the cart preserved.
- Legal review requires opening, scrolling to the end, and explicit acceptance.
- Continue remains disabled until resident data and legal acceptance are valid.
- Stripe config exposes only enabled/provider/mode and the publishable key.
- Embedded Checkout mounts only after intentional submission.
- After mount, Order Summary remains and completed pre-payment sections hide.
- Management login rejects unapproved users.
- Products, orders, revenue, feedback, settings, exports, and Luna Review load under approved Management access.
- Luna respects privacy, Spanish behavior, prompt protection, and rate limits.

Paid checkout, wallet, webhook, and email tests require a separately authorized test plan because production live payments are working.

## Rollback

- Frontend/API: redeploy the last known-good Vercel deployment or revert the reviewed commit.
- Environment error: restore previously approved Vercel values and redeploy.
- Stripe issue: do not improvise key/provider changes; restore the last approved configuration.
- Supabase issue: do not use destructive rollback. Inspect, back up, and prepare compensating SQL for review.
- Cloudflare issue: restore the last approved rule/configuration.

## Cache Control

Resident HTML uses static asset query strings such as `app.js?v=...` and `styles.css?v=...`. When resident JavaScript or CSS changes, update only the pages that need the new asset version. Avoid unrelated cache churn.
