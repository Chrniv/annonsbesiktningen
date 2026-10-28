import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/stats.js';
import * as E from '../src/engine.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const poissonExact = (k, l) => { let s = 0, t = Math.exp(-l); for (let i = 0; i <= k; i++) { s += t; t *= l / (i + 1); } return s; };

test('poissonCdf stämmer med exakt summa', () => {
  for (const [k, l] of [[0, 1.5], [0, 3], [1, 3], [2, 1.5], [5, 4.5], [10, 8], [40, 30]]) near(S.poissonCdf(k, l), poissonExact(k, l), 1e-9);
  assert.equal(S.poissonCdf(3, 0), 1);
  // Delade konverteringar: värdet ligger mellan grannarna
  const mid = S.poissonCdf(0.5, 2);
  assert.ok(mid > S.poissonCdf(0, 2) && mid < S.poissonCdf(1, 2));
});

test('risken att det är otur och tröskeln hänger ihop', () => {
  // 0 konverteringar för 3 gånger snitt-CPA: e^-3 ≈ 5 %
  near(S.badLuckChance(300, 0, 100), Math.exp(-3));
  const thr = S.minCostWithoutConversion(100, 0.15);
  near(S.badLuckChance(thr, 0, 100), 0.15);
  assert.equal(S.confidenceTier(0.03, { sureLevel: 0.05, flagLevel: 0.15 }), 'hög');
  assert.equal(S.confidenceTier(0.10, { sureLevel: 0.05, flagLevel: 0.15 }), 'medel');
  assert.equal(S.confidenceTier(0.30, { sureLevel: 0.05, flagLevel: 0.15 }), null);
  assert.equal(S.certaintyText(0), '99 % säkert');
});

test('krympning: lite data dras mot snittet, mycket data gör det inte', () => {
  // 1 konvertering för 300 kr (CPA 300) när snittet är 100: med en konvertering i bagaget blir det 200
  near(S.shrunkCpa(300, 1, 100, 1), 200);
  // 100 konverteringar för 30 000 kr: knappt någon skillnad
  assert.ok(Math.abs(S.shrunkCpa(30000, 100, 100, 1) - 300) < 3);
  // Merkostnaden efter krympning är aldrig större än den råa
  assert.ok(S.shrunkExcess(900, 2, 100, 1) < 900 - 2 * 100);
  assert.ok(S.shrunkExcess(900, 2, 100, 1) > 0);
  // Andel: 2 av 10 klick när snittet är 5 % hamnar nära 5 %, inte 20 %
  assert.ok(S.shrunkRate(2, 10, 0.05, 1) < 0.11);
});

test('sannolikhet att vara bättre än snittet', () => {
  // 2 konverteringar till halva snittpriset: troligen tur
  assert.ok(S.probBetter(100, 2, 100, 1) < 0.8);
  // 20 konverteringar till halva snittpriset: troligen på riktigt
  assert.ok(S.probBetter(1000, 20, 100, 1) > 0.95);
  // Exakt på snittet med mycket data: runt 50 %
  assert.ok(Math.abs(S.probBetter(100000, 1000, 100, 1) - 0.5) < 0.05);
});

/* ---------- Motorn ---------- */
// Kampanjrapport: 30 dagar, 1 000 kr och 10 konverteringar per dag => snitt-CPA 100 kr
const CAMP = 'Campaign,Day,Clicks,Impr.,Currency code,Cost,Conversions\n' + Array.from({ length: 30 }, (_, i) => `Shop,2026-09-${String(i + 1).padStart(2, '0')},200,2000,SEK,1000,10`).join('\n');
const terms = rows => 'Search term,Campaign,Currency code,Clicks,Impr.,Cost,Conversions\n' + rows.map(r => r.join(',')).join('\n');
const run = (...files) => E.analyze(files.map(([n, t]) => E.readReport(n, t)), { industry: 'home' });

test('söktermer utan konvertering flaggas efter risk, med säkerhet', () => {
  const r = run(['c.csv', CAMP], ['t.csv', terms([
    ['fotobok liggande', 'Shop', 'SEK', 400, 4000, 40000, 400],
    ['liten sökterm', 'Shop', 'SEK', 20, 200, 120, 0],     // 1,2 konv. väntat: 30 % risk att det är otur
    ['mellan sökterm', 'Shop', 'SEK', 30, 300, 220, 0],    // 2,2 väntat: 11 % risk
    ['stor sökterm', 'Shop', 'SEK', 60, 600, 400, 0]       // 4 väntat: 2 % risk
  ])]);
  const f = r.findings.find(x => x.key === 'expensive');
  const names = f.items.map(i => i.name);
  assert.ok(!names.includes('liten sökterm'), 'för lite data för att döma');
  assert.ok(names.includes('mellan sökterm') && names.includes('stor sökterm'));
  assert.match(f.items.find(i => i.name === 'stor sökterm').value, /98 % säkert/);
  const neg = n => r.negatives.find(x => x.keyword === n);
  assert.equal(neg('stor sökterm').confidence, 'hög');
  assert.equal(neg('mellan sökterm').confidence, 'medel');
});

test('irrelevanta mönster får ingen statistisk säkerhet', () => {
  const r = run(['c.csv', CAMP], ['t.csv', terms([['fotobok', 'Shop', 'SEK', 400, 4000, 40000, 400], ['lediga jobb fotograf', 'Shop', 'SEK', 3, 30, 20, 0]])]);
  const n = r.negatives.find(x => x.keyword === 'lediga jobb');
  assert.ok(n, 'mönstret blir negativt sökord');
  assert.equal(n.confidence, null);
});

test('tursamma söktermer föreslås inte som nya sökord, riktiga vinnare gör det', () => {
  const lucky = ['tur alfa', 'tur beta', 'tur gamma'].map(t => [t, 'Shop', 'SEK', 10, 100, 100, 2]);       // CPA 50 på 2 konv.
  const real = ['vinnare alfa', 'vinnare beta', 'vinnare gamma'].map(t => [t, 'Shop', 'SEK', 100, 1000, 1000, 20]); // CPA 50 på 20 konv.
  const onlyLucky = run(['c.csv', CAMP], ['t.csv', terms(lucky)]);
  assert.ok(!onlyLucky.findings.some(f => f.key === 'kwOpp'), 'två konverteringar räcker inte');
  const both = run(['c.csv', CAMP], ['t.csv', terms([...lucky, ...real])]);
  const f = both.findings.find(x => x.key === 'kwOpp');
  assert.ok(f, 'vinnarna föreslås');
  assert.deepEqual(f.items.map(i => i.name).sort(), ['vinnare alfa', 'vinnare beta', 'vinnare gamma']);
  assert.ok(f.items.every(i => i.pBetter >= 0.8));
});

test('dyra sökord: slump flaggas inte, merkostnaden krymps', () => {
  const kw = 'Keyword,Campaign,Ad group,Match type,Clicks,Impr.,Cost,Conversions\n' + [
    'dyr men osäker,Shop,AG,Exact,30,300,300,1',   // CPA 300 men bara 1 konvertering: 20 % risk att det är otur
    'dyr och säker,Shop,AG,Exact,90,900,900,2',     // CPA 450 på 900 kr: under 1 % risk
    'bra sökord,Shop,AG,Exact,2000,20000,20000,250'
  ].join('\n');
  const r = run(['c.csv', CAMP], ['k.csv', kw]);
  const f = r.findings.find(x => x.key === 'kwDear');
  assert.ok(f);
  assert.deepEqual(f.items.map(i => i.name.split(' · ')[0]), ['dyr och säker']);
  // Rå merkostnad 900 − 2 × 100 = 700 kr; efter krympning lägre
  const mf = 30.4 / 30;
  assert.ok(f.impact.sek < 700 * mf && f.impact.sek > 500 * mf, String(f.impact.sek));
  const pk = r.pauseKeywords.find(k => k.keyword === 'dyr och säker');
  assert.equal(pk.confidence, 'hög');
});

test('för lite data: tydlig notering med föreslagen period', () => {
  // 30 dagar, 70 kr och 0,2 konverteringar per dag => 6 konverteringar totalt
  const small = 'Campaign,Day,Clicks,Impr.,Currency code,Cost,Conversions\n' + Array.from({ length: 30 }, (_, i) => `Shop,2026-09-${String(i + 1).padStart(2, '0')},10,100,SEK,70,${i % 5 === 0 ? 1 : 0}`).join('\n');
  const dq = run(['c.csv', small]).dataQuality;
  assert.equal(dq.level, 'verylow');
  assert.equal(dq.daysNeeded, 150, '30 konverteringar i takten 6 per 30 dagar');
  assert.match(dq.text, /2\s100\skr/);
  assert.match(dq.advice, /150 dagarna/);
  // Mellanläge: 20 konverteringar
  const mid = 'Campaign,Day,Clicks,Impr.,Currency code,Cost,Conversions\n' + Array.from({ length: 20 }, (_, i) => `Shop,2026-09-${String(i + 1).padStart(2, '0')},50,500,SEK,300,1`).join('\n');
  assert.equal(run(['c.csv', mid]).dataQuality.level, 'low');
  // Stort konto: ingen notering
  assert.equal(run(['c.csv', CAMP]).dataQuality.level, 'ok');
  // Mycket liten budget: inte ens ett år räcker
  const tiny = 'Campaign,Day,Clicks,Impr.,Currency code,Cost,Conversions\n' + Array.from({ length: 30 }, (_, i) => `Shop,2026-09-${String(i + 1).padStart(2, '0')},3,30,SEK,10,${i === 0 ? 1 : 0}`).join('\n');
  const t = run(['c.csv', tiny]).dataQuality;
  assert.equal(t.daysNeeded, null);
  assert.match(t.advice, /helt år/);
});

/* ---------- Vecka mot vecka: normalt intervall ---------- */
// 6 veckor med dagsdata (1–42 sep/okt 2026). Veckornas konverteringar läggs på blockets första dag.
const weeksCsv = convPerWeek => {
  const rows = [];
  for (let d = 0; d < convPerWeek.length * 7; d++) {
    const date = new Date(Date.UTC(2026, 8, 1 + d)).toISOString().slice(0, 10);
    rows.push(`Shop,${date},100,1000,SEK,1000,${d % 7 === 0 ? convPerWeek[Math.floor(d / 7)] : 0}`);
  }
  return 'Campaign,Day,Clicks,Impr.,Currency code,Cost,Conversions\n' + rows.join('\n');
};

test('vanlig variation flaggas inte, fast den är 20 % sämre än veckan innan', () => {
  const r = run(['c.csv', weeksCsv([21, 28, 17, 26, 23, 18])]);
  const W = r.modules.wow;
  assert.equal(W.mode, 'band');
  assert.equal(W.weeks, 5);
  const conv = W.changes.find(c => c.k === 'conv');
  assert.ok(Math.abs(conv.ref - 23) < 1e-9, 'snittet för de fem veckorna');
  assert.ok(conv.lo < 18 && conv.hi > 28);
  assert.equal(conv.outside, null);
  assert.ok(!r.findings.some(f => f.key === 'wow-conv'), 'inom det normala');
});

test('ett verkligt ras hamnar utanför intervallet och flaggas', () => {
  const r = run(['c.csv', weeksCsv([21, 28, 17, 26, 23, 5])]);
  const f = r.findings.find(x => x.key === 'wow-conv');
  assert.ok(f, 'flaggas');
  assert.equal(f.sev, 'crit');
  assert.match(f.title, /normal vecka/);
  assert.match(f.freeText, /mellan/);
});

test('med för få veckor jämförs med veckan innan och föreslår längre period', () => {
  const r = run(['c.csv', weeksCsv([21, 28, 10])]);
  const W = r.modules.wow;
  assert.equal(W.mode, 'pair');
  assert.equal(W.refLabel, 'Veckan innan');
  assert.ok(W.notes.some(n => /35 dagar/.test(n)));
  assert.ok(r.findings.some(f => f.key === 'wow-conv'), 'som tidigare: −64 % mot veckan innan');
});

test('svenska kalenderhändelser', () => {
  assert.deepEqual(E.eventsIn('2026-06-15', '2026-06-21'), ['midsommar']);
  assert.ok(E.eventsIn('2026-11-25', '2026-12-01').includes('Black Friday-helgen'));
  assert.ok(E.eventsIn('2027-03-24', '2027-03-30').includes('påsken'));
  // Lönedagen flyttas till fredagen när den 25:e är en lördag (okt 2025)
  assert.deepEqual(E.eventsIn('2025-10-24', '2025-10-24'), ['lönedagen']);
  assert.deepEqual(E.eventsIn('2025-10-25', '2025-10-25'), []);
});
