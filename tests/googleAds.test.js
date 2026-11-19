import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import { apiReport, parseStream } from '../src/googleAds.js';

// Gör om en CSV-rapport (exempelkontona) till ett svar som Google Ads API skulle ge för samma data
const TYPE = { 'sök': 'SEARCH', search: 'SEARCH', shopping: 'SHOPPING', 'performance max': 'PERFORMANCE_MAX' };
const MATCH = { 'exakt matchning': 'EXACT', frasmatchning: 'PHRASE', 'bred matchning': 'BROAD' };
const STATUS = { aktiv: 'ENABLED', '': 'ENABLED', pausad: 'PAUSED', borttagen: 'REMOVED' };
const m = r => ({ costMicros: String(Math.round(r.cost * 1e6)), impressions: String(r.impr), clicks: String(r.clicks), conversions: r.conv, conversionsValue: r.value });
const TO_API = {
  campaigns: r => ({ campaign: { name: r.campaign, status: STATUS[r.status], advertisingChannelType: TYPE[r.type] }, campaignBudget: { amountMicros: String(Math.round(r.budget * 1e6)) }, customer: { currencyCode: 'SEK' }, segments: { date: r.date },
    metrics: { ...m(r), ...(r.lostBudget != null ? { searchBudgetLostImpressionShare: r.lostBudget } : {}), ...(r.lostRank != null ? { searchRankLostImpressionShare: r.lostRank } : {}) } }),
  searchTerms: r => ({ searchTermView: { searchTerm: r.term, status: 'NONE' }, segments: { searchTermMatchType: MATCH[r.matchType] }, campaign: { name: r.campaign }, adGroup: { name: r.adGroup }, metrics: m(r) }),
  keywords: r => ({ adGroupCriterion: { keyword: { text: r.keyword, matchType: MATCH[r.matchType] }, status: STATUS[r.status], ...(r.qs ? { qualityInfo: { qualityScore: r.qs } } : {}) }, adGroup: { name: r.adGroup, status: 'ENABLED' }, campaign: { name: r.campaign, status: 'ENABLED' }, metrics: m(r) }),
  products: r => ({ segments: { productItemId: r.itemId, productTitle: r.title }, campaign: { name: r.campaign }, metrics: m(r) })
};
// Två omgångar, som ett riktigt searchStream-svar
const asStream = results => JSON.stringify([{ results: results.slice(0, 5) }, { results: results.slice(5) }]);
const viaApi = files => files.map(f => {
  const csv = E.readReport(f.name, f.text);
  return apiReport('Google Ads · ' + csv.type, csv.type, asStream(csv.rows.map(TO_API[csv.type])), { from: csv.period.from, to: csv.period.to, currency: 'SEK' });
});
const viaCsv = files => files.map(f => E.readReport(f.name, f.text));
// Det som visas för besökaren och säljs i rapporten
const summary = r => ({
  overall: r.overall, waste: Math.round(r.wasteMonthly), spend: Math.round(r.spendMonthly), savings: r.savings, period: r.period, titles: r.titleSuggestions.length,
  findings: r.findings.map(f => [f.key, f.sev, f.title]), negatives: r.negatives.map(x => x.keyword), pause: r.pauseKeywords.map(k => k.keyword), products: (r.productExclusions || []).map(p => p.itemId)
});

test('API-data ger samma protokoll som CSV-exporterna (e-handel och tjänsteföretag)', () => {
  for (const [files, opts] of [[E.sampleFilesEcom('2026-11-18'), { industry: 'shopping', margin: 0.4 }], [E.sampleFiles('2026-11-18'), { industry: 'home' }]]) {
    const a = E.analyze(viaCsv(files), opts), b = E.analyze(viaApi(files), opts);
    assert.ok(a.findings.length > 3);
    assert.deepEqual(summary(b), summary(a));
  }
});

test('API-rapporten: mikrobelopp, typer, status, matchning och "> 90 %"', () => {
  const r = apiReport('k', 'campaigns', [{ results: [
    { campaign: { name: ' Sök | A ', status: 'PAUSED', advertisingChannelType: 'SEARCH' }, campaignBudget: { amountMicros: '150000000' }, segments: { date: '2026-11-01' }, customer: { currencyCode: 'eur' },
      metrics: { costMicros: '12345678', impressions: '100', clicks: '7', conversions: 1.5, conversionsValue: 99.5, searchBudgetLostImpressionShare: 0.9001, searchRankLostImpressionShare: 0.25 } },
    { campaign: { name: 'PMax', status: 'ENABLED', advertisingChannelType: 'PERFORMANCE_MAX' }, segments: { date: '2026-11-01' }, metrics: {} }
  ] }], { from: '2026-10-01', to: '2026-11-18' });
  const [a, b] = r.rows;
  assert.equal(r.type, 'campaigns');
  assert.equal(r.currency, 'EUR');
  assert.deepEqual(r.period, { from: '2026-10-01', to: '2026-11-18', gran: 'day' });
  assert.equal(a.campaign, 'Sök | A');
  assert.equal(a.cost, 12.345678);
  assert.equal(a.budget, 150);
  assert.equal(a.status, 'paused');
  assert.equal(a.lostBudget, 0.9, 'över 90 % blir 90 %, som i exporten');
  assert.equal(b.type, 'performance max');
  assert.equal(b.lostRank, null, 'saknas för PMax');
  assert.equal(b.cost, 0);

  const t = apiReport('t', 'searchTerms', [{ results: [
    { searchTermView: { searchTerm: 'fotobok', status: 'EXCLUDED' }, segments: { searchTermMatchType: 'NEAR_PHRASE' }, campaign: { name: 'A' }, adGroup: { name: 'G' }, metrics: { clicks: '3' } },
    { searchTermView: { searchTerm: '', status: 'NONE' }, metrics: {} }
  ] }], {});
  assert.equal(t.rows.length, 1, 'rader utan sökterm tas bort');
  assert.equal(t.rows[0].matchType, 'phrase match (close variant)');
  assert.equal(t.rows[0].added, 'excluded');

  const k = apiReport('s', 'keywords', [{ results: [
    { adGroupCriterion: { keyword: { text: 'fotobok', matchType: 'EXACT' }, status: 'ENABLED', qualityInfo: { qualityScore: 3 } }, adGroup: { name: 'G', status: 'REMOVED' }, campaign: { name: 'A', status: 'ENABLED' }, metrics: {} },
    { adGroupCriterion: { keyword: { text: 'album', matchType: 'BROAD' }, status: 'ENABLED' }, adGroup: { name: 'G2', status: 'ENABLED' }, campaign: { name: 'A', status: 'PAUSED' }, metrics: {} }
  ] }], {});
  assert.deepEqual(k.rows.map(x => [x.status, x.matchType, x.qs]), [['removed', 'exact match', 3], ['paused', 'broad match', null]]);
});

test('felsvar och trasig JSON ger ett tydligt fel i stället för en tom rapport', () => {
  assert.throws(() => parseStream('[{"error":{"message":"nej"}}]'), /nej/);
  assert.equal(apiReport('x', 'campaigns', '{trasig', {}).error, 'Svaret från Google Ads gick inte att läsa.');
  assert.equal(apiReport('x', 'okänd', '[]', {}).type, 'unknown');
  assert.deepEqual(apiReport('x', 'products', '[]', {}).rows, []);
});
