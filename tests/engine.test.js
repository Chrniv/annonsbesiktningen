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
