-- Paper Trail update 5: automatic journey sending at 8:45 AM.
-- Before running: replace PASTE-YOUR-SECRET below with the same CRON_SECRET you saved in
-- Supabase → Edge Functions → Secrets. Then paste into Supabase → SQL Editor → New query, and click Run.
-- Safe to run more than once.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- every 15 minutes from 6 AM to 12:59 PM New York time (10:00–16:59 UTC covers both daylight and standard time).
-- The function itself waits until 8:45 AM New York time and only sends once a day, so the extra calls do nothing.
select cron.unschedule(jobid) from cron.job where jobname = 'paper-trail-journeys';
select cron.schedule(
  'paper-trail-journeys',
  '*/15 10-16 * * *',
  $$
  select net.http_post(
    url := 'https://jmaauvlwrxvebtmxrtzc.supabase.co/functions/v1/journey-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'PASTE-YOUR-SECRET'),
    body := '{}'::jsonb
  );
  $$
);

select 'Update 5 installed: journeys set to "Send automatically" now go out at 8:45 AM' as result;
-- To turn automatic sending off again:  select cron.unschedule('paper-trail-journeys');
