# Paper Trail

A simple CRM for a small sales team: accounts, contacts, opportunities, reminders, journeys, quotes and contracts.

## Put it on GitHub Pages

1. On GitHub, create a new repository (for example `paper-trail`).
2. Click **Add file → Upload files** and drag in `index.html`, `README.md` and `.nojekyll` from this folder. Click **Commit changes**.
3. Go to **Settings → Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, pick **main** and **/ (root)**, then click **Save**.
4. After about a minute, the site is live at `https://<your-username>.github.io/paper-trail/`.

If you can't see `.nojekyll` (files starting with a dot are hidden on Mac), skip it. The site works without it.

## How this version works

- **Your data stays in your browser.** Everything you add is saved on the computer and browser you're using. Someone else opening the link sees their own empty copy.
- **Load sample data** (in the blue bar at the top) fills it with five example accounts for a demo. **Clear all data** wipes it.
- **Back up or move your data** with Settings → Export.
- Outlook sending and email sync, and the "with Claude" features, only work in the claude.ai version. Here, email opens as a draft you can copy.

## Automatic journey sending (8:45 AM)

Each journey has a **Sending** setting: **Ask me first** (emails wait on the Journeys page until you send them) or **Send automatically** (they go out at 8:45 AM, New York time, from the journey owner's own Outlook). You can also change it for one person in the Start a journey window or on their journey.

Before each automatic email, Paper Trail checks the owner's mailbox for a reply from that contact. If there is one, it pauses (or ends) the journey instead of sending. It never sends an email that's missing a name or other field, and calls always wait for a person. Anything it holds back shows on the Journeys page with the reason.

One-time setup (about 15 minutes):

1. **Let Paper Trail send from Outlook on its own.** In the Microsoft Entra admin center, open **App registrations → Paper Trail**.
   - **API permissions → Add a permission → Microsoft Graph → Application permissions**, add **Mail.Send** and **Mail.ReadBasic.All**, then click **Grant admin consent for All Points**.
   - **Certificates & secrets → New client secret**, pick 24 months, and copy the **Value** right away (it's only shown once).
   - Recommended: limit it to the team's mailboxes with an Exchange application access policy, so the app can't send as anyone else.
2. **Add the secrets in Supabase.** In **Edge Functions → Secrets**, add:
   - `MS_TENANT_ID` = `e3e693fe-6a3f-4b70-9b1f-da24e6e9df75`
   - `MS_CLIENT_ID` = `66c32d40-29b1-4310-b6be-39d4402dea72`
   - `MS_CLIENT_SECRET` = the value you copied in step 1
   - `CRON_SECRET` = any long random password (you'll paste it once more in step 4)
3. **Add the function.** In **Edge Functions → Deploy a new function → Via editor**, name it `journey-send`, paste in `supabase/functions/journey-send/index.ts`, and click **Deploy**. Then open its settings and turn **off** "Verify JWT". (It checks the schedule's password, or the person's Paper Trail sign-in, itself.)
4. **Turn on the schedule.** Open `supabase-update-5.sql`, replace `PASTE-YOUR-SECRET` with your `CRON_SECRET`, and run it in **SQL Editor**.
5. **Try it.** Set a journey to **Send automatically**, start it on yourself, and click **Send due emails now** on the Journeys page. The banner there shows when it last ran and how many went out.

Each person's login email must be their Outlook mailbox address, since that's the mailbox their journeys send from. To stop automatic sending, run `select cron.unschedule('paper-trail-journeys');` in the SQL Editor.

## Shared team data and Outlook sending

To have the team share one set of records, and to send from Outlook directly, the site needs a database and a Microsoft sign-in (for example Supabase or Firebase, plus Microsoft Graph). That's the next step after the demo.

## Update 6: hosted signature pictures
Run `supabase-update-6.sql` in Supabase → SQL Editor. It creates a public `signature-images` storage folder where each
team member can only add or change pictures in their own folder. After that, Paper Trail uploads signature pictures when a
signature is saved (and moves existing signatures over automatically the next time each person opens Paper Trail), so emails
link to the pictures instead of attaching them. Until the update is run, pictures keep going out as inline attachments.
