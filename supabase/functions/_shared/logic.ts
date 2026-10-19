// Logik för Edge Functions, utan Deno-specifika anrop så att den kan testas i Node.
// index.ts i respektive funktion kopplar in riktig databas, Stripe och e-post.

export type Json = Record<string, unknown>;

export interface Db {
  insertLead(row: Json): Promise<{ id: string }>;
  countRecentLeads(email: string, sinceIso: string): Promise<number>;
  getLead(id: string): Promise<Json | null>;
  markLeadPaid(id: string, paidAtIso: string): Promise<void>;
  insertPurchase(row: Json): Promise<'inserted' | 'exists'>;
}

export interface Deps {
  db: Db;
  now?: () => Date;
  allowedOrigins?: string[];               // tom = alla
  notify?: (lead: Json, id: string) => Promise<void>;
  stripeSession?: (sessionId: string) => Promise<Json | null>;
  expectedPaymentLink?: string;            // plink_... om bara en viss betallänk ska godtas
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_BODY = 3_000_000;                // byte; ett protokoll är normalt 50–500 kB
const MAX_LEADS_PER_HOUR = 5;

export function corsHeaders(origin: string | null, allowed: string[] = []): Record<string, string> {
  const ok = !allowed.length || (origin && allowed.includes(origin));
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : allowed[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function reply(status: number, body: Json, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

async function readJson(req: Request): Promise<Json | null> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('too_large'), { status: 413 });
  try { const j = JSON.parse(text); return j && typeof j === 'object' ? j : null; } catch { return null; }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ---------- submit-lead ---------- */
export async function handleSubmitLead(req: Request, deps: Deps): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'), deps.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'method' }, cors);
  let body: Json | null;
  try { body = await readJson(req); } catch (e) { return reply((e as { status?: number }).status || 400, { error: 'too_large' }, cors); }
  if (!body) return reply(400, { error: 'bad_json' }, cors);

  const email = str(body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return reply(400, { error: 'email' }, cors);
  if (body.consent !== true) return reply(400, { error: 'consent' }, cors);
  const consentText = str(body.consentText, 1000);
  if (!consentText) return reply(400, { error: 'consent' }, cors);
  if (body.result != null && typeof body.result !== 'object') return reply(400, { error: 'result' }, cors);

  const now = (deps.now || (() => new Date()))();
  const recent = await deps.db.countRecentLeads(email, new Date(now.getTime() - 3600_000).toISOString());
  if (recent >= MAX_LEADS_PER_HOUR) return reply(429, { error: 'rate_limited' }, cors);

  const row: Json = {
    email,
    company: str(body.company, 200) || null,
    website: str(body.website, 300) || null,
    consent_text: consentText,
    profile: body.profile && typeof body.profile === 'object' ? body.profile : null,
    audit: body.audit && typeof body.audit === 'object' ? body.audit : null,
    result: body.result || null
  };
  const { id } = await deps.db.insertLead(row);
  if (deps.notify) { try { await deps.notify(row, id); } catch { /* e-post är en bonus, leaden är sparad */ } }
  return reply(200, { id }, cors);
}

/* ---------- verify-payment ---------- */
export async function handleVerifyPayment(req: Request, deps: Deps): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'), deps.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'method' }, cors);
  let body: Json | null;
  try { body = await readJson(req); } catch { return reply(413, { error: 'too_large' }, cors); }
  const sessionId = str(body && body.session_id, 300);
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return reply(400, { error: 'session' }, cors);
  if (!deps.stripeSession) return reply(500, { error: 'not_configured' }, cors);

  const s = await deps.stripeSession(sessionId);
  if (!s) return reply(404, { paid: false, error: 'not_found' }, cors);
  const paid = s.payment_status === 'paid' || (s.status === 'complete' && s.payment_status === 'no_payment_required');
  if (!paid) return reply(402, { paid: false, error: 'unpaid' }, cors);
  if (deps.expectedPaymentLink && s.payment_link !== deps.expectedPaymentLink) return reply(403, { paid: false, error: 'wrong_product' }, cors);

  const leadId = typeof s.client_reference_id === 'string' && /^[0-9a-f-]{36}$/.test(s.client_reference_id) ? s.client_reference_id : null;
  const details = (s.customer_details || {}) as Json;
  const email = str(details.email, 254) || null;
  const now = (deps.now || (() => new Date()))().toISOString();
  await deps.db.insertPurchase({ session_id: sessionId, lead_id: leadId, email, amount_total: s.amount_total ?? null, currency: s.currency ?? null });

  let lead: Json | null = null;
  if (leadId) {
    lead = await deps.db.getLead(leadId);
    if (lead) await deps.db.markLeadPaid(leadId, now);
  }
  return reply(200, { paid: true, leadId, email: (lead && lead.email) || email, result: lead ? lead.result : null }, cors);
}

/* ---------- e-post om ny lead ---------- */
export function leadEmail(row: Json, id: string, siteUrl: string): { subject: string; text: string } {
  const a = (row.audit || {}) as Json;
  const fmt = (n: unknown) => (typeof n === 'number' ? Math.round(n).toLocaleString('sv-SE') + ' kr' : '–');
  const subject = `Ny lead: ${row.company || row.email} (betyg ${a.score ?? '–'})`;
  const text = [
    `E-post: ${row.email}`,
    `Företag: ${row.company || '–'}`,
    `Webbplats: ${row.website || '–'}`,
    `Betyg: ${a.score ?? '–'} / 100`,
    `Kostnad per månad: ${fmt(a.spendMonthly)}`,
    `Uppskattat slöseri per månad: ${fmt(a.wasteMonthly)}`,
    '',
    siteUrl ? `Öppna i adminvyn: ${siteUrl.replace(/\/$/, '')}/#admin` : '',
    `Lead-id: ${id}`
  ].join('\n');
  return { subject, text };
}
