import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import { sanitizeResult } from '../src/sanitize.js';

test('tvätt av sparat protokoll: riktiga protokoll ändras inte', () => {
  for (const files of [E.sampleFiles('2026-10-20'), E.sampleFilesEcom('2026-10-20')]) {
    const r = JSON.parse(JSON.stringify(E.analyze(files.map(f => E.readReport(f.name, f.text)), { industry: 'shopping', margin: 0.4 })));
    const neutral = JSON.parse(JSON.stringify(r).replace(/</g, '‹').replace(/>/g, '›'));
    assert.deepEqual(sanitizeResult(r), neutral);
  }
});

test('tvätt av sparat protokoll: HTML, falska tal och okända värden tas om hand', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const s = sanitizeResult({
    overall: evil, currency: evil, counts: { crit: evil, warn: 2, info: '3' },
    modules: { pacing: { month: evil, daysLeft: evil, score: ['" onmouseover="x'] }, performance: { name: evil, score: '55' } },
    findings: [{ sev: 'crit" onclick="x', title: evil, items: [{ name: evil, value: 'ok', amt: evil }] }],
    __proto__: { polluted: true }, [evil]: 1
  });
  assert.equal(s.overall, null);
  assert.equal(s.currency, 'SEK');
  assert.deepEqual(s.counts, { crit: null, warn: 2, info: 3 });
  assert.equal(s.modules.pacing.month, '');
  assert.equal(s.modules.pacing.daysLeft, null);
  assert.deepEqual(s.modules.pacing.score, [null]);
  assert.equal(s.modules.performance.score, 55);
  assert.equal(s.findings[0].sev, 'info');
  assert.ok(!JSON.stringify(s).includes('<') && !JSON.stringify(s).includes('>'));
  assert.equal(s.findings[0].items[0].amt, null);
  assert.equal(({}).polluted, undefined);
});
