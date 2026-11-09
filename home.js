/* Homepage for the home-battery ROI tool. Renders HomeRoiCore.evaluate. No math lives here. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (n) => Number.isFinite(n) ? (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US') : 'n/a';
  const pct = (n) => n == null || !Number.isFinite(n) ? 'not defined' : (Math.round(n * 1000) / 10).toFixed(1) + '%';
  const badge = (kind) => {
    const cls = kind === 'sourced' ? 'badge-green' : kind === 'assumption' ? 'badge-yellow' : 'badge-white';
    const label = kind === 'sourced' ? 'Sourced' : kind === 'assumption' ? 'Assumption' : 'Partly sourced';
    return '<span class="badge ' + cls + '">' + label + '</span>';
  };

  let data = null;
  let last = null;

  function formValue() {
    const fd = new FormData($('roi-form'));
    return {
      query: String(fd.get('query') || '').trim(),
      preset: fd.get('preset') || 'suburban',
      revenueCase: fd.get('revenueCase') || 'merchant',
      fleetCount: fd.get('fleetCount'),
      zone: $('zone-pick-wrap').hidden ? '' : fd.get('zone'),
    };
  }

  function paintZoneChoices(result) {
    const wrap = $('zone-pick-wrap');
    const select = $('zone-pick');
    if (!result.needsZone) { wrap.hidden = true; return; }
    const ids = result.resolution.candidates.length ? result.resolution.candidates : result.zones.map((z) => z.id);
    select.innerHTML = ids.map((id) => {
      const z = result.zones.find((row) => row.id === id);
      const label = z ? id + ' · ' + usd(z.usdPerYear) + '/yr' : id;
      return '<option value="' + esc(id) + '">' + esc(label) + '</option>';
    }).join('');
    wrap.hidden = false;
    $('zone-why').textContent = result.resolution.why.join(' ');
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

  function paint(result) {
    last = result;
    const status = $('roi-status');
    if (!result.ok) {
      status.className = 'notice notice-red roi-status';
      status.textContent = result.errors.join(' ');
      return;
    }
    paintZoneChoices(result);
    if (result.needsZone) {
      status.className = 'notice roi-status';
      status.textContent = 'This ZIP does not settle in a single load zone on the public file. Pick the zone, then estimate again.';
      $('result').innerHTML = '<p>No earnings yet. The loan is not run until the load zone is chosen, so a guessed zone cannot sneak into the debt.</p>';
      if (window.HomeHouse) window.HomeHouse.setState({ preset: result.preset && result.preset.id, roi: 'idle', clock: null, day: null });
      return;
    }
    status.className = 'notice notice-green roi-status';
    const place = [result.home.place, result.home.county].filter(Boolean).join(', ');
    status.textContent = 'ZIP ' + result.zip + (place ? ' · ' + place : '') + ' · ' + result.zone.id + '.';
    const pay = result.returns.paysBack ? 'Year ' + result.returns.paybackYear + ' of ' + result.returns.lifeYears : 'Does not pay back';
    const lines = ['arbitrage', 'backup', 'toll', 'ancillary'].map((key) => {
      const line = result.earnings[key];
      const shown = line.value;
      const aside = line.counted ? '' : ' <span class="roi-note">not in this case</span>';
      return '<li><span>' + esc(line.label) + ' ' + badge(line.kind) + aside + '</span><b>' + usd(shown) + '</b></li>';
    }).join('');
    const hist = result.historical
      ? '<p class="roi-note">Day-ahead history for this zone, not added to the loan: median year ' + usd(result.historical.p50Usd) + ', worst ' + result.historical.worstYear + ' ' + usd(result.historical.worstUsd) + '. ' + badge(result.historical.kind) + '</p>'
      : '';
    const state = result.state
      ? '<p class="roi-note">Texas ranks ' + result.state.rank + ' of ' + result.state.of + ' on the public state score (tier ' + esc(result.state.tier) + '). ' + esc(result.state.note) + ' ' + badge(result.state.kind) + '</p>'
      : '';
    $('result').innerHTML =
      '<p>' + badge(result.zone.kind) + ' ' + esc(result.zone.id) + ' ranks ' + result.zone.rank + ' of ' + result.zone.of +
      '. The highest on this clock is ' + esc(result.zone.best.id) + ' at ' + usd(result.zone.best.usdPerYear) + ' a year.</p>' +
      '<p class="roi-note">' + esc(result.zone.who || '') + '</p>' +
      '<dl class="metric-grid">' +
      '<div><dt>Payback ' + badge(result.returns.kind) + '</dt><dd>' + esc(pay) + '</dd></div>' +
      '<div><dt>Simple ROI</dt><dd>' + pct(result.returns.simpleRoi) + '</dd></div>' +
      '<div><dt>Unlevered IRR</dt><dd>' + pct(result.returns.irr) + '</dd></div>' +
      '<div><dt>Debt, one battery ' + badge(result.debt.kind) + '</dt><dd>' + usd(result.debt.perBattery) + '</dd></div>' +
      '<div><dt>Debt, ' + result.debt.fleetCount.toLocaleString('en-US') + ' batteries</dt><dd>' + usd(result.debt.fleetDebt) + '</dd></div>' +
      '<div><dt>Debt at 100 MW</dt><dd>' + usd(result.debt.debtPer100Mw) + '</dd></div>' +
      '</dl>' +
      '<ul class="earn-list">' + lines + '</ul>' +
      '<p class="roi-note">' + esc(result.debt.bindingText) + ' Home use ' + result.preset.annualKwh.toLocaleString('en-US') + ' kWh/year. ' + badge(result.preset.kwhKind) + '</p>' +
      hist + state +
      '<details><summary>Where the numbers come from</summary><ul class="source-list">' +
      result.sources.map((s) => '<li>' + badge(s.kind) + ' ' + esc(s.label) +
        (s.dated ? ' · ' + esc(s.dated) : '') +
        (s.retrieved ? ' · retrieved ' + esc(String(s.retrieved).slice(0, 10)) : '') +
        (s.url ? ' · <a href="' + esc(s.url) + '">source</a>' : '') +
        (s.note ? ' · ' + esc(s.note) : '') + '</li>').join('') +
      '</ul><p class="roi-note">' + result.explain.map(esc).join('</p><p class="roi-note">') + '</p></details>';
    paintBars(result.curve.day, result.curve.clock);
    const roi = !result.returns.paysBack ? 'poor' : result.returns.npv >= 0 ? 'good' : 'mixed';
    $('fallback-battery').setAttribute('fill', roi === 'poor' ? '#bf5249' : roi === 'mixed' ? '#f7c33c' : '#b2dd79');
    $('house-caption').textContent = result.preset.label + ' · battery on the side wall · ' + (result.returns.paysBack ? 'pays back in year ' + result.returns.paybackYear : 'does not pay back') + '.';
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
    paint(window.HomeRoiCore.evaluate(formValue(), data));
    Promise.all([get('/data/expansion-map.json'), get('/data/market-states.json')]).then(([expansion, marketStates]) => {
      data.expansion = expansion;
      data.marketStates = marketStates;
      paint(window.HomeRoiCore.evaluate(formValue(), data));
    }).catch(() => {});
  }

  $('roi-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!data) return;
    paint(window.HomeRoiCore.evaluate(formValue(), data));
  });

  load().catch((err) => {
    $('roi-status').className = 'notice notice-red roi-status';
    $('roi-status').textContent = 'The public files did not load (' + err.message + ').';
  });
})();
