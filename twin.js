/* /twin: run a home battery or a data center through one real year, hour by hour.
   Engine: twin-core.js. Data: data/deployment/LZ_*.csv (hourly prices), data/twin-ercot-load.json (hourly grid
   demand), data/datacenter-ercot.json (the wires rate and the four peak hours). The house is day-scene.js. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const T = window.TwinCore, F = window.FinanceCore;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = (h) => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
  const usd = (n) => (n < -0.5 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  const usd2 = (n) => (n < -0.004 ? '-' : '') + '$' + Math.abs(n).toFixed(2);
  const big = (n) => { const a = Math.abs(n), s = n < 0 ? '-' : ''; return a >= 1e6 ? s + '$' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M' : usd(n); };
  const cents = (usdPerMwh) => (usdPerMwh / 10).toFixed(1) + '¢';
  const num = (n, d) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d || 0 });
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayName = (iso) => Number(iso.slice(8, 10)) + ' ' + MONTH[Number(iso.slice(5, 7)) - 1] + ' ' + iso.slice(0, 4);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const tile = (k, v, when) => '<div class="cds--tile kpi"><p class="k">' + k + '</p><p class="v">' + v + '</p>' + (when ? '<p class="when">' + when + '</p>' : '') + '</div>';
  const LOAN = { rate: 0.08, years: 10, cover: 1.3 }; // assumptions, listed in the model basis as T13

  let L, DCD, rows = null, zoneId = 'LZ_WEST';
  let HB = null, hbDay = null, hbCeil = null, hbCeilKey = '';
  let DC = null, dcDay = null, dcShown = null, DG = null, timer = null, playing = null;

  /* ---------------------------------------------------------------- small chart helpers */
  function yAxis(l, r, t, b, max, gap, unit, min) {
    const lo = min || 0, y = (v) => b - ((v - lo) / (max - lo)) * (b - t);
    let s = '';
    for (let v = lo; v <= max + 1e-9; v += gap) {
      s += '<line class="' + (Math.abs(v) < 1e-9 ? 'base' : 'grid') + '" x1="' + l + '" x2="' + r + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>'
        + '<text x="' + (l - 6) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + (Math.round(v * 10) / 10) + unit + '</text>';
    }
    return { y, svg: s };
  }
  const nice = (v, gap) => Math.max(gap, Math.ceil(v / gap) * gap);
  const gapFor = (v) => (v > 60 ? 20 : v > 24 ? 10 : v > 12 ? 4 : v > 6 ? 2 : 1);
  function hourLabels(x, n, H, wide) {
    let s = '';
    for (let h = 0; h <= 24; h += wide ? 3 : 6) s += '<text x="' + x(Math.min(h, n)).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + (h === 0 ? 'start' : h === 24 ? 'end' : 'middle') + '">' + clock(h % 24) + '</text>';
    return s;
  }
  const step = (vals, x, y) => vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + 'L' + x(i + 1).toFixed(1) + ' ' + y(v).toFixed(1)).join('');

  // One thin bar per day of the year. Click or drag to pick a day.
  function drawYear(el, days, value, sel, cls, marks, onPick) {
    const W = Math.max(260, Math.round(el.clientWidth) - 24), H = 96, t = 10, b = H - 16, n = days.length, w = W / n;
    const vals = days.map(value), hi = Math.max.apply(null, vals.concat([1e-9])), lo = Math.min.apply(null, vals.concat([0]));
    const y = (v) => b - ((v - lo) / (hi - lo)) * (b - t), zero = y(0);
    let s = '';
    vals.forEach((v, i) => { const yy = y(v), top = Math.min(yy, zero), h = Math.max(0.6, Math.abs(yy - zero)); if (Math.abs(v) > 1e-9) s += '<rect class="d ' + cls(days[i], v) + '" x="' + (i * w).toFixed(2) + '" y="' + top.toFixed(1) + '" width="' + Math.max(0.6, w - 0.3).toFixed(2) + '" height="' + h.toFixed(1) + '"/>'; });
    (marks || []).forEach((i) => { s += '<rect class="mark" x="' + (i * w - 1).toFixed(1) + '" y="0" width="' + Math.max(3, w + 2).toFixed(1) + '" height="5"/>'; });
    let labels = '', last = '';
    days.forEach((d, i) => { const m = d.date.slice(0, 7); if (m !== last) { last = m; labels += '<text x="' + (i * w).toFixed(1) + '" y="' + (H - 3) + '">' + MONTH[Number(m.slice(5)) - 1].slice(0, 3) + '</text>'; } });
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="presentation"><line class="zero" x1="0" x2="' + W + '" y1="' + zero.toFixed(1) + '" y2="' + zero.toFixed(1) + '"/>' + s
      + (sel != null ? '<rect class="sel" x="' + (sel * w - 1).toFixed(1) + '" y="' + (t - 6) + '" width="' + Math.max(3, w + 2).toFixed(1) + '" height="' + (b - t + 8) + '"/>' : '') + labels + '</svg>';
    const pick = (e) => { const box = el.querySelector('svg').getBoundingClientRect(); onPick(Math.max(0, Math.min(n - 1, Math.floor((e.clientX - box.left) / box.width * n)))); };
    el.onpointerdown = (e) => { el.dataset.drag = '1'; pick(e); };
    el.onpointermove = (e) => { if (el.dataset.drag === '1') pick(e); };
    el.onpointerup = el.onpointerleave = () => { el.dataset.drag = ''; };
  }

  /* ---------------------------------------------------------------- the home battery */
  const hbSpec = () => ({ capacity: $('hb-cap').value, power: $('hb-pow').value, reserve: Number($('hb-res').value) / 100, efficiency: T.SPEC.efficiency });
  function hbOutage() {
    const len = Math.round(Number($('ho-len').value) || 0);
    return len > 0 && hbDay != null && HB ? { date: HB.days[hbDay].date, hour: Number($('ho-hour').value), hours: len, homeKw: Number($('ho-kw').value) || 1.2 } : null;
  }

  function runHome(keepDay) {
    const policy = { kind: $('hb-policy').value }, sp = hbSpec();
    HB = T.battery(rows, sp, policy, { outage: hbOutage() });
    const key = zoneId + '|' + JSON.stringify(sp);
    if (key !== hbCeilKey) { hbCeil = T.battery(rows, sp, { kind: 'hindsight' }).cashUsd; hbCeilKey = key; }
    if (!keepDay || hbDay == null || hbDay >= HB.days.length) { let best = 0; HB.days.forEach((d, i) => { if (d.cash > HB.days[best].cash) best = i; }); hbDay = best; }
    $('hb-policy-note').textContent = T.POLICIES[policy.kind];
    $('hb-kpis').innerHTML = tile('Earned in the year', usd(HB.cashUsd)) + tile('Share of the ceiling', hbCeil > 0 ? Math.round(HB.cashUsd / hbCeil * 100) + '%' : 'n/a', 'ceiling ' + usd(hbCeil) + ' with hindsight')
      + tile('Full cycles', num(HB.cycles)) + tile('Energy sold', num(HB.soldKwh / 1000, 1) + '<small>MWh</small>');
    drawHomeYear();
    $('hb-year-src').textContent = 'Each bar is one day\'s money: what it sold minus what it paid to charge, at the real-time price in ' + zoneName() + '. Red bars are days it lost money. '
      + T.byDay(rows).length + ' days, ' + num(HB.hours) + ' hours.';
    renderHomeDay();
    renderOutage();
    renderHomeRamp();
  }
  function drawHomeYear() {
    drawYear($('hb-year'), HB.days, (d) => d.cash, hbDay, (d, v) => (v < 0 ? 'neg' : ''), null, (i) => { if (i !== hbDay) { hbDay = i; if (hbOutage() || $('ho-len').value > 0) runHome(true); else { drawHomeYear(); renderHomeDay(); renderOutage(); } } });
  }
  const dayHours = (res, i) => res.trace.slice(res.days[i].start, res.days[i].start + res.days[i].hours);
  let HG = null;
  function renderHomeDay() {
    const d = HB.days[hbDay], hrs = dayHours(HB, hbDay), el = $('hd-chart');
    const W = Math.max(280, Math.round(el.clientWidth)), H = W < 560 ? 176 : 216, l = 30, r = W - 6, t = 16, b = H - 22, n = hrs.length, stepW = (r - l) / n;
    const top = Math.max.apply(null, hrs.map((x) => x.price)) / 10, lowC = Math.min(0, Math.min.apply(null, hrs.map((x) => x.price)) / 10);
    const gap = gapFor(top - lowC), max = nice(top, gap), min = lowC < 0 ? -nice(-lowC, gap) : 0;
    const ax = yAxis(l, r, t, b, max, gap, '¢', min), x = (h) => l + h * stepW, ySoc = (f) => b - f * (b - t);
    let bands = '';
    hrs.forEach((hh, i) => { if (hh.state !== 'idle') bands += '<rect class="' + (hh.state === 'charge' ? 'b-charge' : hh.state === 'run' ? 'b-run' : 'b-out') + '" x="' + x(i).toFixed(1) + '" y="' + t + '" width="' + stepW.toFixed(1) + '" height="' + (b - t) + '"/>'; });
    const price = step(hrs.map((hh) => hh.price / 10), x, ax.y);
    const startSoc = d.start > 0 ? HB.trace[d.start - 1].soc : HB.spec.reserve;
    const soc = 'M' + x(0).toFixed(1) + ' ' + ySoc(startSoc).toFixed(1) + hrs.map((hh, i) => 'L' + x(i + 1).toFixed(1) + ' ' + ySoc(hh.soc).toFixed(1)).join('');
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="presentation">' + bands + ax.svg
      + '<path class="price" d="' + price + '"/><path class="soc" d="' + soc + '"/>' + hourLabels(x, n, H, W >= 560)
      + '<line class="head-line" id="hd-line" y1="' + t + '" y2="' + b + '"/><circle class="head-dot" id="hd-dot" r="4.5"/><text class="head-val" id="hd-val" text-anchor="middle"></text></svg>';
    HG = { x, y: ax.y, l, r, stepW, n };
    $('hd-hour').max = n - 1;
    if (Number($('hd-hour').value) > n - 1) $('hd-hour').value = n - 1;
    $('hd-title').textContent = dayName(d.date) + ': price in cents a kWh, and how full the battery is';
    renderHomeHour();
  }
  function renderHomeHour() {
    const d = HB.days[hbDay], hrs = dayHours(HB, hbDay), i = Math.min(hrs.length - 1, Number($('hd-hour').value)), x = hrs[i];
    const before = d.start > 0 ? HB.trace[d.start - 1].cash : 0;
    $('hd-state').dataset.s = x.state;
    $('hd-state').textContent = { charge: 'Charging from the grid', run: 'Selling to the grid', outage: 'Grid down, running the home', idle: 'Standing by' }[x.state];
    $('hd-clock').textContent = clock(x.h) + ' to ' + clock((x.h + 1) % 24);
    $('hd-why').textContent = {
      charge: 'It bought ' + x.charge.toFixed(1) + ' kWh this hour at ' + cents(x.price) + '.',
      run: 'It sold ' + x.discharge.toFixed(1) + ' kWh this hour at ' + cents(x.price) + '.',
      outage: x.served > 0 ? 'The grid is down. The battery gave the home ' + x.served.toFixed(1) + ' kWh this hour.' : 'The grid is down and the battery is empty. The home is dark.',
      idle: 'Nothing to do at ' + cents(x.price) + '. The battery waits at ' + Math.round(x.soc * 100) + '%.',
    }[x.state];
    $('hd-kpis').innerHTML = tile('Power costs', cents(x.price) + '<small>a kWh</small>') + tile('Battery', Math.round(x.soc * 100) + '%')
      + tile('Cash so far today', usd2(x.cash - before)) + tile('The whole day', usd2(d.cash));
    if (HG) {
      const px = HG.x(i + 0.5), py = HG.y(x.price / 10), val = $('hd-val');
      $('hd-line').setAttribute('x1', px); $('hd-line').setAttribute('x2', px);
      $('hd-dot').setAttribute('cx', px); $('hd-dot').setAttribute('cy', py);
      val.textContent = cents(x.price);
      val.setAttribute('x', Math.max(HG.l + 16, Math.min(HG.r - 16, px))); val.setAttribute('y', Math.max(11, py - 10));
    }
    // The house: glow by state, light by time of day, on Carbon's gray backdrop.
    const light = Math.max(0, Math.min(1, Math.sin(((x.h + 0.5 - 5) / 15) * Math.PI) * 1.7)), g = (a, b2) => Math.round(a + (b2 - a) * light).toString(16).padStart(2, '0');
    const topC = '#' + g(0x16, 0xf4).repeat(3), botC = '#' + g(0x26, 0xff).repeat(3);
    $('scene').style.setProperty('--sky-a', topC); $('scene').style.setProperty('--sky-b', botC);
    const floor = '#' + Math.round(parseInt(botC.slice(1, 3), 16) * 0.9).toString(16).padStart(2, '0').repeat(3);
    window.StagePending = { name: x.state, ground: floor, daylight: light, glow: x.state === 'charge' ? css('--mw-charge') : x.state === 'run' ? css('--mw-run') : x.state === 'outage' && x.served > 0 ? css('--mw-blue') : null };
    if (window.Stage) window.Stage.set(window.StagePending);
    $('hd-hour').setAttribute('aria-valuetext', clock(x.h) + ', ' + cents(x.price) + ' a kWh, ' + $('hd-state').textContent + ', battery ' + Math.round(x.soc * 100) + '%');
  }
  function renderOutage() {
    const o = HB.outage, kw = Number($('ho-kw').value) || 1.2;
    if (!o) {
      $('ho-call').textContent = 'No outage is set. Enter a number of hours to cut the grid on ' + dayName(HB.days[hbDay].date) + '.';
      return;
    }
    $('ho-call').className = 'call' + (o.held ? ' calm' : '');
    $('ho-call').textContent = 'The grid failed at ' + clock(Number($('ho-hour').value)) + ' on ' + dayName(HB.days[hbDay].date) + ' with the battery ' + Math.round(o.socAtStart * 100) + '% full. It ran the home at ' + kw + ' kW for '
      + o.backupHours + ' of ' + o.hours + ' hours' + (o.held ? ', the whole outage.' : '. The home was dark for the other ' + o.unservedHours + '.') + ' It earned nothing while the grid was down.';
  }
  function renderHomeRamp() {
    const sp = hbSpec(), kw = Number($('ho-kw').value) || 1.2, policy = { kind: $('hb-policy').value }, eta = Math.sqrt(T.SPEC.efficiency), now = Math.round(Number($('hb-res').value));
    const levels = [0, 10, 20, 30, 40, 50, 60];
    const out = T.ramp(levels, (v) => T.battery(rows, Object.assign({}, sp, { reserve: v / 100 }), policy), () => false).points
      .map((p) => ({ pct: p.value, cash: p.result.cashUsd, backup: Number(sp.capacity) * (p.value / 100) * eta / kw }));
    $('hr-say').textContent = 'Every kilowatt-hour held back for an outage is one that cannot be sold. This runs the same year seven times, holding back more each time. Backup is counted at the worst moment: right after the evening sale, with a home drawing ' + kw + ' kW.';
    $('hr-rows').innerHTML = out.map((p) => '<tr' + (p.pct === now ? ' class="pick"' : '') + '><td>' + p.pct + '%</td><td>' + usd(p.cash) + '</td><td>' + (p.backup < 0.05 ? 'none' : p.backup.toFixed(1) + ' hours') + '</td></tr>').join('');
    const zero = out[0], twenty = out.find((p) => p.pct === 20), sixty = out[out.length - 1];
    $('hr-call').textContent = 'Holding nothing back earns ' + usd(zero.cash) + ' and leaves the home with no backup after the evening sale. Holding 20% earns ' + usd(twenty.cash) + ' and keeps ' + twenty.backup.toFixed(1)
      + ' hours. Holding 60% keeps ' + sixty.backup.toFixed(1) + ' hours and earns ' + usd(sixty.cash) + '. Each ten points of reserve costs about ' + usd((zero.cash - sixty.cash) / 6) + ' a year.';
  }

  /* ---------------------------------------------------------------- the data center */
  const zone = () => DCD.zones.find((z) => z.id === zoneId);
  const zoneName = () => zone().name;
  const dcRaw = () => ({ mw: $('dc-mw').value, runPct: $('dc-run').value, batteryMw: $('dc-bmw').value, batteryHours: $('dc-bh').value, rule: $('dc-rule').value, chasePct: $('dc-chase').value, gridTriggerMw: $('dc-level').value });
  const dcTariff = () => (zone().choice === 'open' ? DCD.tariff : null);
  const hourSpan = (he) => clock(he - 1) + ' to ' + clock(he % 24);

  function runDc(keepDay) {
    const raw = dcRaw(), tariff = dcTariff();
    DC = T.dataCenter(rows, raw, tariff, DCD.peaks.hours);
    const c = DC.config, called = DC.days.filter((d) => d.triggered).length;
    $('dc-chase-wrap').hidden = c.rule !== 'chase'; $('dc-level-wrap').hidden = c.rule !== 'level';
    $('dc-rule-note').textContent = T.RULES[c.rule] + (c.rule === 'chase' ? ' The window is ' + clock(c.windowStart) + ' to ' + clock(c.windowEnd % 24) + ', June through September.' : '');
    const peakIdx = DC.days.map((d, i) => (d.peak ? i : -1)).filter((i) => i >= 0);
    if (!keepDay || dcDay == null) dcDay = peakIdx.length ? peakIdx[1] != null ? peakIdx[1] : peakIdx[0] : 0;
    $('dc-kpis').innerHTML = tile('Power bill, a year', big(DC.totalUsd), tariff ? 'energy and wires' : 'energy only')
      + tile('Saved by the battery', big(DC.savedUsd), 'against ' + big(DC.baseline.totalUsd) + ' with none')
      + tile('Peaks kept off', DC.peaksFullyOff + '<small>of 4</small>') + tile('Days it was called', String(called), num(DC.ranHours) + ' hours run, ' + num(DC.cycles) + ' full cycles');
    $('dc-peaks').innerHTML = DC.peaks.map((p) => '<tr><td>' + dayName(p.date).replace(/ \d{4}$/, '') + ', ' + hourSpan(p.hourEnding) + '</td><td>' + num(p.gridMw) + ' MW</td><td>' + num(p.siteMw, 1) + ' MW'
      + (c.batteryMw > 0 ? '<small>' + (!p.triggered ? 'battery was not called' : p.coveredMw < 0.05 ? 'battery was called, but empty' : 'battery gave ' + num(p.coveredMw, 1) + ' MW') + '</small>' : '') + '</td></tr>').join('');
    const notCalled = DC.peaks.filter((p) => !p.triggered).length, empty = DC.peaks.filter((p) => p.triggered && p.coveredMw < Math.min(c.batteryMw, DC.demandMw) * 0.5).length;
    $('dc-call').className = 'call' + (c.batteryMw > 0 && DC.savedUsd > 0 ? '' : ' calm');
    $('dc-call').textContent = c.batteryMw <= 0 ? 'No battery. The site draws ' + num(DC.demandMw) + ' MW in every peak hour and pays the full wires charge.'
      : (DC.peaksFullyOff === 4 ? 'The battery kept the site off the grid in all four peak hours. '
        : 'The site was fully off the grid in ' + DC.peaksFullyOff + ' of the four peak hours. ' + (empty ? 'In ' + empty + ' of them the battery was called but had already run down. ' : '') + (notCalled ? 'In ' + notCalled + ' the rule never called it. ' : ''))
      + (tariff ? (DC.savedUsd >= 0 ? 'It saved ' + big(DC.savedUsd) + ' in the year: ' + big(DC.transmissionSavedUsd) + ' on the wires charge' + (DC.energySavedUsd < 0 ? ', less ' + big(-DC.energySavedUsd) + ' lost recharging.' : ' and ' + big(DC.energySavedUsd) + ' on energy.')
        : 'It lost ' + big(-DC.savedUsd) + ' in the year: it missed the peaks and paid to recharge.')
        : zoneName() + ' is a city utility or co-op zone, so the wires charge is not priced here and the saving shown is energy only.');
    drawYear($('dc-year'), DC.days, (d) => d.ran, dcDay, () => 'run', peakIdx, (i) => { if (i !== dcDay) { dcDay = i; runDc(true); } });
    $('dc-year-src').textContent = 'The rule called the battery on ' + called + ' days, ' + num(DC.triggerHours) + ' hours in all, and only four of those hours set the bill. That is the price of not knowing which hour is the peak.';
    renderDcDay();
    renderDcRamp();
  }
  function renderDcDay() {
    const d = DC.days[dcDay], n = (DC.days[dcDay + 1] ? DC.days[dcDay + 1].start : DC.trace.length) - d.start;
    const H24 = DC.trace.slice(d.start, d.start + n), el = $('dd-chart');
    const W = Math.max(280, Math.round(el.clientWidth)), l = 34, r = W - 6, stepW = (r - l) / n, x = (h) => l + h * stepW;
    const t1 = 12, b1 = 118, t2 = 146, b2 = 236, H = 260;
    const gmax = nice(Math.max.apply(null, H24.map((q) => q.gridMw)) / 1000, 20), gmin = Math.floor(Math.min.apply(null, H24.map((q) => q.gridMw)) / 20000) * 20;
    const a1 = yAxis(l, r, t1, b1, gmax, 20, '', gmin), smax = nice(Math.max.apply(null, H24.map((q) => q.siteMw).concat([DC.demandMw])), gapFor(DC.demandMw) * 5 || 20);
    const a2 = yAxis(l, r, t2, b2, smax, smax / 2, '');
    let bands = '';
    const peakSet = {}; DC.peaks.forEach((p) => { if (p.date === d.date) peakSet[p.hourEnding - 1] = true; });
    H24.forEach((q, i) => {
      if (q.state === 'run') bands += '<rect class="b-run" x="' + x(i).toFixed(1) + '" y="' + t1 + '" width="' + stepW.toFixed(1) + '" height="' + (b2 - t1) + '"/>';
      if (peakSet[q.h]) bands += '<rect class="b-peakh" x="' + x(i).toFixed(1) + '" y="' + t1 + '" width="' + stepW.toFixed(1) + '" height="' + (b2 - t1) + '"/>';
    });
    const site = step(H24.map((q) => q.siteMw), x, a2.y);
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="presentation">' + bands + a1.svg + a2.svg
      + '<path class="gridline" d="' + step(H24.map((q) => q.gridMw / 1000), x, a1.y) + '"/>'
      + '<path class="site" d="' + site + 'L' + r + ' ' + b2 + 'L' + l + ' ' + b2 + 'Z"/><path class="siteline" d="' + site + '"/>' + hourLabels(x, n, H, W >= 560)
      + '<line class="head-line" id="dd-line" y1="' + t1 + '" y2="' + b2 + '"/><circle class="head-dot" id="dd-dot" r="4.5"/><text class="head-val" id="dd-val" text-anchor="middle"></text></svg>';
    DG = { x, y: a2.y, l, r, stepW, n, peakSet };
    const ran = H24.filter((q) => q.state === 'run'), low = Math.min.apply(null, H24.map((q) => q.siteMw));
    $('dd-title').textContent = dayName(d.date) + (d.peak ? ', a peak day' : '');
    $('dd-src').textContent = ran.length ? 'The battery ran ' + ran.length + ' hour' + (ran.length === 1 ? '' : 's') + ', from ' + clock(ran[0].h) + '. The site drew as little as ' + num(low, 1) + ' MW from the grid, then more than usual overnight while the battery refilled.'
      : 'The rule did not call the battery on this day. The site drew ' + num(DC.demandMw) + ' MW all day.';
    const hour = $('dd-hour');
    hour.max = n - 1;
    if (dcDay !== dcShown) { // a new day opens on the hour worth seeing: the peak, or the first hour the battery ran
      dcShown = dcDay;
      const pk = H24.findIndex((q) => peakSet[q.h]), first = H24.findIndex((q) => q.state === 'run');
      hour.value = pk >= 0 ? pk : first >= 0 ? first : Math.min(n - 1, 17);
    }
    if (Number(hour.value) > n - 1) hour.value = n - 1;
    renderDcHour();
  }
  function renderDcHour() {
    const d = DC.days[dcDay], i = Math.min(DG.n - 1, Number($('dd-hour').value)), q = DC.trace[d.start + i], c = DC.config;
    const isPeak = !!DG.peakSet[q.h], empty = q.trigger && q.discharge < 0.05 && c.batteryMw > 0;
    $('dd-state').dataset.s = isPeak && q.state !== 'run' ? 'peak' : q.state;
    $('dd-state').textContent = q.state === 'run' ? (q.siteMw < 0.05 ? 'Running on the battery' : 'Battery carrying part of the site') : q.state === 'charge' ? 'Battery refilling' : empty ? 'Called, but the battery is empty' : 'On grid power';
    $('dd-clock').textContent = clock(q.h) + ' to ' + clock((q.h + 1) % 24) + (isPeak ? ', a peak hour' : '');
    $('dd-why').textContent = q.state === 'run' ? 'The rule called the battery. It gave ' + num(q.discharge, 1) + ' MW, so the site drew ' + num(q.siteMw, 1) + ' MW from the grid.'
      : q.state === 'charge' ? 'The battery took ' + num(q.charge, 1) + ' MW to refill, so the site drew ' + num(q.siteMw, 1) + ' MW.'
      : empty ? 'The rule called the battery, but it had already run down. The site drew ' + num(q.siteMw, 1) + ' MW.'
      : c.batteryMw > 0 ? 'The site drew ' + num(q.siteMw, 1) + ' MW from the grid. The battery waited at ' + Math.round(q.soc * 100) + '%.' : 'The site drew ' + num(q.siteMw, 1) + ' MW from the grid. There is no battery.';
    $('dd-kpis').innerHTML = tile('Demand on the grid', num(q.gridMw / 1000, 1) + '<small>GW</small>') + tile('Site draws', num(q.siteMw, 1) + '<small>MW</small>')
      + tile('Battery', c.batteryMw > 0 ? Math.round(q.soc * 100) + '%' : 'None') + tile('Power costs', cents(q.price) + '<small>a kWh</small>');
    const px = DG.x(i + 0.5), py = DG.y(q.siteMw), val = $('dd-val');
    $('dd-line').setAttribute('x1', px); $('dd-line').setAttribute('x2', px);
    $('dd-dot').setAttribute('cx', px); $('dd-dot').setAttribute('cy', py);
    val.textContent = num(q.siteMw, 1) + ' MW';
    val.setAttribute('x', Math.max(DG.l + 26, Math.min(DG.r - 26, px))); val.setAttribute('y', Math.max(140, py - 10));
    // The site: boxes lit by how full the battery is, dots on the line by how hard the site pulls on the grid.
    const light = Math.max(0, Math.min(1, Math.sin(((q.h + 0.5 - 5) / 15) * Math.PI) * 1.7)), g = (a, b2) => Math.round(a + (b2 - a) * light).toString(16).padStart(2, '0');
    $('site-scene').style.setProperty('--sky-a', '#' + g(0x16, 0xf4).repeat(3)); $('site-scene').style.setProperty('--sky-b', '#' + g(0x26, 0xff).repeat(3));
    $('site-scene').dataset.night = light < 0.4 ? '1' : '0';
    const per = DC.batteryMwh <= 480 ? 10 : Math.ceil(DC.batteryMwh / 48), boxes = DC.batteryMwh > 0 ? Math.max(1, Math.ceil(DC.batteryMwh / per)) : 0, full = DC.demandMw + c.batteryMw;
    window.SitePending = { boxes, soc: q.soc, state: q.state, gridFlow: full > 0 ? q.siteMw / full : 0, battFlow: c.batteryMw > 0 ? (q.discharge - q.charge) / c.batteryMw : 0, peak: isPeak, daylight: light };
    if (window.Site) window.Site.set(window.SitePending);
    $('dd-scale').textContent = 'The drawing is a diagram, not to scale. ' + (boxes ? 'Each battery box stands for ' + num(per) + ' MWh, and the lit ones show how full the battery is. ' : '') + 'Dots on the line show power coming in from the grid.';
    $('dd-hour').setAttribute('aria-valuetext', clock(q.h) + ', ' + $('dd-state').textContent + ', site draws ' + num(q.siteMw, 1) + ' megawatts, battery ' + Math.round(q.soc * 100) + '%');
  }
  function renderDcRamp() {
    const raw = dcRaw(), tariff = dcTariff(), c = DC.config;
    const lengths = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6];
    const rp = T.ramp(lengths, (v) => T.dataCenter(rows, Object.assign({}, raw, { batteryHours: v }), tariff, DCD.peaks.hours), (r) => r.peaksFullyOff === 4);
    $('dr-say').textContent = 'The same year, the same rule, and a battery that lasts longer each time. It holds when the site is off the grid in all four peak hours.';
    $('dr-rows').innerHTML = rp.points.map((p) => '<tr class="' + (p.value === c.batteryHours ? 'pick ' : '') + (p.holds ? 'holds' : '') + '"><td>' + p.value + ' hours<small>' + num(c.batteryMw * p.value) + ' MWh</small></td><td>' + p.result.peaksFullyOff + ' of 4</td><td>'
      + big(p.result.savedUsd) + '</td></tr>').join('');
    const best = rp.points.slice().sort((a, b) => b.result.savedUsd - a.result.savedUsd)[0];
    $('dr-call').className = 'call' + (rp.holdsFrom == null ? ' calm' : '');
    $('dr-call').textContent = c.batteryMw <= 0 ? 'Set a battery power above to run this test.'
      : rp.holdsFrom != null ? 'It holds from ' + rp.holdsFrom + ' hours. Shorter batteries are called early in the afternoon and are empty when the peak comes.'
        : c.batteryMw < DC.demandMw ? 'It does not hold at any length: ' + num(c.batteryMw) + ' MW of battery cannot carry a site drawing ' + num(DC.demandMw) + ' MW, so the site is never fully off the grid.'
          : 'It does not hold at any length tried with this rule.';
    const pick = rp.points.find((p) => p.holds) || best, kwh = c.batteryMw * pick.value * 1000;
    if (c.batteryMw > 0 && tariff && pick.result.savedUsd > 0 && F) {
      const perKwh = pick.result.savedUsd / kwh, loan = perKwh / LOAN.cover * F.annuityFactor(LOAN.rate, LOAN.years);
      $('dr-loan').hidden = false;
      $('dr-loan').innerHTML = 'At ' + pick.value + ' hours the battery holds ' + num(kwh / 1000) + ' MWh and saves ' + big(pick.result.savedUsd) + ' a year, which is <strong>' + usd2(perKwh) + '</strong> for each kWh of battery. '
        + 'A lender wanting ' + LOAN.cover + ' times cover on a ' + LOAN.years + '-year loan at ' + (LOAN.rate * 100) + '% (assumptions) would lend about <strong>' + usd(loan) + '</strong> a kWh against that saving. The battery has to cost less than that, installed, to be funded by this saving alone.';
    } else { $('dr-loan').hidden = true; }
  }

  /* ---------------------------------------------------------------- shared */
  function basis() {
    const t = DCD.tariff;
    const rowsB = [
      ['T1', 'Price of power: ERCOT real-time settlement price for the load zone, every hour', 'Sourced'],
      ['T2', 'Demand on the grid: ERCOT native load, every hour', 'Sourced'],
      ['T3', 'Wires charge: ' + t.utility + ', $' + t.per4cpKwMonthUsd + ' a kW of peak demand a month, as of ' + t.asOf, 'Sourced'],
      ['T4', 'The four peak hours: the highest hour of grid demand in each of June to September 2026. ERCOT\'s official peaks use fifteen-minute intervals', 'Sourced, approximated'],
      ['T5', 'Home battery size: 20 kW and 39.2 kWh, from Base Power\'s utilities page', 'Sourced, a lever'],
      ['T6', 'Round-trip efficiency 88%, split evenly between charging and discharging', 'ASSUMPTION'],
      ['T7', 'Share of the home battery held back for outages: 20%', 'ASSUMPTION, a lever'],
      ['T8', 'What a home draws in an outage: 1.2 kW', 'ASSUMPTION, a lever'],
      ['T9', 'The data center draws the same power every hour it runs', 'ASSUMPTION, a lever'],
      ['T10', 'The data center battery refills between midnight and 8 AM', 'ASSUMPTION'],
      ['T11', 'Peak chasing looks only at 3 PM to 7 PM, June to September, and at demand within a set share of the month\'s high so far', 'ASSUMPTION, a lever'],
      ['T12', 'The site sees demand on the grid and reacts inside the same hour', 'ASSUMPTION'],
      ['T13', 'Loan terms: ' + (LOAN.rate * 100) + '% interest, ' + LOAN.years + ' years, ' + LOAN.cover + ' times cover', 'ASSUMPTION'],
    ];
    $('basis-rows').innerHTML = rowsB.map((r) => '<tr><td>' + r[0] + '</td><td>' + esc(r[1]) + '</td><td>' + (r[2].indexOf('ASSUMPTION') === 0 ? '<span class="cds--tag cds--tag--sm cds--tag--warm-gray"><span class="cds--tag__label">' + r[2] + '</span></span>' : esc(r[2])) + '</td></tr>').join('');
    $('basis-not').innerHTML = ['One year, ' + L.period.start + ' to ' + L.period.endExclusive + '. It is a replay of what happened, not a forecast of what will.',
      'Hourly steps. Real prices settle every fifteen minutes and can spike inside an hour.',
      'The battery is too small to move the price. A large fleet doing the same thing would.',
      'No battery wear, no battery cost, no fees, no taxes and no payments for reserves.',
      'The data center battery does nothing but dodge peaks. It does not trade energy.'].map((s) => '<li>' + esc(s) + '</li>').join('');
    $('tw-sources').innerHTML = [
      '<a href="' + esc(DCD.pricesSource.url) + '">' + esc(DCD.pricesSource.title) + '</a>: <a href="' + esc(DCD.pricesSource.manifest) + '">provenance</a>.',
      '<a href="' + esc(L.source) + '">ERCOT native load, hourly</a>: <a href="/data/twin-ercot-load.json">data/twin-ercot-load.json</a>, built ' + esc(L.built) + '.',
      '<a href="' + esc(t.source) + '">' + esc(t.sourceTitle) + '</a>, read ' + esc(t.read) + '.',
      '<a href="https://www.basepowercompany.com/utilities">Base Power, utilities page</a>, for the battery size. Read 29 Oct 2026.',
      'The engine is <a href="/twin-core.js">twin-core.js</a>. Its fixed-clock result matches the site\'s older Texas backtest to the cent.',
    ].map((s) => '<li>' + s + '</li>').join('');
  }
  function runAll() {
    $('say').textContent = 'Every hour from ' + dayName(L.period.start) + ' to ' + dayName(rows[rows.length - 1].date) + ' in ' + zoneName() + ', at the price power really cost and the demand the grid really carried. Change a rule and the whole year runs again.';
    runHome(false); runDc(false);
  }
  function loadZone(id) {
    zoneId = id;
    return fetch('/data/deployment/' + id + '.csv').then((r) => { if (!r.ok) throw new Error('prices ' + r.status); return r.text(); }).then((text) => { rows = T.withLoad(T.parsePrices(text), L); runAll(); });
  }
  function stop() { clearInterval(timer); timer = null; playing = null; $('hd-play').textContent = 'Play the day'; $('dd-play').textContent = 'Play the day'; }
  function wire() {
    const tabs = Array.from(document.querySelectorAll('#tw-tabs [role=tab]'));
    const pick = (tab) => { tabs.forEach((t) => { const on = t === tab; t.classList.toggle('cds--tabs__nav-item--selected', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; $(t.getAttribute('aria-controls')).hidden = !on; }); if (rows) { if (tab.id === 'tt-dc') runDc(true); else runHome(true); } };
    tabs.forEach((t, k) => { t.addEventListener('click', () => pick(t)); t.addEventListener('keydown', (e) => { const s = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (s) { const nx = tabs[(k + s + tabs.length) % tabs.length]; pick(nx); nx.focus(); e.preventDefault(); } }); });
    if (location.hash === '#data-center') pick($('tt-dc'));
    $('tw-zone').addEventListener('change', () => { stop(); loadZone($('tw-zone').value).catch(fail); });
    ['hb-policy', 'ho-hour'].forEach((id) => $(id).addEventListener('change', () => runHome(true)));
    ['hb-cap', 'hb-pow', 'hb-res', 'ho-len', 'ho-kw'].forEach((id) => $(id).addEventListener('change', () => runHome(true)));
    ['dc-mw', 'dc-run', 'dc-bmw', 'dc-bh', 'dc-chase', 'dc-level'].forEach((id) => $(id).addEventListener('change', () => runDc(true)));
    $('dc-rule').addEventListener('change', () => runDc(true));
    $('hd-hour').addEventListener('input', () => { stop(); renderHomeHour(); });
    const box = $('hd-chart'), at = (e) => { const b = box.getBoundingClientRect(); return HG ? Math.max(0, Math.min(HG.n - 1, Math.floor((e.clientX - b.left - HG.l) / HG.stepW))) : 0; };
    let drag = false;
    box.addEventListener('pointerdown', (e) => { drag = true; stop(); $('hd-hour').value = at(e); renderHomeHour(); });
    box.addEventListener('pointermove', (e) => { if (drag) { $('hd-hour').value = at(e); renderHomeHour(); } });
    addEventListener('pointerup', () => { drag = false; }); addEventListener('pointercancel', () => { drag = false; });
    const play = (key, render) => $(key + '-play').addEventListener('click', () => {
      const mine = playing === key; stop(); if (mine) return;
      const hour = $(key + '-hour');
      hour.value = 0; render(); $(key + '-play').textContent = 'Pause'; playing = key;
      timer = setInterval(() => { const nx = Number(hour.value) + 1; if (nx > Number(hour.max)) return stop(); hour.value = nx; render(); }, 600);
    });
    play('hd', renderHomeHour); play('dd', renderDcHour);
    $('dd-hour').addEventListener('input', () => { stop(); renderDcHour(); });
    const dbox = $('dd-chart'), dat = (e) => { const b = dbox.getBoundingClientRect(); return DG ? Math.max(0, Math.min(DG.n - 1, Math.floor((e.clientX - b.left - DG.l) / DG.stepW))) : 0; };
    let ddrag = false;
    dbox.addEventListener('pointerdown', (e) => { ddrag = true; stop(); $('dd-hour').value = dat(e); renderDcHour(); });
    dbox.addEventListener('pointermove', (e) => { if (ddrag) { $('dd-hour').value = dat(e); renderDcHour(); } });
    addEventListener('pointerup', () => { ddrag = false; }); addEventListener('pointercancel', () => { ddrag = false; });
    let raf = 0;
    addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (!rows) return; drawHomeYear(); renderHomeDay(); if (!$('tp-dc').hidden) runDc(true); }); });
  }
  const fail = (err) => { $('say').textContent = 'The twin could not load its data: ' + err.message; };

  Promise.all(['/data/twin-ercot-load.json', '/data/datacenter-ercot.json'].map((u) => fetch(u).then((r) => r.json()))).then((both) => {
    L = both[0]; DCD = both[1];
    const open = DCD.zones.filter((z) => z.choice === 'open'), other = DCD.zones.filter((z) => z.choice !== 'open');
    const opt = (z) => '<option value="' + esc(z.id) + '"' + (z.id === zoneId ? ' selected' : '') + '>' + esc(z.name) + '</option>';
    $('tw-zone').innerHTML = '<optgroup label="Retail choice">' + open.map(opt).join('') + '</optgroup><optgroup label="City utility or co-op">' + other.map(opt).join('') + '</optgroup>';
    $('ho-hour').innerHTML = Array.from({ length: 24 }, (_, h) => '<option value="' + h + '"' + (h === 21 ? ' selected' : '') + '>' + clock(h) + '</option>').join('');
    basis(); wire();
    return loadZone(zoneId);
  }).catch(fail);
})();
