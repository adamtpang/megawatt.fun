/* Texas siting page. Data center panel first, home battery second. */
(function () {
  'use strict';

  const Siting = window.SitingCore;
  const panelDc = document.getElementById('panel-dc');
  const panelHome = document.getElementById('panel-home');
  const status = document.getElementById('siting-status');

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function usd(value, digits) {
    if (value == null || !Number.isFinite(value)) return 'No price';
    return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits == null ? 0 : digits });
  }

  function num(value) {
    if (value == null || !Number.isFinite(Number(value))) return 'Not in the file';
    return Number(value).toLocaleString('en-US');
  }

  const files = ['manifest.json', 'prices.json', 'areas.json', 'large-load.json', 'counties.json', 'counties.geojson'];

  Promise.all(files.map(function (name) {
    return fetch('/data/siting/' + name).then(function (response) {
      if (!response.ok) throw new Error(name + ' ' + response.status);
      return response.json();
    });
  })).then(function (payloads) {
    const model = {
      manifest: payloads[0],
      prices: payloads[1],
      areas: payloads[2],
      large: payloads[3],
      counties: payloads[4],
      geo: payloads[5],
    };
    status.textContent = 'Public snapshot built ' + model.manifest.generated.slice(0, 10) + '.';
    window.DatacenterPanel.render(panelDc, model);
    renderHome(model);
    wireTabs();
  }).catch(function (error) {
    status.textContent = 'The siting files did not load. ' + error.message;
  });

  function wireTabs() {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    function select(tab) {
      tabs.forEach(function (item) {
        const on = item === tab;
        item.setAttribute('aria-selected', on ? 'true' : 'false');
        document.getElementById(item.getAttribute('aria-controls')).hidden = !on;
      });
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { select(tab); });
    });
  }

  function renderHome(model) {
    const countyById = {};
    (model.counties.counties || []).forEach(function (county) { countyById[county.geoid] = county; });
    const form = document.getElementById('home-form');
    const tableHost = document.getElementById('home-table');
    const detail = document.getElementById('home-detail');
    const map = document.getElementById('home-map');
    let picked = null;

    function mathInputsReady(value) {
      return ['cyclesPerYear', 'usableKwh', 'roundTripEfficiency', 'degradationUsdPerYear'].every(function (key) {
        return value[key] != null;
      });
    }

    function assumptions() {
      const data = new FormData(form);
      function read(name) {
        const raw = data.get(name);
        if (raw == null || String(raw).trim() === '') return null;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
      }
      return {
        cyclesPerYear: read('cyclesPerYear'),
        usableKwh: read('usableKwh'),
        roundTripEfficiency: read('roundTripEfficiency'),
        degradationUsdPerYear: read('degradationUsdPerYear'),
      };
    }

    function rows() {
      const grain = form.elements.grain.value;
      const spreadKey = form.elements.spread.value;
      const flag = form.elements.flag.value;
      let list = grain === 'zip' ? model.areas.zips : model.areas.tracts;
      if (grain === 'zip' && flag !== 'all') list = list.filter(function (row) { return row.flag === flag; });
      if (picked) list = list.filter(function (row) { return row.countyGeoid === picked; });
      const byId = {};
      list.forEach(function (row) { byId[row.id] = row; });
      const ranked = Siting.rankAreas(list.map(function (row) {
        return {
          id: row.id,
          kind: row.kind,
          name: row.name,
          countyGeoid: row.countyGeoid,
          countyName: row.countyName,
          zone: row.zone,
          zoneAssignment: row.zoneAssignment,
          flag: row.flag,
          singleFamily: row.singleFamily,
          spreadUsdPerMwh: row[spreadKey],
        };
      }), assumptions(), 'spreadUsdPerMwh');
      ranked.ranked.forEach(function (row) {
        const src = byId[row.id];
        row.utilities = src.utilities || [];
        row.tdus = src.tdus || [];
        row.spreadZoneRt = src.spreadZoneRt;
        row.spreadNodeDam = src.spreadNodeDam;
      });
      if (form.elements.sort.value === 'screen') {
        ranked.ranked.sort(function (a, b) {
          const left = a.screenUsdPerYear == null ? -Infinity : a.screenUsdPerYear;
          const right = b.screenUsdPerYear == null ? -Infinity : b.screenUsdPerYear;
          return right - left || String(a.id).localeCompare(String(b.id));
        });
      }
      return ranked;
    }

    function paint() {
      const colors = {
        LZ_WEST: '#1e4d2b', LZ_NORTH: '#3d6b45', LZ_SOUTH: '#77a45a', LZ_HOUSTON: '#b2dd79',
        LZ_AEN: '#54524f', LZ_CPS: '#8d6a45', LZ_LCRA: '#c4a574', LZ_RAYBN: '#bf5249',
      };
      window.SitingMap.draw(map, model.geo, function (geoid) {
        const county = countyById[geoid];
        if (picked && geoid !== picked) return '#f0eeeb';
        return county && county.zone ? (colors[county.zone] || '#d8d7d5') : '#e7e4df';
      }, function (geoid) {
        picked = picked === geoid ? null : geoid;
        show();
      });
    }

    function show() {
      const out = rows();
      const spreadLabel = form.elements.spread.selectedOptions[0].textContent;
      const top = out.ranked.slice(0, 25);
      document.getElementById('home-count').textContent = out.ranked.length + ' areas have this spread. ' + out.skipped.length + ' are not ranked.';
      tableHost.innerHTML = '<table class="ds-table"><thead><tr><th>Area</th><th>County</th><th>Zone</th><th>Wires</th><th class="num">Owner-occupied one-unit homes</th><th class="num">Spread, $/MWh</th><th class="num">Profit, $/battery-year</th><th class="num">Profit x homes</th></tr></thead><tbody>'
        + (top.length ? top.map(function (row, index) {
          const county = countyById[row.countyGeoid] || {};
          const wires = row.kind === 'zip'
            ? ((row.utilities && row.utilities.length ? row.utilities.join(', ') : '') + (row.tdus && row.tdus.length ? ' [' + row.tdus.join(', ') + ']' : '') + ' ' + (row.flag || ''))
            : 'Tract has no utility flag';
          return '<tr><th>' + (index + 1) + '. ' + esc(row.kind === 'zip' ? row.id : row.name || row.id) + '</th><td>' + esc(row.countyName || '') + '</td><td>' + esc(row.zone || 'Unassigned') + (county.pricedNodes ? ' <span class="fine">' + county.pricedNodes + ' priced nodes</span>' : '') + '</td><td>' + esc(wires) + '</td><td class="num">' + num(row.singleFamily) + '</td><td class="num">' + (row.spreadUsdPerMwh == null ? '' : row.spreadUsdPerMwh.toFixed(2)) + '</td><td class="num">' + usd(row.profitUsdPerYear) + '</td><td class="num">' + (row.screenUsdPerYear == null ? 'Not in the file' : usd(row.screenUsdPerYear)) + '</td></tr>';
        }).join('') : '<tr><td colspan="8">No area has this spread under the current filter.</td></tr>')
        + '</tbody></table>';
      const lead = top[0];
      if (!lead || !mathInputsReady(assumptions())) {
        detail.textContent = lead ? 'Set every assumption to a number before the formula can run.' : 'No ranked area.';
        paint();
        return;
      }
      const county = countyById[lead.countyGeoid] || {};
      const current = assumptions();
      const math = Siting.batteryProfit({
        spreadUsdPerMwh: lead.spreadUsdPerMwh,
        cyclesPerYear: current.cyclesPerYear,
        usableKwh: current.usableKwh,
        roundTripEfficiency: current.roundTripEfficiency,
        degradationUsdPerYear: current.degradationUsdPerYear,
      });
      if (!math.ok) {
        detail.textContent = 'The assumptions are not usable: ' + math.errors.join(', ') + '.';
        paint();
        return;
      }
      detail.innerHTML = '<p><strong>' + esc(lead.id) + '</strong> in ' + esc(lead.countyName || 'an unassigned county') + ', ' + esc(lead.zone || 'no zone') + '.</p>'
        + '<p class="formula-line">(' + lead.spreadUsdPerMwh.toFixed(2) + ' / 1000) x ' + current.cyclesPerYear + ' x ' + current.usableKwh + ' x ' + current.roundTripEfficiency + ' - ' + current.degradationUsdPerYear + ' = ' + usd(math.profitUsdPerYear, 2) + '</p>'
        + '<p class="fine">Spread series: ' + esc(spreadLabel) + '. Zone real-time spread on the same county is ' + (lead.spreadZoneRt == null ? 'not assigned' : '$' + lead.spreadZoneRt.toFixed(2) + '/MWh') + '. Resource-node median is ' + (lead.spreadNodeDam == null ? 'not in the file' : '$' + lead.spreadNodeDam.toFixed(2) + '/MWh') + ' from ' + (county.pricedNodes || 0) + ' priced nodes. Assignment: ' + esc(lead.zoneAssignment || 'unassigned') + '.</p>'
        + '<p class="fine">Profit x homes is a screening product, not a forecast of what a fleet would earn.</p>';
      paint();
    }

    form.addEventListener('input', show);
    document.getElementById('clear-county').addEventListener('click', function () {
      picked = null;
      show();
    });
    show();
  }
})();
