# Supabase Management Authentication

## Security Model

- Supabase Auth verifies management email/password credentials.
- `management_users` is the approval list.
- An authenticated Supabase user is denied unless that user has an active row in `management_users`.
- The browser receives only `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY` is used only by the server-side account creation script.
- Database tables use Row Level Security policies from `supabase/migrations/001_management_auth_rls.sql` and the current hardening migration `supabase/migrations/003_management_security_hardening.sql`.

## 1. Apply the Database Migration

In the Supabase Dashboard:

1. Open **SQL Editor**.
2. Create a new query.
3. Paste the contents of `supabase/migrations/001_management_auth_rls.sql` if this is a fresh database.
4. Run `supabase/migrations/003_management_security_hardening.sql`.
5. Confirm the `management_users`, `management_user_requests`, `products`, `orders`, `order_items`, `feedback`, `portal_settings`, `payment_events`, and `audit_logs` tables exist.

## 2. Add Environment Variables

For local Vercel testing, put these in `.env.local`:

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

For Vercel, add the same variables under **Project Settings > Environment Variables**.

The service-role key must never appear in browser JavaScript, HTML, screenshots, or GitHub.

## 3. Create the First Management User

The account creation script defaults to:

```text
admin@brickellhouse.net
```

Set the requested temporary password privately in your terminal, then run:

```powershell
$env:MANAGEMENT_TEMP_PASSWORD='your-temporary-password'
node scripts/create-management-user.js
Remove-Item Env:MANAGEMENT_TEMP_PASSWORD
```

The temporary password is not stored in the repository. The account is created with `force_password_change=true`.

## 4. First Login

1. Start the project with `npx vercel dev --listen 4173`.
2. Open `http://localhost:4173/login.html`.
3. Sign in as `admin@brickellhouse.net`.
4. The portal requires a new password of at least 12 characters.
5. After the password is updated, the existing management dashboard opens.

## Additional Management Users

Set a different email and temporary password:

```powershell
$env:MANAGEMENT_EMAIL='manager@example.com'
$env:MANAGEMENT_TEMP_PASSWORD='a-private-temporary-password'
node scripts/create-management-user.js
Remove-Item Env:MANAGEMENT_EMAIL
Remove-Item Env:MANAGEMENT_TEMP_PASSWORD
```

The script creates or approves the user and requires a password change on first login.

After the hardening migration, active management admins can approve an existing Supabase Auth user with:

```sql
select public.approve_management_user('manager@example.com', 'manager');
```

Valid roles are `admin`, `manager`, and `accounting`.

To disable a manager without deleting their Auth account:

```sql
select public.disable_management_user('manager@example.com');
```

Their next approval check will fail and management access will be denied.

## Production Data Migration

The RLS policies protect rows stored in Supabase. Existing prototype records in browser `localStorage` are not database rows and cannot be protected by RLS. Migrate authoritative products, orders, feedback, settings, and payment records to the new Supabase tables before production use.
