/* One market map. Score, factors, footprint, utilities and ERCOT data: data/expansion-map.json
   (built by analysis/build_expansion.py from Census, EIA-861, FEMA and ERCOT). Shapes, price, bill and
   two-year outages: data/market-states.json (EIA Tables 5A and 11.3, us-atlas). Scoring: notes/score.js. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (n, d = 0) => (n === null || n === undefined || n !== n) ? 'n/a' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const S = () => window.ExpansionScore;

  // Base palette: orange-5, orange-40, orange-60, orange-90 for value layers; greens for tiers.
  const WARM = ['#fbe3d8', '#f09064', '#ed6c30', '#742c0b'];
  const NODATA = '#eceae6';
  const TIERS = [
    { id: 'S', label: 'Strongest fit', fill: '#1e4d2b' }, { id: 'A', label: 'Strong fit', fill: '#77a45a' },
    { id: 'B', label: 'Mixed fit', fill: '#b2dd79' }, { id: 'C', label: 'Weak fit', fill: '#d6f0b4' },
    { id: 'Later', label: 'Thin public case', fill: '#d8d7d5' },
  ];
  // Weight presets. A preset sets each factor to its default weight or 0.
  const RETAIL_PATH = ['retail', 'wholesale', 'launch_path'];
  const PRESETS = {
    equal: () => true,
    retail: (f) => f.id !== 'partner',
    partner: (f) => f.id !== 'retail' && f.id !== 'launch_path', // keeps wholesale share: a partner's battery still earns in the market
    pull: (f) => f.group === 'Customer pull',
    nosize: (f) => f.id !== 'homes',
  };
  const EXTRA = {
    saidi_avg: { label: 'Minutes without power, 2024 and 2025 average', unit: (v) => fmt(v) + ' min', bins: [200, 400, 800] },
    cents_kwh: { label: 'Residential power price, 2025', unit: (v) => fmt(v, 1) + '¢', bins: [13, 16, 20] },
    bill_usd: { label: 'Average monthly bill, 2025', unit: (v) => '$' + fmt(v), bins: [130, 160, 190] },
  };

  // byName and scored are Maps: a name from the URL (?state=__proto__) or a search box must never reach Object.prototype.
  let E, M, states, weights = {}, scored = new Map(), layer = 'score', selected = null, svg, view, home, byName = new Map();
  let yours = null, publicZ = null; // yours: { factors, values: { TX: { id: n } } } from a loaded file; never written into E
  const data = (name) => byName.get(name);
  // A state from typed or URL text: full name or two-letter code, any case. Returns the state row or null.
  function findState(text) {
    const v = String(text == null ? '' : text).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!v) return null;
    return states.find((o) => o.name.toLowerCase() === v || o.abbr.toLowerCase() === v) || null;
  }
  // Public factors, then the company's own ("Yours") factors from a loaded file.
  const allFactors = () => (yours ? E.factors.concat(yours.factors) : E.factors);
  const isYours = (id) => !!(yours && yours.factors.some((f) => f.id === id));
  // A factor's raw value for a state or utility row. Your metrics are per state only.
  function val(row, f) {
    if (!f.yours) return row.values[f.id];
    const v = row.abbr && !row.state && yours.values[row.abbr];
    return v && v[f.id] != null ? v[f.id] : null;
  }
  const yoursTag = (f) => (f.yours ? ' <span class="badge badge-solid">Yours</span>' : '');

  function factorFmt(id, v) {
    if (v === null || v === undefined || v !== v) return 'n/a';
    if (isYours(id)) return fmt(v, Number.isInteger(v) ? 0 : 2);
    if (id === 'homes' || id === 'saidi') return fmt(v);
    if (id === 'saifi') return fmt(v, 2);
    if (id === 'retail' || id === 'wholesale' || id === 'partner') return fmt(v * 100, 1) + '%';
    if (id === 'launch_path') return v >= 1 ? 'open' : v > 0 ? 'partly open' : 'not open';
    if (id === 'price') return fmt(v, 1) + '¢/kWh';
    if (id === 'batteries' || id === 'demand_response' || id === 'dynamic_pricing') return fmt(v, v < 10 ? 1 : 0);
    if (id === 'storm' || id === 'heat') return fmt(v, 1);
    return fmt(v, 2);
  }

  // ---------- scoring (same math as Cursor's page, via notes/score.js) ----------
  function rank(rows, fs = allFactors()) {
    const table = {};
    rows.forEach((row) => { table[row.id] = { id: row.id }; });
    fs.forEach((f) => {
      const r = S().percentileRanks(rows.map((row) => (window.MarketCore ? window.MarketCore.rankValue(f, val(row, f)) : val(row, f))));
      rows.forEach((row, i) => { (table[row.id] = table[row.id] || { id: row.id })[f.id] = r[i]; });
    });
    const rankRows = rows.map((row) => table[row.id]);
    const sc = S().composite(rankRows, weights);
    return rows.map((row, i) => ({ row, score: sc[i], factors: rankRows[i] }));
  }
  function rescore() {
    const ranked = rank(states).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.row.name.localeCompare(b.row.name));
    scored = new Map();
    // Only scored states get a rank. With every weight at 0 nothing is scored, so nothing is ranked.
    ranked.forEach((it, i) => { scored.set(it.row.name, { score: it.score, rank: it.score == null ? null : i + 1, tier: S().tierOf(it.score), factors: it.factors }); });
    return ranked;
  }
  const pts = (s) => (s === null || s === undefined ? 'n/a' : String(Math.round(s * 100)));

  function why(name) {
    const st = data(name), it = scored.get(name);
    const parts = allFactors().filter((f) => weights[f.id] > 0 && it.factors[f.id] != null).map((f) => ({ f, r: it.factors[f.id] })).sort((a, b) => b.r - a.r);
    if (!parts.length) return 'No weighted factor has a published value here.';
    const lc = (t) => t.charAt(0).toLowerCase() + t.slice(1);
    const v = (f) => factorFmt(f.id, val(st, f));
    const PLAIN = {
      saidi: (f) => `${v(f)} outage minutes a year (SAIDI, 2021 to 2025 median)`,
      saifi: (f) => `${v(f)} outages a year per customer (SAIFI)`,
      homes: (f) => `${v(f)} owner-occupied single-family homes`,
      demand_response: (f) => `${v(f)} demand response enrollments per 1,000 customers`,
      dynamic_pricing: (f) => `${v(f)} dynamic pricing enrollments per 1,000 customers`,
      batteries: (f) => `${v(f)} home batteries per 1,000 customers`,
      price: (f) => `power at ${v(f)}`,
      partner: (f) => `${v(f)} of homes on co-ops and public power`,
      retail: (f) => `${v(f)} of homes already on a competitive supplier`,
      launch_path: (f) => `retail choice ${v(f)}`,
    };
    const ph = (f) => (f.yours ? `your ${f.label} ${v(f)}` : PLAIN[f.id] ? PLAIN[f.id](f) : `${lc(f.label)} ${v(f)}`);
    let t = 'Leads on ' + parts.slice(0, 2).map((p) => ph(p.f)).join(' and ') + '.';
    const low = parts[parts.length - 1];
    if (parts.length > 2 && low.r < 0.5) t += ' Weakest: ' + ph(low.f) + '.';
    return t;
  }

  // ---------- layers ----------
  function layerValue(st) {
    if (layer === 'score') return scored.get(st.name).score;
    if (EXTRA[layer]) return st[layer];
    return scored.get(st.name).factors[layer]; // percentile rank 0..1
  }
  function fillFor(st) {
    if (layer === 'score') { const t = TIERS.find((x) => x.id === scored.get(st.name).tier); return t ? t.fill : NODATA; }
    const v = layerValue(st);
    if (v === null || v === undefined) return NODATA;
    const b = EXTRA[layer] ? EXTRA[layer].bins : [0.25, 0.5, 0.75];
    return WARM[v < b[0] ? 0 : v < b[1] ? 1 : v < b[2] ? 2 : 3];
  }
  function legend() {
    if (layer === 'score') {
      $('lg-title').textContent = 'Expansion score tier';
      $('legend').innerHTML = TIERS.map((t) => `<li><i style="background:${t.fill}"></i>${t.id} · ${t.label}</li>`).join('');
      return;
    }
    if (EXTRA[layer]) {
      const X = EXTRA[layer], b = X.bins, u = X.unit;
      $('lg-title').textContent = X.label;
      const labs = [`Over ${u(b[2])}`, `${u(b[1])} to ${u(b[2])}`, `${u(b[0])} to ${u(b[1])}`, `Under ${u(b[0])}`];
      $('legend').innerHTML = labs.map((t, i) => `<li><i style="background:${WARM[3 - i]}"></i>${t}</li>`).join('');
      return;
    }
    const f = allFactors().find((x) => x.id === layer);
    $('lg-title').textContent = f.label + (f.yours ? ' (yours, ' + (f.higherIsBetter ? '' : 'lower is better, ') + 'rank among states)' : ' (rank among states)');
    $('legend').innerHTML = ['Top quarter', 'Second quarter', 'Third quarter', 'Bottom quarter'].map((t, i) => `<li><i style="background:${WARM[3 - i]}"></i>${t}</li>`).join('') + '<li><i style="background:#eceae6"></i>No data</li>';
  }

  // The answer first: the three strongest states outside Base's public footprint at these weights.
  function outside(ranked) { return ranked.filter((it) => !it.row.footprint && it.score != null); }
  function overview(ranked) {
    const next = outside(ranked).slice(0, 3);
    const preset = document.querySelector('[data-preset][aria-pressed="true"]');
    const how = preset ? preset.textContent.trim().toLowerCase() + ' weights' : 'your weights';
    $('ov-lede').textContent = next.length
      ? `At ${how}, the strongest states outside Base's public footprint are ${next.map((it) => it.row.name).join(', ').replace(/, ([^,]*)$/, ' and $1')}. Each score is a relative fit from public data, not a forecast.`
      : 'No state outside Base\u2019s footprint has a score at these weights. Raise a weight under Score weights.';
    $('ov-stats').innerHTML = next.length ? '<p class="mm-h">Next 3 outside Base\u2019s footprint</p><ol class="mm-next">' + next.map((it, i) => {
      const r = scored.get(it.row.name);
      return `<li><button type="button" class="mm-next-btn" data-state="${esc(it.row.name)}"><span class="mm-next-rank">${i + 1}</span><span class="mm-next-body"><b>${esc(it.row.name)}</b> <span class="badge ${r.tier === 'S' || r.tier === 'A' ? 'badge-green' : ''}">${esc(r.tier)} \u00b7 ${pts(it.score)}</span><span class="mm-next-overall">#${r.rank} overall</span><span class="mm-next-why">${esc(why(it.row.name))}</span></span></button></li>`;
    }).join('') + '</ol>' : '';
  }

  function tiers(ranked) {
    if (!ranked.some((it) => scored.get(it.row.name).tier)) { $('tiers').innerHTML = '<p class="mm-small">No state has a score. Every weight is 0, or no weighted factor has data. Raise a weight under Score weights.</p>'; return; }
    $('tiers').innerHTML = TIERS.map((t) => {
      const list = ranked.filter((it) => scored.get(it.row.name).tier === t.id);
      if (!list.length) return '';
      return `<div class="mm-tier"><span class="mm-tier-id" style="background:${t.fill};color:${t.id === 'S' ? '#fff' : '#102a17'}" title="${esc(t.label)}">${t.id}</span><div>` +
        list.map((it) => `<button type="button" class="mm-chip" aria-pressed="${it.row.name === selected}" data-state="${esc(it.row.name)}">${esc(it.row.abbr)} <b>${pts(it.score)}</b></button>`).join('') + '</div></div>';
    }).join('');
  }

  function paint() {
    const ranked = rescore();
    svg.querySelectorAll('.st').forEach((p) => {
      const st = data(p.dataset.name), it = scored.get(st.name);
      p.setAttribute('fill', fillFor(st));
      p.setAttribute('aria-label', `${st.name}, tier ${it.tier || 'none'}, score ${pts(it.score)}${it.rank ? ', rank ' + it.rank : ', not ranked'}`);
    });
    svg.classList.toggle('warm', layer !== 'score');
    legend(); overview(ranked); tiers(ranked); shares(); partners();
    if (selected) detail(selected, false);
  }

  // ---------- detail ----------
  function detail(name, scroll = true) {
    const st = data(name), it = scored.get(name); selected = name;
    svg.querySelectorAll('.st').forEach((p) => p.classList.toggle('sel', p.dataset.name === name));
    ring('sel-ring', name);
    document.querySelectorAll('.mm-chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.state === name)));
    const fpCls = { operating: 'notice-green', announced: 'mm-flag-planned' }[st.footprint && st.footprint.status] || '';
    const fpSrc = st.footprint && st.footprint.source ? ` Source: <a href="${esc(st.footprint.source.url)}">${esc(st.footprint.source.title)}</a>${st.footprint.source.retrieved ? ', checked ' + esc(st.footprint.source.retrieved) : ''}.` : '';
    const fp = st.footprint ? `<p class="notice mm-flag ${fpCls}"><b>${esc(st.footprint.label)}.</b> ${esc(st.footprint.detail)}${fpSrc}</p>` : '';
    const rc = st.detail.retail_choice;
    const rcLine = rc ? `<p class="mm-small"><b>Retail choice for homes: ${rc.open ? 'open' : 'not open'}.</b> ${esc(rc.note)} Source: ${rc.url ? `<a href="${esc(rc.url)}">${esc(rc.source)}</a>` : esc(rc.source)}, checked ${esc(rc.checked)}.</p>` : '';
    const rows = allFactors().map((f) => `<dt>${esc(f.label)}${yoursTag(f)}</dt><dd>${factorFmt(f.id, val(st, f))}</dd>`).join('');
    const c = $('detail'); c.hidden = false;
    const nRanked = states.filter((x) => scored.get(x.name).rank).length;
    const place = it.rank ? `#${it.rank} of ${nRanked}` : 'not ranked: no weighted factor is scored';
    c.innerHTML = `<p class="mm-small">Tier ${it.tier || 'n/a'} · score ${pts(it.score)} · ${place}</p>
      <h2>${esc(name)}</h2>${fp}<p class="mm-why">${esc(why(name))}</p>
      <dl>${rows}
        <dt>Power price, 2025</dt><dd>${fmt(st.cents_kwh, 2)}¢/kWh</dd>
        <dt>Monthly bill, 2025</dt><dd>$${fmt(st.bill_usd, 2)}</dd>
        <dt>Grid operators</dt><dd>${esc(st.detail.rtos || 'n/a')}</dd></dl>
      ${rcLine}${st.detail.note ? `<p class="mm-small">${esc(st.detail.note)}</p>` : ''}`;
    if (st.abbr === 'TX') { const s = $('sec-value'); s.open = true; c.insertAdjacentHTML('beforeend', '<p class="mm-small"><a href="#sec-value">Where one battery earns most inside Texas</a></p>'); }
    utilities(st);
    if (scroll) { $('ov-body').hidden = false; $('ov-toggle').setAttribute('aria-expanded', 'true'); const pnl = $('overview'); pnl.scrollTop = c.getBoundingClientRect().top - pnl.getBoundingClientRect().top + pnl.scrollTop - 8; }
  }
  function utilities(st) {
    const rows = E.utilities.filter((u) => u.state === st.abbr);
    if (!rows.length) { $('utilities').innerHTML = `<p class="mm-small">No utilities listed for ${esc(st.name)}.</p>`; return; }
    const ranked = rank(rows, E.factors).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 8);
    $('utilities').innerHTML = `<p class="mm-small">${rows.length} utilities in ${esc(st.name)}, scored against each other with the same weights. Top ${ranked.length}:</p><div class="mm-scroll"><table class="ds-table"><thead><tr><th>Utility</th><th class="num">Score</th><th class="num">Homes</th><th class="num">Outage min</th></tr></thead><tbody>` +
      ranked.map((it) => `<tr><td>${esc(it.row.name)}${partnerTag(it.row)}</td><td class="num">${pts(it.score)}</td><td class="num">${factorFmt('homes', it.row.values.homes)}</td><td class="num">${factorFmt('saidi', it.row.values.saidi)}</td></tr>`).join('') + '</tbody></table></div>';
  }

  // How much of the score each group carries at the current weights. Correlated factors in one group
  // (four outage and hazard measures, three retail-access measures) add up, so this is shown, not hidden.
  function shares() {
    if (!$('shares')) return;
    const tot = allFactors().reduce((a, f) => a + (weights[f.id] || 0), 0);
    if (!tot) { $('shares').textContent = 'Every weight is 0.'; return; }
    const g = new Map();
    allFactors().forEach((f) => g.set(f.group, (g.get(f.group) || 0) + (weights[f.id] || 0)));
    $('shares').innerHTML = 'Share of the score: ' + [...g].filter(([, w]) => w > 0).map(([k, w]) => `<b>${esc(k)} ${Math.round((w / tot) * 100)}%</b>`).join(', ') + '.';
  }

  // ---------- downloads (formula-safe CSV) ----------
  const csvCell = (v) => { let t = v == null ? '' : String(v); if (/^[=+\-@]/.test(t)) t = "'" + t; return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  function saveCSV(name, header, rows) {
    const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const UNIT = { homes: 'homes', saidi: 'saidi_minutes', saifi: 'saifi_per_customer', storm: 'storm_risk_score', heat: 'heat_risk_score', retail: 'competitive_supplier_pct', wholesale: 'wholesale_market_pct', partner: 'coop_public_power_pct', batteries: 'batteries_per_1000', demand_response: 'demand_response_per_1000', dynamic_pricing: 'dynamic_pricing_per_1000', launch_path: 'retail_choice_open', price: 'price_cents_per_kwh' };
  const PCT = new Set(['retail', 'wholesale', 'partner']);
  const DP = { homes: 0, saidi: 0, saifi: 2, storm: 1, heat: 1, price: 2, launch_path: 1 };
  function csvVal(f, v) {
    if (v == null || v !== v) return '';
    if (PCT.has(f.id)) return (v * 100).toFixed(1);
    return f.yours ? v : Number(v).toFixed(DP[f.id] ?? 1);
  }
  function presetName() { const b = document.querySelector('[data-preset][aria-pressed="true"]'); return b ? b.dataset.preset : 'custom'; }
  function downloadRanking() {
    const fs = allFactors();
    const ranked = [...scored].sort((a, b) => (a[1].rank || 999) - (b[1].rank || 999));
    const wcol = 'weights: ' + fs.filter((f) => weights[f.id] > 0).map((f) => `${f.id}=${weights[f.id]}`).join(' ');
    saveCSV(`market-ranking-${presetName()}-weights.csv`, ['rank', 'state', 'abbr', 'tier', 'score', 'base_footprint', ...fs.map((f) => (f.yours ? f.id : UNIT[f.id] || f.id)), 'weights_used'],
      ranked.map(([name, it]) => { const st = data(name); return [it.rank || '', name, st.abbr, it.tier || '', pts(it.score), st.footprint ? st.footprint.label : '', ...fs.map((f) => csvVal(f, val(st, f))), wcol]; }));
  }

  // ---------- utility partner candidates (co-ops and public power, nationwide) ----------
  const PUBLIC = /^(Cooperative|Municipal|Political Subdivision|State|Federal)/i;
  // Utilities with a public Base partner program (EIA ids). Sources: the Texas and Georgia footprint
  // notes (Business Wire, 15 Jul 2026 and 13 Oct 2026). CoServ is Denton County Electric Cooperative.
  const BASE_PARTNERS = new Set(['1015-TX', '7752-TX', '5078-TX', '6182-TX', '1175-TX', '5701-TX', '3248-GA']);
  const partnerTag = (u) => (BASE_PARTNERS.has(u.id) ? ' <span class="badge badge-green">Base partner</span>' : '');
  const isPartner = (u) => (u.values && u.values.partner === 1) || PUBLIC.test(u.ownership || '');
  let partnerRows = [];
  function partners() {
    const box = $('partners'); if (!box) return;
    const pool = E.utilities.filter(isPartner);
    if (!pool.length) { box.innerHTML = '<p class="mm-small">Utility ownership is not in this data build.</p>'; $('dl-partners').hidden = true; return; }
    const all = rank(pool, E.factors).filter((it) => it.score != null).sort((a, b) => b.score - a.score);
    partnerRows = all.slice(0, 25);
    const mine = all.map((it, i) => ({ it, i })).filter((x) => BASE_PARTNERS.has(x.it.row.id));
    const nm = (u) => (u.id === '5078-TX' ? 'CoServ (Denton County Electric Cooperative)' : u.name);
    const mineLine = mine.length ? `</p><p class="notice mm-flag"><b>A limit worth knowing.</b> Base's current public-power partners rank ${mine.map((x) => `${esc(nm(x.it.row))} #${x.i + 1}`).join(', ')} of ${fmt(all.length)} here. Public data alone does not predict whom Base partners with: it has no distance to Base's crews, ERCOT zone value per utility, or board appetite. Treat this list as a long list to check, not a ranking. (El Paso Electric is investor owned, so it is not in this pool.)` : '';
    $('dl-partners').hidden = false;
    box.innerHTML = `<p class="mm-small">The ${partnerRows.length} highest-scoring of ${fmt(pool.length)} co-ops, city utilities and other public power utilities in the data, scored against each other with the current weights. These utilities reach homes through partner programs, the way Austin Energy, GVEC, CoServ and Central Georgia EMC work with Base. Base partners are marked. Select a state code to open it.${mineLine}</p><div class="mm-scroll"><table class="ds-table mm-ptable"><thead><tr><th>Utility</th><th class="num">Score</th><th class="num">Homes</th><th class="num">Outage min</th></tr></thead><tbody>` +
      partnerRows.map((it) => { const u = it.row, st = states.find((x) => x.abbr === u.state); return `<tr><td>${esc(u.name)}${partnerTag(u)}<span class="mm-sub">${st ? `<button type="button" class="mm-link" data-state="${esc(st.name)}">${esc(u.state)}</button>` : esc(u.state)} \u00b7 ${esc((u.ownership || 'Public power').replace('Political Subdivision', 'Public district'))}</span></td><td class="num">${pts(it.score)}</td><td class="num">${factorFmt('homes', u.values.homes)}</td><td class="num">${factorFmt('saidi', u.values.saidi)}</td></tr>`; }).join('') + '</tbody></table></div>';
  }
  function downloadPartners() {
    saveCSV(`utility-partner-candidates-${presetName()}-weights.csv`, ['rank', 'utility', 'eia_name', 'eia_id', 'state', 'ownership', 'base_partner', 'residential_customers', 'saidi_minutes', 'saifi', 'score'],
      partnerRows.map((it, i) => [i + 1, it.row.name, it.row.eia_name || it.row.name, it.row.id, it.row.state, it.row.ownership || '', BASE_PARTNERS.has(it.row.id) ? 'yes' : 'no', it.row.values.homes, it.row.values.saidi == null ? '' : Math.round(it.row.values.saidi), it.row.values.saifi == null ? '' : Number(it.row.values.saifi).toFixed(2), pts(it.score)]));
  }

  // ---------- weights ----------
  // Sliders for every factor. Public weights keep their current value when your factors come and go.
  function renderWeights() {
    let group = '';
    $('weights').innerHTML = allFactors().map((f) => {
      if (weights[f.id] === undefined) weights[f.id] = f.weight;
      const h = f.group !== group ? `<p class="mm-h">${esc((group = f.group))}${f.yours ? ' <span class="badge badge-solid">From your file</span>' : ''}</p>` : '';
      return h + `<label class="mm-w" title="${esc(f.help)}"><span>${esc(f.label)}</span><input type="range" min="0" max="3" step="0.5" value="${weights[f.id]}" data-w="${esc(f.id)}"><output id="o-${esc(f.id)}">${weights[f.id]}</output></label>`;
    }).join('');
  }
  function weightsUI() {
    E.factors.forEach((f) => { weights[f.id] = f.weight; });
    renderWeights();
    $('weights').addEventListener('input', (e) => {
      const id = e.target.dataset.w; if (!id) return;
      weights[id] = Number(e.target.value); $('o-' + id).textContent = e.target.value;
      document.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false')); paint();
    });
    document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const p = b.dataset.preset;
      allFactors().forEach((f) => {
        const on = f.yours || (PRESETS[p] || PRESETS.equal)(f);
        weights[f.id] = on ? f.weight : 0;
        document.querySelector(`[data-w="${CSS.escape(f.id)}"]`).value = weights[f.id]; $('o-' + f.id).textContent = weights[f.id];
      });
      document.querySelectorAll('[data-preset]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paint();
    }));
  }

  // ---------- static sections ----------
  function staticSections() {
    const er = E.ercot;
    $('ercot').innerHTML = !er || !er.available ? `<p class="mm-small">${esc((er && er.summary) || 'Not available in this build.')}</p>`
      : `<p class="notice mm-flag"><b>What this is.</b> Resource nodes are where generators settle. The table shows how far a node's day-ahead price ran above its load zone, which is a sign of grid congestion near that node. Homes settle at load zone prices, so this spread is not what a home battery earns. For battery value, see <a href="#sec-value">Where one battery earns most</a>.</p>` +
        `<p class="mm-small">${esc(er.summary)}</p><div class="mm-scroll"><table class="ds-table"><thead><tr><th>Resource node (generator)</th><th>Load zone</th><th class="num">p95 day-ahead $/MWh above its load zone</th></tr></thead><tbody>` +
        er.nodes.slice(0, 10).map((n) => `<tr><td>${esc(n.name)}</td><td>${esc(n.zone)}</td><td class="num">${fmt(n.p95_basis, 2)}</td></tr>`).join('') + '</tbody></table></div>';
    $('omitted').innerHTML = E.omitted.map((o) => `<li><b>${esc(o.title)}.</b> ${esc(o.reason)}</li>`).join('');
    const mine = [M.sources.reliability, M.sources.price].map((s) => ({ title: s.title, url: s.url, detail: '' }));
    $('sources').innerHTML = [...E.sources, ...mine, { title: 'us-atlas state shapes (Census boundaries)', url: M.geometry.source, detail: '' }]
      .map((s) => `<li>${s.url ? `<a href="${esc(s.url)}">${esc(s.title)}</a>` : esc(s.title)}${s.detail ? '. ' + esc(s.detail) : ''}</li>`).join('') +
      '<li>Data files: <a href="/data/expansion-map.json">expansion-map.json</a>, <a href="/data/market-states.json">market-states.json</a></li>';
    $('ov-updated').textContent = E.vintage;
    colorByOptions();
  }
  function colorByOptions() {
    const opts = [['score', 'Expansion score'], ['saidi_avg', 'Outage minutes (2-yr avg)'], ['cents_kwh', 'Power price'], ['bill_usd', 'Monthly bill'], ...allFactors().map((f) => [f.id, (f.yours ? 'Yours: ' : '') + f.label + ' (rank)'])];
    $('color-by').innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    $('color-by').value = layer;
  }

  // ---------- map geometry, pan and zoom ----------
  function setView(v) { if (![v.x, v.y, v.w, v.h].every(Number.isFinite) || v.w <= 0 || v.h <= 0) return; view = v; svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); }
  // Fit a box into the area the overview panel leaves free (right of it on desktop, above it on phones).
  function fitBox(bx) {
    const r = $('map').getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return { ...bx };
    const mobile = r.width <= 700, left = mobile ? 0 : 440, right = mobile ? 0 : 80, bottom = mobile ? 70 : 150;
    const fw = Math.max(200, r.width - left - right - 24), fh = Math.max(160, r.height - bottom - 24);
    const s = Math.max(bx.w / fw, bx.h / fh);
    return { x: bx.x - (left + 12) * s - (fw * s - bx.w) / 2, y: bx.y - 12 * s - (fh * s - bx.h) / 2, w: r.width * s, h: r.height * s };
  }
  const fitHome = () => fitBox({ x: -60, y: 0, w: 1030, h: 620 });
  function zoomAt(f, cx, cy) { const w = Math.min(home.w * 1.2, Math.max(home.w / 12, view.w * f)), k = w / view.w; setView({ x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k, w, h: view.h * k }); }
  function toMap(e) { const r = svg.getBoundingClientRect(), s = Math.max(view.w / r.width, view.h / r.height); return [view.x + (e.clientX - r.left) * s, view.y + (e.clientY - r.top) * s]; }
  function fitTo(name) {
    const b = svg.querySelector(`.st[data-name="${CSS.escape(name)}"]`).getBBox(), pad = Math.max(b.width, b.height) * 0.35;
    setView(fitBox({ x: b.x - pad, y: b.y - pad, w: b.width + pad * 2, h: b.height + pad * 2 }));
  }

  function ring(cls, name) {
    const r = svg && svg.querySelector('.' + cls); if (!r) return;
    const st = name && data(name); r.setAttribute('d', st ? st.path : '');
  }
  function build() {
    svg = el('svg', { role: 'presentation', preserveAspectRatio: 'xMinYMin meet' });
    home = fitHome(); setView({ ...home });
    addEventListener('resize', () => { home = fitHome(); setView({ ...home }); });
    [...states].sort((a, b) => a.name.localeCompare(b.name)).forEach((s) => {
      const p = el('path', { d: s.path, class: 'st', tabindex: '0', 'data-name': s.name, role: 'button' });
      p.addEventListener('click', () => detail(s.name));
      p.addEventListener('focus', () => ring('focus-ring', s.name));
      p.addEventListener('blur', () => ring('focus-ring', null));
      p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); detail(s.name); } });
      svg.append(p);
    });
    // Operating: solid. Announced: dashed. Equipment and installation only (not retail, not a utility program): dotted.
    // The dotted stroke is set here because market.css only styles solid and dashed.
    states.filter((s) => s.footprint).forEach((s) => {
      const kind = s.footprint.status === 'operating' ? 'solid' : s.footprint.status === 'equipment' ? 'dotted' : 'dashed';
      const p = el('path', { d: s.path, class: 'fp ' + kind });
      if (kind === 'dotted') p.style.cssText = 'stroke:var(--blue-60);stroke-dasharray:1 4;stroke-linecap:round';
      svg.append(p);
    });
    svg.append(el('path', { class: 'sel-ring', d: '' }), el('path', { class: 'focus-ring', d: '' }));
    $('map').append(svg);
    svg.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = toMap(e); zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, x, y); }, { passive: false });
    const ptr = new Map(); let last = null, moved = 0;
    // Capture the pointer only once it starts dragging. Capturing on press retargets the click to the
    // svg, so a plain click on a state never reached the state.
    svg.addEventListener('pointerdown', (e) => { ptr.set(e.pointerId, e); last = null; moved = 0; });
    svg.addEventListener('pointermove', (e) => {
      if (!ptr.has(e.pointerId)) return;
      const prev = ptr.get(e.pointerId); ptr.set(e.pointerId, e);
      if (moved > 6 && !svg.hasPointerCapture(e.pointerId)) { svg.setPointerCapture(e.pointerId); svg.classList.add('dragging'); }
      if (ptr.size === 2) {
        const [a, b] = [...ptr.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (last) { const [x, y] = toMap({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 }); zoomAt(last / d, x, y); }
        last = d; return;
      }
      const r = svg.getBoundingClientRect(), s = Math.max(view.w / r.width, view.h / r.height);
      const dx = (e.clientX - prev.clientX) * s, dy = (e.clientY - prev.clientY) * s; moved += Math.abs(dx) + Math.abs(dy);
      setView({ ...view, x: view.x - dx, y: view.y - dy });
    });
    const up = (e) => { ptr.delete(e.pointerId); last = null; if (!ptr.size) svg.classList.remove('dragging'); };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    svg.addEventListener('click', (e) => { if (moved > 6) e.stopPropagation(); }, true);
  }

  function setLayer(l) {
    layer = l; $('color-by').value = l;
    document.querySelectorAll('.mm-layers button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.layer === l)));
    paint();
  }

  function controls() {
    document.querySelectorAll('.mm-layers button').forEach((b) => b.addEventListener('click', () => setLayer(b.dataset.layer)));
    $('color-by').addEventListener('change', (e) => setLayer(e.target.value));
    const openFrom = (e) => { const b = e.target.closest('[data-state]'); if (b) { detail(b.dataset.state); fitTo(b.dataset.state); } };
    $('tiers').addEventListener('click', openFrom);
    $('ov-stats').addEventListener('click', openFrom);
    $('partners').addEventListener('click', openFrom);
    $('dl-ranking').addEventListener('click', downloadRanking);
    $('dl-partners').addEventListener('click', downloadPartners);
    $('btn-reset').addEventListener('click', () => setView({ ...home }));
    $('btn-full').addEventListener('click', () => { const m = document.querySelector('.mm'); document.fullscreenElement ? document.exitFullscreen() : m.requestFullscreen && m.requestFullscreen(); });
    $('btn-search').addEventListener('click', () => { const f = $('search'); f.hidden = !f.hidden; $('btn-search').setAttribute('aria-expanded', String(!f.hidden)); if (!f.hidden) $('search-input').focus(); });
    $('state-list').innerHTML = states.map((s) => `<option value="${esc(s.name)}">`).join('');
    const pick = () => { const s = findState($('search-input').value); if (s) { detail(s.name); fitTo(s.name); } };
    $('search').addEventListener('submit', (e) => { e.preventDefault(); pick(); });
    $('search-input').addEventListener('change', pick);
    $('ov-toggle').addEventListener('click', () => { const b = $('ov-body'), open = b.hidden; b.hidden = !open; $('ov-toggle').setAttribute('aria-expanded', String(open)); });
  }

  function zoneValue(z) {
    if (!z) { $('zone-value').innerHTML = '<p class="mm-small">Zone values failed to load.</p>'; return; }
    const max = Math.max(...z.zones.map((x) => x.usdPerYear), 1e-9);
    const mine = z.zones.filter((x) => x.yours).length;
    const note = mine ? `<p class="notice notice-green mm-flag"><span class="badge badge-solid">Yours</span> Your file replaced ${mine} of ${z.zones.length} zone values. Zones marked Yours show your number; the rest are the public backtest below.</p>` : '';
    $('zone-value').innerHTML = note + `<p class="mm-small">${mine ? 'Public method: what' : 'What'} one Base Core (20 kW / 39.2 kWh) would have earned in each ERCOT load zone, ${esc(z.period.start)} to ${esc(z.period.endExclusive)} (12 real months), on one fixed daily clock: charge 10 AM to 2 PM, discharge 7 to 9 PM, Central, at real-time load zone prices. About 31 kWh is usable, so it sells 20 kWh from 7 to 8 PM and about 9 kWh from 8 to 9 PM. The clock was chosen from how ERCOT prices move (cheap midday solar, a peak after sunset), not by searching these prices. Energy arbitrage only: no capacity, tolling, backup or retail revenue. Not Base revenue.</p>` +
      '<ol class="mm-bars">' + z.zones.map((x) => `<li${x.yours ? ` class="is-yours" title="Your file. Public value was $${fmt(x.publicUsdPerYear)}."` : x.market ? ` title="${esc(x.market)}: ${esc(x.who || '')}"` : ''}><span>${esc(zname(x.id))}${x.market === NO_CHOICE ? '*' : ''}${x.yours ? ' <em class="badge badge-solid">Yours</em>' : ''}</span><i style="width:${Math.max(2, (x.usdPerYear / max) * 100)}%"></i><b>$${fmt(x.usdPerYear)}</b></li>`).join('') + '</ol>' +
      zoneMarkets(z) +
      `<p class="mm-small">Only load zones (LZ_) are ranked: homes settle at load zone prices. Trading hubs (HB_) are not places a home battery earns, so they are left out (they are in the data file for reference). Best: ${esc(zname(z.zones[0].id))} (${esc(z.zones[0].id)}, $${fmt(z.zones[0].usdPerYear)} a year). Worst: ${esc(zname(z.zones[z.zones.length - 1].id))} (${esc(z.zones[z.zones.length - 1].id)}, $${fmt(z.zones[z.zones.length - 1].usdPerYear)}). See <a href="/deploy">/deploy</a> for monthly detail and <a href="/finance">/finance</a> for what this means for debt.</p>`;
  }

  /* Who sells power to homes in each zone. In a zone without retail choice (ERCOT's NOIE load zones:
     city utilities and co-ops) no retail provider keeps the arbitrage, so a battery company reaches
     the value only through a utility partnership. Data and sources: zone-value.json "markets". */
  const NO_CHOICE = 'utility or co-op';
  const ZONE_NAME = { LZ_WEST: 'West Texas', LZ_RAYBN: 'Rayburn co-op', LZ_NORTH: 'North Texas', LZ_CPS: 'CPS Energy (San Antonio)', LZ_LCRA: 'LCRA area', LZ_AEN: 'Austin Energy', LZ_SOUTH: 'South Texas', LZ_HOUSTON: 'Houston' };
  const zname = (id) => ZONE_NAME[id] || id;
  function zoneMarkets(z) {
    if (!z.zones.some((x) => x.market)) return '';
    const how = (x) => (x.market === NO_CHOICE
      ? 'Only through a utility partnership (for example a toll): no retail provider exists here to keep it.'
      : 'A retail provider, or a battery owner that is one, keeps it.');
    const label = (x) => (x.market === NO_CHOICE ? 'Utility or co-op territory' : 'Retail choice');
    const src = ((z.markets && z.markets.sources) || []).map((u, i) => `<a href="${esc(u)}">${i + 1}</a>`).join(', ');
    return '<p class="mm-h">Who keeps the value in each zone</p><ul class="mm-zones">' +
      z.zones.map((x) => `<li><p class="mm-zone-h"><b>${esc(zname(x.id))}</b> <code>${esc(x.id)}</code> <span class="badge ${x.market === NO_CHOICE ? 'badge-yellow' : 'badge-blue'}">${esc(label(x))}</span>${x.partner ? ` <span class="badge badge-green">Base partner</span>` : ''}</p><p>${esc(x.who || '')}. ${esc(how(x))}${x.partner ? ' ' + esc(x.partner) + (x.partnerSource ? ` (<a href="${esc(x.partnerSource)}">source</a>)` : '') + '.' : ''}</p></li>`).join('') +
      '</ul>' +
      `<p class="mm-small">* No retail choice. LZ_AEN, LZ_CPS, LZ_LCRA and LZ_RAYBN are ERCOT Non-Opt-In Entity load zones: Austin Energy, CPS Energy, LCRA's wholesale customers and Rayburn Country co-op members, whose city councils and co-op boards decide whether to open to retail choice (PURA 40.051 and 41.051) and have not. The value there goes to the utility and is reachable only through a utility partnership. The other zones are mostly retail choice, with some city and co-op pockets. Sources: ${src}.</p>`;
  }

  // ---------- your own data (yourdata.js panel, validation in market-core.js) ----------
  function useStates(r) {
    yours = r ? { factors: r.factors.map((f) => ({ ...f, yours: true, group: 'Yours', weight: 1, help: 'From your file. ' + (f.higherIsBetter ? 'Higher is better.' : 'Lower is better.') })), values: r.values } : null;
    Object.keys(weights).forEach((id) => { if (id.startsWith('yours_')) delete weights[id]; });
    if (layer.startsWith('yours_') && !isYours(layer)) layer = 'score';
    renderWeights(); colorByOptions(); setLayer(layer);
  }
  function useZones(zones) { zoneValue(zones && publicZ ? window.MarketCore.applyZones(publicZ, zones) : publicZ); }
  function mountYourData() {
    if (!window.YourData || !window.MarketCore || !$('yourdata')) return;
    const MC = window.MarketCore, Y = window.YourData;
    const templates = [{ name: 'market-state-metrics.csv', label: 'State metrics template', text: () => Y.toCSV(MC.stateTemplateRows(), MC.STATE_TEMPLATE_COLUMNS) }];
    if (publicZ) templates.push({ name: 'market-zone-values.csv', label: 'Texas zone values template', text: () => Y.toCSV(MC.zoneTemplateRows(publicZ), ['zone', 'usd_per_year']) });
    Y.mount({
      el: $('yourdata'),
      tool: 'market',
      what: 'your own per-state metrics (install cost, CAC, permit days, pipeline) or your own Texas zone values',
      docs: '/plug-and-play#market',
      templates,
      load(parsed) {
        const r = MC.load(parsed, publicZ ? publicZ.zones.map((x) => x.id) : []);
        if (r.kind === 'states') {
          return {
            errors: r.errors, warnings: r.warnings,
            summary: `${r.factors.length} metric${r.factors.length === 1 ? '' : 's'} added to the score (${r.factors.map((f) => f.label).join(', ')}), weight 1 each, tagged Yours under Score weights and in Color the map by.`,
            apply: () => { useZones(null); useStates(r); },
          };
        }
        const n = Object.keys(r.zones || {}).length;
        return {
          errors: r.errors, warnings: r.warnings,
          summary: `${n} Texas zone value${n === 1 ? '' : 's'} replaced in "Where one battery earns most".`,
          apply: () => { if (yours) useStates(null); useZones(r.zones); $('sec-value').open = true; },
        };
      },
      reset: () => { useStates(null); useZones(null); },
    });
  }

  const getJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' returned ' + r.status); return r.json(); });
  function failed(err) {
    $('ov-lede').textContent = '';
    $('ov-error').innerHTML = '<div class="notice notice-red"><p>The map data failed to load. Check your connection, then try again.</p><button type="button" class="btn btn-outline btn-sm" id="ov-retry">Try again</button></div>';
    $('ov-retry').addEventListener('click', load);
    ['tiers', 'zone-value', 'ercot'].forEach((id) => { $(id).innerHTML = '<p class="mm-small">Not loaded.</p>'; });
    console.warn('Market map data failed to load:', err);
  }
  function load() {
    $('ov-error').innerHTML = ''; $('ov-lede').textContent = 'Loading the map data…';
    Promise.all([getJSON('/data/expansion-map.json'), getJSON('/data/market-states.json'), getJSON('/data/zone-value.json').catch(() => null)]).then(started, failed);
  }
  function started([e, m, z]) {
    E = e; M = m; publicZ = z; zoneValue(z);
    const shape = Object.fromEntries(m.states.map((s) => [s.name, s]));
    states = e.states.filter((s) => shape[s.name]).map((s) => ({ ...shape[s.name], ...s, values: s.values, detail: s.detail || {} }));
    byName = new Map(states.map((s) => [s.name, s]));
    weightsUI(); staticSections(); build(); controls(); paint(); mountYourData();
    // ?state=Texas, ?state=TX and ?state=tx all open Texas; anything else is ignored.
    const q = findState(new URLSearchParams(location.search).get('state'));
    if (q) { detail(q.name); fitTo(q.name); }
  }
  load();
})();
