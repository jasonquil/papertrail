# Paper Trail

The All Points CRM: accounts, contacts, opportunities, reminders, journeys (automatic follow-ups), quotes, contracts,
Outlook email, and email open tracking. Live at **https://jasonquil.github.io/papertrail/**.
Add `?demo` to the address (or click **Open the demo** on the sign-in page) for sample data that never touches real records.

## What's in this repository

| File | What it is |
|---|---|
| `index.html` | The whole app. GitHub Pages serves it; every push to `main` is live in a minute or two. |
| `config.js` | The Supabase project and Microsoft app IDs the app connects to. None of these are secrets. |
| `spiro-templates.json` | The 101 email templates from Spiro (Settings → Email templates → Add Spiro templates). |
| `supabase/functions/journey-send/` | Sends journey emails between 8 and 9 AM and for **Send due emails now**. |
| `supabase/functions/track/` | Records email opens and link clicks. |
| `supabase-setup.sql` | The complete database, for rebuilding Paper Trail in a **new, empty** Supabase project. |
| `supabase-update-4.sql` … `-8.sql` | Changes to run once on the existing database (see below). |
| `supabase-check.sql` | A read-only check that lists which database pieces are in place. |

## How it fits together

- **Data:** everything lives in Supabase, in one `records` table (each row is one account, contact, opportunity,
  activity, reminder, quote, contract, journey, etc.). Logins are Supabase accounts linked to the `profiles` table;
  admins add people in Settings → Users and give them a 7-day invite code.
- **Speed:** each browser keeps a saved copy of the records and downloads only what changed since its last visit.
  Changes from teammates arrive live; if the connection drops (sleep, Wi-Fi), the app catches up when it's back.
- **Outlook:** each person connects Outlook once (Settings → Outlook → Manage) and signs in with Microsoft. Paper Trail
  then sends from their own mailbox, shows customer emails on each account, and logs them on the timeline.
- **Journeys:** emails either wait on the Journeys page for a person (**Ask me first**) or go out between 8 and 9 AM New York
  time, a few at a time (**Send automatically**). Before each automatic email, Paper Trail checks for a reply and pauses instead.
  Each email is claimed in the database before it's sent, so nothing can send the same email twice.

## Database updates

Run each once in Supabase → **SQL Editor** → New query → paste → **Run**. All are safe to run again.
Not sure what's installed? Run `supabase-check.sql`; it lists each piece with ✓ or ✗.

| Update | What it does |
|---|---|
| 4 | Email open and click tracking (also deploy the `track` function, below). |
| 5 | The morning schedule for automatic journey sending (see that section first). |
| 6 | Hosted signature pictures, so emails link to logos instead of attaching them. |
| 7 | Faster loading with 80,000+ records. |
| 8 | **Required for automatic sending.** No journey email can go out twice; "last changed" times come from the database clock; faster lookups. Without it, automatic sending refuses to send (people can still send by hand). |
| 9 | Checks every 5 minutes instead of 15, so automatic emails trickle out between 8 and 9 AM. |

## Automatic journey sending (8–9 AM)

One-time setup, about 15 minutes:

1. **Let Paper Trail send from Outlook on its own.** Microsoft Entra admin center → **App registrations → Paper Trail**:
   - **API permissions → Add a permission → Microsoft Graph → Application permissions**: add **Mail.Send** and
     **Mail.ReadBasic.All**, then **Grant admin consent for All Points**.
   - **Certificates & secrets → New client secret** (24 months). Copy the **Value** right away; it's shown once.
   - Recommended: an Exchange application access policy limiting the app to the team's mailboxes.
2. **Secrets in Supabase.** **Edge Functions → Secrets**, add `MS_TENANT_ID` (`e3e693fe-6a3f-4b70-9b1f-da24e6e9df75`),
   `MS_CLIENT_ID` (`66c32d40-29b1-4310-b6be-39d4402dea72`), `MS_CLIENT_SECRET` (the value from step 1), and
   `CRON_SECRET` (any long random password). Never put these in this repository or in a chat.
3. **Run `supabase-update-8.sql`.**
4. **Deploy the function.** **Edge Functions → Deploy a new function → Via editor**, name it `journey-send`, paste
   `supabase/functions/journey-send/index.ts`, **Deploy**, then turn **off** "Verify JWT" in its settings. (It checks the
   schedule's password, or the person's Paper Trail sign-in, itself.) When this file changes, paste the new version and
   deploy again.
5. **Turn on the schedule.** In `supabase-update-5.sql`, replace `PASTE-YOUR-SECRET` with your `CRON_SECRET`, then run it.
6. **Try it.** Set a journey to **Send automatically**, start it on yourself, and click **Send due emails now** on the
   Journeys page. The banner there shows the last run, how many went out, and any problem.

How it behaves: the schedule checks every 5 minutes through the morning. Between 8:00 and 9:00 each check sends its share
of the day's emails (25 due means 2 or 3 per check), taking turns between owners, so replies don't all arrive at once.
Anything left at 9:00 goes then. If Outlook is down or the Microsoft sign-in fails, it tries again at the next check
(up to 12 times a day).
A run sends for about 100 seconds at most and leaves the rest for the next check. Emails missing a fill-in field, or
to a contact without an email address, are held on the Journeys page with the reason; calls always wait for a person.
Each person's Paper Trail login email must be their Outlook mailbox, since that's where their journeys send from.
To stop automatic sending: `select cron.unschedule('paper-trail-journeys');`

## Email open and click tracking

Deploy `supabase/functions/track/index.ts` as a function named `track` with "Verify JWT" **off** (email programs can't
sign in), and run update 4. Each person can turn tracking off for their own emails in Settings → Outlook → Manage (My connections).

## Outlook sign-in (Microsoft Entra)

The **Paper Trail** app registration has a **Single-page application** redirect URI of
`https://jasonquil.github.io/papertrail/` and these delegated permissions: `User.Read`, `Mail.Read`, `Mail.Send`,
`offline_access`. If the site's address ever changes, add the new address there too.

## Backups

**Settings → Backup → Back up** downloads everything: all records, plus everyone's signatures and appearance
settings, the journey copies the morning run uses, and a list of the people (for reference). On the website it's a
compressed `.json.gz` file. **Restore** puts back anything missing or different and never deletes. Not included:
files attached to accounts (they stay in Supabase storage), logins and passwords.

**Rebuilding from scratch** (if the Supabase project were lost): create a new Supabase project; run
`supabase-setup.sql`; turn off "Confirm email" (Authentication → Sign In / Providers → Email); add yourself as the first
admin with the two lines at the end of that file; put the new project's URL and publishable key in `config.js`; sign in
with the invite code; restore your latest backup; add your teammates again in Settings → Users. Then redo the automatic
sending and tracking steps above.

## Running without a database

With the Supabase lines in `config.js` left blank, Paper Trail runs on its own in one browser, saving records there only
(Settings → Backup still works). Outlook, journeys sending automatically and tracking need the database.
