import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';

const ecom = () => E.analyze(E.sampleFilesEcom('2026-10-14').map(x => E.readReport(x.name, x.text)), { industry: 'shopping' });
const leads = () => E.analyze(E.sampleFiles('2026-10-14').map(x => E.readReport(x.name, x.text)), { industry: 'home' });

test('exempelkonton ger ett fullständigt protokoll', () => {
  for (const r of [ecom(), leads()]) {
    assert.ok(r.overall >= 0 && r.overall <= 100);
    assert.ok(r.findings.length > 3);
    assert.ok(r.findings.every(f => Array.isArray(f.tips) && f.tips.length), 'alla fynd har åtgärder');
    assert.ok(r.wasteMonthly > 0);
    assert.ok(r.negatives.length > 0);
  }
});

test('negativa sökord blir giltig CSV för Google Ads Editor', () => {
  const csv = E.negativesCsv(ecom().negatives);
  const head = csv.replace(/^﻿/, '').split('\r\n')[0];
  assert.match(head, /Campaign/);
  assert.match(head, /Criterion Type/);
});

test('titelförslag: inga ord från andra produkter, varumärken eller orter', () => {
  const r = ecom();
  for (const t of r.titleSuggestions.filter(x => x.suggestion)) {
    assert.doesNotMatch(t.suggestion, /polaroid|cewe|strumpor|ireland/i, t.suggestion);
  }
  assert.ok(r.findings.some(f => f.key === 'brands'), 'varumärkesfynd finns');
});

test('titelmotorn på en katalog med många liknande produkter', () => {
  const prods = [
    ['singlecardh', 'Single Card Landscape | smartphoto'], ['singlecardv', 'Single Card Portrait | smartphoto'],
    ['foldedcardsq', 'Folded Card Square | smartphoto'], ['playingcards', 'Playing Cards with personalised front'],
    ['apron', 'Personalised Coloured Apron Black'], ['phonecase', 'Silicone Phone Case iPhone 16 Pro | smartphoto'],
    ['retro', 'Retro Prints 10x12 with white border | smartphoto']
  ];
  const terms = [['postcards', 400, 22], ['playing cards ireland', 120, 6], ['personalised apron ireland', 150, 6], ['hairyworm phone case', 80, 4], ['polaroid prints', 400, 20]];
  const pAgg = prods.map(([itemId, title]) => ({ itemId, title, cost: 5000, conv: 20, clicks: 1000, impr: 10000, value: 6000, roas: 1.2 }));
  const sts = terms.map(([term, clicks, conv]) => ({ term, cost: clicks * 4, clicks, conv, impr: clicks * 20, value: conv * 300 }));
  const out = E.buildTitleSuggestions(pAgg, sts, 1);
  for (const t of out) assert.doesNotMatch(t.suggestion, /postcard|ireland|hairyworm|polaroid/i, `${t.itemId}: ${t.suggestion}`);
});

test('mat & dryck online jämförs med e-handelssnittet', () => {
  const r = E.analyze(E.sampleFilesEcom('2026-10-14').map(x => E.readReport(x.name, x.text)), { industry: 'grocery' });
  assert.match(r.industry, /Mat & dryck online \(jämförs med E-handel/);
});

test('CSV med svenska rubriker, komma som decimal och UTF-16 läses', () => {
  const text = 'Kampanj,Dag,Kostnad,Klick,Visningar,Konverteringar\n"Sök",2026-10-01,"1 234,50",10,100,"1,5"\n';
  const r = E.readReport('a.csv', text);
  assert.equal(r.type, 'campaigns');
  assert.equal(r.rows[0].cost, 1234.5);
  const u16 = new Uint8Array([0xff, 0xfe, ...[...'Kampanj\tKostnad\n'].flatMap(c => [c.charCodeAt(0), 0])]);
  assert.match(E.decodeBuffer(u16.buffer), /^Kampanj/);
});

test('jämförelseexport: raderna för jämförelseperioden räknas inte', () => {
  const head = 'Campaign performance\n19 September 2026 - 18 October 2026 compared to 19 September 2025 - 18 October 2025\nCampaign,Day,Clicks,Clicks (Compare to),Impr.,Currency code,Cost,Cost (Compare to),Conversions\n';
  const rows = [];
  for (let d = 19; d <= 30; d++) rows.push(`A,2026-09-${d},10,8,100,GBP,5.00,4.00,1`);
  for (let d = 19; d <= 30; d++) rows.push(`A,2025-09-${d},0,8,0,GBP,0.00,4.00,0`);
  const r = E.readReport('c.csv', head + rows.join('\n'));
  assert.equal(r.period.from, '2026-09-19');
  assert.equal(r.rows.length, 12);
});

test('fasta golv gäller i kronor, inte i kontots valuta', () => {
  // GBP-konto: en sökterm för 5 pund (≈65 kr) utan försäljning ska kunna flaggas när kostnad per konvertering är låg
  const camp = 'Campaign,Day,Clicks,Impr.,Currency code,Cost,Conversions,Conv. value\n' + Array.from({ length: 30 }, (_, i) => `Shop,2026-09-${String(i + 1).padStart(2, '0')},100,1000,GBP,30.00,10,80.00`).join('\n');
  const terms = 'Search term,Campaign,Currency code,Clicks,Impr.,Cost,Conversions,Conv. value\n' + ['photo book,Shop,GBP,50,500,20.00,8,60.00', 'free template download,Shop,GBP,12,100,5.00,0,0.00', 'something odd,Shop,GBP,15,100,6.00,0,0.00'].join('\n');
  const r = E.analyze([E.readReport('c.csv', camp), E.readReport('t.csv', terms)], { industry: 'shopping' });
  assert.ok(r.findings.some(f => f.key === 'expensive' && f.items.some(i => i.name === 'something odd')), 'sökterm för 6 £ utan försäljning flaggas');
});

test('återkommande ord: summerar små söktermer och föreslår frasnegativ', () => {
  const camp = 'Campaign,Day,Clicks,Impr.,Currency code,Cost,Conversions,Conv. value\n' + Array.from({ length: 30 }, (_, i) => `Shop,2026-09-${String(i + 1).padStart(2, '0')},100,1000,SEK,300,10,1000`).join('\n');
  const t = ['Search term,Campaign,Currency code,Clicks,Impr.,Cost,Conversions,Conv. value', 'fotobok,Shop,SEK,500,5000,8000,300,30000'];
  for (let i = 0; i < 12; i++) t.push(`morgonrock modell ${i},Shop,SEK,3,30,9,0,0`);
  const r = E.analyze([E.readReport('c.csv', camp), E.readReport('t.csv', t.join('\n'))], { industry: 'shopping' });
  const f = r.findings.find(x => x.key === 'ngrams');
  assert.ok(f, 'fynd finns');
  assert.match(f.items[0].name, /morgonrock/);
  assert.ok(r.negatives.some(n => n.keyword.includes('morgonrock') && n.match === 'phrase'));
});

test('eget varumärke känns igen från varumärkeskampanjen och flaggas inte som annans', () => {
  const camp = 'Campaign,Day,Clicks,Impr.,Currency code,Cost,Conversions,Conv. value\n' + ['[S] [B] - Brand', 'Shop'].flatMap(c => Array.from({ length: 30 }, (_, i) => `${c},2026-09-${String(i + 1).padStart(2, '0')},100,1000,SEK,100,${c === 'Shop' ? 5 : 10},${c === 'Shop' ? 500 : 2000}`)).join('\n');
  const terms = 'Search term,Campaign,Currency code,Clicks,Impr.,Cost,Conversions,Conv. value\nsmartphoto,[S] [B] - Brand,SEK,50,100,50,10,1000\nsmartphoto fotobok,[S] [B] - Brand,SEK,20,50,20,5,500\nfotobok,Shop,SEK,40,400,200,4,600\n';
  const r = E.analyze([E.readReport('c.csv', camp), E.readReport('t.csv', terms)], { industry: 'shopping' });
  assert.ok(!r.findings.some(f => f.key === 'brands' && f.items.some(i => /smartphoto/.test(i.value))));
  assert.ok(r.findings.some(f => f.key === 'brandSplit'));
});

test('marginal ger break-even-ROAS och förlustkampanjer', () => {
  const camp = 'Campaign,Day,Clicks,Impr.,Currency code,Cost,Conversions,Conv. value\n' + ['Bra', 'Dålig'].flatMap(c => Array.from({ length: 30 }, (_, i) => `${c},2026-09-${String(i + 1).padStart(2, '0')},100,1000,SEK,1000,10,${c === 'Bra' ? 5000 : 1500}`)).join('\n');
  const reps = [E.readReport('c.csv', camp)];
  assert.ok(!E.analyze(reps, { industry: 'shopping' }).findings.some(f => f.key === 'unprofitCamp'));
  const r = E.analyze(reps, { industry: 'shopping', margin: 0.5 });
  const f = r.findings.find(x => x.key === 'unprofitCamp');
  assert.ok(f && f.items.length === 1 && /Dålig/.test(f.items[0].name));
  assert.ok(r.savings.high > 0);
});

test('besparing som osäkerhetsintervall: deterministiskt, inom rimliga gränser och med rubrik', () => {
  const reps = E.sampleFilesEcom('2026-10-14').map(x => E.readReport(x.name, x.text));
  const a = E.analyze(reps, { industry: 'shopping' }), b = E.analyze(reps, { industry: 'shopping' });
  const ci = a.savings.ci;
  assert.equal(ci.level, 0.9);
  assert.deepEqual(ci, b.savings.ci, 'samma data ger samma intervall');
  assert.ok(ci.low > 0 && ci.low <= ci.median && ci.median <= ci.high);
  assert.ok(ci.high <= a.savings.planHigh + 1e-6, 'aldrig över summan av alla fynds högsta besparing');
  assert.equal(a.savings.low, ci.low);
  const h = E.savingsHeadline(a.savings, false);
  assert.match(h.lead, /^Vi är 90 % säkra på att du kan spara .+ i månaden\.$/);
});

test('osäkra fynd ger bredare intervall än säkra', () => {
  const mk = risk => [{ key: 'expensive', impact: { sek: 1000 }, saving: { low: 700, high: 1000 }, items: Array.from({ length: 10 }, () => ({ amt: 100, risk })) }];
  const sure = E.simulateSavings(mk(0.01), 1), unsure = E.simulateSavings(mk(0.4), 1);
  assert.ok(unsure.low < sure.low);
  assert.ok(sure.low > 650);
  const none = E.simulateSavings([], 1);
  assert.equal(none.high, 0);
  assert.equal(E.savingsHeadline({ ci: none }), null);
  assert.match(E.savingsHeadline({ ci: { level: 0.9, low: 0, high: 500, median: 100 } }).lead, /datan räcker inte/);
});

test('varumärkeskampanjer hålls utanför branschjämförelsen och kontots snitt', () => {
  const day = i => `2026-09-${String(i + 1).padStart(2, '0')}`;
  const camp = 'Campaign,Campaign type,Day,Clicks,Impr.,Currency code,Cost,Conversions,Conv. value\n' + [
    ...Array.from({ length: 30 }, (_, i) => `[S] [B] - Brand,Search,${day(i)},400,1000,SEK,200,40,8000`),
    ...Array.from({ length: 30 }, (_, i) => `Sök – Generiskt,Search,${day(i)},50,1000,SEK,500,2,1000`)
  ].join('\n');
  const r = E.analyze([E.readReport('c.csv', camp)], { industry: 'shopping' });
  const b = r.modules.performance.benchmark;
  assert.match(b.scope, /utan varumärke/);
  assert.ok(Math.abs(b.metrics.ctr.you - 5) < 0.01, 'CTR räknas bara på den generiska kampanjen (50/1000)');
  assert.ok(r.findings.some(f => f.key === 'ctr'), 'låg generisk CTR döljs inte längre av varumärket');
  assert.deepEqual(r.modules.performance.brandCampaigns, ['[S] [B] - Brand']);
});

test('varumärkeskampanj utan "brand" i namnet känns igen från varumärkesnamnet', () => {
  const day = i => `2026-09-${String(i + 1).padStart(2, '0')}`;
  const camp = 'Campaign,Campaign type,Day,Clicks,Impr.,Currency code,Cost,Conversions\n' + ['Sök 1', 'Sök 2'].flatMap(c => Array.from({ length: 30 }, (_, i) => `${c},Search,${day(i)},100,1000,SEK,100,5`)).join('\n');
  const terms = 'Search term,Campaign,Currency code,Clicks,Impr.,Cost,Conversions\nfotohörnan,Sök 1,SEK,500,900,400,60\nfotohörnan rabattkod,Sök 1,SEK,50,90,40,6\nfotobok,Sök 2,SEK,300,3000,900,30\n';
  const reps = [E.readReport('c.csv', camp), E.readReport('t.csv', terms)];
  assert.deepEqual(E.analyze(reps, { industry: 'shopping' }).modules.performance.brandCampaigns, []);
  assert.deepEqual(E.analyze(reps, { industry: 'shopping', brandName: 'Fotohörnan' }).modules.performance.brandCampaigns, ['Sök 1']);
});

test('jämförelseexport utan dagkolumn: perioden tas bara från före "compared to"', () => {
  const t = 'Search keyword\n4 October 2026 - 2 November 2026 compared to 4 October 2025 - 2 November 2025\nSearch keyword,Campaign,Currency code,Clicks,Impr.,Cost,Conversions\nfotobok,A,SEK,10,100,50,1\nTotal: Filtered search keywords,,SEK,10,100,50,1\n';
  const r = E.readReport('k.csv', t);
  assert.equal(r.period.from, '2026-10-04');
  assert.equal(r.filtered, true);
});

/* ---------- Kontroll mot riktiga exporter (NL-kontot, nov 2026) ---------- */
const day30 = i => `2026-10-${String(i + 1).padStart(2, '0')}`;

test('nya kolumnnamn: matchningstyp, status och kampanjtillstånd känns igen', () => {
  const k = E.readReport('k.csv', 'Search keyword,Search keyword status,Search keyword match type,Campaign,Ad group,Currency code,Clicks,Impr.,Cost,Conversions\nfotocadeau,Eligible,Phrase match,A,AG,EUR,10,100,45,0\n');
  assert.equal(k.rows[0].matchType, 'phrase match');
  assert.equal(k.rows[0].status, 'eligible');
  const c = E.readReport('c.csv', 'Campaign,Campaign state,Campaign type,Day,Clicks,Impr.,Currency code,Cost,Conversions\nA,Paused,Search,2026-10-01,1,10,EUR,1,0\n');
  assert.equal(c.rows[0].status, 'paused');
});

test('"> 90 %" läses som 90 (nedre gränsen), "< 10 %" som 5', () => {
  assert.equal(E.num('> 90%'), 90);
  assert.equal(E.num('< 10%'), 5);
});

test('kampanjrapport med bara värde/konv.: värdet räknas fram och kalibreras mot "Total: Account"', () => {
  const camp = 'Campaign,Campaign type,Day,Clicks,Impr.,Currency code,Cost,Conversions,Value / conv. (by conv. time)\n'
    + Array.from({ length: 30 }, (_, i) => `A,Search,${day30(i)},100,1000,EUR,100,5,40`).join('\n');
  const c = E.readReport('c.csv', camp);
  assert.equal(c.valueDerived, true);
  assert.equal(c.rows[0].value, 200);
  // Total: Account säger 5 400, inte 6 000: värdet skalas om
  const terms = 'Search term,Campaign,Currency code,Clicks,Impr.,Cost,Conversions,Conv. value\nx,A,EUR,1,10,1,0,0\nTotal: Account,,EUR,3000,30000,3000,150,"5,400.00"\n';
  const r = E.analyze([c, E.readReport('t.csv', terms)], { industry: 'shopping' });
  assert.ok(Math.abs(r.account.roas - 1.8) < 0.001, String(r.account.roas));
});

test('hela kontot under break-even: ett kontofynd, ingen förlustlista i besparingen', () => {
  const camp = 'Campaign,Campaign type,Day,Clicks,Impr.,Currency code,Cost,Conversions,Conv. value\n'
    + ['Sök A', 'Sök B', 'Shopping C'].flatMap(c => Array.from({ length: 30 }, (_, i) => `${c},Search,${day30(i)},100,2000,SEK,1000,10,1500`)).join('\n');
  const reps = [E.readReport('c.csv', camp)];
  const low = E.analyze(reps, { industry: 'shopping', margin: 0.4 });     // ROAS 1,5 mot break-even 2,5
  assert.ok(low.findings.some(f => f.key === 'acctUnprofit'));
  assert.ok(!low.findings.some(f => f.key === 'unprofitCamp'));
  assert.ok(low.findings.find(f => f.key === 'acctUnprofit').tips.length >= 3);
  assert.ok((low.savings.high || 0) < 1000, 'förlusten räknas inte som besparing');
  const ok = E.analyze(reps, { industry: 'shopping', margin: 0.8 });     // break-even 1,25: kontot går med vinst
  assert.ok(!ok.findings.some(f => f.key === 'acctUnprofit'));
});

test('sökterm i flera kampanjer: negativt sökord i alla, en CSV-rad per kampanj', () => {
  const camp = 'Campaign,Campaign type,Day,Clicks,Impr.,Currency code,Cost,Conversions\n'
    + ['A', 'B', 'C'].flatMap(c => Array.from({ length: 30 }, (_, i) => `${c},Search,${day30(i)},100,1000,SEK,100,5`)).join('\n');
  const terms = 'Search term,Match type,Added/Excluded,Campaign,Currency code,Clicks,Impr.,Cost,Conversions\n'
    + 'konkurrent to go,Exact,None,A,SEK,30,300,200,0\nkonkurrent to go,Exact,None,B,SEK,30,300,200,0\nkonkurrent to go,Exact,None,C,SEK,30,300,200,0\n'
    + 'redan utesluten,Exact,Excluded,A,SEK,90,900,900,0\nbra sökterm,Exact,None,A,SEK,500,5000,1000,60\n';
  const r = E.analyze([E.readReport('c.csv', camp), E.readReport('t.csv', terms)], { industry: 'shopping' });
  const n = r.negatives.find(x => x.keyword === 'konkurrent to go');
  assert.ok(n, 'föreslås');
  assert.deepEqual(n.campaigns.sort(), ['A', 'B', 'C']);
  assert.equal(n.campaign, '3 kampanjer');
  const csv = E.negativesCsv(r.negatives).split('\r\n').filter(l => l.includes('konkurrent to go'));
  assert.equal(csv.length, 3);
  assert.ok(!r.negatives.some(x => x.keyword === 'redan utesluten'), 'redan uteslutna söktermer föreslås inte igen');
  const exp = r.findings.find(f => f.key === 'expensive');
  assert.match(exp.title, /^1 sökterm har/);
});

test('sökord: matchningstyper hålls isär, pausade och borttagna räknas inte, listan sorteras på kostnad', () => {
  const camp = 'Campaign,Campaign type,Day,Clicks,Impr.,Currency code,Cost,Conversions\n'
    + Array.from({ length: 30 }, (_, i) => `A,Search,${day30(i)},300,3000,SEK,300,15`).join('\n');
  const kw = 'Search keyword,Search keyword status,Search keyword match type,Campaign,Ad group,Currency code,Clicks,Impr.,Cost,Conversions\n'
    + 'fotocadeau,Eligible,Exact match,A,AG,SEK,100,1000,900,40\n'
    + 'fotocadeau,Eligible,Phrase match,A,AG,SEK,40,400,300,0\n'
    + 'fotoalbum,Paused,Broad match,A,AG,SEK,0,0,0,0\n'
    + 'fotoalbum,Eligible,Broad match,A,AG,SEK,60,600,500,0\n'
    + 'gammalt,Paused,Broad match,A,AG,SEK,60,600,800,0\n'
    + 'bra,Eligible,Exact match,A,AG,SEK,1000,10000,7000,410\n';
  const r = E.analyze([E.readReport('c.csv', camp), E.readReport('k.csv', kw)], { industry: 'shopping' });
  const pk = r.pauseKeywords.map(k => `${k.keyword}|${k.matchType}`);
  assert.deepEqual(pk, ['fotoalbum|broad match', 'fotocadeau|phrase match']);
  const csv = E.pauseKeywordsCsv(r.pauseKeywords);
  assert.match(csv, /fotocadeau,Phrase/);
  const f = r.findings.find(x => x.key === 'kwZero');
  assert.ok(f.items.some(i => i.name.startsWith('"fotocadeau"')), 'frasmatchning visas med citattecken');
});

test('varumärkessökord bedöms mot sin egen kampanj, inte mot rent varumärke', () => {
  const camp = 'Campaign,Campaign type,Day,Clicks,Impr.,Currency code,Cost,Conversions\n' + [
    ...Array.from({ length: 30 }, (_, i) => `Search | Brand,Search,${day30(i)},400,1000,SEK,100,300`),
    ...Array.from({ length: 30 }, (_, i) => `Search | Brand + Product,Search,${day30(i)},100,1000,SEK,300,100`),
    ...Array.from({ length: 30 }, (_, i) => `Search | Generic,Search,${day30(i)},100,3000,SEK,2000,100`)
  ].join('\n');
  // Brand + Product kostar 3 kr per konvertering mot 0,33 kr för rent varumärke (1 kr i snitt): sökordet med 3,2 kr är normalt där
  const kw = 'Search keyword,Search keyword status,Search keyword match type,Campaign,Ad group,Currency code,Clicks,Impr.,Cost,Conversions\n'
    + 'butiken fotobok,Eligible,Exact match,Search | Brand + Product,AG,SEK,500,5000,1600,500\n';
  const r = E.analyze([E.readReport('c.csv', camp), E.readReport('k.csv', kw)], { industry: 'shopping' });
  assert.ok(!r.pauseKeywords.some(k => k.keyword === 'butiken fotobok'));
});

test('titelförslag: en sökterm med nya ord eller konkurrentens namn läggs aldrig först i titeln', () => {
  const prods = 'Item ID,Product title,Campaign,Clicks,Impr.,Currency code,Cost,Conversions,Conv. value\n'
    + 'agenda,Foto agenda medium | butiken - Maak een unieke fotokalender met jouw leukste foto\'s,S,200,5000,EUR,300,20,600\n'
    + 'strip,Fotostrip - Set van 5 | butiken - je mooiste foto\'s afgedrukt in hoge kwaliteit,S,200,5000,EUR,300,20,600\n'
    + 'poster,Foto poster formaat 20 x 30 | butiken - je mooiste foto\'s afgedrukt in hoge kwaliteit,S,200,5000,EUR,300,20,600\n'
    // Många andra produkter, så att "foto's" inte är ett ord som finns i nästan alla titlar
    + Array.from({ length: 30 }, (_, i) => `ovrig${i},Product number${i} model${i} variant${i},S,10,500,EUR,20,1,40`).join('\n') + '\n';
  const terms = 'Search term,Campaign,Currency code,Clicks,Impr.,Cost,Conversions,Conv. value\n'
    + 'fotos afdrukken hema,S,EUR,400,4000,300,40,800\nfoto agenda,S,EUR,50,500,50,5,100\n';
  const r = E.analyze([E.readReport('p.csv', prods), E.readReport('t.csv', terms)], { industry: 'shopping' });
  for (const t of r.titleSuggestions) assert.doesNotMatch(t.suggestion || '', /hema/i, t.suggestion);
});

test('bara produktrapport under break-even: kontofynd i stället för en lång förlustlista', () => {
  const prods = 'Item ID,Product title,Campaign,Clicks,Impr.,Currency code,Cost,Conversions,Conv. value\n'
    + Array.from({ length: 20 }, (_, i) => `p${i},Produkt nummer ${i} med lång titel för test,S,100,2000,SEK,1000,10,1500`).join('\n') + '\n';
  const r = E.analyze([E.readReport('p.csv', prods)], { industry: 'shopping', margin: 0.4 });
  assert.ok(r.findings.some(f => f.key === 'acctUnprofit'));
  assert.ok(!r.findings.some(f => f.key === 'unprofitProd'));
  assert.ok(r.findings.find(f => f.key === 'acctUnprofit').tips.length >= 3);
});
