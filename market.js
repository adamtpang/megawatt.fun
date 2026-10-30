/* Market map. Data: data/market-states.json (EIA tables + us-atlas shapes). Pan, zoom, search, layers. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const fmt = (n, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const COLORS = ['#f3e6c8', '#efbd6f', '#d9822b', '#a3471b'];
  const LAYERS = {
    saidi_avg: { title: 'Minutes without power, per customer per year', unit: (v) => fmt(v) + ' min', bins: [200, 400, 800], better: 'low',
      lede: 'Shaded by how long the average home went without power (2024 and 2025 average). Longer outages mean backup is worth more.' },
    cents_kwh: { title: 'Residential power price, 2024', unit: (v) => fmt(v, 1) + '¢/kWh', bins: [13, 16, 20], better: 'low',
      lede: 'Shaded by what homes pay per kWh. Pricier power makes shifting cheap energy to expensive hours worth more.' },
    bill_usd: { title: 'Average monthly bill, 2024', unit: (v) => '$' + fmt(v), bins: [130, 160, 190], better: 'low',
      lede: 'Shaded by the average residential bill. Bigger bills mean more room for savings to matter.' },
  };
  let data, layer = 'saidi_avg', selected = null, svg, view, home;

  const bin = (v, b) => (v < b[0] ? 0 : v < b[1] ? 1 : v < b[2] ? 2 : 3);
  const rankOf = (s, key) => 1 + data.states.filter((o) => o[key] > s[key]).length;

  function legend() {
    const L = LAYERS[layer], b = L.bins, u = L.unit;
    $('lg-title').textContent = L.title;
    const labels = [`Under ${u(b[0])}`, `${u(b[0])} to ${u(b[1])}`, `${u(b[1])} to ${u(b[2])}`, `Over ${u(b[2])}`];
    $('legend').innerHTML = labels.reverse().map((t, i) => `<li><i style="background:${COLORS[3 - i]}"></i>${t}</li>`).join('');
  }

  function overview() {
    const L = LAYERS[layer], us = data.us, top = [...data.states].sort((a, b) => b[layer] - a[layer])[0];
    $('ov-lede').textContent = L.lede;
    const stats = [
      [L.unit(us[layer]), 'US average'],
      [top.name, 'Highest: ' + L.unit(top[layer])],
      [String(data.base_markets.length), 'States Base serves today'],
      [String(data.states.filter((s) => bin(s[layer], L.bins) === 3).length), 'States in the top band'],
    ];
    $('ov-stats').innerHTML = stats.map(([v, l]) => `<div class="mm-stat"><b>${v}</b><span>${l}</span></div>`).join('');
  }

  function paint() {
    const b = LAYERS[layer].bins;
    svg.querySelectorAll('.st').forEach((p) => { const s = data.byName[p.dataset.name]; p.setAttribute('fill', COLORS[bin(s[layer], b)]); });
    legend(); overview(); if (selected) detail(selected);
  }

  function detail(name) {
    const s = data.byName[name]; selected = name;
    svg.querySelectorAll('.st').forEach((p) => p.classList.toggle('sel', p.dataset.name === name));
    const base = data.base_markets.includes(name);
    const c = $('detail'); c.hidden = false;
    c.innerHTML = `<h2>${name}${base ? '<span class="mm-badge">Base serves today</span>' : ''}</h2>
      <dl>
        <dt>Outage minutes, 2025</dt><dd>${fmt(s.saidi_2025)}</dd>
        <dt>Outage minutes, 2024</dt><dd>${fmt(s.saidi_2024)}</dd>
        <dt>Outages per customer, 2025</dt><dd>${fmt(s.saifi_2025, 2)}</dd>
        <dt>Power price, 2024</dt><dd>${fmt(s.cents_kwh, 2)}¢/kWh</dd>
        <dt>Monthly bill, 2024</dt><dd>$${fmt(s.bill_usd, 2)}</dd>
        <dt>Monthly use, 2024</dt><dd>${fmt(s.kwh_month)} kWh</dd>
        <dt>Homes (residential customers)</dt><dd>${fmt(s.customers)}</dd>
      </dl>
      <p class="mm-rank">#${rankOf(s, layer)} of 51 on this layer.</p>`;
    if (innerWidth <= 700) { $('ov-body').hidden = false; $('ov-toggle').setAttribute('aria-expanded', 'true'); c.scrollIntoView({ block: 'nearest' }); }
  }

  // pan + zoom by changing the viewBox
  function setView(v) { if (![v.x, v.y, v.w, v.h].every(Number.isFinite) || v.w <= 0 || v.h <= 0) return; view = v; svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); }
  function zoomAt(f, cx, cy) {
    const w = Math.min(home.w * 1.2, Math.max(home.w / 12, view.w * f)), k = w / view.w;
    setView({ x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k, w, h: view.h * k });
  }
  function toMap(e) { const r = svg.getBoundingClientRect(), s = Math.max(view.w / r.width, view.h / r.height); return [view.x + (e.clientX - r.left - (r.width - view.w / s) / 2) * s, view.y + (e.clientY - r.top - (r.height - view.h / s) / 2) * s]; }
  function fitTo(name) {
    const b = svg.querySelector(`.st[data-name="${CSS.escape(name)}"]`).getBBox(), pad = Math.max(b.width, b.height) * 0.35;
    setView(fitBox({ x: b.x - pad, y: b.y - pad, w: b.width + pad * 2, h: b.height + pad * 2 }));
  }


  // Fit a map box into the area the overview panel leaves free (right of it on desktop, above it on phones).
  function fitBox(bx) {
    const r = $('map').getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return { x: bx.x, y: bx.y, w: bx.w, h: bx.h };
    const mobile = r.width <= 700, left = mobile ? 0 : 440, bottom = mobile ? r.height * 0.5 : 0;
    const fw = Math.max(200, r.width - left - 24), fh = Math.max(160, r.height - bottom - 24);
    const s = Math.max(bx.w / fw, bx.h / fh);
    const x0 = bx.x - (left + 12) * s - (fw * s - bx.w) / 2, y0 = bx.y - 12 * s - (fh * s - bx.h) / 2;
    return { x: x0, y: y0, w: r.width * s, h: r.height * s };
  }
  const fitHome = () => fitBox({ x: -60, y: 0, w: 1030, h: 620 });

  function build() {
    svg = el('svg', { role: 'presentation', preserveAspectRatio: 'xMinYMin meet' });
    home = fitHome(); setView({ ...home });
    addEventListener('resize', () => { home = fitHome(); setView({ ...home }); });
    data.states.forEach((s) => {
      const p = el('path', { d: s.path, class: 'st', tabindex: '0', 'data-name': s.name, role: 'button', 'aria-label': s.name });
      p.addEventListener('click', () => detail(s.name));
      p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); detail(s.name); } });
      svg.append(p);
    });
    data.base_markets.forEach((n) => svg.append(el('path', { d: data.byName[n].path, class: 'base' })));
    $('map').append(svg);

    svg.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = toMap(e); zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, x, y); }, { passive: false });
    const pts = new Map(); let last = null, moved = 0;
    svg.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, e); last = null; moved = 0; svg.setPointerCapture(e.pointerId); svg.classList.add('dragging'); });
    svg.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId); pts.set(e.pointerId, e);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (last) { const [x, y] = toMap({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 }); zoomAt(last / d, x, y); }
        last = d; return;
      }
      const r = svg.getBoundingClientRect(), s = Math.max(view.w / r.width, view.h / r.height);
      const dx = (e.clientX - prev.clientX) * s, dy = (e.clientY - prev.clientY) * s; moved += Math.abs(dx) + Math.abs(dy);
      setView({ ...view, x: view.x - dx, y: view.y - dy });
    });
    const up = (e) => { pts.delete(e.pointerId); last = null; if (!pts.size) svg.classList.remove('dragging'); };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    svg.addEventListener('click', (e) => { if (moved > 6) e.stopPropagation(); }, true);
  }

  function controls() {
    document.querySelectorAll('.mm-layers button').forEach((b) => b.addEventListener('click', () => {
      layer = b.dataset.layer; document.querySelectorAll('.mm-layers button').forEach((x) => x.setAttribute('aria-checked', String(x === b))); paint();
    }));
    $('btn-reset').addEventListener('click', () => setView({ ...home }));
    $('btn-full').addEventListener('click', () => { const m = document.querySelector('.mm'); document.fullscreenElement ? document.exitFullscreen() : m.requestFullscreen && m.requestFullscreen(); });
    $('btn-search').addEventListener('click', () => { const f = $('search'); f.hidden = !f.hidden; $('btn-search').setAttribute('aria-expanded', String(!f.hidden)); if (!f.hidden) $('search-input').focus(); });
    $('state-list').innerHTML = data.states.map((s) => `<option value="${s.name}">`).join('');
    const pick = () => { const v = $('search-input').value.trim().toLowerCase(); const s = data.states.find((o) => o.name.toLowerCase() === v); if (s) { detail(s.name); fitTo(s.name); } };
    $('search').addEventListener('submit', (e) => { e.preventDefault(); pick(); });
    $('search-input').addEventListener('change', pick);
    $('ov-toggle').addEventListener('click', () => { const b = $('ov-body'), open = b.hidden; b.hidden = !open; $('ov-toggle').setAttribute('aria-expanded', String(open)); });
    const src = data.sources;
    $('ov-sources').innerHTML = `Sources: <a href="${src.reliability.url}">${src.reliability.title}</a> · <a href="${src.price.url}">${src.price.title}</a> · <a href="${src.base_markets.url}">${src.base_markets.title}</a> · Shapes: <a href="${data.geometry.source}">us-atlas</a> (Census boundaries). <a href="/data/market-states.json">All data</a>.`;
    $('ov-updated').textContent = `EIA data for 2024 and 2025 · retrieved ${data.retrieved}. Annual data, not live outages.`;
  }

  fetch('/data/market-states.json').then((r) => r.json()).then((d) => {
    data = d; data.byName = Object.fromEntries(d.states.map((s) => [s.name, s]));
    build(); controls(); paint();
  }).catch(() => { $('ov-lede').textContent = 'The map data failed to load.'; });
})();
