-- Paper Trail update 8: a journey email can never go out twice (Oct 26)
-- Paste into Supabase → SQL Editor → New query, and click Run. Safe to run more than once.
--
-- 1. Every saved record gets its "last changed" time from the database's own clock. Browsers use that time to download
--    only what changed since their last visit, so it has to come from one clock, not from each computer.
-- 2. Before a journey email is sent (by the 8:45 run, "Send due emails now", or a person in the app), that one step is
--    claimed in a single database operation. Only one sender can hold the claim, so two senders can't both send it.
-- 3. Only one automatic run at a time: a second run that starts while one is going steps aside.
-- 4. Indexes that make page loads and the 8:45 run quicker with 80,000+ records.
-- The claim and run lock time out on their own (15 minutes) if a run is ever cut off midway.

-- 1. server clock for updated_at
create or replace function public.pt_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists pt_touch_updated_at on public.records;
create trigger pt_touch_updated_at before insert or update on public.records
  for each row execute function public.pt_touch_updated_at();

-- lookups that every page load and the 8:45 run do (only added if missing)
create index if not exists records_col_updated_idx on public.records (col, updated_at);
create index if not exists records_company_idx on public.records (col, (data ->> 'companyId'));
create index if not exists records_deal_idx    on public.records (col, (data ->> 'dealId'));
create index if not exists records_status_idx  on public.records (col, (data ->> 'status'));

-- milliseconds since 1970 by the database clock (the app stores times this way)
create or replace function public.pt_now_ms() returns bigint
language sql stable as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

-- a number stored in a record, or 0 when it's missing or not a number
create or replace function public.pt_num(v jsonb) returns bigint
language sql immutable as $$ select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric::bigint else 0 end $$;

-- 2. claim one step of one journey enrollment. True = you may send it now; false = it's already sent, skipped,
--    or someone else is sending it this minute.
create or replace function public.claim_journey_step(p_id text, p_step int, p_by text, p_secs int default 900)
returns boolean
language plpgsql security invoker as $$
begin
  update public.records
     set data = data || jsonb_build_object('sendClaim', jsonb_build_object('step', p_step, 'by', p_by, 'until', public.pt_now_ms() + greatest(p_secs, 30) * 1000))
   where col = 'enrollments' and id = p_id
     and public.pt_num(data -> 'sendClaim' -> 'until') < public.pt_now_ms()
     and exists (select 1 from jsonb_array_elements(coalesce(data -> 'schedule', '[]'::jsonb)) s
                  where public.pt_num(s -> 'step') = p_step and s ->> 'status' = 'pending');
  return found;
end $$;

-- let go of a claim (only the one who holds it can)
create or replace function public.release_journey_step(p_id text, p_by text)
returns void
language plpgsql security invoker as $$
begin
  update public.records set data = data - 'sendClaim'
   where col = 'enrollments' and id = p_id and data -> 'sendClaim' ->> 'by' = p_by;
end $$;

-- 3. one automatic run at a time
create or replace function public.claim_autosend(p_by text, p_secs int default 900)
returns boolean
language plpgsql security invoker as $$
begin
  insert into public.records (col, id, data)
  values ('meta', 'autosend', jsonb_build_object('runningSince', public.pt_now_ms(), 'runningBy', p_by))
  on conflict (col, id) do update
     set data = public.records.data || jsonb_build_object('runningSince', public.pt_now_ms(), 'runningBy', p_by)
   where public.pt_num(public.records.data -> 'runningSince') < public.pt_now_ms() - greatest(p_secs, 30) * 1000;
  return found;
end $$;

revoke all on function public.claim_journey_step(text, int, text, int) from public, anon;
revoke all on function public.release_journey_step(text, text) from public, anon;
revoke all on function public.claim_autosend(text, int) from public, anon;
grant execute on function public.claim_journey_step(text, int, text, int) to authenticated, service_role;
grant execute on function public.release_journey_step(text, text) to authenticated, service_role;
grant execute on function public.claim_autosend(text, int) to authenticated, service_role;

select 'Update 8 installed: journey emails can no longer be sent twice' as result;
