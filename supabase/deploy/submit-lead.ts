// @ts-nocheck
// submit-lead: genererad av scripts/bundle-functions.mjs – ändra i supabase/functions/ i stället.

// supabase/functions/_shared/logic.ts
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
var MAX_BODY = 3e6;
var MAX_LEADS_PER_HOUR = 5;
function corsHeaders(origin, allowed = []) {
  const ok = !allowed.length || origin && allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin || "*" : allowed[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}
function reply(status, body, cors) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
async function readJson(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error("too_large"), { status: 413 });
  try {
    const j = JSON.parse(text);
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
}
var str = (v, max) => typeof v === "string" ? v.trim().slice(0, max) : "";
async function handleSubmitLead(req, deps) {
  const cors = corsHeaders(req.headers.get("origin"), deps.allowedOrigins);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method" }, cors);
  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return reply(e.status || 400, { error: "too_large" }, cors);
  }
  if (!body) return reply(400, { error: "bad_json" }, cors);
  const email = str(body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return reply(400, { error: "email" }, cors);
  if (body.consent !== true) return reply(400, { error: "consent" }, cors);
  const consentText = str(body.consentText, 1e3);
  if (!consentText) return reply(400, { error: "consent" }, cors);
  if (body.result != null && typeof body.result !== "object") return reply(400, { error: "result" }, cors);
  const now = (deps.now || (() => /* @__PURE__ */ new Date()))();
  const recent = await deps.db.countRecentLeads(email, new Date(now.getTime() - 36e5).toISOString());
  if (recent >= MAX_LEADS_PER_HOUR) return reply(429, { error: "rate_limited" }, cors);
  const row = {
    email,
    company: str(body.company, 200) || null,
    website: str(body.website, 300) || null,
    consent_text: consentText,
    profile: body.profile && typeof body.profile === "object" ? body.profile : null,
    audit: body.audit && typeof body.audit === "object" ? body.audit : null,
    result: body.result || null
  };
  const { id } = await deps.db.insertLead(row);
  if (deps.notify) {
    try {
      await deps.notify(row, id);
    } catch {
    }
  }
  return reply(200, { id }, cors);
}
function leadEmail(row, id, siteUrl) {
  const a = row.audit || {};
  const fmt = (n) => typeof n === "number" ? Math.round(n).toLocaleString("sv-SE") + " kr" : "\u2013";
  const subject = `Ny lead: ${row.company || row.email} (betyg ${a.score ?? "\u2013"})`;
  const text = [
    `E-post: ${row.email}`,
    `F\xF6retag: ${row.company || "\u2013"}`,
    `Webbplats: ${row.website || "\u2013"}`,
    `Betyg: ${a.score ?? "\u2013"} / 100`,
    `Kostnad per m\xE5nad: ${fmt(a.spendMonthly)}`,
    `Uppskattat sl\xF6seri per m\xE5nad: ${fmt(a.wasteMonthly)}`,
    "",
    siteUrl ? `\xD6ppna i adminvyn: ${siteUrl.replace(/\/$/, "")}/#admin` : "",
    `Lead-id: ${id}`
  ].join("\n");
  return { subject, text };
}

// supabase/functions/_shared/rest.ts
function restDb(url, key, fetchFn = fetch) {
  const base = url.replace(/\/$/, "") + "/rest/v1";
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  async function call(path, init = {}) {
    const res = await fetchFn(base + path, { ...init, headers: { ...headers, ...init.headers || {} } });
    if (!res.ok && res.status !== 409) throw new Error(`db ${res.status}: ${await res.text()}`);
    return res;
  }
  return {
    async insertLead(row) {
      const res = await call("/leads?select=id", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
      const [r] = await res.json();
      return { id: r.id };
    },
    async countRecentLeads(email, sinceIso) {
      const res = await call(`/leads?select=id&email=eq.${encodeURIComponent(email)}&created_at=gte.${encodeURIComponent(sinceIso)}`, { headers: { Prefer: "count=exact", Range: "0-0" } });
      const range = res.headers.get("content-range") || "";
      const n = Number(range.split("/")[1]);
      return Number.isFinite(n) ? n : (await res.json()).length;
    },
    async getLead(id) {
      const res = await call(`/leads?select=id,email,result&id=eq.${encodeURIComponent(id)}`);
      const rows = await res.json();
      return rows[0] || null;
    },
    async markLeadPaid(id, paidAtIso) {
      await call(`/leads?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ paid: true, paid_at: paidAtIso }) });
    },
    async insertPurchase(row) {
      const res = await call("/purchases?on_conflict=session_id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(row) });
      return res.status === 409 ? "exists" : "inserted";
    }
  };
}
var origins = (v) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);

// supabase/functions/submit-lead/index.ts
var env = (k) => Deno.env.get(k) || "";
var db = restDb(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
async function notify(row, id) {
  const key = env("RESEND_API_KEY"), to = env("NOTIFY_EMAIL");
  if (!key || !to) return;
  const { subject, text } = leadEmail(row, id, env("SITE_URL"));
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("NOTIFY_FROM") || "Annonsbesiktningen <onboarding@resend.dev>", to: [to], subject, text, reply_to: row.email })
  });
}
Deno.serve((req) => handleSubmitLead(req, { db, notify, allowedOrigins: origins(env("ALLOWED_ORIGINS")) }).catch((e) => {
  console.error(e);
  return new Response(JSON.stringify({ error: "server" }), { status: 500, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } });
}));
