insert into storage.buckets (id, name, public)
values
  ('contract-assets', 'contract-assets', true),
  ('contract-exports', 'contract-exports', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "Users can view own contract assets" on storage.objects;
create policy "Users can view own contract assets"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'contract-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can upload own contract assets" on storage.objects;
create policy "Users can upload own contract assets"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'contract-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update own contract assets" on storage.objects;
create policy "Users can update own contract assets"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'contract-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'contract-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own contract assets" on storage.objects;
create policy "Users can delete own contract assets"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'contract-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can view own contract exports" on storage.objects;
create policy "Users can view own contract exports"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'contract-exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can upload own contract exports" on storage.objects;
create policy "Users can upload own contract exports"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'contract-exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update own contract exports" on storage.objects;
create policy "Users can update own contract exports"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'contract-exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'contract-exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own contract exports" on storage.objects;
create policy "Users can delete own contract exports"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'contract-exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
