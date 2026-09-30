/* "Your battery today" page. Logic lives in base-core.js; this file only fetches data and draws. */
(function () {
  'use strict';
  const B = window.BaseCore;
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const SVG = 'http://www.w3.org/2000/svg';
  const el = (t, a, txt) => { const e = document.createElementNS(SVG, t); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; return e; };
  const params = new URLSearchParams(location.search);

  async function loadLive() {
    if (params.get('prices') === 'offline') return null; // demo switch for the failure path
    try {
      const r = await fetch('/api/prices', { cache: 'no-store' });
      if (!r.ok) return null;
      const d = await r.json();
      const rows = d.damSppData || [];
      return { date: (rows[0] && rows[0].timestamp || '').slice(0, 10), prices: rows.map((x) => x.hbHouston) };
    } catch { return null; }
  }
  async function loadCached() {
    try {
      const c = await (await fetch('/data/ercot-dam-houston.json')).json();
      return { date: c.delivery_date, prices: c.hours.map((h) => h.usd_mwh) };
    } catch { return null; }
  }
  // The battery report is simulated; ?battery=offline shows the failure path.
  function readBattery(day) { return params.get('battery') === 'offline' ? null : { socKwh: day.endSoc }; }

  function chart(day) {
    const W = 640, H = 240, m = { l: 34, r: 8, t: 22, b: 24 };
    const hs = day.hours, max = Math.max(...hs.map((h) => h.price)) * 1.15, min = 0;
    const x = (i) => m.l + (i / 24) * (W - m.l - m.r), bw = (W - m.l - m.r) / 24;
    const y = (v) => H - m.b - ((v - min) / (max - min)) * (H - m.t - m.b);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}` });
    hs.forEach((h, i) => svg.append(el('rect', { class: 'band ' + h.state, x: x(i), y: m.t, width: bw, height: H - m.t - m.b })));
    [0, 6, 12, 18, 24].forEach((i) => svg.append(el('text', { class: 'tick', x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === 24 ? 'end' : 'middle' }, i === 12 ? 'noon' : i % 24 === 0 ? 'midnight' : B.clock(i).toLowerCase().replace(' ', ''))));
    svg.append(el('text', { class: 'tick', x: m.l - 4, y: y(max / 1.15) + 4, 'text-anchor': 'end' }, '$' + fmt(max / 1.15)));
    svg.append(el('path', { class: 'price', d: hs.map((h, i) => `${i ? 'L' : 'M'}${x(i + 0.5)},${y(h.price)}`).join(' ') }));
    // direct labels: one per state, over the middle of its longest run
    const seen = {};
    const names = { charge: 'charging', discharge: 'powering your home', reserve: 'holding backup' };
    let i = 0;
    while (i < 24) { let j = i; while (j < 24 && hs[j].state === hs[i].state) j++; const s = hs[i].state; if (!seen[s] || j - i > seen[s][1] - seen[s][0]) seen[s] = [i, j]; i = j; }
    Object.entries(seen).forEach(([s, [a, b]]) => {
      const label = s === 'discharge' && hs.slice(a, b).some((h) => h.toGrid > 1e-6) ? 'home + grid' : names[s];
      svg.append(el('text', { class: 'blab ' + s, x: x((a + b) / 2), y: m.t - 7, 'text-anchor': 'middle' }, label));
    });
    $('chart').textContent = ''; $('chart').append(svg);
  }

  function render(pick) {
    if (!pick.data) { $('today').textContent = pick.note; return; }
    const monthly = Number($('home-size').value);
    const day = B.simulateDay(pick.data.prices, { monthlyKwh: monthly });
    $('today').textContent = B.summarize(day);
    $('price-date').textContent = pick.data.date;
    if (pick.note) { $('data-note').hidden = false; $('data-note').textContent = pick.note; }
    chart(day);
    const bat = B.batteryView(readBattery(day));
    $('battery-ok').hidden = !bat.reachable; $('battery-off').hidden = bat.reachable;
    if (bat.reachable) {
      $('backup-hours').textContent = fmt(B.backupHours(bat.socKwh, monthly));
      $('backup-kwh').textContent = fmt(bat.socKwh, 1);
    }
    const out = $('outage');
    out.disabled = !bat.reachable;
    const o = bat.reachable ? B.outage(bat.socKwh) : null;
    $('outage-panel').hidden = !(out.checked && o);
    if (o) {
      $('out-hours').textContent = fmt(o.essentialsHours);
      $('out-ac').textContent = fmt(o.withAcHours, 1);
      $('out-list').textContent = o.essentials.map((e) => e.name.toLowerCase()).join(', ') + '.';
    }
  }

  async function start() {
    const [live, cached] = await Promise.all([loadLive(), loadCached()]);
    const pick = B.pickPrices(live, cached, new Date());
    if (params.get('outage') === 'on') $('outage').checked = true;
    render(pick);
    $('home-size').addEventListener('change', () => render(pick));
    $('outage').addEventListener('change', () => render(pick));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
