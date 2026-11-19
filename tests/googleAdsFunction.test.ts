import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleGoogleAds, seal, unseal, googleError, REPORTS, ADWORDS_SCOPE } from '../supabase/functions/_shared/googleAds.ts';

const KEY = 'k'.repeat(40);
const NOW = new Date('2026-11-19T12:00:00Z');
const post = (body: unknown, origin = 'https://site.se') => new Request('https://x/functions/v1/google-ads', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const verifier = 'v'.repeat(43);

// Falsk Google: token, kontolista, sökningar och återkallning. Sparar alla anrop.
function fakeGoogle(opts: { scope?: string; tokenFails?: boolean; streamStatus?: number } = {}) {
  const calls: { url: string; init: any }[] = [];
  const fetchFn = (async (url: string, init: any = {}) => {
    calls.push({ url, init });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (opts.tokenFails) return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: 'ya29.TOKEN', expires_in: 3599, scope: opts.scope ?? ADWORDS_SCOPE, token_type: 'Bearer' });
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return json({});
    if (url.endsWith('customers:listAccessibleCustomers')) return json({ resourceNames: ['customers/1111111111', 'customers/2222222222'] });
    if (url.endsWith('/customers/1111111111/googleAds:search')) return json({ results: [{ customer: { id: '1111111111', descriptiveName: 'Byrå MCC', currencyCode: 'SEK', manager: true } }] });
    if (url.endsWith('/customers/2222222222/googleAds:search')) return json({ results: [{ customer: { id: '2222222222', descriptiveName: 'Eget konto', currencyCode: 'EUR', manager: false } }] });
    if (url.includes('googleAds:search') && JSON.parse(init.body).query.includes('customer_client')) return json({ results: [] });
    if (url.endsWith('googleAds:searchStream')) {
      if (opts.streamStatus) return json([{ error: { code: 403, message: 'denied', status: 'PERMISSION_DENIED', details: [{ errors: [{ errorCode: { authorizationError: 'USER_PERMISSION_DENIED' }, message: 'User does not have permission' }] }] } }], opts.streamStatus);
      return new Response('[{"results":[{"campaign":{"name":"A"}}]}]', { status: 200 });
    }
    return json({ error: { message: 'unexpected ' + url } }, 500);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}
// customer_client-frågan för MCC:n ska ge underkonton
function withChildren(g: ReturnType<typeof fakeGoogle>) {
  const inner = g.fetchFn;
  g.fetchFn = (async (url: string, init: any = {}) => {
    if (url.endsWith('/customers/1111111111/googleAds:search') && JSON.parse(init.body).query.includes('customer_client')) {
      g.calls.push({ url, init });
      return json({ results: [{ customerClient: { id: '3333333333', descriptiveName: 'Kund A', currencyCode: 'SEK' } }, { customerClient: { id: '2222222222', descriptiveName: 'Eget konto', currencyCode: 'EUR' } }] });
    }
    return inner(url, init);
  }) as unknown as typeof fetch;
  return g;
}
const deps = (g: { fetchFn: typeof fetch }, extra = {}) => ({ clientId: 'cid', clientSecret: 'secret', sealKey: KEY, fetchFn: g.fetchFn, now: () => NOW, allowedOrigins: ['https://site.se'], ...extra });

test('sessionen går att öppna med rätt nyckel men inte med fel nyckel eller ändrad text', async () => {
  const s = await seal({ t: 'abc', e: 1 }, KEY);
  assert.deepEqual(await unseal(s, KEY), { t: 'abc', e: 1 });
  assert.equal(await unseal(s, 'x'.repeat(40)), null);
  assert.equal(await unseal(s.slice(0, -2) + (s.endsWith('A') ? 'BB' : 'AA'), KEY), null);
  assert.equal(await unseal('skräp', KEY), null);
  assert.ok(!s.includes('abc'), 'token syns inte i klartext');
});

test('exchange byter kod mot krypterad session och listar konton, även under MCC', async () => {
  const g = withChildren(fakeGoogle());
  const res = await handleGoogleAds(post({ action: 'exchange', code: '4/abc', codeVerifier: verifier, redirectUri: 'https://site.se/' }), deps(g));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.session && !String(body.session).includes('ya29'), 'token skickas inte i klartext');
  assert.deepEqual(body.accounts.map((a: any) => [a.id, a.loginCustomerId]), [['2222222222', null], ['3333333333', '1111111111']]);
  assert.equal(body.accounts[1].via, 'Byrå MCC');
  const tokenCall = g.calls.find(c => c.url.startsWith('https://oauth2.googleapis.com/token'))!;
  const form = new URLSearchParams(tokenCall.init.body);
  assert.equal(form.get('client_secret'), 'secret');
  assert.equal(form.get('code_verifier'), verifier);
  // Utvecklartoken skickas inte när den inte är satt
  assert.ok(g.calls.filter(c => c.url.includes('googleads')).every(c => !c.init.headers['developer-token']));
});

test('exchange avvisar fel redirect, saknad behörighet och misslyckad kod', async () => {
  assert.equal((await handleGoogleAds(post({ action: 'exchange', code: 'c', codeVerifier: verifier, redirectUri: 'https://ond.se/' }), deps(fakeGoogle()))).status, 400);
  assert.equal((await handleGoogleAds(post({ action: 'exchange', code: 'c', codeVerifier: 'kort', redirectUri: 'https://site.se/' }), deps(fakeGoogle()))).status, 400);
  assert.equal((await handleGoogleAds(post({ action: 'exchange', code: 'c', codeVerifier: verifier, redirectUri: 'https://site.se/' }), deps(fakeGoogle({ scope: 'openid' })))).status, 403);
  const bad = await handleGoogleAds(post({ action: 'exchange', code: 'c', codeVerifier: verifier, redirectUri: 'https://site.se/' }), deps(fakeGoogle({ tokenFails: true })));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).reason, 'invalid_grant');
});

test('query bygger frågan själv, skickar MCC-id och strömmar svaret vidare', async () => {
  const g = fakeGoogle();
  const session = await seal({ t: 'ya29.TOKEN', e: NOW.getTime() + 600_000 }, KEY);
  const res = await handleGoogleAds(post({ action: 'query', session, customerId: '333-333-3333', loginCustomerId: '1111111111', report: 'campaigns', from: '2026-08-21', to: '2026-11-18' }), deps(g));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '[{"results":[{"campaign":{"name":"A"}}]}]');
  const call = g.calls.find(c => c.url.endsWith('googleAds:searchStream'))!;
  assert.ok(call.url.includes('/v26/customers/3333333333/'));
  assert.equal(call.init.headers['login-customer-id'], '1111111111');
  assert.equal(call.init.headers.Authorization, 'Bearer ya29.TOKEN');
  assert.equal(JSON.parse(call.init.body).query, REPORTS.campaigns('2026-08-21', '2026-11-18'));
});

test('query tar inte emot egna frågor, felaktiga id eller perioder, eller utgången session', async () => {
  const g = fakeGoogle();
  const session = await seal({ t: 't', e: NOW.getTime() + 600_000 }, KEY);
  const q = (o: object) => handleGoogleAds(post({ action: 'query', session, customerId: '3333333333', report: 'campaigns', from: '2026-08-21', to: '2026-11-18', ...o }), deps(g));
  assert.equal((await q({ report: 'SELECT campaign.id FROM campaign' })).status, 400);
  assert.equal((await q({ report: 'mutate' })).status, 400);
  assert.equal((await q({ customerId: '123' })).status, 400);
  assert.equal((await q({ from: "2026-01-01' OR '1'='1" })).status, 400);
  assert.equal((await q({ from: '2026-02-30' })).status, 400);
  assert.equal((await q({ from: '2024-01-01' })).status, 400, 'för lång period');
  assert.equal((await q({ to: '2026-12-01' })).status, 400, 'framtida datum');
  const old = await seal({ t: 't', e: NOW.getTime() - 1 }, KEY);
  assert.equal((await q({ session: old })).status, 401);
  assert.equal(g.calls.length, 0, 'inget anrop till Google');
});

test('fel från Google kommer tillbaka med orsak', async () => {
  const g = fakeGoogle({ streamStatus: 403 });
  const session = await seal({ t: 't', e: NOW.getTime() + 600_000 }, KEY);
  const res = await handleGoogleAds(post({ action: 'query', session, customerId: '3333333333', report: 'keywords', from: '2026-08-21', to: '2026-11-18' }), deps(g));
  assert.equal(res.status, 502);
  const b = await res.json();
  assert.equal(b.reason, 'USER_PERMISSION_DENIED');
  assert.deepEqual(googleError({ error: { status: 'UNAUTHENTICATED', message: 'x' } }), { reason: 'UNAUTHENTICATED', message: 'x' });
});

test('revoke återkallar token hos Google; utan inställningar svarar funktionen not_configured', async () => {
  const g = fakeGoogle();
  const session = await seal({ t: 'ya29.TOKEN', e: NOW.getTime() + 600_000 }, KEY);
  assert.equal((await handleGoogleAds(post({ action: 'revoke', session }), deps(g))).status, 200);
  assert.ok(g.calls.some(c => c.url === 'https://oauth2.googleapis.com/revoke?token=ya29.TOKEN'));
  assert.equal((await handleGoogleAds(post({ action: 'revoke', session }), deps(g, { sealKey: 'kort' }))).status, 500);
  assert.equal((await handleGoogleAds(new Request('https://x', { method: 'GET' }), deps(g))).status, 405);
});

test('ingen rapport ändrar något: alla frågor är SELECT', () => {
  for (const [k, b] of Object.entries(REPORTS)) assert.match(b('2026-01-01', '2026-01-31'), /^SELECT /, k);
});
