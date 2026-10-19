import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSubmitLead, handleVerifyPayment, leadEmail } from '../supabase/functions/_shared/logic.ts';
import { restDb } from '../supabase/functions/_shared/rest.ts';

function memDb() {
  const leads: any[] = [], purchases: any[] = [];
  return {
    leads, purchases,
    async insertLead(row: any) { const id = '00000000-0000-4000-8000-' + String(leads.length + 1).padStart(12, '0'); leads.push({ id, created_at: new Date().toISOString(), ...row }); return { id }; },
    async countRecentLeads(email: string, since: string) { return leads.filter(l => l.email === email && l.created_at >= since).length; },
    async getLead(id: string) { return leads.find(l => l.id === id) || null; },
    async markLeadPaid(id: string, at: string) { const l = leads.find(x => x.id === id); if (l) { l.paid = true; l.paid_at = at; } },
    async insertPurchase(row: any) { if (purchases.some(p => p.session_id === row.session_id)) return 'exists' as const; purchases.push(row); return 'inserted' as const; }
  };
}
const post = (body: unknown, origin = 'https://site.se') => new Request('https://x/functions/v1/f', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const lead = { email: 'Anna@Foretag.se', company: 'Företaget AB', consent: true, consentText: 'Jag godkänner …', profile: { type: 'ecom' }, audit: { score: 61, spendMonthly: 42000, wasteMonthly: 5100 }, result: { overall: 61, findings: [] } };

test('submit-lead sparar lead, normaliserar e-post och mejlar', async () => {
  const db = memDb(); const sent: any[] = [];
  const res = await handleSubmitLead(post(lead), { db, notify: async (r, id) => { sent.push({ r, id }); } });
  assert.equal(res.status, 200);
  const { id } = await res.json();
  assert.equal(db.leads[0].id, id);
  assert.equal(db.leads[0].email, 'anna@foretag.se');
  assert.equal(db.leads[0].consent_text, 'Jag godkänner …');
  assert.equal(sent.length, 1);
});

test('submit-lead kräver giltig e-post och samtycke', async () => {
  const db = memDb();
  assert.equal((await handleSubmitLead(post({ ...lead, email: 'nej' }), { db })).status, 400);
  assert.equal((await handleSubmitLead(post({ ...lead, consent: false }), { db })).status, 400);
  assert.equal((await handleSubmitLead(post({ ...lead, consentText: '' }), { db })).status, 400);
  assert.equal((await handleSubmitLead(post('{inte json'), { db })).status, 400);
  assert.equal(db.leads.length, 0);
});

test('submit-lead begränsar antal per timme och klarar trasig e-posttjänst', async () => {
  const db = memDb();
  for (let i = 0; i < 5; i++) assert.equal((await handleSubmitLead(post(lead), { db, notify: async () => { throw new Error('resend nere'); } })).status, 200);
  assert.equal((await handleSubmitLead(post(lead), { db })).status, 429);
});

test('submit-lead: CORS följer ALLOWED_ORIGINS', async () => {
  const db = memDb();
  const ok = await handleSubmitLead(post(lead, 'https://min.se'), { db, allowedOrigins: ['https://min.se'] });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://min.se');
  const other = await handleSubmitLead(new Request('https://x', { method: 'OPTIONS', headers: { origin: 'https://ond.se' } }), { db, allowedOrigins: ['https://min.se'] });
  assert.equal(other.headers.get('access-control-allow-origin'), 'https://min.se');
});

test('verify-payment låser upp betald session och returnerar protokollet', async () => {
  const db = memDb();
  const { id } = await db.insertLead({ email: 'a@b.se', result: { overall: 70 } });
  const session = { payment_status: 'paid', status: 'complete', client_reference_id: id, customer_details: { email: 'a@b.se' }, amount_total: 49500, currency: 'sek', payment_link: 'plink_1' };
  const deps = { db, stripeSession: async () => session, expectedPaymentLink: 'plink_1' };
  const res = await handleVerifyPayment(post({ session_id: 'cs_test_abc123' }), deps);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.paid, true); assert.deepEqual(j.result, { overall: 70 });
  assert.equal(db.leads[0].paid, true);
  assert.equal(db.purchases.length, 1);
  await handleVerifyPayment(post({ session_id: 'cs_test_abc123' }), deps);
  assert.equal(db.purchases.length, 1, 'samma betalning räknas en gång');
});

test('verify-payment nekar obetalt, fel produkt och skräp-id', async () => {
  const db = memDb();
  const mk = (s: any) => ({ db, stripeSession: async () => s, expectedPaymentLink: 'plink_1' });
  assert.equal((await handleVerifyPayment(post({ session_id: 'cs_test_x1' }), mk({ payment_status: 'unpaid', status: 'open', payment_link: 'plink_1' }))).status, 402);
  assert.equal((await handleVerifyPayment(post({ session_id: 'cs_test_x1' }), mk({ payment_status: 'paid', payment_link: 'plink_annan' }))).status, 403);
  assert.equal((await handleVerifyPayment(post({ session_id: 'cs_test_x1' }), mk(null))).status, 404);
  assert.equal((await handleVerifyPayment(post({ session_id: '../../etc' }), mk({}))).status, 400);
  assert.equal(db.purchases.length, 0);
});

test('verify-payment utan lead-id (t.ex. annan webbläsare) bekräftar ändå köpet', async () => {
  const db = memDb();
  const res = await handleVerifyPayment(post({ session_id: 'cs_live_q9' }), { db, stripeSession: async () => ({ payment_status: 'paid', customer_details: { email: 'x@y.se' } }) });
  const j = await res.json();
  assert.equal(j.paid, true); assert.equal(j.result, null); assert.equal(j.email, 'x@y.se');
});

test('restDb pratar PostgREST med rätt anrop', async () => {
  const calls: any[] = [];
  const fake = (async (url: string, init: any) => {
    calls.push({ url, init });
    if (init.method === 'POST' && url.includes('/leads')) return new Response(JSON.stringify([{ id: 'abc' }]), { status: 201 });
    if (url.includes('count') || init.headers.Prefer === 'count=exact') return new Response('[]', { status: 206, headers: { 'content-range': '0-0/3' } });
    if (url.includes('/purchases')) return new Response('', { status: 201 });
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
  const db = restDb('https://p.supabase.co/', 'sb_secret_x', fake);
  assert.deepEqual(await db.insertLead({ email: 'a@b.se' }), { id: 'abc' });
  assert.equal(await db.countRecentLeads('a+b@c.se', '2026-01-01T00:00:00Z'), 3);
  assert.equal(await db.insertPurchase({ session_id: 'cs_test_1' }), 'inserted');
  assert.match(calls[0].url, /^https:\/\/p\.supabase\.co\/rest\/v1\/leads\?select=id$/);
  assert.equal(calls[0].init.headers.apikey, 'sb_secret_x');
  assert.match(calls[1].url, /email=eq\.a%2Bb%40c\.se/);
});

test('lead-mejlet innehåller det viktigaste', () => {
  const { subject, text } = leadEmail({ email: 'a@b.se', company: 'AB', audit: { score: 55, spendMonthly: 30000, wasteMonthly: 4200 } }, 'id1', 'https://site.se/');
  assert.match(subject, /AB.*55/);
  assert.match(text, /4\s200 kr/);
  assert.match(text, /https:\/\/site\.se\/#admin/);
});

test('serverKey hittar nya och gamla nycklar; sb_-nycklar skickas utan Bearer', async () => {
  const { serverKey } = await import('../supabase/functions/_shared/rest.ts');
  assert.equal(serverKey(k => ({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_a"}', SUPABASE_SERVICE_ROLE_KEY: 'eyJ' } as any)[k]), 'sb_secret_a');
  assert.equal(serverKey(k => ({ SUPABASE_SERVICE_ROLE_KEY: 'eyJ' } as any)[k]), 'eyJ');
  let h: any;
  const db = restDb('https://p.supabase.co', 'sb_secret_a', (async (u: string, i: any) => { h = i.headers; return new Response('[]'); }) as any);
  await db.getLead('x');
  assert.equal(h.apikey, 'sb_secret_a'); assert.equal(h.Authorization, undefined);
});
