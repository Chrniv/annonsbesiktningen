// Koppling till Google Ads API, bara läsning. Logiken ligger här utan Deno-anrop så att den kan testas i Node.
//
// Flödet:
//  1. Sidan skickar besökaren till Googles inloggning (OAuth med PKCE, access_type=online: ingen refresh token).
//  2. action "exchange": koden byts mot en åtkomsttoken här, där klienthemligheten finns. Token krypteras (AES-GCM)
//     och skickas tillbaka som en ogenomskinlig "session" som sidan inte kan läsa. Inget sparas i databasen.
//  3. action "query": sidan ber om en av de fasta rapporterna nedan. Frågan byggs här (ingen fri GAQL utifrån),
//     och Googles svar strömmas vidare till webbläsaren utan att läsas, så att analysen sker där som för CSV.
//  4. action "revoke": åtkomsten återkallas hos Google när datan är hämtad.
// Det finns inga anrop som ändrar något i kontot: bara listAccessibleCustomers, search, searchStream och revoke.
import { corsHeaders } from './logic.ts';

type Json = Record<string, unknown>;

export interface GoogleDeps {
  clientId: string;
  clientSecret: string;
  sealKey: string;                 // minst 32 tecken, slumpad; krypterar sessionen
  apiVersion?: string;             // t.ex. 'v26'
  developerToken?: string;         // behövs inte sedan 9 sep 2026; skickas bara om den är satt
  allowedOrigins?: string[];       // tom = alla
  fetchFn?: typeof fetch;
  now?: () => Date;
}

export const DEFAULT_API_VERSION = 'v26';
export const ADWORDS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const MAX_BODY = 20_000;
const MAX_DAYS = 400;
const MAX_ROOTS = 20;              // konton med direkt åtkomst som slås upp
const MAX_ACCOUNTS = 500;

/* ---------- Rapporterna som går att hämta ---------- */
// Fälten matchar src/googleAds.js, som gör om svaren till samma rapporter som en CSV-export ger.
const METRICS = 'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value';
export const REPORTS: Record<string, (from: string, to: string) => string> = {
  campaigns: (f, t) => `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, customer.currency_code, segments.date, ${METRICS}, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share FROM campaign WHERE segments.date BETWEEN '${f}' AND '${t}'`,
  // Söktermer utan klick kostar inget och används inte i analysen; utan dem blir svaret mycket mindre
  searchTerms: (f, t) => `SELECT search_term_view.search_term, search_term_view.status, segments.search_term_match_type, campaign.name, ad_group.name, ${METRICS} FROM search_term_view WHERE segments.date BETWEEN '${f}' AND '${t}' AND metrics.clicks > 0`,
  keywords: (f, t) => `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.quality_info.quality_score, ad_group.name, ad_group.status, campaign.name, campaign.status, ${METRICS} FROM keyword_view WHERE segments.date BETWEEN '${f}' AND '${t}' AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED'`,
  products: (f, t) => `SELECT segments.product_item_id, segments.product_title, campaign.name, ${METRICS} FROM shopping_performance_view WHERE segments.date BETWEEN '${f}' AND '${t}'`
};

/* ---------- Hjälpare ---------- */
function reply(status: number, body: Json, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const custId = (v: unknown) => { const s = str(v, 20).replace(/-/g, ''); return /^\d{10}$/.test(s) ? s : null; };
const isoDate = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
};

const enc = new TextEncoder(), dec = new TextDecoder();
const b64url = (b: Uint8Array) => { let s = ''; b.forEach(x => { s += String.fromCharCode(x); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = (s: string) => { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)); };
async function aesKey(secret: string) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(payload: Json, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(JSON.stringify(payload))));
  return b64url(iv) + '.' + b64url(ct);
}
export async function unseal(token: string, secret: string): Promise<Json | null> {
  try {
    const [a, b] = token.split('.');
    if (!a || !b) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64url(a) }, await aesKey(secret), unb64url(b));
    const o = JSON.parse(dec.decode(pt));
    return o && typeof o === 'object' ? o : null;
  } catch { return null; }
}

// Googles fel: { error: { code, message, details: [{ errors: [{ errorCode: { authorizationError: 'USER_PERMISSION_DENIED' }, message }] }] } }
// (searchStream lägger ibland felet i en lista)
export function googleError(body: unknown): { reason: string; message: string } {
  const o = (Array.isArray(body) ? body[0] : body) as Json | undefined;
  const e = (o && (o.error as Json)) || {};
  const details = Array.isArray(e.details) ? e.details as Json[] : [];
  for (const d of details) {
    const errs = Array.isArray(d.errors) ? d.errors as Json[] : [];
    for (const x of errs) {
      const code = (x.errorCode || {}) as Json;
      const k = Object.keys(code)[0];
      if (k) return { reason: String(code[k]), message: String(x.message || e.message || '') };
    }
  }
  return { reason: String(e.status || 'UNKNOWN'), message: String(e.message || '') };
}

/* ---------- Huvudfunktionen ---------- */
export async function handleGoogleAds(req: Request, deps: GoogleDeps): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'), deps.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'method' }, cors);
  if (!deps.clientId || !deps.clientSecret || !deps.sealKey || deps.sealKey.length < 32) return reply(500, { error: 'not_configured' }, cors);
  const text = await req.text();
  if (text.length > MAX_BODY) return reply(413, { error: 'too_large' }, cors);
  let body: Json;
  try { const j = JSON.parse(text); if (!j || typeof j !== 'object') throw 0; body = j; } catch { return reply(400, { error: 'bad_json' }, cors); }

  const f = deps.fetchFn || fetch;
  const now = () => (deps.now || (() => new Date()))();
  const version = /^v\d+(_\d+)?$/.test(deps.apiVersion || '') ? deps.apiVersion as string : DEFAULT_API_VERSION;
  const base = `https://googleads.googleapis.com/${version}`;
  const headers = (token: string, login?: string | null): Record<string, string> => ({
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    ...(login ? { 'login-customer-id': login } : {}),
    ...(deps.developerToken ? { 'developer-token': deps.developerToken } : {})
  });
  const search = async (token: string, customer: string, login: string, query: string) => {
    const res = await f(`${base}/customers/${customer}/googleAds:search`, { method: 'POST', headers: headers(token, login), body: JSON.stringify({ query }) });
    if (!res.ok) return null;
    const j = await res.json() as Json;
    return (Array.isArray(j.results) ? j.results : []) as Json[];
  };
  const session = async () => {
    const s = await unseal(str(body.session, 4000), deps.sealKey);
    if (!s || typeof s.t !== 'string' || typeof s.e !== 'number' || s.e <= now().getTime()) return null;
    return s.t as string;
  };

  const action = str(body.action, 20);

  if (action === 'exchange') {
    const code = str(body.code, 2000), verifier = str(body.codeVerifier, 200), redirectUri = str(body.redirectUri, 500);
    if (!code || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return reply(400, { error: 'bad_request' }, cors);
    let ru: URL;
    try { ru = new URL(redirectUri); } catch { return reply(400, { error: 'redirect' }, cors); }
    if (deps.allowedOrigins && deps.allowedOrigins.length && !deps.allowedOrigins.includes(ru.origin)) return reply(400, { error: 'redirect' }, cors);
    const res = await f(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, code_verifier: verifier, client_id: deps.clientId, client_secret: deps.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString()
    });
    const tok = await res.json().catch(() => ({})) as Json;
    if (!res.ok || typeof tok.access_token !== 'string') return reply(400, { error: 'oauth', reason: str(tok.error, 100) }, cors);
    if (!String(tok.scope || '').split(' ').includes(ADWORDS_SCOPE)) return reply(403, { error: 'scope' }, cors);
    const expiresAt = now().getTime() + Math.max(60, Math.min(3600, Number(tok.expires_in) || 3600) - 60) * 1000;
    const sessionToken = await seal({ t: tok.access_token, e: expiresAt }, deps.sealKey);
    const accounts = await listAccounts(tok.access_token);
    if (accounts.error) return reply(502, { error: 'google', reason: accounts.error.reason, message: accounts.error.message, session: sessionToken }, cors);
    return reply(200, { session: sessionToken, expiresAt, accounts: accounts.list }, cors);
  }

  if (action === 'query') {
    const token = await session();
    if (!token) return reply(401, { error: 'session' }, cors);
    const customer = custId(body.customerId), login = body.loginCustomerId ? custId(body.loginCustomerId) : customer;
    const build = REPORTS[str(body.report, 30)];
    const from = isoDate(body.from), to = isoDate(body.to);
    if (!customer || !login || !build || !from || !to) return reply(400, { error: 'bad_request' }, cors);
    const days = (Date.parse(to) - Date.parse(from)) / 864e5 + 1;
    if (days < 1 || days > MAX_DAYS || to > now().toISOString().slice(0, 10)) return reply(400, { error: 'period' }, cors);
    const res = await f(`${base}/customers/${customer}/googleAds:searchStream`, { method: 'POST', headers: headers(token, login), body: JSON.stringify({ query: build(from, to) }) });
    if (!res.ok) {
      const e = googleError(await res.json().catch(() => null));
      return reply(res.status === 401 ? 401 : 502, { error: res.status === 401 ? 'session' : 'google', status: res.status, ...e }, cors);
    }
    // Svaret läses inte här: det går direkt vidare till webbläsaren
    return new Response(res.body, { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  if (action === 'revoke') {
    const token = await session();
    if (token) await f(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => null);
    return reply(200, { ok: true }, cors);
  }

  return reply(400, { error: 'action' }, cors);

  // Konton som inloggningen når: direkt åtkomst, plus kontona under ett förvaltarkonto (MCC)
  async function listAccounts(token: string): Promise<{ list: Json[]; error?: { reason: string; message: string } }> {
    const res = await f(`${base}/customers:listAccessibleCustomers`, { method: 'GET', headers: headers(token) });
    if (!res.ok) return { list: [], error: googleError(await res.json().catch(() => null)) };
    const j = await res.json() as Json;
    const ids = (Array.isArray(j.resourceNames) ? j.resourceNames as string[] : []).map(n => String(n).split('/')[1]).filter(x => /^\d{10}$/.test(x)).slice(0, MAX_ROOTS);
    const out = new Map<string, Json>();
    const roots = await Promise.all(ids.map(async id => {
      const r = await search(token, id, id, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager, customer.test_account FROM customer LIMIT 1');
      return r && r[0] ? { id, c: (r[0].customer || {}) as Json } : null;
    }));
    for (const r of roots) if (r && !r.c.manager) out.set(r.id, { id: r.id, name: str(r.c.descriptiveName, 200), currency: str(r.c.currencyCode, 3), loginCustomerId: null, test: !!r.c.testAccount });
    for (const r of roots) {
      if (!r || !r.c.manager) continue;
      const kids = await search(token, r.id, r.id, "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.test_account FROM customer_client WHERE customer_client.manager = FALSE AND customer_client.status = 'ENABLED' LIMIT 1000") || [];
      for (const k of kids) {
        const c = (k.customerClient || {}) as Json, id = String(c.id || '');
        if (!/^\d{10}$/.test(id) || out.has(id)) continue;
        out.set(id, { id, name: str(c.descriptiveName, 200), currency: str(c.currencyCode, 3), loginCustomerId: r.id, via: str(r.c.descriptiveName, 200), test: !!c.testAccount });
      }
    }
    const list = [...out.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'sv')).slice(0, MAX_ACCOUNTS);
    return { list };
  }
}
