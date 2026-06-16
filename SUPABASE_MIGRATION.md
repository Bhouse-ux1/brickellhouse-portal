# Supabase Migration Plan

The current browser storage is a working prototype, not permanent storage. Move these records to Supabase before production.

## Recommended Tables

### products

- `id`
- `resident_name`
- `internal_name`
- `gl_code`
- `description`
- `category`
- `price_cents`
- `inventory`
- `image_url`
- `active`
- `created_at`
- `updated_at`

### orders

- `id`
- `order_number` unique
- `resident_name`
- `unit_number`
- `email`
- `phone`
- `subtotal_cents`
- `processing_fee_cents`
- `total_cents`
- `status`
- `public_note`
- `internal_note`
- `payment_status`
- `square_payment_id`
- `payment_at`
- `legal_accepted`
- `legal_accepted_at`
- `legal_notice_version`
- `terms_version`
- `privacy_policy_version`
- `created_at`

### order_items

- `id`
- `order_id`
- `product_id`
- `resident_name_snapshot`
- `internal_name_snapshot`
- `gl_code_snapshot`
- `quantity`
- `unit_price_cents`

### feedback

- `id`
- `resident_name`
- `unit_number`
- `email`
- `category`
- `message`
- `status`
- `management_response`
- `internal_notes`
- `submitted_at`
- `responded_at`

### management_users

- `user_id`
- `role`
- `active`

### audit_logs

- `id`
- `actor_user_id`
- `action`
- `record_type`
- `record_id`
- `before_data`
- `after_data`
- `created_at`

## Security

- Enable Row Level Security on every table.
- Residents should never query all orders or feedback.
- Order tracking should use a narrowly scoped server route that returns only current status and an optional public note.
- GL codes, internal notes, payment IDs, and management responses require authenticated management access.
- Keep `SUPABASE_SERVICE_ROLE_KEY` in server-only environment variables.

## Migration Order

1. Add Supabase Auth for management.
2. Create tables and policies.
3. Move products and inventory.
4. Create pending orders server-side before Square payment.
5. Save Square confirmation and legal evidence in one server-controlled flow.
6. Move feedback and tracking reads to server routes.
7. Remove browser-local authoritative storage.
