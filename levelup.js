/* Screens 4-6: how much to build, why storage matters, how a battery network works.
   Conversion factors come from data/build-assumptions.json; every one is cited in the page footnotes. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d });
  const big = (n) => n >= 1e12 ? fmt(n / 1e12, 1) + ' trillion' : n >= 1e9 ? fmt(n / 1e9, 1) + ' billion' : n >= 1e6 ? fmt(n / 1e6, 1) + ' million' : fmt(n);
  const SVG = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Screen 4: how much would it take ---------- */
  function levelUp(A) {
    const S = window.MegawattScale, base = S.BASELINE_TW;
    const src = A.sources;
    let goal = 'double';
    function show(id, value, math) { const e = $(id); e.textContent = value; e.title = math; }
    function render() {
      const targetTW = goal === 'double' ? base * 2 : S.powerTW(Number(goal));
      const gapW = (targetTW - base) * 1e12;
      const name = goal === 'double' ? 'double today' : goal === '1' ? 'Type I' : 'K ' + goal;
      $('lv-answer').textContent = `To ${goal === 'double' ? '' : 'reach '}${name} (${fmt(targetTW)} TW), we need ${fmt(gapW / 1e12)} TW more power, running all day and night. Any one of these would do it:`;

      const solarMW = gapW / src.solar.capacity_factor / 1e6;
      const km2 = solarMW * A.solar_land.acres_per_mwac * 0.00404686;
      const tx = km2 / A.texas_area_km2.value;
      show('lv-solar', fmt(tx, tx < 10 ? 1 : 0), `${fmt(gapW / 1e12)} TW ÷ ${src.solar.capacity_factor * 100}% capacity factor = ${fmt(solarMW / 1e6, 1)} TW of panels × ${A.solar_land.acres_per_mwac} acres/MW = ${fmt(km2)} km² ÷ ${fmt(A.texas_area_km2.value)} km² per Texas`);
      $('lv-solar-note').textContent = `${fmt(km2)} km² of solar farms. Each square below is one Texas.`;
      const row = $('lv-texas'); row.textContent = '';
      const n = Math.min(120, Math.ceil(tx));
      for (let i = 0; i < n; i++) { const t = document.createElement('i'); if (i === n - 1 && tx % 1 && tx < 120) t.style.opacity = String(Math.max(0.25, tx % 1)); row.append(t); }
      if (tx > 120) { const more = document.createElement('span'); more.textContent = '+' + fmt(tx - 120) + ' more'; row.append(more); }

      const reactors = gapW / (src.nuclear.unit_mw * 1e6 * src.nuclear.capacity_factor);
      show('lv-nuke', big(reactors), `${fmt(gapW / 1e12)} TW ÷ (${fmt(src.nuclear.unit_mw)} MW AP1000 × ${src.nuclear.capacity_factor * 100}% capacity factor)`);
      $('lv-nuke-note').textContent = `The world runs about ${src.nuclear.fleet_reactors_high} today, so ${fmt(reactors / src.nuclear.fleet_reactors_high)}× that.`;

      const turbines = gapW / (src.wind.unit_mw * 1e6 * src.wind.capacity_factor);
      show('lv-wind', big(turbines), `${fmt(gapW / 1e12)} TW ÷ (${src.wind.unit_mw} MW average new turbine × ${src.wind.capacity_factor * 100}% capacity factor)`);
      $('lv-wind-note').textContent = `About ${fmt(gapW / src.wind.capacity_factor / 1e9 / src.wind.fleet_gw)}× all the wind power in the world today.`;

      const hb = A.home_battery;
      const homes = gapW * hb.storage_hours_assumption / (hb.kwh * 1000);
      show('lv-bat', big(homes), `${fmt(gapW / 1e12)} TW × ${hb.storage_hours_assumption} hours stored ÷ ${hb.kwh} kWh per home battery. Estimate.`);
      $('lv-bat-note').textContent = `Estimate: if ${hb.storage_hours_assumption} hours of that new power had to be stored, for example solar saved for the night.`;
    }
    document.querySelectorAll('.seg-btn.goal').forEach((b) => b.addEventListener('click', () => {
      goal = b.dataset.goal; document.querySelectorAll('.seg-btn.goal').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render();
    }));
    render();
  }

  /* ---------- Screen 5: one day, solar plus storage ---------- */
  // Illustrative shapes (see footnote): demand low at night, evening peak; solar a noon hump.
  const DEMAND_RAW = [0.78, 0.74, 0.72, 0.71, 0.72, 0.78, 0.88, 0.96, 1.0, 1.02, 1.04, 1.06, 1.08, 1.1, 1.12, 1.14, 1.18, 1.24, 1.28, 1.24, 1.14, 1.02, 0.92, 0.84];
  const dMean = DEMAND_RAW.reduce((a, b) => a + b) / 24;
  const DEMAND = DEMAND_RAW.map((d) => d / dMean);
  const SUN_RAW = DEMAND.map((_, h) => (h >= 6 && h <= 19 ? Math.sin(((h - 6) / 13) * Math.PI) : 0));
  const sunSum = SUN_RAW.reduce((a, b) => a + b);

  function simulateDay(solarRatio, storeHours) {
    const sun = SUN_RAW.map((s) => (s / sunSum) * 24 * solarRatio);
    let soc = 0, out;
    for (let day = 0; day < 3; day++) { // run until the battery settles into a daily cycle
      out = [];
      for (let h = 0; h < 24; h++) {
        const d = DEMAND[h], s = sun[h]; let charge = 0, waste = 0, dis = 0, short = 0;
        if (s >= d) { charge = Math.min(s - d, storeHours - soc); soc += charge; waste = s - d - charge; }
        else { dis = Math.min(d - s, soc); soc -= dis; short = d - s - dis; }
        out.push({ d, s, charge, waste, dis, short });
      }
    }
    const D = out.reduce((a, o) => a + o.d, 0), Sun = out.reduce((a, o) => a + o.s, 0);
    return { hours: out, met: 1 - out.reduce((a, o) => a + o.short, 0) / D, waste: Sun ? out.reduce((a, o) => a + o.waste, 0) / Sun : 0 };
  }

  function dayChart() {
    const W = 640, H = 260, m = { l: 36, r: 10, t: 14, b: 28 };
    const x = (h) => m.l + (h / 24) * (W - m.l - m.r), bw = (W - m.l - m.r) / 24;
    function draw() {
      const ratio = Number($('sun-slider').value), store = Number($('st-slider').value);
      $('sun-val').textContent = Math.round(ratio * 100) + '% of daily use';
      $('st-val').textContent = store === 0 ? 'none' : store + ' hours';
      const r = simulateDay(ratio, store);
      const top = Math.max(2.2, ...r.hours.map((o) => o.s)) * 1.05;
      const y = (v) => H - m.b - (v / top) * (H - m.t - m.b);
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}` });
      [0, 6, 12, 18, 24].forEach((h) => svg.append(el('text', { class: 'tick', x: x(h), y: H - 8, 'text-anchor': 'middle' }, h === 24 ? 'midnight' : h === 0 ? 'midnight' : h === 12 ? 'noon' : (h > 12 ? h - 12 + 'pm' : h + 'am'))));
      r.hours.forEach((o, h) => {
        const x0 = x(h) + 1, w = bw - 2;
        const fromSun = Math.min(o.s, o.d);
        svg.append(el('rect', { class: 'b-sun', x: x0, y: y(fromSun), width: w, height: y(0) - y(fromSun) }));
        if (o.dis > 1e-6) svg.append(el('rect', { class: 'b-bat', x: x0, y: y(fromSun + o.dis), width: w, height: y(fromSun) - y(fromSun + o.dis) }));
        if (o.short > 1e-6) svg.append(el('rect', { class: 'b-short', x: x0, y: y(o.d), width: w, height: y(o.d - o.short) - y(o.d) }));
        if (o.charge > 1e-6) svg.append(el('rect', { class: 'b-charge', x: x0, y: y(o.d + o.charge), width: w, height: y(o.d) - y(o.d + o.charge) }));
        if (o.waste > 1e-6) svg.append(el('rect', { class: 'b-waste', x: x0, y: y(o.s), width: w, height: y(o.s - o.waste) - y(o.s) }));
      });
      const line = r.hours.map((o, h) => `${h ? 'L' : 'M'}${x(h)},${y(o.d)} L${x(h + 1)},${y(o.d)}`).join(' ');
      svg.append(el('path', { class: 'l-demand', d: line }));
      // direct labels instead of a legend
      const noon = r.hours[12], eve = r.hours[20];
      svg.append(el('text', { class: 'dl', x: x(20.5), y: y(eve.d) - 8, 'text-anchor': 'middle' }, 'demand'));
      svg.append(el('text', { class: 'dl sun', x: x(12.5), y: y(Math.min(noon.s, noon.d)) + 18, 'text-anchor': 'middle' }, 'solar used'));
      if (noon.waste > 0.05) svg.append(el('text', { class: 'dl waste', x: x(12.5), y: y(noon.s) - 6, 'text-anchor': 'middle' }, 'wasted'));
      if (noon.charge > 0.05) svg.append(el('text', { class: 'dl charge', x: x(10.5), y: y(r.hours[10].d + r.hours[10].charge) - 6, 'text-anchor': 'middle' }, 'charging'));
      if (eve.dis > 0.05) svg.append(el('text', { class: 'dl bat', x: x(20.5), y: y((eve.s + eve.dis / 2)) + 4, 'text-anchor': 'middle' }, 'battery'));
      if (r.hours[2].short > 0.05) svg.append(el('text', { class: 'dl short', x: x(2.5), y: y(r.hours[2].d / 2) + 4, 'text-anchor': 'middle' }, 'short'));
      const c = $('day-chart'); c.textContent = ''; c.append(svg);
      $('d-met').textContent = Math.round(r.met * 100) + '%';
      $('d-short').textContent = Math.round((1 - r.met) * 100) + '%';
      $('d-waste').textContent = Math.round(r.waste * 100) + '%';
    }
    $('sun-slider').addEventListener('input', draw); $('st-slider').addEventListener('input', draw); draw();
  }

  /* ---------- Screen 6: a battery network ---------- */
  function network() {
    const W = 480, H = 280, cols = 10, rows = 5, homes = [];
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}` });
    const grid = el('rect', { class: 'n-grid', x: 20, y: 14, width: W - 40, height: 26, rx: 6 });
    const gridT = el('text', { class: 'n-gridt', x: W / 2, y: 32, 'text-anchor': 'middle' }, 'THE GRID');
    svg.append(grid, gridT);
    const flows = el('g', {}); svg.append(flows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const cx = 44 + c * 44, cy = 92 + r * 40, g = el('g', {});
      const house = el('path', { class: 'n-house', d: `M${cx - 13},${cy} L${cx},${cy - 12} L${cx + 13},${cy} L${cx + 13},${cy + 16} L${cx - 13},${cy + 16} Z` });
      const win = el('rect', { class: 'n-win', x: cx - 4, y: cy + 3, width: 8, height: 7 });
      const bat = el('rect', { class: 'n-bat', x: cx + 15, y: cy + 2, width: 4, height: 14 });
      const lvl = el('rect', { class: 'n-lvl', x: cx + 15, y: cy + 16, width: 4, height: 0 });
      g.append(house, win, bat, lvl); svg.append(g);
      homes.push({ cx, cy, win, lvl, jitter: Math.random() * 0.1 });
    }
    $('net').append(svg);
    let hour = 8, soc = 0.5, storm = false, playing = !reduced, timer = null;
    function phase(h) { if (h >= 10 && h < 16) return 'charge'; if (h >= 17 && h < 22) return 'send'; return 'hold'; }
    function tick(step = true) {
      if (step) hour = (hour + 1) % 24;
      const p = storm ? 'backup' : phase(hour);
      if (p === 'charge') soc = Math.min(1, soc + 0.1);
      if (p === 'send') soc = Math.max(0.25, soc - 0.12); // the network keeps a backup reserve
      if (p === 'backup') soc = Math.max(0.05, soc - 0.06);
      grid.setAttribute('class', 'n-grid' + (storm ? ' down' : p === 'send' ? ' short' : ''));
      gridT.textContent = storm ? 'GRID DOWN' : p === 'send' ? 'THE GRID · demand spike' : p === 'charge' ? 'THE GRID · cheap midday power' : 'THE GRID';
      flows.textContent = '';
      homes.forEach((o) => {
        const lvl = Math.max(0, Math.min(1, soc + o.jitter - 0.05));
        o.lvl.setAttribute('y', o.cy + 16 - 14 * lvl); o.lvl.setAttribute('height', 14 * lvl);
        o.win.setAttribute('class', 'n-win' + (storm || hour >= 18 || hour < 7 ? ' on' : ''));
        if (p === 'send' || p === 'charge') {
          flows.append(el('line', { class: 'n-flow ' + p, x1: o.cx, y1: o.cy - 12, x2: o.cx, y2: 40 }));
        }
      });
      const clock = (hour % 12 || 12) + (hour < 12 ? 'am' : 'pm');
      $('net-status').innerHTML = storm
        ? `<b>${clock}</b> · The grid is down. Every home keeps its lights on from its own battery.`
        : p === 'charge' ? `<b>${clock}</b> · Power is cheap and plentiful. The batteries charge.`
          : p === 'send' ? `<b>${clock}</b> · Demand spikes. Thousands of batteries send power to the grid at once, like one power plant, while each keeps some backup.`
            : `<b>${clock}</b> · Batteries wait, holding their charge.`;
    }
    function play() { clearInterval(timer); if (playing) timer = setInterval(tick, 700); $('net-play').textContent = playing ? 'Pause' : 'Play'; }
    $('net-play').addEventListener('click', () => { if (reduced) { tick(); return; } playing = !playing; play(); });
    $('net-storm').addEventListener('click', () => { storm = !storm; $('net-storm').textContent = storm ? 'Restore the grid' : 'Storm: grid goes down'; if (storm) soc = Math.max(soc, 0.6); tick(false); });
    tick(false); play();
    if (reduced) $('net-play').textContent = 'Step an hour';
  }

  function start() {
    fetch('/data/build-assumptions.json').then((r) => r.json()).then(levelUp).catch(() => { $('lv-answer').textContent = 'The build assumptions failed to load.'; });
    dayChart();
    network();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
