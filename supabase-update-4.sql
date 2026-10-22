-- Paper Trail update 4: email open and click tracking.
-- Paste into Supabase → SQL Editor → New query, then click Run. Safe to run more than once.

-- the links in each tracked email (so clicks can only go where the email pointed)
create table if not exists public.email_tracks (
  token       text primary key,
  links       jsonb not null default '[]'::jsonb,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
-- each open or click, recorded by the "track" edge function
create table if not exists public.email_events (
  id     bigserial primary key,
  token  text not null,
  kind   text not null check (kind in ('open', 'click')),
  link   int,
  ua     text,
  at     timestamptz not null default now()
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
create policy "members read tracks" on public.email_tracks for select to authenticated using (public.is_member());
create policy "members add tracks"  on public.email_tracks for insert to authenticated with check (public.is_member());
create policy "members read events" on public.email_events for select to authenticated using (public.is_member());
-- (the edge function writes events with the service key, which skips these rules)

select 'Update 4 installed' as result;
