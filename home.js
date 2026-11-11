/* Homepage. Renders FleetRoiCore.evaluate. No math lives here. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (n) => Number.isFinite(n) ? (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US') : 'n/a';
  const pct = (n) => n == null || !Number.isFinite(n) ? 'not defined' : (Math.round(n * 1000) / 10).toFixed(1) + '%';
  const badge = (kind) => {
    if (!kind) return '';
    const cls = kind === 'sourced' ? 'badge-green' : kind === 'assumption' ? 'badge-yellow' : 'badge-white';
    const label = kind === 'sourced' ? 'Sourced' : kind === 'assumption' ? 'Assumption' : 'Partly sourced';
    return '<span class="badge ' + cls + '">' + label + '</span>';
  };

  let data = null;

  function formValue() {
    const fd = new FormData($('roi-form'));
    return {
      query: String(fd.get('query') || '').trim(),
      preset: fd.get('preset') || 'suburban',
      fleetCount: fd.get('fleetCount'),
      zone: $('zone-pick-wrap').hidden ? '' : fd.get('zone'),
      hardware: fd.get('hardware') || 'shelf',
      reductionPct: fd.get('reductionPct'),
      billCreditPct: fd.get('billCreditPct'),
      contractUsd: fd.get('contractUsd'),
      marketMode: $('mode-pick-wrap').hidden ? '' : fd.get('marketMode'),
    };
  }

  function paintZoneChoices(result) {
    const wrap = $('zone-pick-wrap');
    const select = $('zone-pick');
    if (!result.needsZone) { wrap.hidden = true; return; }
    const ids = result.resolution.candidates.length ? result.resolution.candidates : result.zones.map((z) => z.id);
    const current = select.value;
    select.innerHTML = ids.map((id) => {
      const z = result.zones.find((row) => row.id === id);
      const label = z ? id + ' · ' + usd(z.usdPerYear) + '/yr' : id;
      return '<option value="' + esc(id) + '">' + esc(label) + '</option>';
    }).join('');
    if (current) select.value = current;
    wrap.hidden = false;
    $('zone-why').textContent = result.resolution.why.join(' ');
  }

  function paintMode(result) {
    const wrap = $('mode-pick-wrap');
    if (!result.marketMode || result.marketMode.status !== 'split') { wrap.hidden = true; return; }
    wrap.hidden = false;
  }

  function paintBars(day, clock) {
    const el = $('price-bars');
    if (!day) { el.innerHTML = ''; return; }
    const max = Math.max(...day.hours.map((h) => h.usdMwh), 1);
    el.innerHTML = day.hours.map((h) => {
      const cls = clock.charge.includes(h.hourEnding) ? 'charge' : clock.discharge.includes(h.hourEnding) ? 'discharge' : '';
      const hgt = Math.max(4, (h.usdMwh / max) * 100);
      return '<i class="' + cls + '" style="height:' + hgt + '%" title="Hour ending ' + h.hourEnding + ' · $' + h.usdMwh + '/MWh"></i>';
    }).join('');
  }

  function stackHtml(lines) {
    return '<ul class="earn-list">' + lines.map((line) => {
      const money = line.status === 'modeled' ? usd(line.value) : 'Not modeled yet';
      return '<li><span>' + esc(line.label) + ' ' + badge(line.kind) + '</span><b>' + esc(money) + '</b></li>';
    }).join('') + '</ul>';
  }

  function paint(result) {
    const status = $('roi-status');
    if (!result.ok) {
      status.className = 'notice notice-red roi-status';
      status.textContent = result.errors.join(' ');
      return;
    }
    paintZoneChoices(result);
    paintMode(result);
    const place = result.home ? [result.home.place, result.home.county].filter(Boolean).join(', ') : '';
    if (result.needsZone) {
      status.className = 'notice roi-status';
      status.textContent = 'ZIP ' + result.zip + (place ? ' · ' + place : '') + '. ' + (result.marketMode ? result.marketMode.label : '') + ' Pick the load zone before the loan.';
      $('result').innerHTML = '<p>' + esc(result.marketMode.why) + '</p><p>No operator cash yet. A missing zone is not filled in.</p>';
      return;
    }
    status.className = 'notice notice-green roi-status';
    status.textContent = 'ZIP ' + result.zip + (place ? ' · ' + place : '') + ' · ' + result.zone.id + ' · ' + result.marketMode.label;
    const op = result.operator;
    const head = op.sized
      ? '<dl class="metric-grid">' +
        '<div><dt>Operator cash / year ' + badge(op.cashKind) + '</dt><dd>' + usd(op.cashPerYear) + '</dd></div>' +
        '<div><dt>Simple ROI</dt><dd>' + pct(op.simpleRoi) + '</dd></div>' +
        '<div><dt>Unlevered IRR</dt><dd>' + pct(op.irr) + '</dd></div>' +
        '<div><dt>Payback</dt><dd>' + (op.paysBack ? 'Year ' + op.paybackYear : 'Does not pay back') + '</dd></div>' +
        '<div><dt>Debt, one battery ' + badge(op.kind) + '</dt><dd>' + usd(op.perBattery) + '</dd></div>' +
        '<div><dt>Debt, ' + op.fleetCount.toLocaleString('en-US') + ' batteries</dt><dd>' + usd(op.fleetDebt) + '</dd></div>' +
        '</dl><p class="roi-note">' + esc(op.bindingText) + ' Landed cost ' + usd(result.hardware.landedPerKwh) + '/kWh. ' + badge(result.hardware.kind) + '</p>'
      : '<p class="notice">' + esc(op.reason) + '</p><p class="roi-note">Landed cost ' + usd(result.hardware.landedPerKwh) + '/kWh. ' + badge(result.hardware.kind) + '</p>';
    const member = result.membership;
    const cites = result.podcast.notes.map((n) => '<li><b>' + esc(n.t) + '</b> ' + esc(n.text) + '</li>').join('');
    const coserv = result.coservExample ? '<p class="roi-note">CoServ is one of the utilities on this ZIP. Zach\'s spoken example of a fleet is about 100 MW. That is not a measured size of this ZIP.</p>' : '';
    $('result').innerHTML =
      '<p>' + badge(result.zone.kind) + ' ' + esc(result.zone.id) + ' ranks ' + result.zone.rank + ' of ' + result.zone.of +
      '. Highest on this clock: ' + esc(result.zone.best.id) + ' at ' + usd(result.zone.best.usdPerYear) + ' a year. Make, move, store, sell.</p>' +
      '<p class="roi-note">' + esc(result.marketMode.why) + '</p>' + coserv +
      head +
      '<h3>Value stack</h3>' + stackHtml(result.stack) +
      '<h3>The member</h3>' +
      '<p>Bill savings are the member bill credit above. Backup is not modeled yet: the house keeps power in an outage, and no outage dollar is in the file.</p>' +
      '<p class="roi-note">' + badge(member.kind) + ' Spoken illustration: about ' + usd(member.purchaseUsd) + ' to own a backup battery, so one-twentieth is ' + usd(member.twentieth) + ' and one-fortieth is ' + usd(member.fortieth) + '. ' + esc(member.note) + '</p>' +
      '<p class="roi-note">Off-the-shelf installed cost in this model, from the NREL figure: ' + usd(member.shelfUsd) + ' for 39.2 kWh. ' + badge('sourced') + '</p>' +
      '<h3>Homeowner buys the battery</h3>' +
      '<p>' + esc(result.homeowner.note) + '</p>' +
      '<p>Simple ROI ' + pct(result.homeowner.simpleRoi) + '. Unlevered IRR ' + pct(result.homeowner.irr) + '. ' +
      (result.homeowner.paysBack ? 'Pays back in year ' + result.homeowner.paybackYear + '.' : 'Does not pay back.') + ' ' + badge(result.homeowner.kind) + '</p>' +
      '<details><summary>Zach Dell on David Senra, Sep 6 2026 (spoken, not a filing)</summary>' +
      '<p class="roi-note"><a href="' + esc(result.podcast.url) + '">davidsenra.com/episode/zach-dell</a>. Timestamps are approximate.</p><ul class="source-list">' + cites + '</ul></details>' +
      '<details><summary>Where the numbers come from</summary><ul class="source-list">' +
      (result.sources || []).map((s) => '<li>' + badge(s.kind) + ' ' + esc(s.label) +
        (s.url ? ' · <a href="' + esc(s.url) + '">source</a>' : '') +
        (s.note ? ' · ' + esc(s.note) : '') + '</li>').join('') +
      '</ul><p class="roi-note"><a href="https://www.ercot.com/mktinfo/prices">ERCOT prices</a>. Wholesale time-shift uses the load-zone replay. The bars under the house are one Houston hub day, so you can see midday charge and the evening peak. They are not a second earnings number.</p></details>';
    paintBars(result.curve.day, result.curve.clock);
    const roi = op.sized ? (!op.paysBack ? 'poor' : op.npv >= 0 ? 'good' : 'mixed') : 'idle';
    $('fallback-battery').setAttribute('fill', roi === 'poor' ? '#bf5249' : roi === 'mixed' ? '#f7c33c' : '#b2dd79');
    $('house-caption').textContent = result.preset.label + ' · battery on the side wall · midday charge green, evening peak orange.';
    if (window.HomeHouse) window.HomeHouse.setState({ preset: result.preset.id, roi, clock: result.curve.clock, day: result.curve.day });
  }

  async function load() {
    const get = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); });
    const [zoneValue, defaults, zipFile, curve, financing] = await Promise.all([
      get('/data/zone-value.json'),
      get('/data/finance-defaults.json'),
      get('/data/zip-launch.json'),
      get('/data/ercot-dam-houston.json'),
      get('/data/financing.json'),
    ]);
    data = { zips: zipFile.zips, zipGenerated: zipFile.generated, zoneValue, defaults, curve, financing };
    $('fleet-count').value = String(defaults.groups.flatMap((g) => g.fields).find((f) => f.key === 'fleetCount').value);
    paint(window.FleetRoiCore.evaluate(formValue(), data));
    Promise.all([get('/data/expansion-map.json'), get('/data/market-states.json')]).then(([expansion, marketStates]) => {
      data.expansion = expansion;
      data.marketStates = marketStates;
      paint(window.FleetRoiCore.evaluate(formValue(), data));
    }).catch(() => {});
  }

  $('roi-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!data) return;
    paint(window.FleetRoiCore.evaluate(formValue(), data));
  });
  $('reduction').addEventListener('input', () => {
    if (!data) return;
    paint(window.FleetRoiCore.evaluate(formValue(), data));
  });

  load().catch((err) => {
    $('roi-status').className = 'notice notice-red roi-status';
    $('roi-status').textContent = 'The public files did not load (' + err.message + ').';
  });
})();
