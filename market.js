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

  const WARM = ['#f3e6c8', '#efbd6f', '#d9822b', '#a3471b'];
  const TIERS = [
    { id: 'S', label: 'Target first', fill: '#102a17' }, { id: 'A', label: 'Strong case', fill: '#1e4d2b' },
    { id: 'B', label: 'Mixed', fill: '#77a45a' }, { id: 'C', label: 'One constraint leads', fill: '#b2dd79' },
    { id: 'Later', label: 'Thin public case', fill: '#d8d7d5' },
  ];
  const EXTRA = {
    saidi_avg: { label: 'Minutes without power, 2024 and 2025 average', unit: (v) => fmt(v) + ' min', bins: [200, 400, 800] },
    cents_kwh: { label: 'Residential power price, 2024', unit: (v) => fmt(v, 1) + '¢', bins: [13, 16, 20] },
    bill_usd: { label: 'Average monthly bill, 2024', unit: (v) => '$' + fmt(v), bins: [130, 160, 190] },
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
    if (id === 'retail' || id === 'wholesale') return fmt(v * 100, 1) + '%';
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
    const ph = (f) => `${f.yours ? 'your ' + f.label : f.label.toLowerCase()} ${factorFmt(f.id, val(st, f))}`;
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
    if (layer === 'score') { const t = TIERS.find((x) => x.id === scored.get(st.name).tier); return t ? t.fill : '#eceae6'; }
    const v = layerValue(st);
    if (v === null || v === undefined) return '#eceae6';
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

  function overview(ranked) {
    const top = ranked[0];
    $('ov-lede').textContent = E.narrative[0] || '';
    const n = (s) => ranked.filter((it) => it.row.footprint && it.row.footprint.status === s).length;
    const stats = [
      [top.row.name, 'Top score: ' + pts(top.score)],
      [String(ranked.filter((it) => scored.get(it.row.name).tier === 'S').length), 'States in tier S'],
      [String(n('operating')), 'States Base operates in'],
      [fmt(M.us.saidi_avg) + ' min', 'US outage minutes, 2-yr avg'],
    ];
    $('ov-stats').innerHTML = stats.map(([v, l]) => `<div class="mm-stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
  }

  function tiers(ranked) {
    if (!ranked.some((it) => scored.get(it.row.name).tier)) { $('tiers').innerHTML = '<p class="mm-small">No state has a score. Every weight is 0, or no weighted factor has data. Raise a weight under Score weights.</p>'; return; }
    $('tiers').innerHTML = TIERS.map((t) => {
      const list = ranked.filter((it) => scored.get(it.row.name).tier === t.id);
      if (!list.length) return '';
      return `<div class="mm-tier"><span class="mm-tier-id" style="background:${t.fill};color:${['S', 'A'].includes(t.id) ? '#fff' : '#1e4d2b'}" title="${esc(t.label)}">${t.id}</span><div>` +
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
    legend(); overview(ranked); tiers(ranked);
    if (selected) detail(selected, false);
  }

  // ---------- detail ----------
  function detail(name, scroll = true) {
    const st = data(name), it = scored.get(name); selected = name;
    svg.querySelectorAll('.st').forEach((p) => p.classList.toggle('sel', p.dataset.name === name));
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
        <dt>Outage minutes, 2024 / 2025</dt><dd>${fmt(st.saidi_2024)} / ${fmt(st.saidi_2025)}</dd>
        <dt>Power price, 2024</dt><dd>${fmt(st.cents_kwh, 2)}¢/kWh</dd>
        <dt>Monthly bill, 2024</dt><dd>$${fmt(st.bill_usd, 2)}</dd>
        <dt>Grid operators</dt><dd>${esc(st.detail.rtos || 'n/a')}</dd></dl>
      ${rcLine}${st.detail.note ? `<p class="mm-small">${esc(st.detail.note)}</p>` : ''}`;
    if (st.abbr === 'TX') { const s = $('sec-value'); s.open = true; c.insertAdjacentHTML('beforeend', '<p class="mm-small"><a href="#sec-value">Where one battery earns most inside Texas</a></p>'); }
    utilities(st);
    if (scroll && innerWidth <= 700) { $('ov-body').hidden = false; $('ov-toggle').setAttribute('aria-expanded', 'true'); c.scrollIntoView({ block: 'nearest' }); }
  }
  function utilities(st) {
    const rows = E.utilities.filter((u) => u.state === st.abbr);
    if (!rows.length) { $('utilities').innerHTML = `<p class="mm-small">No utilities listed for ${esc(st.name)}.</p>`; return; }
    const ranked = rank(rows, E.factors).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 8);
    $('utilities').innerHTML = `<p class="mm-small">${rows.length} utilities in ${esc(st.name)}, scored against each other with the same weights. Top ${ranked.length}:</p><div class="mm-scroll"><table class="ds-table"><thead><tr><th>Utility</th><th class="num">Score</th><th class="num">Homes</th><th class="num">Outage min</th></tr></thead><tbody>` +
      ranked.map((it) => `<tr><td>${esc(it.row.name)}</td><td class="num">${pts(it.score)}</td><td class="num">${factorFmt('homes', it.row.values.homes)}</td><td class="num">${factorFmt('saidi', it.row.values.saidi)}</td></tr>`).join('') + '</tbody></table></div>';
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
        const on = p === 'pull' ? f.group === 'Customer pull' : p === 'access' ? f.group === 'Market access' : p === 'nosize' ? f.id !== 'homes' : true;
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
    const mobile = r.width <= 700, left = mobile ? 0 : 440, bottom = mobile ? r.height * 0.5 : 0;
    const fw = Math.max(200, r.width - left - 24), fh = Math.max(160, r.height - bottom - 24);
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

  function build() {
    svg = el('svg', { role: 'presentation', preserveAspectRatio: 'xMinYMin meet' });
    home = fitHome(); setView({ ...home });
    addEventListener('resize', () => { home = fitHome(); setView({ ...home }); });
    states.forEach((s) => {
      const p = el('path', { d: s.path, class: 'st', tabindex: '0', 'data-name': s.name, role: 'button' });
      p.addEventListener('click', () => detail(s.name));
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
    $('map').append(svg);
    svg.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = toMap(e); zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, x, y); }, { passive: false });
    const ptr = new Map(); let last = null, moved = 0;
    svg.addEventListener('pointerdown', (e) => { ptr.set(e.pointerId, e); last = null; moved = 0; svg.setPointerCapture(e.pointerId); svg.classList.add('dragging'); });
    svg.addEventListener('pointermove', (e) => {
      if (!ptr.has(e.pointerId)) return;
      const prev = ptr.get(e.pointerId); ptr.set(e.pointerId, e);
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
    $('tiers').addEventListener('click', (e) => { const b = e.target.closest('[data-state]'); if (b) { detail(b.dataset.state); fitTo(b.dataset.state); } });
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
      '<ol class="mm-bars">' + z.zones.map((x) => `<li${x.yours ? ` class="is-yours" title="Your file. Public value was $${fmt(x.publicUsdPerYear)}."` : ''}><span>${esc(x.id)}${x.yours ? ' <em class="badge badge-solid">Yours</em>' : ''}</span><i style="width:${Math.max(2, (x.usdPerYear / max) * 100)}%"></i><b>$${fmt(x.usdPerYear)}</b></li>`).join('') + '</ol>' +
      `<p class="mm-small">Only load zones (LZ_) are ranked: homes settle at load zone prices. Trading hubs (HB_) are not places a home battery earns, so they are left out (they are in the data file for reference). Best: ${esc(z.zones[0].id)} ($${fmt(z.zones[0].usdPerYear)} a year). Worst: ${esc(z.zones[z.zones.length - 1].id)} ($${fmt(z.zones[z.zones.length - 1].usdPerYear)}). See <a href="/deploy">/deploy</a> for monthly detail and <a href="/finance">/finance</a> for what this means for debt.</p>`;
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
