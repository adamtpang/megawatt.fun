/* /grid: how power moves through Texas. Math and flow geometry: grid-core.js. Data: data/grid-ercot.json,
   built by scripts/grid-ercot.py from ERCOT's public generation, load and price files. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const C = window.GridCore;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = (h) => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
  const pct = (x, d) => (x * 100).toFixed(d == null ? (Math.abs(x) < 0.1 ? 1 : 0) : d) + '%';
  const twh = (gwh) => (gwh / 1000).toFixed(gwh < 9950 ? 1 : 0);
  const cents = (usdPerMwh) => (usdPerMwh / 10).toFixed(1) + '¢';
  const bn = (usd) => '$' + (usd / 1e9).toFixed(usd < 9.95e8 ? 2 : 1) + 'B';
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const day = (iso) => Number(iso.slice(8, 10)) + ' ' + MONTH[Number(iso.slice(5, 7)) - 1] + ' ' + iso.slice(0, 4);
  const hourSpan = (he) => clock(he - 1) + ' to ' + clock(he % 24);
  let D, thin = []; // thin: strands too narrow to label in the diagram, named in its caption

  function drawFlow() {
    const el = $('flow'), W = Math.max(260, Math.round(el.clientWidth) - 32), narrow = W < 520, H = narrow ? 400 : 440;
    const f = C.flow(D, W, H, { nodeW: narrow ? 8 : 12, gap: narrow ? 3 : 5 });
    const label = (n, side) => {
      if (n.h < 11) return '';
      const x = side === 'left' ? f.nodeW + 6 : W - f.nodeW - 6, y = n.y + n.h / 2 + 4;
      const share = '<tspan class="n"> ' + pct(n.share) + '</tspan>';
      const name = narrow && n.name === 'Battery charging' ? 'Batteries' : n.name;
      return '<text x="' + x + '" y="' + y.toFixed(1) + '" text-anchor="' + (side === 'left' ? 'start' : 'end') + '">' + esc(name) + share + '</text>';
    };
    let s = '';
    f.left.forEach((n) => { s += '<path class="band f-' + n.id + '" d="' + n.path + '"/><rect class="node f-' + n.id + '" x="0" y="' + n.y.toFixed(1) + '" width="' + f.nodeW + '" height="' + n.h.toFixed(1) + '"/>'; });
    f.right.forEach((n) => { const k = n.kind === 'storage' ? 'store' : 'use'; s += '<path class="band ' + k + '" d="' + n.path + '"/><rect class="node ' + k + '" x="' + n.x + '" y="' + n.y.toFixed(1) + '" width="' + f.nodeW + '" height="' + n.h.toFixed(1) + '"/>'; });
    s += '<rect class="node grid" x="' + f.mid.x.toFixed(1) + '" y="' + f.mid.y + '" width="' + f.nodeW + '" height="' + f.mid.h + '"/>';
    f.left.forEach((n) => { s += label(n, 'left'); });
    f.right.forEach((n) => { s += label(n, 'right'); });
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="presentation">' + s + '</svg>';
    thin = f.left.concat(f.right).filter((n) => n.h < 11).map((n) => n.name + ' ' + pct(n.share, 1));
    el.setAttribute('aria-label', 'Flow of a year of Texas electricity. Made: ' + f.left.map((n) => n.name + ' ' + pct(n.share)).join(', ')
      + '. Used: ' + f.right.map((n) => n.name + ' ' + pct(n.share)).join(', ') + '.');
  }

  function render() {
    const F = C.facts(D);
    const span = MONTH[Number(D.period.start.slice(5, 7)) - 1] + ' ' + D.period.start.slice(0, 4) + ' through September 2026';
    $('say').textContent = 'From ' + span + ', plants on the Texas grid made ' + twh(D.madeGwh) + ' TWh of electricity. Homes, businesses and industry used ' + twh(D.usedGwh)
      + ' TWh of it, and batteries took ' + twh(D.storage.chargingGwh) + ' TWh to charge. This page follows it from where it was made to where it went, and what it was worth on the way.';

    drawFlow();
    $('flow-src').textContent = 'The thickness of each strand is energy over the year. What was made and what was used or stored agree to within ' + pct(F.balance, 1)
      + '. The regions are ERCOT\'s eight weather zones.' + (thin.length ? ' Too thin to label: ' + thin.join(', ') + '.' : '');

    const topTwo = D.zones[0].share + D.zones[1].share;
    $('go-say').textContent = 'ERCOT reports demand in eight regions. The two largest, ' + D.zones[0].name + ' (' + D.zones[0].places + ') and ' + D.zones[1].name + ' (' + D.zones[1].places + '), used ' + pct(topTwo) + ' of it.';
    $('go-rows').innerHTML = D.zones.map((z) => '<tr><td>' + esc(z.name) + '<small>' + esc(z.places) + '</small></td><td>' + twh(z.gwh) + '</td><td>' + pct(z.share) + '</td><td>' + (z.change >= 0 ? '+' : '') + pct(z.change, 1) + '</td></tr>').join('')
      + '<tr class="sum"><td>All of ERCOT</td><td>' + twh(D.usedGwh) + '</td><td>100%</td><td>' + (D.usedChange >= 0 ? '+' : '') + pct(D.usedChange, 1) + '</td></tr>';
    $('go-call').textContent = 'Texas used ' + pct(D.usedChange, 1) + ' more electricity than in the twelve months before. ' + F.fastest.name + ' (' + F.fastest.places + ') grew fastest, by ' + pct(F.fastest.change)
      + '. ' + F.mostAdded.name + ' added the most, ' + twh(F.addedGwh) + ' TWh.';
    $('go-src').textContent = '"In a year" compares these twelve months with the twelve before (' + MONTH[Number(D.previous.start.slice(5, 7)) - 1] + ' ' + D.previous.start.slice(0, 4) + ' through September 2025). The files do not say what the new demand is; ERCOT\'s large-load queue is on the Texas siting page.';

    $('peak-say').textContent = 'Every plant and every line has to be there for the busiest hour of the year, which was ' + F.peakOverAverage.toFixed(2) + ' times the average. That is why a few peak hours carry so much of the cost of the grid.';
    $('peak-kpis').innerHTML =
      '<div class="cds--tile kpi"><p class="k">Busiest hour</p><p class="v">' + num(D.peak.mw) + '<small>MW</small></p><p class="when">' + day(D.peak.date) + ', ' + hourSpan(D.peak.hourEnding) + '</p></div>'
      + '<div class="cds--tile kpi"><p class="k">Average</p><p class="v">' + num(D.averageMw) + '<small>MW</small></p><p class="when">across ' + num(D.period.hours) + ' hours</p></div>'
      + '<div class="cds--tile kpi"><p class="k">Quietest hour</p><p class="v">' + num(D.low.mw) + '<small>MW</small></p><p class="when">' + day(D.low.date) + ', ' + hourSpan(D.low.hourEnding) + '</p></div>';

    $('worth-say').textContent = 'Each megawatt-hour is paid the price of the hour it was made in. This prices every source at the ERCOT hub average for that hour, so a source that runs when power is cheap earns less per kilowatt-hour.';
    const ranked = D.sources.slice().sort((a, b) => b.valueUsd - a.valueUsd);
    $('worth-rows').innerHTML = ranked.map((s) => '<tr><td><i class="f-' + s.id + '"></i>' + esc(s.name) + '</td><td>' + twh(s.gwh) + '</td><td>' + cents(s.avgPriceUsdPerMwh) + '</td><td>' + bn(s.valueUsd) + '</td></tr>').join('')
      + '<tr class="sum"><td>All sources</td><td>' + twh(D.madeGwh) + '</td><td>' + cents(F.totalValueUsd / (D.madeGwh * 1000)) + '</td><td>' + bn(F.totalValueUsd) + '</td></tr>';
    $('worth-call').textContent = 'Solar earned ' + cents(F.solar.avgPriceUsdPerMwh) + ' a kWh and natural gas ' + cents(F.gas.avgPriceUsdPerMwh) + ', because solar makes its power at midday when it is cheapest. '
      + 'Batteries paid an average of ' + cents(F.chargePrice) + ' to charge. ERCOT\'s Other line, which is probably mostly batteries discharging, earned ' + cents(F.other.avgPriceUsdPerMwh) + '.';
    $('lend-call').textContent = 'This is the number a lender starts from: what a plant\'s output sells for in a year. It is energy at the hub price only. Reserve payments, contracts, tax credits and fuel cost are not in it, so it is not any plant\'s profit.';
    $('worth-src').textContent = 'Fifteen-minute generation priced at the hourly ERCOT hub average, real-time. Serving all demand at that price comes to ' + bn(D.loadValueUsd) + ', an average of ' + cents(D.loadAvgPriceUsdPerMwh)
      + ' a kWh. Bills are higher than this: delivery over the wires, retail costs and taxes are not in these files.';

    $('not-say').textContent = D.notIncluded + ' So this page splits demand by region, not by who used it. Transmission lines and the cost of building them are not here either.';

    $('grid-sources').innerHTML = [
      '<a href="' + esc(D.sourceGeneration.page) + '">' + esc(D.sourceGeneration.title) + '</a>.',
      '<a href="' + esc(D.sourceLoad.page) + '">' + esc(D.sourceLoad.title) + '</a>.',
      esc(D.sourcePrice.title) + ': <a href="' + esc(D.sourcePrice.manifest) + '">provenance</a>.',
      'Joined by <code>scripts/grid-ercot.py</code>; the result is <a href="/data/grid-ercot.json">data/grid-ercot.json</a>, built ' + esc(D.built) + '.',
    ].map((t) => '<li>' + t + '</li>').join('');
  }

  fetch('/data/grid-ercot.json').then((r) => r.json()).then((data) => {
    D = data; render();
    let raf = 0;
    addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawFlow); });
  }).catch((err) => { $('say').textContent = 'The grid file did not load: ' + err.message; });
})();
