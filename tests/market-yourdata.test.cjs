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
  const r = MC.load(csv('state,install_cost_usd (lower is better),pipeline_homes\nTX,"$12,000",900\nCalifornia,15000,\nny,9000,40\nFL,11000,10\nGA,10500,20\nAZ,9800,30\n'), zoneIds);
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
  assert.ok(r.warnings.some((w) => /install_cost_usd" has no value for 45 states/.test(w)));
  assert.ok(r.warnings.some((w) => /pipeline_homes" has no value for 46 states \(.*CA.*\)/.test(w)));
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
    states: { TX: { cac: 800, permit_days: 12 }, Florida: { cac: 1100 }, GA: { cac: '950', extra_metric: 3 }, AZ: { cac: 900 }, NC: { cac: 1000 } },
  }), 'm.json');
  const r = MC.load(j, zoneIds);
  assert.deepEqual(r.errors, []);
  // cac has 5 states and counts; permit_days and extra_metric have one each, so they are left out.
  assert.deepEqual(r.factors.map((f) => [f.id, f.label, f.higherIsBetter]), [
    ['yours_cac', 'Customer acquisition cost', false],
  ]);
  assert.ok(r.warnings.some((w) => /^"Permit days" has values for only 1 state, so it is left out of the score/.test(w)), r.warnings.join(' | '));
  assert.ok(r.warnings.some((w) => /^"extra_metric" has values for only 1 state/.test(w)));
  assert.deepEqual(r.values.TX, { yours_cac: 800 });
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
  assert.match(r.warnings[0], /6 zones not in your file keep the public value/);
  const z = MC.applyZones(Z, r.zones);
  assert.equal(z.zones[0].id, 'LZ_WEST');
  assert.equal(z.zones[0].yours, true);
  assert.equal(z.zones[0].publicUsdPerYear, Z.zones.find((x) => x.id === 'LZ_WEST').usdPerYear);
  assert.equal(z.zones.filter((x) => x.yours).length, 2);
  assert.equal(JSON.stringify(Z), before);
  const j = MC.load(Y.parseText('{"zones":{"LZ_AEN":250}}', 'z.json'), zoneIds);
  assert.deepEqual(j.zones, { LZ_AEN: 250 });
});

test('zone errors: unknown zone, negative value, non-numeric, duplicate, missing column', () => {
  const bad = MC.load(csv('zone,usd_per_year\nLZ_MARS,10\nLZ_WEST,-5\nLZ_AEN,lots\nLZ_CPS,1\nLZ_CPS,2\nHB_PAN,3\n'), zoneIds);
  assert.equal(bad.errors.length, 5);
  assert.match(bad.errors[0], /^Row 2: unknown zone "LZ_MARS"/);
  assert.match(bad.errors[1], /^Row 3: LZ_WEST cannot be negative/);
  assert.match(bad.errors[2], /^Row 4, column "usd_per_year": "lots" is not a number/);
  assert.match(bad.errors[3], /^Row 6: LZ_CPS appears again/);
  // Hubs are not places a home battery earns, so they are not accepted zone ids.
  assert.match(bad.errors[4], /^Row 7: unknown zone "HB_PAN"/);
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

// ---------- input hardening (2026-11-03) ----------

test('reserved names never resolve as states, zones or cells', () => {
  for (const s of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(MC.stateOf(s), null, s);
  const r = MC.load(csv('state,cac\nconstructor,1\n__proto__,2\nTX,3\n'), zoneIds);
  assert.deepEqual(r.errors, [
    'Row 2: unknown state "constructor". Use a two-letter code such as TX, or the full name.',
    'Row 3: unknown state "__proto__". Use a two-letter code such as TX, or the full name.',
  ]);
  // A metric called "constructor" that one state leaves out is missing there, not a function.
  const five = { GA: { constructor: 1, other: 1 }, AZ: { constructor: 2, other: 2 }, NC: { constructor: 3, other: 3 }, OH: { constructor: 4, other: 4 } };
  const j = MC.load({ kind: 'json', data: { states: Object.assign({ TX: { constructor: 5 }, FL: { other: 1 } }, five) } }, zoneIds);
  assert.deepEqual(j.errors, []);
  assert.deepEqual(j.values.FL, { yours_other: 1 });
  assert.deepEqual(j.values.TX, { yours_constructor: 5 });
  const z = MC.load(csv('zone,usd_per_year\nconstructor,1\n'), zoneIds);
  assert.match(z.errors[0], /^Row 2: unknown zone "constructor"/);
});

test('metric values are plain decimals: hex, true and lists are not numbers', () => {
  const r = MC.load(csv('state,cac\nTX,0x10\nFL,Infinity\n'), zoneIds);
  assert.deepEqual(r.errors, ['Row 2, column "cac": "0x10" is not a number.', 'Row 3, column "cac": "Infinity" is not a number.']);
  const j = MC.load({ kind: 'json', data: { states: { TX: { cac: true }, FL: { cac: [5] }, GA: 7 } } }, zoneIds);
  assert.deepEqual(j.errors, [
    'states.TX, column "cac": "true" is not a number.',
    'states.FL, column "cac": "a list" is not a number.',
    'states.GA: must be an object of { metric: number }.',
  ]);
  const zz = MC.load({ kind: 'json', data: { zones: { LZ_WEST: '0x10' } } }, zoneIds);
  assert.deepEqual(zz.errors, ['zones.LZ_WEST, column "usd_per_year": "0x10" is not a number.']);
});

// ---------- break-test fixes, 2026-11-04 ----------

test('a metric with fewer than 5 states is left out of the score, never full marks', () => {
  const MS = require('../market-score.js');
  const M = require('../data/market-states.json');
  assert.equal(MC.MIN_STATES, 5);
  // One state: an error, because nothing is left to rank, so no state can move.
  const one = MC.load({ kind: 'json', data: { factors: [{ key: 'install_cost_usd', higherIsBetter: false }], states: { TX: { install_cost_usd: 999999 } } } }, zoneIds);
  assert.deepEqual(one.errors, ['No metric has values for at least 5 states, so nothing can be ranked. Fill in at least 5 states for a metric.']);
  assert.match(one.warnings[0], /^"install_cost_usd" has values for only 1 state, so it is left out of the score\. A metric needs at least 5 states/);
  // Two states next to a good metric: the thin one is dropped, the good one counts.
  const two = MC.load(csv('state,thin,good\nTX,1,1\nFL,2,2\nGA,,3\nAZ,,4\nNC,,5\n'), zoneIds);
  assert.deepEqual(two.errors, []);
  assert.deepEqual(two.factors.map((f) => f.id), ['yours_good']);
  assert.ok(Object.values(two.values).every((v) => !('yours_thin' in v)));
  assert.ok(two.warnings.some((w) => /^"thin" has values for only 2 states/.test(w)));
  // States without the good metric score exactly as on public data; "thin" never ranks FL at 0.
  const base = MS.scoreStates(E, M, {}), withTwo = MS.scoreStates(E, M, { yours: two });
  const at = (o, a) => o.states.find((x) => x.abbr === a);
  assert.equal(at(withTwo, 'CA').score, at(base, 'CA').score);
  assert.equal(at(withTwo, 'FL').factors.yours_thin, undefined);
  // Exactly 5 states counts.
  const ok = MC.load(csv('state,m\nTX,1\nFL,2\nGA,3\nAZ,4\nNC,5\n'), zoneIds);
  assert.deepEqual([ok.errors, ok.factors.map((f) => f.id)], [[], ['yours_m']]);
});

test('zone values are capped at the /finance arbPerYear cap and zone ids take any case', () => {
  const F = require('../finance-core.js');
  assert.equal(MC.ZONE_MAX, F.ARB_MAX);
  const big = MC.load({ kind: 'json', data: { zones: { LZ_NORTH: 1e12 } } }, zoneIds);
  assert.deepEqual(big.errors, ['zones.LZ_NORTH: LZ_NORTH must be at most 100,000 $ per battery per year (the same cap as arbPerYear on /finance), got 1000000000000.']);
  assert.deepEqual(MC.load(csv('zone,usd_per_year\nlz_north,100000\n'), zoneIds).zones, { LZ_NORTH: 100000 });
  assert.match(MC.load(csv('zone,usd_per_year\nLz_West,100000.01\n'), zoneIds).errors[0], /^Row 2: LZ_WEST must be at most 100,000/);
});

test('a CSV column written twice is an error, not a silent last-value-wins', () => {
  const r = MC.load(csv('state,cac,cac\nTX,1,2\n'), zoneIds);
  assert.ok(r.errors.includes('Column "cac" appears more than once. Keep one.'), r.errors.join(' | '));
  const z = MC.load(csv('zone,usd_per_year,usd_per_year\nLZ_WEST,1,2\n'), zoneIds);
  assert.deepEqual(z.errors, ['Column "usd_per_year" appears more than once. Keep one.']);
});

test('market page: own-key state lookups, abbreviations in any case, no rank when nothing is scored', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'market.js'), 'utf8');
  // No plain-object lookup by a URL or typed name (?state=__proto__ used to throw).
  assert.doesNotMatch(src, /byName\[/);
  assert.doesNotMatch(src, /scored\[/);
  assert.match(src, /byName = new Map\(/);
  assert.match(src, /const q = findState\(new URLSearchParams\(location\.search\)\.get\('state'\)\)/);
  assert.match(src, /rank: it\.score == null \? null : i \+ 1/);
  // findState, run on the real state list: names and codes in any case; reserved names find nothing.
  const fnSrc = src.match(/function findState\(text\) \{[\s\S]*?\n  \}/)[0];
  const M = require('../data/market-states.json');
  const states = E.states.map((s) => ({ name: s.name, abbr: s.abbr }));
  const findState = new Function('states', fnSrc + '\nreturn findState;')(states);
  for (const q of ['Texas', 'TX', 'tx', ' texas ', 'TEXAS']) assert.equal(findState(q) && findState(q).name, 'Texas', q);
  for (const q of ['__proto__', 'constructor', 'toString', '', null]) assert.equal(findState(q), null, String(q));
  // The API ranks the same way: with every weight at 0, no state has a rank.
  const MS = require('../market-score.js');
  const zero = Object.fromEntries(E.factors.map((f) => [f.id, 0]));
  const out = MS.scoreStates(E, M, { weights: zero });
  assert.ok(out.states.every((s) => s.score === null && s.rank === null));
  assert.equal(MS.scoreStates(E, M, {}).states[0].rank, 1);
});
