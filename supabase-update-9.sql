-- Paper Trail update 9: automatic journey emails trickle out between 8 and 9 AM (Oct 29)
-- Paste into Supabase → SQL Editor → New query, and click Run. Safe to run more than once. No secret needed.
-- The morning schedule now checks every 5 minutes instead of every 15, and each check between 8:00 and 9:00 sends
-- its share of the day's emails, so they go out a few at a time instead of all at once.
select cron.alter_job(jobid, schedule := '*/5 10-16 * * *') from cron.job where jobname = 'paper-trail-journeys';

select case when exists (select 1 from cron.job where jobname = 'paper-trail-journeys' and schedule = '*/5 10-16 * * *')
  then 'Update 9 installed: automatic emails now trickle out between 8 and 9 AM'
  else 'The morning schedule isn''t set up yet: run supabase-update-5.sql first' end as result;
