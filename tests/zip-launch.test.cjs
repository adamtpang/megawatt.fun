const { test } = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../zip-launch-core.js');
const DATA = require('../data/zip-launch.json');
const handler = require('../api/v1/zip.js');

function resMock() {
  return {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b; },
    json() { return JSON.parse(this.body); },
  };
}
async function post(body, url) {
  const res = resMock();
  await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body, url: url || '/api/v1/zip' }, res);
  return res;
}

function fixture(extra) {
  return Object.assign({
    explainer: 'Type the ZIP.',
    coverage: { note: 'Texas first.', gaps: ['gap'] },
    formula: {
      expression: 'permit_review_days + interconnection_days + crew_days',
      rule: 'Add only calendar-day numbers.',
    },
    ahj_rule: { min_incorporated_land_share: 0.5, text: 'Half the land, or the county.' },
    ercot_tdu_names: ['oncor', 'centerpoint', 'aep texas', 'tnmp', 'texas-new mexico power'],
    sources: {
      'openei-2024': { title: 'OpenEI', url: 'https://data.openei.org/submissions/8563', dated: '2025-11-10', retrieved: '2026-11-03' },
      'puct-ercot-tdus': { title: 'PUCT TDUs', url: 'https://www.puc.texas.gov/agency/about/ope/inside_ercot/Default.aspx', retrieved: '2026-11-03' },
      solarapp: { title: 'SolarAPP', url: 'https://www.gosolarapp.org/where-is-solarapp-available', dated: '2026-03-23', retrieved: '2026-11-03' },
    },
    clocks: [],
    solarapp: { file_modified: '2026-03-23', jurisdictions: [
      { name: 'Houston', state: 'TX', pv: true, solar_plus_storage: false, main_panel_upgrade: true, main_breaker_derate: false, subtitle: '', url: 'https://example.com/houston' },
      { name: 'Harris County', state: 'TX', pv: true, solar_plus_storage: true, subtitle: '', url: '' },
    ] },
    zips: {},
  }, extra);
}

test('normalizeZip accepts 5 digits and ZIP+4 only', () => {
  assert.equal(Z.normalizeZip('78704'), '78704');
  assert.equal(Z.normalizeZip(' 78704-1234 '), '78704');
  assert.equal(Z.normalizeZip('7870'), null);
  assert.equal(Z.normalizeZip('787041'), null);
  assert.equal(Z.normalizeZip('abcde'), null);
});

test('half-land rule picks the city at 0.5 and the county below that', () => {
  const data = fixture({
    zips: {
      '11111': { state: 'TX', county: { name: 'Harris County', geoid: '48201', land_share: 1 }, place: { name: 'Houston city', incorporated: true, land_share: 0.49 }, utilities: [] },
      '22222': { state: 'TX', county: { name: 'Harris County', geoid: '48201', land_share: 1 }, place: { name: 'Houston city', incorporated: true, land_share: 0.5 }, utilities: [] },
    },
  });
  const low = Z.lookup(data, '11111').result;
  assert.equal(low.ahj.kind, 'county');
  assert.equal(low.ahj.name, 'Harris County');
  assert.equal(low.solarapp.on_list, true);
  assert.equal(low.solarapp.solar_plus_storage, true);
  const high = Z.lookup(data, '22222').result;
  assert.equal(high.ahj.kind, 'city');
  assert.equal(high.ahj.name, 'Houston');
  assert.equal(high.solarapp.solar_plus_storage, false);
  assert.equal(high.solarapp.pv, true);
});

test('a city named like a county does not match the county row', () => {
  const data = fixture({
    solarapp: { file_modified: '2026-03-23', jurisdictions: [
      { name: 'Houston County', state: 'TX', pv: true, solar_plus_storage: true, subtitle: '', url: '' },
    ] },
    zips: {
      '33333': { state: 'TX', county: { name: 'Travis County', geoid: '48453', land_share: 1 }, place: { name: 'Houston city', incorporated: true, land_share: 1 }, utilities: [] },
    },
  });
  const r = Z.lookup(data, '33333').result;
  assert.equal(r.ahj.name, 'Houston');
  assert.equal(r.solarapp.on_list, false);
  assert.equal(r.solarapp.display, 'no');
});

test('calendar-day points sum, and a business-day window does not', () => {
  const point = (id, days) => ({ id, input: id, fills_input: true, kind: 'point', low_days: days, high_days: days, unit: 'calendar days', display: String(days), about: '', quote: '', applies: { eia_id: '1' }, source: 'openei-2024' });
  const data = fixture({
    clocks: [
      point('permit_review_days', 3),
      point('interconnection_days', 4),
      point('crew_days', 5),
      { id: 'window', input: 'interconnection_days', fills_input: false, kind: 'typical_window', low_days: 5, high_days: 10, unit: 'business days', display: '5 to 10 business days', about: '', quote: '', applies: { eia_id: '1' }, source: 'openei-2024' },
    ],
    zips: {
      '44444': { state: 'TX', county: { name: 'Travis County', geoid: '48453', land_share: 1 }, utilities: [{ name: 'Example Municipal', eia_id: '1', ownership: 'Municipal', service_type: 'Bundled' }] },
    },
  });
  const days = Z.lookup(data, '44444').result.days_to_first_install;
  assert.equal(days.days, 12);
  assert.equal(days.display, '12');
  assert.ok(days.clocks.some((c) => c.id === 'window'));
});

test('two calendar-day figures for one input leave that input unknown', () => {
  const point = (id) => ({ id, input: 'permit_review_days', fills_input: true, kind: 'point', low_days: 3, high_days: 3, unit: 'calendar days', display: '3', about: '', quote: '', applies: { eia_id: '9' }, source: 'openei-2024' });
  const data = fixture({
    clocks: [point('a'), point('b')],
    zips: { '55555': { state: 'TX', county: { name: 'Travis County', geoid: '48453', land_share: 1 }, utilities: [{ name: 'Example', eia_id: '9', ownership: 'Municipal', service_type: 'Bundled' }] } },
  });
  const input = Z.lookup(data, '55555').result.days_to_first_install.inputs.find((i) => i.id === 'permit_review_days');
  assert.equal(input.display, 'unknown');
  assert.equal(input.days, null);
});

test('an outside limit is not added into the total', () => {
  const data = fixture({
    clocks: [{ id: 'limit', input: 'interconnection_days', fills_input: false, kind: 'outside_limit', low_days: 28, high_days: 28, unit: 'calendar days', display: 'within 28 days', about: '', quote: '', applies: { state: 'TX', ownership: 'Investor Owned' }, source: 'openei-2024' }],
    zips: { '66666': { state: 'TX', county: { name: 'El Paso County', geoid: '48141', land_share: 1 }, utilities: [{ name: 'El Paso Electric Co', eia_id: '2', ownership: 'Investor Owned', service_type: 'Bundled' }] } },
  });
  const r = Z.lookup(data, '66666').result;
  assert.equal(r.interconnection_path.id, 'texas_iou_bundled');
  assert.equal(r.days_to_first_install.display, 'unknown');
  assert.equal(r.days_to_first_install.clocks[0].id, 'limit');
});

test('Austin 78704 is Austin Energy, city permit office, and the solar-meter clock', () => {
  const out = Z.lookup(DATA, '78704');
  assert.equal(out.errors.length, 0);
  const r = out.result;
  assert.equal(r.covered, true);
  assert.equal(r.state, 'TX');
  assert.equal(r.utility.name, 'Austin Energy');
  assert.equal(r.utility.eia_id, '1015');
  assert.equal(r.utility.ownership, 'Municipal');
  assert.equal(r.interconnection_path.id, 'municipal');
  assert.equal(r.ahj.name, 'Austin');
  assert.equal(r.ahj.kind, 'city');
  assert.equal(r.county.name, 'Travis County');
  assert.equal(r.solarapp.on_list, false);
  assert.equal(r.solarapp.display, 'no');
  assert.equal(r.days_to_first_install.display, 'unknown');
  assert.equal(r.days_to_first_install.formula, 'permit_review_days + interconnection_days + crew_days');
  assert.deepEqual(r.days_to_first_install.inputs.map((i) => i.display), ['unknown', 'unknown', 'unknown']);
  const meter = r.days_to_first_install.clocks.find((c) => c.id === 'austin-energy-solar-meter');
  assert.ok(meter);
  assert.equal(meter.unit, 'business days');
  assert.equal(meter.low_days, 5);
  assert.equal(meter.high_days, 10);
  assert.ok(out.sources.some((s) => s.id === 'austin-energy-ica' && s.dated === '2026-10-01'));
});

test('San Antonio 78205 is the municipal utility in the OpenEI file', () => {
  const r = Z.lookup(DATA, '78205').result;
  assert.equal(r.utility.name, 'City of San Antonio - (TX)');
  assert.equal(r.utility.eia_id, '16604');
  assert.equal(r.ahj.name, 'San Antonio');
  assert.equal(r.county.name, 'Bexar County');
  assert.equal(r.interconnection_path.id, 'municipal');
  assert.equal(r.solarapp.display, 'no');
  assert.equal(r.days_to_first_install.display, 'unknown');
});

test('Houston 77002 has the city and SolarAPP PV, and no wires utility', () => {
  const out = Z.lookup(DATA, '77002');
  const r = out.result;
  assert.equal(r.utilities.length, 0);
  assert.equal(r.utility, null);
  assert.equal(r.interconnection_path.id, 'unknown');
  assert.equal(r.ahj.name, 'Houston');
  assert.equal(r.ahj.kind, 'city');
  assert.equal(r.county.name, 'Harris County');
  assert.equal(r.solarapp.on_list, true);
  assert.equal(r.solarapp.pv, true);
  assert.equal(r.solarapp.solar_plus_storage, false);
  assert.equal(r.solarapp.file_modified, '2026-03-23');
  assert.equal(r.days_to_first_install.display, 'unknown');
  assert.equal(r.days_to_first_install.clocks.length, 0);
  assert.ok(out.warnings.some((w) => /wires utility/i.test(w)));
  assert.ok(!/oncor|centerpoint/i.test(JSON.stringify(r.utilities)));
});

test('Dallas 75201 has the city and does not invent Oncor', () => {
  const r = Z.lookup(DATA, '75201').result;
  assert.equal(r.utilities.length, 0);
  assert.equal(r.ahj.name, 'Dallas');
  assert.equal(r.county.name, 'Dallas County');
  assert.equal(r.solarapp.display, 'no');
  assert.equal(r.days_to_first_install.display, 'unknown');
  const oncor = r.reference_clocks.find((c) => c.id === 'oncor-points-at-25211');
  assert.equal(oncor.matched, false);
});

test('78620 is Pedernales and the county, because the city is under half the land', () => {
  const r = Z.lookup(DATA, '78620').result;
  assert.equal(r.utility.name, 'Pedernales Electric Coop, Inc');
  assert.equal(r.utility.eia_id, '14626');
  assert.equal(r.interconnection_path.id, 'cooperative');
  assert.equal(r.ahj.kind, 'county');
  assert.equal(r.ahj.name, 'Hays County');
  assert.ok(r.place.land_share < 0.5);
  assert.equal(r.place.name, 'Dripping Springs city');
  const pec = r.days_to_first_install.clocks.find((c) => c.id === 'pec-inspection-visit');
  assert.ok(pec);
  assert.equal(pec.low_days, 10);
  assert.equal(pec.high_days, 15);
  assert.equal(r.days_to_first_install.display, 'unknown');
});

test('a ZIP with two utilities does not blend their paths', () => {
  const r = Z.lookup(DATA, '78669').result;
  assert.equal(r.utilities.length, 2);
  assert.equal(r.utility, null);
  assert.equal(r.interconnection_path.id, 'unknown');
  const ids = r.utilities.map((u) => u.path.id).sort();
  assert.deepEqual(ids, ['cooperative', 'municipal']);
});

test('a Texas investor-owned utility gets the PUCT outside limits and an unknown total', () => {
  const hit = Object.entries(DATA.zips).find(([, rec]) => rec.utilities && rec.utilities.length === 1 && rec.utilities[0].name === 'Entergy Texas Inc.');
  assert.ok(hit, 'Entergy Texas should be in the OpenEI trim');
  const r = Z.lookup(DATA, hit[0]).result;
  assert.equal(r.interconnection_path.id, 'texas_iou_bundled');
  const ids = r.days_to_first_install.clocks.map((c) => c.id).sort();
  assert.deepEqual(ids, ['puct-25211-other', 'puct-25211-precertified']);
  assert.equal(r.days_to_first_install.display, 'unknown');
});

test('Irving is on SolarAPP+ with storage, Waco is an open pilot', () => {
  const irving = Z.lookup(DATA, '75038').result;
  assert.equal(irving.ahj.name, 'Irving');
  assert.equal(irving.solarapp.on_list, true);
  assert.equal(irving.solarapp.solar_plus_storage, true);
  const waco = Z.lookup(DATA, '76701').result;
  assert.equal(waco.ahj.name, 'Waco');
  assert.equal(waco.solarapp.on_list, true);
  assert.equal(waco.solarapp.subtitle, 'Open Pilot');
  assert.equal(waco.solarapp.solar_plus_storage, true);
});

test('Illinois is covered and a New York ZIP is not', () => {
  const il = Z.lookup(DATA, '60601').result;
  assert.equal(il.covered, true);
  assert.equal(il.state, 'IL');
  assert.equal(il.days_to_first_install.display, 'unknown');
  const ny = Z.lookup(DATA, '10001');
  assert.equal(ny.errors.length, 0);
  assert.equal(ny.result.covered, false);
  assert.equal(ny.result.utility, null);
  assert.equal(ny.result.ahj, null);
  assert.equal(ny.result.days_to_first_install.display, 'unknown');
  assert.equal(ny.result.solarapp.display, 'unknown');
});

test('the committed file does not name Oncor or CenterPoint', () => {
  const names = new Set();
  for (const rec of Object.values(DATA.zips)) {
    for (const u of rec.utilities || []) names.add(u.name);
  }
  for (const n of names) {
    assert.equal(/oncor|centerpoint|aep texas|tnmp/i.test(n), false, n);
  }
  assert.equal(DATA.generated, '2026-11-03');
  assert.equal(DATA.solarapp.file_modified, '2026-03-23');
  assert.ok(DATA.coverage.gaps.length >= 5);
});

test('POST /api/v1/zip matches the core and rejects a bad ZIP', async () => {
  const ok = await post({ zip: '78704-0001' });
  assert.equal(ok.statusCode, 200);
  const body = ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.inputs_used.zip, '78704');
  assert.equal(body.result.utility.name, 'Austin Energy');
  assert.equal(body.result.days_to_first_install.display, 'unknown');
  assert.ok(body.sources.some((s) => s.id === 'census-zcta-place'));

  const bad = await post({ zip: 'nope' });
  assert.equal(bad.statusCode, 422);
  assert.equal(bad.json().ok, false);

  const csv = resMock();
  await handler({ method: 'POST', headers: { 'content-type': 'text/csv' }, body: 'zip\n78704\n', url: '/api/v1/zip' }, csv);
  assert.equal(csv.statusCode, 422);

  const q = await post({}, '/api/v1/zip?zip=78205');
  assert.equal(q.statusCode, 200);
  assert.equal(q.json().result.ahj.name, 'San Antonio');
});
