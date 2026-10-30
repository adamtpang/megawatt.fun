/* One market map. Score, factors, footprint, utilities and ERCOT data: data/expansion-map.json
   (built by analysis/build_expansion.py from Census, EIA-861, FEMA and ERCOT). Shapes, price, bill and
   two-year outages: data/market-states.json (EIA Tables 5A and 11.3, us-atlas). Scoring: notes/score.js. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (n, d = 0) => (n === null || n === undefined || n !== n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
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

  let E, M, states, weights = {}, scored = {}, layer = 'score', selected = null, svg, view, home, byName = {};
  const data = (name) => byName[name];

  function factorFmt(id, v) {
    if (v === null || v === undefined || v !== v) return '—';
    if (id === 'homes' || id === 'saidi') return fmt(v);
    if (id === 'saifi') return fmt(v, 2);
    if (id === 'retail' || id === 'wholesale') return fmt(v * 100, 1) + '%';
    if (id === 'storm' || id === 'heat') return fmt(v, 1);
    return fmt(v, 2);
  }

  // ---------- scoring (same math as Cursor's page, via notes/score.js) ----------
  function rank(rows) {
    const table = {};
    E.factors.forEach((f) => {
      const r = S().percentileRanks(rows.map((row) => row.values[f.id]));
      rows.forEach((row, i) => { (table[row.id] = table[row.id] || { id: row.id })[f.id] = r[i]; });
    });
    const rankRows = rows.map((row) => table[row.id]);
    const sc = S().composite(rankRows, weights);
    return rows.map((row, i) => ({ row, score: sc[i], factors: rankRows[i] }));
  }
  function rescore() {
    const ranked = rank(states).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.row.name.localeCompare(b.row.name));
    scored = {};
    ranked.forEach((it, i) => { scored[it.row.name] = { score: it.score, rank: i + 1, tier: S().tierOf(it.score), factors: it.factors }; });
    return ranked;
  }
  const pts = (s) => (s === null || s === undefined ? '—' : String(Math.round(s * 100)));

  function why(name) {
    const st = data(name), it = scored[name];
    const parts = E.factors.filter((f) => weights[f.id] > 0 && it.factors[f.id] != null).map((f) => ({ f, r: it.factors[f.id] })).sort((a, b) => b.r - a.r);
    if (!parts.length) return 'No weighted factor has a published value here.';
    const ph = (f) => `${f.label.toLowerCase()} ${factorFmt(f.id, st.values[f.id])}`;
    let t = 'Leads on ' + parts.slice(0, 2).map((p) => ph(p.f)).join(' and ') + '.';
    const low = parts[parts.length - 1];
    if (parts.length > 2 && low.r < 0.5) t += ' Weakest: ' + ph(low.f) + '.';
    return t;
  }

  // ---------- layers ----------
  function layerValue(st) {
    if (layer === 'score') return scored[st.name].score;
    if (EXTRA[layer]) return st[layer];
    return scored[st.name].factors[layer]; // percentile rank 0..1
  }
  function fillFor(st) {
    if (layer === 'score') { const t = TIERS.find((x) => x.id === scored[st.name].tier); return t ? t.fill : '#eceae6'; }
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
    const f = E.factors.find((x) => x.id === layer);
    $('lg-title').textContent = f.label + ' (rank among states)';
    $('legend').innerHTML = ['Top quarter', 'Second quarter', 'Third quarter', 'Bottom quarter'].map((t, i) => `<li><i style="background:${WARM[3 - i]}"></i>${t}</li>`).join('') + '<li><i style="background:#eceae6"></i>No data</li>';
  }

  function overview(ranked) {
    const top = ranked[0];
    $('ov-lede').textContent = E.narrative[0] || '';
    const n = (s) => ranked.filter((it) => it.row.footprint && it.row.footprint.status === s).length;
    const stats = [
      [top.row.name, 'Top score: ' + pts(top.score)],
      [String(ranked.filter((it) => scored[it.row.name].tier === 'S').length), 'States in tier S'],
      [String(n('operating')), 'States Base operates in'],
      [fmt(M.us.saidi_avg) + ' min', 'US outage minutes, 2-yr avg'],
    ];
    $('ov-stats').innerHTML = stats.map(([v, l]) => `<div class="mm-stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
  }

  function tiers(ranked) {
    $('tiers').innerHTML = TIERS.map((t) => {
      const list = ranked.filter((it) => scored[it.row.name].tier === t.id);
      if (!list.length) return '';
      return `<div class="mm-tier"><span class="mm-tier-id" style="background:${t.fill};color:${['S', 'A'].includes(t.id) ? '#fff' : '#1e4d2b'}" title="${esc(t.label)}">${t.id}</span><div>` +
        list.map((it) => `<button type="button" class="mm-chip${it.row.name === selected ? ' on' : ''}" data-state="${esc(it.row.name)}">${esc(it.row.abbr)} <b>${pts(it.score)}</b></button>`).join('') + '</div></div>';
    }).join('');
  }

  function paint() {
    const ranked = rescore();
    svg.querySelectorAll('.st').forEach((p) => {
      const st = data(p.dataset.name), it = scored[st.name];
      p.setAttribute('fill', fillFor(st));
      p.setAttribute('aria-label', `${st.name}, tier ${it.tier || 'none'}, score ${pts(it.score)}, rank ${it.rank}`);
    });
    legend(); overview(ranked); tiers(ranked);
    if (selected) detail(selected, false);
  }

  // ---------- detail ----------
  function detail(name, scroll = true) {
    const st = data(name), it = scored[name]; selected = name;
    svg.querySelectorAll('.st').forEach((p) => p.classList.toggle('sel', p.dataset.name === name));
    document.querySelectorAll('.mm-chip').forEach((b) => b.classList.toggle('on', b.dataset.state === name));
    const fp = st.footprint ? `<p class="mm-flag ${st.footprint.status}"><b>${esc(st.footprint.label)}.</b> ${esc(st.footprint.detail)}</p>` : '';
    const rows = E.factors.map((f) => `<dt>${esc(f.label)}</dt><dd>${factorFmt(f.id, st.values[f.id])}</dd>`).join('');
    const c = $('detail'); c.hidden = false;
    c.innerHTML = `<p class="mm-small">Tier ${it.tier || '—'} · score ${pts(it.score)} · #${it.rank} of ${states.length}</p>
      <h2>${esc(name)}</h2>${fp}<p class="mm-why">${esc(why(name))}</p>
      <dl>${rows}
        <dt>Outage minutes, 2024 / 2025</dt><dd>${fmt(st.saidi_2024)} / ${fmt(st.saidi_2025)}</dd>
        <dt>Power price, 2024</dt><dd>${fmt(st.cents_kwh, 2)}¢/kWh</dd>
        <dt>Monthly bill, 2024</dt><dd>$${fmt(st.bill_usd, 2)}</dd>
        <dt>Grid operators</dt><dd>${esc(st.detail.rtos || '—')}</dd></dl>
      ${st.detail.note ? `<p class="mm-small">${esc(st.detail.note)}</p>` : ''}`;
    utilities(st);
    if (scroll && innerWidth <= 700) { $('ov-body').hidden = false; $('ov-toggle').setAttribute('aria-expanded', 'true'); c.scrollIntoView({ block: 'nearest' }); }
  }
  function utilities(st) {
    const rows = E.utilities.filter((u) => u.state === st.abbr);
    if (!rows.length) { $('utilities').innerHTML = `<p class="mm-small">No utilities listed for ${esc(st.name)}.</p>`; return; }
    const ranked = rank(rows).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 8);
    $('utilities').innerHTML = `<p class="mm-small">${rows.length} utilities in ${esc(st.name)}, scored against each other with the same weights. Top ${ranked.length}:</p><table class="mm-table"><thead><tr><th>Utility</th><th class="num">Score</th><th class="num">Homes</th><th class="num">Outage min</th></tr></thead><tbody>` +
      ranked.map((it) => `<tr><td>${esc(it.row.name)}</td><td class="num">${pts(it.score)}</td><td class="num">${factorFmt('homes', it.row.values.homes)}</td><td class="num">${factorFmt('saidi', it.row.values.saidi)}</td></tr>`).join('') + '</tbody></table>';
  }

  // ---------- weights ----------
  function weightsUI() {
    E.factors.forEach((f) => { weights[f.id] = f.weight; });
    let group = '';
    $('weights').innerHTML = E.factors.map((f) => {
      const h = f.group !== group ? `<p class="mm-h">${esc((group = f.group))}</p>` : '';
      return h + `<label class="mm-w" title="${esc(f.help)}"><span>${esc(f.label)}</span><input type="range" min="0" max="3" step="0.5" value="${f.weight}" data-w="${f.id}"><output id="o-${f.id}">${f.weight}</output></label>`;
    }).join('');
    $('weights').addEventListener('input', (e) => {
      const id = e.target.dataset.w; if (!id) return;
      weights[id] = Number(e.target.value); $('o-' + id).textContent = e.target.value;
      document.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false')); paint();
    });
    document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const p = b.dataset.preset;
      E.factors.forEach((f) => {
        const on = p === 'pull' ? f.group === 'Customer pull' : p === 'access' ? f.group === 'Market access' : p === 'nosize' ? f.id !== 'homes' : true;
        weights[f.id] = on ? f.weight : 0;
        document.querySelector(`[data-w="${f.id}"]`).value = weights[f.id]; $('o-' + f.id).textContent = weights[f.id];
      });
      document.querySelectorAll('[data-preset]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paint();
    }));
  }

  // ---------- static sections ----------
  function staticSections() {
    const er = E.ercot;
    $('ercot').innerHTML = !er || !er.available ? `<p class="mm-small">${esc((er && er.summary) || 'Not available in this build.')}</p>`
      : `<p class="mm-small">${esc(er.summary)}</p><table class="mm-table"><thead><tr><th>Node</th><th>Zone</th><th class="num">p95 $/MWh above zone</th></tr></thead><tbody>` +
        er.nodes.slice(0, 10).map((n) => `<tr><td>${esc(n.name)}</td><td>${esc(n.zone)}</td><td class="num">${fmt(n.p95_basis, 2)}</td></tr>`).join('') + '</tbody></table>';
    $('omitted').innerHTML = E.omitted.map((o) => `<li><b>${esc(o.title)}.</b> ${esc(o.reason)}</li>`).join('');
    const mine = [M.sources.reliability, M.sources.price].map((s) => ({ title: s.title, url: s.url, detail: '' }));
    $('sources').innerHTML = [...E.sources, ...mine, { title: 'us-atlas state shapes (Census boundaries)', url: M.geometry.source, detail: '' }]
      .map((s) => `<li>${s.url ? `<a href="${esc(s.url)}">${esc(s.title)}</a>` : esc(s.title)}${s.detail ? '. ' + esc(s.detail) : ''}</li>`).join('') +
      '<li>Data files: <a href="/data/expansion-map.json">expansion-map.json</a>, <a href="/data/market-states.json">market-states.json</a></li>';
    $('ov-updated').textContent = E.vintage;
    const opts = [['score', 'Expansion score'], ['saidi_avg', 'Outage minutes (2-yr avg)'], ['cents_kwh', 'Power price'], ['bill_usd', 'Monthly bill'], ...E.factors.map((f) => [f.id, f.label + ' (rank)'])];
    $('color-by').innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
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
    states.filter((s) => s.footprint).forEach((s) => svg.append(el('path', { d: s.path, class: 'fp ' + (s.footprint.status === 'operating' ? 'solid' : 'dashed') })));
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
    const pick = () => { const v = $('search-input').value.trim().toLowerCase(); const s = states.find((o) => o.name.toLowerCase() === v || o.abbr.toLowerCase() === v); if (s) { detail(s.name); fitTo(s.name); } };
    $('search').addEventListener('submit', (e) => { e.preventDefault(); pick(); });
    $('search-input').addEventListener('change', pick);
    $('ov-toggle').addEventListener('click', () => { const b = $('ov-body'), open = b.hidden; b.hidden = !open; $('ov-toggle').setAttribute('aria-expanded', String(open)); });
  }

  Promise.all([fetch('/data/expansion-map.json').then((r) => r.json()), fetch('/data/market-states.json').then((r) => r.json())]).then(([e, m]) => {
    E = e; M = m;
    const shape = Object.fromEntries(m.states.map((s) => [s.name, s]));
    states = e.states.filter((s) => shape[s.name]).map((s) => ({ ...shape[s.name], ...s, values: s.values, detail: s.detail || {} }));
    byName = Object.fromEntries(states.map((s) => [s.name, s]));
    weightsUI(); staticSections(); build(); controls(); paint();
    const q = new URLSearchParams(location.search).get('state');
    if (q && byName[q]) { detail(q); fitTo(q); }
  }).catch((err) => { $('ov-lede').textContent = 'The map data failed to load.'; console.error(err); });
})();
