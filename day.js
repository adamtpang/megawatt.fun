/* Homepage: scrub through one average day of a home battery, then read who makes what.
   Math: day-core.js, pjm-core.js, finance-core.js. Data: data/pjm-value.json, data/finance-defaults.json.
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
  let V, D, BASE, timer = null;

  function row(label, value, cls, small) {
    return '<div' + (cls ? ' class="' + cls + '"' : '') + '><dt>' + label + (small ? '<small>' + small + '</small>' : '') + '</dt><dd>' + value + '</dd></div>';
  }
  const zone = () => V.zones.find((x) => x.id === $('zone').value);
  const theDay = (z) => C.day(z, V.schedule, V.spec, P.DEFAULTS.tagKw);

  function renderHour() {
    const d = theDay(zone()), i = Number($('hour').value), x = d.hours[i];
    const s = x.peak && x.state === 'idle' ? 'peak' : x.state;
    const pair = C.sky(i);
    $('scene').style.setProperty('--sky-a', pair[0]); $('scene').style.setProperty('--sky-b', pair[1]);
    const sunUp = i >= 6 && i < 19, arc = sunUp ? (i + 0.5 - 6) / 13 : ((i + 0.5 + 24 - 19) % 24) / 11;
    $('orb').className = 'orb' + (sunUp ? '' : ' moon');
    $('orb').style.left = (12 + arc * 76) + '%'; $('orb').style.top = (46 - Math.sin(arc * Math.PI) * 30) + '%';
    $('clock').textContent = clock(i);
    $('chip').dataset.s = s;
    $('chip').textContent = { charge: 'Charging from the grid', run: 'Running the home', peak: 'Grid peak hour', idle: 'Standing by' }[s];
    $('price').textContent = cents(x.price);
    $('soc').textContent = Math.round(x.soc * 100) + '%';
    $('gauge').dataset.s = x.state; $('gauge-fill').style.width = (x.soc * 100).toFixed(0) + '%';
    $('tally').textContent = usd2(x.cash);
    $('why').textContent = {
      charge: 'Power is cheapest now, so the battery fills up from the grid.',
      run: 'Power costs the most now. The battery runs the home, so the home buys nothing.',
      peak: 'The grid\'s busiest hours of 2026 began at this time. A few hours like this set next year\'s capacity and transmission charges.',
      idle: x.soc > 0.99 ? 'The home runs on the grid. The battery waits, full, in case the power goes out.'
        : 'The home runs on the grid. The battery waits at ' + Math.round(x.soc * 100) + '% and will refill overnight.',
    }[s];
    Array.prototype.forEach.call($('bars').children, (el, k) => { el.classList.toggle('on', k === i); el.classList.toggle('past', k < i); });
    $('hour').setAttribute('aria-valuetext', clock(i) + ', ' + cents(x.price) + ' a kWh, ' + $('chip').textContent);
    // day-scene.js is a module and may start after this file: leave the hour where it can find it.
    window.StagePending = { name: s, glow: x.state === 'charge' ? css('--charge') : x.state === 'run' ? css('--run') : null, daylight: C.daylight(i) };
    if (window.Stage) window.Stage.set(window.StagePending);
  }

  function render() {
    const z = zone(), name = z.shortName || z.utility, d = theDay(z), v = P.valueZone(z, {});
    const counted = v.tagStatus === 'interval' || v.tagStatus === 'partly';
    $('say').textContent = 'In ' + name + ', power costs ' + cents(d.night) + ' overnight and ' + cents(d.evening) + ' at dinner time. Drag through the day to see what a home battery does about it.';
    $('bars').innerHTML = d.hours.map((x) => '<i class="' + (x.state === 'charge' ? 'c' : x.state === 'run' ? 'r' : x.peak ? 'p' : '') + '" style="height:' + (x.price / d.top * 100).toFixed(1) + '%"></i>').join('');
    $('year').textContent = usd(v.total);
    $('strip-cap').textContent = 'Average price each hour, ' + V.period.start + ' to ' + V.period.endExclusive + ', ' + z.timezone + ' time. The day shown is an average one; the yearly figure uses every real hour.';

    // The home
    $('home-used').textContent = Math.round((1 - d.low) * 100) + '%';
    $('home-call').textContent = 'The rest of the battery, ' + Math.round(d.low * 100) + '%, sits ready for an outage.';

    // The battery's owner
    $('owner-say').textContent = 'What that one battery earns the company that owns it in ' + name + ', in a year.';
    $('owner-dl').innerHTML =
      row('Buying low, using high', usd(v.energy), '', cents(d.night) + ' in, ' + cents(d.evening) + ' out')
      + row('Capacity charge avoided', counted ? usd(v.capacity) : 'not counted', counted ? '' : 'off', counted ? 'set by five peak hours a year' : '')
      + row('Transmission charge avoided', counted && v.transmission ? usd(v.transmission) : 'not counted', counted && v.transmission ? '' : 'off')
      + row('A year, one battery <span class="est">estimate</span>', usd(v.total), 'sum');
    $('owner-call').hidden = !(counted && d.peakMissed && d.allPeaksSameHour);
    $('owner-call').textContent = 'All five 2026 peak hours began at ' + clock(d.peakHour) + ' here, outside the evening window. A battery on a fixed clock misses them; one that watches the grid does not.';
    $('owner-src').textContent = (counted ? '' : 'Peak charges are not counted here: this utility sets them by class average, or its rules are not confirmed'
      + (v.potential ? ' (' + usd(v.potential) + ' more if confirmed). ' : '. ')) + 'Outside estimate, not Base\'s revenue. Sources 1 to 3.';

    // A lender
    const over = { capexPerKwh: Number($('f-cost').value), ratePct: Number($('f-rate').value), tenorYears: Number($('f-tenor').value), dscr: Number($('f-dscr').value) };
    const r = C.fund(F, D, v, over), base = C.fund(F, D, v, BASE);
    const changed = Object.keys(BASE).some((k) => BASE[k] !== over[k]);
    $('fund-say').textContent = 'A lender looks at the cash one battery makes each year in ' + name + ' and asks how big a loan it can repay. The starting numbers are Base\'s published ones. Change them to test your own.';
    $('cost-dl').innerHTML =
      row('Installed cost', usd(r.capex), '', usd(over.capexPerKwh) + ' a kWh, ' + V.spec.capacity + ' kWh')
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
      + 'Retail margin is left out (no public PJM figure). Interest, term, cover, running cost and life are assumptions. Outside estimate, not Base\'s books. Sources 4 and 5.';

    // A data center
    const mw = Math.min(2000, Math.max(1, Number($('mw').value) || 100));
    const L = C.load(z, V.capacity.deliveryYears[0].usdPerMwDay, mw, C.LOAD_FACTOR);
    $('load-say').textContent = 'The same prices and the same peak hours, at ' + mw.toLocaleString('en-US') + ' MW. What it pays for power in ' + name + ' in a year, running at ' + (C.LOAD_FACTOR * 100) + '% (an assumption).';
    $('load-dl').innerHTML =
      row('Energy', big(L.energy), '', 'at the average price, ' + cents(z.avgRtUsdPerMwh) + ' a kWh')
      + row('Capacity charge', big(L.capacity), '', usd(L.capPerMw) + ' per MW')
      + row('Transmission charge', big(L.transmission), '', usd(L.txPerMw) + ' per MW' + (L.txFixed ? ', fixed in this state' : ''))
      + row('A year <span class="est">estimate</span>', big(L.total), 'sum');
    $('load-call').innerHTML = 'Each MW kept off the grid in the peak hours that set ' + (L.txFixed ? 'the capacity charge' : 'those charges') + ' avoids <strong>'
      + usd(L.avoidedPerMw) + '</strong> a year. A battery on site is one way to do it.';
    $('load-src').textContent = 'A sketch from the same public rates, not yet a tool. Assumes the charges follow the site\'s own metered use in the peak hours. Delivery charges are not included. Sources 1 to 3.';

    renderHour();
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
    const bars = $('bars');
    const at = (e) => { const b = bars.getBoundingClientRect(); return Math.max(0, Math.min(23, Math.floor((e.clientX - b.left) / b.width * 24))); };
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

  Promise.all([fetch('/data/pjm-value.json').then((r) => r.json()), fetch('/data/finance-defaults.json').then((r) => r.json())]).then((both) => {
    V = both[0]; D = both[1];
    BASE = C.fundBase(D);
    $('f-cost').value = BASE.capexPerKwh; $('f-rate').value = BASE.ratePct; $('f-tenor').value = BASE.tenorYears; $('f-dscr').value = BASE.dscr;
    $('zone').innerHTML = V.zones.map((z) => '<option value="' + esc(z.id) + '"' + (z.id === 'COMED' ? ' selected' : '') + '>'
      + esc((z.shortName || z.utility) + ' (' + z.states.join(', ') + ')') + '</option>').join('');
    const cap = V.capacity.deliveryYears[0];
    $('sources').innerHTML = [
      '<a href="' + esc(V.pricesSource.url) + '">' + esc(V.pricesSource.title) + '</a>, fetched ' + esc(V.period.fetched) + '. Peak hours computed from metered load; PJM\'s official list may differ slightly.',
      '<a href="' + esc(cap.source) + '">PJM capacity auction for ' + esc(cap.year) + '</a>: $' + cap.usdPerMwDay + ' per MW-day.',
      '<a href="' + esc(V.nits.source) + '">PJM network transmission rates</a>, effective ' + esc(V.nits.effective) + '.',
      '<a href="https://www.basepowercompany.com/utilities">Base Power, utilities page</a>: landed cost of storage about $300 to $400 a kWh; $695 install and $19 a month. Read 29 Oct 2026.',
      '<a href="https://www.law.cornell.edu/uscode/text/26/48E">26 U.S.C. 48E</a>, investment credit for energy storage; sale price from the Crux Q1 2026 market update.',
    ].map((s) => '<li>' + s + '</li>').join('');
    wire();
    render();
  }).catch((err) => { $('say').textContent = 'The price file did not load: ' + err.message; });
})();
