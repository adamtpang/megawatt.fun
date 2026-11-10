/* Data center sites panel. Depends on datacenter-core.js and, for the map, siting-map.js.
   The economics do not import the home-battery ranker. */
(function (root) {
  'use strict';

  const Dc = root.DatacenterCore;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function usd(value, digits) {
    if (value == null || !Number.isFinite(value)) return 'Not in the file';
    return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits == null ? 0 : digits });
  }

  function num(value, digits) {
    if (value == null || !Number.isFinite(value)) return 'Not in the file';
    return value.toLocaleString('en-US', { maximumFractionDigits: digits == null ? 0 : digits });
  }

  function badge(kind, text) {
    const cls = kind === 'sourced' ? 'badge-green' : kind === 'proposal' ? 'badge-yellow' : 'badge-yellow';
    return '<span class="badge ' + cls + '">' + esc(text) + '</span>';
  }

  function readNumber(form, name) {
    const raw = new FormData(form).get(name);
    if (raw == null || String(raw).trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function zoneNote(zoneId) {
    if (zoneId === 'LZ_WEST') return 'The June 18, 2026 chart prints 5,050 MW approved to energize in LZ_WEST. That total is not split by county.';
    if (zoneId === 'LZ_NORTH') return 'The study-status chart prints LZ_NORTH on its own. The approved-to-energize chart does not. North sits inside the Other bar there.';
    return 'This zone is not given its own approved-to-energize bar. ERCOT printed one Other bar of 3,876 MW for every zone except LZ_WEST.';
  }

  function render(panel, model) {
    const large = model.large;
    const zones = (model.prices.points || []).filter(function (row) { return row.kind === 'load-zone'; });
    const approved = (large.charts || []).find(function (chart) { return chart.title.indexOf('Approved to Energize by Load Zone') === 0; });
    const queue = (large.charts || []).find(function (chart) { return chart.title.indexOf('study status by load zone, MW') !== -1; });
    const growth = large.growth;
    const y2026 = growth ? growth.years.indexOf(2026) : -1;

    panel.innerHTML = ''
      + '<p class="notice">ERCOT does not publish a data-center-only queue in the deck this page uses. The figures are large loads. They include data centers and other industrial load, and the split is not in the file. Nothing here is a Base site.</p>'
      + '<section class="card siting-block"><h2>Queue and energization</h2>'
      + '<p>As of June 18, 2026, from the Large Load Integration status update. ' + badge('sourced', 'Sourced') + '</p>'
      + '<div class="stat-row">' + large.textFigures.map(function (fig) {
        return '<article><p class="stat-value">' + num(fig.value) + ' <span>MW</span></p><p>' + esc(fig.label) + '</p><p class="fine">Slide ' + fig.slide + '. ' + esc(fig.quote) + '</p></article>';
      }).join('') + '</div>'
      + (approved ? '<h3>Approved to energize, by the zones ERCOT printed</h3><table class="ds-table"><thead><tr><th>Zone</th><th class="num">Observed peak MW</th><th class="num">Still approved MW</th><th class="num">Total MW</th></tr></thead><tbody>'
        + approved.rows.map(function (row) {
          return '<tr><th>' + esc(row.zone) + '</th><td class="num">' + num(row.observedNonSimultaneousPeakMw) + '</td><td class="num">' + num(row.remainingApprovedMw) + '</td><td class="num">' + num(row.totalMw) + '</td></tr>';
        }).join('')
        + '</tbody></table><p class="fine">' + esc(approved.note) + '</p>' : '')
      + (queue ? '<h3>Studies in progress, by zone</h3><p class="fine">These are requests, not load ERCOT has seen. ' + esc(queue.note || '') + '</p><table class="ds-table"><thead><tr><th>Zone</th><th class="num">Under review MW</th><th class="num">9.4 only MW</th><th class="num">9.4 and 9.5 MW</th><th class="num">Printed total MW</th></tr></thead><tbody>'
        + queue.rows.map(function (row) {
          return '<tr><th>' + esc(row.zone) + '</th><td class="num">' + num(row.underReviewMw) + '</td><td class="num">' + num(row.section94OnlyMw) + '</td><td class="num">' + num(row.section9495MetMw) + '</td><td class="num">' + num(row.printedTotalMw) + '</td></tr>';
        }).join('') + '</tbody></table>' : '')
      + (growth && y2026 >= 0 ? '<h3>2026 column of the growth chart</h3><p class="fine">' + esc(growth.note) + '</p><table class="ds-table"><thead><tr><th>Status</th><th class="num">2026 GW</th></tr></thead><tbody>'
        + growth.rows.map(function (row) {
          return '<tr><th>' + esc(row.status) + '</th><td class="num">' + num(row.gw[y2026], 1) + '</td></tr>';
        }).join('')
        + '<tr><th>Total</th><td class="num">' + num(growth.totalGw[y2026], 1) + '</td></tr></tbody></table>' : '')
      + '</section>'
      + '<section class="card siting-block"><h2>The 75 MW line</h2>'
      + large.rules.map(function (rule) {
        if (!rule.quote) return '';
        const kind = rule.label === 'PROPOSAL' ? 'proposal' : 'sourced';
        return '<article class="rule"><p>' + badge(kind, rule.label || 'Statute') + ' <a href="' + esc(rule.url) + '">' + esc(rule.citation) + '</a></p><blockquote>' + esc(rule.quote) + '</blockquote></article>';
      }).join('')
      + '<p class="fine">The proposal quote is the proposal for publication, not the adoption order. The adoption order was not text-extracted in this build.</p></section>'
      + '<div class="siting-split"><section class="card siting-block"><h2>Counties with a zone match</h2>'
      + '<p class="fine">Color is the load zone of matched substations. It is not a count of data centers, and it is not a share of the megawatts above.</p>'
      + '<svg class="tx-map" id="dc-map" role="img" aria-label="Texas counties colored by the load zone assigned from matched substations."></svg>'
      + '<ul class="zone-legend" id="dc-legend"></ul></section>'
      + '<section class="card siting-block"><h2>Per MW, this year</h2>'
      + '<p>Wholesale power is the twelve-month real-time mean at the load zone. Capex and opex are empty because no EIA or LBNL range was retrieved. ' + badge('example', 'EXAMPLE') + ' marks a number you can type.</p>'
      + '<form id="dc-form" class="roi-form"></form>'
      + '<div id="dc-result" aria-live="polite"></div></section></div>'
      + '<details class="card siting-block"><summary>Weather zones, not counties</summary><div id="dc-weather"></div></details>'
      + '<details class="card siting-block"><summary>Sources for this tab</summary><ul id="dc-sources"></ul></details>';

    const form = panel.querySelector('#dc-form');
    form.innerHTML = ''
      + '<label for="dc-zone">Load zone</label><select id="dc-zone" name="zone">'
      + zones.map(function (zone) { return '<option value="' + esc(zone.id) + '">' + esc(zone.id) + '</option>'; }).join('')
      + '</select>'
      + '<div class="field-grid">'
      + field('capacityFactor', 'Capacity factor', '0.9', 'EXAMPLE', 'Share of the hour the megawatt is drawn. Not a metered load factor.')
      + field('capexUsdPerMw', 'Capex, $ per MW', '', 'EXAMPLE', 'Left blank. No public capex range was stored.')
      + field('lifeYears', 'Capex life, years', '', 'EXAMPLE', 'Straight-line recovery. Blank until you set a life.')
      + field('opexUsdPerMwYear', 'Opex, $ per MW-year', '', 'EXAMPLE', 'Left blank. No public opex range was stored.')
      + field('backupDurationHours', 'Backup duration, hours', '4', 'EXAMPLE', 'Hours of storage behind 1 MW. Not a published backup design.')
      + field('backupCyclesPerYear', 'Backup cycles per year', '365', 'EXAMPLE', 'One cycle a day, to match the daily price spread.')
      + field('backupRoundTripEfficiency', 'Backup round-trip efficiency', '0.88', 'EXAMPLE', 'Not a published pack efficiency.')
      + field('backupDegradationUsdPerMwYear', 'Backup degradation, $ per MW-year', '0', 'EXAMPLE', 'Zero means degradation is not subtracted.')
      + '</div>';

    const weather = large.batchZeroWeatherZones;
    const weatherHost = panel.querySelector('#dc-weather');
    if (weather) {
      weatherHost.innerHTML = '<p class="fine">Generated ' + esc(weather.generated) + '. ' + esc(weather.note) + '</p><div class="table-scroll"><table class="ds-table"><thead><tr><th>Bucket</th>'
        + weather.zones.map(function (zone) { return '<th class="num">' + esc(zone) + '</th>'; }).join('')
        + '<th class="num">Total</th></tr></thead><tbody>'
        + weather.rows.map(function (row) {
          return '<tr><th>' + esc(row.bucket) + '</th>' + row.gw.map(function (value) { return '<td class="num">' + num(value, 1) + '</td>'; }).join('') + '<td class="num">' + num(row.totalGw, 1) + '</td></tr>';
        }).join('')
        + '</tbody></table></div>';
    } else {
      weatherHost.textContent = 'The weather-zone table was not in this snapshot.';
    }

    panel.querySelector('#dc-sources').innerHTML = (model.manifest.sources || []).filter(function (source) {
      return /llwg|sb6|puct-58481|eia-texas|ercot-hub|settlement|counties|hifld/i.test(source.id + source.title);
    }).map(function (source) {
      return '<li><a href="' + esc(source.url) + '">' + esc(source.title) + '</a> <span class="fine">' + esc(source.retrievedAt || '') + '</span></li>';
    }).join('');

    const byZone = {};
    zones.forEach(function (zone) { byZone[zone.id] = zone; });
    const countyById = {};
    (model.counties.counties || []).forEach(function (county) { countyById[county.geoid] = county; });

    function paint() {
      const colors = {
        LZ_WEST: '#1e4d2b', LZ_NORTH: '#3d6b45', LZ_SOUTH: '#77a45a', LZ_HOUSTON: '#b2dd79',
        LZ_AEN: '#54524f', LZ_CPS: '#8d6a45', LZ_LCRA: '#c4a574', LZ_RAYBN: '#bf5249',
      };
      root.SitingMap.draw(panel.querySelector('#dc-map'), model.geo, function (geoid) {
        const county = countyById[geoid];
        return county && county.zone ? (colors[county.zone] || '#d8d7d5') : '#e7e4df';
      }, function (geoid) {
        const county = countyById[geoid];
        if (county && county.zone && byZone[county.zone]) form.elements.zone.value = county.zone;
        calculate();
      });
      const used = {};
      (model.counties.counties || []).forEach(function (county) { if (county.zone) used[county.zone] = true; });
      panel.querySelector('#dc-legend').innerHTML = Object.keys(used).sort().map(function (zone) {
        return '<li><span class="swatch" style="background:' + (colors[zone] || '#d8d7d5') + '"></span>' + esc(zone) + '</li>';
      }).join('') + '<li><span class="swatch" style="background:#e7e4df"></span>No zone match</li>';
    }

    function calculate() {
      const zone = byZone[form.elements.zone.value];
      const result = Dc.perMw({
        powerUsdPerMwh: zone.meanRt,
        hoursPerYear: zone.hours,
        capacityFactor: readNumber(form, 'capacityFactor'),
        capexUsdPerMw: readNumber(form, 'capexUsdPerMw'),
        lifeYears: readNumber(form, 'lifeYears'),
        opexUsdPerMwYear: readNumber(form, 'opexUsdPerMwYear'),
        spreadUsdPerMwh: zone.diurnalRt,
        backupCyclesPerYear: readNumber(form, 'backupCyclesPerYear'),
        backupDurationHours: readNumber(form, 'backupDurationHours'),
        backupRoundTripEfficiency: readNumber(form, 'backupRoundTripEfficiency'),
        backupDegradationUsdPerMwYear: readNumber(form, 'backupDegradationUsdPerMwYear'),
      });
      const retail = large.retailContext || {};
      panel.querySelector('#dc-result').innerHTML = ''
        + '<p>' + badge('sourced', 'Sourced price') + ' ' + esc(zone.id) + ' mean real-time ' + usd(zone.meanRt, 2) + '/MWh over ' + num(zone.hours) + ' hours, ' + esc(model.prices.period.start) + ' to ' + esc(model.prices.period.endExclusive) + '.</p>'
        + '<p>' + badge('sourced', 'Sourced spread') + ' Daily real-time clock spread ' + usd(zone.diurnalRt, 2) + '/MWh. Charge hours ending 11-14, discharge hours ending 20-21.</p>'
        + '<p class="fine">' + esc(zoneNote(zone.id)) + '</p>'
        + '<dl class="result-dl">'
        + '<div><dt>Wholesale energy</dt><dd>' + usd(result.energyUsdPerMwYear) + ' /MW-year</dd></div>'
        + '<div><dt>Capital recovery</dt><dd>' + usd(result.capitalRecoveryUsdPerMwYear) + ' /MW-year</dd></div>'
        + '<div><dt>Opex</dt><dd>' + usd(result.opexUsdPerMwYear) + ' /MW-year</dd></div>'
        + '<div><dt>Backup flexibility</dt><dd>' + usd(result.flexibilityUsdPerMwYear) + ' /MW-year</dd></div>'
        + '<div><dt>Net of the pieces that are filled in</dt><dd>' + usd(result.netUsdPerMwYear) + ' /MW-year</dd></div>'
        + '</dl>'
        + '<p class="notice">' + (result.partial ? 'Partial. Still missing: ' + esc(result.missing.join(', ')) + '. A blank cost is not zero, except the net line only subtracts costs that are filled in.' : 'Every input on this form is filled in.') + '</p>'
        + (retail.centsPerKwh ? '<p class="fine">EIA Texas average retail price, all sectors, 2024: ' + retail.centsPerKwh + ' cents/kWh. ' + esc(retail.label) + '</p>' : '');
    }

    form.addEventListener('input', calculate);
    paint();
    calculate();
  }

  function field(name, label, value, kind, note) {
    return '<label class="grow">' + esc(label) + ' ' + badge(kind === 'EXAMPLE' ? 'example' : 'sourced', kind)
      + '<input name="' + name + '" type="number" step="any" value="' + esc(value) + '" aria-describedby="' + name + '-note">'
      + '<span class="fine" id="' + name + '-note">' + esc(note) + '</span></label>';
  }

  const api = { render: render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DatacenterPanel = api;
})(typeof window !== 'undefined' ? window : globalThis);
