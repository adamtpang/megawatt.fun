/* Guide interactions. Math comes from climb.js (window.MegawattScale); the 3D layer listens for "mw:scene" events. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d });
  const kOf = (watts) => (Math.log10(watts) - 6) / 10;
  const lightsFor = (k) => Math.min(1, Math.max(0, (k - 0.3) / 0.8));
  function emit(detail) { window.dispatchEvent(new CustomEvent('mw:scene', { detail })); }

  function start() {
    const S = window.MegawattScale;
    let baselineTW = S.BASELINE_TW;

    /* Scene 1: power slider and ladder */
    function humanPower(w) {
      if (w >= 1e27) return 'about 10^' + Math.round(Math.log10(w)) + ' W';
      const units = [[1e24, 'YW'], [1e21, 'ZW'], [1e18, 'EW'], [1e15, 'PW'], [1e12, 'TW'], [1e9, 'GW'], [1e6, 'MW']];
      for (const [v, u] of units) if (w >= v) return 'about ' + fmt(w / v, w / v < 10 ? 1 : 0) + ' ' + u;
      return fmt(w) + ' W';
    }
    function onK() {
      const k = Number($('k-slider').value);
      const w = Math.pow(10, 10 * k + 6);
      $('k-val').textContent = k.toFixed(2);
      $('k-power').textContent = humanPower(w);
      document.querySelectorAll('.rung').forEach((r) => {
        const rk = Number(r.dataset.rung);
        r.classList.toggle('lit', k >= rk);
        r.classList.toggle('here', k >= rk && k < rk + 1);
      });
      emit({ lights: lightsFor(k), zoom: Math.min(1, Math.max(0, (k - 1) / 2)) });
    }
    $('k-slider').addEventListener('input', onK);

    /* Scene 2: today's number from the saved source file */
    function showBaseline(tw) {
      const k = kOf(tw * 1e12);
      $('k-now').textContent = k.toFixed(3);
      $('tw-now').textContent = tw.toFixed(1);
      $('to-type1').textContent = fmt(1e4 / tw) + '×';
      $('pct-type1').textContent = (tw / 1e4 * 100).toFixed(2) + '%';
      const m = tw * 1e12, e = Math.floor(Math.log10(m));
      $('calc-line').innerHTML = 'K = (log<sub>10</sub>(' + (m / 10 ** e).toFixed(2) + ' × 10<sup>' + e + '</sup>) − 6) / 10 = ' + k.toFixed(3);
    }
    showBaseline(baselineTW);
    fetch('/data/kardashev-baseline.json').then((r) => r.json()).then((b) => {
      baselineTW = b.primary_energy_twh / b.hours_in_year; showBaseline(baselineTW); if ($('g-slider')) onGrowth();
    }).catch(() => {});

    /* Scene 4a: growth */
    function onGrowth() {
      const g = Number($('g-slider').value);
      $('g-val').textContent = g.toFixed(1) + '%';
      const y8 = S.yearsTo(S.powerTW(0.8), g, baselineTW), y1 = S.yearsTo(S.powerTW(1), g, baselineTW);
      $('g-08').textContent = y8 + ' years (' + (S.BASELINE_YEAR + y8) + ')';
      $('g-1').textContent = y1 + ' years (' + (S.BASELINE_YEAR + y1) + ')';
    }
    if ($('g-slider')) { $('g-slider').addEventListener('input', onGrowth); onGrowth(); }

    /* Scene 4b: queue */
    function onQueue() { const w = Number($('q-slider').value); $('q-wait').textContent = w; $('q-on').textContent = 2026 + w; }
    if ($('q-slider')) { $('q-slider').addEventListener('input', onQueue); onQueue(); }

    /* Scene 4c: play the grid operator (same battery and rules as dispatch/dispatch.go) */
    const BAT = { kwh: 25, kw: 5, eff: 0.88 };
    const reserveKwh = () => ($('game-reserve') && $('game-reserve').checked ? 5 : 0);
    const game = $('grid-game'), out = $('game-out');
    let prices = [], state = [];
    const STATES = ['idle', 'charge', 'discharge'];
    function simulate(plan) {
      let stored = 0, cost = 0, revenue = 0, bought = 0, sold = 0;
      plan.forEach((s, h) => {
        const p = prices[h].usd / 1000;
        if (s === 'charge') { const e = Math.min(BAT.kw, BAT.kwh - stored); stored += e; bought += e; cost += e * p; }
        if (s === 'discharge') { const e = Math.min(BAT.kw, Math.max(0, stored - reserveKwh()) * BAT.eff); stored -= e / BAT.eff; sold += e; revenue += e * p; }
      });
      return { cost, revenue, bought, sold, profit: revenue - cost };
    }
    function bestPlan() { // port of PlanDay: one charge window before a boundary, one discharge window after
      let best = null, bestProfit = 0;
      for (let t = 1; t < prices.length; t++) {
        const plan = new Array(prices.length).fill('idle');
        const before = [...prices.keys()].slice(0, t).sort((a, b) => prices[a].usd - prices[b].usd);
        const after = [...prices.keys()].slice(t).sort((a, b) => prices[b].usd - prices[a].usd);
        let toBuy = BAT.kwh; for (const h of before) { if (toBuy <= 0) break; plan[h] = 'charge'; toBuy -= BAT.kw; }
        let toSell = (BAT.kwh - reserveKwh()) * BAT.eff; for (const h of after) { if (toSell <= 1e-9) break; plan[h] = 'discharge'; toSell -= BAT.kw; }
        const r = simulate(plan);
        if (r.profit > bestProfit) { bestProfit = r.profit; best = plan; }
      }
      return best || new Array(prices.length).fill('idle');
    }
    function render() {
      const r = simulate(state);
      [...game.children].forEach((b, h) => { b.className = 'hour ' + state[h]; b.setAttribute('aria-label', prices[h].hour + ', $' + prices[h].usd.toFixed(2) + ' per MWh, ' + (state[h] === 'discharge' ? 'sell' : state[h])); });
      if (!state.some((s) => s !== 'idle')) { out.textContent = 'Tap some hours to start.'; return; }
      const cls = r.profit >= 0 ? 'good' : 'bad';
      out.innerHTML = 'Bought ' + fmt(r.bought, 1) + ' kWh for $' + r.cost.toFixed(2) + ', sold ' + fmt(r.sold, 1) + ' kWh for $' + r.revenue.toFixed(2) +
        '<br>Your day: <strong class="' + cls + '">' + (r.profit < 0 ? '−' : '') + '$' + Math.abs(r.profit).toFixed(2) + '</strong>' +
        (r.sold < 1e-9 ? ' · you bought power but never sold it' : '');
    }
    fetch('/data/ercot-dam-hubavg-2026-08-13.csv').then((r) => r.text()).then((txt) => {
      prices = txt.trim().split(/\r?\n/).slice(1).map((l) => { const [hour, usd] = l.split(','); return { hour, usd: Number(usd) }; });
      state = prices.map(() => 'idle');
      const max = Math.max(...prices.map((p) => p.usd));
      prices.forEach((p, h) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'hour idle'; b.style.height = Math.max(6, p.usd / max * 100) + '%';
        b.title = p.hour + ' · $' + p.usd.toFixed(2) + '/MWh';
        b.addEventListener('click', () => { state[h] = STATES[(STATES.indexOf(state[h]) + 1) % 3]; render(); });
        game.appendChild(b);
        const s = document.createElement('span'); s.textContent = p.hour.slice(0, 2); $('hour-axis').appendChild(s);
      });
      render();
    }).catch(() => { out.textContent = 'Price data failed to load. The saved CSV is linked in source 14.'; });
    $('game-best').addEventListener('click', () => { if (prices.length) { state = bestPlan(); render(); } });
    if ($('game-reserve')) $('game-reserve').addEventListener('change', () => { if (prices.length) render(); });
    $('game-reset').addEventListener('click', () => { state = prices.map(() => 'idle'); render(); });

    /* Scene 3 and page position drive the Earth */
    const eras = document.querySelectorAll('[data-lights]');
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => entries.forEach((e) => {
        if (e.isIntersecting) emit({ lights: Number(e.target.dataset.lights), zoom: 0 });
      }), { threshold: 0.6 });
      eras.forEach((el) => io.observe(el));
      const sceneIO = new IntersectionObserver((entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        if (e.target.id === 'what') onK();
        else if (e.target.id !== 'history') emit({ lights: lightsFor(kOf(baselineTW * 1e12)), zoom: 0 });
      }), { threshold: 0.4 });
      ['what', 'where', 'levelup', 'you'].forEach((id) => sceneIO.observe($(id)));
    }
    onK();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
