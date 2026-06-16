# BrickellHouse Security Hardening

Run this migration in Supabase SQL Editor before relying on production management data:

```text
supabase/migrations/003_management_security_hardening.sql
```

It creates or hardens:

- `management_users`
- `management_user_requests`
- `audit_logs`
- `payment_events`
- `products`
- `orders`
- `order_items`
- `feedback`
- `portal_settings`

It enables Row Level Security and restricts orders, payments, legal acceptance records, feedback, reports, exports, and financial data to approved management users through `public.management_users`.

## Approval Workflow

1. Create the person in Supabase Authentication first.
2. Sign in as an active management admin.
3. Approve the new account from SQL Editor:

```sql
select public.approve_management_user('new-manager@example.com', 'manager');
```

Valid roles are `admin`, `manager`, and `accounting`.

Disable access:

```sql
select public.disable_management_user('new-manager@example.com');
```

## Password Reset

Management users can request a password reset from `login.html`. Supabase should allow these production redirect URLs:

```text
https://YOUR-DOMAIN/login.html
https://YOUR-DOMAIN/#management
```

## MFA / 2FA

The migration adds `mfa_required` to `management_users` and updates `public.is_management_user()` so users marked with `mfa_required = true` must have a Supabase `aal2` session.

Remaining work before turning this on:

1. Add the Supabase MFA enrollment/challenge UI for management users.
2. Confirm at least one verified factor exists for each required user.
3. Set:

```sql
update public.management_users
set mfa_required = true
where email = 'admin@brickellhouse.net';
```

Do not set `mfa_required = true` before the MFA UI is available, or affected users will be blocked from management data.

## Important Production Note

The current portal still uses browser `localStorage` for some dashboard state until the full Supabase data migration is completed. RLS protects Supabase tables, not browser storage. Do not enter real sensitive resident data into local-only records in production.
