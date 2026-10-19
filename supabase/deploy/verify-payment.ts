// @ts-nocheck
// verify-payment: genererad av scripts/bundle-functions.mjs – ändra i supabase/functions/ i stället.

// supabase/functions/_shared/logic.ts
var MAX_BODY = 3e6;
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
async function handleVerifyPayment(req, deps) {
  const cors = corsHeaders(req.headers.get("origin"), deps.allowedOrigins);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method" }, cors);
  let body;
  try {
    body = await readJson(req);
  } catch {
    return reply(413, { error: "too_large" }, cors);
  }
  const sessionId = str(body && body.session_id, 300);
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return reply(400, { error: "session" }, cors);
  if (!deps.stripeSession) return reply(500, { error: "not_configured" }, cors);
  const s = await deps.stripeSession(sessionId);
  if (!s) return reply(404, { paid: false, error: "not_found" }, cors);
  const paid = s.payment_status === "paid" || s.status === "complete" && s.payment_status === "no_payment_required";
  if (!paid) return reply(402, { paid: false, error: "unpaid" }, cors);
  if (deps.expectedPaymentLink && s.payment_link !== deps.expectedPaymentLink) return reply(403, { paid: false, error: "wrong_product" }, cors);
  const leadId = typeof s.client_reference_id === "string" && /^[0-9a-f-]{36}$/.test(s.client_reference_id) ? s.client_reference_id : null;
  const details = s.customer_details || {};
  const email = str(details.email, 254) || null;
  const now = (deps.now || (() => /* @__PURE__ */ new Date()))().toISOString();
  await deps.db.insertPurchase({ session_id: sessionId, lead_id: leadId, email, amount_total: s.amount_total ?? null, currency: s.currency ?? null });
  let lead = null;
  if (leadId) {
    lead = await deps.db.getLead(leadId);
    if (lead) await deps.db.markLeadPaid(leadId, now);
  }
  return reply(200, { paid: true, leadId, email: lead && lead.email || email, result: lead ? lead.result : null }, cors);
}

// supabase/functions/_shared/rest.ts
function restDb(url, key, fetchFn = fetch) {
  const base = url.replace(/\/$/, "") + "/rest/v1";
  const headers = key.startsWith("sb_") ? { apikey: key, "Content-Type": "application/json" } : { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
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
function serverKey(get) {
  const raw = get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const o = JSON.parse(raw);
      const v = o.default || Object.values(o)[0];
      if (typeof v === "string" && v) return v;
    } catch {
    }
  }
  return get("SUPABASE_SECRET_KEY") || get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
var origins = (v) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);

// supabase/functions/verify-payment/index.ts
var env = (k) => Deno.env.get(k) || "";
var db = restDb(env("SUPABASE_URL"), serverKey((k) => Deno.env.get(k)));
async function stripeSession(id) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`stripe ${res.status}`);
  return await res.json();
}
Deno.serve((req) => handleVerifyPayment(req, {
  db,
  stripeSession: env("STRIPE_SECRET_KEY") ? stripeSession : void 0,
  expectedPaymentLink: env("STRIPE_PAYMENT_LINK_ID") || void 0,
  allowedOrigins: origins(env("ALLOWED_ORIGINS"))
}).catch((e) => {
  console.error(e);
  return new Response(JSON.stringify({ error: "server" }), { status: 500, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } });
}));
