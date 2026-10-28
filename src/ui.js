/* ===== Gränssnitt ===== */
import { readReport, analyze, sampleFiles, sampleFilesEcom, num, decodeBuffer, BENCH, CONFIG, fmtKr, fmtPct, fmtRange, fmtDelta, nf0, nf2, setCurrency, matchToEditor, negativesCsv, negativesPasteList, pauseKeywordsCsv, productsCsv, titlesCsv } from './engine.js';
import { backend } from './backend.js';

export function startApp() {
  const $ = id => document.getElementById(id);
  // Loggning som aldrig kastar fel, även om sidan bäddas in där console saknas eller är avskalad
  const log = (level, ...args) => { try { const c = window.console; const f = c && (typeof c[level] === 'function' ? c[level] : typeof c.log === 'function' ? c.log : null); if (f) f.apply(c, args); } catch (e) { /* ignorera */ } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Säkerhet för en rad i leveransen: hög / medel / låg, eller streck när raden bedömts på innebörd i stället för siffror
  const CONF = { 'hög': ['good', 'Hög'], 'medel': ['warn', 'Medel'], 'låg': ['info', 'Låg'] };
  const confPct = risk => (risk == null ? '' : `${Math.min(99, Math.floor((1 - risk) * 100))} % säkert`);
  const confText = (level, risk) => (level ? `${CONF[level][1]} (${confPct(risk)})` : '–');
  const confShort = level => (level ? CONF[level][1] : '–');
  const CONF_NOTE = `Säkerhet: Hög = högst ${Math.round(CONFIG.stats.sureLevel * 100)} % risk att bristen på konverteringar är ren otur, Medel = högst ${Math.round(CONFIG.stats.flagLevel * 100)} %. Streck = bedömt på innebörd.`;
  const confCell = (level, risk) => (level ? `<span class="chip ${CONF[level][0]}" title="${esc(confPct(risk))}">${CONF[level][1]}</span>` : '<span title="Bedömd på innebörd">–</span>');
  const state = { files: new Map(), result: null, sample: false, unlocked: false, admin: false, preview: false, paid: false, lead: null, leads: [], leadId: null };
  const isAdmin = () => state.admin && !state.preview;
  const isPaid = () => state.paid || isAdmin();
  const SEV = { crit: ['crit', 'Allvarligt fel'], warn: ['warn', 'Anmärkning'], info: ['info', 'Notering'] };
  const stateColor = s => s == null ? 'var(--line)' : s >= 80 ? 'var(--good)' : s >= 55 ? 'var(--warn)' : 'var(--crit)';

  // Grundinställning
  $('industry').innerHTML = BENCH.map(b => `<option value="${b.id}">${esc(b.sv)}</option>`).join('');
  $('band-agency').textContent = CONFIG.agencyName;
  $('consent-text').textContent = `Jag godkänner att ${CONFIG.agencyName} sparar min e-post och hela granskningen, inklusive söktermer och kampanjnamn, för att gå igenom resultatet med mig. Uppgifterna raderas efter ${CONFIG.leadRetentionMonths} månader. `;
  { const a = document.createElement('a'); a.href = 'integritetspolicy.html'; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Integritetspolicy'; $('consent-text').append(a); }
  if (CONFIG.contactEmail) { const p = document.createElement('p'); p.innerHTML = `${esc(CONFIG.agencyName)} · <a href="mailto:${esc(CONFIG.contactEmail)}">${esc(CONFIG.contactEmail)}</a> · <a href="integritetspolicy.html">Integritetspolicy</a>`; $('src-note').after(p); }
  else { const p = document.createElement('p'); p.innerHTML = '<a href="integritetspolicy.html">Integritetspolicy</a>'; $('src-note').after(p); }
  $('src-note').innerHTML = `Branschsnitt: ${esc(CONFIG.benchmarkSource)}. Kostnader omräknade med 1 USD = ${String(CONFIG.usdToSek).replace('.', ',')} kr. <a href="https://www.wordstream.com/blog/2026-google-ads-benchmarks" target="_blank" rel="noopener">Källa</a>`;

  // Filer
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', ev => addFiles(ev.dataTransfer.files));
  $('files').addEventListener('change', ev => { addFiles(ev.target.files); ev.target.value = ''; });

  async function addFiles(list) {
    const files = Array.from(list); // kopiera direkt: listan töms när fältet nollställs
    for (const f of files) {
      try {
        const text = decodeBuffer(await f.arrayBuffer());
        state.files.set(f.name, readReport(f.name, text));
      } catch (e) { state.files.set(f.name, { name: f.name, type: 'unknown', error: 'Filen kunde inte läsas.' }); }
    }
    state.sample = false;
    renderFiles();
  }
  const TYPE_SV = { campaigns: 'Kampanjer', searchTerms: 'Söktermer', keywords: 'Sökord', products: 'Produkter' };

  /* ===== Startfrågor ===== */
  const Q = {
    type: [
      { v: 'ecom', t: 'Säljer produkter online', s: 'E-handel, marknadsplats eller prenumeration' },
      { v: 'local', t: 'Tjänster till privatpersoner', s: 'T.ex. hantverk, vård, salong' },
      { v: 'b2b', t: 'Tjänster eller produkter till företag', s: 'B2B' },
      { v: 'other', t: 'Något annat', s: 'Resor, kultur, finans m.m.' }
    ],
    industries: {
      ecom: ['shopping', 'grocery', 'marketplace', 'apparel', 'furniture', 'beauty', 'pets', 'sports', 'home', 'autosale'],
      local: ['home', 'autorepair', 'dental', 'medical', 'personal', 'beauty', 'fitness', 'legal', 'realestate', 'food', 'education', 'pets'],
      b2b: ['b2b', 'industrial', 'finance', 'legal', 'career', 'education'],
      other: ['travel', 'arts', 'finance', 'realestate', 'education', 'career', 'food', 'all']
    },
    campaigns: [{ v: 'search', t: 'Sök' }, { v: 'shopping', t: 'Shopping' }, { v: 'pmax', t: 'Performance Max' }, { v: 'display', t: 'Display eller video' }, { v: 'unsure', t: 'Vet inte' }],
    goal: [{ v: 'purchase', t: 'Köp i webbutiken' }, { v: 'lead', t: 'Förfrågan, formulär eller samtal' }, { v: 'both', t: 'Båda' }],
    margin: [{ v: '0.3', t: 'Runt 30 %' }, { v: '0.4', t: 'Runt 40 %' }, { v: '0.5', t: 'Runt 50 %' }, { v: '0.6', t: 'Runt 60 %' }, { v: '0.7', t: '70 % eller mer' }, { v: '', t: 'Vet inte' }],
    budget: [{ v: '<10k', t: 'Under 10 000 kr' }, { v: '10-50k', t: '10 000–50 000 kr' }, { v: '50-200k', t: '50 000–200 000 kr' }, { v: '>200k', t: 'Över 200 000 kr' }]
  };
  state.profile = { type: null, margin: null, industry: null, industryOther: false, industryText: '', showAll: false, campaigns: [], goal: null, budget: null, done: false };
  const fallbackInd = t => t === 'ecom' ? 'shopping' : t === 'b2b' ? 'b2b' : 'all';
  const indLabel = P => P.industryOther ? (P.industryText ? P.industryText + ' (jämförs med ' + benchName(P.industry) + ')' : benchName(P.industry)) : benchName(P.industry);
  const benchName = id => (BENCH.find(b => b.id === id) || {}).sv || id;
  function optBtn(group, o, multi) {
    const on = multi ? state.profile[group].includes(o.v) : state.profile[group] === o.v;
    return `<button type="button" class="opt" role="${multi ? 'checkbox' : 'radio'}" ${multi ? 'aria-pressed' : 'aria-checked'}="${on}" data-g="${group}" data-v="${esc(o.v)}">${esc(o.t)}${o.s ? `<small>${esc(o.s)}</small>` : ''}</button>`;
  }
  function renderQuiz() {
    const P = state.profile;
    $('q-type').querySelector('.opts').innerHTML = Q.type.map(o => optBtn('type', o)).join('');
    $('q-industry').hidden = !P.type;
    if (P.type) {
      const ids = P.showAll ? BENCH.map(b => b.id).filter(id => id !== 'all') : Q.industries[P.type].filter(id => id !== 'all');
      const cur = P.industryOther ? '__other' : P.industry;
      $('q-industry').querySelector('.opts').innerHTML = ids.map(id => optBtn('industry', { v: id, t: benchName(id) })).join('')
        + `<button type="button" class="opt" role="radio" aria-checked="${cur === '__other'}" data-g="industry" data-v="__other">Annat<small>Skriv vad ni säljer</small></button>`;
      $('q-industry').querySelectorAll('.opt').forEach(b => { if (b.dataset.v !== '__other') b.setAttribute('aria-checked', String(!P.industryOther && P.industry === b.dataset.v)); });
      $('q-ind-other').hidden = !P.industryOther;
      $('q-ind-all').textContent = P.showAll ? 'Visa färre branscher' : 'Visa alla branscher';
    }
    $('q-campaigns').querySelector('.opts').innerHTML = Q.campaigns.map(o => optBtn('campaigns', o, true)).join('');
    $('q-goal').querySelector('.opts').innerHTML = Q.goal.map(o => optBtn('goal', o)).join('');
    $('q-budget').querySelector('.opts').innerHTML = Q.budget.map(o => optBtn('budget', o)).join('');
    $('q-margin').hidden = P.type !== 'ecom' && P.goal !== 'purchase' && P.goal !== 'both';
    $('q-margin').querySelector('.opts').innerHTML = Q.margin.map(o => optBtn('margin', o)).join('');
  }
  const QUIZ_HTML = $('quiz').innerHTML;
  $('quiz').addEventListener('click', ev => {
    if (ev.target.closest('#quiz-next')) return finishQuiz(false);
    if (ev.target.closest('#quiz-skip')) return finishQuiz(true);
    if (ev.target.closest('#quiz-again')) { $('quiz').innerHTML = QUIZ_HTML; bindOther(); renderQuiz(); if (state.profile.industryOther) $('q-ind-text').value = state.profile.industryText; return; }
    if (ev.target.closest('#q-ind-all')) { state.profile.showAll = !state.profile.showAll; renderQuiz(); return; }
    const b = ev.target.closest('.opt'); if (!b) return;
    const g = b.dataset.g, v = b.dataset.v, P = state.profile;
    if (g === 'campaigns') {
      if (v === 'unsure') P.campaigns = P.campaigns.includes('unsure') ? [] : ['unsure'];
      else { P.campaigns = P.campaigns.filter(x => x !== 'unsure'); P.campaigns = P.campaigns.includes(v) ? P.campaigns.filter(x => x !== v) : [...P.campaigns, v]; }
    } else if (g === 'industry' && v === '__other') {
      P.industryOther = true; P.industry = fallbackInd(P.type);
      renderQuiz(); $('q-ind-text').focus(); return;
    } else {
      if (g === 'industry') P.industryOther = false;
      P[g] = v;
      if (g === 'type') {
        if (P.industryOther) P.industry = fallbackInd(v);
        else if (!Q.industries[v].includes(P.industry) && !P.showAll) P.industry = null;
        if (!P.goal) P.goal = v === 'ecom' ? 'purchase' : 'lead';
        if (!P.campaigns.length) P.campaigns = v === 'ecom' ? ['search', 'pmax'] : ['search'];
      }
    }
    $('quiz-error').hidden = true;
    renderQuiz();
  });
  function bindOther() {
    const i = $('q-ind-text');
    if (i) i.addEventListener('input', () => { state.profile.industryText = i.value.trim().slice(0, 80); });
  }
  bindOther();
  function finishQuiz(skipped) {
    const P = state.profile;
    if (!skipped && (!P.type || !P.industry)) { $('quiz-error').hidden = false; $('quiz-error').textContent = 'Välj vad ni gör och vilken bransch som ligger närmast.'; return; }
    P.done = !skipped;
    if (P.industry) $('industry').value = P.industry;
    const quiz = $('quiz');
    quiz.innerHTML = skipped
      ? `<div class="quiz-done"><span>Du hoppade över frågorna.</span><button class="btn link" type="button" id="quiz-again">Svara på frågorna</button></div>`
      : `<div class="quiz-done"><strong>${esc(indLabel(P))}</strong><span>·</span><span>${esc(P.campaigns.includes('unsure') || !P.campaigns.length ? 'Kampanjtyper okända' : P.campaigns.map(c => Q.campaigns.find(o => o.v === c).t).join(', '))}</span><span>·</span><span>${esc((Q.goal.find(o => o.v === P.goal) || {}).t || '')}</span>${P.budget ? `<span>·</span><span>${esc(Q.budget.find(o => o.v === P.budget).t)}</span>` : ''}<button class="btn link" type="button" id="quiz-again">Ändra</button></div>`;
    renderChecklist();
    $('intake').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  // Rapporter att exportera, utifrån svaren
  // Exakt var rapporten finns och vilka kolumner som behövs (svenska namn i Google Ads, engelska inom parentes)
  const C = (sv, en) => ({ sv, en });
  const REPORT_HELP = {
    campaigns: {
      where: 'Kampanjer › Kampanjer. Välj de senaste 30 dagarna och lägg till segmentet Tid › Dag.',
      req: [C('Kampanj', 'Campaign'), C('Dag', 'Day'), C('Kostnad', 'Cost'), C('Klick', 'Clicks'), C('Visningar', 'Impr.'), C('Konverteringar', 'Conversions')],
      rec: [C('Konv.värde', 'Conv. value'), C('Förlorad exponeringsandel i sökning (budget)', 'Search lost IS (budget)'), C('Förlorad exponeringsandel i sökning (rankning)', 'Search lost IS (rank)'), C('Kampanjtyp', 'Campaign type'), C('Valutakod', 'Currency code')],
      note: 'Budget går inte att kombinera med förlorad exponeringsandel i samma rapport. Ta exponeringsandelen; den visar mer.'
    },
    searchTerms: {
      where: 'Kampanjer › Insikter och rapporter › Söktermer. Samma period, utan segment.',
      req: [C('Sökterm', 'Search term'), C('Kampanj', 'Campaign'), C('Kostnad', 'Cost'), C('Klick', 'Clicks'), C('Konverteringar', 'Conversions')],
      rec: [C('Söktermens matchningstyp', 'Match type'), C('Annonsgrupp', 'Ad group'), C('Visningar', 'Impr.'), C('Konv.värde', 'Conv. value'), C('Valutakod', 'Currency code')],
      note: 'Ta med alla rader, även de med få klick. Det är i den långa svansen slöseriet brukar gömma sig.'
    },
    keywords: {
      where: 'Kampanjer › Målgrupper, sökord och innehåll › Sökord för sökning. Samma period, utan segment.',
      req: [C('Sökord', 'Keyword'), C('Matchningstyp', 'Match type'), C('Kampanj', 'Campaign'), C('Kostnad', 'Cost'), C('Klick', 'Clicks'), C('Konverteringar', 'Conversions')],
      rec: [C('Annonsgrupp', 'Ad group'), C('Kvalitetsresultat', 'Quality Score'), C('Status', 'Status'), C('Konv.värde', 'Conv. value')],
      note: 'Kvalitetsresultat finns under Kolumner › Kvalitetsresultat. Den visas bara för sökkampanjer.'
    },
    products: {
      where: 'Kampanjer › Produkter. Gäller både Shopping och Performance Max. Samma period, utan segment.',
      req: [C('Artikel-id', 'Item ID'), C('Produkttitel', 'Product title'), C('Kostnad', 'Cost'), C('Klick', 'Clicks'), C('Konverteringar', 'Conversions')],
      rec: [C('Konv.värde', 'Conv. value'), C('Kampanj', 'Campaign'), C('Visningar', 'Impr.')],
      note: 'Produkttitel behövs för förslagen på nya titlar. Saknas den i kolumnvalet, lägg till den under Produktattribut.'
    }
  };
  const colList = cs => cs.map(c => `<li>${esc(c.sv)} <span class="en">(${esc(c.en)})</span></li>`).join('');
  function helpHtml(type) {
    const h = REPORT_HELP[type]; if (!h) return '';
    return `<p><strong>Var:</strong> ${esc(h.where)}</p>
      <p class="hl">Kolumner som krävs</p><ul>${colList(h.req)}</ul>
      <p class="hl">Bra att ha med</p><ul>${colList(h.rec)}</ul>
      ${h.note ? `<p class="note">${esc(h.note)}</p>` : ''}
      <p class="small muted">Ladda ner med nedladdningsikonen › CSV (.csv). Svenska eller engelska kolumnnamn fungerar båda.</p>`;
  }
  function neededReports() {
    const P = state.profile, c = P.campaigns, unsure = !c.length || c.includes('unsure');
    const search = unsure || c.includes('search'), prod = P.type === 'ecom' && (unsure || c.includes('shopping') || c.includes('pmax'));
    const list = [{ type: 'campaigns', t: 'Kampanjer per dag', d: 'Kampanjer › Senaste 30 dagarna › segment Dag. Kolumner: Kostnad, Klick, Konverteringar' + (P.goal !== 'lead' ? ', Konv.värde' : '') + ' och Förlorad exponeringsandel (budget, rankning).', req: true }];
    if (search) list.push({ type: 'searchTerms', t: 'Söktermer', d: 'Insikter och rapporter › Söktermer, samma period. Visar vilka sökningar som kostar pengar utan resultat.' });
    if (search) list.push({ type: 'keywords', t: 'Sökord', d: 'Sökord, med kolumnerna Annonsgrupp, Matchningstyp och Kvalitetsresultat.' });
    if (prod) list.push({ type: 'products', t: 'Produkter', d: 'Produkter, med Artikel-id, Produkttitel, Kostnad, Klick, Konverteringar och Konv.värde.' });
    return list;
  }
  function renderChecklist() {
    if (!state.profile.type) return;
    const have = new Set([...state.files.values()].filter(r => !r.error).map(r => r.type));
    $('checklist-wrap').hidden = false;
    const openHelp = [...document.querySelectorAll('.col-help[aria-expanded="true"]')].map(b => b.dataset.help);
    $('checklist').innerHTML = neededReports().map(x => `<li class="${have.has(x.type) ? 'done' : ''}"><span class="tick" aria-hidden="true"></span><span class="ct">${esc(x.t)}</span><span class="tag">${have.has(x.type) ? 'Uppladdad' : x.req ? 'Krävs' : 'Rekommenderas'}</span><span class="cd">${esc(x.d)} <button type="button" class="col-help" aria-expanded="false" aria-controls="help-${x.type}" data-help="${x.type}"><span aria-hidden="true">i</span> Vilka kolumner?</button></span><div class="col-pop" id="help-${x.type}" role="region" aria-label="Kolumner för ${esc(x.t)}" hidden>${helpHtml(x.type)}</div></li>`).join('');
    openHelp.forEach(t => { const b = document.querySelector(`.col-help[data-help="${t}"]`); if (b) { b.setAttribute('aria-expanded', 'true'); $('help-' + t).hidden = false; } });
  }
  // Öppna/stäng kolumnhjälpen (klick och tangentbord; fungerar även på mobil där hover saknas)
  document.addEventListener('click', ev => {
    const b = ev.target.closest('.col-help');
    document.querySelectorAll('.col-help[aria-expanded="true"]').forEach(o => { if (o !== b && !ev.target.closest('.col-pop')) { o.setAttribute('aria-expanded', 'false'); const p = document.getElementById(o.getAttribute('aria-controls')); if (p) p.hidden = true; } });
    if (!b) return;
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    document.getElementById(b.getAttribute('aria-controls')).hidden = !open;
  });
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    document.querySelectorAll('.col-help[aria-expanded="true"]').forEach(o => { o.setAttribute('aria-expanded', 'false'); document.getElementById(o.getAttribute('aria-controls')).hidden = true; o.focus(); });
  });
  renderQuiz();
  function renderFiles() {
    const items = [...state.files.values()];
    $('filelist').innerHTML = items.map(r => {
      if (r.error) return `<li><span class="fname">${esc(r.name)}</span><span class="chip crit">Kan inte läsas</span><span class="small muted">${esc(r.error)}</span></li>`;
      const extra = r.missing && r.missing.length ? `<span class="small muted">Saknar: ${esc(r.missing.join(', '))}</span>` : '';
      return `<li><span class="fname">${esc(r.name)}</span><span class="chip good">${TYPE_SV[r.type]} · ${r.rows.length} rader</span>${r.period ? `<span class="small muted num">${r.period.from} – ${r.period.to}</span>` : ''}${extra}<button class="btn" style="padding:2px 8px;margin-left:auto;font-size:12.5px" data-rm="${esc(r.name)}" aria-label="Ta bort ${esc(r.name)}">Ta bort</button></li>`;
    }).join('');
    $('filelist').querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { state.files.delete(b.dataset.rm); renderFiles(); }));
    const ok = items.filter(r => !r.error);
    $('run').disabled = !ok.length;
    renderChecklist();
    const err = $('intake-error');
    const hasCamp = ok.some(r => r.type === 'campaigns');
    err.hidden = !(ok.length && !hasCamp);
    err.textContent = 'Kampanjrapporten saknas. Utan den kan vi bara granska slöseri. Lägg till den för budgettakt, branschjämförelse och veckoförändring.';
    const seen = {}; ok.forEach(r => { seen[r.type] = (seen[r.type] || 0) + 1; });
    const dup = Object.entries(seen).find(([, n]) => n > 1);
    if (dup) { err.hidden = false; err.textContent = `${dup[1]} filer lästes som ${TYPE_SV[dup[0]].toLowerCase()}. Kontrollera att du laddat upp en kampanjrapport, en söktermsrapport och en sökordsrapport. Om filerna är rätt, exportera dem igen som CSV och prova på nytt.`; }
    const cur = ok.find(r => r.currency && r.currency !== 'SEK');
    if (cur && !CONFIG.fxToSek[String(cur.currency).toUpperCase()]) { err.hidden = false; err.textContent = `Kontot rapporterar i ${cur.currency}. Kostnad per klick och per konvertering kan inte jämföras med branschen i den valutan.`; }
  }

  $('run').addEventListener('click', () => run([...state.files.values()].filter(r => !r.error), false));
  $('sample').addEventListener('click', () => loadSample(true));

  function loadSample(scroll) {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const end = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    const ecom = state.profile && state.profile.type === 'ecom';
    state.sampleKind = ecom ? 'ecom' : 'leads';
    if (!state.profile || !state.profile.industry) $('industry').value = ecom ? 'shopping' : 'home';
    else if (!ecom && !state.profile.done) $('industry').value = 'home';
    run((ecom ? sampleFilesEcom(end) : sampleFiles(end)).map(f => readReport(f.name, f.text)), true, scroll);
  }

  function run(reports, sample, scroll = true) {
    state.sample = sample; state.unlocked = !!state.paidPending; state.paid = !!state.paidPending && !sample; state.lead = null; $('lead-note').hidden = true; markActiveLead();
    const res = analyze(reports, { industry: $('industry').value, margin: state.profile.margin ? Number(state.profile.margin) : null });
    state.result = res;
    render(res);
    if (scroll) ($('example-note').hidden ? $('result') : $('example-note')).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  // Lager 1: gratis översikt
  function render(r) {
    $('example-note').hidden = !state.sample;
    if (state.sample) $('example-note').querySelector('span').textContent = state.sampleKind === 'ecom' ? 'Protokollet nedan bygger på fiktiva exporter från en fotobutik på nätet, med produktrapport och förslag på nya produkttitlar. Ladda upp egna filer ovan för att besikta ditt konto.' : 'Protokollet nedan bygger på fiktiva exporter från ett renoveringsföretag i Stockholm. Ladda upp egna filer ovan för att besikta ditt konto.';
    ['result', 'bench-panel', 'gate', 'full'].forEach(id => $(id).hidden = false);
    $('summary').hidden = true;
    if (isAdmin()) $('gate').hidden = true;
    $('gate-note').textContent = state.sample ? 'Exempel: ingen e-post skickas.' : '';
    const today = new Date().toISOString().slice(0, 10);
    const p = r.period;
    $('meta').innerHTML = [
      ['Protokoll', `AB-${today.replace(/-/g, '')}`],
      ['Period', p.from ? `${p.from} – ${p.to}` : 'Okänd (30 dagar antas)'],
      ['Bransch', r.industry],
      ['Kostnad per månad', fmtKr(r.spendMonthly)]
    ].map(([k, v]) => `<div><span class="label">${k}</span><span class="v">${esc(v)}</span></div>`).join('');
    $('score').innerHTML = r.overall == null ? '–' : `${r.overall}<small>/100</small>`;
    const st = $('stamp');
    st.className = 'stamp ' + (r.verdict ? r.verdict.key : '');
    const dq = r.dataQuality || { level: 'ok' };
    st.textContent = r.verdict ? r.verdict.label : 'Ej bedömd';
    if (dq.level !== 'ok' && r.verdict) st.insertAdjacentHTML('beforeend', ' <span class="prelim">· preliminärt</span>');
    $('dq').hidden = dq.level === 'ok';
    $('dq').className = 'dq ' + dq.level;
    $('dq').innerHTML = dq.level === 'ok' ? '' : `<strong>${esc(dq.title)}</strong><p>${esc(dq.text)}</p><p>${esc(dq.advice)}</p>`;
    void st.offsetWidth; st.classList.add('go');
    $('verdict-text').textContent = r.verdict ? r.verdict.text : '';
    $('marker').style.left = (r.overall || 0) + '%';

    const pace = r.modules.pacing;
    const S = r.savings || { low: 0, high: 0 };
    $('figures').innerHTML = `
      <div><span class="label">Uppskattat slöseri</span><span class="big">${r.modules.waste.available ? fmtKr(r.wasteMonthly) : '–'}</span><span class="small muted">${r.modules.waste.available ? `per månad, ${Math.round(r.modules.waste.pct * 100)} % av kostnaden` : 'Ladda upp söktermer för att räkna ut'}</span></div>
      <div><span class="label">Möjlig besparing</span><span class="big">${S.high ? fmtRange(S.low, S.high) : '–'}</span><span class="small muted">${S.high ? `per månad om åtgärderna genomförs${S.convHigh ? `, eller ≈ ${Math.round(S.convLow)}–${Math.round(S.convHigh)} fler konverteringar` : ''}` : 'Inga tydliga besparingar hittades'}</span></div>
      <div><span class="label">Missade konverteringar</span><span class="big num">${r.missedConvMonthly ? '≈ ' + Math.round(r.missedConvMonthly) : '–'}</span><span class="small muted">${r.missedConvMonthly ? 'per månad när lönsamma kampanjer når budgettaket' : pace.available ? 'Inga lönsamma kampanjer stoppas av budget' : 'Kräver budgetkolumn'}</span></div>
      <div><span class="label">Fynd</span><div class="counts">${r.counts.crit ? `<span class="chip crit">${r.counts.crit} ${r.counts.crit === 1 ? 'allvarligt' : 'allvarliga'}</span>` : ''}${r.counts.warn ? `<span class="chip warn">${r.counts.warn} ${r.counts.warn === 1 ? 'anmärkning' : 'anmärkningar'}</span>` : ''}${r.counts.info ? `<span class="chip info">${r.counts.info} ${r.counts.info === 1 ? 'notering' : 'noteringar'}</span>` : ''}${!r.findings.length ? '<span class="chip good">Inga fel hittade</span>' : ''}</div></div>`;

    const M = r.modules;
    const modLine = {
      performance: () => { const b = M.performance.benchmark.metrics; return `CTR ${fmtPct(b.ctr.you)} · konv.grad ${fmtPct(b.cvr.you)} (${M.performance.scope})`; },
      waste: () => `${fmtKr(M.waste.monthly)}/mån går till ${M.waste.source} utan konverteringar.`,
      pacing: () => M.pacing.projected == null ? (M.pacing.cappedCount ? `${M.pacing.cappedCount} lönsamma kampanjer begränsas av budgeten.` : 'Inga lönsamma kampanjer begränsas av budgeten.') : `${{ over: 'Överskrider budget', under: 'Använder inte hela budgeten', ontrack: 'I fas med budget' }[M.pacing.verdict]}: prognos ${fmtKr(M.pacing.projected)} av ${fmtKr(M.pacing.monthBudget)}${M.pacing.month ? ' denna månad' : ' per månad'}.`,
      wow: () => M.wow.headline ? `${M.wow.headline.sv} ${fmtDelta(M.wow.headline.delta)} senaste 7 dagarna mot veckan innan.` : 'Inga större förändringar.'
    };
    const lockWhy = {
      performance: 'Ladda upp en kampanjrapport.',
      waste: 'Ladda upp söktermer, sökord eller produktrapport för att låsa upp.',
      pacing: 'Kampanjrapporten behöver Budget eller Förlorad exponeringsandel (budget).',
      wow: 'Kräver kampanjrapport per dag eller vecka, minst 14 dagar.'
    };
    $('modules').innerHTML = Object.values(M).map(m => m.available && m.score != null
      ? `<div class="mod" style="--state:${stateColor(m.score)}"><div class="mod-head"><h3>${m.name}</h3><span class="s">${m.score}</span></div><div class="meter"><b style="width:${m.score}%"></b></div><p class="small">${esc(modLine[m.id]())}</p></div>`
      : `<div class="mod locked"><div class="mod-head"><h3>${m.name}</h3><span class="label">Låst</span></div><p class="small">${lockWhy[m.id]}</p></div>`).join('');

    // Branschjämförelse
    const bm = M.performance.benchmark;
    $('bench-industry').textContent = bm.industry;
    const rowsDef = [['ctr', 'Klickfrekvens (CTR)', fmtPct], ['cvr', 'Konverteringsgrad', fmtPct], ['cpc', 'Kostnad per klick', fmtKr], ['cpa', 'Kostnad per konvertering', fmtKr]];
    const V = { good: ['good', 'Bättre'], ok: ['info', 'I nivå'], warn: ['warn', 'Sämre'], crit: ['crit', 'Mycket sämre'], na: ['info', 'Saknas'], noconv: ['warn', 'Inga konv.'], nocur: ['info', 'Okänd valuta'] };
    $('bench-body').innerHTML = rowsDef.map(([k, label, f]) => {
      const m = bm.metrics[k]; const mx = Math.max(m.you || 0, m.bench) || 1;
      const [cls, txt] = V[m.verdict];
      return `<tr><td>${label}</td><td class="n">${f(m.you)}</td><td class="n">${m.verdict === 'nocur' ? nf2.format(m.bench) + ' USD' : f(m.bench)}</td><td><div class="bars" aria-hidden="true"><span class="you" style="width:${(m.you || 0) / mx * 100}%"></span><span class="ind" style="width:${m.bench / mx * 100}%"></span></div></td><td><span class="chip ${cls}">${txt}</span></td></tr>`;
    }).join('');
    $('bench-note').textContent = `Jämförelsen gäller ${bm.scope}. Fylld stapel är ditt konto, ofylld är branschsnittet. Branschsiffrorna kommer från amerikanska konton; kostnadsmåtten är omräknade till ${r.currency} med ungefärliga växelkurser och ska läsas som riktmärken.`;

    // Fullständigt protokoll (låst)
    $('full-intro').textContent = `${r.findings.length} fynd. Här finns varje fynd med exakta söktermer, sökord och kampanjer, en färdig lista med negativa sökord och en åtgärdsplan i prioritetsordning. Allt detta ingår i hela rapporten, som du kan köpa och ladda ner direkt.`;
    renderFull(r);
    if (isAdmin()) { $('full-intro').textContent = `Adminläge: alla ${r.findings.length} fynd visas med samtliga rader och åtgärder.`; renderSummary(r, false); }
    else if (state.paid) { $('full-intro').textContent = `Hela rapporten: alla ${r.findings.length} fynd med samtliga rader och konkreta åtgärder.`; renderSummary(r, false); }
    if (isPaid()) $('gate').hidden = true;
    renderBuy();
    renderDeliver(r);
    ['g-email', 'g-company', 'g-site'].forEach(id => { $(id).value = ''; }); $('g-consent').checked = false;
    $('gate-error').hidden = true;
  }


  // Hur mycket som visas efter e-post: tre rader för slöserifynd, en rad för övriga fynd med anmärkning eller allvarligt fel
  const revealCount = f => isPaid() ? Infinity : !state.unlocked ? 0 : f.module === 'waste' && f.sev !== 'info' ? 3 : f.sev === 'info' ? 0 : 1;
  function renderFull(r) {
    const nar = r.narrative || [];
    $('narrative').innerHTML = !nar.length ? '' : isPaid()
      ? `<div class="narrative"><span class="label">Analys</span>${nar.map(p => `<div><h3>${esc(p.h)}</h3><p>${esc(p.t)}</p></div>`).join('')}</div>`
      : `<p class="masked-note">En skriftlig analys av kontot med namngivna kampanjer, sökord och produkter ingår i hela rapporten.</p>`;
    $('full-list').innerHTML = r.findings.map(f => {
      const [cls, lbl] = SEV[f.sev];
      const n = Math.min(revealCount(f), f.items.length);
      const items = f.items.slice(0, Math.max(6, n)).map((it, i) => i < n
        ? `<li class="open${i >= LIST_LIMIT ? ' more' : ''}"><span class="name">${esc(it.name)}</span><span class="v">${esc(it.value)}</span></li>`
        : `<li><span class="bar" style="width:${Math.min(240, 50 + String(it.name).length * 6)}px"></span><span class="v">${f.impact && f.impact.kind === 'waste' ? esc(it.value) : '•••'}</span></li>`).join('');
      const hidden = f.items.length - n;
      const note = hidden > 0 ? `${n ? `${n} av ${f.items.length} visas. ` : ''}${hidden} ${hidden === 1 ? 'rad dold' : 'rader dolda'}, ingår i hela rapporten` : '';
      const tips = (f.tips || []).length ? (isPaid() ? `<div class="tips"><span class="label">Så åtgärdar du det</span><ol>${f.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ol></div>` : `<span class="masked-note">${f.tips.length} konkreta åtgärder ingår i hela rapporten</span>`) : '';
      return `<div class="find"><div class="find-head"><span class="chip ${cls}">${lbl}</span><h3>${esc(f.title)}</h3></div><p class="small muted">${esc(f.detail)}</p>${f.items.length ? `<div class="coll${n > LIST_LIMIT ? ' collapsed' : ''}"><ul class="masked" aria-label="${n ? 'Delvis dolt' : 'Dolt'}">${items}</ul>${n > LIST_LIMIT ? toggleBtn(n) : ''}</div>${note ? `<span class="masked-note">${note}</span>` : ''}` : ''}${f.saving ? `<span class="saving">Möjlig besparing: ${fmtRange(f.saving.low, f.saving.high)} per månad</span>` : ''}${tips}</div>`;
    }).join('') || '<p class="muted">Inga fynd att visa.</p>';
  }

  // Lager 2: e-post låser upp sammanfattning
  async function unlock() {
    const email = $('g-email').value.trim();
    const err = $('gate-error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.hidden = false; err.textContent = 'Skriv en e-postadress, till exempel namn@foretag.se.'; $('g-email').focus(); return; }
    if (!$('g-consent').checked) { err.hidden = false; err.textContent = 'Kryssa i rutan för att godkänna att vi sparar e-posten.'; return; }
    err.hidden = true;
    const r = state.result;
    const lead = {
      submittedAt: new Date().toISOString(), email, company: $('g-company').value.trim(), website: $('g-site').value.trim(),
      industry: r.industry, sample: state.sample,
      profile: { type: state.profile.type, margin: state.profile.margin || undefined, industry: state.profile.industry, industryText: state.profile.industryOther ? state.profile.industryText : undefined, campaigns: state.profile.campaigns, goal: state.profile.goal, budget: state.profile.budget },
      audit: {
        score: r.overall, verdict: r.verdict && r.verdict.label, period: r.period, dataQuality: r.dataQuality ? r.dataQuality.level : undefined,
        spendMonthly: Math.round(r.spendMonthly), wasteMonthly: Math.round(r.wasteMonthly), potentialMonthly: Math.round(r.potentialMonthly), missedConvMonthly: Math.round(r.missedConvMonthly || 0),
        modules: Object.fromEntries(Object.values(r.modules).map(m => [m.id, m.available ? m.score : null])),
        findings: r.findings.map(f => ({ sev: f.sev, module: f.module, title: f.title, impactSek: f.impact ? Math.round(f.impact.sek || 0) : null, count: f.items.length, campaigns: f.module === 'waste' ? undefined : f.items.map(i => i.name).filter(n => r.campaigns.some(c => c.name === n)) })),
        campaigns: r.campaigns.map(c => ({ name: c.name, costMonthly: Math.round(c.cost), convMonthly: Math.round(c.conv * 10) / 10 }))
      }
    };
    lead.result = slimResult(r);
    lead.consent = true;
    lead.consentText = $('consent-text').textContent;
    state.leadId = null;
    if (!state.sample && backend.configured()) {
      const btn = $('gate-submit'); btn.disabled = true;
      try { const saved = await backend.submitLead(lead); state.leadId = saved && saved.id; }
      catch (e) {
        log('warn', 'Lead kunde inte sparas', e && e.message);
        if (e && e.status === 429) { btn.disabled = false; err.hidden = false; err.textContent = 'Du har gjort många granskningar på kort tid. Vänta en stund och försök igen.'; return; }
      } finally { btn.disabled = false; }
    }
    state.unlocked = true;
    state.email = email;
    $('gate').hidden = true;
    renderFull(r);
    renderBuy();
    $('full-intro').textContent = `Sammanfattningen ovan är din, och de första raderna i varje fynd visas nu. Alla rader, konkreta åtgärder för varje fynd och en färdig lista med negativa sökord finns i hela rapporten.`;
    renderSummary(r);
  }
  $('gate-submit').addEventListener('click', () => { unlock().catch(e => { log('error', e); const er = $('gate-error'); er.hidden = false; er.textContent = 'Något gick fel när sammanfattningen skulle visas. Ladda om sidan och försök igen.'; }); });
  ['g-email', 'g-company', 'g-site'].forEach(id => $(id).addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); $('gate-submit').click(); } }));

  function renderSummary(r, scroll = true) {
    $('summary').hidden = false;
    const top = r.findings.filter(f => f.sev !== 'info').slice(0, 3);
    const impactTxt = f => f.saving ? `Möjlig besparing ${fmtRange(f.saving.low, f.saving.high)}/mån` : !f.impact ? '' : f.impact.kind === 'waste' ? `≈ ${fmtKr(f.impact.sek)}/mån i slöseri` : f.impact.kind === 'opportunity' ? `≈ ${Math.round(f.impact.conv)} missade konv./mån` : f.impact.sek ? `≈ ${fmtKr(f.impact.sek)}/mån feldisponerat` : '';
    $('top').innerHTML = top.length ? top.map((f, i) => `<div class="find"><div class="find-head"><span class="label num">Fynd ${i + 1}</span><span class="chip ${SEV[f.sev][0]}">${SEV[f.sev][1]}</span></div><h3>${esc(f.title)}</h3><p class="small">${esc(f.freeText)}</p>${impactTxt(f) ? `<span class="impact">${impactTxt(f)}</span>` : ''}${revealCount(f) && f.items.length ? `<ul class="examples">${f.items.slice(0, revealCount(f)).map(it => `<li><span class="name">${esc(it.name)}</span><span class="v">${esc(it.value)}</span></li>`).join('')}</ul>${f.items.length > revealCount(f) ? `<span class="masked-note">+ ${f.items.length - revealCount(f)} till i hela rapporten</span>` : ''}` : ''}</div>`).join('') : '<p>Inga allvarliga fel eller anmärkningar hittades.</p>';
    const P = r.modules.pacing;
    $('pace-sum').innerHTML = P.available && P.projected != null ? `<div class="find"><div class="find-head"><span class="label">Budgettakt</span><span class="chip ${P.verdict === 'ontrack' ? 'good' : 'warn'}">${{ over: 'Överskrider', under: 'Underförbrukar', ontrack: 'I fas' }[P.verdict]}</span></div><p class="small">${P.month ? `Med nuvarande takt landar ${P.month} på ${fmtKr(P.projected)} mot en budget på ${fmtKr(P.monthBudget)} (${Math.round(P.ratio * 100)} %). ${P.daysLeft} dagar kvar.` : `Nuvarande takt motsvarar ${fmtKr(P.projected)} per månad mot en budget på ${fmtKr(P.monthBudget)}.`}</p></div>` : '';
    const W = r.modules.wow;
    if (W.available) {
      const rows = W.changes.filter(c => c.cur != null).map(c => {
        const good = c.good && c.delta != null && Math.abs(c.delta) >= 5 ? ((c.good === 'up') === (c.delta > 0) ? 'up' : 'down') : '';
        const f = ['ctr', 'cvr'].includes(c.k) ? fmtPct : ['cost', 'cpa', 'cpc'].includes(c.k) ? fmtKr : c.k === 'roas' ? (v => v == null ? '–' : nf2.format(v)) : (v => v == null ? '–' : nf0.format(v));
        return `<tr><td>${c.sv}</td><td class="n">${f(c.prev)}</td><td class="n">${f(c.cur)}</td><td class="n ${good}">${fmtDelta(c.delta)}</td></tr>`;
      }).join('');
      $('wow-sum').innerHTML = `<div class="find"><div class="find-head"><span class="label">Vecka mot vecka</span><span class="small muted num">${esc(W.curLabel)} mot ${esc(W.prevLabel)}</span></div><div class="bench-wrap"><table class="wow"><thead><tr><th>Mått</th><th>Veckan innan</th><th>Senaste 7 dagar</th><th>Förändring</th></tr></thead><tbody>${rows}</tbody></table></div>${W.notes ? `<p class="note">${esc(W.notes.join(' '))}</p>` : ''}${isPaid() ? '' : '<p class="note">Vilka kampanjer som drev förändringen finns i hela rapporten.</p>'}</div>`;
    } else $('wow-sum').innerHTML = '';
    if (scroll) $('summary').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  // Kopia av resultatet som går att spara: högst 200 rader per fynd, inga odefinierade värden
  function slimResult(r) {
    const c = JSON.parse(JSON.stringify(r));
    c.findings.forEach(f => { if (f.items.length > 200) f.items = f.items.slice(0, 200); });
    return c;
  }

  /* ===== Fällbara listor: 10 rader, sedan Visa alla / Visa färre ===== */
  const LIST_LIMIT = 10;
  const toggleBtn = n => `<button class="toggle" type="button" data-total="${n}" aria-expanded="false">Visa alla ${n}</button>`;
  function onToggle(e) {
    var b = e.target.closest && e.target.closest('.toggle'); if (!b) return;
    var c = b.closest('.coll'); var open = c.classList.toggle('collapsed') === false;
    b.textContent = open ? 'Visa färre' : 'Visa alla ' + b.getAttribute('data-total');
    b.setAttribute('aria-expanded', String(open));
    if (!open) { var r = c.getBoundingClientRect(); if (r.top < 0) c.scrollIntoView({ block: 'start' }); }
  }
  document.addEventListener('click', onToggle);
  const TOGGLE_JS = "document.addEventListener('click'," + onToggle.toString() + ");";

  /* ===== Köp och leverans ===== */
  function renderBuy() {
    const paid = isPaid();
    $('buy').hidden = paid;
    $('full-lock').classList.toggle('open', paid);
    $('full-lock-text').textContent = paid ? 'Upplåst' : 'Låst · ingår i hela rapporten';
    if (paid) return;
    $('price').textContent = CONFIG.reportPrice;
    const label = state.unlocked ? `Köp hela rapporten – ${CONFIG.reportPrice}` : 'Fyll i e-post först';
    $('buy-actions').innerHTML = `<button class="btn primary" type="button" id="buy-btn">${esc(label)}</button>${CONFIG.paymentUrl ? '' : '<button class="btn" type="button" id="buy-test">Testläge: simulera betalning</button>'}`;
    $('buy-note').textContent = CONFIG.paymentUrl ? 'Betalning sker säkert via Stripe. Du kommer tillbaka hit med rapporten upplåst.' : 'Prototyp: ingen betallänk är inlagd ännu (CONFIG.paymentUrl). Använd testläget för att se leveransen.';
    $('buy-btn').addEventListener('click', startPurchase);
    const t = $('buy-test'); if (t) t.addEventListener('click', () => { if (!state.unlocked) return needEmail(); markPaid(); });
  }
  function needEmail() {
    $('gate').hidden = false;
    $('gate').scrollIntoView({ block: 'start' });
    $('g-email').focus();
  }
  function startPurchase() {
    if (!state.unlocked) return needEmail();
    if (state.sample) { $('buy-note').textContent = 'Det här är exempelkontot. Ladda upp dina egna rapporter för att köpa din fullständiga rapport.'; return; }
    if (!CONFIG.paymentUrl) { $('buy-note').textContent = 'Lägg in en Stripe-betallänk i CONFIG.paymentUrl för att ta betalt. Tills dess fungerar testläget.'; return; }
    // Spara resultatet i webbläsaren så att det finns kvar när kunden kommer tillbaka från betalningen
    try { localStorage.setItem('ab-pending', JSON.stringify({ result: slimResult(state.result), email: state.email || '', at: Date.now() })); } catch (e) { /* utan lagring måste filerna laddas upp igen efter betalning */ }
    const u = new URL(CONFIG.paymentUrl);
    if (state.email) u.searchParams.set('prefilled_email', state.email);
    if (state.leadId) u.searchParams.set('client_reference_id', state.leadId);
    // Stripe går inte att visa i en iframe: vid inbäddning öppnas betalningen i hela fönstret
    if (window.top !== window) window.open(u.toString(), '_top'); else location.href = u.toString();
  }
  // Testläge (ingen betallänk inlagd): lås upp direkt
  function markPaid() {
    state.paid = true;
    render(state.result);
    renderSummary(state.result, false);
    $('deliver').scrollIntoView({ block: 'start' });
  }
  // Tillbaka från Stripe: ?betald=1&session_id=cs_... Betalningen kontrolleras hos Stripe innan något låses upp.
  async function checkPaidReturn() {
    let params; try { params = new URLSearchParams(location.search); } catch (e) { return; }
    if (!params.has('betald')) return;
    const sessionId = params.get('session_id') || '';
    const note = $('intake-error');
    const show = t => { note.hidden = false; note.textContent = t; note.scrollIntoView({ block: 'start' }); };
    let pending = null; try { pending = JSON.parse(localStorage.getItem('ab-pending') || 'null'); } catch (e) { /* ingen lagring */ }
    show('Kontrollerar betalningen …');
    const v = sessionId ? await backend.verifyPayment(sessionId) : { paid: false, error: 'session' };
    if (!v.paid) {
      show(v.error === 'unpaid' ? 'Betalningen är inte genomförd än. Om pengarna har dragits, vänta en minut och ladda om sidan.'
        : `Vi kunde inte bekräfta betalningen. Har du betalat? Mejla ${CONFIG.contactEmail || 'oss'} så skickar vi rapporten.`);
      return;
    }
    const result = v.result || (pending && pending.result);
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ok */ }
    if (!result) {
      show('Tack för köpet! Betalningen är bekräftad, men vi hittade inte din granskning. Ladda upp filerna igen så låses hela rapporten upp.');
      state.paid = true; state.unlocked = true; state.paidPending = true; state.email = v.email || '';
      return;
    }
    note.hidden = true;
    setCurrency(result.currency || 'SEK');
    state.result = result; state.email = v.email || (pending && pending.email) || ''; state.leadId = v.leadId || null;
    state.unlocked = true; state.sample = false; state.paid = true;
    render(state.result); renderSummary(state.result, false);
    try { localStorage.removeItem('ab-pending'); } catch (e) { /* ok */ }
    $('deliver').scrollIntoView({ block: 'start' });
  }

  function renderDeliver(r) {
    const show = isPaid();
    $('deliver').hidden = !show;
    if (!show) return;
    const negs = r.negatives || [];
    $('neg-block').hidden = !negs.length;
    $('dl-neg').hidden = $('copy-neg').hidden = !negs.length;
    $('neg-count').textContent = `${negs.length} st`;
    $('neg-coll').classList.toggle('collapsed', negs.length > LIST_LIMIT);
    $('neg-toggle').innerHTML = negs.length > LIST_LIMIT ? toggleBtn(negs.length) : '';
    $('neg-body').innerHTML = negs.map((n, i) => `<tr${i >= LIST_LIMIT ? ' class="more"' : ''}><td>${esc(n.match === 'exact' ? '[' + n.keyword + ']' : '"' + n.keyword + '"')}</td><td>${n.match === 'exact' ? 'Exakt' : 'Fras'}</td><td>${esc(n.campaign)}</td><td>${esc(n.reason)}</td><td>${confCell(n.confidence, n.risk)}</td><td class="n">${fmtKr(n.costMonthly)}</td></tr>`).join('');
    const pk = r.pauseKeywords || [], px = r.productExclusions || [];
    $('pause-block').hidden = $('dl-pause').hidden = !pk.length;
    $('prod-block').hidden = $('dl-prod').hidden = !px.length;
    $('pause-count').textContent = `${pk.length} st`; $('prod-count').textContent = `${px.length} st`;
    $('pause-coll').classList.toggle('collapsed', pk.length > LIST_LIMIT); $('pause-toggle').innerHTML = pk.length > LIST_LIMIT ? toggleBtn(pk.length) : '';
    $('prod-coll').classList.toggle('collapsed', px.length > LIST_LIMIT); $('prod-toggle').innerHTML = px.length > LIST_LIMIT ? toggleBtn(px.length) : '';
    $('pause-body').innerHTML = pk.map((k, i) => `<tr${i >= LIST_LIMIT ? ' class="more"' : ''}><td>${esc(k.keyword)}</td><td>${esc(matchToEditor(k.matchType) === 'Exact' ? 'Exakt' : matchToEditor(k.matchType) === 'Phrase' ? 'Fras' : 'Bred')}</td><td>${esc(k.campaign)}</td><td>${esc(k.adGroup || '–')}</td><td>${esc(k.why)}</td><td>${confCell(k.confidence, k.risk)}</td><td class="n">${fmtKr(k.costMonthly)}</td></tr>`).join('');
    $('prod-body').innerHTML = px.map((p, i) => `<tr${i >= LIST_LIMIT ? ' class="more"' : ''}><td>${esc(p.itemId)}</td><td>${esc(p.title || '–')}</td><td>${esc(p.why)}</td><td>${confCell(p.confidence, p.risk)}</td><td class="n">${nf0.format(p.clicks || 0)}</td><td class="n">${fmtKr(p.costMonthly)}</td></tr>`).join('');
    $('prod-note').textContent = `Ladda upp filen som tilläggsflöde i Merchant Center. Den sätter ${CONFIG.productLabel.column} = "${CONFIG.productLabel.value}" på produkterna, som du sedan utesluter i kampanjen. Google Ads visar artikel-id med gemener: kontrollera att de matchar id:na i Merchant Center.`;
    const ts = r.titleSuggestions || [];
    $('titles-block').hidden = !ts.length; $('dl-titles').hidden = !ts.some(t => t.suggestion);
    $('titles-count').textContent = `${ts.filter(t => t.suggestion).length} förslag`;
    $('titles-coll').classList.toggle('collapsed', ts.length > LIST_LIMIT); $('titles-toggle').innerHTML = ts.length > LIST_LIMIT ? toggleBtn(ts.length) : '';
    $('titles-body').innerHTML = ts.map((t, i) => `<tr${i >= LIST_LIMIT ? ' class="more"' : ''}><td>${esc(t.itemId)}</td><td class="${t.suggestion ? 'old' : ''}">${esc(t.title)}</td><td class="new">${t.suggestion ? esc(t.suggestion) : '<span class="muted">Inget förslag, se varför</span>'}</td><td class="why">${esc(t.issues.filter(x => !/^(Varumärke:|Titeln innehåller varumärket)/.test(x)).join(' '))}${t.issues.filter(x => /^(Varumärke:|Titeln innehåller varumärket)/.test(x)).map(x => `<span class="brand-warn">${esc(x.replace(/^Varumärke: /, ''))}</span>`).join('')}${t.terms && t.terms.length ? `<br>Söktermer: ${esc(t.terms.map(x => x.term).join(', '))}` : ''}</td></tr>`).join('');
    $('dl-msg').textContent = '';
  }

  async function saveFile(filename, data, mime) {
    const msg = $('dl-msg');
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    msg.textContent = `${filename} laddas ned.`;
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  $('dl-neg').addEventListener('click', () => saveFile(`negativa-sokord-${stamp()}.csv`, negativesCsv(state.result.negatives || []), 'text/csv;charset=utf-8'));
  /* ===== Rapport som PDF, Excel eller CSV ===== */
  // Biblioteken för Excel och PDF laddas först när någon klickar, så att sidan är snabb för alla andra
  const loadXlsx = () => import('xlsx');
  const loadPdf = async () => { const [{ jsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')]); if (at.applyPlugin) at.applyPlugin(jsPDF); return jsPDF; };
  async function withBusy(btn, fn) {
    btn.classList.add('busy'); const t = btn.textContent; btn.textContent = 'Skapar …';
    try { await fn(); } catch (e) { log('error', e); $('dl-msg').textContent = 'Filen kunde inte skapas. Kontrollera internetanslutningen och försök igen.'; }
    finally { btn.classList.remove('busy'); btn.textContent = t; }
  }
  const sevName = { crit: 'Allvarligt fel', warn: 'Anmärkning', info: 'Notering' };
  const modName = { performance: 'Prestanda', waste: 'Slöseri', pacing: 'Budget', wow: 'Vecka mot vecka' };
  const plain = s => String(s == null ? '' : s).replace(/[  ]/g, ' ');
  const rnd = v => v == null || isNaN(v) ? '' : Math.round(v);

  // Gemensamma tabeller för Excel och CSV
  function reportTables(r) {
    const M = r.modules, bm = M.performance.benchmark.metrics, S = r.savings || {};
    const overview = [
      ['Annonsbesiktningen', ''], ['Skapad', stamp()], ['Period', r.period.from ? `${r.period.from} – ${r.period.to}` : 'okänd'], ['Bransch', r.industry], ['Valuta', r.currency],
      ['Betyg', r.overall], ['Bedömning', r.verdict ? r.verdict.label : ''],
      ['Kostnad per månad', rnd(r.spendMonthly)], ['Uppskattat slöseri per månad', rnd(r.wasteMonthly)],
      ['Möjlig besparing per månad, lägst', rnd(S.low)], ['Möjlig besparing per månad, högst', rnd(S.high)],
      ['Fler konverteringar om besparingen flyttas', S.convHigh ? `${Math.round(S.convLow)}–${Math.round(S.convHigh)}` : ''],
      ['Missade konverteringar per månad (budget)', rnd(r.missedConvMonthly)], ['', ''], ['Analys', '']
    ].concat((r.narrative || []).map(p => [p.h, p.t]));
    const bench = [['Mått', 'Ditt konto', 'Branschsnitt', 'Bedömning']].concat([['ctr', 'Klickfrekvens (CTR) %'], ['cvr', 'Konverteringsgrad %'], ['cpc', `Kostnad per klick (${r.currency})`], ['cpa', `Kostnad per konvertering (${r.currency})`]]
      .map(([k, l]) => [l, bm[k].you == null ? '' : Math.round(bm[k].you * 100) / 100, Math.round(bm[k].bench * 100) / 100, { good: 'Bättre', ok: 'I nivå', warn: 'Sämre', crit: 'Mycket sämre', na: 'Saknas', noconv: 'Inga konv.', nocur: 'Okänd valuta' }[bm[k].verdict]]));
    const findings = [['Nr', 'Allvarlighet', 'Område', 'Fynd', 'Beskrivning', 'Möjlig besparing/mån, lägst', 'Möjlig besparing/mån, högst', 'Åtgärder']]
      .concat(r.findings.map((f, i) => [i + 1, sevName[f.sev], modName[f.module] || f.module, plain(f.title), plain(f.freeText + ' ' + f.detail), f.saving ? rnd(f.saving.low) : '', f.saving ? rnd(f.saving.high) : '', (f.tips || []).map((t, j) => `${j + 1}. ${plain(t)}`).join('\n')]));
    const rows = [['Nr', 'Fynd', 'Rad', 'Värde']];
    r.findings.forEach((f, i) => f.items.forEach(it => rows.push([i + 1, plain(f.title), plain(it.name), plain(it.value)])));
    const negs = [['Sökord', 'Matchning', 'Kampanj', 'Skäl', 'Säkerhet', 'Kostnad/mån']].concat((r.negatives || []).map(n => [n.keyword, n.match === 'exact' ? 'Exakt' : 'Fras', n.campaign, n.reason, confText(n.confidence, n.risk), rnd(n.costMonthly)]));
    const pause = [['Sökord', 'Matchning', 'Kampanj', 'Annonsgrupp', 'Skäl', 'Säkerhet', 'Kostnad/mån']].concat((r.pauseKeywords || []).map(k => [k.keyword, matchToEditor(k.matchType), k.campaign, k.adGroup, k.why, confText(k.confidence, k.risk), rnd(k.costMonthly)]));
    const prods = [['Artikel-id', 'Produkt', 'Kampanj', 'Skäl', 'Säkerhet', 'Klick', 'Kostnad/mån']].concat((r.productExclusions || []).map(p => [p.itemId, p.title, p.campaign, p.why, confText(p.confidence, p.risk), p.clicks, rnd(p.costMonthly)]));
    const titles = [['Artikel-id', 'Nuvarande titel', 'Förslag', 'Varför', 'Söktermer', 'Kostnad/mån']].concat((r.titleSuggestions || []).map(t => [t.itemId, t.title, t.suggestion, t.issues.join(' '), (t.terms || []).map(x => x.term).join(', '), rnd(t.costMonthly)]));
    const W = M.wow;
    const wow = W.available ? [['Mått', 'Veckan innan', 'Senaste 7 dagar', 'Förändring %']].concat(W.changes.filter(c => c.cur != null).map(c => [c.sv, Math.round(c.prev * 100) / 100, Math.round(c.cur * 100) / 100, c.delta == null ? '' : Math.round(c.delta)])) : null;
    return { overview, bench, findings, rows, negs, pause, prods, titles, wow };
  }

  async function downloadXlsx() {
    const XLSX = await loadXlsx();
    const t = reportTables(state.result), wb = XLSX.utils.book_new();
    const sheet = (name, aoa, widths) => { if (!aoa || aoa.length < 2) return; const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = widths.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
    sheet('Översikt', t.overview, [42, 110]);
    sheet('Fynd och åtgärder', t.findings, [5, 15, 15, 60, 70, 16, 16, 90]);
    sheet('Alla rader', t.rows, [5, 50, 50, 34]);
    sheet('Branschjämförelse', t.bench, [32, 14, 14, 14]);
    sheet('Negativa sökord', t.negs, [34, 10, 36, 30, 12]);
    sheet('Sökord att pausa', t.pause, [34, 10, 36, 24, 22, 12]);
    sheet('Produkter att utesluta', t.prods, [22, 44, 30, 22, 8, 12]);
    sheet('Produkttitlar', t.titles, [20, 50, 60, 70, 40, 12]);
    sheet('Vecka mot vecka', t.wow, [20, 14, 16, 14]);
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    await saveFile(`annonsbesiktning-${stamp()}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  function downloadCsv() {
    // En platt tabell med alla fynd och rader, öppnas direkt i Excel (semikolon, svensk standard)
    const r = state.result, out = [['Nr', 'Allvarlighet', 'Område', 'Fynd', 'Rad', 'Värde', 'Möjlig besparing/mån, lägst', 'Möjlig besparing/mån, högst', 'Åtgärder']];
    r.findings.forEach((f, i) => {
      const base = [i + 1, sevName[f.sev], modName[f.module] || f.module, plain(f.title)];
      const sav = [f.saving ? rnd(f.saving.low) : '', f.saving ? rnd(f.saving.high) : '', (f.tips || []).map((t, j) => `${j + 1}. ${plain(t)}`).join(' ')];
      if (!f.items.length) out.push([...base, '', '', ...sav]);
      f.items.forEach((it, j) => out.push([...base, plain(it.name), plain(it.value), ...(j === 0 ? sav : ['', '', ''])]));
    });
    const cell = v => { const s = String(v == null ? '' : v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = '﻿' + out.map(row => row.map(cell).join(';')).join('\r\n') + '\r\n';
    return saveFile(`annonsbesiktning-${stamp()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  async function downloadPdf() {
    const jsPDF = await loadPdf();
    const r = state.result, M = r.modules, S = r.savings || {};
    // Standardtypsnitten klarar svenska tecken men inte alla symboler
    const T = s => plain(s).replace(/≈/g, 'ca').replace(/[−‒]/g, '-').replace(/[›»]/g, '>').replace(/[^\x00-\xff–—‘’“”•…€]/g, '');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, L = 18, R = 18, CW = W - L - R, BOTTOM = 280;
    const C = { ink: [28, 35, 33], muted: [104, 114, 112], line: [226, 231, 228], soft: [238, 242, 239], accent: [46, 94, 80], good: [46, 122, 86], warn: [168, 112, 28], crit: [176, 68, 59] };
    let y = 20;
    const color = c => doc.setTextColor(...c);
    const need = h => { if (y + h > BOTTOM) { doc.addPage(); y = 20; } };
    const text = (s, size, opts = {}) => {
      doc.setFont('helvetica', opts.bold ? 'bold' : 'normal'); doc.setFontSize(size); color(opts.color || C.ink);
      const lines = doc.splitTextToSize(T(s), opts.width || CW), lh = size * 0.42 + (opts.lead || 1.6);
      lines.forEach(line => { need(lh); doc.text(line, opts.x || L, y); y += lh; });
    };
    const h2 = s => { need(18); y += 6; text(s, 14, { bold: true }); doc.setDrawColor(...C.line); doc.line(L, y - 2, W - R, y - 2); y += 3; };
    const table = (head, body, colStyles = {}) => {
      if (!body.length) return;
      doc.autoTable({ startY: y, head: [head.map(T)], body: body.map(row => row.map(c => T(c))), margin: { left: L, right: R }, theme: 'plain', showHead: head.some(Boolean) ? 'everyPage' : 'never',
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 1.8, bottom: 1.8, left: 0, right: 3 }, textColor: C.ink, lineColor: C.line, lineWidth: { bottom: 0.2 } },
        headStyles: { textColor: C.muted, fontStyle: 'normal', fontSize: 8 }, columnStyles: colStyles });
      y = doc.lastAutoTable.finalY + 5;
    };
    // Sidhuvud
    doc.setFillColor(...C.accent); doc.circle(L + 1.2, y - 1.2, 1.2, 'F');
    text(`Besiktningsprotokoll · Google Ads · ${CONFIG.agencyName}`, 9, { color: C.muted, x: L + 5 });
    y += 4; text('Annonsbesiktningen', 24, { bold: true, lead: 3 });
    text(`Period: ${r.period.from ? r.period.from + ' – ' + r.period.to : 'okänd'}    Bransch: ${r.industry}    Kostnad per månad: ${fmtKr(r.spendMonthly)}    Skapad: ${stamp()}`, 9, { color: C.muted });
    // Betyg
    y += 8; doc.setFont('helvetica', 'normal'); doc.setFontSize(46); color(C.ink); doc.text(String(r.overall == null ? '–' : r.overall), L, y + 10);
    const sw = doc.getTextWidth(String(r.overall == null ? '–' : r.overall)); doc.setFontSize(12); color(C.muted); doc.text('/100', L + sw + 1.5, y + 10);
    const vcol = r.verdict ? { pass: C.good, remarks: C.warn, fail: C.crit, ban: C.crit }[r.verdict.key] : C.muted;
    const dqPdf = r.dataQuality && r.dataQuality.level !== 'ok' ? r.dataQuality : null;
    const vy = y; y = vy + 2; text(r.verdict ? r.verdict.label + (dqPdf ? ' · preliminärt' : '') : '', 12, { bold: true, color: vcol, x: L + 50, width: CW - 50 }); text(r.verdict ? r.verdict.text : '', 10, { color: C.muted, x: L + 50, width: CW - 50 });
    y = Math.max(y, vy + 16);
    if (dqPdf) { y += 2; text(dqPdf.title, 10.5, { bold: true, color: dqPdf.level === 'verylow' ? C.crit : C.warn }); text(`${dqPdf.text} ${dqPdf.advice}`, 9.5, { color: C.muted }); y += 3; }
    // Nyckeltal
    const figs = [['Uppskattat slöseri', M.waste.available ? fmtKr(r.wasteMonthly) : '–', 'per månad'], ['Möjlig besparing', S.high ? fmtRange(S.low, S.high) : '–', 'per månad'], ['Missade konverteringar', r.missedConvMonthly ? 'ca ' + Math.round(r.missedConvMonthly) : '–', 'per månad'], ['Fynd', String(r.findings.length), `${r.counts.crit} allvarliga, ${r.counts.warn} anmärkningar`]];
    const bw = (CW - 9) / 4; need(26);
    figs.forEach((f, i) => { const x = L + i * (bw + 3); doc.setFillColor(...C.soft); doc.roundedRect(x, y, bw, 22, 2.5, 2.5, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); color(C.muted); doc.text(T(f[0]), x + 3.5, y + 5.5);
      doc.setFontSize(12.5); color(C.ink); doc.text(doc.splitTextToSize(T(f[1]), bw - 7)[0], x + 3.5, y + 12.5);
      doc.setFontSize(7); color(C.muted); doc.text(doc.splitTextToSize(T(f[2]), bw - 7)[0], x + 3.5, y + 18); });
    y += 28;
    // Analys
    if ((r.narrative || []).length) { h2('Analys'); r.narrative.forEach(p => { text(p.h, 10.5, { bold: true }); text(p.t, 9.5, { color: C.ink }); y += 2; }); }
    // Branschjämförelse
    const bm = M.performance.benchmark.metrics;
    h2('Du mot branschen');
    text(`${M.performance.benchmark.industry}, ${M.performance.benchmark.scope}`, 8.5, { color: C.muted }); y += 1;
    table(['Mått', 'Ditt konto', 'Branschsnitt'], [['ctr', 'Klickfrekvens (CTR)', fmtPct], ['cvr', 'Konverteringsgrad', fmtPct], ['cpc', 'Kostnad per klick', fmtKr], ['cpa', 'Kostnad per konvertering', fmtKr]].map(([k, l, f]) => [l, f(bm[k].you), bm[k].verdict === 'nocur' ? nf2.format(bm[k].bench) + ' USD' : f(bm[k].bench)]), { 1: { halign: 'right' }, 2: { halign: 'right' } });
    // Fynd
    h2('Fynd och åtgärder');
    r.findings.forEach((f, i) => {
      need(24);
      text(`${i + 1}. ${sevName[f.sev]}`, 8, { bold: true, color: { crit: C.crit, warn: C.warn, info: C.muted }[f.sev] });
      text(f.title, 11, { bold: true });
      text(f.freeText, 9.5); text(f.detail, 9, { color: C.muted });
      if (f.saving) text(`Möjlig besparing: ${fmtRange(f.saving.low, f.saving.high)} per månad`, 9, { bold: true, color: C.good });
      if (f.items.length) { y += 1; table(['', ''], f.items.map(it => [it.name, it.value]), { 1: { halign: 'right', cellWidth: 60 } }); }
      if ((f.tips || []).length) { text('Så åtgärdar du det', 9, { bold: true, color: C.accent }); f.tips.forEach((t, j) => text(`${j + 1}.  ${t}`, 9, { x: L + 2, width: CW - 4, lead: 1.3 })); }
      y += 4; doc.setDrawColor(...C.line); need(2); doc.line(L, y - 2, W - R, y - 2); y += 2;
    });
    const negs = r.negatives || [], pk = r.pauseKeywords || [], px = r.productExclusions || [];
    if (negs.length) { h2(`Negativa sökord (${negs.length} st)`); text('Ladda upp CSV-filen i Google Ads Editor eller klistra in listan i en delad lista med negativa sökord. ' + CONF_NOTE, 9, { color: C.muted }); y += 1; table(['Sökord', 'Matchning', 'Kampanj', 'Skäl', 'Säkerhet', 'Kostnad/mån'], negs.map(n => [n.match === 'exact' ? `[${n.keyword}]` : `"${n.keyword}"`, n.match === 'exact' ? 'Exakt' : 'Fras', n.campaign, n.reason, confShort(n.confidence), fmtKr(n.costMonthly)]), { 5: { halign: 'right' } }); }
    if (pk.length) { h2(`Sökord att pausa (${pk.length} st)`); table(['Sökord', 'Kampanj', 'Annonsgrupp', 'Skäl', 'Säkerhet', 'Kostnad/mån'], pk.map(k => [k.keyword, k.campaign, k.adGroup || '–', k.why, confShort(k.confidence), fmtKr(k.costMonthly)]), { 5: { halign: 'right' } }); }
    const tsg = (r.titleSuggestions || []).filter(t => t.suggestion);
    if (tsg.length) { h2(`Optimerade produkttitlar (${tsg.length} st)`); text('Ladda upp CSV-filen som tilläggsflöde i Merchant Center (id, title). Granska förslagen först.', 9, { color: C.muted }); y += 1; table(['Artikel-id', 'Nuvarande titel', 'Förslag'], tsg.map(t => [t.itemId, t.title, t.suggestion]), { 0: { cellWidth: 28 }, 1: { textColor: C.muted } }); }
    if (px.length) { h2(`Produkter att utesluta (${px.length} st)`); table(['Artikel-id', 'Produkt', 'Skäl', 'Säkerhet', 'Kostnad/mån'], px.map(p => [p.itemId, p.title || '–', p.why, confShort(p.confidence), fmtKr(p.costMonthly)]), { 4: { halign: 'right' } }); }
    const P = M.pacing;
    if (P.available && P.projected != null) { h2('Budgettakt'); text(P.month ? `Med nuvarande takt landar ${P.month} på ${fmtKr(P.projected)} mot en budget på ${fmtKr(P.monthBudget)} (${Math.round(P.ratio * 100)} %).` : `Nuvarande takt motsvarar ${fmtKr(P.projected)} per månad mot en budget på ${fmtKr(P.monthBudget)}.`, 9.5); }
    const Wk = M.wow;
    if (Wk.available) { h2('Vecka mot vecka'); text(`${Wk.curLabel} mot ${Wk.prevLabel}`, 8.5, { color: C.muted }); y += 1;
      table(['Mått', 'Veckan innan', 'Senaste 7 dagar', 'Förändring'], Wk.changes.filter(c => c.cur != null).map(c => { const f = ['ctr', 'cvr'].includes(c.k) ? fmtPct : ['cost', 'cpa', 'cpc'].includes(c.k) ? fmtKr : (v => v == null ? '–' : nf0.format(v)); return [c.sv, f(c.prev), f(c.cur), fmtDelta(c.delta)]; }), { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } }); }
    // Sidfot på varje sida
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); color(C.muted);
      doc.text(T(`Annonsbesiktningen · ${CONFIG.agencyName}`), L, 290); doc.text(`${i} / ${n}`, W - R, 290, { align: 'right' }); }
    doc.setPage(n); doc.setFontSize(7); color(C.muted);
    doc.text(doc.splitTextToSize(T(`Branschsnitt: ${CONFIG.benchmarkSource}. Siffrorna är uppskattningar baserade på de exporter som laddades upp, omräknade till månadsbelopp.`), CW), L, Math.min(y + 4, 282));
    await saveFile(`annonsbesiktning-${stamp()}.pdf`, doc.output('blob'), 'application/pdf');
  }
  $('dl-pdf').addEventListener('click', e => withBusy(e.currentTarget, downloadPdf));
  $('dl-xlsx').addEventListener('click', e => withBusy(e.currentTarget, downloadXlsx));
  $('dl-csv').addEventListener('click', e => withBusy(e.currentTarget, downloadCsv));
  $('dl-pause').addEventListener('click', () => saveFile(`sokord-att-pausa-${stamp()}.csv`, pauseKeywordsCsv(state.result.pauseKeywords || []), 'text/csv;charset=utf-8'));
  $('dl-titles').addEventListener('click', () => saveFile(`optimerade-titlar-${stamp()}.csv`, titlesCsv(state.result.titleSuggestions || []), 'text/csv;charset=utf-8'));
  $('dl-prod').addEventListener('click', () => saveFile(`produkter-att-utesluta-${stamp()}.csv`, productsCsv(state.result.productExclusions || []), 'text/csv;charset=utf-8'));
  $('copy-neg').addEventListener('click', async () => {
    const text = negativesPasteList(state.result.negatives || []);
    try { await navigator.clipboard.writeText(text); $('dl-msg').textContent = 'Listan är kopierad. Klistra in den i en lista med negativa sökord i Google Ads.'; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.rows = 6; ta.style.width = '100%'; ta.readOnly = true;
      $('dl-msg').textContent = 'Kopiera listan nedan (markera allt och kopiera):'; $('dl-msg').after(ta); ta.select();
    }
  });

  function buildReportHtml(r) {
    const e = esc, sevTxt = { crit: 'Allvarligt fel', warn: 'Anmärkning', info: 'Notering' };
    const dqOk = !r.dataQuality || r.dataQuality.level === 'ok';
    const M = r.modules, bm = M.performance.benchmark.metrics;
    const benchRows = [['ctr', 'Klickfrekvens (CTR)', fmtPct], ['cvr', 'Konverteringsgrad', fmtPct], ['cpc', 'Kostnad per klick', fmtKr], ['cpa', 'Kostnad per konvertering', fmtKr]]
      .map(([k, l, f]) => `<tr><td>${l}</td><td>${f(bm[k].you)}</td><td>${bm[k].verdict === 'nocur' ? nf2.format(bm[k].bench) + ' USD' : f(bm[k].bench)}</td></tr>`).join('');
    const finds = r.findings.map((f, i) => `<section class="f ${f.sev}"><p class="sev">${i + 1}. ${sevTxt[f.sev]}</p><h3>${e(f.title)}</h3><p>${e(f.freeText)}</p><p class="muted">${e(f.detail)}</p>${f.items.length ? `<div class="coll${f.items.length > LIST_LIMIT ? ' collapsed' : ''}"><table><tbody>${f.items.map((it, j) => `<tr${j >= LIST_LIMIT ? ' class="more"' : ''}><td>${e(it.name)}</td><td class="r">${e(it.value)}</td></tr>`).join('')}</tbody></table>${f.items.length > LIST_LIMIT ? toggleBtn(f.items.length) : ''}</div>` : ''}${f.saving ? `<p class="sav">Möjlig besparing: ${fmtRange(f.saving.low, f.saving.high)} per månad</p>` : ''}${(f.tips || []).length ? `<h4>Så åtgärdar du det</h4><ol>${f.tips.map(t => `<li>${e(t)}</li>`).join('')}</ol>` : ''}</section>`).join('');
    const negs = (r.negatives || []);
    const negTable = negs.length ? `<h2>Negativa sökord (${negs.length} st)</h2><p>Ladda upp CSV-filen i Google Ads Editor (Konto › Importera › Från fil) eller klistra in listan i en delad lista med negativa sökord. Granska listan innan du laddar upp. ${e(CONF_NOTE)}</p><div class="coll${negs.length > LIST_LIMIT ? ' collapsed' : ''}"><table><thead><tr><th>Sökord</th><th>Matchning</th><th>Kampanj</th><th>Skäl</th><th>Säkerhet</th><th class="r">Kostnad/mån</th></tr></thead><tbody>${negs.map((n, j) => `<tr${j >= LIST_LIMIT ? ' class="more"' : ''}><td class="m">${e(n.match === 'exact' ? '[' + n.keyword + ']' : '"' + n.keyword + '"')}</td><td>${n.match === 'exact' ? 'Exakt' : 'Fras'}</td><td>${e(n.campaign)}</td><td>${e(n.reason)}</td><td>${e(confText(n.confidence, n.risk))}</td><td class="r">${fmtKr(n.costMonthly)}</td></tr>`).join('')}</tbody></table>${negs.length > LIST_LIMIT ? toggleBtn(negs.length) : ''}</div>` : '';
    const pk = r.pauseKeywords || [], px = r.productExclusions || [];
    const collT = (head, rows) => `<div class="coll${rows.length > LIST_LIMIT ? ' collapsed' : ''}"><table><thead><tr>${head}</tr></thead><tbody>${rows.map((x, j) => x.replace('<tr>', j >= LIST_LIMIT ? '<tr class="more">' : '<tr>')).join('')}</tbody></table>${rows.length > LIST_LIMIT ? toggleBtn(rows.length) : ''}</div>`;
    const pauseT = pk.length ? `<h2>Sökord att pausa (${pk.length} st)</h2><p>Importera CSV-filen i Google Ads Editor. Säsongssökord är undantagna.</p>${collT('<th>Sökord</th><th>Kampanj</th><th>Annonsgrupp</th><th>Skäl</th><th>Säkerhet</th><th class="r">Kostnad/mån</th>', pk.map(k => `<tr><td class="m">${e(k.keyword)}</td><td>${e(k.campaign)}</td><td>${e(k.adGroup || '–')}</td><td>${e(k.why)}</td><td>${e(confText(k.confidence, k.risk))}</td><td class="r">${fmtKr(k.costMonthly)}</td></tr>`))}` : '';
    const prodT = px.length ? `<h2>Produkter att utesluta (${px.length} st)</h2><p>Ladda upp CSV-filen som tilläggsflöde i Merchant Center (${e(CONFIG.productLabel.column)} = "${e(CONFIG.productLabel.value)}") och uteslut etiketten i kampanjen.</p>${collT('<th>Artikel-id</th><th>Produkt</th><th>Skäl</th><th>Säkerhet</th><th class="r">Kostnad/mån</th>', px.map(p => `<tr><td class="m">${e(p.itemId)}</td><td>${e(p.title || '–')}</td><td>${e(p.why)}</td><td>${e(confText(p.confidence, p.risk))}</td><td class="r">${fmtKr(p.costMonthly)}</td></tr>`))}` : '';
    const W = M.wow;
    const wow = W.available ? `<h2>Vecka mot vecka</h2><p class="muted">${e(W.curLabel)} mot ${e(W.prevLabel)}</p><table><thead><tr><th>Mått</th><th class="r">Veckan innan</th><th class="r">Senaste 7 dagar</th><th class="r">Förändring</th></tr></thead><tbody>${W.changes.filter(c => c.cur != null).map(c => { const f = ['ctr', 'cvr'].includes(c.k) ? fmtPct : ['cost', 'cpa', 'cpc'].includes(c.k) ? fmtKr : (v => v == null ? '–' : nf0.format(v)); return `<tr><td>${c.sv}</td><td class="r">${f(c.prev)}</td><td class="r">${f(c.cur)}</td><td class="r">${fmtDelta(c.delta)}</td></tr>`; }).join('')}</tbody></table>` : '';
    const P = M.pacing;
    const pace = P.available && P.projected != null ? `<h2>Budgettakt</h2><p>${P.month ? `Med nuvarande takt landar ${P.month} på ${fmtKr(P.projected)} mot en budget på ${fmtKr(P.monthBudget)} (${Math.round(P.ratio * 100)} %).` : `Nuvarande takt motsvarar ${fmtKr(P.projected)} per månad mot en budget på ${fmtKr(P.monthBudget)}.`}</p>` : '';
    return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@300..700&family=JetBrains+Mono&display=swap"><title>Annonsbesiktning ${e(r.period.to || stamp())}</title><style>
body{font:15px/1.6 'Instrument Sans','Helvetica Neue',-apple-system,'Segoe UI',Arial,sans-serif;color:#1C2321;background:#fff;max-width:820px;margin:0 auto;padding:40px 24px}
h1{font-size:40px;font-weight:600;letter-spacing:-.035em;margin:0 0 8px}h2{font-size:20px;font-weight:600;letter-spacing:-.02em;margin:40px 0 12px;padding-bottom:8px;border-bottom:1px solid #E2E7E4}h3{font-size:16px;font-weight:600;margin:6px 0}h4{margin:14px 0 6px;font-size:13px;font-weight:600;color:#2E5E50}
.band{color:#687270;font-size:12.5px;margin-bottom:28px}.band:before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:#2E5E50;margin-right:8px}
.meta{display:flex;flex-wrap:wrap;gap:6px 24px;color:#687270;font-size:13.5px}.score{font-size:80px;font-weight:300;letter-spacing:-.05em;line-height:1;margin:28px 0 8px}.verdict{font-weight:600;font-size:16px;display:inline-block;padding:6px 14px;border-radius:999px;background:#EEF2EF}
.figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:20px 0}.figs div{background:#EEF2EF;padding:14px 16px;border-radius:12px;font-size:13px;color:#687270}.figs b{display:block;font-size:22px;font-weight:500;letter-spacing:-.02em;color:#1C2321;margin:4px 0}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:14px}td,th{border-bottom:1px solid #E2E7E4;padding:8px 10px 8px 0;text-align:left;vertical-align:top}th{font-weight:500;color:#687270;font-size:12.5px}.r{text-align:right;white-space:nowrap}.m{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:13px}
.f{padding:6px 0 18px;margin:18px 0;border-bottom:1px solid #E2E7E4;page-break-inside:avoid}.sev{font-size:12px;font-weight:600;margin:0;color:#687270}.f.crit .sev{color:#B0443B}.f.warn .sev{color:#A8701C}
.muted{color:#687270}.sav{color:#2E7A56;font-weight:600}ol{padding-left:20px}li{margin:5px 0}.print{margin:20px 0 0;padding:10px 20px;border:0;background:#2E5E50;color:#fff;font:500 14px/1 inherit;cursor:pointer;border-radius:999px}
.foot{margin-top:48px;font-size:12px;color:#687270}.coll.collapsed .more{display:none}.toggle{margin:8px 0 2px;padding:6px 14px;border:1px solid #E2E7E4;background:#fff;border-radius:999px;font:500 13px/1.2 inherit;cursor:pointer}@media print{.print,.toggle{display:none}body{padding:0}.coll.collapsed .more{display:table-row}}
</style></head><body>
<div class="band">Besiktningsprotokoll · Google Ads · ${e(CONFIG.agencyName)}</div>
<h1>Annonsbesiktningen</h1>
<div class="meta"><span>Period: ${e(r.period.from ? r.period.from + ' – ' + r.period.to : 'okänd')}</span><span>Bransch: ${e(r.industry)}</span><span>Kostnad per månad: ${fmtKr(r.spendMonthly)}</span><span>Skapad: ${stamp()}</span></div>
<button class="print" onclick="window.print()">Skriv ut eller spara som PDF</button>
<p class="score">${r.overall == null ? '–' : r.overall}<span style="font-size:20px;color:#687270;letter-spacing:0">/100</span></p>
<p class="verdict">${e(r.verdict ? r.verdict.label : '')}${dqOk ? '' : ' · preliminärt'}</p><p>${e(r.verdict ? r.verdict.text : '')}</p>
${dqOk ? '' : `<div style="margin:18px 0;padding:14px 16px;border-left:3px solid ${r.dataQuality.level === 'verylow' ? '#B4442E' : '#B07A12'};background:#F7F3EA;border-radius:8px"><b>${e(r.dataQuality.title)}</b><p style="margin:6px 0 0">${e(r.dataQuality.text)} ${e(r.dataQuality.advice)}</p></div>`}
<div class="figs"><div>Uppskattat slöseri<b>${M.waste.available ? fmtKr(r.wasteMonthly) : '–'}</b>per månad</div><div>Möjlig besparing<b>${(r.savings || {}).high ? fmtRange(r.savings.low, r.savings.high) : '–'}</b>per månad</div><div>Missade konverteringar<b>${r.missedConvMonthly ? '≈ ' + Math.round(r.missedConvMonthly) : '–'}</b>per månad</div><div>Fynd<b>${r.findings.length}</b>${r.counts.crit} allvarliga, ${r.counts.warn} anmärkningar</div></div>
${(r.narrative || []).length ? `<h2>Analys</h2>${r.narrative.map(p => `<h3>${e(p.h)}</h3><p>${e(p.t)}</p>`).join('')}` : ''}
<h2>Du mot branschen</h2><p class="muted">${e(M.performance.benchmark.industry)}, ${e(M.performance.benchmark.scope)}</p><table><thead><tr><th>Mått</th><th>Ditt konto</th><th>Branschsnitt</th></tr></thead><tbody>${benchRows}</tbody></table>
<h2>Fynd och åtgärder</h2>${finds || '<p>Inga fynd.</p>'}
${negTable}${pauseT}${prodT}${pace}${wow}
<script>${TOGGLE_JS}<\/script>
<p class="foot">Branschsnitt: ${e(CONFIG.benchmarkSource)}. Siffrorna är uppskattningar baserade på de exporter som laddades upp, omräknade till månadsbelopp.</p>
</body></html>`;
  }

  /* ===== Admin ===== */
  function setAdmin(on) {
    state.admin = on;
    $('admin-bar').hidden = !on;
    $('admin-login').hidden = true;
    if (on && state.result) render(state.result);
  }
  $('admin-preview-btn').addEventListener('click', () => {
    state.preview = !state.preview;
    $('admin-preview-btn').setAttribute('aria-pressed', String(state.preview));
    $('admin-status').textContent = state.preview ? 'Du ser sidan som en prospekt.' : 'Allt är upplåst för dig.';
    $('leads').hidden = state.preview || $('admin-leads-btn').getAttribute('aria-pressed') !== 'true';
    state.unlocked = false;
    if (state.result) render(state.result);
  });
  $('admin-leads-btn').addEventListener('click', () => {
    const p = $('leads'); p.hidden = !p.hidden;
    $('admin-leads-btn').setAttribute('aria-pressed', String(!p.hidden));
    if (!p.hidden) p.scrollIntoView({ block: 'start' });
  });

  function openLead(lead) {
    if (!lead || !lead.result || !lead.result.modules) throw new Error('bad');
    state.lead = lead; state.sample = false; state.unlocked = false;
    setCurrency(lead.result.currency || 'SEK');
    state.result = lead.result;
    render(lead.result);
    $('example-note').hidden = true;
    const n = $('lead-note');
    n.hidden = false;
    n.innerHTML = '';
    const strong = document.createElement('strong'); strong.textContent = 'Lead';
    const span = document.createElement('span');
    span.textContent = [lead.company || 'Företag saknas', lead.email, lead.website, lead.submittedAt ? new Date(lead.submittedAt).toLocaleString('sv-SE') : ''].filter(Boolean).join(' · ');
    n.append(strong, span);
    markActiveLead();
    n.scrollIntoView({ block: 'start' });
  }
  function markActiveLead() {
    document.querySelectorAll('#leads-body tr').forEach(tr => tr.classList.toggle('active', !!state.lead && tr.dataset.id === state.lead._id));
  }
  function renderLeads() {
    $('leads-count').textContent = `${state.leads.length} st`;
    $('leads-empty').hidden = !!state.leads.length;
    $('leads-source').textContent = 'Leads från alla besökare, nyast först. Leads raderas automatiskt efter ' + CONFIG.leadRetentionMonths + ' månader.';
    $('leads-body').innerHTML = state.leads.map(l => {
      const a = l.audit || {}, p = l.profile || {};
      return `<tr data-id="${esc(l.id)}"><td class="n">${esc((l.created_at || '').slice(0, 10))}</td><td>${esc(l.company || '–')}<div class="small muted">${esc(l.website || '')}</div>${p.industryText ? `<div class="small muted">Annan bransch: ${esc(p.industryText)}</div>` : ''}</td><td>${esc(p.budget ? (Q.budget.find(o => o.v === p.budget) || {}).t || '' : '–')}</td><td>${esc(l.email || '')}</td><td class="n">${a.score == null ? '–' : esc(a.score)}</td><td class="n">${a.spendMonthly != null ? esc(nf0.format(a.spendMonthly)) : '–'}</td><td class="n">${a.wasteMonthly != null ? esc(nf0.format(a.wasteMonthly)) : '–'}</td><td class="n">${a.findings ? a.findings.length : '–'}</td><td>${l.paid ? '<span class="chip good">Köpt</span>' : ''}</td><td><button class="btn" type="button" data-open="${esc(l.id)}">Öppna</button></td></tr>`;
    }).join('');
    $('leads-body').querySelectorAll('[data-open]').forEach(btn => btn.addEventListener('click', async () => {
      const l = state.leads.find(x => x.id === btn.dataset.open);
      const t = btn.textContent; btn.textContent = 'Hämtar …';
      try { const result = await backend.getLeadResult(l.id); openLead({ ...l, _id: l.id, submittedAt: l.created_at, result }); btn.textContent = t; }
      catch (e) { log('warn', e); btn.textContent = 'Saknar protokoll'; btn.disabled = true; }
    }));
    $('admin-leads-btn').textContent = `Leads (${state.leads.length})`;
    markActiveLead();
  }
  async function loadLeads() {
    try { state.leads = await backend.listLeads(); $('leads-error').hidden = true; }
    catch (e) { log('warn', 'Leads kunde inte läsas', e); $('leads-error').hidden = false; $('leads-error').textContent = 'Leads kunde inte hämtas. Kontrollera att din e-post finns i tabellen admins i Supabase.'; }
    renderLeads();
  }
  $('leads-refresh').addEventListener('click', loadLeads);

  // Inloggning: öppna sidan med #admin och få en inloggningslänk till din e-post
  async function sendLoginLink() {
    const er = $('login-error'), ok = $('login-sent'); er.hidden = true; ok.hidden = true;
    const email = $('admin-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { er.hidden = false; er.textContent = 'Skriv din e-postadress.'; return; }
    if (!backend.configured()) { er.hidden = false; er.textContent = 'Supabase är inte inställt än (src/config.js).'; return; }
    const btn = $('admin-login-btn'); btn.disabled = true;
    try { await backend.sendLoginLink(email); ok.hidden = false; ok.textContent = `En inloggningslänk är skickad till ${email}. Öppna den i den här webbläsaren.`; }
    catch (e) { er.hidden = false; er.textContent = 'Länken kunde inte skickas. Vänta en minut och försök igen.'; log('warn', e); }
    finally { btn.disabled = false; }
  }
  $('admin-login-btn').addEventListener('click', sendLoginLink);
  $('admin-email').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); sendLoginLink(); } });
  $('admin-logout-btn').addEventListener('click', async () => { await backend.signOut(); state.admin = false; $('admin-bar').hidden = true; $('leads').hidden = true; if (state.result) render(state.result); });

  // Ladda bara Supabase-klienten för den som är (eller håller på att bli) inloggad, inte för vanliga besökare
  const hasSession = () => { try { return Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k)); } catch (e) { return false; } };
  async function checkAdmin() {
    const h = location.hash;
    const wantsAdmin = h === '#admin' || /access_token=|error_description=/.test(h) || /[?&]admin=1/.test(location.search);
    if (!backend.configured() || (!wantsAdmin && !hasSession())) return;
    if (!authWatch) { authWatch = true; backend.onAuthChange(() => { if (!state.admin) checkAdmin(); }); }
    const who = await backend.currentAdmin().catch(() => null);
    if (who && who.admin) { $('admin-who').textContent = who.email; setAdmin(true); loadLeads(); return; }
    if (!wantsAdmin) return;
    $('admin-login').hidden = false;
    if (who && !who.admin) { const er = $('login-error'); er.hidden = false; er.textContent = `${who.email} är inloggad men är inte admin. Lägg till adressen i tabellen admins i Supabase.`; }
    if (/error_description=/.test(h)) { const er = $('login-error'); er.hidden = false; er.textContent = 'Inloggningslänken har gått ut eller redan använts. Skicka en ny.'; }
  }
  window.addEventListener('hashchange', checkAdmin);
  let authWatch = false;

  // Höjd till förälder vid inbäddning
  if (window.parent !== window && 'ResizeObserver' in window) {
    new ResizeObserver(() => window.parent.postMessage({ type: 'annonsbesiktning:height', height: document.documentElement.scrollHeight }, '*')).observe(document.body);
  }

  // Öppna med exempelprotokoll så att sidan visar vad den gör
  loadSample(false);
  checkAdmin();
  checkPaidReturn();
}
