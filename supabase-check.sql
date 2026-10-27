-- Paper Trail database check. Read-only: it changes nothing.
-- Supabase → SQL Editor → New query → paste → Run. Each line says whether a piece is in place.
with checks(item, ok, fix) as (values
  ('Records table',                     to_regclass('public.records') is not null,                                   'supabase-setup.sql (new project only)'),
  ('People and invite codes',           to_regclass('public.profiles') is not null and to_regclass('public.invites') is not null, 'supabase-setup.sql (new project only)'),
  ('Team-member check',                 to_regprocedure('public.is_member()') is not null,                           'supabase-setup.sql (new project only)'),
  ('First sign-in with invite code',    to_regprocedure('public.claim_profile(text)') is not null,                   'supabase-setup.sql (new project only)'),
  ('Edits keep other fields',           to_regprocedure('public.merge_record(text,text,jsonb)') is not null,          'supabase-setup.sql (new project only)'),
  ('Live updates on',                   exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'records'), 'Database → Publications → supabase_realtime → add records'),
  ('Email tracking (update 4)',         to_regclass('public.email_tracks') is not null and to_regclass('public.email_events') is not null, 'supabase-update-4.sql'),
  ('Automatic sending schedule (update 5)', exists (select 1 from pg_extension where extname = 'pg_cron'),           'supabase-update-5.sql (see README)'),
  ('Signature pictures folder (update 6)', exists (select 1 from storage.buckets where id = 'signature-images'),       'supabase-update-6.sql'),
  ('Account files folder',              exists (select 1 from storage.buckets where id = 'files'),                    'supabase-setup.sql (files section)'),
  ('Fast access check (update 7)',      exists (select 1 from pg_policies where tablename = 'records' and policyname = 'members read records' and qual ilike '%select%is_member%'), 'supabase-update-7.sql'),
  ('Server clock on changes (update 8)', exists (select 1 from pg_trigger where tgname = 'pt_touch_updated_at'),      'supabase-update-8.sql'),
  ('No double journey emails (update 8)', to_regprocedure('public.claim_journey_step(text,int,text,int)') is not null and to_regprocedure('public.claim_autosend(text,int)') is not null, 'supabase-update-8.sql'),
  ('Quick lookups (update 8)',          to_regclass('public.records_col_updated_idx') is not null,                    'supabase-update-8.sql')
)
select case when ok then '✓' else '✗' end as status, item as "what", case when ok then '' else 'Run ' || fix end as "to fix"
from checks;
