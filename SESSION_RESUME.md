# BrickellHouse Session Resume

## Project Path
`C:\Users\Admin\Documents\Codex\2026-06-12\can-you-build-a-website-or\outputs\brickellhouse-portal`

## Tech Stack
HTML5, CSS3, vanilla JavaScript, browser `localStorage`; no backend or framework yet.

## Current Status
- Luxury, responsive resident storefront with 15 products/services.
- Cart and resident checkout include a configurable processing-fee breakdown.
- Hidden GL codes, unique order numbers, and MM/DD/YYYY dates are implemented.
- Management dashboard supports products, inventory, orders, search, reports, and CSV export.
- Attorney-provided Legal Notice and Limitation of Liability is displayed verbatim at checkout.
- Checkout submission is disabled until the resident accepts the legal notice.
- New orders store acceptance status, date/time, order association, and legal notice version.
- Management orders and CSV exports include legal acceptance evidence.
- Square Web Payments SDK support and Vercel payment routes are Sandbox-ready.
- Paid checkout remains unavailable when Square Sandbox environment variables or serverless routes are absent.
- Products include private internal/Square names and GL mappings hidden from residents.
- Resident feedback supports categories, confirmation, management statuses, responses, notes, filters, and export.
- Residents can track an order by ID; management controls status and public/private notes.

## Critical Rules
- Never show GL codes to residents; restrict them to management and private accounting data.
- Never put Square secrets or access tokens in frontend code.
- Keep dates month/day/year and ensure every order number is unique.
- Preserve mobile usability and existing features unless the user approves changes.
- Do not upload, deploy, or use live Square credentials without explicit approval.

## Known Issues
- Data is stored only in `localStorage` and can be lost.
- Management has no authentication.
- No real database, management authentication, resident verification, or email delivery.
- Square Sandbox requires Vercel environment variables and has not been connected to an account.
- Local Python hosting cannot execute the Vercel `api/` payment routes.
- Historical sample orders include older products.
- Historical orders show legal acceptance as "Not recorded."
- Separate attorney-approved Terms & Conditions and Privacy Policy text have not been provided.
- Clean up malformed source characters such as `â†’`.

## Local Test
From the project folder:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/#shop`.

## Next 3 Tasks
1. Add approved Terms & Conditions and Privacy Policy to the versioned acceptance system.
2. Migrate prototype records to Supabase and add management authentication.
3. Configure and test Square Sandbox in a Vercel preview deployment.

## Continuation Prompt
Inspect `SESSION_RESUME.md`, `index.html`, `styles.css`, and `app.js`, test the existing portal locally, preserve all critical rules, and continue with my next requested change. Do not upload or deploy without approval.
