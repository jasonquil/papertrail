// Paper Trail settings.
// Leave these blank to run in demo mode (data saved in your browser only).
// Fill them in from Supabase → Project Settings → API to turn on logins and shared team data.
window.PAPER_TRAIL = {
  supabaseUrl: 'https://jmaauvlwrxvebtmxrtzc.supabase.co',
  supabaseAnonKey: 'sb_publishable_rXsAGq_BIvVDUWqpZMlJGg_yIajtOhK',   // public key (safe here; access rules protect your data)
  // Outlook: the Paper Trail app registered in Microsoft Entra (these IDs aren't secrets)
  msClientId: '66c32d40-29b1-4310-b6be-39d4402dea72',
  msTenantId: 'e3e693fe-6a3f-4b70-9b1f-da24e6e9df75',
  // email open & click tracking (needs the "track" edge function and supabase-update-4.sql)
  emailTracking: true
};
