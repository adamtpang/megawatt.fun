/* /generation: where Texas power comes from. Math: generation-core.js. Data: data/supply-ercot.json,
   built by scripts/supply-ercot.py from ERCOT's public settlement files. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const C = window.GenerationCore;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = (h) => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
  const pct = (x) => (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';
  const gw = (mw) => (mw / 1000).toFixed(mw < 9950 ? 1 : 0);
  const twh = (gwh) => (gwh / 1000).toFixed(gwh < 9950 ? 1 : 0);
  const cents = (usdPerMwh) => (usdPerMwh / 10).toFixed(1) + '¢';
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = (key, long) => (long ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] : MON)[Number(key.slice(5, 7)) - 1];
  let D, G = null; // G: geometry of the day chart, for scrubbing

  function axis(l, r, t, b, max, gap, unit) {
    const y = (v) => b - (v / max) * (b - t);
    let s = '';
    for (let v = 0; v <= max + 1e-9; v += gap) {
      s += '<line class="' + (v === 0 ? 'base' : 'grid') + '" x1="' + l + '" x2="' + r + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>'
        + '<text x="' + (l - 6) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + v + unit + '</text>';
    }
    return { y, svg: s };
  }
  const niceMax = (v, gap) => Math.ceil(v / gap) * gap;

  function drawDay() {
    const day = C.day(D), el = $('g-chart'), W = Math.max(280, Math.round(el.clientWidth)), H = W < 560 ? 200 : 260;
    const l = 34, r = W - 4, t = 10, b = H - 22, step = (r - l) / 24;
    const max = niceMax(day.maxTotalMw / 1000, 20), ax = axis(l, r, t, b, max, 20, ''), x = (h) => l + h * step;
    let cols = '';
    day.hours.forEach((hh) => {
      let base = 0;
      hh.parts.forEach((p) => {
        const y1 = ax.y(base / 1000), y2 = ax.y((base + p.mw) / 1000);
        if (y1 - y2 > 0.2) cols += '<rect class="f-' + p.id + '" x="' + (x(hh.h) + 0.5).toFixed(1) + '" y="' + y2.toFixed(1) + '" width="' + (step - 1).toFixed(1) + '" height="' + (y1 - y2).toFixed(1) + '"/>';
        base += p.mw;
      });
    });
    const every = W < 560 ? 6 : 3;
    let labels = '';
    for (let h = 0; h <= 24; h += every) labels += '<text x="' + x(h).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + (h === 0 ? 'start' : h === 24 ? 'end' : 'middle') + '">' + clock(h % 24) + '</text>';
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="presentation">' + ax.svg + cols + labels
      + '<rect class="sel" id="g-sel" y="' + t + '" width="' + step.toFixed(1) + '" height="' + (b - t) + '"/></svg>';

    // The price under it, on the same hour scale.
    const pe = $('g-price'), PH = 120, pt = 14, pb = PH - 8;
    const pmax = niceMax(day.pricePeak / 10, 2), pax = axis(l, r, pt, pb, pmax, 2, '¢');
    let line = '';
    D.priceByHourUsdPerMwh.forEach((p, i) => { const yy = pax.y(p / 10).toFixed(1); line += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + yy + 'L' + x(i + 1).toFixed(1) + ' ' + yy; });
    pe.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + PH + '" width="' + W + '" height="' + PH + '" role="presentation">' + pax.svg
      + '<path class="area" d="' + line + 'L' + r + ' ' + pb + 'L' + l + ' ' + pb + 'Z"/><path class="price" d="' + line + '"/>'
      + '<line class="head-line" id="p-line" y1="' + pt + '" y2="' + pb + '"/><circle class="head-dot" id="p-dot" r="4.5"/><text class="head-val" id="p-val" text-anchor="middle"></text></svg>';
    G = { x, l, r, step, py: pax.y };
  }

  function renderHour() {
    const h = Number($('g-hour').value), x = C.hour(D, h);
    const part = (id) => x.parts.find((p) => p.id === id);
    $('g-state').textContent = clock(h) + ' to ' + clock((h + 1) % 24);
    $('g-clock').textContent = gw(x.totalMw) + ' GW in all';
    $('g-kpis').innerHTML = ['solar', 'wind', 'gas'].map((id) => { const p = part(id); return '<div class="cds--tile kpi"><p class="k"><i class="f-' + id + '"></i>' + esc(p.name) + '</p><p class="v">' + gw(p.mw) + '<small>GW, ' + pct(p.mw / x.totalMw) + '</small></p></div>'; }).join('')
      + '<div class="cds--tile kpi"><p class="k">Hub price</p><p class="v">' + cents(x.priceUsdPerMwh) + '<small>a kWh</small></p></div>';
    if (G) {
      $('g-sel').setAttribute('x', G.x(h).toFixed(1));
      const px = G.x(h + 0.5), py = G.py(x.priceUsdPerMwh / 10), val = $('p-val');
      $('p-line').setAttribute('x1', px); $('p-line').setAttribute('x2', px);
      $('p-dot').setAttribute('cx', px); $('p-dot').setAttribute('cy', py);
      val.textContent = cents(x.priceUsdPerMwh);
      val.setAttribute('x', Math.max(G.l + 16, Math.min(G.r - 16, px))); val.setAttribute('y', Math.max(11, py - 9));
    }
    $('g-hour').setAttribute('aria-valuetext', clock(h) + ': solar ' + gw(part('solar').mw) + ', wind ' + gw(part('wind').mw) + ', gas ' + gw(part('gas').mw) + ' gigawatts, price ' + cents(x.priceUsdPerMwh) + ' a kWh');
  }

  function drawMonths() {
    const ms = C.months(D), el = $('g-months'), W = Math.max(260, Math.round(el.clientWidth) - 32), H = W < 560 ? 200 : 240;
    const l = 34, r = W - 4, t = 10, b = H - 22, step = (r - l) / ms.length;
    const max = niceMax(Math.max.apply(null, ms.map((m) => m.totalGwh)) / 1000, 10), ax = axis(l, r, t, b, max, 10, '');
    let cols = '', labels = '';
    ms.forEach((m, i) => {
      let base = 0;
      D.sources.forEach((s) => {
        const v = m.gwh[s.id], y1 = ax.y(base / 1000), y2 = ax.y((base + v) / 1000);
        if (y1 - y2 > 0.2) cols += '<rect class="f-' + s.id + '" x="' + (l + i * step + 2).toFixed(1) + '" y="' + y2.toFixed(1) + '" width="' + (step - 4).toFixed(1) + '" height="' + (y1 - y2).toFixed(1) + '"/>';
        base += v;
      });
      labels += '<text x="' + (l + (i + 0.5) * step).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + monthName(m.month) + '</text>';
    });
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="presentation">' + ax.svg + cols + labels + '</svg>';
    el.setAttribute('aria-label', 'Energy by month and source, terawatt-hours, ' + monthName(ms[0].month, true) + ' ' + ms[0].month.slice(0, 4) + ' to ' + monthName(ms[ms.length - 1].month, true) + ' ' + ms[ms.length - 1].month.slice(0, 4) + '.');
    const top = (id) => ms.slice().sort((a, b2) => b2.gwh[id] - a.gwh[id])[0];
    $('months-say').textContent = 'Solar made the most in ' + monthName(top('solar').month, true) + ' and wind in ' + monthName(top('wind').month, true)
      + '. Gas covers what is left of demand, and made the most in ' + monthName(top('gas').month, true) + '.';
    const initial = ms.filter((m) => m.settlement !== 'FINAL').map((m) => monthName(m.month));
    $('months-src').textContent = 'Terawatt-hours a month.' + (initial.length ? ' ' + initial.join(', ') + (initial.length === 1 ? ' is' : ' are') + ' from initial settlement and may be revised by ERCOT; the rest are final.' : ' All months are from final settlement.');
  }

  function render() {
    const yr = C.year(D), day = C.day(D), top = yr.ranked, s = (id) => D.sources.find((q) => q.id === id);
    const span = monthName(D.period.start, true) + ' ' + D.period.start.slice(0, 4) + ' through ' + monthName(D.months[D.months.length - 1].month, true) + ' ' + D.months[D.months.length - 1].month.slice(0, 4);
    $('say').textContent = 'From ' + span + ', plants on the Texas grid made ' + Math.round(yr.totalTwh) + ' TWh of electricity. '
      + top[0].name + ' made ' + pct(top[0].share) + ', ' + top[1].name.toLowerCase() + ' ' + pct(top[1].share) + ' and ' + top[2].name.toLowerCase() + ' ' + pct(top[2].share) + '.';

    $('mixbar').innerHTML = top.map((q) => '<i class="f-' + q.id + '" style="flex:' + q.gwh + '" title="' + esc(q.name) + ' ' + pct(q.share) + '"></i>').join('');
    $('mixbar').setAttribute('aria-label', 'Share of energy by source: ' + top.map((q) => q.name + ' ' + pct(q.share)).join(', ') + '.');
    $('year-rows').innerHTML = top.map((q) => '<tr><td><i class="f-' + q.id + '"></i>' + esc(q.name) + '</td><td>' + twh(q.gwh) + '</td><td>' + pct(q.share) + '</td><td' + (q.capacityMw ? '>' + num(q.capacityMw) : ' class="dim">not listed') + '</td></tr>').join('')
      + '<tr class="sum"><td>All sources</td><td>' + twh(D.totalGwh) + '</td><td>100%</td><td></td></tr>';
    $('year-call').textContent = 'Wind and solar together made ' + pct(yr.weatherShare) + ' of the energy. With nuclear and hydro, ' + pct(yr.cleanShare) + ' came from sources that burn nothing. '
      + 'Solar is ' + pct(yr.capacityShare('solar')) + ' of the installed capacity listed here and ' + pct(s('solar').share) + ' of the energy, because it only runs in daylight.';
    $('year-src').textContent = 'Energy is twelve months of ERCOT settlement data. Installed capacity is ERCOT\'s figure on ' + D.sourceCapacity.asOf + ', so it is newer than the energy it sits beside. ERCOT lists no capacity for its Other and Biomass lines.';

    $('day-say').textContent = 'The same twelve months, averaged into one day. Drag across the chart to move through it.';
    drawDay();
    $('g-legend').innerHTML = D.sources.slice().reverse().map((q) => '<li><i class="f-' + q.id + '"></i>' + esc(q.name) + '</li>').join('');
    $('day-call').textContent = 'Solar peaks around ' + clock(day.solarPeakHour) + ' at ' + gw(day.solarPeakMw) + ' GW and is down to ' + gw(s('solar').avgMwByHour[20]) + ' GW by 8 PM. Gas makes up the difference: '
      + gw(day.gasLowMw) + ' GW at ' + clock(day.gasLowHour) + ' and ' + gw(day.gasPeakMw) + ' GW at ' + clock(day.gasPeakHour) + '. Power is cheapest at ' + clock(day.priceLowHour) + ' (' + cents(day.priceLow)
      + ') and costs the most at ' + clock(day.pricePeakHour) + ' (' + cents(day.pricePeak) + ').';
    $('day-src').textContent = 'Each column is the average output in that hour across ' + D.period.days + ' days, Central time. The price is the ERCOT hub average, real-time, over the same days.';

    drawMonths();

    const st = D.storage;
    $('storage-say').textContent = 'Grid batteries do at scale what the home battery on the homepage does: charge when power is cheap and send it back when it is dear.';
    $('storage-rows').innerHTML =
      '<tr><td>Installed battery power<small>ERCOT, ' + esc(D.sourceCapacity.asOf) + '</small></td><td>' + num(st.capacityMw) + ' MW</td></tr>'
      + '<tr><td>Energy taken to charge, a year</td><td>' + twh(st.chargingGwh) + ' TWh</td></tr>'
      + '<tr><td>Busiest hour for charging<small>average ' + gw(st.chargingAvgMwByHour[day.chargePeakHour]) + ' GW</small></td><td>' + clock(day.chargePeakHour) + '</td></tr>'
      + '<tr><td>ERCOT\'s "Other" line, a year<small>probably mostly batteries discharging</small></td><td>' + twh(s('other').gwh) + ' TWh</td></tr>';
    $('storage-src').textContent = st.note;

    $('g-sources').innerHTML = [
      '<a href="' + esc(D.sourceEnergy.page) + '">' + esc(D.sourceEnergy.title) + '</a>. ' + esc(D.sourceEnergy.note),
      '<a href="' + esc(D.sourceCapacity.url) + '">' + esc(D.sourceCapacity.title) + '</a>, read ' + esc(D.sourceCapacity.asOf) + '.',
      esc(D.sourcePrice.title) + ': <a href="' + esc(D.sourcePrice.manifest) + '">provenance</a>.',
      'Summed by <code>scripts/supply-ercot.py</code>; the result is <a href="/data/supply-ercot.json">data/supply-ercot.json</a>, built ' + esc(D.built) + '.',
    ].map((t) => '<li>' + t + '</li>').join('');
    renderHour();
  }

  function wire() {
    $('g-hour').addEventListener('input', renderHour);
    const el = $('g-chart'), pe = $('g-price');
    const at = (e, box) => { const b = box.getBoundingClientRect(); return G ? Math.max(0, Math.min(23, Math.floor((e.clientX - b.left - G.l) / G.step))) : 0; };
    let dragging = false;
    [el, pe].forEach((box) => {
      box.addEventListener('pointerdown', (e) => { dragging = true; $('g-hour').value = at(e, box); renderHour(); });
      box.addEventListener('pointermove', (e) => { if (dragging) { $('g-hour').value = at(e, box); renderHour(); } });
    });
    addEventListener('pointerup', () => { dragging = false; });
    addEventListener('pointercancel', () => { dragging = false; });
    let raf = 0;
    addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { drawDay(); drawMonths(); renderHour(); }); });
  }

  fetch('/data/supply-ercot.json').then((r) => r.json()).then((data) => { D = data; wire(); render(); })
    .catch((err) => { $('say').textContent = 'The generation file did not load: ' + err.message; });
})();
