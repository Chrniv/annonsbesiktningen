/*
  Allt som pratar med Supabase: spara lead, verifiera betalning, admininloggning och leadlista.
  Utan Supabase-inställningar (config.js) körs sidan i lokalt testläge: inget sparas.
*/
import { CONFIG, backendConfigured } from './config.js';

let clientPromise = null;
// supabase-js laddas bara när den behövs (admin), så att sidan förblir lätt för besökare
function client() {
  if (!backendConfigured()) return Promise.resolve(null);
  // Äldre inloggningslänkar landar på '#admin#access_token=...': ta bort '#admin' så att klienten hittar token
  const h = location.hash, i = h.indexOf('access_token=');
  if (i > 1 && h[i - 1] === '#') { try { history.replaceState(null, '', location.pathname + location.search + '#' + h.slice(i)); } catch (e) { /* ok */ } }
  if (!clientPromise) clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'implicit' } }));
  return clientPromise;
}

async function callFunction(name, body) {
  const res = await fetch(`${CONFIG.supabaseUrl.replace(/\/$/, '')}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: CONFIG.supabaseAnonKey },
    body: JSON.stringify(body)
  });
  let data = null; try { data = await res.json(); } catch (e) { /* tomt svar */ }
  if (!res.ok) { const err = new Error((data && data.error) || `http ${res.status}`); err.status = res.status; err.data = data; throw err; }
  return data;
}

export const backend = {
  configured: backendConfigured,

  /** Sparar en lead. Returnerar { id } eller null i testläge. */
  async submitLead(lead) {
    if (!backendConfigured()) return null;
    return callFunction('submit-lead', lead);
  },

  /** Kontrollerar en Stripe-betalning. Returnerar { paid, result, email, leadId }. */
  async verifyPayment(sessionId) {
    if (!backendConfigured()) return { paid: false, error: 'not_configured' };
    try { return await callFunction('verify-payment', { session_id: sessionId }); }
    catch (e) { return { paid: false, error: e.message, status: e.status }; }
  },

  /* ----- Admin ----- */
  async sendLoginLink(email) {
    const sb = await client();
    if (!sb) throw new Error('not_configured');
    // Ingen #-del i adressen: Supabase lägger själv till #access_token=..., och ett befintligt #admin gör att token inte hittas
    const redirectTo = location.origin + location.pathname + '?admin=1';
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
    if (error) throw error;
  },
  /** Returnerar e-post för inloggad admin, annars null. */
  async currentAdmin() {
    const sb = await client();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    const user = data && data.session && data.session.user;
    if (!user) return null;
    const { data: ok, error } = await sb.rpc('is_admin');
    if (error || !ok) return { email: user.email, admin: false };
    return { email: user.email, admin: true };
  },
  async signOut() { const sb = await client(); if (sb) await sb.auth.signOut(); },
  async listLeads(limit = 200) {
    const sb = await client();
    const { data, error } = await sb.from('leads').select('id, created_at, email, company, website, profile, audit, paid, paid_at').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data;
  },
  async getLeadResult(id) {
    const sb = await client();
    const { data, error } = await sb.from('leads').select('result').eq('id', id).single();
    if (error) throw error;
    return data.result;
  },
  async deleteLead(id) {
    const sb = await client();
    const { error } = await sb.from('leads').delete().eq('id', id);
    if (error) throw error;
  },
  async onAuthChange(cb) { const sb = await client(); if (sb) sb.auth.onAuthStateChange(() => cb()); }
};
