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
