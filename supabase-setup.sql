-- Paper Trail: the whole database, for a BRAND-NEW, EMPTY Supabase project.
-- Use it to rebuild Paper Trail from scratch (for example after losing the old project), then restore a backup.
-- Do NOT run this on the project Paper Trail already uses: that one is set up. (It's written to be safe to re-run,
-- but there's no reason to.) It includes updates 4, 6, 7 and 8, so those don't need running separately here.
-- Automatic journey sending also needs supabase-update-5.sql (the 8:45 schedule) after the steps in the README.
--
-- Supabase → SQL Editor → New query → paste all of this → Run.
-- Then: Authentication → Sign In / Providers → Email: turn OFF "Confirm email" (people sign up with an invite code).

-- ============ records: every account, contact, opportunity, activity, reminder, quote, contract, journey… ============
create table if not exists public.records (
  col        text        not null,            -- the kind of record: companies, contacts, deals, activities, …
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
-- each browser downloads only what changed since its last visit, by kind and time
create index if not exists records_col_updated_idx on public.records (col, updated_at);
-- the 8:45 run looks records up by account, opportunity and journey status
create index if not exists records_company_idx on public.records (col, (data ->> 'companyId'));
create index if not exists records_deal_idx    on public.records (col, (data ->> 'dealId'));
create index if not exists records_status_idx  on public.records (col, (data ->> 'status'));

-- "last changed" always comes from the database clock (update 8)
create or replace function public.pt_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists pt_touch_updated_at on public.records;
create trigger pt_touch_updated_at before insert or update on public.records
  for each row execute function public.pt_touch_updated_at();

-- ============ people ============
create table if not exists public.profiles (
  id         text primary key,                 -- what records use as ownerId / assigneeId
  name       text not null,
  email      text not null,
  role       text not null default 'manager' check (role in ('admin', 'manager')),
  active     boolean not null default true,
  user_id    uuid unique references auth.users (id) on delete set null,   -- their login, once they've set it up
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_email_idx on public.profiles (lower(email));

-- one-time invite codes (7 days), made by an admin in Settings → Users
create table if not exists public.invites (
  profile_id text primary key references public.profiles (id) on delete cascade,
  code       text not null,
  expires_at timestamptz not null
);

-- is the signed-in person an active Paper Trail user? / an admin?
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and active)
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and active and role = 'admin')
$$;

-- first sign-in: link the new login to the person the admin added, if the email and invite code match
create or replace function public.claim_profile(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_pid   text;
begin
  if auth.uid() is null or v_email = '' then return false; end if;
  select p.id into v_pid
    from public.profiles p join public.invites i on i.profile_id = p.id
   where lower(p.email) = v_email
     and upper(replace(i.code, ' ', '')) = upper(replace(coalesce(p_code, ''), ' ', ''))
     and i.expires_at > now()
     and (p.user_id is null or p.user_id = auth.uid())
   limit 1;
  if v_pid is null then return false; end if;
  update public.profiles set user_id = auth.uid() where id = v_pid;
  delete from public.invites where profile_id = v_pid;
  return true;
end $$;

-- change some fields of one record, keeping the rest (used for every edit in the app)
create or replace function public.merge_record(p_col text, p_id text, p_patch jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update public.records set data = data || coalesce(p_patch, '{}'::jsonb) where col = p_col and id = p_id;
end $$;

-- ============ access rules ============
alter table public.records  enable row level security;
alter table public.profiles enable row level security;
alter table public.invites  enable row level security;
revoke all on public.records, public.profiles, public.invites from anon;
grant select, insert, update, delete on public.records  to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.invites  to authenticated;

drop policy if exists "members read records"  on public.records;
drop policy if exists "members write records" on public.records;
create policy "members read records"  on public.records for select to authenticated using ((select public.is_member()));
create policy "members write records" on public.records for all    to authenticated using ((select public.is_member())) with check ((select public.is_member()));

drop policy if exists "members read people" on public.profiles;
drop policy if exists "admins add people"   on public.profiles;
drop policy if exists "admins change people" on public.profiles;
drop policy if exists "admins remove people" on public.profiles;
create policy "members read people"  on public.profiles for select to authenticated using ((select public.is_member()));
create policy "admins add people"    on public.profiles for insert to authenticated with check ((select public.is_admin()));
create policy "admins change people" on public.profiles for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins remove people" on public.profiles for delete to authenticated using ((select public.is_admin()));

drop policy if exists "admins manage invites" on public.invites;
create policy "admins manage invites" on public.invites for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on function public.is_member(), public.is_admin(), public.claim_profile(text), public.merge_record(text, text, jsonb) from public, anon;
grant execute on function public.is_member(), public.is_admin(), public.claim_profile(text), public.merge_record(text, text, jsonb) to authenticated, service_role;

-- live updates: changes show on everyone's screen as they happen
do $$ begin
  begin alter publication supabase_realtime add table public.records;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
end $$;

-- ============ files on accounts (attachments and contracts): private, team members only ============
insert into storage.buckets (id, name, public) values ('files', 'files', false)
on conflict (id) do update set public = false;
drop policy if exists "pt files read"   on storage.objects;
drop policy if exists "pt files add"    on storage.objects;
drop policy if exists "pt files remove" on storage.objects;
create policy "pt files read"   on storage.objects for select to authenticated using (bucket_id = 'files' and (select public.is_member()));
create policy "pt files add"    on storage.objects for insert to authenticated with check (bucket_id = 'files' and (select public.is_member()));
create policy "pt files remove" on storage.objects for delete to authenticated using (bucket_id = 'files' and (select public.is_member()));

-- ============ update 4: email open and click tracking ============
create table if not exists public.email_tracks (
  token      text primary key,
  links      jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.email_events (
  id    bigserial primary key,
  token text not null,
  kind  text not null check (kind in ('open', 'click')),
  link  int,
  ua    text,
  at    timestamptz not null default now()
);
create index if not exists email_events_token_idx on public.email_events (token);
alter table public.email_tracks enable row level security;
alter table public.email_events enable row level security;
revoke all on public.email_tracks, public.email_events from anon;
grant select, insert on public.email_tracks to authenticated;
grant select on public.email_events to authenticated;
drop policy if exists "members read tracks"  on public.email_tracks;
drop policy if exists "members add tracks"   on public.email_tracks;
drop policy if exists "members read events"  on public.email_events;
create policy "members read tracks" on public.email_tracks for select to authenticated using ((select public.is_member()));
create policy "members add tracks"  on public.email_tracks for insert to authenticated with check ((select public.is_member()));
create policy "members read events" on public.email_events for select to authenticated using ((select public.is_member()));

-- ============ update 6: signature pictures, hosted so emails link to them ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signature-images', 'signature-images', true, 2097152, array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
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

-- ============ update 8: a journey email can never go out twice ============
create or replace function public.pt_now_ms() returns bigint
language sql stable as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;
create or replace function public.pt_num(v jsonb) returns bigint
language sql immutable as $$ select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric::bigint else 0 end $$;
create or replace function public.claim_journey_step(p_id text, p_step int, p_by text, p_secs int default 900)
returns boolean language plpgsql security invoker as $$
begin
  update public.records
     set data = data || jsonb_build_object('sendClaim', jsonb_build_object('step', p_step, 'by', p_by, 'until', public.pt_now_ms() + greatest(p_secs, 30) * 1000))
   where col = 'enrollments' and id = p_id
     and public.pt_num(data -> 'sendClaim' -> 'until') < public.pt_now_ms()
     and exists (select 1 from jsonb_array_elements(coalesce(data -> 'schedule', '[]'::jsonb)) s
                  where public.pt_num(s -> 'step') = p_step and s ->> 'status' = 'pending');
  return found;
end $$;
create or replace function public.release_journey_step(p_id text, p_by text)
returns void language plpgsql security invoker as $$
begin
  update public.records set data = data - 'sendClaim'
   where col = 'enrollments' and id = p_id and data -> 'sendClaim' ->> 'by' = p_by;
end $$;
create or replace function public.claim_autosend(p_by text, p_secs int default 900)
returns boolean language plpgsql security invoker as $$
begin
  insert into public.records (col, id, data)
  values ('meta', 'autosend', jsonb_build_object('runningSince', public.pt_now_ms(), 'runningBy', p_by))
  on conflict (col, id) do update
     set data = public.records.data || jsonb_build_object('runningSince', public.pt_now_ms(), 'runningBy', p_by)
   where public.pt_num(public.records.data -> 'runningSince') < public.pt_now_ms() - greatest(p_secs, 30) * 1000;
  return found;
end $$;
revoke all on function public.claim_journey_step(text, int, text, int), public.release_journey_step(text, text), public.claim_autosend(text, int) from public, anon;
grant execute on function public.claim_journey_step(text, int, text, int), public.release_journey_step(text, text), public.claim_autosend(text, int) to authenticated, service_role;

analyze public.records;

-- ============ the first admin ============
-- After running this, sign up in Paper Trail can't happen yet (nobody has an invite). Add yourself here once, with your
-- work email, then use "First time here? Set up your account" in Paper Trail with the code below:
--   insert into public.profiles (id, name, email, role) values ('jason', 'Jason Quillen', 'jason@allpointsprotects.com', 'admin');
--   insert into public.invites (profile_id, code, expires_at) values ('jason', 'START-0001', now() + interval '7 days');
-- (Use the same id your old records use as ownerId, so your accounts stay yours after a restore.)

select 'Paper Trail database is set up' as result;
