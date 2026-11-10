/*
  Ett sparat protokoll kommer från en besökares webbläsare och kan därför vara manipulerat. Innan det visas
  (adminvyn, eller efter köp) tvättas det här, så att inget i det kan bli HTML eller skript på sidan:
  - "<" och ">" i all text byts mot ‹ och ›
  - fält som sidan använder som tal blir tal (eller null)
  - fält med fasta värden (allvarlighetsgrad, valuta) måste vara ett av de tillåtna
  Sidan escapar dessutom text när den skrivs ut; det här är ett andra lås.
*/
const NUMERIC = new Set(['overall', 'score', 'crit', 'warn', 'info', 'daysLeft', 'projected', 'monthBudget', 'ratio', 'mtd', 'runRate', 'dailyBudget',
  'wasteMonthly', 'spendMonthly', 'potentialMonthly', 'missedConvMonthly', 'low', 'high', 'median', 'sek', 'conv', 'amt', 'risk', 'costMonthly', 'cost', 'clicks', 'impr',
  'you', 'bench', 'cur', 'prev', 'ref', 'delta', 'lo', 'hi', 'z', 'days', 'pct', 'weeks']);
const SEV = new Set(['crit', 'warn', 'info']);
const text = s => s.replace(/</g, '‹').replace(/>/g, '›');

export function sanitizeResult(v, key = '', depth = 0) {
  if (depth > 12) return null;
  if (v == null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    if (key === 'sev') return SEV.has(v) ? v : 'info';
    if (key === 'currency') return /^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : 'SEK';
    if (key === 'month') return /^\d{4}-\d{2}$/.test(v) ? v : '';
    if (NUMERIC.has(key)) { const n = Number(v); return Number.isFinite(n) ? n : null; }
    return text(v);
  }
  if (Array.isArray(v)) return v.map(x => sanitizeResult(x, key, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; o[text(k)] = sanitizeResult(v[k], k, depth + 1); }
    return o;
  }
  return null; // funktioner, symboler
}
