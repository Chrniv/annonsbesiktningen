// Databas via Supabase REST (PostgREST) med servernyckeln. Används bara i Edge Functions.
import type { Db, Json } from './logic.ts';

export function restDb(url: string, key: string, fetchFn: typeof fetch = fetch): Db {
  const base = url.replace(/\/$/, '') + '/rest/v1';
  // Nya nycklar (sb_secret_...) skickas bara som apikey; äldre service_role-JWT även som Bearer
  const headers: Record<string, string> = key.startsWith('sb_') ? { apikey: key, 'Content-Type': 'application/json' } : { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetchFn(base + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!res.ok && res.status !== 409) throw new Error(`db ${res.status}: ${await res.text()}`);
    return res;
  }
  return {
    async insertLead(row: Json) {
      const res = await call('/leads?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
      const [r] = await res.json();
      return { id: r.id };
    },
    async countRecentLeads(email: string, sinceIso: string) {
      const res = await call(`/leads?select=id&email=eq.${encodeURIComponent(email)}&created_at=gte.${encodeURIComponent(sinceIso)}`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
      const range = res.headers.get('content-range') || '';
      const n = Number(range.split('/')[1]);
      return Number.isFinite(n) ? n : (await res.json()).length;
    },
    async getLead(id: string) {
      const res = await call(`/leads?select=id,email,result&id=eq.${encodeURIComponent(id)}`);
      const rows = await res.json();
      return rows[0] || null;
    },
    async markLeadPaid(id: string, paidAtIso: string) {
      await call(`/leads?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ paid: true, paid_at: paidAtIso }) });
    },
    async insertPurchase(row: Json) {
      const res = await call('/purchases?on_conflict=session_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify(row) });
      return res.status === 409 ? 'exists' : 'inserted';
    }
  };
}

// Servernyckeln: nya projekt har SUPABASE_SECRET_KEYS (JSON), äldre SUPABASE_SERVICE_ROLE_KEY
export function serverKey(get: (k: string) => string | undefined): string {
  const raw = get('SUPABASE_SECRET_KEYS');
  if (raw) { try { const o = JSON.parse(raw); const v = o.default || Object.values(o)[0]; if (typeof v === 'string' && v) return v; } catch { /* inte JSON */ } }
  return get('SUPABASE_SECRET_KEY') || get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

export const origins = (v: string | undefined) => (v || '').split(',').map(s => s.trim()).filter(Boolean);
