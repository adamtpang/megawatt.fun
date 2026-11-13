/* Homepage: scrub through one average day of a home battery, then read who makes what.
   Math: day-core.js, pjm-core.js, finance-core.js. Data: data/pjm-value.json (PJM), data/day-ercot.json (Texas),
   data/finance-defaults.json. Each zone carries its market: the two differ in clock, in what a battery may sell,
   and in which charges exist.
   The house is day-scene.js; this file only tells it the hour's glow and daylight. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cents = (usdPerMwh) => (usdPerMwh / 10).toFixed(1) + '¢';
  const usd = (n) => (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  const usd2 = (n) => (n < -0.004 ? '-' : '') + '$' + Math.abs(n).toFixed(2);
  const big = (n) => n >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : usd(n);
  const clock = (h) => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
  const F = window.FinanceCore, P = window.PjmCore, C = window.DayCore;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  let V, T, D, BASE, timer = null, G = null; // G: the chart's geometry, for the playhead and for scrubbing

  function row(label, value, cls, small) {
    return '<div' + (cls ? ' class="' + cls + '"' : '') + '><dt>' + label + (small ? '<small>' + small + '</small>' : '') + '</dt><dd>' + value + '</dd></div>';
  }
  const texas = (z) => z.states[0] === 'TX' && T.zones.indexOf(z) >= 0;
  const zone = () => T.zones.concat(V.zones).find((x) => x.id === $('zone').value);
  const market = (z) => (texas(z) ? T : V);
  // PJM: the battery covers the home's own load. Texas: it sells at its full power, as scripts/zone-value.cjs does.
  const theDay = (z) => (texas(z) ? C.day(z, T.schedule, T.spec, { exportKw: T.spec.power }) : C.day(z, V.schedule, V.spec, { homeKw: P.DEFAULTS.tagKw }));
  // One battery's yearly value. Texas has energy only: no capacity market, and homes are not billed on peak charges.
  const valueOf = (z) => (texas(z) ? { energy: z.energyUsdPerYear, capacity: 0, transmission: 0, total: z.energyUsdPerYear, tagStatus: 'none', potential: 0 } : P.valueZone(z, {}));

  function renderHour() {
    const z0 = zone(), tx = texas(z0), d = theDay(z0), i = Number($('hour').value), x = d.hours[i];
    const s = x.peak && x.state === 'idle' ? 'peak' : x.state;
    const pair = C.sky(i);
    $('scene').style.setProperty('--sky-a', pair[0]); $('scene').style.setProperty('--sky-b', pair[1]);
    $('clock').textContent = clock(i) + ' to ' + clock((i + 1) % 24);
    $('chip').dataset.s = s;
    $('chip').textContent = { charge: 'Charging from the grid', run: tx ? 'Powering the home and the grid' : 'Running the home', peak: 'Grid peak hour', idle: 'Standing by' }[s];
    $('price').textContent = cents(x.price);
    $('soc').textContent = Math.round(x.soc * 100) + '%';
    $('gauge').dataset.s = x.state; $('gauge-fill').style.width = (x.soc * 100).toFixed(0) + '%';
    $('tally').textContent = usd2(x.cash);
    $('why').textContent = {
      charge: 'Power is cheapest now, so the battery fills up from the grid.',
      run: tx ? 'Power costs the most now. The battery runs the home and sells the rest to the grid.' : 'Power costs the most now. The battery runs the home, so the home buys nothing.',
      peak: 'The grid\'s busiest hours of 2026 began at this time. A few hours like this set next year\'s capacity and transmission charges.',
      idle: x.soc > 0.99 ? 'The home runs on the grid. The battery waits, full, in case the power goes out.'
        : 'The home runs on the grid. The battery waits at ' + Math.round(x.soc * 100) + '% and will refill ' + (tx ? 'at midday.' : 'overnight.'),
    }[s];
    if (G) { // move the playhead
      const px = G.x(i + 0.5), py = G.y(x.price / 10), val = $('head-val');
      $('head-line').setAttribute('x1', px); $('head-line').setAttribute('x2', px);
      $('head-dot').setAttribute('cx', px); $('head-dot').setAttribute('cy', py);
      val.textContent = cents(x.price);
      val.setAttribute('x', Math.max(G.l + 16, Math.min(G.r - 16, px))); val.setAttribute('y', Math.max(11, py - 10));
    }
    $('hour').setAttribute('aria-valuetext', clock(i) + ', ' + cents(x.price) + ' a kWh, ' + $('chip').textContent);
    // day-scene.js is a module and may start after this file: leave the hour where it can find it.
    // The floor is the backdrop's lower color, a little darker, so the house sits on it at any hour.
    const floor = '#' + [1, 3, 5].map((k) => Math.round(parseInt(pair[1].slice(k, k + 2), 16) * 0.9).toString(16).padStart(2, '0')).join('');
    window.StagePending = { name: s, ground: floor, glow: x.state === 'charge' ? css('--charge') : x.state === 'run' ? css('--run') : null, daylight: C.daylight(i) };
    if (window.Stage) window.Stage.set(window.StagePending);
  }

  // The price chart: a stepped line of hourly averages with real axes, the charge and discharge windows shaded,
  // the grid's peak hour marked, and a playhead for the chosen hour.
  function drawChart(d) {
    const el = $('chart'), W = Math.max(280, Math.round(el.clientWidth)), H = W < 560 ? 168 : 216;
    const l = 30, r = W - 6, t = 16, b = H - 22, step = (r - l) / 24;
    const topC = d.top / 10, gap = topC > 12 ? 4 : topC > 6 ? 2 : 1, max = Math.ceil(topC / gap) * gap;
    const x = (h) => l + h * step, y = (c) => b - (c / max) * (b - t);
    let grid = '', axis = '';
    for (let c = 0; c <= max + 1e-9; c += gap) {
      grid += '<line class="' + (c === 0 ? 'base' : 'grid') + '" x1="' + l + '" x2="' + r + '" y1="' + y(c).toFixed(1) + '" y2="' + y(c).toFixed(1) + '"/>';
      axis += '<text x="' + (l - 6) + '" y="' + (y(c) + 3.5).toFixed(1) + '" text-anchor="end">' + c + '¢</text>';
    }
    const every = W < 560 ? 6 : 3;
    for (let h = 0; h <= 24; h += every) {
      axis += '<text x="' + x(h).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + (h === 0 ? 'start' : h === 24 ? 'end' : 'middle') + '">' + (h === 24 ? clock(0) : clock(h)) + '</text>';
    }
    const band = (a, z, cls) => '<rect class="' + cls + '" x="' + x(a).toFixed(1) + '" y="' + t + '" width="' + ((z - a) * step).toFixed(1) + '" height="' + (b - t) + '"/>';
    let line = '';
    d.hours.forEach((hh, i) => { const yy = y(hh.price / 10).toFixed(1); line += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + yy + 'L' + x(i + 1).toFixed(1) + ' ' + yy; });
    const charged = d.hours.filter((hh) => hh.state === 'charge').map((hh) => hh.i), ran = d.hours.filter((hh) => hh.state === 'run').map((hh) => hh.i);
    const peak = d.peakHour == null ? '' : '<line class="peak-line" x1="' + x(d.peakHour + 0.5).toFixed(1) + '" x2="' + x(d.peakHour + 0.5).toFixed(1) + '" y1="' + t + '" y2="' + b + '"/>';
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="presentation">'
      + (charged.length ? band(charged[0], charged[charged.length - 1] + 1, 'b-charge') : '') + (ran.length ? band(ran[0], ran[ran.length - 1] + 1, 'b-run') : '')
      + grid + '<path class="area" d="' + line + 'L' + r + ' ' + b + 'L' + l + ' ' + b + 'Z"/><path class="price" d="' + line + '"/>' + peak + axis
      + '<line class="head-line" id="head-line" y1="' + t + '" y2="' + b + '"/><circle class="head-dot" id="head-dot" r="4.5"/><text class="head-val" id="head-val" text-anchor="middle"></text></svg>';
    G = { x, y, l, r, step };
  }

  function render() {
    const z = zone(), tx = texas(z), M = market(z), name = z.shortName || z.utility, d = theDay(z), v = valueOf(z);
    const counted = v.tagStatus === 'interval' || v.tagStatus === 'partly';
    $('say').textContent = 'In ' + name + ', power averages ' + cents(d.night) + ' a kWh ' + (tx ? 'at midday and ' : 'overnight and ') + cents(d.evening) + (tx ? ' after sunset.' : ' in the evening.') + ' Drag across the chart to see what a home battery does with that gap.';
    $('leg-run').textContent = tx ? 'Powering the home and the grid' : 'Running the home';
    $('leg-peak').hidden = d.peakHour == null;
    drawChart(d);
    $('year').textContent = usd(v.total);
    $('strip-cap').textContent = 'Average real-time price each hour, ' + M.period.start + ' to ' + M.period.endExclusive + ', ' + z.timezone + ' time. The day shown is an average one; the yearly figure uses every real hour.';

    // The home
    $('home-used').textContent = Math.round((1 - d.low) * 100) + '%';
    $('home-call').textContent = tx ? 'The last ' + Math.round(d.low * 100) + '% is never sold. It is kept for an outage (a reserve this model assumes).'
      : 'The rest of the battery, ' + Math.round(d.low * 100) + '%, sits ready for an outage.';

    // The battery's owner
    $('owner-say').textContent = 'What that one battery earns the company that owns it in ' + name + ', in a year.';
    $('owner-dl').innerHTML =
      row(tx ? 'Buying low, selling high' : 'Buying low, using high', usd(v.energy), '', cents(d.night) + ' in, ' + cents(d.evening) + ' out')
      + (tx ? row('Capacity charge avoided', 'none in Texas', 'off', 'Texas has no capacity market')
        : row('Capacity charge avoided', counted ? usd(v.capacity) : 'not counted', counted ? '' : 'off', counted ? 'set by five peak hours a year' : ''))
      + (tx ? row('Other grid services', 'not counted', 'off', 'reserves and peak programs are left out')
        : row('Transmission charge avoided', counted && v.transmission ? usd(v.transmission) : 'not counted', counted && v.transmission ? '' : 'off'))
      + row('A year, one battery <span class="est">estimate</span>', usd(v.total), 'sum');
    const cityOwned = tx && z.choice === 'none';
    $('owner-call').hidden = tx ? !cityOwned : !(counted && d.peakMissed && d.allPeaksSameHour);
    $('owner-call').className = 'call' + (tx ? ' calm' : '');
    $('owner-call').textContent = tx ? name + ' is a city utility or co-op area with no retail choice. This value goes to the utility, so a battery company reaches it only as the utility\'s partner.'
      : 'All five 2026 peak hours began at ' + clock(d.peakHour) + ' here, outside the evening window. A battery on a fixed clock misses them; one that watches the grid does not.';
    $('owner-src').textContent = (tx ? 'A fixed clock on a year of real ERCOT prices: charge 10 AM to 2 PM, sell 7 to 9 PM. '
      : counted ? '' : 'Peak charges are not counted here: this utility sets them by class average, or its rules are not confirmed' + (v.potential ? ' (' + usd(v.potential) + ' more if confirmed). ' : '. '))
      + 'Outside estimate, not Base\'s revenue. Sources are at the foot of the page.';
    $('owner-more').innerHTML = tx ? '<a href="/battery">The full Texas tool: pick a ZIP and a house</a>' : '<a href="/pjm">All 20 PJM utility areas, ranked, and what each state needs to launch</a>';

    // A lender
    const over = { capexPerKwh: Number($('f-cost').value), ratePct: Number($('f-rate').value), tenorYears: Number($('f-tenor').value), dscr: Number($('f-dscr').value) };
    const r = C.fund(F, D, v, over), base = C.fund(F, D, v, BASE);
    const changed = Object.keys(BASE).some((k) => BASE[k] !== over[k]);
    $('fund-say').textContent = 'A lender looks at the cash one battery makes each year in ' + name + ' and asks how big a loan it can repay. The starting numbers are Base\'s published ones. Change them to test your own.';
    $('cost-dl').innerHTML =
      row('Installed cost', usd(r.capex), '', usd(over.capexPerKwh) + ' a kWh, ' + M.spec.capacity + ' kWh')
      + row('Tax credit, sold for cash', usd(-r.itc), '', Math.round(r.itcRate * 100) + '% at ' + Math.round(r.itcPrice * 1000) / 10 + ' cents on the dollar')
      + row('Member pays at install', usd(-r.upfront))
      + row('Left to fund', usd(r.netCapex), 'sum');
    const share = r.netCapex > 0 ? Math.round(r.debt / r.netCapex * 100) : 100;
    $('debt-dl').innerHTML =
      row('Cash after running cost, year 1', usd(r.year1Cfads), '', 'weakest loan year: ' + usd(r.minCfads))
      + row('Loan the cash supports <span class="est">estimate</span>', usd(r.debt) + (changed ? '<span class="was">published figures: ' + usd(base.debt) + '</span>' : ''), '', r.tenor + ' years at ' + over.ratePct + '%, ' + over.dscr + 'x cover')
      + row('Owner\'s own money', usd(r.equity))
      + row('Loan covers', share + '%', 'sum');
    $('debt-call').innerHTML = r.debt <= 0 ? 'No loan: the weakest year has no cash left after running cost.'
      : 'A loan alone would fund the battery at <strong>' + usd(C.fundedCost(F, D, v, over)) + '</strong> a kWh installed, or less.';
    const top = Math.max.apply(null, r.years.map((y) => y.revenue)) || 1, pct = (n) => (n / top * 100).toFixed(1) + '%';
    $('ybars').innerHTML = r.years.map((y) => '<div class="col"><i class="fee" style="height:' + pct(y.member) + '"></i><i class="tag" style="height:' + pct(y.toll) + '"></i><i class="nrg" style="height:' + pct(y.arb) + '"></i></div>').join('')
      + '<span class="ln cost" style="bottom:' + pct(Math.min(r.opex, top)) + '"><b>running cost ' + usd(r.opex) + '</b></span>'
      + (r.debtService > 0 ? '<span class="ln" style="bottom:' + pct(Math.min(r.opex + r.debtService, top)) + ';width:' + (r.tenor / r.life * 100).toFixed(1) + '%"><b>plus loan ' + usd(r.debtService) + '</b></span>' : '');
    $('ybars').setAttribute('aria-label', 'Cash in each year for ' + r.life + ' years: ' + usd(r.years[0].revenue) + ' in year 1 falling to ' + usd(r.years[r.life - 1].revenue)
      + '. Running cost ' + usd(r.opex) + ' a year. Loan payment ' + usd(r.debtService) + ' a year for ' + r.tenor + ' years.');
    $('ynums').innerHTML = r.years.map((y) => '<span>' + y.year + '</span>').join('');
    $('fund-src').textContent = 'The gap between the bars and the solid line is the lender\'s cushion. Battery income fades as the battery ages; fees do not. Cost is the midpoint of the $300 to $400 a kWh Base publishes, which may include its margin. '
      + (tx ? 'Retail margin is left out here; the Texas battery tool counts it. ' : 'Retail margin is left out (no public PJM figure). ')
      + 'Interest, term, cover, running cost and life are assumptions. Outside estimate, not Base\'s books.';

    // A data center
    const mw = Math.min(2000, Math.max(1, Number($('mw').value) || 100));
    const L = C.load(z, tx ? null : V.capacity.deliveryYears[0].usdPerMwDay, mw, C.LOAD_FACTOR);
    $('load-say').textContent = (tx ? 'The same prices, at ' : 'The same prices and the same peak hours, at ') + mw.toLocaleString('en-US') + ' MW. What it pays for power in ' + name + ' in a year, running at ' + (C.LOAD_FACTOR * 100) + '% (an assumption).';
    $('load-dl').innerHTML =
      row('Energy', big(L.energy), '', 'at the average price, ' + cents(z.avgRtUsdPerMwh) + ' a kWh')
      + (tx ? row('Capacity charge', 'none in Texas', 'off', 'Texas has no capacity market')
        : row('Capacity charge', big(L.capacity), '', usd(L.capPerMw) + ' per MW'))
      + (tx ? row('Transmission charge', 'not in this data', 'off', 'set by four summer peaks a year')
        : row('Transmission charge', big(L.transmission), '', usd(L.txPerMw) + ' per MW' + (L.txFixed ? ', fixed in this state' : '')))
      + row((tx ? 'Energy only, a year' : 'A year') + ' <span class="est">estimate</span>', big(L.total), 'sum');
    $('load-call').className = 'call' + (tx ? ' calm' : '');
    $('load-call').innerHTML = tx ? 'In Texas a large load\'s transmission bill is set by its use in four summer peak intervals a year. Staying off the grid in those intervals is the saving a battery on site buys. The rate is not in this data yet.'
      : 'Each MW kept off the grid in the peak hours that set ' + (L.txFixed ? 'the capacity charge' : 'those charges') + ' avoids <strong>' + usd(L.avoidedPerMw) + '</strong> a year. A battery on site is one way to do it.';
    $('load-src').textContent = 'A sketch from public prices, not yet a tool. ' + (tx ? '' : 'Assumes the charges follow the site\'s own metered use in the peak hours. ') + 'Delivery charges are not included. Sources are at the foot of the page.';
    sources(tx);

    renderHour();
  }

  function sources(tx) {
    const cap = V.capacity.deliveryYears[0];
    const grid = tx ? [
      '<a href="' + esc(T.pricesSource.url) + '">' + esc(T.pricesSource.title) + '</a>, ' + esc(T.period.start) + ' to ' + esc(T.period.endExclusive) + ', read ' + esc(T.period.asOf) + '. Provenance: <a href="/data/deployment/manifest.json">manifest</a>.',
      'Yearly value per zone: the fixed Texas clock in <a href="/battery">the Texas battery tool</a>. Energy only.',
    ] : [
      '<a href="' + esc(V.pricesSource.url) + '">' + esc(V.pricesSource.title) + '</a>, fetched ' + esc(V.period.fetched) + '. Peak hours computed from metered load; PJM\'s official list may differ slightly.',
      '<a href="' + esc(cap.source) + '">PJM capacity auction for ' + esc(cap.year) + '</a>: $' + cap.usdPerMwDay + ' per MW-day.',
      '<a href="' + esc(V.nits.source) + '">PJM network transmission rates</a>, effective ' + esc(V.nits.effective) + '.',
    ];
    $('sources').innerHTML = grid.concat([
      '<a href="https://www.basepowercompany.com/utilities">Base Power, utilities page</a>: landed cost of storage about $300 to $400 a kWh; $695 install and $19 a month. Read 29 Oct 2026.',
      '<a href="https://www.law.cornell.edu/uscode/text/26/48E">26 U.S.C. 48E</a>, investment credit for energy storage; sale price from the Crux Q1 2026 market update.',
    ]).map((s) => '<li>' + s + '</li>').join('');
  }

  function pickTab(tab) {
    document.querySelectorAll('.tabs [role=tab]').forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
  }
  function stop() { clearInterval(timer); timer = null; $('play').textContent = 'Play the day'; }
  function wire() {
    const tabs = Array.from(document.querySelectorAll('.tabs [role=tab]'));
    tabs.forEach((t, k) => {
      t.addEventListener('click', () => pickTab(t));
      t.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        const next = tabs[(k + step + tabs.length) % tabs.length];
        pickTab(next); next.focus(); e.preventDefault();
      });
    });
    $('hour').addEventListener('input', () => { stop(); renderHour(); });
    // Tap or drag across the bars to pick an hour.
    const bars = $('chart');
    const at = (e) => { const b = bars.getBoundingClientRect(); return G ? Math.max(0, Math.min(23, Math.floor((e.clientX - b.left - G.l) / G.step))) : 0; };
    let raf = 0;
    addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { drawChart(theDay(zone())); renderHour(); }); });
    let dragging = false;
    bars.addEventListener('pointerdown', (e) => { dragging = true; stop(); $('hour').value = at(e); renderHour(); });
    bars.addEventListener('pointermove', (e) => { if (dragging) { $('hour').value = at(e); renderHour(); } });
    addEventListener('pointerup', () => { dragging = false; });
    addEventListener('pointercancel', () => { dragging = false; });
    $('play').addEventListener('click', () => {
      if (timer) return stop();
      $('hour').value = 0; renderHour(); $('play').textContent = 'Pause';
      timer = setInterval(() => {
        const next = Number($('hour').value) + 1;
        if (next > 23) return stop();
        $('hour').value = next; renderHour();
      }, 650);
    });
    $('zone').addEventListener('change', render);
    ['mw', 'f-cost', 'f-rate', 'f-tenor', 'f-dscr'].forEach((id) => $(id).addEventListener('input', render));
  }

  Promise.all(['/data/pjm-value.json', '/data/finance-defaults.json', '/data/day-ercot.json'].map((u) => fetch(u).then((r) => r.json()))).then((both) => {
    V = both[0]; D = both[1]; T = both[2];
    BASE = C.fundBase(D);
    $('f-cost').value = BASE.capexPerKwh; $('f-rate').value = BASE.ratePct; $('f-tenor').value = BASE.tenorYears; $('f-dscr').value = BASE.dscr;
    const opt = (z, label) => '<option value="' + esc(z.id) + '"' + (z.id === 'COMED' ? ' selected' : '') + '>' + esc(label) + '</option>';
    $('zone').innerHTML = '<optgroup label="Texas (ERCOT)">' + T.zones.map((z) => opt(z, z.utility)).join('') + '</optgroup>'
      + '<optgroup label="PJM, mid-Atlantic and Midwest">' + V.zones.map((z) => opt(z, (z.shortName || z.utility) + ' (' + z.states.join(', ') + ')')).join('') + '</optgroup>';
    wire();
    render();
  }).catch((err) => { $('say').textContent = 'The price file did not load: ' + err.message; });
})();
