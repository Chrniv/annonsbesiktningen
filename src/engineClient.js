/*
  Läser rapporter och kör analysen i en bakgrundstråd (src/worker.js), så att sidan inte fryser på stora konton.
  Går tråden inte att starta (gammal webbläsare, blockerad) körs allt på sidan som förut.
  Sidan håller bara "handtag": rapporten utan rader, med id och rowCount.
*/
import { readReport, analyze, decodeBuffer } from './engine.js';
import { apiReport } from './googleAds.js';

let worker = null, failed = false, seq = 0;
const pending = new Map();
const local = new Map();   // reservläge: rapporterna ligger kvar på sidan
const handle = (id, r) => { const { rows, ...rest } = r; return { ...rest, id, rowCount: rows ? rows.length : 0 }; };

function start() {
  if (worker || failed) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ev => { const p = pending.get(ev.data.call); if (!p) return; pending.delete(ev.data.call); ev.data.ok ? p.resolve(ev.data.value) : p.reject(new Error(ev.data.error)); };
    worker.onerror = () => { failed = true; worker = null; pending.forEach(p => p.reject(new Error('worker'))); pending.clear(); };
  } catch (e) { failed = true; worker = null; }
  return worker;
}
function call(msg, transfer) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); worker.postMessage({ ...msg, call: id }, transfer || []); });
}

export const engineClient = {
  /** Läser en fil. `data` är text eller en ArrayBuffer. Returnerar ett handtag (rapporten utan rader). */
  async read(name, data) {
    const id = 'r' + (++seq);
    const isText = typeof data === 'string';
    if (start()) {
      // En kopia skickas, så att originalet finns kvar om tråden skulle falla och vi behöver läsa om på sidan
      try { return await call(isText ? { op: 'read', id, name, text: data } : { op: 'read', id, name, buffer: data }); }
      catch (e) { if (!failed) throw e; }
    }
    const r = readReport(name, isText ? data : decodeBuffer(data));
    local.set(id, r);
    return handle(id, r);
  },
  /** Läser ett svar från Google Ads API (ArrayBuffer med JSON). Returnerar ett handtag, eller { error } om svaret inte gick att läsa. */
  async readApi(name, kind, buffer, meta) {
    const id = 'r' + (++seq);
    if (start()) {
      try { return await call({ op: 'api', id, name, kind, buffer, meta }); }
      catch (e) { if (!failed) throw e; }
    }
    const r = apiReport(name, kind, new TextDecoder().decode(buffer), meta);
    if (r.error) return r;
    local.set(id, r);
    return handle(id, r);
  },
  /** Kör analysen på rapporterna bakom handtagen. */
  async analyze(handles, opts) {
    const ids = handles.map(h => h.id);
    if (worker && !ids.some(id => local.has(id))) return call({ op: 'analyze', ids, opts });
    // Låt webbläsaren rita "Besiktar ..." innan sidan blir upptagen
    await new Promise(r => setTimeout(r, 30));
    return analyze(ids.map(id => local.get(id)).filter(Boolean), opts);
  },
  drop(handles) {
    const ids = handles.map(h => h.id);
    ids.forEach(id => local.delete(id));
    if (worker) worker.postMessage({ op: 'drop', ids });
  }
};
