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

## Shared team data and Outlook sending

To have the team share one set of records, and to send from Outlook directly, the site needs a database and a Microsoft sign-in (for example Supabase or Firebase, plus Microsoft Graph). That's the next step after the demo.
