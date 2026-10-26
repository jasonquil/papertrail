-- Paper Trail update 6: host signature pictures so emails link to them instead of attaching them.
-- Paste into Supabase → SQL Editor → New query, and click Run. Safe to run more than once.

-- A public folder for signature pictures (logos only; 2 MB per picture, images only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signature-images', 'signature-images', true, 2097152, array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Team members can add, replace and remove pictures only in their own folder. Anyone can view them (that's how email shows them).
drop policy if exists "pt sig read own"   on storage.objects;
drop policy if exists "pt sig upload own" on storage.objects;
drop policy if exists "pt sig update own" on storage.objects;
drop policy if exists "pt sig delete own" on storage.objects;
create policy "pt sig read own" on storage.objects for select to authenticated
  using (bucket_id = 'signature-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "pt sig upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'signature-images' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "pt sig update own" on storage.objects for update to authenticated
  using (bucket_id = 'signature-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'signature-images' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "pt sig delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'signature-images' and (storage.foldername(name))[1] = auth.uid()::text);

select 'Update 6 installed: signature pictures are now hosted' as result;
