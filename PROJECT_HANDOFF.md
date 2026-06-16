# BrickellHouse Portal Handoff

## Purpose

A luxury, mobile-friendly resident e-commerce portal for BrickellHouse Condominium. Residents can purchase building services and products, while management can control inventory, pricing, orders, GL codes, fees, and reports.

## Tech Stack

- Plain HTML5
- CSS3 with responsive layouts and animations
- Vanilla JavaScript
- Browser `localStorage` for prototype data
- No framework or backend yet
- Square Payments is displayed but not connected yet

## Project Path and Structure

```text
C:\Users\Admin\Documents\Codex\2026-06-12\can-you-build-a-website-or\outputs\brickellhouse-portal

brickellhouse-portal/
├── index.html
├── styles.css
├── app.js
├── legal.js
├── roadmap.js
├── api/
│   ├── _catalog.js
│   ├── square-config.js
│   └── create-payment.js
├── payment-success.html
├── payment-failure.html
├── README.md
├── SQUARE_SETUP.md
├── SUPABASE_MIGRATION.md
├── DEPLOYMENT.md
├── FUTURE_ROADMAP.md
├── .env.example
├── bh-logo-transparent.png
├── bh-logo-official.png
├── brickellhouse-front.webp
├── brickell-pool.webp
├── catalog-beach.webp
├── offer-*.webp
└── additional older image assets
```

## Already Built

- Luxury BrickellHouse design and official transparent logo
- Animated beach/water catalog background
- Rooftop pool closing section
- Responsive mobile product catalog
- 15 current resident products and services
- Product images, categories, search, inventory, and cart
- Resident checkout fields
- Processing-fee calculation and checkout breakdown
- Unique randomized order numbers
- Dates formatted month/day/year
- Hidden product and processing-fee GL codes
- Management dashboard
- Product creation and editing
- Inventory and inactive-product controls
- Order viewing and searching
- Search by unit, order, resident, email, phone, product, or GL code
- Revenue filters and monthly reporting
- CSV/Excel-compatible order export
- Low-inventory list for quantities of 15 or fewer
- Management contact email, telephone, and extensions
- Versioned Legal Notice and Limitation of Liability modal using attorney-provided text
- Required legal acceptance before resident order submission
- Legal acceptance date/time and document version stored with new order line items
- Legal acceptance evidence in management orders and CSV exports
- Square Sandbox-ready Web Payments SDK and secure Vercel payment endpoint
- Server-side product/amount validation and Square idempotency keys
- Payment success, failure, pending, paid, failed, and demo states
- Private internal/Square product names and GL mappings
- Resident feedback center with all five requested categories
- Feedback management statuses, filters, responses, notes, deletion, and export
- Resident order tracking by order ID
- Management order statuses, public pickup notes, and private internal notes
- Dedicated payment success and failure pages
- Content Security Policy for Square payment assets

## Still Needed

- Secure backend and database
- Management login and permissions
- Resident/unit verification
- Email receipts and management notifications
- Order status, fulfillment, refunds, and cancellations
- Production hosting, backups, audit logs, privacy policy, and terms
- Attorney-approved Terms & Conditions and Privacy Policy text

## Known Issues

- Data currently exists only in the browser's `localStorage`.
- Clearing browser data can erase products, settings, and orders.
- Management is not password protected.
- Square checkout is currently a visual prototype.
- Square code is Sandbox-ready but cannot charge until Vercel environment variables are configured.
- The local Python server does not run Vercel functions, so paid checkout is intentionally unavailable there.
- Legal acceptance records remain browser-local until Supabase/backend storage is added.
- Historical orders correctly show legal acceptance as "Not recorded."
- Sample historical orders reference some older products.
- Some unused older images remain in the folder.
- Some source strings contain malformed characters such as `â†’`.
- Testing through a local server is preferred over `file:///`.

## Continue in a New Session

1. Open the workspace at:

```text
C:\Users\Admin\Documents\Codex\2026-06-12\can-you-build-a-website-or
```

2. Read `SESSION_RESUME.md`, then inspect `index.html`, `styles.css`, and `app.js`.
3. Start the local server from the portal folder:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

4. Test at `http://127.0.0.1:4173/#shop`.
5. Do not upload or deploy without explicit approval.

## Critical Store and Square Rules

- Residents must never see GL codes.
- GL codes may appear only in protected management reports and private accounting data.
- Never place Square secrets or access tokens in `app.js`.
- Live Square requests must go through a secure backend.
- Use Square Sandbox before production.
- Store authoritative GL information in the private database.
- Use idempotency keys to prevent duplicate charges.
- Confirm payment server-side before confirming an order.
- Clearly disclose processing fees before payment.
- Keep dates in MM/DD/YYYY format.
- Every order number must be unique.
- Treat resident and unit information as private data.

## Recommended Next Steps

1. Add approved Terms & Conditions and Privacy Policy to the versioned acceptance system.
2. Migrate records to Supabase and add role-based management authentication.
3. Configure Square Sandbox in Vercel and complete approved/declined-card testing.

## Continuation Prompt

```text
Continue building my BrickellHouse resident portal in:
C:\Users\Admin\Documents\Codex\2026-06-12\can-you-build-a-website-or\outputs\brickellhouse-portal

Read SESSION_RESUME.md first, then inspect and test the existing files. Preserve the current luxury mobile design and all critical store rules. Do not upload, deploy, remove existing functionality, or use live Square credentials without my explicit approval. Continue with my next requested change.
```
