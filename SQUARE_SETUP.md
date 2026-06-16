# Square Sandbox Setup

This project is locked to Square Sandbox. Live Square endpoints are not enabled.

## Where Credentials Go

### Local Testing

Create this private file in the project root:

```text
.env.local
```

Use this structure:

```text
SQUARE_ENVIRONMENT=sandbox
SQUARE_APPLICATION_ID=your_private_sandbox_application_id
SQUARE_ACCESS_TOKEN=your_private_sandbox_access_token
SQUARE_LOCATION_ID=your_private_sandbox_location_id
SQUARE_API_VERSION=2026-05-20
PROCESSING_FEE_PERCENT=3
```

Do not put credentials in `app.js`, `roadmap.js`, HTML, `.env.example`, GitHub, screenshots, or chat. `.gitignore` excludes `.env` and `.env.*` while allowing `.env.example`.

### Vercel Preview Testing

In Vercel:

1. Open the BrickellHouse project.
2. Go to **Settings > Environment Variables**.
3. Add the variables listed above.
4. Apply them to **Preview**. You may also apply Sandbox values to **Development**.
5. Do not add production Square credentials.
6. Redeploy the preview after saving variables.

## Run Locally

Install Node.js LTS, open PowerShell in the project folder, and run:

```powershell
npx vercel dev --listen 4173
```

Open:

```text
http://localhost:4173/
```

The checkout badge should show `SANDBOX`, and a Square card field should appear. If it shows `SANDBOX OFFLINE`, check `.env.local` and restart the command.

## Successful Test Card

Use Square’s Sandbox Visa:

```text
Card number: 4111 1111 1111 1111
CVV: 111
Expiration: Any future month/year
Postal code: A valid US postal code, such as 94103
```

Never use a real card in Square Sandbox.

For a declined-card test:

```text
Card number: 4000 0000 0000 0002
CVV: 111
Expiration: Any future month/year
Postal code: 94103
```

## Test a Successful Payment

1. Add a paid product to the bag.
2. Continue to checkout.
3. Enter test resident details.
4. Read and accept the legal notice.
5. Enter the successful Sandbox card above.
6. Submit the order once.
7. Wait for the BrickellHouse success confirmation and record the order number.

The frontend sends only Square’s one-time payment token to `/api/create-payment`. The access token stays server-side.

## Confirm Success in Square Sandbox

1. Open the Square Developer Console.
2. Select the correct application.
3. Open the Sandbox test account/Sandbox Square Dashboard.
4. Open **Transactions** or **Payments**.
5. Find the payment by amount and time.
6. Confirm its status is completed.
7. The Square payment ID should match the transaction ID shown in the portal’s management order record.

You can also review the application’s Sandbox API logs in the Square Developer Console.

## Confirm the Portal Marked the Order Paid

Use the same browser that submitted the test order:

1. Select **Management**.
2. Open **Orders**.
3. Find the recorded order number.
4. Confirm **Payment** shows `Paid`.
5. Confirm the Square transaction ID is displayed under the payment status.
6. Confirm the order total matches Square Sandbox.
7. Confirm inventory decreased only after the verified payment.

Because the current prototype uses browser `localStorage`, the order appears only in that browser until Supabase is connected.

## Payment Safety

- The backend recalculates totals from its private catalog.
- The BrickellHouse order number is used as Square’s idempotency key.
- The backend creates the payment through Square Sandbox.
- The backend retrieves the payment again and verifies completed status, amount, currency, and location.
- The portal marks the order paid only after verification succeeds.
- Failed payments are not marked paid and do not reduce inventory.

## Sandbox-Only Lock

The backend rejects any value other than:

```text
SQUARE_ENVIRONMENT=sandbox
```

The SDK and API URLs are fixed to Sandbox. Changing environment variables cannot activate live payments.
