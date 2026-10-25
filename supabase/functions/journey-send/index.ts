// Paper Trail automatic journey sending.
// Every morning at 8:45 (New York time) this sends the journey emails that are due, for journeys set to
// "Send automatically", from each owner's own Outlook mailbox. Before each email it checks whether the
// contact has written back since the journey started; if so it pauses (or ends) the journey instead of sending.
//
// Deploy in Supabase → Edge Functions → name it "journey-send" → turn OFF "Verify JWT"
// (the morning schedule calls it with a secret instead; people in the app call it with their own sign-in).
// Secrets it needs (Edge Functions → Secrets): MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, CRON_SECRET.
// Optional: SEND_AT (default "08:45"), SEND_TZ (default "America/New_York"), TRACKING ("off" to skip open tracking).
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const env = (k: string) => Deno.env.get(k) || "";
const secretKeys = (() => { try { return JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}"); } catch { return {}; } })();
const KEY = env("SUPABASE_SERVICE_ROLE_KEY") || secretKeys.default || Object.values(secretKeys)[0] || "";
const URL_ = env("SUPABASE_URL");
const sb = createClient(URL_, String(KEY));
const TZ = env("SEND_TZ") || "America/New_York";
const SEND_AT = env("SEND_AT") || "08:45";
const TRACK_URL = URL_.replace(/\/$/, "") + "/functions/v1/track";
const MAX_PER_RUN = 200;

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey, x-client-info", "access-control-allow-methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });

// ---------- dates in the business's own time zone ----------
function local(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? "00" : p.hour;
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${hour}:${p.minute}`, hour: +hour };
}
const parseYmd = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const longDate = (s: string, withYear = false) => parseYmd(s).toLocaleDateString("en-US", { timeZone: "UTC", ...(withYear ? {} : { weekday: "long" }), month: "long", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money2 = (n: unknown) => (+(n as number) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

// ---------- records (the app keeps everything in one "records" table: col, id, data) ----------
type Rec = Record<string, any>;
async function rows(col: string, filter?: [string, string]) {
  const out: { id: string; data: Rec }[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from("records").select("id,data").eq("col", col);
    if (filter) q = q.eq(filter[0], filter[1]);
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw new Error(`Reading ${col}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function one(col: string, id: string): Promise<Rec | null> {
  if (!id) return null;
  const { data, error } = await sb.from("records").select("data").eq("col", col).eq("id", id).maybeSingle();
  if (error) throw new Error(`Reading ${col}: ${error.message}`);
  return data ? data.data : null;
}
async function save(col: string, id: string, data: Rec) {
  const { error } = await sb.from("records").upsert({ col, id, data, updated_at: new Date().toISOString() }, { onConflict: "col,id" });
  if (error) throw new Error(`Saving ${col}: ${error.message}`);
}
// change an enrollment starting from its latest saved copy, so edits made in the app meanwhile are kept
async function patchEnrollment(id: string, f: (e: Rec) => Rec) {
  const cur = await one("enrollments", id);
  if (!cur) return;
  await save("enrollments", id, { ...f(cur), updatedAt: Date.now() });
}
const logAct = (a: Rec) => { const now = Date.now(); return save("activities", uid(), { at: now, createdAt: now, updatedAt: now, createdBy: a.by || "", ...a }); };

// ---------- journeys: the built-in ones (copied here by the app) plus the team's saved changes ----------
async function journeyMap() {
  const defaults: Rec[] = ((await one("meta", "journeyDefaults")) || {}).list || [];
  const saved = Object.fromEntries((await rows("journeys")).map((r) => [r.id, r.data]));
  const map: Record<string, Rec> = {};
  for (const j of defaults) map[j.id] = saved[j.id] ? { ...j, ...saved[j.id], id: j.id } : j;
  for (const [id, j] of Object.entries(saved)) if (!map[id]) map[id] = { ...j, id };
  for (const id of Object.keys(map)) if (map[id].deleted) delete map[id];
  return map;
}
const stepsOf = (e: Rec, j: Rec | undefined): Rec[] => ((Array.isArray(e.steps) && e.steps.length ? e.steps : (j && j.steps) || []) as Rec[]).map((s) => ({ ...s, type: s.type === "call" ? "call" : "email" }));
export const modeOf = (e: Rec, j: Rec | undefined) => e.sendMode || (j && j.sendMode) || "approve";

// ---------- fill-in fields, same as the app ----------
const LABELS: Record<string, string> = { greeting: "greeting", first_name: "contact first name", last_name: "contact last name", contact_name: "contact full name", company: "company name", my_name: "your name", my_first_name: "your first name", quote_number: "latest quote number", quote_total: "latest quote total", price_quoted: "opportunity price quoted", service: "service", interval: "interval", service_date: "service date", contract_end: "contract end" };
const ALIAS: Record<string, string> = { contact_first_name: "first_name", firstname: "first_name", contact_last_name: "last_name", lastname: "last_name", contact_full_name: "contact_name", full_name: "contact_name", company_name: "company", account_name: "company", account: "company", user_first_name: "my_first_name", sender_first_name: "my_first_name", user_name: "my_name", user_full_name: "my_name", sender_name: "my_name" };
export function fill(text: string, data: Record<string, string>, missing: Set<string>, html = false) {
  return String(text || "").replace(/%?\{(\w+)\}/g, (m, raw) => {
    const key = ALIAS[raw.toLowerCase()] || raw.toLowerCase();
    if (!(key in data)) { missing.add(raw); return m; }
    if (!data[key]) { missing.add(LABELS[key] || key.replace(/_/g, " ")); return `[${LABELS[key] || key}]`; }
    return html ? esc(data[key]) : data[key];
  }).replace(/ ,/g, ",");
}
const pname = (c: Rec) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || c.email || "";
async function mergeData(e: Rec, ct: Rec, owner: Rec, needsDeal: boolean) {
  const co = (await one("companies", e.companyId)) || {};
  let deal: Rec | null = null, q: Rec | null = null, k: Rec | null = null;
  if (needsDeal) {
    deal = e.dealId ? await one("deals", e.dealId) : (await rows("deals", ["data->>companyId", e.companyId])).map((r) => r.data).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
    const quotes = (await rows("quotes", e.dealId ? ["data->>dealId", e.dealId] : ["data->>companyId", e.companyId])).map((r) => r.data).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    q = quotes[0] || null;
    k = (await rows("contracts", ["data->>companyId", e.companyId])).map((r) => r.data).filter((c) => (c.status || "active") === "active" && isDate(c.end)).sort((a, b) => (a.end < b.end ? -1 : 1))[0] || null;
  }
  const h = local().hour;
  const total = q ? (q.total != null ? +q.total : (q.items || []).reduce((t: number, i: Rec) => t + (+i.qty || 0) * (+i.price || 0), 0)) : 0;
  const svc = deal ? (deal.serviceType && deal.serviceType !== "Chat - Unknown" ? deal.serviceType : deal.name || "") : "";
  return {
    greeting: h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening",
    first_name: ct.firstName || "", last_name: ct.lastName || "", contact_name: pname(ct), company: co.name || "",
    my_name: owner.name || "", my_first_name: String(owner.name || "").split(" ")[0],
    quote_number: q?.number ? String(q.number) : "", quote_total: q ? money2(total) : "", price_quoted: deal?.priceQuoted ? money2(deal.priceQuoted) : "",
    service: String(svc).toLowerCase(), interval: String(deal?.interval || "").toLowerCase(),
    service_date: isDate(deal?.serviceDate) ? longDate(deal!.serviceDate) : "",
    contract_end: k ? longDate(k.end, true) : "",
  };
}

// ---------- the email itself ----------
export const textToHtml = (t: string) => t.trim().split(/\n{2,}/).map((p) => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>").join("");
export const htmlToText = (h: string) => h.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
export function inlineImages(html: string) {
  const atts: Rec[] = []; let n = 0;
  const out = html.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])data:(image\/[a-z0-9.+-]+);base64,([^"']+)\2/gi, (_m, pre, qt, type, b64) => {
    const cid = `pt${++n}.${Date.now().toString(36)}@papertrail`;
    const ext = (type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/\+.*/, "");
    atts.push({ "@odata.type": "#microsoft.graph.fileAttachment", name: `image${n}.${ext}`, contentType: type, contentBytes: b64, isInline: true, contentId: cid });
    return `${pre}${qt}cid:${cid}${qt}`;
  });
  return { html: out, atts };
}
async function addTracking(html: string) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"[b % 64]).join("");
  const links: string[] = [];
  let out = html.replace(/(<a\b[^>]*?\bhref\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi, (_m, pre, qt, href) => { links.push(href.replace(/&amp;/g, "&")); return `${pre}${qt}${TRACK_URL}?t=${token}&amp;l=${links.length - 1}${qt}`; });
  out += `<img src="${TRACK_URL}?t=${token}" width="1" height="1" alt="" style="width:1px;height:1px;border:0">`;
  const { error } = await sb.from("email_tracks").insert({ token, links });
  if (error) return { html, token: "", links: [] as string[] };   // tracking isn't set up: send untouched
  return { html: out, token, links };
}

// ---------- Microsoft Graph, as the app itself (needs Mail.Send and Mail.ReadBasic.All application permissions) ----------
let tok = { v: "", exp: 0 };
async function graphToken() {
  if (tok.v && Date.now() < tok.exp) return tok.v;
  if (!env("MS_TENANT_ID") || !env("MS_CLIENT_ID") || !env("MS_CLIENT_SECRET")) throw new Error("Outlook isn't connected for automatic sending yet (MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET secrets are missing).");
  const r = await fetch(`https://login.microsoftonline.com/${env("MS_TENANT_ID")}/oauth2/v2.0/token`, { method: "POST", body: new URLSearchParams({ client_id: env("MS_CLIENT_ID"), client_secret: env("MS_CLIENT_SECRET"), grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Microsoft sign-in for automatic sending failed: " + String(j.error_description || j.error || r.status).split("\r\n")[0].replace(/^AADSTS\d+:\s*/, ""));
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return tok.v;
}
async function graph(path: string, init: RequestInit = {}) {
  const r = await fetch("https://graph.microsoft.com/v1.0" + path, { ...init, headers: { authorization: "Bearer " + (await graphToken()), ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) } });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const msg = (j.error && j.error.message) || `Outlook returned ${r.status}`;
    throw new Error(r.status === 403 ? `Outlook refused (${msg}). Check that Mail.Send and Mail.ReadBasic.All have admin consent.` : msg);
  }
  return r.status === 202 || r.status === 204 ? {} : r.json();
}
async function replySince(owner: string, addrs: string[], since: number) {
  const day = new Date(since - 864e5).toISOString().slice(0, 10);   // a day early so time zones can't hide a reply; exact time is checked below
  for (const a of addrs) {
    const kql = `"from:${a.replace(/"/g, "")} AND received>=${day}"`;
    const r = await graph(`/users/${encodeURIComponent(owner)}/messages?$search=${encodeURIComponent(kql)}&$select=subject,receivedDateTime,from&$top=25`);
    const hit = (r.value || []).filter((m: Rec) => Date.parse(m.receivedDateTime) > since && String(m.from?.emailAddress?.address || "").toLowerCase() === a).sort((x: Rec, y: Rec) => Date.parse(x.receivedDateTime) - Date.parse(y.receivedDateTime))[0];
    if (hit) return hit;
  }
  return null;
}

// ---------- one run ----------
type Result = { who: string; journey: string; step: number; result: "sent" | "would send" | "paused" | "ended" | "skipped"; note?: string };
export async function run(opts: { dryRun?: boolean; onlyId?: string; today?: string }) {
  const today = opts.today || local().ymd;
  const journeys = await journeyMap();
  const enrollments = (await rows("enrollments", ["data->>status", "active"])).filter((r) => !opts.onlyId || r.id === opts.onlyId);
  const profiles: Record<string, Rec> = {};
  { const { data, error } = await sb.from("profiles").select("id,name,email,active"); if (error) throw new Error("Reading people: " + error.message); for (const p of data || []) profiles[p.id] = p; }
  const out: Result[] = [];
  let sent = 0;
  for (const { id, data: e } of enrollments) {
    if (sent >= MAX_PER_RUN) break;
    const j = journeys[e.journeyId];
    const s = (e.schedule || []).find((x: Rec) => x.status === "pending");
    if (!s || !isDate(s.due) || s.due > today) continue;
    if (modeOf(e, j) !== "auto") continue;
    const st = stepsOf(e, j)[s.step];
    if (!st || st.type === "call") continue;   // calls always wait for a person
    const ct = (await one("contacts", e.contactId)) || {};
    const who = pname(ct) || "(contact)";
    const jname = (j && j.name) || "Journey";
    const fail = async (note: string) => {
      out.push({ who, journey: jname, step: s.step + 1, result: "skipped", note });
      if (!opts.dryRun) await patchEnrollment(id, (x) => ({ ...x, lastSendError: { at: Date.now(), step: s.step, msg: note } }));
    };
    try {
      const to = String(ct.email || ct.email2 || "").trim();
      const addrs = [...new Set([ct.email, ct.email2].map((x) => String(x || "").trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
      if (!addrs.length) { await fail(`${who} has no email address.`); continue; }
      const owner = profiles[e.ownerId];
      if (!owner || !owner.email || owner.active === false) { await fail("The journey's owner has no active Paper Trail login with an email, so there's no mailbox to send from."); continue; }

      // they wrote back? pause or end instead of sending
      const reply = await replySince(owner.email, addrs, e.resumedAt || e.startedAt || 0);
      if (reply) {
        const stop = e.onReply === "stop";
        out.push({ who, journey: jname, step: s.step + 1, result: stop ? "ended" : "paused", note: `Replied: ${reply.subject || "(no subject)"}` });
        if (!opts.dryRun) {
          await patchEnrollment(id, (x) => ({ ...x, status: stop ? "stopped" : "paused", stopReason: "replied", replySubject: String(reply.subject || ""), replyAt: Date.parse(reply.receivedDateTime) || Date.now(), [stop ? "stoppedAt" : "pausedAt"]: Date.now() }));
          await logAct({ type: "note", by: e.ownerId, text: `${who} replied, so ${jname} was ${stop ? "ended" : "paused"}`, companyId: e.companyId, contactId: e.contactId });
        }
        continue;
      }

      const needsDeal = /\{(quote_|price_quoted|service|interval|contract_end)/i.test(String(st.subject || "") + String(st.body || ""));
      const data = await mergeData(e, ct, owner, needsDeal);
      const missing = new Set<string>();
      const subject = fill(st.subject || "", data, missing).trim();
      let html = st.html ? fill(st.body || "", data, missing, true) : textToHtml(fill(st.body || "", data, missing));
      if (!subject) missing.add("subject");
      if (missing.size) { await fail(`Not sent: it's missing ${[...missing].join(", ")}. Fill that in, or send this one yourself.`); continue; }
      if (opts.dryRun) { out.push({ who, journey: jname, step: s.step + 1, result: "would send", note: subject }); continue; }

      const sig = (await one("sigs", e.ownerId)) || {};
      if (sig.html && sig.on !== false) html += `<br><div class="pt-signature">${sig.html}</div>`;
      let track = { token: "", links: [] as string[] };
      if (env("TRACKING") !== "off" && sig.track !== false) { const t = await addTracking(html); html = t.html; track = t; }
      const inl = inlineImages(html);
      await graph(`/users/${encodeURIComponent(owner.email)}/sendMail`, { method: "POST", body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: inl.html }, toRecipients: [{ emailAddress: { address: to } }], ...(inl.atts.length ? { attachments: inl.atts } : {}) }, saveToSentItems: true }) });
      sent++;
      const now = Date.now();
      await patchEnrollment(id, (x) => {
        const schedule = (x.schedule || []).map((y: Rec) => (y.step === s.step ? { ...y, status: "sent", sentAt: now, sentBy: "auto" } : y));
        const done = !schedule.some((y: Rec) => y.status === "pending");
        const { lastSendError: _drop, ...rest } = x;
        return { ...rest, schedule, ...(done ? { status: "completed", completedAt: now } : {}) };
      });
      await logAct({ type: "email", by: e.ownerId, auto: true, text: subject + "\n" + (st.html ? htmlToText(fill(st.body || "", data, new Set(), true)) : fill(st.body || "", data, new Set())), companyId: e.companyId, contactId: e.contactId, dealId: e.dealId || "", ...(track.token ? { track: track.token, links: track.links } : {}) });
      out.push({ who, journey: jname, step: s.step + 1, result: "sent", note: subject });
    } catch (err) {
      await fail(String((err as Error).message || err));
    }
  }
  return { today, sent, results: out };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const body = await req.json().catch(() => ({}));
  const cron = !!env("CRON_SECRET") && req.headers.get("x-cron-secret") === env("CRON_SECRET");
  let by = "schedule";
  if (!cron) {
    // someone pressing "Send due emails now" in the app: must be a signed-in team member
    const auth = req.headers.get("authorization") || "";
    if (!/^Bearer\s+\S+/.test(auth)) return json({ error: "Not allowed" }, 401);
    const user = createClient(URL_, env("SUPABASE_ANON_KEY") || String(KEY), { global: { headers: { Authorization: auth } } });
    const m = await user.rpc("is_member");
    if (m.error || !m.data) return json({ error: "Not allowed" }, 403);
    by = "app";
  }
  const t = local();
  if (by === "schedule") {
    if (t.hm < SEND_AT) return json({ skipped: `Waiting until ${SEND_AT}` });
    const meta = (await one("meta", "autosend")) || {};
    if (meta.lastRunDate === t.ymd) return json({ skipped: "Already ran today" });
    await save("meta", "autosend", { ...meta, lastRunDate: t.ymd, runningSince: Date.now() });
  }
  try {
    const r = await run({ dryRun: !!body.dryRun, onlyId: body.enrollmentId ? String(body.enrollmentId) : undefined });
    if (!body.dryRun) {
      const meta = (await one("meta", "autosend")) || {};
      await save("meta", "autosend", { ...meta, ...(by === "schedule" ? { lastRunDate: t.ymd } : {}), runningSince: null, lastRunAt: Date.now(), lastRunBy: by, lastSent: r.sent, lastResults: r.results.slice(0, 50), lastError: "" });
    }
    return json(r);
  } catch (err) {
    const msg = String((err as Error).message || err);
    const meta = (await one("meta", "autosend").catch(() => null)) || {};
    await save("meta", "autosend", { ...meta, runningSince: null, lastRunAt: Date.now(), lastRunBy: by, lastError: msg }).catch(() => {});
    return json({ error: msg }, 500);
  }
});
