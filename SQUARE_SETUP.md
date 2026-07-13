# Square Integration Retired

Square is no longer an active payment provider in the BrickellHouse Portal.

Do not configure Square credentials, restore the removed Square API routes, load the Square Web Payments SDK, or use this file as an active setup guide. Production checkout uses Stripe Embedded Checkout through the consolidated `/api/stripe` route.

## Active Payment System

- Live Stripe card payments and Apple Pay are working in production.
- Google Pay is available where Stripe, the browser, device, and wallet configuration are eligible.
- Residents check out through `checkout.html`.
- The browser uses `GET /api/stripe?action=config`, then intentionally requests a Session with `POST /api/stripe?action=session`.
- Confirmation and webhook fulfillment use `POST /api/stripe?action=confirm` and `POST /api/stripe?action=webhook`.
- Stripe secret keys and the webhook secret remain server-only.
- Trusted pricing, product validation, GL mapping, pending-order creation, payment verification, and fulfillment remain server-side.

See `SESSION_RESUME.md` and `DEPLOYMENT.md` for the current architecture and protected production process.

## Historical Square Compatibility

Historical Square records remain supported intentionally:

- Existing `orders.square_payment_id` and `payment_events.square_payment_id` columns must not be deleted or repurposed.
- Historical Square rows may still appear in Management reporting and exports.
- Stripe IDs are stored only in processor-neutral or Stripe-specific columns and must never be written to `square_payment_id`.
- The `payment_provider` schema accepts `square`, `stripe`, and `none` so historical data remains valid.
- Some archived pages, CSS selectors, migration comments, display aliases, or fallback labels may still mention Square. They are not an active Square checkout path.

## Retired Route Notice

The former public Square routes are gone. There is no active:

- `/api/square-config`
- `/api/create-payment`

There is also no active Square SDK initialization in the resident frontend. Do not recreate these routes without a separately approved payment-migration project and a full security review.

## Protected Rule

Do not switch production back to Square or to Stripe test keys casually. The live Stripe payment flow is a protected production system and must not be changed, deployed, or reconfigured without explicit approval.
