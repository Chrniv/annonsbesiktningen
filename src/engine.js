/* Annonsbesiktningen – analysmotor. Ren logik utan DOM: läser Google Ads-exporter och räknar fram fynd. */
/* ===== Annonsbesiktningen — analysmotor (körs helt i webbläsaren) ===== */
import { CONFIG } from './config.js';

/* Branschsnitt: CTR %, CVR %, CPC USD, CPL USD */
const BENCH = [
  { id: 'all', sv: 'Alla branscher (snitt)', ctr: 6.64, cvr: 8.18, cpc: 5.42, cpl: 66.69 },
  { id: 'pets', sv: 'Djur & husdjur', ctr: 7.49, cvr: 16.22, cpc: 4.06, cpl: 31.50 },
  { id: 'apparel', sv: 'Kläder, mode & smycken', ctr: 6.64, cvr: 4.50, cpc: 4.44, cpl: 97.51 },
  { id: 'arts', sv: 'Kultur & nöje', ctr: 12.75, cvr: 5.91, cpc: 1.63, cpl: 26.84 },
  { id: 'legal', sv: 'Juridik & advokater', ctr: 5.87, cvr: 5.55, cpc: 9.87, cpl: 131.63 },
  { id: 'autosale', sv: 'Fordon – försäljning', ctr: 8.28, cvr: 6.01, cpc: 2.27, cpl: 44.26 },
  { id: 'autorepair', sv: 'Fordon – verkstad & delar', ctr: 5.56, cvr: 15.51, cpc: 4.35, cpl: 29.96 },
  { id: 'beauty', sv: 'Skönhet & egenvård', ctr: 6.75, cvr: 10.35, cpc: 4.62, cpl: 39.25 },
  { id: 'b2b', sv: 'Företagstjänster', ctr: 6.10, cvr: 4.85, cpc: 5.87, cpl: 93.69 },
  { id: 'career', sv: 'Rekrytering & jobb', ctr: 5.88, cvr: 3.05, cpc: 5.81, cpl: 67.36 },
  { id: 'dental', sv: 'Tandvård', ctr: 5.66, cvr: 10.67, cpc: 8.00, cpl: 72.97 },
  { id: 'education', sv: 'Utbildning', ctr: 7.56, cvr: 13.14, cpc: 4.81, cpl: 77.48 },
  { id: 'finance', sv: 'Finans & försäkring', ctr: 9.83, cvr: 2.64, cpc: 3.39, cpl: 74.44 },
  { id: 'furniture', sv: 'Möbler', ctr: 6.57, cvr: 2.99, cpc: 3.97, cpl: 106.70 },
  { id: 'fitness', sv: 'Hälsa & träning', ctr: 5.81, cvr: 6.94, cpc: 6.17, cpl: 67.36 },
  { id: 'home', sv: 'Hem & renovering', ctr: 6.47, cvr: 8.05, cpc: 8.33, cpl: 90.92 },
  { id: 'industrial', sv: 'Industri & handel', ctr: 6.57, cvr: 8.20, cpc: 5.87, cpl: 75.19 },
  { id: 'personal', sv: 'Personliga tjänster', ctr: 7.16, cvr: 12.34, cpc: 7.17, cpl: 54.60 },
  { id: 'medical', sv: 'Läkare & kliniker', ctr: 6.61, cvr: 12.43, cpc: 4.76, cpl: 40.04 },
  { id: 'realestate', sv: 'Fastigheter', ctr: 7.61, cvr: 3.70, cpc: 3.22, cpl: 102.51 },
  { id: 'food', sv: 'Restauranger & caféer', ctr: 6.83, cvr: 8.05, cpc: 2.05, cpl: 30.57 },
  { id: 'shopping', sv: 'E-handel, presenter & samlarobjekt', ctr: 8.28, cvr: 4.01, cpc: 4.14, cpl: 49.40 },
  // Ingen egen källa: jämförs med e-handelssnittet, eftersom köpbeteendet liknar e-handel mer än restaurang
  { id: 'grocery', sv: 'Mat & dryck online', base: 'shopping', ctr: 8.28, cvr: 4.01, cpc: 4.14, cpl: 49.40 },
  { id: 'marketplace', sv: 'Marknadsplats eller plattform', base: 'shopping', ctr: 8.28, cvr: 4.01, cpc: 4.14, cpl: 49.40 },
  { id: 'sports', sv: 'Sport & fritid', ctr: 8.75, cvr: 7.69, cpc: 2.77, cpl: 44.26 },
  { id: 'travel', sv: 'Resor', ctr: 9.32, cvr: 5.83, cpc: 2.14, cpl: 44.70 }
];

/* Söktermer som nästan aldrig köper: jobb, gratis, gör-det-själv, information, begagnat */
const NEG_PATTERNS = [
  { re: /\b(lediga jobb|jobb|jobs?|job|lön|löner|salary|anställning|karriär|praktik)\b/i, label: 'jobbsök' },
  { re: /\b(gratis|free|kostnadsfri|gratisprov)\b/i, label: 'gratis' },
  { re: /\b(hur gör man|hur man|gör det själv|själv|diy|how to|tutorial|instruktion|youtube)\b/i, label: 'gör-det-själv' },
  { re: /\b(vad är|what is|wiki|wikipedia|betydelse|definition|reddit|flashback)\b/i, label: 'information' },
  { re: /\b(begagnad|begagnat|begagnade|blocket|tradera|second hand|used)\b/i, label: 'begagnat' },
  { re: /\b(mall|pdf|template|logga in|login|kundtjänst|telefonnummer)\b/i, label: 'navigering/mallar' }
];

/* ---------- Avkodning & CSV ---------- */
function decodeBuffer(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf.slice(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf.slice(2));
  let zeros = 0; for (let i = 1; i < Math.min(b.length, 400); i += 2) if (b[i] === 0) zeros++;
  if (zeros > 60) return new TextDecoder('utf-16le').decode(buf);
  let t = new TextDecoder('utf-8').decode(buf);
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  const bad = (t.match(/\uFFFD/g) || []).length;
  if (!bad) return t;
  // Byt bara till Windows-1252 om filen verkligen ser ut att vara det. Enstaka trasiga tecken i en UTF-8-fil ska inte förstöra rubrikerna.
  let cp = null;
  try { cp = new TextDecoder('windows-1252').decode(buf); } catch (e) { return t; }
  const mojibake = (cp.match(/Ã[\u0080-\u00BF]|â€/g) || []).length;
  return mojibake >= bad ? t : cp;
}

function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).slice(0, 40).filter(l => l.trim());
  let best = ',', bestScore = -1;
  for (const d of ['\t', ';', ',']) {
    const counts = {};
    lines.forEach(l => { const n = l.split(d).length - 1; if (n > 0) counts[n] = (counts[n] || 0) + 1; });
    let score = 0;
    for (const [n, c] of Object.entries(counts)) if (c >= 2) score = Math.max(score, Number(n) * c);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  // Mycket korta filer (eller citerade decimaltal med komma) ger inget mönster: välj tecknet som delar rubrikraden mest
  if (bestScore <= 0 && lines.length) best = ['\t', ';', ','].reduce((b, d) => (lines[0].split(d).length > lines[0].split(b).length ? d : b), ',');
  return best;
}

function parseCSV(text, d) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/* ---------- Kolumnmappning (engelska + svenska rubriker) ---------- */
const FIELDS = [
  { k: 'itemId', exact: ['item id', 'artikel-id', 'artikel id', 'produkt-id', 'produkt id', 'product item id', 'id för artikel', 'artikelns id', 'id'] },
  { k: 'productTitle', exact: ['product title', 'produkttitel', 'produktnamn', 'title', 'titel'] },
  { k: 'campaign', exact: ['campaign', 'kampanj', 'kampanjnamn', 'campaign name'] },
  { k: 'adGroup', exact: ['ad group', 'annonsgrupp'] },
  { k: 'searchTerm', exact: ['search term', 'sökterm', 'search terms', 'söktermer'] },
  { k: 'keyword', exact: ['keyword', 'sökord', 'search keyword', 'keyword text', 'sökordstext'] },
  { k: 'matchType', exact: ['match type', 'matchningstyp', 'search term match type', 'söktermens matchningstyp', 'keyword match type', 'sökordets matchningstyp'] },
  { k: 'day', exact: ['day', 'dag', 'date', 'datum'] },
  { k: 'added', exact: ['added/excluded', 'tillagd/utesluten', 'tillagd/exkluderad'] },
  { k: 'week', exact: ['week', 'vecka'] },
  { k: 'status', exact: ['campaign status', 'kampanjstatus', 'status', 'keyword status', 'sökordsstatus'] },
  { k: 'type', exact: ['campaign type', 'kampanjtyp'] },
  { k: 'budget', exact: ['budget', 'daily budget', 'dagsbudget', 'avg. daily budget', 'genomsnittlig daglig budget'] },
  { k: 'currency', exact: ['currency code', 'valutakod', 'currency', 'valuta'] },
  { k: 'cost', exact: ['cost', 'kostnad'] },
  { k: 'impr', exact: ['impr.', 'impr', 'impressions', 'visningar', 'exponeringar'] },
  { k: 'clicks', exact: ['clicks', 'klick'] },
  { k: 'conv', exact: ['conversions', 'konverteringar', 'konv.'] },
  { k: 'value', exact: ['conv. value', 'conv. value (by conv. time)', 'conversion value', 'total conv. value', 'konv.värde (efter konv.tid)', 'konv.värde (efter konverteringstid)', 'värde för konv. (efter konv.tid)', 'konv.värde', 'konv. värde', 'konverteringsvärde', 'värde för konv.'] },
  { k: 'qs', exact: ['quality score', 'kvalitetsresultat'] },
  { k: 'lostBudget', exact: ['search lost is (budget)'], test: h => /(lost|förlor)/.test(h) && /budget/.test(h) && !/(top|topp|display|abs)/.test(h) },
  { k: 'lostRank', exact: ['search lost is (rank)'], test: h => /(lost|förlor)/.test(h) && /(rank|rangordning)/.test(h) && !/(top|topp|display|abs)/.test(h) }
];
const SWEDISH_HINTS = /(kampanj|kostnad|klick|konv|sökord|sökterm|visningar|exponeringar|dag$|vecka|annonsgrupp|förlor|kvalitet|artikel|produkt)/;
const fixMojibake = s => s.replace(/Ã¶/g, 'ö').replace(/Ã¤/g, 'ä').replace(/Ã¥/g, 'å').replace(/Ã–/g, 'Ö').replace(/Ã„/g, 'Ä').replace(/Ã…/g, 'Å');
const normH = h => fixMojibake(String(h || '')).toLowerCase().replace(/[\u00a0\s]+/g, ' ').trim();

function mapHeaders(headers) {
  const map = {}; const used = new Set();
  const hs = headers.map(normH);
  for (const F of FIELDS) {
    const i = hs.findIndex((h, j) => !used.has(j) && F.exact.includes(h));
    if (i >= 0) { map[F.k] = i; used.add(i); }
  }
  for (const F of FIELDS) {
    if (map[F.k] != null || !F.test) continue;
    const i = hs.findIndex((h, j) => !used.has(j) && F.test(h));
    if (i >= 0) { map[F.k] = i; used.add(i); }
  }
  return map;
}

/* ---------- Tal & datum ---------- */
function num(v, dc) {
  if (v == null) return 0;
  let s = String(v).trim();
  if (!s || /^[-–—]+$/.test(s)) return 0;
  const lt = /^</.test(s), gt = /^>/.test(s);
  s = s.replace(/[<>%\s  ]/g, '').replace(/[^\d,.\-]/g, '');
  const hasC = s.includes(','), hasD = s.includes('.');
  if (hasC && hasD) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasC) {
    if (dc) s = s.replace(',', '.');
    else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  } else if (hasD && dc && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  let n = parseFloat(s);
  if (isNaN(n)) return 0;
  if (lt) n = n / 2;
  if (gt) n = (n + 100) / 2;
  return n;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function pdate(s) {
  s = String(s || '').trim().toLowerCase();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/(\d{1,2})[\s.]+([a-zåäö]{3,})\.?,?\s+(\d{4})/);
  if (m && MONTHS[m[2].slice(0, 3)]) return iso(m[3], MONTHS[m[2].slice(0, 3)], m[1]);
  m = s.match(/([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].slice(0, 3)]) return iso(m[3], MONTHS[m[1].slice(0, 3)], m[2]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return iso(m[3], m[1], m[2]);
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return iso(m[3], m[2], m[1]);
  return null;
}
const dnum = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
const dstr = n => new Date(n * 864e5).toISOString().slice(0, 10);

function findDatesIn(text) {
  const out = [];
  const re = /(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}[\s.]+[a-zåäö]{3,}\.?,?\s+\d{4})|([a-z]{3,}\.?\s+\d{1,2},?\s+\d{4})/gi;
  let m; while ((m = re.exec(text))) { const d = pdate(m[0]); if (d) out.push(d); }
  return out;
}

/* ---------- Läs en fil till en rapport ---------- */
function readReport(name, text) {
  const delim = detectDelimiter(text);
  const rows = parseCSV(text, delim).filter(r => r.some(c => String(c).trim() !== ''));
  let hi = -1, map = null;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const mp = mapHeaders(rows[i]);
    if (Object.keys(mp).length >= 3 && (mp.cost != null || mp.clicks != null)) { hi = i; map = mp; break; }
  }
  if (hi < 0) return { name, type: 'unknown', error: 'Hittade ingen rubrikrad med kolumner som Kostnad, Klick eller Kampanj.' };

  const headers = rows[hi];
  const swedish = headers.some(h => SWEDISH_HINTS.test(normH(h)));
  const costSamples = rows.slice(hi + 1, hi + 60).map(r => String(r[map.cost ?? map.clicks] || '').replace(/[\s  ]/g, ''));
  let dc = swedish || delim === ';';
  if (costSamples.some(s => /^\d+,\d{1,2}$/.test(s))) dc = true;
  else if (costSamples.some(s => /^\d+\.\d{1,2}$/.test(s))) dc = false;

  const type = map.searchTerm != null ? 'searchTerms' : map.keyword != null ? 'keywords' : (map.itemId != null && map.itemId !== map.campaign) ? 'products' : map.campaign != null ? 'campaigns' : 'unknown';
  if (type === 'unknown') return { name, type, error: 'Filen saknar kolumn för Kampanj, Sökord, Sökterm eller Artikel-id.' };

  const idCol = type === 'searchTerms' ? map.searchTerm : type === 'keywords' ? map.keyword : type === 'products' ? map.itemId : map.campaign;
  const pre = rows.slice(0, hi).map(r => r.join(' ')).join(' ');
  const titleDates = findDatesIn(pre).sort();

  const get = (r, k) => (map[k] == null ? '' : r[map[k]]);
  const out = [];
  let currency = '';
  for (const r of rows.slice(hi + 1)) {
    const id = String(r[idCol] || '').trim();
    const first = String(r.find(c => String(c).trim()) || '').trim().toLowerCase();
    if (!id || id === '--' || /^total/.test(first) || /^total/.test(id.toLowerCase())) continue;
    const o = {
      campaign: String(get(r, 'campaign') || '').trim(),
      adGroup: String(get(r, 'adGroup') || '').trim(),
      term: type === 'searchTerms' ? id : '',
      keyword: type === 'keywords' ? id : '',
      itemId: type === 'products' ? id : '',
      title: String(get(r, 'productTitle') || '').trim(),
      matchType: normH(get(r, 'matchType')),
      added: normH(get(r, 'added')),
      status: normH(get(r, 'status')),
      type: normH(get(r, 'type')),
      date: map.day != null ? pdate(get(r, 'day')) : map.week != null ? pdate(get(r, 'week')) : null,
      cost: num(get(r, 'cost'), dc),
      impr: num(get(r, 'impr'), dc),
      clicks: num(get(r, 'clicks'), dc),
      conv: num(get(r, 'conv'), dc),
      value: num(get(r, 'value'), dc),
      budget: num(get(r, 'budget'), dc),
      qs: map.qs != null ? num(get(r, 'qs'), dc) : null,
      lostBudget: map.lostBudget != null ? num(get(r, 'lostBudget'), dc) / 100 : null,
      lostRank: map.lostRank != null ? num(get(r, 'lostRank'), dc) / 100 : null
    };
    if (!currency && map.currency != null) currency = String(get(r, 'currency')).trim().toUpperCase();
    out.push(o);
  }
  // Jämförelseexport ("19 Sep 2026 - 18 Oct 2026 compared to 19 Sep 2025 - ..."): raderna för jämförelseperioden har nollor
  // i de vanliga kolumnerna. Behåll bara innevarande period, annars blir perioden ett år för lång och alla månadsbelopp för små.
  const cmpHeader = /compared to|jämfört med|jämfört mot/i.test(pre);
  if (cmpHeader && map.day != null) {
    const cur = findDatesIn(pre.split(/compared to|jämfört med|jämfört mot/i)[0]).sort();
    if (cur.length >= 2) { const [f, t] = [cur[0], cur[cur.length - 1]]; for (let i = out.length - 1; i >= 0; i--) if (out[i].date && (out[i].date < f || out[i].date > t)) out.splice(i, 1); }
  }
  const dates = out.map(o => o.date).filter(Boolean).sort();
  const gran = map.day != null ? 'day' : map.week != null ? 'week' : null;
  let period = null;
  if (dates.length) period = { from: dates[0], to: dates[dates.length - 1], gran };
  else if (titleDates.length >= 2) period = { from: titleDates[0], to: titleDates[titleDates.length - 1], gran: null };
  const missing = [];
  if (type === 'campaigns') {
    if (map.budget == null && map.lostBudget == null) missing.push('Budget eller förlorad exponeringsandel (budget)');
    if (!gran) missing.push('Dag- eller veckosegment');
  }
  if (type === 'keywords' && map.qs == null) missing.push('Kvalitetsresultat');
  if (type === 'products' && map.value == null) missing.push('Konv.värde');
  if (map.conv == null) missing.push('Konverteringar');
  return { name, type, rows: out, map, period, currency, swedish, dc, delim, missing, hasDates: !!gran };
}

/* ---------- Hjälpare ---------- */
const sum = (a, k) => a.reduce((s, o) => s + (o[k] || 0), 0);
const div = (a, b) => (b > 0 ? a / b : null);
const pct = (a, b) => (a != null && b != null && b !== 0 ? (a - b) / Math.abs(b) * 100 : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function totals(rows) {
  const t = { cost: sum(rows, 'cost'), impr: sum(rows, 'impr'), clicks: sum(rows, 'clicks'), conv: sum(rows, 'conv'), value: sum(rows, 'value') };
  t.ctr = div(t.clicks, t.impr) != null ? t.clicks / t.impr * 100 : null;
  t.cvr = div(t.conv, t.clicks) != null ? t.conv / t.clicks * 100 : null;
  t.cpc = div(t.cost, t.clicks);
  t.cpa = div(t.cost, t.conv);
  t.roas = t.value > 0 ? div(t.value, t.cost) : null;
  return t;
}
function groupBy(rows, key) {
  const m = new Map();
  rows.forEach(r => { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return m;
}
const isSearch = t => /(search|sök)/.test(t || '') && !/(shopping|pmax|performance|display)/.test(t || '');

/* ---------- Analys ---------- */
function analyze(reports, opts) {
  const bench = BENCH.find(b => b.id === opts.industry) || BENCH[0];
  let fx = CONFIG.usdToSek;
  const camps = reports.filter(r => r.type === 'campaigns').flatMap(r => r.rows);
  const sts = reports.filter(r => r.type === 'searchTerms').flatMap(r => r.rows);
  const kws = reports.filter(r => r.type === 'keywords').flatMap(r => r.rows);
  const prods = reports.filter(r => r.type === 'products').flatMap(r => r.rows);
  const campRep = reports.find(r => r.type === 'campaigns');
  const anyRep = campRep || reports.find(r => r.type !== 'unknown');
  const currency = (reports.map(r => String(r.currency || '').toUpperCase()).find(c => /^[A-Z]{3}$/.test(c)) || opts.currency || 'SEK').toUpperCase();
  const rate = CONFIG.fxToSek[currency];
  const costComparable = rate != null;
  fx = costComparable ? CONFIG.fxToSek.USD / rate : 1; // USD -> kontots valuta (okänd valuta: visa branschsnittet i USD)
  setCurrency(currency);

  // Period
  const periods = reports.filter(r => r.period).map(r => r.period);
  let periodDays = 30, assumed = true, from = null, to = null, gran = null;
  const p = (campRep && campRep.period) || periods[0];
  if (p) {
    from = p.from; to = p.to; gran = p.gran;
    periodDays = dnum(to) - dnum(from) + 1 + (gran === 'week' ? 6 : 0);
    assumed = false;
  }
  const mf = 30.4 / periodDays; // månadsfaktor
  const mfAcct = mf;
  // Varje rapport räknas om till månadsbelopp med sin egen period (söktermsrapporten kan gälla andra dagar än kampanjrapporten)
  const mfFor = t => { const r = reports.find(x => x.type === t && x.period); if (!r) return mf; const q = r.period; const d = dnum(q.to) - dnum(q.from) + 1 + (q.gran === 'week' ? 6 : 0); return d > 0 ? 30.4 / d : mf; };
  // Fasta golv anges i kronor och räknas om till kontots valuta (30 kr, inte 30 pund)
  const M = sek => sek / (CONFIG.fxToSek[currency] || 1);
  // Varumärkeskampanjer och kontots eget varumärke
  const isBrandCamp = n => /(\bbrand\b|\[b\]|varumärke|\bbranding\b)/i.test(n || '');
  DETECTED_OWN = new Set();
  // Ord som kontot medvetet satsar på (sökord, kampanj- och annonsgruppsnamn). Söktermer med de orden kräver mer data innan de kallas slöseri.
  const stemW = w => w.replace(/ies$/, 'y').replace(/(es|s)$/, '');
  const SOLD = new Set();
  [...kws.map(k => k.keyword), ...kws.map(k => k.adGroup), ...camps.map(c => c.campaign)].forEach(t => String(t || '').toLowerCase().split(/[^a-z0-9åäöæøéü]+/).filter(w => w.length >= 4).forEach(w => SOLD.add(stemW(w))));
  const sells = w => SOLD.has(stemW(w));
  {
    // Varumärket är ordet som finns i många av varumärkeskampanjens söktermer men sällan i resten av kontot ("smartphoto", inte "photo")
    const all = [...sts, ...kws];
    const brandTerms = all.filter(r => isBrandCamp(r.campaign)).map(r => (r.term || r.keyword || '').toLowerCase());
    const otherTerms = all.filter(r => !isBrandCamp(r.campaign)).map(r => (r.term || r.keyword || '').toLowerCase());
    if (brandTerms.length) {
      const cnt = {}, oth = {};
      brandTerms.forEach(t => new Set(t.split(/[^a-z0-9åäö]+/).filter(w => w.length >= 4)).forEach(w => { cnt[w] = (cnt[w] || 0) + 1; }));
      otherTerms.forEach(t => new Set(t.split(/[^a-z0-9åäö]+/).filter(w => cnt[w])).forEach(w => { oth[w] = (oth[w] || 0) + 1; }));
      Object.entries(cnt).filter(([w, c]) => c >= Math.max(2, brandTerms.length * 0.3) && (oth[w] || 0) / Math.max(1, otherTerms.length) < (c / brandTerms.length) * 0.2)
        .forEach(([w]) => DETECTED_OWN.add(w));
    }
  }

  const findings = [];
  const add = f => findings.push(f);

  // Kontonivå
  const base = camps.length ? camps : (sts.length ? sts : kws.length ? kws : prods);
  const acct = totals(base);
  const acctCPA = acct.cpa;

  // Kampanjaggregat
  const campAgg = [];
  if (camps.length) {
    for (const [name, rows] of groupBy(camps, 'campaign')) {
      const t = totals(rows);
      const sorted = rows.filter(r => r.date).sort((a, b) => a.date < b.date ? -1 : 1);
      const lastRow = sorted.length ? sorted[sorted.length - 1] : rows[rows.length - 1];
      const imprW = rows.reduce((s, r) => s + (r.impr || 0), 0);
      const wavg = k => rows.some(r => r[k] != null) ? (imprW > 0 ? rows.reduce((s, r) => s + (r[k] || 0) * (r.impr || 0), 0) / imprW : sum(rows, k) / rows.length) : null;
      campAgg.push({ name, rows, ...t, type: rows.find(r => r.type)?.type || '', status: lastRow.status, budget: lastRow.budget || Math.max(...rows.map(r => r.budget || 0)), lostBudget: wavg('lostBudget'), lostRank: wavg('lostRank') });
    }
  }

  /* ===== Modul 1: Prestanda & branschjämförelse ===== */
  const perf = { id: 'performance', name: 'Prestanda', available: base.length > 0, notes: [] };
  const searchCamps = campAgg.filter(c => isSearch(c.type));
  const cmpRows = searchCamps.length && sum(searchCamps, 'clicks') > 0 ? searchCamps.flatMap(c => c.rows) : base;
  const cmp = totals(cmpRows);
  perf.scope = searchCamps.length && cmpRows !== base ? 'sökkampanjer' : 'hela kontot';
  const bm = {
    ctr: { you: cmp.ctr, bench: bench.ctr, better: 'higher', unit: '%' },
    cvr: { you: cmp.cvr, bench: bench.cvr, better: 'higher', unit: '%' },
    cpc: { you: costComparable ? cmp.cpc : null, bench: bench.cpc * fx, better: 'lower', unit: 'kr' },
    cpa: { you: costComparable ? cmp.cpa : null, bench: bench.cpl * fx, better: 'lower', unit: 'kr' }
  };
  for (const k of Object.keys(bm)) {
    const b = bm[k];
    if (b.you == null) { b.ratio = null; b.verdict = !costComparable && (k === 'cpc' || k === 'cpa') ? 'nocur' : k === 'cpa' && acct.conv === 0 ? 'noconv' : 'na'; continue; }
    b.ratio = b.better === 'higher' ? b.you / b.bench : b.bench / b.you; // >1 = bättre än branschen
    b.verdict = b.ratio >= 1.1 ? 'good' : b.ratio >= 0.8 ? 'ok' : b.ratio >= 0.5 ? 'warn' : 'crit';
  }
  const benchLabel = bench.base ? `${bench.sv} (jämförs med ${(BENCH.find(b => b.id === bench.base) || {}).sv})` : bench.sv;
  perf.benchmark = { industry: benchLabel, scope: perf.scope, metrics: bm, comparable: costComparable };

  if (base.length && acct.conv === 0 && acct.cost > 0) {
    add({ module: 'performance', sev: 'crit', key: 'tracking', title: 'Inga konverteringar registrerade under perioden', freeText: 'Utan konverteringsdata optimerar Google mot klick, inte affärer. Alla andra siffror blir osäkra.', detail: 'Kontrollera att konverteringstaggen är installerad och att rätt konverteringsåtgärder räknas som primära.', items: [] });
  }
  const sevFromRatio = r => (r < 0.5 ? 'crit' : 'warn');
  if (bm.ctr.ratio != null && bm.ctr.ratio < 0.8) add({ module: 'performance', sev: sevFromRatio(bm.ctr.ratio), key: 'ctr', title: `Klickfrekvensen ligger ${Math.round((1 - bm.ctr.ratio) * 100)} % under branschsnittet`, freeText: 'Annonserna lockar färre klick än konkurrenternas, vilket ofta höjer klickpriset.', detail: 'Annonsgrupper med lägst CTR och annonstexter som behöver skrivas om.', items: campAgg.filter(c => c.ctr != null).sort((a, b) => a.ctr - b.ctr).slice(0, 5).map(c => ({ name: c.name, value: `CTR ${fmtPct(c.ctr)}` })) });
  if (bm.cvr.ratio != null && bm.cvr.ratio < 0.8 && acct.conv > 0) add({ module: 'performance', sev: sevFromRatio(bm.cvr.ratio), key: 'cvr', title: `Konverteringsgraden ligger ${Math.round((1 - bm.cvr.ratio) * 100)} % under branschsnittet`, freeText: 'Trafiken som kommer in blir mer sällan kunder än hos jämförbara annonsörer.', detail: 'Kampanjer med lägst konverteringsgrad och landningssidor att se över.', items: campAgg.filter(c => c.cvr != null && c.clicks > 30).sort((a, b) => a.cvr - b.cvr).slice(0, 5).map(c => ({ name: c.name, value: `CVR ${fmtPct(c.cvr)}` })) });
  if (bm.cpa.ratio != null && bm.cpa.ratio < 0.8) add({ module: 'performance', sev: sevFromRatio(bm.cpa.ratio), key: 'cpa', title: `Kostnad per konvertering är ${Math.round((1 / bm.cpa.ratio - 1) * 100)} % högre än branschsnittet`, freeText: 'Varje affär eller lead kostar mer än hos jämförbara annonsörer.', detail: 'Kampanjer som driver upp kostnaden per konvertering.', items: campAgg.filter(c => c.cpa != null).sort((a, b) => b.cpa - a.cpa).slice(0, 5).map(c => ({ name: c.name, value: `${fmtKr(c.cpa)} / konv.` })) });

  // Ineffektiv spend-koncentration
  if (campAgg.length > 1 && acct.cost > 0 && acct.conv > 0) {
    const ineff = campAgg.filter(c => c.cost / acct.cost >= 0.1 && (c.conv / acct.conv) < (c.cost / acct.cost) * 0.5);
    if (ineff.length) {
      const excess = ineff.reduce((s, c) => s + Math.max(0, c.cost - c.conv * acctCPA), 0) * mf;
      add({ module: 'performance', sev: excess > acct.cost * mf * 0.15 ? 'crit' : 'warn', key: 'concentration', title: `${ineff.length} ${ineff.length === 1 ? 'kampanj tar' : 'kampanjer tar'} en stor del av budgeten men ger få konverteringar`, freeText: 'Budgeten ligger där resultaten är svagast.', detail: 'Kampanjer vars andel av kostnaden är mer än dubbelt så stor som deras andel av konverteringarna.', impact: { kind: 'potential', sek: excess }, items: ineff.map(c => ({ name: c.name, value: `${Math.round(c.cost / acct.cost * 100)} % av kostnaden, ${Math.round(c.conv / acct.conv * 100)} % av konv.` })) });
    }
  }
  // Kampanjer med kostnad per konvertering långt över kontots snitt (eller ROAS långt under)
  const ecom = acct.value > 0 && acct.roas != null;
  if (campAgg.length > 1 && acct.cost > 0 && acct.conv > 0) {
    const already = new Set((findings.find(f => f.key === 'concentration') || { items: [] }).items.map(i => i.name));
    const bad = campAgg.filter(c => !already.has(c.name) && (c.cost / acct.cost >= 0.05 || (acctCPA && c.cost >= acctCPA * 5)) && !isBrandCamp(c.name) && (
      ecom ? (c.roas != null ? c.roas < acct.roas * 0.5 : c.cost >= acctCPA * 3) : (c.conv > 0 ? c.cpa >= acctCPA * 2 : c.cost >= acctCPA * 3)));
    if (bad.length) {
      const excess = bad.reduce((s, c) => s + Math.max(0, ecom && acct.roas ? c.cost - (c.value || 0) / acct.roas : c.cost - c.conv * acctCPA), 0) * mf;
      bad.sort((a, b) => b.cost - a.cost);
      const top = bad[0];
      add({ module: 'performance', sev: excess > acct.cost * mf * 0.1 ? 'crit' : 'warn', key: 'campCpa', title: ecom ? `${bad.length} ${bad.length === 1 ? 'kampanj har' : 'kampanjer har'} ROAS under hälften av kontots snitt` : `${bad.length} ${bad.length === 1 ? 'kampanj har' : 'kampanjer har'} mer än dubbelt så hög kostnad per konvertering som kontot`,
        freeText: ecom ? `Den största kostar ${fmtKr(top.cost * mf)} per månad med ROAS ${top.roas != null ? nf2.format(top.roas) : '0'} mot kontots ${nf2.format(acct.roas)}.` : `Den största kostar ${fmtKr(top.cost * mf)} per månad med ${top.conv ? fmtKr(top.cpa) : 'inga konverteringar'}${top.conv ? ' per konvertering' : ''}, mot kontots ${fmtKr(acctCPA)}.`,
        detail: ecom ? 'Kampanjer där intäkten per annonskrona är under hälften av kontots snitt.' : 'Kampanjer där varje konvertering kostar mer än dubbelt så mycket som i resten av kontot.',
        impact: { kind: 'potential', sek: excess },
        items: bad.map(c => ({ name: c.name, value: ecom ? `${fmtKr(c.cost * mf)}/mån, ROAS ${c.roas != null ? nf2.format(c.roas) : '0'}` : `${fmtKr(c.cost * mf)}/mån, ${c.conv ? fmtKr(c.cpa) + '/konv.' : 'inga konv.'}` })) });
    }
  }
  // Lönsamhet: med bruttomarginalen går det att räkna ut ROAS där annonserna går jämnt ut (1 / marginal)
  const margin = opts.margin > 0 && opts.margin < 1 ? opts.margin : null;
  perf.breakEvenRoas = margin ? 1 / margin : null;
  if (margin && acct.value > 0 && campAgg.length) {
    const be = 1 / margin;
    const lossOf = c => Math.max(0, c.cost - (c.value || 0) * margin); // annonskostnad som bruttovinsten inte täcker
    const unp = campAgg.filter(c => !isBrandCamp(c.name) && c.cost >= Math.max(acctCPA * 3, M(300) / mfAcct) && (c.roas || 0) < be * 0.95).sort((a, b) => lossOf(b) - lossOf(a));
    perf.grossProfitMonthly = (acct.value * margin - acct.cost) * mfAcct;
    if (unp.length) {
      const loss = unp.reduce((s2, c) => s2 + lossOf(c), 0) * mfAcct;
      add({ module: 'performance', sev: loss > acct.cost * mfAcct * 0.05 ? 'crit' : 'warn', key: 'unprofitCamp',
        title: `${unp.length} ${unp.length === 1 ? 'kampanj går' : 'kampanjer går'} med förlust efter varukostnad`,
        freeText: `Med en marginal på ${Math.round(margin * 100)} % behövs ROAS ${nf2.format(be)} för att gå jämnt ut. Annonskostnaden som bruttovinsten inte täcker är cirka ${fmtKr(loss)} per månad.`,
        detail: 'Kampanjer under break-even-ROAS. Höj mål-ROAS, sänk buden eller flytta budget till kampanjer som går med vinst.',
        impact: { kind: 'potential', sek: loss },
        items: unp.map(c => ({ name: c.name, value: `${fmtKr(c.cost * mfAcct)}/mån, ROAS ${nf2.format(c.roas || 0)}, förlust ${fmtKr(lossOf(c) * mfAcct)}/mån` })) });
    }
  }
  // Varumärke mot övrigt: varumärkessök ger nästan alltid bäst resultat och döljer hur resten av kontot presterar
  const brandC = campAgg.filter(c => isBrandCamp(c.name));
  if (brandC.length && campAgg.length > brandC.length && acct.conv > 0) {
    const b = totals(brandC.flatMap(c => c.rows)), nb = totals(campAgg.filter(c => !isBrandCamp(c.name)).flatMap(c => c.rows));
    const ecomB = acct.value > 0;
    perf.brandSplit = { brandConvShare: b.conv / acct.conv, brandCostShare: b.cost / acct.cost, brandRoas: b.roas, nonBrandRoas: nb.roas, brandCpa: b.cpa, nonBrandCpa: nb.cpa };
    if (b.conv / acct.conv >= 0.1) add({ module: 'performance', sev: 'info', key: 'brandSplit',
      title: ecomB ? `Utan varumärkessökningar är ROAS ${nb.roas != null ? nf2.format(nb.roas) : '–'}, inte ${nf2.format(acct.roas)}` : `Utan varumärkessökningar kostar en konvertering ${fmtKr(nb.cpa)}, inte ${fmtKr(acctCPA)}`,
      freeText: `Varumärkeskampanjerna står för ${Math.round(b.conv / acct.conv * 100)} % av konverteringarna men bara ${Math.round(b.cost / acct.cost * 100)} % av kostnaden. Kunder som söker på ert namn hade ofta hittat er ändå.`,
      detail: 'Bedöm resten av kontot för sig. Det är där annonspengarna gör skillnad, och där budget och mål bör sättas.',
      items: [...brandC.map(c => ({ name: c.name + ' (varumärke)', value: ecomB ? `ROAS ${c.roas != null ? nf2.format(c.roas) : '–'}` : `${fmtKr(c.cpa)}/konv.` })), { name: 'Övriga kampanjer', value: ecomB ? `ROAS ${nb.roas != null ? nf2.format(nb.roas) : '–'}` : `${fmtKr(nb.cpa)}/konv.` }] });
  }
  // Kvalitetsresultat
  if (kws.length && kws.some(k => k.qs)) {
    const withQs = kws.filter(k => k.qs > 0);
    const low = withQs.filter(k => k.qs <= 4);
    const share = sum(withQs, 'cost') > 0 ? sum(low, 'cost') / sum(withQs, 'cost') : 0;
    perf.qsLowShare = share;
    if (share > 0.25) add({ module: 'performance', sev: share > 0.5 ? 'crit' : 'warn', key: 'qs', title: `${Math.round(share * 100)} % av sökordskostnaden går till sökord med kvalitetsresultat 1–4`, freeText: 'Lågt kvalitetsresultat betyder att du betalar mer per klick än konkurrenter med bättre relevans.', detail: 'Sökorden med lägst kvalitetsresultat och högst kostnad.', items: low.sort((a, b) => b.cost - a.cost).slice(0, 8).map(k => ({ name: k.keyword, value: `KR ${k.qs}, ${fmtKr(k.cost)}` })) });
  }
  // Förlorad exponering pga rankning
  if (campAgg.some(c => c.lostRank != null)) {
    const w = campAgg.filter(c => c.lostRank != null && c.impr > 0);
    const lr = w.reduce((s, c) => s + c.lostRank * c.impr, 0) / Math.max(1, sum(w, 'impr'));
    perf.lostRank = lr;
    if (lr > 0.4) add({ module: 'performance', sev: lr > 0.6 ? 'crit' : 'warn', key: 'rank', title: `Annonserna missar ${Math.round(lr * 100)} % av möjliga visningar på grund av låg rankning`, freeText: 'Konkurrenterna vinner auktionerna oftare, oftast på grund av bud eller annonsernas relevans.', detail: 'Kampanjer med störst andel förlorade visningar på grund av rankning.', items: w.sort((a, b) => b.lostRank - a.lostRank).slice(0, 5).map(c => ({ name: c.name, value: `${Math.round(c.lostRank * 100)} % förlorat` })) });
  }
  perf.score = scoreFrom(findings.filter(f => f.module === 'performance'), 100, bm);

  /* ===== Modul 2: Slöseri ===== */
  const waste = { id: 'waste', name: 'Slöseri', available: sts.length > 0 || kws.length > 0, source: sts.length ? 'söktermer' : kws.length ? 'sökord' : null };
  let wasteSek = 0;
  if (waste.available) {
    const mf = mfFor(sts.length ? 'searchTerms' : 'keywords');
    const pool = sts.length ? sts : kws;
    const key = sts.length ? 'term' : 'keyword';
    const agg = [...groupBy(pool, key)].map(([name, rows]) => ({ name, ...totals(rows), matchType: rows[0].matchType, campaign: rows[0].campaign }));
    const poolCost = sum(agg, 'cost');
    const refCPA = acctCPA || div(sum(agg, 'cost'), sum(agg, 'conv')) || 300;
    // Statistisk tröskel: kostnaden motsvarar 1,5 konverteringar (risken att det är otur är under 25 %).
    // Söktermer om sådant kontot medvetet säljer kräver dubbelt så mycket innan de föreslås som negativa.
    const thr = Math.max(refCPA * 1.5, M(30));
    const core = t => t.name.toLowerCase().split(/[^a-z0-9åäöæøéü]+/).some(w => w.length >= 4 && sells(w));
    const expensive = agg.filter(t => t.conv === 0 && t.cost >= (core(t) ? thr * 2 : thr));
    const irrelevant = agg.filter(t => t.conv === 0 && t.cost > 0 && NEG_PATTERNS.some(p => p.re.test(t.name)) && !expensive.includes(t));
    const tail = agg.filter(t => t.conv === 0 && !expensive.includes(t) && !irrelevant.includes(t));
    const wasteSet = [...expensive, ...irrelevant];
    wasteSek = sum(wasteSet, 'cost') * mf;
    // Andelen räknas på månadsbelopp, eftersom rapporterna kan gälla olika långa perioder
    const denom = ((camps.length ? acct.cost * mfAcct : poolCost * mf) / mf) || 1;
    waste.pct = sum(wasteSet, 'cost') / denom;
    waste.monthly = wasteSek;
    // Negativa sökord: gemensamma ord från irrelevanta söktermer som frasmatchning, dyra söktermer som exakt matchning
    if (sts.length) {
      const negs = new Map();
      const addNeg = (keyword, match, campaign, reason, cost) => {
        const k = [keyword, match, campaign].join('|');
        const cur = negs.get(k);
        if (cur) { cur.costMonthly += cost; cur.terms += 1; }
        else negs.set(k, { keyword, match, campaign, reason, costMonthly: cost, terms: 1 });
      };
      irrelevant.forEach(t => {
        const p = NEG_PATTERNS.find(p => p.re.test(t.name));
        const m = p && t.name.match(p.re);
        if (m) addNeg(m[0].toLowerCase(), 'phrase', t.campaign, 'Irrelevant: ' + p.label, t.cost * mf);
      });
      expensive.forEach(t => {
        const p = NEG_PATTERNS.find(p => p.re.test(t.name));
        const m = p && t.name.match(p.re);
        if (m) addNeg(m[0].toLowerCase(), 'phrase', t.campaign, 'Irrelevant: ' + p.label, t.cost * mf);
        else addNeg(t.name.toLowerCase(), 'exact', t.campaign, 'Dyr utan konvertering', t.cost * mf);
      });
      waste.negatives = [...negs.values()].sort((a, b) => b.costMonthly - a.costMonthly);
    }
    waste.poolCount = agg.length;
    const label = sts.length ? 'söktermer' : 'sökord';
    if (expensive.length) add({ module: 'waste', sev: sum(expensive, 'cost') / denom > 0.1 ? 'crit' : 'warn', key: 'expensive', title: `${expensive.length} ${label} har kostat minst ${fmtKr(thr)} var utan en enda konvertering`, freeText: `Tillsammans motsvarar det cirka ${fmtKr(sum(expensive, 'cost') * mf)} per månad.`, detail: `${label[0].toUpperCase() + label.slice(1)} att lägga till som negativa sökord eller begränsa med matchningstyp.`, impact: { kind: 'waste', sek: sum(expensive, 'cost') * mf }, items: expensive.sort((a, b) => b.cost - a.cost).map(t => ({ name: t.name, value: fmtKr(t.cost * mf) + '/mån' })) });
    if (irrelevant.length) {
      const cats = [...new Set(irrelevant.map(t => (NEG_PATTERNS.find(p => p.re.test(t.name)) || {}).label))].filter(Boolean);
      add({ module: 'waste', sev: 'warn', key: 'irrelevant', title: `${irrelevant.length} irrelevanta ${label} (${cats.join(', ')}) visar dina annonser`, freeText: `Söker man på sådant köper man sällan. Cirka ${fmtKr(sum(irrelevant, 'cost') * mf)} per månad.`, detail: 'Färdig lista med negativa sökord att lägga in på kontonivå.', impact: { kind: 'waste', sek: sum(irrelevant, 'cost') * mf }, items: irrelevant.sort((a, b) => b.cost - a.cost).map(t => ({ name: t.name, value: fmtKr(t.cost * mf) + '/mån' })) });
    }
    // Söktermer med andras varumärken: får användas som sökord men normalt inte i annonstext eller produkttitlar
    const branded = agg.filter(t => t.clicks > 0 && brandsIn(t.name).length);
    if (branded.length) {
      const bnames = [...new Set(branded.flatMap(t => brandsIn(t.name)))];
      add({ module: 'performance', sev: 'info', key: 'brands', title: `${branded.length} ${label} innehåller andras varumärken (${bnames.slice(0, 5).join(', ')}${bnames.length > 5 ? ' m.fl.' : ''})`,
        freeText: `Kunderna söker på varumärken som ni troligen inte får skriva i annonser eller produkttitlar. Cirka ${fmtKr(sum(branded, 'cost') * mf)} per månad, ${Math.round(sum(branded, 'conv'))} konverteringar.`,
        detail: 'Söktermerna med varumärken och vad de kostar och ger. Använd inte varumärket i annonstext eller titlar utan tillstånd.',
        items: branded.sort((a, b) => b.cost - a.cost).map(t => ({ name: t.name, value: `${fmtKr(t.cost * mf)}/mån, ${Math.round(t.conv * 10) / 10} konv. (${brandsIn(t.name).join(', ')})` })) });
    }
    // Återkommande ord: slöseriet i ett moget konto är utspritt på hundratals små söktermer som var för sig är för små att flagga.
    // Summera kostnaden per ord och ordpar över alla söktermer och flagga de som borde ha sålt vid det här laget men inte gjort det.
    if (sts.length && refCPA) {
      const STOPW = new Set('och med för till av en ett som i på the and for with of to a an in on my your me near nära bäst best'.split(' '));
      const counted = new Set(wasteSet.map(t => t.name));
      const gram = {};
      agg.forEach(t => {
        const w = t.name.toLowerCase().split(/[^a-z0-9åäöæøéü]+/).filter(x => x && !STOPW.has(x) && !/^\d+$/.test(x) && x.length > 1 && !DETECTED_OWN.has(x));
        const gs = new Set([...w, ...w.slice(0, -1).map((x, i) => x + ' ' + w[i + 1])]);
        gs.forEach(g => { const n = gram[g] || (gram[g] = { g, cost: 0, conv: 0, value: 0, clicks: 0, terms: [] }); n.cost += t.cost; n.conv += t.conv; n.value += t.value || 0; n.clicks += t.clicks; n.terms.push(t); });
      });
      // Minst tre olika söktermer, kostnad motsvarande minst två konverteringar och ingen försäljning (sannolikheten att det är otur är då under 15 %)
      const cand = Object.values(gram).filter(n => n.terms.length >= 3 && n.conv === 0 && n.cost >= refCPA * 2).sort((a, b) => b.cost - a.cost);
      const picked = [], covered = new Set(), coreWords = [];
      const candSet = new Set(cand.map(n => n.g));
      for (const n of cand) {
        // Välj hellre det mer precisa ordparet ("dressing gown") än det enskilda ordet när paret står för nästan hela kostnaden
        if (!n.g.includes(' ') && cand.some(b => b.g.includes(' ') && b.g.split(' ').includes(n.g) && b.cost >= n.cost * 0.8)) continue;
        // Ord som kontot har egna sökord eller kampanjer för föreslås inte som negativa
        if (n.g.split(' ').every(w => sells(w))) { if (coreWords.length < 15 && !coreWords.some(c => n.g.includes(c.g) || c.g.includes(n.g))) coreWords.push(n); continue; }
        const fresh = n.terms.filter(t => !covered.has(t.name));
        if (fresh.length < n.terms.length * 0.5) continue; // redan täckt av ett annat ord
        picked.push(n); n.terms.forEach(t => covered.add(t.name));
        if (picked.length >= 40) break;
      }
      if (picked.length) {
        const extra = [...covered].filter(name => !counted.has(name)).reduce((s2, name) => s2 + (agg.find(t => t.name === name) || { cost: 0 }).cost, 0);
        const total = picked.reduce((s2, n) => s2 + n.cost, 0);
        waste.ngrams = picked.map(n => ({ word: n.g, terms: n.terms.length, costMonthly: n.cost * mf, clicks: n.clicks }));
        if (waste.negatives) picked.forEach(n => waste.negatives.push({ keyword: n.g, match: 'phrase', campaign: '', reason: `Ordet finns i ${n.terms.length} söktermer utan försäljning`, costMonthly: n.cost * mf, terms: n.terms.length }));
        if (waste.negatives) waste.negatives.sort((a, b) => b.costMonthly - a.costMonthly);
        add({ module: 'waste', sev: total / denom > 0.05 ? 'crit' : 'warn', key: 'ngrams',
          title: `${picked.length} ord i söktermerna har kostat ${fmtKr(total * mf)} per månad utan en enda försäljning`,
          freeText: `Var för sig är söktermerna för små för att märkas, men tillsammans är de det. Det största är "${picked[0].g}" i ${picked[0].terms.length} olika söktermer.`,
          detail: 'Ord och ordpar som återkommer i många söktermer utan konverteringar. Lägg dem som negativa sökord med frasmatchning, efter att ha kontrollerat att ni inte säljer det de syftar på.',
          impact: { kind: 'waste', sek: extra * mf },
          items: picked.map(n => ({ name: `"${n.g}"`, value: `${fmtKr(n.cost * mf)}/mån, ${n.terms.length} söktermer, ${nf0.format(n.clicks)} klick` })) });
      }
      // Ord för sådant kontot säljer, som ändå inte gett någon försäljning: inte negativa sökord, men bud, flöde eller landningssida att se över
      if (coreWords.length) {
        const tot = coreWords.reduce((s2, n) => s2 + n.cost, 0);
        add({ module: 'waste', sev: 'warn', key: 'ngramsCore', title: `${coreWords.length} ord för sådant ni säljer har kostat ${fmtKr(tot * mf)} per månad utan försäljning`,
          freeText: `Det gäller ord som ni har egna sökord eller kampanjer för, till exempel "${coreWords[0].g}". Kunderna söker och klickar, men köper inte.`,
          detail: 'Inte negativa sökord: se över bud, pris, produktbild och landningssida för de här produkterna, eller sänk buden tills de lönar sig.',
          impact: { kind: 'potential', sek: tot * mf },
          items: coreWords.map(n => ({ name: `"${n.g}"`, value: `${fmtKr(n.cost * mf)}/mån, ${n.terms.length} söktermer, ${nf0.format(n.clicks)} klick` })) });
      }
      // Söktermer som säljer bra men inte finns som sökord: tillväxt, inte besparing
      const kwSet = new Set(kws.map(k => (k.keyword || '').toLowerCase().replace(/[\[\]"+]/g, '').trim()));
      const acctROAS = acct.value > 0 ? acct.value / acct.cost : null;
      const opp = agg.filter(t => t.conv >= 2 && !kwSet.has(t.name.toLowerCase()) && !t.name.toLowerCase().split(/[^a-z0-9åäö]+/).some(w => DETECTED_OWN.has(w))
        && !/(added|tillagd|excluded|utesl|exkl)/.test(t.added || '')
        && (acctROAS ? (t.value || 0) / (t.cost || 1e-9) >= acctROAS : (t.cost / t.conv) <= refCPA)).sort((a, b) => b.conv - a.conv).slice(0, 50);
      if (opp.length >= 3) add({ module: 'performance', sev: 'info', key: 'kwOpp', title: `${opp.length} söktermer säljer bättre än snittet men finns inte som egna sökord`,
        freeText: `Tillsammans ${nf0.format(Math.round(sum(opp, 'conv') * mf))} konverteringar per månad. Som egna sökord kan de få egna bud och egna annonstexter.`,
        detail: 'Söktermer med minst två konverteringar och bättre lönsamhet än kontot, som inte redan är sökord. Lägg till dem i en sökkampanj med exakt matchning.',
        items: opp.map(t => ({ name: t.name, value: `${nf0.format(Math.round(t.conv * mf * 10) / 10)} konv./mån${acctROAS ? `, ROAS ${nf2.format((t.value || 0) / t.cost)}` : `, ${fmtKr(t.cost / t.conv)}/konv.`}` })) });
    }
    if (tail.length > 10 && sum(tail, 'cost') / denom > 0.08) add({ module: 'waste', sev: 'info', key: 'tail', title: `${tail.length} ${label} med få klick och inga konverteringar`, freeText: `Var för sig små belopp, totalt cirka ${fmtKr(sum(tail, 'cost') * mf)} per månad.`, detail: 'Mönster i den långa svansen som kan stängas med frasmatchning eller negativa sökord.', items: tail.sort((a, b) => b.cost - a.cost).slice(0, 15).map(t => ({ name: t.name, value: fmtKr(t.cost * mf) + '/mån' })) });
    // Bred matchning
    const mt = kws.length ? kws : sts;
    if (mt.some(r => r.matchType)) {
      const broad = mt.filter(r => /(broad|bred)/.test(r.matchType)), rest = mt.filter(r => r.matchType && !/(broad|bred)/.test(r.matchType));
      const tb = totals(broad), tr = totals(rest);
      if (tb.cost > 0 && tr.cpa && (tb.cpa == null || tb.cpa > tr.cpa * 1.5) && tb.cost / (tb.cost + tr.cost) > 0.2) add({ module: 'waste', sev: 'warn', key: 'broad', title: `Bred matchning står för ${Math.round(tb.cost / (tb.cost + tr.cost) * 100)} % av kostnaden men konverterar sämre`, freeText: tb.cpa ? `Kostnad per konvertering är ${Math.round((tb.cpa / tr.cpa - 1) * 100)} % högre än för fras- och exakt matchning.` : 'Bred matchning har inte gett några konverteringar.', detail: 'Vilka sökord som bör flyttas till fras- eller exakt matchning.', items: broad.sort((a, b) => b.cost - a.cost).slice(0, 8).map(r => ({ name: r.keyword || r.term, value: fmtKr(r.cost * mf) + '/mån' })) });
    }
    waste.score = Math.round(clamp(100 - waste.pct * 250, 5, 100));
  }

  /* Sökord att pausa: inga konverteringar eller mycket hög kostnad per konvertering */
  const pauseList = [];
  if (kws.length) {
    const mf = mfFor('keywords');
    const ref = acctCPA || div(sum(kws, 'cost'), sum(kws, 'conv')) || 300;
    const kAgg = [...groupBy(kws.map(k => Object.assign({ _k: [k.campaign, k.adGroup, k.keyword, k.matchType].join('|') }, k)), '_k')].map(([, rows]) => ({ ...rows[0], ...totals(rows), status: rows[0].status }));
    const live = kAgg.filter(k => !/(paused|pausad|removed|borttagen)/.test(k.status || ''));
    const zero = live.filter(k => k.conv === 0 && k.cost >= Math.max(ref * 2, M(50)));
    const dear = live.filter(k => k.conv > 0 && k.cost >= ref * 3 && k.cpa >= ref * 2.5);
    const seasonalOut = [];
    [...zero.map(k => ({ ...k, why: 'Inga konverteringar' })), ...dear.map(k => ({ ...k, why: `${fmtKr(k.cpa)}/konv.` }))].forEach(k => {
      if (SEASONAL.test(k.keyword)) seasonalOut.push(k); else pauseList.push(k);
    });
    waste.seasonal = seasonalOut;
    const mk = k => ({ name: k.keyword + (k.campaign ? ' · ' + k.campaign : ''), value: k.conv ? `${fmtKr(k.cost * mf)}/mån, ${fmtKr(k.cpa)}/konv.` : `${fmtKr(k.cost * mf)}/mån, inga konv.` });
    const pz = pauseList.filter(k => !k.conv), pd = pauseList.filter(k => k.conv);
    if (pz.length) add({ module: 'waste', sev: sum(pz, 'cost') / (acct.cost || 1) > 0.05 ? 'crit' : 'warn', key: 'kwZero', title: `${pz.length} sökord har kostat minst ${fmtKr(Math.max(ref * 2, M(50)))} var utan att ge en enda konvertering`, freeText: `Tillsammans cirka ${fmtKr(sum(pz, 'cost') * mf)} per månad.`, detail: 'Sökord att pausa eller begränsa till exakt matchning.', impact: { kind: 'waste', sek: sum(pz, 'cost') * mf }, items: pz.sort((a, b) => b.cost - a.cost).map(mk) });
    if (pd.length) { const ex = pd.reduce((s, k) => s + Math.max(0, k.cost - k.conv * ref), 0) * mf; add({ module: 'waste', sev: 'warn', key: 'kwDear', title: `${pd.length} sökord konverterar till mer än 2,5 gånger kontots kostnad per konvertering`, freeText: `De kostar cirka ${fmtKr(sum(pd, 'cost') * mf)} per månad, varav ${fmtKr(ex)} är över kontots snittnivå.`, detail: 'Sökord att sänka budet på eller pausa.', impact: { kind: 'potential', sek: ex }, items: pd.sort((a, b) => b.cost - a.cost).map(mk) }); }
    if (seasonalOut.length) add({ module: 'waste', sev: 'info', key: 'seasonal', title: `${seasonalOut.length} säsongssökord ser dyra ut men bör inte pausas före säsongen`, freeText: 'Sökord som "jul" eller "black friday" konverterar sällan utanför sin säsong.', detail: 'Bedöm dem på data från förra säsongen i stället.', items: seasonalOut.map(mk) });
  }

  /* Produkter (Shopping/Performance Max) */
  let titleSuggestions = [];
  const productList = [];
  const prodMod = { available: prods.length > 0 };
  if (prods.length) {
    const mf = mfFor('products');
    const pAgg = [...groupBy(prods, 'itemId')].map(([id, rows]) => ({ itemId: id, title: (rows.find(r => r.title) || {}).title || '', campaign: rows[0].campaign, ...totals(rows) }));
    const pt = totals(prods);
    const pEcom = pt.value > 0;
    const pCPA = pt.cpa || acctCPA || 100;
    const pROAS = pt.roas;
    prodMod.cost = pt.cost; prodMod.roas = pROAS; prodMod.cpa = pt.cpa; prodMod.count = pAgg.length;
    const zero = pAgg.filter(p => p.conv === 0 && p.cost >= Math.max(pCPA * 2, M(30)) && p.clicks >= 15);
    const weak = pAgg.filter(p => p.conv > 0 && p.cost >= pCPA * 3 && (pEcom && pROAS ? p.roas < pROAS * 0.5 : p.cpa >= pCPA * 2.5));
    const nm = p => (p.title ? p.title + ' (' + p.itemId + ')' : p.itemId);
    zero.forEach(p => { if (SEASONAL.test(p.title)) return; productList.push({ ...p, why: 'Inga konverteringar' }); });
    weak.forEach(p => { if (SEASONAL.test(p.title)) return; productList.push({ ...p, why: pEcom ? `ROAS ${nf2.format(p.roas)}` : `${fmtKr(p.cpa)}/konv.` }); });
    const zz = productList.filter(p => !p.conv), ww = productList.filter(p => p.conv);
    if (zz.length) add({ module: 'waste', sev: sum(zz, 'cost') / (pt.cost || 1) > 0.05 ? 'crit' : 'warn', key: 'prodZero', title: `${zz.length} produkter har kostat minst ${fmtKr(Math.max(pCPA * 2, M(30)))} var utan försäljning`, freeText: `Tillsammans cirka ${fmtKr(sum(zz, 'cost') * mf)} per månad i Shopping och Performance Max.`, detail: 'Produkter att utesluta eller flytta till en lågbudgetkampanj.', impact: { kind: 'waste', sek: sum(zz, 'cost') * mf }, items: zz.sort((a, b) => b.cost - a.cost).map(p => ({ name: nm(p), value: `${fmtKr(p.cost * mf)}/mån, ${p.clicks} klick` })) });
    if (ww.length) { const ex = ww.reduce((s, p) => s + Math.max(0, pEcom && pROAS ? p.cost - p.value / pROAS : p.cost - p.conv * pCPA), 0) * mf; add({ module: 'waste', sev: ex > pt.cost * mf * 0.1 ? 'crit' : 'warn', key: 'prodWeak', title: pEcom ? `${ww.length} produkter har ROAS under hälften av snittet` : `${ww.length} produkter har mer än 2,5 gånger snittets kostnad per konvertering`, freeText: pEcom ? `Snittet för produkterna är ROAS ${nf2.format(pROAS)}. De här produkterna kostar cirka ${fmtKr(sum(ww, 'cost') * mf)} per månad.` : `De kostar cirka ${fmtKr(sum(ww, 'cost') * mf)} per månad.`, detail: 'Produkter att sänka mål-ROAS för, flytta till en egen kampanj eller utesluta.', impact: { kind: 'potential', sek: ex }, items: ww.sort((a, b) => b.cost - a.cost).map(p => ({ name: nm(p), value: pEcom ? `${fmtKr(p.cost * mf)}/mån, ROAS ${nf2.format(p.roas)}` : `${fmtKr(p.cost * mf)}/mån, ${fmtKr(p.cpa)}/konv.` })) }); }
    if (!waste.available) { waste.available = true; waste.source = 'produkter'; }
    const pw = sum(zz, 'cost');
    waste.productPct = pw / (pt.cost || 1);
    // Produkter under break-even-ROAS (kräver marginal)
    if (margin && pEcom) {
      const be = 1 / margin;
      const lossOf = p => Math.max(0, p.cost - (p.value || 0) * margin);
      const listed = new Set(productList.map(p => p.itemId));
      const unp = pAgg.filter(p => !listed.has(p.itemId) && p.cost >= Math.max(pCPA * 2, M(30)) && (p.roas || 0) < be * 0.9 && !SEASONAL.test(p.title || p.itemId)).sort((a, b) => lossOf(b) - lossOf(a));
      if (unp.length) {
        const loss = unp.reduce((s2, p) => s2 + lossOf(p), 0) * mf;
        unp.forEach(p => productList.push({ ...p, why: `ROAS ${nf2.format(p.roas || 0)} under break-even ${nf2.format(be)}` }));
        add({ module: 'waste', sev: loss > pt.cost * mf * 0.1 ? 'crit' : 'warn', key: 'unprofitProd',
          title: `${unp.length} produkter säljer, men under break-even-ROAS ${nf2.format(be)}`,
          freeText: `Annonskostnaden som bruttovinsten inte täcker är cirka ${fmtKr(loss)} per månad.`,
          detail: 'Produkter som ger försäljning men inte vinst. Lägg dem i en egen kampanj med högre mål-ROAS, eller uteslut de sämsta.',
          impact: { kind: 'potential', sek: loss },
          items: unp.map(p => ({ name: nm(p), value: `${fmtKr(p.cost * mf)}/mån, ROAS ${nf2.format(p.roas || 0)}, förlust ${fmtKr(lossOf(p) * mf)}/mån` })) });
      }
    }
    // Optimerade produkttitlar utifrån söktermer som klickas och konverterar
    titleSuggestions = buildTitleSuggestions(pAgg, sts, mf);
    const withSug = titleSuggestions.filter(t => t.suggestion);
    if (titleSuggestions.length) add({ module: 'performance', sev: withSug.length >= 5 ? 'warn' : 'info', key: 'titles',
      title: withSug.length ? `${withSug.length} produkttitlar saknar ord som kunderna söker och köper på` : `${titleSuggestions.length} produkttitlar är för korta eller bryter mot Googles riktlinjer`,
      freeText: 'Titeln är det viktigaste fältet i Shopping. Den avgör vilka sökningar produkten visas för och om den blir klickad.',
      detail: sts.length ? 'Produkter med föreslagen ny titel, baserad på söktermerna som faktiskt ger klick och köp.' : 'Ladda upp söktermsrapporten också, så föreslår vi nya titlar baserade på vad kunderna söker på.',
      items: titleSuggestions.map(t => ({ name: `${t.title} (${t.itemId})`, value: t.short })) });
  }
  if (waste.available) {
    const extraZero = findings.filter(f => f.key === 'prodZero').reduce((s, f) => s + f.impact.sek, 0);
    if (!waste.monthly) { waste.monthly = 0; waste.pct = 0; }
    if (extraZero) { waste.monthly += extraZero; wasteSek += extraZero; waste.pct = waste.monthly / ((acct.cost * mf) || 1); }
    waste.score = Math.round(clamp(100 - (waste.pct || 0) * 250 - findings.filter(f => f.key === 'kwZero' || f.key === 'kwDear' || f.key === 'prodWeak').length * 8, 5, 100));
    if (!camps.length) waste.notes = ['Andelen räknas mot söktermsrapportens totala kostnad eftersom kampanjrapport saknas.'];
  }

  /* ===== Modul 3: Budgettakt ===== */
  const hasBudget = campAgg.some(c => c.budget > 0), hasLost = campAgg.some(c => c.lostBudget != null);
  const pacing = { id: 'pacing', name: hasBudget ? 'Budgettakt' : 'Budgettak', available: hasBudget || hasLost, hasBudget };
  if (!hasBudget && hasLost) {
    // Utan budgetkolumn: använd förlorad exponeringsandel (budget) för att hitta kampanjer som stoppas av budgeten
    const capped = campAgg.filter(c => c.lostBudget != null && c.lostBudget >= 0.1 && c.cost > 0 && (acctCPA && c.cpa != null ? c.cpa <= acctCPA * 1.35 : (c.roas && acct.roas ? c.roas >= acct.roas * 0.9 : false)));
    let sc = 100;
    if (capped.length) {
      const missed = capped.reduce((s, c) => { const lb = Math.min(c.lostBudget, 0.8); return s + c.conv * lb / (1 - lb); }, 0) * mf;
      const addSpend = capped.reduce((s, c) => { const lb = Math.min(c.lostBudget, 0.6); return s + c.cost * lb / (1 - lb); }, 0) * mf;
      add({ module: 'pacing', sev: 'warn', key: 'capped', title: `${capped.length} lönsam${capped.length === 1 ? ' kampanj' : 'ma kampanjer'} stoppas av budgeten`, freeText: `Uppskattningsvis ${Math.round(missed)} konverteringar per månad går förlorade. Det skulle kosta cirka ${fmtKr(addSpend)} mer per månad att ta dem.`, detail: 'Kampanjer som förlorar visningar på grund av budget fast resultatet är bättre än kontots snitt.', impact: { kind: 'opportunity', sek: addSpend, conv: missed }, items: capped.map(c => ({ name: c.name, value: `${Math.round(c.lostBudget * 100)} % förlorat pga budget, ${c.cpa != null ? fmtKr(c.cpa) + '/konv.' : ''}` })) });
      sc -= Math.min(45, 15 * capped.length);
    }
    pacing.score = Math.round(clamp(sc, 10, 100));
    pacing.cappedCount = capped.length;
  }
  if (hasBudget) {
    const lastD = to ? dnum(to) : null;
    const active = campAgg.filter(c => c.budget > 0 && !/(paused|pausad|removed|borttagen)/.test(c.status || '') && c.cost > 0);
    let runRate = 0, dailyBudget = 0;
    const capped = [], under = [], cappedDear = [];
    for (const c of active) {
      let avgDaily;
      if (lastD != null && gran === 'day') {
        const recent = c.rows.filter(r => r.date && dnum(r.date) > lastD - 7);
        avgDaily = sum(recent, 'cost') / 7;
      } else avgDaily = c.cost / periodDays;
      c.avgDaily = avgDaily; c.util = avgDaily / c.budget;
      runRate += avgDaily; dailyBudget += c.budget;
      const isCapped = c.lostBudget != null ? c.lostBudget >= 0.1 : c.util >= 0.95;
      const profitable = acctCPA && c.cpa != null ? c.cpa <= Math.max(acctCPA * 1.35, costComparable ? bench.cpl * fx : 0) : (c.roas && acct.roas ? c.roas >= acct.roas * 0.9 : false);
      if (isCapped && profitable) capped.push(c);
      else if (isCapped && c.cpa != null && acctCPA && c.cpa > acctCPA * 1.5) cappedDear.push(c);
      if (c.util < 0.5 && c.budget * 30.4 > 1000) under.push(c);
    }
    pacing.dailyBudget = dailyBudget; pacing.runRate = runRate;
    pacing.monthBudget = dailyBudget * 30.4;
    if (lastD != null && gran === 'day') {
      const y = to.slice(0, 7);
      const dim = new Date(Date.UTC(+to.slice(0, 4), +to.slice(5, 7), 0)).getUTCDate();
      const day = +to.slice(8, 10);
      const mtd = sum(camps.filter(r => r.date && r.date.slice(0, 7) === y && active.some(c => c.name === r.campaign)), 'cost');
      pacing.month = y; pacing.mtd = mtd; pacing.daysLeft = dim - day;
      pacing.projected = mtd + runRate * (dim - day);
      pacing.monthBudget = dailyBudget * dim;
    } else pacing.projected = runRate * 30.4;
    const ratio = pacing.projected / Math.max(1, pacing.monthBudget);
    pacing.ratio = ratio;
    pacing.verdict = ratio > 1.05 ? 'over' : ratio < 0.85 ? 'under' : 'ontrack';
    let sc = 100;
    if (capped.length) {
      const missed = capped.reduce((s, c) => { const lb = c.lostBudget != null ? Math.min(c.lostBudget, 0.8) : 0.15; return s + c.conv * lb / (1 - lb); }, 0) * mf;
      add({ module: 'pacing', sev: 'warn', key: 'capped', title: `${capped.length} lönsam${capped.length === 1 ? ' kampanj' : 'ma kampanjer'} stoppas av budgeten varje dag`, freeText: `Uppskattningsvis ${Math.round(missed)} konverteringar per månad går förlorade${acctCPA ? `, värda cirka ${fmtKr(missed * acctCPA)} i annonskostnad` : ''}.`, detail: 'Kampanjer där budgeten tar slut fast resultatet är bättre än kontots snitt.', impact: { kind: 'opportunity', sek: acctCPA ? missed * acctCPA : 0, conv: missed }, items: capped.map(c => ({ name: c.name, value: `${c.lostBudget != null ? Math.round(c.lostBudget * 100) + ' % förlorat pga budget' : 'når budgettaket'}, ${fmtKr(c.cpa)}/konv.` })) });
      sc -= Math.min(45, 15 * capped.length);
    }
    if (cappedDear.length) { add({ module: 'pacing', sev: 'info', key: 'cappedDear', title: `${cappedDear.length} budgetbegränsad${cappedDear.length === 1 ? '' : 'e'} kampanj${cappedDear.length === 1 ? '' : 'er'} är också dyr${cappedDear.length === 1 ? '' : 'a'} per konvertering`, freeText: 'Mer budget hjälper inte här. Effektiviteten behöver förbättras först.', detail: 'Vilka kampanjer det gäller och vad som driver kostnaden.', items: cappedDear.map(c => ({ name: c.name, value: `${fmtKr(c.cpa)}/konv.` })) }); sc -= 5; }
    if (under.length) { add({ module: 'pacing', sev: 'info', key: 'under', title: `${under.length} kampanj${under.length === 1 ? '' : 'er'} använder mindre än halva sin budget`, freeText: `Cirka ${fmtKr(under.reduce((s, c) => s + (c.budget - c.avgDaily) * 30.4, 0))} per månad ligger outnyttjat och kunde flyttas.`, detail: 'Budget som kan flyttas till kampanjer som når sitt tak.', impact: { kind: 'potential', sek: 0 }, items: under.map(c => ({ name: c.name, value: `${Math.round(c.util * 100)} % av budgeten` })) }); sc -= Math.min(30, 10 * under.length); }
    if (Math.abs(ratio - 1) > 0.15) sc -= 10;
    pacing.score = Math.round(clamp(sc, 10, 100));
    pacing.cappedCount = capped.length;
  }

  /* ===== Modul 4: Vecka mot vecka ===== */
  const wow = { id: 'wow', name: 'Vecka mot vecka', available: !!(camps.length && gran && periodDays >= 14) };
  if (wow.available) {
    let curR, prevR, curLabel, prevLabel;
    if (gran === 'day') {
      const L = dnum(to);
      curR = camps.filter(r => r.date && dnum(r.date) > L - 7);
      prevR = camps.filter(r => r.date && dnum(r.date) <= L - 7 && dnum(r.date) > L - 14);
      curLabel = `${dstr(L - 6)} – ${to}`; prevLabel = `${dstr(L - 13)} – ${dstr(L - 7)}`;
    } else {
      const weeks = [...new Set(camps.map(r => r.date).filter(Boolean))].sort();
      const w1 = weeks[weeks.length - 1], w0 = weeks[weeks.length - 2];
      curR = camps.filter(r => r.date === w1); prevR = camps.filter(r => r.date === w0);
      curLabel = `vecka från ${w1}`; prevLabel = `vecka från ${w0}`;
    }
    const c = totals(curR), pv = totals(prevR);
    wow.cur = c; wow.prev = pv; wow.curLabel = curLabel; wow.prevLabel = prevLabel;
    const metrics = [
      { k: 'cost', sv: 'Kostnad', good: null },
      { k: 'clicks', sv: 'Klick', good: 'up' },
      { k: 'conv', sv: 'Konverteringar', good: 'up' },
      { k: 'cpa', sv: 'Kostnad/konv.', good: 'down' },
      { k: 'ctr', sv: 'CTR', good: 'up' },
      { k: 'cvr', sv: 'Konv.grad', good: 'up' },
      { k: 'cpc', sv: 'CPC', good: 'down' }
    ];
    if (c.roas != null && pv.roas != null) metrics.splice(4, 0, { k: 'roas', sv: 'ROAS', good: 'up' });
    wow.changes = metrics.map(m => ({ ...m, cur: c[m.k], prev: pv[m.k], delta: pct(c[m.k], pv[m.k]) }));
    const enough = pv.clicks >= 50 || pv.conv >= 5;
    const perCamp = [...groupBy([...curR, ...prevR], 'campaign')].map(([name]) => {
      const a = totals(curR.filter(r => r.campaign === name)), b = totals(prevR.filter(r => r.campaign === name));
      return { name, dCost: a.cost - b.cost, dConv: a.conv - b.conv, dClicks: a.clicks - b.clicks };
    });
    let sc = 100;
    const neg = wow.changes.filter(ch => ch.delta != null && ch.good && Math.abs(ch.delta) >= 20 && ((ch.good === 'up' && ch.delta < 0) || (ch.good === 'down' && ch.delta > 0)));
    if (enough) {
      for (const ch of neg) {
        const sev = Math.abs(ch.delta) >= 35 ? 'crit' : 'warn';
        sc -= sev === 'crit' ? 25 : 12;
        let driver = null, share = null;
        if (ch.k === 'cpa' || ch.k === 'roas') {
          const contrib = perCamp.map(p => ({ ...p, v: p.dCost - (pv.cpa || 0) * p.dConv })).sort((a, b) => b.v - a.v);
          const tot = contrib.filter(x => x.v > 0).reduce((s, x) => s + x.v, 0);
          if (contrib[0] && contrib[0].v > 0) { driver = contrib[0].name; share = contrib[0].v / tot; }
        } else if (ch.k === 'conv' || ch.k === 'clicks') {
          const key = ch.k === 'conv' ? 'dConv' : 'dClicks';
          const s = perCamp.slice().sort((a, b) => a[key] - b[key]);
          const tot = s.filter(x => x[key] < 0).reduce((t, x) => t + x[key], 0);
          if (s[0] && s[0][key] < 0) { driver = s[0].name; share = s[0][key] / tot; }
        }
        const why = ch.k === 'cpa' ? ` Klickpriset ändrades ${fmtDelta(pct(c.cpc, pv.cpc))} och konverteringsgraden ${fmtDelta(pct(c.cvr, pv.cvr))}.` : '';
        add({ module: 'wow', sev, key: 'wow-' + ch.k, title: `${ch.sv} ${fmtDelta(ch.delta)} jämfört med veckan innan`, freeText: `Senaste 7 dagarna mot de 7 dagarna före.`, detail: (driver ? `${Math.round(share * 100)} % av förändringen kommer från en enda kampanj.` : 'Förändringen är spridd över flera kampanjer.') + why, items: driver ? [{ name: driver, value: `${Math.round(share * 100)} % av förändringen` }] : [] });
      }
      const pos = wow.changes.filter(ch => ch.delta != null && ch.good && Math.abs(ch.delta) >= 20 && !neg.includes(ch));
      wow.positives = pos;
    } else wow.notes = ['För lite trafik veckan innan för säkra slutsatser (under 50 klick).'];
    wow.enough = enough;
    wow.score = Math.round(clamp(sc, 10, 100));
    const head = wow.changes.find(ch => ch.k === 'cpa' && ch.delta != null) || wow.changes.find(ch => ch.k === 'conv');
    wow.headline = head;
  }

  /* ===== Totalbetyg ===== */
  const modules = [perf, waste, pacing, wow];
  const weights = { performance: 30, waste: 35, pacing: 20, wow: 15 };
  const av = modules.filter(m => m.available && m.score != null);
  const wsum = av.reduce((s, m) => s + weights[m.id], 0);
  let overall = av.length ? Math.round(av.reduce((s, m) => s + m.score * weights[m.id], 0) / wsum) : null;

  addTips(findings, { campAgg, acctCPA, bench, fx, costComparable, negatives: waste.negatives || [], mf, pauseList, productList });
  const savings = estimateSavings(findings, acctCPA, acct.roas);
  // Betyget speglar hur stor del av budgeten som går att spara eller flytta, inte bara jämförelsen med branschsnittet.
  // 10 % möjlig besparing ger högst 85, 20 % högst 70.
  const atStake = acct.cost > 0 ? (savings.high || 0) / (acct.cost * mfAcct) : 0;
  if (overall != null) overall = Math.min(overall, Math.round(100 - atStake * 150));
  const narrative = buildNarrative({ acct, acctCPA, campAgg, mf, findings, savings, ecom: acct.value > 0, prodMod, currency });
  const sevRank = { crit: 0, warn: 1, info: 2 };
  findings.sort((a, b) => sevRank[a.sev] - sevRank[b.sev] || ((b.impact?.sek || 0) - (a.impact?.sek || 0)));
  const missedConv = findings.filter(f => f.impact && f.impact.kind === 'opportunity').reduce((s, f) => s + (f.impact.conv || 0), 0);
  const potential = findings.filter(f => f.impact && f.impact.kind === 'potential').reduce((s, f) => s + (f.impact.sek || 0), 0);

  return {
    overall, verdict: verdictFor(overall), modules: { performance: perf, waste, pacing, wow }, findings,
    counts: { crit: findings.filter(f => f.sev === 'crit').length, warn: findings.filter(f => f.sev === 'warn').length, info: findings.filter(f => f.sev === 'info').length },
    wasteMonthly: wasteSek, potentialMonthly: potential, missedConvMonthly: missedConv,
    spendMonthly: acct.cost * mf, account: acct,
    period: { from, to, days: periodDays, assumed, gran }, currency, industry: benchLabel,
    campaigns: campAgg.map(c => ({ name: c.name, cost: c.cost * mf, conv: c.conv * mf })),
    negatives: waste.negatives || [],
    pauseKeywords: pauseList.map(k => ({ campaign: k.campaign, adGroup: k.adGroup, keyword: k.keyword, matchType: k.matchType, costMonthly: k.cost * mf, conv: k.conv, cpa: k.cpa, why: k.why })),
    titleSuggestions,
    productExclusions: productList.map(p => ({ itemId: p.itemId, title: p.title, campaign: p.campaign, costMonthly: p.cost * mf, clicks: p.clicks, conv: p.conv, roas: p.roas, cpa: p.cpa, why: p.why })),
    savings, narrative
  };
}

/* Säsongsord: bedöms inte på data utanför säsongen */
const SEASONAL = /\b(jul\w*|christmas|xmas|kerst\w*|noël|noel|sinterklaas|chocolade ?letter\w*|chokladbokstäv\w*|alla hjärtans|valentin\w*|mors dag|fars dag|mother'?s day|father'?s day|black ?friday|cyber ?monday|påsk\w*|easter|midsommar|halloween|student\w*|nyår\w*)\b/i;

/* ---------- Optimerade produkttitlar ----------
   Matchar söktermer mot produkter via gemensamma ord (även sammansatta ord: "fotokalender" ~ "kalender"),
   hittar ord som kunderna söker och köper på men som saknas i titeln, och föreslår en ny titel. */
const T_STOP = new Set('och med för till i på av en ett som det den att är eller utan the and for with of to in on by from or your din ditt dina er ert era'.split(' '));
const T_JOIN = new Set(['med', 'för', 'till', 'i', 'på', 'av', 'utan', 'with', 'for', 'in', 'on', 'of']);
const T_TRANS = new Set('skapa göra gör designa design make create custom skriva skriv printa framkalla framkallning köp köpa köper beställ beställa billig billigt billiga billigast pris priser online butik rea rabatt bästa bäst buy cheap price prices shop store best sale near nära'.split(' '));
const T_PROMO = /(gratis frakt|fri frakt|free shipping|\brea\b|\bsale\b|rabatt|\d+\s?%|!|bäst i test|billigast|kampanj)/i;
function tTok(w) {
  w = String(w || '').toLowerCase().replace(/[^a-z0-9åäöéüæø]/g, '');
  if (!w || T_STOP.has(w) || T_TRANS.has(w)) return '';
  if (/^\d+$/.test(w)) return '';
  if (w.length < 3 && !(/\d/.test(w) && /[a-zåäö]/.test(w))) return '';
  return w;
}
const tToks = s => String(s || '').split(/[\s\-–\/|,.()]+/).map(tTok).filter(Boolean);
function tSame(a, b) {
  if (a === b) return true;
  const s = a.length < b.length ? a : b, l = a.length < b.length ? b : a;
  if (s.length < 4) return false;
  // Svenska sammansättningar har huvudordet sist: "fotomugg" är en mugg, men "foto" är inte en fotobok
  if (l.endsWith(s)) return true;
  if (s.length >= 6 && l.startsWith(s)) return true;
  return s.length >= 5 && l.slice(0, 5) === s.slice(0, 5) && l.length - s.length <= 3;
}
const tHas = (list, w) => { const g = synOf(w); return list.some(x => tSame(x, w) || (g && g.includes(x))); };
// Ord som betyder samma sak i en fotokatalog: finns ett av dem i titeln räknas de andra som närvarande
const T_SYN = [['foto', 'foton', 'fotot', 'bild', 'bilder', 'bilden', 'photo', 'photos', 'picture', 'pictures', 'image', 'images', 'motiv'],
  ['present', 'presenter', 'gåva', 'gåvor', 'gift', 'gifts']];
const synOf = w => T_SYN.find(g => g.includes(w));
// Ord som inte bär betydelse ensamma i en tillagd fras
const T_WEAK = new Set('egen eget egna ditt din dina mitt min mina vår vårt våra own your my'.split(' '));
/* Varumärken och skyddade namn som kunder söker på men som annonsören normalt inte får använda i egen text.
   alt = beskrivande ord att använda i stället. Listan är inte komplett; lägg till egna i T_BRANDS. */
const T_BRANDS = {
  polaroid: 'retrobild med vit kant', instax: 'minibild', fujifilm: '', kodak: '', canon: '', nikon: '', gopro: '',
  lego: 'byggklossar', duplo: 'byggklossar', disney: '', marvel: '', pixar: '', pokemon: '', barbie: '', hellokitty: '', mumin: '', muminmugg: '', pippi: '',
  ikea: '', ribba: 'ram', apple: '', iphone: 'mobilskal', ipad: 'surfplattefodral', airpods: '', macbook: '', samsung: '', galaxy: '',
  spotify: 'musiktavla', instagram: 'kvadratisk bild', facebook: '', tiktok: '', pinterest: '', youtube: '',
  cewe: '', ifolor: '', photobox: '', vistaprint: '', smartphoto: '', printler: '', desenio: '', posterstore: '', bonusprint: '', albelli: '', moo: '',
  tupperware: 'matlåda', thermos: 'termos', velcro: 'kardborre', frisbee: 'flygande tallrik', jacuzzi: 'bubbelpool', postit: 'notislapp', stanley: '', yeti: '',
  nike: '', adidas: '', zara: '', hm: '', amazon: '', ikano: '', jysk: '', clasohlson: '', biltema: '', jula: '', bauhaus: '', byggmax: '', hornbach: ''
};
// Kontots egna varumärke upptäcks från varumärkeskampanjerna (se analyze) och räknas aldrig som någon annans
let DETECTED_OWN = new Set();
const brandOf = w => {
  w = String(w || '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');
  if (!w || DETECTED_OWN.has(w) || (CONFIG.ownBrands || []).some(b => w.includes(String(b).toLowerCase()))) return null;
  if (Object.prototype.hasOwnProperty.call(T_BRANDS, w)) return w;
  // Sammansättningar som "polaroidbilder" och "legofigur": varumärket först
  return Object.keys(T_BRANDS).find(b => b.length >= 5 && w.startsWith(b)) || null;
};
// Varumärken som ofta används beskrivande av tillbehör ("skal till iPhone") – varnas inte för i titeln
const T_COMPAT = new Set(['iphone', 'ipad', 'airpods', 'macbook', 'samsung', 'galaxy', 'apple']);
// Platser och länder: kunderna lägger till dem i sökningen, men de hör inte hemma i en produkttitel
const T_GEO = new Set(('sverige sweden svensk stockholm göteborg goteborg malmö malmo uppsala norge norway oslo danmark denmark köpenhamn copenhagen finland helsinki '
  + 'ireland irish dublin cork galway limerick belfast uk england britain london scotland wales europe europa eu usa '
  + 'deutschland germany berlin nederland netherlands belgium belgië belgique france paris españa spain italia italy österreich austria schweiz switzerland '
  + 'local lokal lokalt nearby near nära stan city').split(' '));
const brandsIn = s => [...new Set(String(s || '').split(/[\s\-–\/|,.()]+/).map(brandOf).filter(Boolean))];
const capFirst = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const sizeCase = w => /^[a-z]\d{1,2}$/i.test(w) ? w.toUpperCase() : w;
function buildTitleSuggestions(pAgg, sts, mf) {
  const negRe = NEG_PATTERNS.map(p => p.re);
  const terms = [...groupBy(sts, 'term')].map(([term, rows]) => ({ term, ...totals(rows), toks: tToks(term) }))
    .filter(t => t.clicks > 0 && t.toks.length && !negRe.some(re => re.test(t.term)));
  const out = [];
  // Storlekar och modellkoder (A4, 30x30) som bara finns i en produkts titel kan koppla en sökterm till just den produkten
  const sizeFreq = {};
  pAgg.forEach(p => new Set(tToks(p.title).filter(w => /\d/.test(w))).forEach(w => { sizeFreq[w] = (sizeFreq[w] || 0) + 1; }));
  // Ord som finns i många titlar ("foto", "print") säger inget om vilken produkt en sökning gäller
  const titleToks = pAgg.map(p => ({ id: p.itemId, toks: tToks(p.title) }));
  const df = w => titleToks.filter(t => tHas(t.toks, w)).length;
  const genericLimit = Math.max(3, Math.ceil(titleToks.length * 0.15));
  const dfCache = {};
  const isGeneric = w => (dfCache[w] != null ? dfCache[w] : (dfCache[w] = df(w))) >= genericLimit || !!synOf(w);
  // Ett ord som är en annan produkts namn i katalogen får aldrig läggas till ("strumpor" på ett vykort)
  const otherProductWord = (w, id) => titleToks.some(t => t.id !== id && t.toks.some(x => tSame(x, w)));
  // Hur många produkter ett ord pekar på ("postcards" ~ "card", "cards" i sju titlar)
  const sing = w => w.length > 4 ? w.replace(/(es|s)$/, '') : w;
  const linkCount = w => titleToks.filter(t => t.toks.some(x => tSame(x, w) || tSame(sing(x), sing(w)))).length;
  // Ett varumärke som står i många av butikens egna titlar är butikens eget
  const ownBrand = b => isGeneric(b) || df(b) >= Math.max(2, titleToks.length * 0.2);
  const T_SUPPORT_CONV = 5;
  // Första varvet: vilka söktermer hör till vilken produkt
  const relOf = pt => terms.filter(t => {
    const words = t.toks.filter(w => !/\d/.test(w) && !isGeneric(w) && !T_GEO.has(w));
    // Ett huvudord som bara liknar ett titelord ("postcards" ~ "cards") räknas inte om titelordet finns i flera titlar
    const hit = w => pt.some(x => !isGeneric(x) && (x === w || (synOf(w) && synOf(w).includes(x)) || (tSame(x, w) && linkCount(x) <= 2)));
    const m = words.filter(hit).length;
    const size = t.toks.some(w => /\d/.test(w) && sizeFreq[w] === 1 && pt.includes(w));
    return (words[0] && hit(words[0])) || m >= 2 || size;
  });
  const products = pAgg.filter(p => p.title && p.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 80);
  const relMap = new Map(products.map(p => [p.itemId, relOf(tToks(p.title.trim()))]));
  // Ord som kunderna lägger till för många olika produkter ("personalised", "ireland") är tillägg, inte produktegenskaper
  const spread = {};
  products.forEach(p => { const pt = tToks(p.title); new Set(relMap.get(p.itemId).flatMap(t => t.toks).filter(w => !tHas(pt, w))).forEach(w => { spread[w] = (spread[w] || 0) + 1; }); });
  products.forEach(p => {
    const title = p.title.trim(), pt = tToks(title), issues = [];
    if (!pt.length) return;
    // En sökterm hör till produkten om dess huvudord (första innehållsordet, t.ex. "julkort" i "julkort med foto") finns i titeln,
    // eller om minst två av dess ord gör det
    const rel = relMap.get(p.itemId).slice()
      .sort((a, b) => b.conv - a.conv || b.clicks - a.clicks);
    const strong = rel.filter(t => t.conv > 0 || t.clicks >= 5);
    // Ett ord läggs bara till om flera söktermer har det, eller om det har gett flera köp
    const supported = k => { const ts = strong.filter(t => t.toks.includes(k)); return ts.length >= 2 || ts.reduce((s, t) => s + t.conv, 0) >= T_SUPPORT_CONV; };
    // Ord som saknas i titeln, som sammanhängande fraser ur söktermerna
    const spans = [], seen = new Set();
    strong.slice(0, 8).forEach(t => {
      const words = t.term.split(/\s+/);
      const miss = words.map(w => { const k = tTok(w); return !!k && !/\d/.test(k) && !tHas(pt, k) && !seen.has(k) && !isGeneric(k) && !otherProductWord(k, p.itemId) && !brandOf(k) && !T_GEO.has(k) && (spread[k] || 0) < 3 && supported(k); });
      const first = miss.indexOf(true), last = miss.lastIndexOf(true);
      if (first < 0 || spans.length >= 2) return;
      let start = first;
      if (start > 0 && T_JOIN.has(words[start - 1].toLowerCase())) start--;
      const span = words.slice(start, last + 1).filter(w => !T_TRANS.has(w.toLowerCase())).join(' ');
      const toks = tToks(span).filter(k => !T_WEAK.has(k));
      if (!toks.length || !toks.some(k => k.length >= 5)) return;
      toks.forEach(k => seen.add(k));
      spans.push({ text: span, toks, conv: t.conv, clicks: t.clicks, head: tToks(t.term)[0] && toks.includes(tToks(t.term)[0]) });
    });
    const best = strong[0];
    const lowerTitle = title.toLowerCase();
    let frontPos = -1;
    if (best) {
      const head = best.toks.find(w => tHas(pt, w) && !isGeneric(w) && !brandOf(w));
      const tw = title.split(/\s+/);
      let pos = 0;
      for (const w of tw) { if (tTok(w) && tSame(tTok(w), head || '')) { frontPos = pos; break; } pos += w.length + 1; }
    }
    // Varumärken i söktermerna som inte får användas i titeln
    const ownTitleBrands = brandsIn(title).filter(b => !ownBrand(b) && !T_COMPAT.has(b));
    const brandWarnings = [];
    strong.forEach(t => brandsIn(t.term).forEach(b => {
      if (ownTitleBrands.includes(b) || ownBrand(b) || brandsIn(title).includes(b)) return;
      let w = brandWarnings.find(x => x.brand === b);
      if (!w) brandWarnings.push(w = { brand: b, alt: T_BRANDS[b] || '', terms: [] });
      if (w.terms.length < 3) w.terms.push(t.term);
    }));
    const letters = title.replace(/[^A-Za-zÅÄÖåäö]/g, ''), uppers = letters.replace(/[^A-ZÅÄÖ]/g, '');
    const isCaps = letters.length > 5 && uppers.length / letters.length >= 0.8;
    if (spans.length) issues.push(`Saknar ${spans.map(s => `"${s.text}"`).join(' och ')}, som kunderna söker på.`);
    if (frontPos > 30) issues.push('Produkttypen står för långt bak i titeln. Google visar ofta bara de första 70 tecknen.');
    if (title.length < 40) issues.push(`Titeln är kort (${title.length} tecken). Använd 70–150 tecken med produkttyp, egenskaper och storlek.`);
    if (title.length > 150) issues.push(`Titeln är för lång (${title.length} tecken). Google tillåter högst 150.`);
    if (isCaps) issues.push('Titeln är skriven med versaler, vilket Google kan underkänna.');
    if (T_PROMO.test(title)) issues.push('Titeln innehåller kampanjtext eller utropstecken, vilket bryter mot Googles riktlinjer.');
    if (ownTitleBrands.length) issues.push(`Titeln innehåller varumärket ${ownTitleBrands.map(b => `"${b}"`).join(' och ')}. Kontrollera att ni har rätt att använda det (till exempel som återförsäljare eller "passar till").`);
    brandWarnings.forEach(w => issues.push(`Varumärke: kunderna söker på "${w.brand}", men ordet är skyddat och har inte lagts till i förslaget.${w.alt ? ` Beskriv i stället vad det är, till exempel "${w.alt}".` : ' Beskriv i stället vad produkten är.'}`));
    if (!issues.length) return;
    // Kort etikett för fyndlistan
    const short = [spans.length ? 'saknar: ' + spans.map(s => s.text).join(', ') : '', frontPos > 30 ? 'produkttypen för långt bak' : '', title.length < 40 ? 'för kort' : '', title.length > 150 ? 'för lång' : '',
      isCaps ? 'versaler' : '', T_PROMO.test(title) ? 'kampanjtext' : '', brandWarnings.length ? 'varumärke i sökningar: ' + brandWarnings.map(w => w.brand).join(', ') : '', ownTitleBrands.length ? 'varumärke i titeln' : ''].filter(Boolean);
    // Bygg förslaget
    let body = isCaps ? capFirst(title.toLowerCase().split(/\s+/).map(sizeCase).join(' ')) : title;
    body = body.replace(T_PROMO, ' ').replace(/!+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    let lead = '';
    const headSpan = spans.find(s => s.head);
    // Kunderna söker på ett mer specifikt sammansatt ord än titeln använder ("fotokalender" i stället för "kalender")
    let compound = null;
    if (best && !headSpan) {
      const ht = best.toks.find(w => !/\d/.test(w) && pt.some(x => x !== w && w.length >= x.length + 3 && tSame(w, x)));
      if (ht && !pt.includes(ht) && !brandOf(ht) && linkCount(ht) <= 2 && supported(ht)) compound = ht;
    }
    if (compound) {
      issues.unshift(`Kunderna söker på "${compound}", men titeln säger bara "${pt.find(x => tSame(compound, x))}".`);
      lead = capFirst(compound);
      const ct = tToks(lead);
      body = body.split(/\s+/).filter(w => { const k = tTok(w); return !k || !ct.some(x => tSame(x, k)); }).join(' ');
    } else if (headSpan || frontPos > 30) {
      const src = headSpan ? headSpan.text : best.term;
      lead = capFirst(src.split(/\s+/).filter(w => !T_TRANS.has(w.toLowerCase()) && !brandOf(w)).map(sizeCase).join(' ').replace(/^(med|för|till|i|på|av)\s+/i, ''));
      const leadToks = tToks(lead);
      body = body.split(/\s+/).filter(w => { const k = tTok(w); return !k || !leadToks.some(x => tSame(x, k)); }).join(' ').replace(/^[–\-,\s]+|[–\-,\s]+$/g, '');
    }
    body = body.replace(/^[–\-,\s]+|[–\-,\s]+$/g, '').replace(/\s+,/g, ',');
    let sug = lead ? (body ? (/^[a-zåäö0-9]/.test(body) ? `${lead} ${body}` : `${lead} – ${body}`) : lead) : body;
    spans.filter(s => s !== headSpan).forEach(s => { sug += T_JOIN.has(s.text.split(/\s+/)[0].toLowerCase()) ? ' ' + s.text : ', ' + s.text; });
    if (sug.length > 150) sug = sug.slice(0, 150).replace(/\s+\S*$/, '');
    sug = capFirst(sug.trim());
    out.push({ itemId: p.itemId, title, suggestion: sug !== title && (spans.length || compound || frontPos > 30 || isCaps || T_PROMO.test(title)) ? sug : '', issues, short: (compound ? [`kunderna söker på "${compound}"`] : []).concat(short).join(' · '), brands: brandWarnings.concat(ownTitleBrands.map(b => ({ brand: b, alt: T_BRANDS[b] || '', own: true, terms: [] }))),
      missing: spans.map(s => s.text), terms: strong.slice(0, 3).map(t => ({ term: t.term, conv: t.conv, clicks: t.clicks })), costMonthly: p.cost * mf });
  });
  return out.sort((a, b) => (b.suggestion ? 1 : 0) - (a.suggestion ? 1 : 0) || b.costMonthly - a.costMonthly).slice(0, 50);
}
function titlesCsv(list) {
  // Tilläggsflöde i Merchant Center som ersätter titeln
  const rows = [['id', 'title']];
  list.filter(t => t.suggestion).forEach(t => rows.push([t.itemId, t.suggestion]));
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/* ---------- Uppskattad besparing ----------
   Försiktig modell utan dubbelräkning:
   - Söktermer och sökord utan konvertering är samma pengar sedda från två håll: ta det största av dem.
   - Kostnad utan konvertering: 70–100 % kan sparas. Kostnad över snittnivå: 30–60 %.
   - Kampanjnivån överlappar allt under sig: totalen blir det största av kampanjnivån och summan av detaljnivåerna. */
function estimateSavings(findings, acctCPA, acctROAS) {
  const g = { query: [0, 0], kwZero: [0, 0], kwDear: [0, 0], product: [0, 0], campaign: [0, 0] };
  const setS = (f, lo, hi, grp) => { f.saving = { low: lo, high: hi }; g[grp][0] += lo; g[grp][1] += hi; };
  findings.forEach(f => {
    const v = f.impact ? f.impact.sek || 0 : 0;
    if (!v) return;
    if (f.key === 'expensive' || f.key === 'irrelevant') setS(f, v * 0.7, v, 'query');
    else if (f.key === 'ngrams') setS(f, v * 0.6, v * 0.9, 'query');
    else if (f.key === 'ngramsCore') setS(f, v * 0.2, v * 0.5, 'kwDear');
    else if (f.key === 'kwZero') setS(f, v * 0.7, v, 'kwZero');
    else if (f.key === 'kwDear') setS(f, v * 0.3, v * 0.6, 'kwDear');
    else if (f.key === 'prodZero') setS(f, v * 0.7, v, 'product');
    else if (f.key === 'prodWeak') setS(f, v * 0.4, v * 0.8, 'product');
    else if (f.key === 'concentration' || f.key === 'campCpa') setS(f, v * 0.2, v * 0.4, 'campaign');
    else if (f.key === 'unprofitCamp') setS(f, v * 0.5, v, 'campaign');
    else if (f.key === 'unprofitProd') setS(f, v * 0.5, v, 'product');
  });
  const qLo = Math.max(g.query[0], g.kwZero[0]), qHi = Math.max(g.query[1], g.kwZero[1]);
  const detLo = qLo + g.kwDear[0] + g.product[0], detHi = qHi + g.kwDear[1] + g.product[1];
  const low = Math.max(detLo, g.campaign[0]), high = Math.max(detHi, g.campaign[1]);
  const opp = findings.filter(f => f.impact && f.impact.kind === 'opportunity');
  const missedConv = opp.reduce((s, f) => s + (f.impact.conv || 0), 0);
  return {
    low, high,
    convLow: acctCPA ? low / acctCPA : null, convHigh: acctCPA ? high / acctCPA : null,
    valueLow: acctROAS ? low * acctROAS : null, valueHigh: acctROAS ? high * acctROAS : null,
    missedConv,
    parts: [
      { label: 'Söktermer och sökord utan konvertering', low: qLo, high: qHi },
      { label: 'Dyra sökord', low: g.kwDear[0], high: g.kwDear[1] },
      { label: 'Produkter', low: g.product[0], high: g.product[1] },
      { label: 'Kampanjer över snittnivå', low: g.campaign[0], high: g.campaign[1], overlap: true }
    ].filter(p => p.high > 0)
  };
}
function fmtRange(lo, hi) {
  if (!hi) return '–';
  const a = fmtKr(lo), b = fmtKr(hi);
  return a === b ? b : a.replace(/\s?[^\d\s].*$/, '') + '–' + b;
}

/* ---------- Skriftlig analys ---------- */
function buildNarrative(c) {
  const { acct, acctCPA, campAgg, mf, findings, savings, ecom, prodMod } = c;
  const out = [];
  const q = s => `"${s}"`;
  // 1. Läget
  let p1 = acct.conv > 0 ? `Kontot har en kostnad per konvertering på ${fmtKr(acctCPA)}${ecom ? ` och ROAS ${nf2.format(acct.roas)}` : ''}, med en annonskostnad på cirka ${fmtKr(acct.cost * mf)} per månad.` : `Kontot har kostat cirka ${fmtKr(acct.cost * mf)} per månad utan registrerade konverteringar.`;
  if (campAgg.length > 1 && acct.cost > 0) {
    const top = campAgg.slice().sort((a, b) => b.cost - a.cost).slice(0, 2);
    const share = Math.round(top.reduce((s, x) => s + x.cost, 0) / acct.cost * 100);
    p1 += ` ${share} % av kostnaden går till ${top.map(x => q(x.name)).join(' och ')}.`;
  }
  const outl = findings.find(f => f.key === 'campCpa' || f.key === 'concentration');
  if (outl && outl.items[0]) {
    const cA = campAgg.find(x => x.name === outl.items[0].name);
    if (cA && acctCPA) p1 += cA.conv > 0 ? ` ${q(cA.name)} kostar ${fmtKr(cA.cost * mf)} per månad med ${fmtKr(cA.cpa)} per konvertering, ${nf1.format(cA.cpa / acctCPA).replace(',0', '')} gånger kontots snitt.` : ` ${q(cA.name)} kostar ${fmtKr(cA.cost * mf)} per månad utan konverteringar.`;
  }
  out.push({ h: 'Läget', t: p1 });
  // 2. Sökord och söktermer
  const kwz = findings.find(f => f.key === 'kwZero'), exp = findings.find(f => f.key === 'expensive'), kwd = findings.find(f => f.key === 'kwDear');
  const parts = [];
  if (exp) parts.push(`${exp.items.length} söktermer har kostat ${fmtKr(exp.impact.sek)} per månad utan konverteringar, till exempel ${exp.items.slice(0, 3).map(i => `${q(i.name)} (${i.value})`).join(', ')}.`);
  if (kwz) parts.push(`${kwz.items.length} sökord ger inga konverteringar alls, bland annat ${kwz.items.slice(0, 3).map(i => q(i.name.split(' · ')[0])).join(', ')}. De bör pausas eller begränsas till exakt matchning.`);
  if (kwd) parts.push(`${kwd.items.length} sökord konverterar men till en kostnad långt över snittet.`);
  const seas = findings.find(f => f.key === 'seasonal');
  if (seas) parts.push(`${seas.items.length} säsongssökord är undantagna från pauslistan eftersom perioden ligger utanför deras säsong.`);
  if (parts.length) out.push({ h: 'Sökord och söktermer', t: parts.join(' ') });
  // 3. Produkter
  const pz = findings.find(f => f.key === 'prodZero'), pw = findings.find(f => f.key === 'prodWeak');
  if (pz || pw) {
    const pp = [];
    if (pw) pp.push(`${pw.items.length} produkter drar ned lönsamheten, till exempel ${pw.items.slice(0, 3).map(i => `${q(i.name)} (${i.value})`).join(', ')}.`);
    if (pz) pp.push(`${pz.items.length} produkter har kostat pengar utan försäljning, bland annat ${pz.items.slice(0, 3).map(i => q(i.name)).join(', ')}.`);
    out.push({ h: 'Produkter', t: pp.join(' ') });
  }
  // 4. Budget
  const cap = findings.find(f => f.key === 'capped');
  const andList = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' och ' + a[a.length - 1] : a.join('');
  if (cap) out.push({ h: 'Budget', t: `${andList(cap.items.map(i => q(i.name)))} har bättre resultat än snittet men stoppas av budgeten. ${cap.freeText}` });
  // 5. Besparing
  if (savings.high > 0) {
    let t = `Genomförs åtgärderna i rapporten bedömer vi att ${fmtRange(savings.low, savings.high)} per månad kan sparas.`;
    if (savings.convHigh) t += ` Flyttas pengarna till kampanjer som presterar på kontots snittnivå motsvarar det cirka ${Math.round(savings.convLow)}–${Math.round(savings.convHigh)} fler konverteringar per månad.`;
    out.push({ h: 'Möjlig besparing', t });
  }
  return out;
}

/* ---------- Konkreta åtgärder per fynd ---------- */
function addTips(findings, ctx) {
  const names = f => f.items.slice(0, 3).map(i => i.name).join(', ');
  const byName = n => ctx.campAgg.find(c => c.name === n);
  const T = {
    tracking: f => [
      'Gå till Mål › Konverteringar och kontrollera att minst en åtgärd är markerad som primär och har statusen "Registrerar konverteringar".',
      'Gör ett testköp eller skicka ett testformulär och se att konverteringen syns i Google Ads inom ett dygn.',
      'Använd Google Tag Assistant på tack-sidan för att se att Google Ads-taggen faktiskt laddas.',
      'Om taggen saknas: importera konverteringar från GA4 som en snabb lösning tills taggen är på plats.'
    ],
    ctr: f => [
      `Börja med annonsgrupperna med lägst CTR (${names(f)}). Se till att det viktigaste sökordet står i rubrik 1.`,
      'Lägg till webbplatslänkar, extra information och samtalstillägg. Större annonser får fler klick.',
      'Skriv med pris, leveranstid eller garanti i annonsen. Konkreta erbjudanden slår allmänna formuleringar.',
      'Dela upp annonsgrupper med många olika sökord så att annonstexten passar sökningen bättre.'
    ],
    cvr: f => [
      'Kontrollera att varje annonsgrupp leder till den sida som bäst motsvarar sökningen, inte till startsidan.',
      'Mät mobilens laddtid med PageSpeed Insights. Sikta på under 3 sekunder.',
      'Korta ned formulär till de fält ni verkligen behöver och visa telefonnummer tydligt.',
      'Lägg förtroendesignaler nära knappen: omdömen, garantier och kända kunder.'
    ],
    cpa: f => [
      ctx.acctCPA ? `Sätt mål-CPA nära kontots nuvarande snitt (${fmtKr(ctx.acctCPA)}) i stället för att maximera konverteringar utan tak.` : 'Sätt ett mål-CPA i budstrategin i stället för att maximera konverteringar utan tak.',
      `Flytta budget från de dyraste kampanjerna (${names(f)}) till de som har lägst kostnad per konvertering.`,
      'Lägg till negativa sökord från listan i rapporten. Det är oftast det snabbaste sättet att sänka kostnaden.'
    ],
    concentration: f => [
      `Sänk dagsbudgeten med 20–30 % för ${names(f)} och flytta pengarna till kampanjer med lägre kostnad per konvertering.`,
      'Gå igenom söktermerna i just de här kampanjerna innan du ändrar något annat. Där brukar läckan sitta.',
      ctx.acctCPA ? `Om kampanjerna kör "Maximera konverteringar": lägg till ett mål-CPA runt ${fmtKr(ctx.acctCPA)}.` : 'Om kampanjerna kör "Maximera konverteringar": lägg till ett mål-CPA.'
    ],
    qs: f => [
      `Börja med sökorden med lägst kvalitetsresultat och högst kostnad (${names(f)}).`,
      'Lägg till kolumnerna Förväntad CTR, Annonsrelevans och Upplevelse av landningssida för att se vilken del som drar ned.',
      'Flytta sökorden till mindre annonsgrupper (5–15 nära besläktade sökord) med egen annonstext.',
      'Pausa sökord med kvalitetsresultat 1–3 som inte har konverterat på 90 dagar.'
    ],
    rank: f => [
      'Höj budet 10–20 % på de sökord som konverterar bäst, inte på hela kampanjen.',
      'Förbättra annonsrelevansen: sökordet i rubriken och en landningssida som matchar sökningen.',
      `Prioritera kampanjerna med störst förlust: ${names(f)}.`
    ],
    expensive: f => [
      `Ladda upp listan med negativa sökord (CSV) i Google Ads Editor. Den innehåller ${ctx.negatives.length} sökord.`,
      'Granska listan först. Ta bort sökord som faktiskt är relevanta men har haft otur under perioden.',
      'Byt bred matchning till frasmatchning för sökorden som drar in de här söktermerna.',
      'Gå igenom söktermsrapporten varje vecka de första två månaderna, sedan varje månad.'
    ],
    irrelevant: f => [
      'Lägg orden som negativa frasmatchade sökord i en delad lista (Verktyg › Delat bibliotek › Listor med negativa sökord) och koppla den till alla kampanjer.',
      'Ord som "gratis", "jobb", "själv" och "begagnat" fungerar för nästan alla som säljer tjänster eller nya produkter.',
      'Listan i rapporten är redan sorterad efter kostnad. Börja uppifrån.'
    ],
    tail: f => [
      'Byt bred matchning till frasmatchning i kampanjerna där svansen är störst.',
      'Lägg till de vanligaste orden i svansen som negativa frasmatchade sökord.',
      'Granska igen om 30 dagar och jämför andelen kostnad utan konvertering.'
    ],
    broad: f => [
      `Flytta de söktermer som konverterar till egna sökord med exakt eller frasmatchning. Börja med ${names(f)}.`,
      'Behåll bred matchning bara i kampanjer med smart budgivning och minst 30 konverteringar per månad.',
      'Pausa breda sökord som har kostat mer än två gånger kontots kostnad per konvertering utan resultat.'
    ],
    capped: f => f.items.map(i => {
      const c = byName(i.name);
      if (c && !c.budget && c.lostBudget != null) { const lb = Math.min(c.lostBudget, 0.6); return `Höj dagsbudgeten för ${i.name} med cirka ${Math.round(lb / (1 - lb) * 100 / 5) * 5} %. Kampanjen förlorar ${Math.round(c.lostBudget * 100)} % av visningarna på grund av budgeten.`; }
      if (!c || !c.budget) return `Höj dagsbudgeten för ${i.name}.`;
      const lb = c.lostBudget != null ? Math.min(c.lostBudget, 0.6) : 0.15;
      const add = Math.ceil(c.budget * lb / (1 - lb) / 10) * 10;
      return `Höj dagsbudgeten för ${i.name} från ${fmtKr(c.budget)} till cirka ${fmtKr(c.budget + add)}.`;
    }).concat(['Finansiera höjningen genom att sänka budgeten i kampanjerna som presterar sämst, så att totalen inte ökar.', 'Följ upp efter 14 dagar: kostnaden per konvertering bör ligga kvar på samma nivå.']),
    campCpa: f => [
      `Börja med ${f.items[0] ? f.items[0].name : 'den största kampanjen'}: gå igenom sökord och produkter och pausa det som drar upp kostnaden.`,
      ctx.acctCPA ? `Sätt ett mål-CPA nära kontots snitt (${fmtKr(ctx.acctCPA)}) eller ett mål-ROAS i stället för att maximera utan tak.` : 'Sätt ett mål-CPA eller mål-ROAS i stället för att maximera utan tak.',
      'Sänk dagsbudgeten 20–30 % tills kostnaden per konvertering har kommit ned.'
    ],
    kwZero: f => [
      `Pausa sökorden med "Sökord att pausa (CSV)" i Google Ads Editor. Listan innehåller ${ctx.pauseList.length} sökord.`,
      'Vill du behålla ett sökord: byt till exakt matchning och sänk budet med 30 % i stället.',
      'Kontrollera efter 30 dagar att kontots konverteringar inte har minskat.'
    ],
    kwDear: f => [
      'Sänk budet 20–30 % på de här sökorden, eller sätt ett mål-CPA på annonsgruppen.',
      'Kontrollera att landningssidan matchar sökordet. Hög kostnad per konvertering beror ofta på fel sida.',
      'Pausa de sökord som fortfarande ligger över 2,5 gånger snittet efter 30 dagar.'
    ],
    seasonal: f => [
      'Pausa inte de här sökorden nu. Jämför i stället med samma period förra året.',
      'Höj budgeten för dem cirka två veckor före säsongen och sänk efteråt.'
    ],
    prodZero: f => [
      `Ladda upp "Produkter att utesluta (CSV)" som tilläggsflöde i Merchant Center. Den sätter ${CONFIG.productLabel.column} = "${CONFIG.productLabel.value}" på ${ctx.productList.length} produkter.`,
      `Uteslut sedan etiketten i Shopping-kampanjen, eller filtrera bort den i tillgångsgruppen i Performance Max.`,
      'Alternativ: flytta produkterna till en egen kampanj med låg budget i stället för att stänga av dem helt.',
      'Kontrollera produktsidan, priset och bilden. Produkter utan försäljning har ofta ett pris- eller lagerproblem.'
    ],
    brands: f => [
      'Skriv inte varumärket i annonstext, rubriker eller produkttitlar. Varumärkesägaren kan anmäla det till Google och annonsen kan då underkännas.',
      'Beskriv i stället vad produkten är eller ser ut som, till exempel "retrobild med vit kant" i stället för "polaroid".',
      'Att visas på sökningen är oftast tillåtet. Konverterar söktermerna bra kan ni behålla dem, men undvik dynamisk infogning av sökord ({KeyWord:...}) i de annonsgrupperna.',
      'Är det en konkurrents namn (till exempel en annan fotobutik): lägg dem i en egen kampanj med egen budget, eller som negativa sökord om de inte lönar sig.',
      'Säljer ni produkten som återförsäljare eller som "passar till" (till exempel skal till iPhone) får varumärket ofta användas beskrivande. Kontrollera villkoren.'
    ],
    ngrams: f => [
      'Ladda ner listan med negativa sökord: orden ligger med som frasmatchning på kontonivå.',
      'Gå igenom orden först. Ett ord utan försäljning kan ändå vara en produkt ni säljer, men där annonsen eller produktsidan inte övertygar.',
      'Lägg orden i en delad lista med negativa sökord och koppla den till alla sök- och Shoppingkampanjer, och till Performance Max via kontots inställningar.',
      'Kör analysen igen om en månad för att se nya ord som dyker upp.'
    ],
    unprofitCamp: f => [
      'Höj mål-ROAS på kampanjerna till minst break-even, eller sänk max-CPC om de har manuell budgivning.',
      'Flytta budgeten till kampanjer som ligger över break-even och begränsas av budget.',
      'Kontrollera att konverteringsvärdet är rätt (inklusive eller exklusive moms) innan du drar slutsatser: fel värde gör ROAS missvisande.'
    ],
    unprofitProd: f => [
      `Ladda upp "Produkter att utesluta (CSV)" som tilläggsflöde; produkterna är med i filen med etiketten ${CONFIG.productLabel.column}.`,
      'Alternativ: lägg dem i en egen kampanj med mål-ROAS över break-even i stället för att utesluta dem helt.',
      'Se över pris och marginal: en produkt med låg ROAS kan bli lönsam med ett högre pris eller billigare inköp.'
    ],
    ngramsCore: f => [
      'Kontrollera att produkterna finns i lager, har konkurrenskraftigt pris och en tydlig produktbild.',
      'Sänk buden eller mål-ROAS för de här produkterna tills de börjar sälja, i stället för att stänga av dem.',
      'Gäller det Shopping: se över produkttiteln så att den matchar det kunderna faktiskt söker på.'
    ],
    kwOpp: f => [
      'Lägg till söktermerna som sökord med exakt matchning i en sökkampanj, i en annonsgrupp per tema.',
      'Skriv annonstexter som upprepar söktermen; det höjer klickfrekvensen och kvalitetsresultatet.',
      'Kommer termerna från Shopping eller Performance Max: låt dem vara kvar där, och jämför efter en månad om sökkampanjen ger fler konverteringar till samma kostnad.'
    ],
    brandSplit: f => [
      'Följ upp ROAS eller kostnad per konvertering separat för varumärke och övrigt i rapporterna.',
      'Sätt mål och budget för övriga kampanjer utifrån deras egna siffror, inte kontots snitt.',
      'Håll varumärkeskampanjen billig: exakt matchning, och negativa varumärkesord i övriga kampanjer så att de inte köper er egen trafik.'
    ],
    titles: f => [
      'Ladda upp "Optimerade titlar (CSV)" som tilläggsflöde i Merchant Center. Det ersätter titeln utan att ändra i er webbutik.',
      'Granska varje förslag först: stämmer orden med produkten, och är varumärke, storlek och färg rätt?',
      'Lägg produkttypen först, sedan viktigaste egenskapen (storlek, material, antal). Google visar oftast bara början av titeln.',
      'Jämför klickfrekvens och visningar för produkterna 30 dagar före och efter bytet.'
    ],
    prodWeak: f => [
      'Flytta produkterna till en egen kampanj eller tillgångsgrupp med högre mål-ROAS.',
      'Kontrollera marginalen: en produkt med låg ROAS kan vara lönsam om marginalen är hög, och tvärtom.',
      'Uteslut produkterna som ligger under din lönsamhetsgräns med samma etikett i Merchant Center.'
    ],
    cappedDear: f => [
      'Höj inte budgeten här ännu. Sänk först kostnaden per konvertering med negativa sökord och mål-CPA.',
      `Gäller: ${names(f)}.`
    ],
    under: f => f.items.map(i => {
      const c = byName(i.name);
      return c && c.avgDaily != null ? `Sänk dagsbudgeten för ${i.name} från ${fmtKr(c.budget)} till cirka ${fmtKr(Math.ceil(c.avgDaily * 1.2 / 10) * 10)}, nära vad den faktiskt använder.` : `Sänk dagsbudgeten för ${i.name} till vad den faktiskt använder.`;
    }).concat(['Flytta den frigjorda budgeten till kampanjer som stoppas av budgeten och har bra resultat.'])
  };
  const wowTips = f => [
    f.items[0] ? `Öppna Ändringshistorik för ${f.items[0].name} och se vad som ändrats de senaste 14 dagarna: bud, budget, annonser eller sökord.` : 'Öppna Ändringshistorik och se vad som ändrats de senaste 14 dagarna.',
    'Segmentera på enhet och veckodag för att se om förändringen sitter i en viss del av trafiken.',
    'Titta i Auktionsinsikter om en ny konkurrent har dykt upp.',
    'Kontrollera att konverteringsspårningen fortfarande fungerar om antalet konverteringar har sjunkit kraftigt.'
  ];
  findings.forEach(f => { f.tips = (T[f.key] ? T[f.key](f) : f.key && f.key.startsWith('wow-') ? wowTips(f) : []).filter(Boolean); });
}

/* ---------- Filer för nedladdning ---------- */
function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function negativesCsv(negs) {
  // Google Ads Editor: Konto › Importera › Från fil. Kampanjnivå, tom annonsgrupp.
  const rows = [['Campaign', 'Ad group', 'Keyword', 'Criterion Type']];
  negs.forEach(n => rows.push([n.campaign, '', n.keyword, n.match === 'exact' ? 'Campaign Negative Exact' : 'Campaign Negative Phrase']));
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function matchToEditor(mt) {
  mt = String(mt || '').toLowerCase();
  return /(exact|exakt)/.test(mt) ? 'Exact' : /(phrase|fras)/.test(mt) ? 'Phrase' : 'Broad';
}
function pauseKeywordsCsv(list) {
  // Google Ads Editor: Konto › Importera › Från fil. Sätter status Pausad på befintliga sökord.
  const rows = [['Campaign', 'Ad group', 'Keyword', 'Criterion Type', 'Status']];
  list.forEach(k => rows.push([k.campaign, k.adGroup, String(k.keyword).replace(/^[\["]|[\]"]$/g, ''), matchToEditor(k.matchType), 'Paused']));
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function productsCsv(list) {
  // Tilläggsflöde i Merchant Center: id + anpassad etikett
  const rows = [['id', CONFIG.productLabel.column]];
  list.forEach(p => rows.push([p.itemId, CONFIG.productLabel.value]));
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function negativesPasteList(negs) {
  // För att klistra in i en delad lista med negativa sökord i Google Ads
  return [...new Set(negs.map(n => n.match === 'exact' ? `[${n.keyword}]` : `"${n.keyword}"`))].join('\n');
}

function scoreFrom(fs, start) {
  let s = start;
  fs.forEach(f => { s -= f.sev === 'crit' ? 30 : f.sev === 'warn' ? 12 : 3; });
  return Math.round(clamp(s, 5, 100));
}
function verdictFor(s) {
  if (s == null) return null;
  if (s >= 80) return { key: 'pass', label: 'Godkänd', text: 'Kontot är i gott skick. Några justeringar kan ändå ge mer.' };
  if (s >= 55) return { key: 'remarks', label: 'Godkänd med anmärkningar', text: 'Kontot fungerar, men det finns brister som kostar pengar varje månad.' };
  if (s >= 30) return { key: 'fail', label: 'Underkänd – ombesiktning', text: 'Flera fel påverkar resultatet. De bör åtgärdas innan budgeten höjs.' };
  return { key: 'ban', label: 'Körförbud', text: 'Allvarliga fel. Annonspengarna arbetar i dag till stor del i onödan.' };
}

/* ---------- Format ---------- */
const nf0 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
let CUR_SUFFIX = ' kr';
function setCurrency(c) { CUR_SUFFIX = ({ SEK: ' kr', NOK: ' kr', DKK: ' kr', EUR: ' €', USD: ' $', GBP: ' £' })[c] || ' ' + c; }
function fmtKr(v) { if (v == null || isNaN(v)) return '–'; const a = Math.abs(v); return (a >= 100 ? nf0.format(Math.round(v / (a >= 10000 ? 100 : 10)) * (a >= 10000 ? 100 : 10)) : a >= 10 ? nf0.format(v) : nf2.format(v)) + CUR_SUFFIX; }
function fmtPct(v) { return v == null || isNaN(v) ? '–' : nf1.format(v) + ' %'; }
function fmtDelta(v) { if (v == null || isNaN(v)) return '–'; return (v > 0 ? '+' : v < 0 ? '−' : '±') + nf0.format(Math.abs(Math.round(v))) + ' %'; }

/* ---------- Exempeldata (fiktivt renoveringsföretag i Stockholm) ---------- */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
/* Exempeldata för e-handel (fiktiv fotobutik) */
function sampleFilesEcom(endIso) {
  const R = mulberry32(7);
  const n = v => nf2.format(v).replace(/ /g, ' ');
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  const L = dnum(endIso), days = 35, F = L - days + 1;
  const svMon = ['jan.', 'feb.', 'mars', 'apr.', 'maj', 'juni', 'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'];
  const svDate = d => `${+d.slice(8, 10)} ${svMon[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
  const C = [
    { name: 'Shopping | Alla produkter', type: 'Shopping', spend: 900, cpc: 4.2, ctr: 1.4, cvr: 3.1, aov: 420, lb: 0.18, lr: 0.35 },
    { name: 'PMax | Fotoböcker', type: 'Performance Max', spend: 750, cpc: 5.1, ctr: 1.1, cvr: 3.6, aov: 510, lb: 0.0, lr: null },
    { name: 'Sök | Varumärke', type: 'Sök', spend: 120, cpc: 1.6, ctr: 24, cvr: 14, aov: 460, lb: 0, lr: 0.04 },
    { name: 'Sök | Presenter', type: 'Sök', spend: 650, cpc: 7.8, ctr: 4.2, cvr: 0.9, aov: 330, lb: 0, lr: 0.48, drift: true }
  ];
  let camp = `Kampanjrapport\n${svDate(dstr(F))} - ${svDate(endIso)}\nDag,Kampanj,Kampanjstatus,Kampanjtyp,Valutakod,Visningar,Klick,Kostnad,Konverteringar,Konv.värde,Förlorad exponeringsandel i sökningen (budget),Förlorad exponeringsandel i sökningen (rankning)\n`;
  for (let d = F; d <= L; d++) {
    const late = d > L - 7;
    for (const c of C) {
      let cost = c.spend * (0.85 + R() * 0.3) * (c.drift && late ? 1.25 : 1);
      const clicks = Math.max(1, Math.round(cost / (c.cpc * (0.9 + R() * 0.2))));
      const impr = Math.round(clicks / (c.ctr / 100) * (0.9 + R() * 0.2));
      let conv = 0; for (let i = 0; i < clicks; i++) if (R() < (c.drift && late ? c.cvr * 0.6 : c.cvr) / 100) conv++;
      const value = conv * c.aov * (0.8 + R() * 0.4);
      camp += [q(dstr(d)), q(c.name), 'Aktiv', q(c.type), 'SEK', impr, clicks, q(n(cost)), q(n(conv)), q(n(value)), c.lr == null ? '--' : q(n(Math.max(0, c.lb + (R() - 0.5) * 0.06) * 100) + ' %'), c.lr == null ? '--' : q(n(Math.max(0, c.lr + (R() - 0.5) * 0.08) * 100) + ' %')].join(',') + '\n';
    }
  }
  const T = [
    ['fotobok a4', 'PMax | Fotoböcker', 2900, 690, 31],
    ['fotobok inbunden', 'PMax | Fotoböcker', 1850, 440, 17],
    ['skapa fotobok', 'PMax | Fotoböcker', 1600, 380, 12],
    ['fotobok liggande 30x30', 'PMax | Fotoböcker', 900, 210, 8],
    ['fotokalender 2027', 'Shopping | Alla produkter', 2100, 500, 22],
    ['väggkalender med egna bilder', 'Shopping | Alla produkter', 1300, 310, 9],
    ['canvastavla 50x70', 'Shopping | Alla produkter', 1700, 405, 11],
    ['fototavla canvas', 'Shopping | Alla produkter', 980, 233, 6],
    ['fotomugg', 'Shopping | Alla produkter', 760, 181, 7],
    ['mugg med bild', 'Shopping | Alla produkter', 640, 152, 6],
    ['pussel med egen bild 1000 bitar', 'Shopping | Alla produkter', 820, 195, 7],
    ['julkort med foto', 'Shopping | Alla produkter', 520, 124, 2],
    ['polaroid bilder med vit kant', 'Shopping | Alla produkter', 690, 160, 5],
    ['cewe fotobok', 'PMax | Fotoböcker', 480, 115, 3],
    ['presenttips till pappa', 'Sök | Presenter', 2400, 307, 0],
    ['present till mamma', 'Sök | Presenter', 1900, 243, 1],
    ['personlig present', 'Sök | Presenter', 1500, 192, 1],
    ['fotobok gratis', 'PMax | Fotoböcker', 560, 133, 0],
    ['hur gör man en fotobok', 'PMax | Fotoböcker', 420, 100, 0],
    ['fotohörnan', 'Sök | Varumärke', 900, 560, 75]
  ];
  let st = `Sökterm-rapport\n${svDate(dstr(F))} - ${svDate(endIso)}\nSökterm,Söktermens matchningstyp,Kampanj,Valutakod,Visningar,Klick,Kostnad,Konverteringar,Konv.värde\n`;
  T.forEach(([t, cmp, cost, clicks, conv]) => { st += [q(t), q('Bred matchning'), q(cmp), 'SEK', clicks * 40, clicks, q(n(cost)), q(n(conv)), q(n(conv * 450))].join(',') + '\n'; });
  const P = [
    ['fb-a4-premium', 'Premium Book A4', 'PMax | Fotoböcker', 8400, 34, 17800],
    ['fb-30x30-l', 'Fotobok Liggande 30x30 hårda pärmar med glansigt papper och 40 sidor som du anpassar själv', 'PMax | Fotoböcker', 5200, 19, 10400],
    ['kal-a3-2027', 'Kalender 2027', 'Shopping | Alla produkter', 6100, 28, 8900],
    ['cv-50x70', 'CANVAS 50x70 PREMIUM KVALITET!!', 'Shopping | Alla produkter', 4800, 12, 6600],
    ['mug-330', 'Mugg vit 330ml', 'Shopping | Alla produkter', 2600, 13, 3100],
    ['pz-1000', 'Pussel', 'Shopping | Alla produkter', 2300, 7, 2800],
    ['jk-10', 'Julkort 10-pack, gratis frakt', 'Shopping | Alla produkter', 1500, 2, 900],
    ['nyckelring-akryl', 'Nyckelring i akryl med foto', 'Shopping | Alla produkter', 900, 0, 0],
    ['tygpase-bild', 'Tygpåse med eget tryck', 'Shopping | Alla produkter', 760, 0, 0],
    ['kudde-40', 'Kudde 40x40 med foto', 'Shopping | Alla produkter', 3900, 3, 1100]
  ];
  let pr = `Produktrapport\n${svDate(dstr(F))} - ${svDate(endIso)}\nArtikel-id,Produkttitel,Kampanj,Valutakod,Visningar,Klick,Kostnad,Konverteringar,Konv.värde\n`;
  P.forEach(([id, t, cmp, cost, conv, val]) => { const clicks = Math.round(cost / 4.6); pr += [q(id), q(t), q(cmp), 'SEK', clicks * 60, clicks, q(n(cost)), q(n(conv)), q(n(val))].join(',') + '\n'; });
  return [{ name: 'kampanjer_per_dag.csv', text: camp }, { name: 'söktermer.csv', text: st }, { name: 'produkter.csv', text: pr }];
}

function sampleFiles(endIso) {
  const R = mulberry32(42);
  const svMon = ['jan.', 'feb.', 'mars', 'apr.', 'maj', 'juni', 'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'];
  const svDate = d => `${+d.slice(8, 10)} ${svMon[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
  const n = v => nf2.format(v).replace(/ /g, ' ');
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  const L = dnum(endIso), days = 35, F = L - days + 1;
  const C = [
    { name: 'Sök | Badrumsrenovering | Stockholm', type: 'Sök', budget: 600, spend: 1, cpc: 44, ctr: 7.8, cvr: 9.5, lb: 0.31, lr: 0.18 },
    { name: 'Sök | Köksrenovering', type: 'Sök', budget: 500, spend: 0.74, cpc: 56, ctr: 5.1, cvr: 4.2, lb: 0.0, lr: 0.46, drift: true },
    { name: 'Sök | Varumärke', type: 'Sök', budget: 150, spend: 0.38, cpc: 7, ctr: 21, cvr: 21, lb: 0, lr: 0.05 },
    { name: 'PMax | Alla tjänster', type: 'Performance Max', budget: 700, spend: 0.97, cpc: 17, ctr: 1.6, cvr: 3.4, lb: 0.04, lr: null },
    { name: 'Sök | Golvläggning – bred', type: 'Sök', budget: 400, spend: 0.96, cpc: 38, ctr: 3.9, cvr: 1.1, lb: 0.0, lr: 0.52 },
    { name: 'Sök | Fasadmålning', type: 'Sök', budget: 300, spend: 0.32, cpc: 31, ctr: 5.6, cvr: 7.2, lb: 0, lr: 0.41 }
  ];
  let camp = `Kampanjrapport\n${svDate(dstr(F))} - ${svDate(endIso)}\nDag,Kampanj,Kampanjstatus,Kampanjtyp,Budget,Valutakod,Visningar,Klick,Kostnad,Konverteringar,Konv.värde,Förlorad exponeringsandel i sökningen (budget),Förlorad exponeringsandel i sökningen (rankning)\n`;
  for (let d = F; d <= L; d++) {
    const late = d > L - 7;
    for (const c of C) {
      const wk = [0.92, 1.05, 1.08, 1.04, 0.98, 0.86, 0.8][new Date(d * 864e5).getUTCDay()];
      let cost = c.budget * c.spend * wk * (0.88 + R() * 0.2);
      if (c.spend >= 0.95) cost = Math.min(cost, c.budget * 1.15);
      let cvr = c.cvr, cpc = c.cpc;
      if (c.drift && late) { cvr *= 0.4; cpc *= 1.15; cost *= 1.3; }
      if (c.name.includes('Badrum') && late) cvr *= 0.7;
      if (c.name.includes('Golv') && late) cost *= 1.3;
      const clicks = Math.max(1, Math.round(cost / (cpc * (0.9 + R() * 0.2))));
      const impr = Math.round(clicks / (c.ctr / 100) * (0.9 + R() * 0.2));
      let conv = 0; for (let i = 0; i < clicks; i++) if (R() < cvr / 100) conv++;
      camp += [q(dstr(d)), q(c.name), 'Aktiv', q(c.type), q(n(c.budget)), 'SEK', impr, clicks, q(n(cost)), q(n(conv)), q(n(conv * 0)), c.lr == null ? '--' : q(n(Math.max(0, c.lb + (R() - 0.5) * 0.08) * 100) + ' %'), c.lr == null ? '--' : q(n(Math.max(0, c.lr + (R() - 0.5) * 0.1) * 100) + ' %')].join(',') + '\n';
    }
  }
  camp += `Totalt: Konto,--,--,--,--,--,--,--,--,--,--,--,--\n`;

  const T = [
    ['badrumsrenovering stockholm', 'Sök | Badrumsrenovering | Stockholm', 'Exakt matchning', 9800, 31],
    ['renovera badrum pris', 'Sök | Badrumsrenovering | Stockholm', 'Frasmatchning', 6400, 17],
    ['badrumsrenovering', 'Sök | Badrumsrenovering | Stockholm', 'Frasmatchning', 4900, 14],
    ['totalrenovering badrum kostnad', 'Sök | Badrumsrenovering | Stockholm', 'Bred matchning', 1850, 3],
    ['gratis badrumsritning', 'Sök | Badrumsrenovering | Stockholm', 'Bred matchning', 690, 0],
    ['hur lägger man klinker i badrum', 'Sök | Badrumsrenovering | Stockholm', 'Bred matchning', 540, 0],
    ['badrumsmöbler begagnat blocket', 'Sök | Badrumsrenovering | Stockholm', 'Bred matchning', 310, 0],
    ['köksrenovering stockholm', 'Sök | Köksrenovering', 'Exakt matchning', 4200, 6],
    ['nytt kök pris', 'Sök | Köksrenovering', 'Frasmatchning', 2900, 3],
    ['ikea kök montering själv', 'Sök | Köksrenovering', 'Bred matchning', 1650, 0],
    ['vad kostar ett nytt kök', 'Sök | Köksrenovering', 'Bred matchning', 1320, 0],
    ['köksluckor', 'Sök | Köksrenovering', 'Bred matchning', 1180, 0],
    ['kök mall pdf', 'Sök | Köksrenovering', 'Bred matchning', 260, 0],
    ['renoveringsfirma', 'Sök | Varumärke', 'Bred matchning', 380, 2],
    ['golvläggare stockholm', 'Sök | Golvläggning – bred', 'Bred matchning', 2650, 2],
    ['golvläggare lön', 'Sök | Golvläggning – bred', 'Bred matchning', 1460, 0],
    ['lediga jobb snickare stockholm', 'Sök | Golvläggning – bred', 'Bred matchning', 1290, 0],
    ['laminatgolv billigt', 'Sök | Golvläggning – bred', 'Bred matchning', 1940, 0],
    ['lägga parkett själv', 'Sök | Golvläggning – bred', 'Bred matchning', 1720, 0],
    ['golvslipning', 'Sök | Golvläggning – bred', 'Bred matchning', 1580, 1],
    ['vinylgolv', 'Sök | Golvläggning – bred', 'Bred matchning', 1210, 0],
    ['fasadmålning pris', 'Sök | Fasadmålning', 'Frasmatchning', 1900, 3],
    ['måla fasad själv', 'Sök | Fasadmålning', 'Bred matchning', 470, 0],
    ['fasadfärg', 'Sök | Fasadmålning', 'Bred matchning', 610, 0]
  ];
  const tail = ['badrum inspiration', 'kakel badrum', 'golvbrunn', 'duschvägg', 'kök vitt', 'bänkskiva', 'golvlist', 'parkett ek', 'fasad trä', 'tapet kök', 'kakelfog', 'badkar', 'köksö', 'golvvärme', 'takmålning', 'innerdörrar', 'garderob', 'trappa'];
  let st = `Sökterm-rapport\n${svDate(dstr(F + 5))} - ${svDate(endIso)}\nSökterm,Söktermens matchningstyp,Kampanj,Annonsgrupp,Valutakod,Visningar,Klick,Kostnad,Konverteringar\n`;
  for (const [t, cmp, mt, cost, conv] of T) { const clicks = Math.round(cost / 40); st += [q(t), q(mt), q(cmp), q('Allmänt'), 'SEK', Math.round(clicks * 16), clicks, q(n(cost)), q(n(conv))].join(',') + '\n'; }
  tail.forEach((t, i) => { const cost = 90 + R() * 80; st += [q(t), q('Bred matchning'), q(C[i % 5].name), q('Allmänt'), 'SEK', 40, Math.round(cost / 40), q(n(cost)), q(n(0))].join(',') + '\n'; });

  const K = [
    ['badrumsrenovering stockholm', 'Exakt matchning', 8, 'Sök | Badrumsrenovering | Stockholm', 11200, 33],
    ['renovera badrum', 'Frasmatchning', 7, 'Sök | Badrumsrenovering | Stockholm', 9600, 25],
    ['badrum', 'Bred matchning', 4, 'Sök | Badrumsrenovering | Stockholm', 3100, 3],
    ['köksrenovering', 'Exakt matchning', 6, 'Sök | Köksrenovering', 5200, 7],
    ['kök', 'Bred matchning', 3, 'Sök | Köksrenovering', 7400, 2],
    ['golvläggning', 'Bred matchning', 3, 'Sök | Golvläggning – bred', 6900, 2],
    ['golv', 'Bred matchning', 2, 'Sök | Golvläggning – bred', 4700, 0],
    ['parkett', 'Bred matchning', 3, 'Sök | Golvläggning – bred', 2300, 1],
    ['fasadmålning', 'Frasmatchning', 7, 'Sök | Fasadmålning', 3100, 3],
    ['renoveringsfirma', 'Exakt matchning', 9, 'Sök | Varumärke', 1900, 8]
  ];
  let kw = `Sökordsrapport\n${svDate(dstr(F + 5))} - ${svDate(endIso)}\nSökord,Matchningstyp,Kampanj,Annonsgrupp,Kvalitetsresultat,Valutakod,Visningar,Klick,Kostnad,Konverteringar\n`;
  for (const [k, mt, qs, cmp, cost, conv] of K) { const clicks = Math.round(cost / 42); kw += [q(k), q(mt), q(cmp), q('Allmänt'), qs, 'SEK', clicks * 15, clicks, q(n(cost)), q(n(conv))].join(',') + '\n'; }
  return [
    { name: 'kampanjer_per_dag.csv', text: camp },
    { name: 'söktermer.csv', text: st },
    { name: 'sökord.csv', text: kw }
  ];
}

export { readReport, analyze, sampleFiles, sampleFilesEcom, num, pdate, decodeBuffer, BENCH, CONFIG, fmtKr, fmtPct, fmtRange, fmtDelta, nf0, nf2, setCurrency, matchToEditor, negativesCsv, negativesPasteList, pauseKeywordsCsv, productsCsv, titlesCsv, buildTitleSuggestions };
