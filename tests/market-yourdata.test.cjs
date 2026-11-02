const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('../yourdata.js');
const MC = require('../market-core.js');
const S = require('../notes/score.js');
const E = require('../data/expansion-map.json');
const Z = require('../data/zone-value.json');

const zoneIds = Z.zones.map((z) => z.id);
const csv = (t) => Y.parseText(t, 'x.csv');

test('state metrics: abbr and full names, direction from the header, values by state', () => {
  const r = MC.load(csv('state,install_cost_usd (lower is better),pipeline_homes\nTX,"$12,000",900\nCalifornia,15000,\nny,9000,40\n'), zoneIds);
  assert.equal(r.kind, 'states');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.factors.map((f) => [f.id, f.label, f.higherIsBetter]), [
    ['yours_install_cost_usd', 'install_cost_usd', false],
    ['yours_pipeline_homes', 'pipeline_homes', true],
  ]);
  assert.deepEqual(r.values.TX, { yours_install_cost_usd: 12000, yours_pipeline_homes: 900 });
  assert.deepEqual(r.values.CA, { yours_install_cost_usd: 15000 });
  assert.equal(r.values.NY.yours_pipeline_homes, 40);
  // Missing values are warned, listing the states, and left null for the score.
  assert.ok(r.warnings.some((w) => /install_cost_usd" has no value for 48 states/.test(w)));
  assert.ok(r.warnings.some((w) => /pipeline_homes" has no value for 49 states \(.*CA.*\)/.test(w)));
});

test('lower is better flips the rank; missing states are skipped like public data', () => {
  const f = { higherIsBetter: false };
  const ranks = S.percentileRanks([100, 200, null].map((v) => MC.rankValue(f, v)));
  assert.deepEqual(ranks, [1, 0, null]);
  assert.equal(MC.rankValue({ higherIsBetter: true }, 5), 5);
  // composite drops a null factor and averages the rest, same as a missing public value.
  assert.deepEqual(S.composite([{ a: 1, b: null }], { a: 1, b: 1 }), [1]);
});

test('JSON state metrics with declared factors', () => {
  const j = Y.parseText(JSON.stringify({
    factors: [{ key: 'cac', label: 'Customer acquisition cost', higherIsBetter: false }, { key: 'permit_days', label: 'Permit days', higherIsBetter: false }],
    states: { TX: { cac: 800, permit_days: 12 }, Florida: { cac: 1100 }, GA: { cac: '950', extra_metric: 3 } },
  }), 'm.json');
  const r = MC.load(j, zoneIds);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.factors.map((f) => [f.id, f.label, f.higherIsBetter]), [
    ['yours_cac', 'Customer acquisition cost', false],
    ['yours_permit_days', 'Permit days', false],
    ['yours_extra_metric', 'extra_metric', true],
  ]);
  assert.equal(r.values.FL.yours_cac, 1100);
  assert.equal(r.values.GA.yours_cac, 950);
});

test('state errors: unknown, duplicate, non-numeric by row and column, no numeric columns', () => {
  const bad = MC.load(csv('state,cac\nTX,800\nZZ,1\nTexas,900\nFL,abc\n'), zoneIds);
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[0], /^Row 3: unknown state "ZZ"/);
  assert.match(bad.errors[1], /^Row 4: Texas appears again \(first at Row 2\)/);
  assert.match(bad.errors[2], /^Row 5, column "cac": "abc" is not a number/);
  const none = MC.load(csv('state\nTX\nFL\n'), zoneIds);
  assert.equal(none.errors.length, 1);
  assert.match(none.errors[0], /No numeric metric columns/);
  const empty = MC.load(csv('state,cac\nTX,\n'), zoneIds);
  assert.match(empty.errors[0], /No numeric metric columns/);
  assert.match(MC.load(csv('foo,bar\n1,2\n'), zoneIds).errors[0], /No "state" column/);
  assert.match(MC.load(csv('state,zone,usd_per_year\nTX,LZ_WEST,1\n'), zoneIds).errors[0], /one kind per file/);
});

test('zone file: replaces values, marks Yours, re-sorts, keeps the rest public', () => {
  const before = JSON.stringify(Z);
  const r = MC.load(csv('zone,usd_per_year\nLZ_WEST,500\nlz_north,$120\n'), zoneIds);
  assert.equal(r.kind, 'zones');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.zones, { LZ_WEST: 500, LZ_NORTH: 120 });
  assert.match(r.warnings[0], /13 zones not in your file keep the public value/);
  const z = MC.applyZones(Z, r.zones);
  assert.equal(z.zones[0].id, 'LZ_WEST');
  assert.equal(z.zones[0].yours, true);
  assert.equal(z.zones[0].publicUsdPerYear, 27.02);
  assert.equal(z.zones.filter((x) => x.yours).length, 2);
  assert.equal(JSON.stringify(Z), before);
  const j = MC.load(Y.parseText('{"zones":{"LZ_AEN":250}}', 'z.json'), zoneIds);
  assert.deepEqual(j.zones, { LZ_AEN: 250 });
});

test('zone errors: unknown zone, negative value, non-numeric, duplicate, missing column', () => {
  const bad = MC.load(csv('zone,usd_per_year\nLZ_MARS,10\nLZ_WEST,-5\nLZ_AEN,lots\nHB_PAN,1\nHB_PAN,2\n'), zoneIds);
  assert.equal(bad.errors.length, 4);
  assert.match(bad.errors[0], /^Row 2: unknown zone "LZ_MARS"/);
  assert.match(bad.errors[1], /^Row 3: LZ_WEST cannot be negative/);
  assert.match(bad.errors[2], /^Row 4, column "usd_per_year": "lots" is not a number/);
  assert.match(bad.errors[3], /^Row 6: HB_PAN appears again/);
  assert.match(MC.load(csv('zone,value\nLZ_WEST,1\n'), zoneIds).errors[0], /usd_per_year/);
});

test('templates load back', () => {
  const stateCsv = Y.toCSV(MC.stateTemplateRows(), MC.STATE_TEMPLATE_COLUMNS);
  const rows = Y.parseCSV(stateCsv);
  assert.equal(rows.length, 51);
  assert.deepEqual(Object.keys(rows[0]), ['state', 'install_cost_usd (lower is better)', 'pipeline_homes']);
  // Every template state is a state on the map.
  const mapAbbrs = new Set(E.states.map((s) => s.abbr));
  rows.forEach((r) => assert.ok(mapAbbrs.has(r.state), r.state));
  // Blank template is detected as state metrics and asks for numbers; filled in, it loads clean.
  assert.match(MC.load(csv(stateCsv), zoneIds).errors[0], /No numeric metric columns/);
  rows.forEach((r, i) => { r['install_cost_usd (lower is better)'] = 10000 + i; r.pipeline_homes = i; });
  const filled = MC.load(csv(Y.toCSV(rows, MC.STATE_TEMPLATE_COLUMNS)), zoneIds);
  assert.deepEqual(filled.errors, []);
  assert.deepEqual(filled.warnings, []);
  assert.equal(Object.keys(filled.values).length, 51);
  assert.equal(filled.factors[0].higherIsBetter, false);
  // Zone template reproduces the public numbers exactly.
  const zr = MC.load(csv(Y.toCSV(MC.zoneTemplateRows(Z), ['zone', 'usd_per_year'])), zoneIds);
  assert.deepEqual(zr.errors, []);
  assert.deepEqual(zr.warnings, []);
  const same = MC.applyZones(Z, zr.zones);
  assert.deepEqual(same.zones.map((x) => [x.id, x.usdPerYear]), Z.zones.map((x) => [x.id, x.usdPerYear]));
});

test('public data untouched by any load', () => {
  const e = JSON.stringify(E), z = JSON.stringify(Z);
  MC.load(csv('state,cac\nTX,1\n'), zoneIds);
  MC.applyZones(Z, { LZ_WEST: 1 });
  assert.equal(JSON.stringify(E), e);
  assert.equal(JSON.stringify(Z), z);
  assert.equal(MC.STATES.length, 51);
});
