# BrickellHouse Portal

Production resident-services portal for BrickellHouse Condominium, built with static HTML/CSS/vanilla JavaScript, Vercel serverless functions, Supabase, Stripe, Resend, OpenAI, and Cloudflare.

Production site: `https://portal.brickellhouse.org/`

Project root:

```text
C:\Users\Admin\Documents\brickellhouse-portal
```

Read `SESSION_RESUME.md` completely before development. It is the authoritative technical handoff and protected-systems guide.

## Current Systems

- Resident Portal and Supabase-backed Resident Store.
- Dedicated checkout page at `checkout.html`.
- Live Stripe Embedded Checkout with cards, Apple Pay, and eligible Google Pay.
- Trusted server-side product validation, pricing, legal evidence, and payment fulfillment.
- Supabase orders, order items, payment events, products, settings, feedback, audit data, Auth/RLS, and Luna Review.
- Management Portal for products, orders, revenue, feedback, settings, exports, and Luna Review.
- Resend resident and Management order emails.
- Luna assistant with server-side knowledge, deterministic routing, Spanish, typo normalization, privacy controls, and OpenAI fallback.

Square is retired from the active application. `SQUARE_SETUP.md` is an archive notice only; historical Square database/reporting compatibility is intentionally retained.

## Frontend Separation

- `index.html` loads resident-only `app.js`, `roadmap.js`, `chat.js`, `public-nav.js`, and `legal.js`.
- `checkout.html` loads only resident-safe checkout dependencies: `legal.js`, `app.js`, and `roadmap.js`.
- `management/dashboard.html` loads `management/dashboard.js`; Management accounting, exports, Supabase access, and Luna Review logic are not in resident bundles.

Resident-loaded code and `/api/products` must not expose GL codes, internal names, Management logic, service-role data, or secrets.

## Local Development

Install Node.js LTS, then:

```powershell
npm install
npx vercel dev --listen 4173
```

Open `http://localhost:4173/`.

A static file server can preview layout, but it cannot run `api/`, Stripe, Luna, product synchronization, order tracking, feedback persistence, or Management Auth.

Never commit `.env.local`. Use `.env.example` for variable names only.

## Documentation

- `SESSION_RESUME.md`: authoritative architecture, current state, safety rules, and continuation instructions.
- `DEPLOYMENT.md`: controlled Vercel/Supabase/Stripe deployment process.
- `PROJECT_HANDOFF.md`: shorter project handoff.
- `.env.example`: placeholder-only environment-variable names confirmed from source.
- `SQUARE_SETUP.md`: retired Square notice and historical compatibility rules.

## Protected Production Rules

- Do not change trusted pricing or paid verification casually.
- Do not weaken Supabase RLS or Management approval checks.
- Do not expose GL/internal accounting data publicly.
- Do not merge resident and Management bundles.
- Do not switch production to test keys.
- Do not run migrations or deploy without explicit approval.
