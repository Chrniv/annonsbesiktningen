/*
  Bakgrundstråd för analysen. Stora konton (hundratusentals söktermer) tar flera sekunder att läsa och räkna på;
  här gör de det utan att sidan fryser. Rapporterna stannar i tråden, sidan får bara en sammanfattning och resultatet.
*/
import { readReport, analyze, decodeBuffer } from './engine.js';
import { apiReport } from './googleAds.js';

const reports = new Map();
const summary = (id, r) => { const { rows, ...rest } = r; return { ...rest, id, rowCount: rows ? rows.length : 0 }; };

self.onmessage = ev => {
  const m = ev.data;
  try {
    if (m.op === 'read') {
      const r = readReport(m.name, m.text != null ? m.text : decodeBuffer(m.buffer));
      reports.set(m.id, r);
      self.postMessage({ call: m.call, ok: true, value: summary(m.id, r) });
    } else if (m.op === 'api') {
      // Svar från Google Ads API: JSON i stället för CSV, men samma sorts rapport
      const r = apiReport(m.name, m.kind, new TextDecoder().decode(m.buffer), m.meta);
      if (!r.error) reports.set(m.id, r);
      self.postMessage({ call: m.call, ok: true, value: r.error ? r : summary(m.id, r) });
    } else if (m.op === 'analyze') {
      const rs = m.ids.map(id => reports.get(id)).filter(Boolean);
      self.postMessage({ call: m.call, ok: true, value: analyze(rs, m.opts) });
    } else if (m.op === 'drop') {
      m.ids.forEach(id => reports.delete(id));
    }
  } catch (e) {
    self.postMessage({ call: m.call, ok: false, error: String((e && e.message) || e) });
  }
};
