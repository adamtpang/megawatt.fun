/* /data-centers: what a large load pays for power in Texas. Math: largeload-core.js.
   Data: data/datacenter-ercot.json, built by scripts/datacenter-ercot.py from public ERCOT and PUCT files. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const C = window.LargeLoadCore;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = (h) => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
  const hourSpan = (he) => clock(he - 1) + ' to ' + clock(he % 24);
  const usd = (n) => (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  const big = (n) => { const a = Math.abs(n), s = n < 0 ? '-' : ''; return a >= 1e9 ? s + '$' + (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? s + '$' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M' : usd(n); };
  const cents = (usdPerMwh) => (usdPerMwh / 10).toFixed(1) + '¢';
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const day = (iso) => Number(iso.slice(8, 10)) + ' ' + MONTH[Number(iso.slice(5, 7)) - 1];
  let D;

  const raw = () => ({ mw: $('ll-mw').value, runPct: $('ll-run').value, peaksAvoidedPct: $('ll-peaks').value, skipHours: Number($('ll-skip').value) });
  const row = (label, value, cls, small) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + (small ? '<small>' + small + '</small>' : '') + '</td><td>' + value + '</td></tr>';
  const tile = (k, v, when) => '<div class="cds--tile kpi"><p class="k">' + k + '</p><p class="v">' + v + '</p>' + (when ? '<p class="when">' + when + '</p>' : '') + '</div>';

  function renderBill() {
    const b = C.bill(D, $('ll-zone').value, raw()), p = b.inputs, z = b.zone, t = D.tariff;
    $('ll-peaks-out').textContent = p.peaksAvoidedPct + '%';
    $('ll-head').textContent = num(p.mw) + ' MW in ' + z.name;
    $('ll-kpis').innerHTML = tile('Power bill, a year', big(b.totalUsd)) + tile('All in, a kWh', b.perKwhUsd == null ? 'n/a' : (b.perKwhUsd * 100).toFixed(1) + '¢')
      + tile('Energy used', num(b.mwh / 1000) + '<small>GWh</small>') + tile('Saved by flexibility', big((b.energySavedUsd || 0) + (b.transmissionSavedUsd || 0)));
    $('ll-rows').innerHTML =
      row('Energy', big(b.energyUsd), '', 'average ' + cents(z.avgRtUsdPerMwh) + ' a kWh, real-time' + (p.skipHours ? '; ' + p.skipHours + ' priciest hours sat out, saving ' + big(b.energySavedUsd) : ''))
      + (b.tariffApplies
        ? row('Transmission', big(b.transmissionUsd), '', usd(b.transmissionPerMwYearUsd) + ' a year for each MW drawn in the four peak hours' + (p.peaksAvoidedPct ? '; ' + p.peaksAvoidedPct + '% kept off, saving ' + big(b.transmissionSavedUsd) : ''))
          + row('Delivery demand charge', big(b.deliveryUsd), '', '$' + t.perBillingKwMonthUsd + ' a kW a month on the full ' + num(p.mw) + ' MW')
          + row('Customer and metering charges', usd(b.fixedUsd))
        : row('Transmission and delivery', 'not shown', 'off', esc(z.name) + ' is a city utility or co-op zone with its own tariff'))
      + row((b.tariffApplies ? 'A year' : 'Energy only, a year') + '<span class="cds--tag cds--tag--sm cds--tag--gray"><span class="cds--tag__label">estimate</span></span>', big(b.totalUsd), 'sum');
    $('ll-call').className = 'call' + (b.tariffApplies ? '' : ' calm');
    $('ll-call').innerHTML = b.tariffApplies
      ? 'Each MW kept off the grid in four summer hours saves <strong>' + usd(b.transmissionPerMwYearUsd) + '</strong> a year. Those four hours are ' + (b.peakHoursShare * 100).toFixed(2) + '% of the year. A battery on site, or pausing work, is how a data center does it.'
      : 'This zone has no retail choice. A data center here buys from the city utility or co-op under that utility\'s own large-load tariff, which is not in this data.';
    $('ll-src').textContent = 'Wires charges are ' + t.utility + '\'s ' + t.class.toLowerCase() + ' rates as of ' + t.asOf + ', used as the example for the four competitive zones; other wires companies differ. '
      + 'The site is assumed to draw the same power every hour it runs. The yearly figure is energy at the real-time price with no hedge or contract.';
    Array.prototype.forEach.call(document.querySelectorAll('#where-rows tr'), (tr) => tr.classList.toggle('pick', tr.dataset.id === z.id));
    renderWhere();
  }

  function renderWhere() {
    const rows = C.compare(D, raw());
    $('where-rows').innerHTML = rows.map((r) => '<tr data-id="' + esc(r.id) + '"' + (r.id === $('ll-zone').value ? ' class="pick"' : '') + '><td>' + esc(r.name) + '<small>' + (r.choice === 'open' ? 'retail choice' : 'city utility or co-op') + '</small></td><td>'
      + cents(r.avg) + '</td><td>' + r.hoursOver200 + '</td><td>' + big(r.energyUsd) + (r.overCheapestUsd > 0 ? '<span class="was">+' + big(r.overCheapestUsd) + '</span>' : '') + '</td></tr>').join('');
    const cheap = rows[0], dear = rows[rows.length - 1];
    $('where-say').textContent = 'Average prices are close across Texas: ' + cents(cheap.avg) + ' a kWh in ' + cheap.name + ' against ' + cents(dear.avg) + ' in ' + dear.name
      + '. For a site this size that gap is ' + big(dear.energyUsd - cheap.energyUsd) + ' a year. The zones differ more in how often prices spike.';
  }

  function renderStatic() {
    const t = D.tariff, q = D.queue, peaks = D.peaks.hours, perMw = t.per4cpKwMonthUsd * 12 * 1000;
    $('say').textContent = 'Two things set the bill: the price of energy every hour, and how much the site draws in four summer hours. This page prices both from public ERCOT and Public Utility Commission files, '
      + D.period.start.slice(0, 4) + ' to 2026.';

    $('peaks-say').textContent = 'A wires company bills a large customer for transmission by its demand at the moment the whole grid peaks in June, July, August and September. In 2026 those hours were:';
    $('peaks-rows').innerHTML = peaks.map((h) => '<tr><td>' + MONTH[Number(h.date.slice(5, 7)) - 1] + '</td><td>' + day(h.date) + ', ' + hourSpan(h.hourEnding) + '</td><td>' + num(h.mw) + ' MW</td></tr>').join('');
    const span = peaks.map((h) => h.hourEnding);
    $('peaks-call').innerHTML = 'All four fell between ' + clock(Math.min.apply(null, span) - 1) + ' and ' + clock(Math.max.apply(null, span) % 24) + ' on a summer afternoon. Nobody knows which afternoon until it has passed, so staying off the peak means guessing well, or staying off many afternoons. '
      + '<strong>The rule may change:</strong> a Public Utility Commission proposal published in July 2026 would bill on twelve monthly peaks, not four. It was not adopted when this page was built.';
    $('peaks-src').textContent = D.peaks.note;

    $('where-src').textContent = 'Real-time price at each ERCOT load zone, hourly, ' + D.period.start + ' to ' + D.period.endExclusive + '. "Hours over 20¢" counts hours above $200 a MWh. Energy uses the size, running level and hours sat out that you set above.';

    $('queue-say').textContent = 'ERCOT tracks large loads asking to connect. It does not say which are data centers, or name them.';
    $('queue-kpis').innerHTML = tile('Approved to energize', num(q.approvedMw) + '<small>MW</small>', 'ERCOT, ' + q.asOf)
      + tile('Peak those loads have drawn', num(q.peakSeenMw) + '<small>MW</small>', 'non-simultaneous, June 2026')
      + tile('Busiest hour on the grid', num(D.gridPeakMw) + '<small>MW</small>', 'summer 2026');
    const west = q.byZone.find((r) => r.zone === 'LZ_WEST');
    $('queue-call').textContent = 'The approved loads are ' + (q.approvedMw / D.gridPeakMw * 100).toFixed(0) + '% of the grid\'s busiest hour, and the most they have drawn is ' + (q.peakSeenMw / q.approvedMw * 100).toFixed(0) + '% of what they are approved for. '
      + (west ? 'More than half of the approved load, ' + num(west.totalMw) + ' MW, is in the West load zone. ' : '') + 'Since the 2025 law known as SB 6, loads of 75 MW and up face added interconnection rules.';
    $('queue-src').textContent = q.what;

    $('not-list').innerHTML = D.notIncluded.map((s) => '<li>' + esc(s) + '</li>').join('');
    $('ll-sources').innerHTML = [
      '<a href="' + esc(D.pricesSource.url) + '">' + esc(D.pricesSource.title) + '</a>: <a href="' + esc(D.pricesSource.manifest) + '">provenance</a>.',
      '<a href="' + esc(t.source) + '">' + esc(t.sourceTitle) + '</a>, read ' + esc(t.read) + '.',
    ].concat(D.rules.map((r) => '<a href="' + esc(r.source) + '">' + esc(r.title) + '</a> (' + esc(r.status) + '). ' + esc(r.what)))
      .concat(['<a href="' + esc(D.peaks.source) + '">ERCOT native load, hourly</a>, for the 2026 peak hours.',
        '<a href="' + esc(q.source) + '">ERCOT Large Load Interconnection status update</a>, as of ' + esc(q.asOf) + '.',
        'Joined by <code>scripts/datacenter-ercot.py</code>; the result is <a href="/data/datacenter-ercot.json">data/datacenter-ercot.json</a>, built ' + esc(D.built) + '.'])
      .map((s) => '<li>' + s + '</li>').join('');
  }

  fetch('/data/datacenter-ercot.json').then((r) => r.json()).then((data) => {
    D = data;
    const open = D.zones.filter((z) => z.choice === 'open'), other = D.zones.filter((z) => z.choice !== 'open');
    const opt = (z) => '<option value="' + esc(z.id) + '"' + (z.id === 'LZ_WEST' ? ' selected' : '') + '>' + esc(z.name) + '</option>';
    $('ll-zone').innerHTML = '<optgroup label="Retail choice">' + open.map(opt).join('') + '</optgroup><optgroup label="City utility or co-op">' + other.map(opt).join('') + '</optgroup>';
    $('ll-skip').innerHTML = D.steps.map((n) => '<option value="' + n + '">' + (n ? 'The ' + n + ' priciest hours' : 'None') + '</option>').join('');
    renderStatic();
    ['ll-mw', 'll-run', 'll-peaks'].forEach((id) => $(id).addEventListener('input', renderBill));
    ['ll-zone', 'll-skip'].forEach((id) => $(id).addEventListener('change', renderBill));
    renderBill();
  }).catch((err) => { $('say').textContent = 'The data file did not load: ' + err.message; });
})();
