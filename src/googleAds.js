/*
  Gör om svar från Google Ads API till samma rapporter som readReport() ger för en CSV-export,
  så att analyze() inte behöver veta var datan kom ifrån. Ren logik, ingen DOM.
  Frågorna finns i supabase/functions/_shared/googleAds.ts (REPORTS); fälten här måste matcha dem.
*/

export const API_REPORTS = [
  { kind: 'campaigns', label: 'Kampanjer per dag' },
  { kind: 'searchTerms', label: 'Söktermer' },
  { kind: 'keywords', label: 'Sökord' },
  { kind: 'products', label: 'Produkter' }
];

// Samma värden som i en engelsk export, gemener, så att motorns mönster (/search/, /paused/, /exact/ ...) fungerar
const CHANNEL = { SEARCH: 'search', SHOPPING: 'shopping', PERFORMANCE_MAX: 'performance max', DISPLAY: 'display', VIDEO: 'video', DEMAND_GEN: 'demand gen', MULTI_CHANNEL: 'app', SMART: 'smart', LOCAL: 'local', HOTEL: 'hotel', LOCAL_SERVICES: 'local services', TRAVEL: 'travel', DISCOVERY: 'demand gen' };
const TERM_MATCH = { EXACT: 'exact match', NEAR_EXACT: 'exact match (close variant)', PHRASE: 'phrase match', NEAR_PHRASE: 'phrase match (close variant)', BROAD: 'broad match' };
const KW_MATCH = { EXACT: 'exact match', PHRASE: 'phrase match', BROAD: 'broad match' };
const TERM_STATUS = { ADDED: 'added', EXCLUDED: 'excluded', ADDED_EXCLUDED: 'added/excluded', NONE: 'none' };

const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const micros = v => n(v) / 1e6;
const lower = v => String(v || '').toLowerCase().replace(/_/g, ' ');
// Google rapporterar "> 90 %" som 0,9001. I CSV blir det 90 %, och motorn läser det som minst 90 %.
const lost = v => (v == null || v === '' ? null : Math.min(0.9, n(v)));
// Sökordets status som i exporten: borttagen eller pausad annonsgrupp/kampanj gör sökordet borttaget/pausat
const effStatus = (...st) => (st.some(s => s === 'REMOVED') ? 'removed' : st.some(s => s === 'PAUSED') ? 'paused' : st.some(s => s === 'ENABLED') ? 'enabled' : lower(st.find(Boolean)));

/** Läser ett searchStream-svar (en lista med omgångar) eller ett search-svar ({ results }). */
export function parseStream(text) {
  const j = typeof text === 'string' ? JSON.parse(text || '[]') : text;
  const batches = Array.isArray(j) ? j : [j];
  const out = [];
  for (const b of batches) {
    if (b && b.error) throw new Error((b.error && b.error.message) || 'google');
    if (b && Array.isArray(b.results)) for (const r of b.results) out.push(r);
  }
  return out;
}

const blank = () => ({ campaign: '', adGroup: '', term: '', keyword: '', itemId: '', title: '', matchType: '', added: '', status: '', type: '', date: null, cost: 0, impr: 0, clicks: 0, conv: 0, value: 0, budget: 0, qs: null, lostBudget: null, lostRank: null });
const metrics = (m = {}) => ({ cost: micros(m.costMicros), impr: n(m.impressions), clicks: n(m.clicks), conv: n(m.conversions), value: n(m.conversionsValue) });

const ROW = {
  campaigns: r => {
    const c = r.campaign || {}, m = r.metrics || {};
    return { ...blank(), campaign: String(c.name || '').trim(), status: lower(c.status), type: CHANNEL[c.advertisingChannelType] || lower(c.advertisingChannelType),
      date: (r.segments && r.segments.date) || null, ...metrics(m), budget: micros(r.campaignBudget && r.campaignBudget.amountMicros),
      lostBudget: lost(m.searchBudgetLostImpressionShare), lostRank: lost(m.searchRankLostImpressionShare) };
  },
  searchTerms: r => {
    const v = r.searchTermView || {}, s = r.segments || {};
    return { ...blank(), campaign: String((r.campaign || {}).name || '').trim(), adGroup: String((r.adGroup || {}).name || '').trim(), term: String(v.searchTerm || '').trim(),
      matchType: TERM_MATCH[s.searchTermMatchType] || lower(s.searchTermMatchType), added: TERM_STATUS[v.status] || lower(v.status), ...metrics(r.metrics) };
  },
  keywords: r => {
    const k = r.adGroupCriterion || {}, kw = k.keyword || {}, ag = r.adGroup || {}, c = r.campaign || {};
    const qs = k.qualityInfo && k.qualityInfo.qualityScore != null ? n(k.qualityInfo.qualityScore) : null;
    return { ...blank(), campaign: String(c.name || '').trim(), adGroup: String(ag.name || '').trim(), keyword: String(kw.text || '').trim(),
      matchType: KW_MATCH[kw.matchType] || lower(kw.matchType), status: effStatus(k.status, ag.status, c.status), qs: qs > 0 ? qs : null, ...metrics(r.metrics) };
  },
  products: r => {
    const s = r.segments || {};
    return { ...blank(), campaign: String((r.campaign || {}).name || '').trim(), itemId: String(s.productItemId || '').trim(), title: String(s.productTitle || '').trim(), ...metrics(r.metrics) };
  }
};
const KEY_OF = { campaigns: 'campaign', searchTerms: 'term', keywords: 'keyword', products: 'itemId' };

/**
 * Bygger en rapport som ser ut som readReport():s.
 * @param {string} name   namnet som visas i fillistan
 * @param {string} kind   'campaigns' | 'searchTerms' | 'keywords' | 'products'
 * @param {string|Array} data  svaret från searchStream (text eller redan läst)
 * @param {{from: string, to: string, currency?: string}} meta  perioden som hämtades och kontots valuta
 */
export function apiReport(name, kind, data, meta = {}) {
  const toRow = ROW[kind];
  if (!toRow) return { name, type: 'unknown', error: 'Okänd rapporttyp från Google Ads.' };
  let results;
  try { results = parseStream(data); } catch (e) { return { name, type: 'unknown', error: 'Svaret från Google Ads gick inte att läsa.' }; }
  const rows = [];
  let currency = String(meta.currency || '').toUpperCase();
  for (const r of results) {
    const o = toRow(r);
    if (!o[KEY_OF[kind]]) continue;
    rows.push(o);
    if (!currency && r.customer && r.customer.currencyCode) currency = String(r.customer.currencyCode).toUpperCase();
  }
  // Perioden är den som hämtades, även dagar utan data
  const period = meta.from && meta.to ? { from: meta.from, to: meta.to, gran: kind === 'campaigns' ? 'day' : null } : null;
  const missing = [];
  if (kind === 'products' && rows.length && rows.every(r => !r.title)) missing.push('Produkttitel');
  return { name, type: kind, rows, map: {}, period, currency, swedish: false, dc: false, delim: '', missing, hasDates: kind === 'campaigns',
    filtered: false, accountTotal: null, accountTotals: null, valueDerived: false, source: 'api' };
}
