// Paper Trail email tracking: records opens (a 1x1 image) and link clicks for emails sent from Paper Trail.
// Deploy in Supabase → Edge Functions → name it "track" → turn OFF "Verify JWT" (email programs can't sign in).
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const pixel = () => new Response(GIF, { headers: { "content-type": "image/gif", "cache-control": "no-store, no-cache, must-revalidate, max-age=0" } });

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const t = u.searchParams.get("t") || "";
  const l = u.searchParams.get("l");
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(t)) return l === null ? pixel() : new Response("Link not found", { status: 404 });
  const ua = (req.headers.get("user-agent") || "").slice(0, 300);
  if (l === null) {   // open
    await sb.from("email_events").insert({ token: t, kind: "open", ua });
    return pixel();
  }
  // click: only ever redirect to a link that was in the email when it was sent
  const { data } = await sb.from("email_tracks").select("links").eq("token", t).maybeSingle();
  const url = data && Array.isArray(data.links) ? data.links[Number(l)] : null;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return new Response("Link not found", { status: 404 });
  await sb.from("email_events").insert({ token: t, kind: "click", link: Number(l), ua });
  return Response.redirect(url, 302);
});
