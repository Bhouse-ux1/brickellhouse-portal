-- Add the isolated Storage and product metadata required by the Management image editor.
-- This migration is intentionally additive and must not be treated as applied until verified.

begin;

alter table public.products
  add column if not exists image_storage_path text,
  add column if not exists image_original_path text,
  add column if not exists image_crop jsonb,
  add column if not exists image_updated_by uuid references auth.users(id);

alter table public.products
  drop constraint if exists products_image_storage_path_safe,
  add constraint products_image_storage_path_safe check (
    image_storage_path is null
    or (
      char_length(image_storage_path) between 1 and 512
      and image_storage_path !~ '(^|/)\.\.(/|$)'
      and image_storage_path ~ '^products/[0-9a-f]{24}/[0-9a-f-]{36}\.webp$'
    )
  ),
  drop constraint if exists products_image_original_path_safe,
  add constraint products_image_original_path_safe check (
    image_original_path is null
    or (
      char_length(image_original_path) between 1 and 512
      and image_original_path !~ '(^|/)\.\.(/|$)'
      and image_original_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'
    )
  ),
  drop constraint if exists products_image_crop_safe,
  add constraint products_image_crop_safe check (
    image_crop is null
    or (
      jsonb_typeof(image_crop) = 'object'
      and image_crop ?& array['version','zoom','x','y','aspect']
      and (image_crop->>'version')::integer = 1
      and (image_crop->>'zoom')::numeric between 1 and 4
      and (image_crop->>'x')::numeric between -1 and 1
      and (image_crop->>'y')::numeric between -1 and 1
      and (image_crop->>'aspect') = '1:1'
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-image-originals',
  'product-image-originals',
  false,
  8388608,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  2097152,
  array['image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Management can stage product image originals" on storage.objects;
create policy "Management can stage product image originals"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-image-originals'
  and (select public.is_management_user())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Management can read product image originals" on storage.objects;
create policy "Management can read product image originals"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'product-image-originals'
  and (select public.is_management_user())
);

comment on column public.products.image_storage_path is
  'Server-generated path for the public, cropped Store derivative in the product-images bucket.';
comment on column public.products.image_original_path is
  'Server-validated path for the private Management source image in the product-image-originals bucket.';
comment on column public.products.image_crop is
  'Validated Management crop metadata; the Store renders the generated square derivative.';

commit;
