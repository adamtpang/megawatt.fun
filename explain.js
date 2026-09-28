/* Scenes 3 and 5: the energy-vs-prosperity chart and the "how much do we need" build calculator.
   Data: data/energy-gdp.json (OWID) and data/build-assumptions.json (EIA, GWEC, IRENA, Westinghouse, IAEA). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d });
  const SVG = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
  const REGION = { 'Africa': '#f08a6e', 'Asia': '#ffc46b', 'Europe': '#9fd8ec', 'North America': '#7fd6a4', 'South America': '#c9a7f5', 'Oceania': '#f5a3c7' };
  const CALLOUTS = ['United States', 'China', 'India', 'Nigeria', 'Ethiopia', 'Germany', 'Japan', 'Brazil', 'Iceland', 'Switzerland', 'Singapore'];

  function chart(data) {
    const W = 860, H = 540, m = { l: 62, r: 20, t: 18, b: 52 };
    const X = [500, 200000], Y = [60, 400000];
    const lx = (v) => m.l + (Math.log10(v) - Math.log10(X[0])) / (Math.log10(X[1]) - Math.log10(X[0])) * (W - m.l - m.r);
    const ly = (v) => H - m.b - (Math.log10(v) - Math.log10(Y[0])) / (Math.log10(Y[1]) - Math.log10(Y[0])) * (H - m.t - m.b);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}` });
    [1000, 10000, 100000].forEach((v) => {
      svg.append(el('line', { class: 'ax', x1: lx(v), x2: lx(v), y1: m.t, y2: H - m.b }), el('text', { class: 'tick', x: lx(v), y: H - m.b + 18, 'text-anchor': 'middle' }, '$' + fmt(v)));
    });
    [100, 1000, 10000, 100000].forEach((v) => {
      svg.append(el('line', { class: 'ax', x1: m.l, x2: W - m.r, y1: ly(v), y2: ly(v) }), el('text', { class: 'tick', x: m.l - 8, y: ly(v) + 4, 'text-anchor': 'end' }, fmt(v)));
    });
    svg.append(el('text', { class: 'axl', x: (W + m.l) / 2, y: H - 12, 'text-anchor': 'middle' }, 'GDP per person (PPP, 2021 $) →'));
    svg.append(el('text', { class: 'axl', x: 16, y: (H - m.b) / 2, transform: `rotate(-90 16 ${(H - m.b) / 2})`, 'text-anchor': 'middle' }, 'Energy per person (kWh/yr) →'));

    // least-squares fit on log10 values, drawn across the data range
    const pts = data.points, xs = pts.map((p) => Math.log10(p.g)), ys = pts.map((p) => Math.log10(p.e));
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
    const b = sxy / sxx, a = my - b * mx, fit = (g) => 10 ** (a + b * Math.log10(g));
    const g0 = Math.min(...pts.map((p) => p.g)), g1 = Math.max(...pts.map((p) => p.g));
    svg.append(el('line', { class: 'trend', x1: lx(g0), y1: ly(fit(g0)), x2: lx(g1), y2: ly(fit(g1)) }));

    pts.forEach((p) => {
      const c = el('circle', { class: 'dot', cx: lx(p.g), cy: ly(p.e), r: CALLOUTS.includes(p.n) ? 6 : 4.2, fill: REGION[p.r] || '#888' });
      c.append(el('title', {}, `${p.n} (${p.y}): ${fmt(p.e)} kWh per person, $${fmt(p.g)} GDP per person`));
      svg.append(c);
    });
    pts.filter((p) => CALLOUTS.includes(p.n)).forEach((p) => {
      const right = lx(p.g) < W - 110 && p.n !== 'Iceland';
      svg.append(el('text', { class: 'lab', x: lx(p.g) + (right ? 9 : -9), y: ly(p.e) + 4, 'text-anchor': right ? 'start' : 'end' }, p.n));
    });
    svg.append(el('rect', { class: 'badge', x: m.l + 12, y: m.t + 8, width: 150, height: 30, rx: 15 }), el('text', { class: 'badge-t', x: m.l + 87, y: m.t + 28, 'text-anchor': 'middle' }, 'correlation 0.' + String(data.r_loglog).split('.')[1]));
    $('vc-plot').append(svg);
    $('why-r').textContent = data.r_loglog.toFixed(2);
    $('vc-legend').innerHTML = Object.entries(REGION).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('');
  }

  // 2025 additions for the "vs today's record pace" comparison (IRENA Renewable Capacity Statistics 2026)
  const ADDED_2025_GW = { solar: 511, wind: 158.7 };
  function build(A) {
    const S = window.MegawattScale, base = S.BASELINE_TW;
    const src = A.sources;
    let rung = 0.8, key = 'solar';
    const avgW = { solar: src.solar.unit_mw * 1e6 * src.solar.capacity_factor, wind: src.wind.unit_mw * 1e6 * src.wind.capacity_factor, nuclear: src.nuclear.unit_mw * 1e6 * src.nuclear.capacity_factor };
    const unitName = { solar: 'gigawatt-size solar farms', wind: 'wind turbines', nuclear: 'nuclear reactors' };
    function render() {
      const target = S.powerTW(rung), gapTW = target - base;
      const count = gapTW * 1e12 / avgW[key];
      $('build-answer').textContent = `To reach ${rung === 1 ? 'Type I' : 'K ' + rung} (${fmt(target)} TW), humanity needs about ${fmt(gapTW)} TW more power, running all day, every day. That's ${fmt(gapTW / base, 1)}× everything we use today.`;
      $('build-count').textContent = count >= 1e6 ? fmt(count / 1e6, 1) + 'M' : fmt(count);
      $('build-unit').textContent = 'more ' + unitName[key];
      let multiple;
      if (key === 'nuclear') {
        multiple = count / src.nuclear.fleet_reactors_high;
        $('build-fleet').textContent = `The world runs about ${src.nuclear.fleet_reactors_high} reactors today. You'd need ${fmt(multiple)}× that.`;
      } else {
        const needGW = gapTW * 1e3 / src[key].capacity_factor;
        multiple = needGW / src[key].fleet_gw;
        $('build-fleet').textContent = `That's ${fmt(needGW / 1000, 0)} TW of ${key} panels and turbines on paper (they don't run at full power all the time). Today's whole world fleet is ${fmt(src[key].fleet_gw)} GW, so ${fmt(multiple)}× what exists.`;
      }
      const grid = $('fleet-grid'); grid.textContent = '';
      const n = Math.min(600, Math.round(multiple));
      const frag = document.createDocumentFragment();
      for (let i = 0; i < n; i++) { const s = document.createElement('i'); if (i === 0) s.className = 'today'; frag.append(s); }
      grid.append(frag);
      $('fleet-key').textContent = multiple > 600 ? `Each square is one copy of today's world ${key} fleet. The first (blue) is what exists. Showing 600 of ${fmt(multiple)}.` : `Each square is one copy of today's world ${key} fleet. The first (blue) is what exists.`;
      const year = Number($('by-slider').value), days = (year - 2026) * 365.25;
      $('by-year').textContent = year;
      let rate = `Finish by ${year}: build <strong>${fmt(count / days, count / days < 10 ? 1 : 0)}</strong> ${unitName[key]} every single day.`;
      if (ADDED_2025_GW[key]) {
        const perYearGW = gapTW * 1e3 / src[key].capacity_factor / (year - 2026);
        rate += `<br>That's ${fmt(perYearGW / ADDED_2025_GW[key], 1)}× 2025's record pace (${ADDED_2025_GW[key]} GW added).`;
      }
      $('build-rate').innerHTML = rate;
    }
    document.querySelectorAll('[data-rung]').forEach((b) => { if (!b.classList.contains('seg-btn')) return; b.addEventListener('click', () => { rung = Number(b.dataset.rung); document.querySelectorAll('.seg-btn[data-rung]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); }); });
    document.querySelectorAll('.seg-btn.src').forEach((b) => b.addEventListener('click', () => { key = b.dataset.src; document.querySelectorAll('.seg-btn.src').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); }));
    $('by-slider').addEventListener('input', render);
    render();
  }

  function start() {
    fetch('/data/energy-gdp.json').then((r) => r.json()).then(chart).catch(() => { $('vc-plot').textContent = 'Chart data failed to load. The saved file is linked in source 17.'; });
    fetch('/data/build-assumptions.json').then((r) => r.json()).then(build).catch(() => { $('build-answer').textContent = 'Assumptions failed to load. The saved file is linked in source 21.'; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
