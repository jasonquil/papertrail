-- Paper Trail update 7: faster loading with large data (Oct 26)
-- The team-member check on records ran once for every row. Wrapped in (select ...), Postgres runs it
-- once per request instead. Same rule, same access, just much faster with 80,000+ records.
-- Safe to run more than once.

drop policy if exists "members read records"  on public.records;
drop policy if exists "members write records" on public.records;
create policy "members read records"  on public.records for select to authenticated using ((select public.is_member()));
create policy "members write records" on public.records for all    to authenticated using ((select public.is_member())) with check ((select public.is_member()));

-- refresh table statistics after the big import so Postgres plans queries well
analyze public.records;
