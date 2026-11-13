// /data-centers: what a large load pays for power in Texas. Math in largeload-core.js, data from scripts/datacenter-ercot.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../largeload-core.js');
const D = require('../data/datacenter-ercot.json');
const DAY = require('../data/day-ercot.json');
const GRID = require('../data/grid-ercot.json');

const root = (f) => path.join(__dirname, '..', f);
const z = (id) => D.zones.find((x) => x.id === id);

test('data: eight ERCOT zones priced from the same files as the homepage, cheapest first', () => {
  assert.equal(D.zones.length, 8);
  assert.ok(D.zones.every((x, i) => i === 0 || D.zones[i - 1].avgRtUsdPerMwh <= x.avgRtUsdPerMwh));
  for (const x of D.zones) {
    assert.ok(Math.abs(x.avgRtUsdPerMwh - DAY.zones.find((d) => d.id === x.id).avgRtUsdPerMwh) < 0.02, x.id);
    assert.equal(x.topHoursSumUsdPerMw.length, D.steps.length);
    assert.equal(x.topHoursSumUsdPerMw[0], 0);
    assert.ok(x.topHoursSumUsdPerMw.every((v, i, a) => i === 0 || v > a[i - 1]), x.id + ' cumulative');
    // The N priciest hours cost more than N average hours, and no more than N hours at the maximum.
    D.steps.forEach((n, i) => { if (n) { assert.ok(x.topHoursSumUsdPerMw[i] > n * x.avgRtUsdPerMwh); assert.ok(x.topHoursSumUsdPerMw[i] <= n * x.maxRtUsdPerMwh + 0.01); } });
    assert.ok(x.hoursOver1000 <= x.hoursOver200);
  }
});

test('data: the wires charge, the rules and the queue are each cited; the proposal is marked as a proposal', () => {
  const t = D.tariff;
  assert.match(t.source, /^https:\/\/ftp\.puc\.texas\.gov\//);
  assert.equal(t.per4cpKwMonthUsd, 6.260839);
  assert.equal(t.perBillingKwMonthUsd, 0.163822);
  assert.equal(D.rules.find((r) => r.id === '4cp').status, 'in force');
  assert.equal(D.rules.find((r) => r.id === '12cp').status, 'proposal');
  for (const r of D.rules) assert.match(r.source, /^https:\/\//);
  assert.equal(D.queue.approvedMw, 8927);
  assert.match(D.queue.what, /does not say these loads are data centers/);
  assert.ok(D.notIncluded.length >= 3);
});

test('data: four summer peak hours, one a month, in the afternoon; the highest matches the grid page', () => {
  const h = D.peaks.hours;
  assert.deepEqual(h.map((x) => x.date.slice(0, 7)), ['2026-06', '2026-07', '2026-08', '2026-09']);
  for (const x of h) assert.ok(x.hourEnding >= 15 && x.hourEnding <= 20, x.date + ' hour ' + x.hourEnding);
  assert.equal(Math.max(...h.map((x) => x.mw)), GRID.peak.mw);
  assert.equal(D.gridPeakMw, GRID.peak.mw);
});

test('bill: energy is size times running level times hours times the zone price', () => {
  const b = C.bill(D, 'LZ_WEST', { mw: 100, runPct: 90 });
  assert.ok(Math.abs(b.energyUsd - 100 * 0.9 * 8760 * z('LZ_WEST').avgRtUsdPerMwh) < 1e-6);
  assert.equal(b.mwh, 100 * 0.9 * 8760);
  assert.equal(b.energySavedUsd, 0);
});

test('bill: transmission follows demand in the four peak hours, at the published rate', () => {
  const b = C.bill(D, 'LZ_WEST', { mw: 100, runPct: 90 });
  assert.ok(Math.abs(b.transmissionUsd - 90 * 1000 * 6.260839 * 12) < 1e-6);
  assert.ok(Math.abs(b.transmissionPerMwYearUsd - 75130.068) < 0.01);
  assert.ok(Math.abs(b.deliveryUsd - 100 * 1000 * 0.163822 * 12) < 1e-6);
  assert.ok(Math.abs(b.fixedUsd - (258.80 + 321.63) * 12) < 1e-6);
  assert.ok(Math.abs(b.totalUsd - (b.energyUsd + b.transmissionUsd + b.deliveryUsd + b.fixedUsd)) < 1e-6);
  assert.ok(Math.abs(b.perKwhUsd - b.totalUsd / (b.mwh * 1000)) < 1e-12);
  assert.ok(Math.abs(b.peakHoursShare - 4 / 8760) < 1e-12);
});

test('bill: staying off the peaks cuts transmission in proportion and leaves energy alone', () => {
  const full = C.bill(D, 'LZ_NORTH', { mw: 200, runPct: 100 }), half = C.bill(D, 'LZ_NORTH', { mw: 200, runPct: 100, peaksAvoidedPct: 50 }), none = C.bill(D, 'LZ_NORTH', { mw: 200, runPct: 100, peaksAvoidedPct: 100 });
  assert.ok(Math.abs(half.transmissionUsd - full.transmissionUsd / 2) < 1e-6);
  assert.equal(none.transmissionUsd, 0);
  assert.ok(Math.abs(none.transmissionSavedUsd - full.transmissionUsd) < 1e-6);
  assert.equal(half.energyUsd, full.energyUsd);
  assert.ok(Math.abs(none.transmissionSavedUsd - 200 * full.transmissionPerMwYearUsd) < 1e-3, 'each MW kept off saves the per-MW figure');
});

test('bill: sitting out the priciest hours saves exactly their cost and removes their energy', () => {
  const i = D.steps.indexOf(100), full = C.bill(D, 'LZ_WEST', { mw: 100, runPct: 90 }), skip = C.bill(D, 'LZ_WEST', { mw: 100, runPct: 90, skipHours: 100 });
  assert.ok(Math.abs(skip.energySavedUsd - 90 * z('LZ_WEST').topHoursSumUsdPerMw[i]) < 1e-6);
  assert.ok(Math.abs(full.energyUsd - skip.energyUsd - skip.energySavedUsd) < 1e-6);
  assert.equal(skip.mwh, 90 * (8760 - 100));
  assert.ok(skip.perKwhUsd < full.perKwhUsd);
  assert.equal(C.bill(D, 'LZ_WEST', { skipHours: 37 }).inputs.skipHours, 0, 'only the listed steps are allowed');
});

test('bill: a city utility or co-op zone gets no wires charge from the example tariff, and never a zero', () => {
  const b = C.bill(D, 'LZ_AEN', { mw: 100, runPct: 90 });
  assert.equal(b.tariffApplies, false);
  assert.equal(b.transmissionUsd, null);
  assert.equal(b.deliveryUsd, null);
  assert.ok(Math.abs(b.totalUsd - b.energyUsd) < 1e-6);
});

test('inputs are clamped, and the comparison ranks zones by energy cost', () => {
  assert.equal(C.inputs({ mw: -5, runPct: 500, peaksAvoidedPct: 'x' }, D.steps).mw, 1);
  assert.equal(C.inputs({ mw: -5, runPct: 500 }, D.steps).runPct, 100);
  assert.equal(C.inputs({ peaksAvoidedPct: 'x' }, D.steps).peaksAvoidedPct, 0);
  const rows = C.compare(D, { mw: 100, runPct: 90 });
  assert.equal(rows.length, 8);
  assert.equal(rows[0].overCheapestUsd, 0);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].energyUsd <= r.energyUsd));
});

test('page: loads its parts, sits in the header under Data centers, and has no em dash', () => {
  const html = fs.readFileSync(root('data-centers.html'), 'utf8');
  for (const f of ['vendor/carbon/styles.min.css', 'shell.css', 'day.css', 'largeload.css', 'nav.js', 'largeload-core.js', 'largeload.js']) assert.ok(html.includes('/' + f), f);
  assert.match(html, /<link rel="canonical" href="https:\/\/megawatt\.fun\/data-centers">/);
  const header = /<!--mw-header-->[\s\S]*?<!--\/mw-header-->/.exec(fs.readFileSync(root('index.html'), 'utf8'))[0];
  assert.ok(header.includes('<a href="/data-centers">What a data center pays</a>') && header.includes('<a href="/siting">'));
  assert.ok(html.includes(header), 'the same header as the homepage');
  assert.match(html, /Not affiliated with ERCOT, Oncor/);
  assert.match(fs.readFileSync(root('sitemap.xml'), 'utf8'), /megawatt\.fun\/data-centers</);
  for (const f of ['data-centers.html', 'largeload.css', 'largeload.js', 'largeload-core.js', 'scripts/datacenter-ercot.py', 'data/datacenter-ercot.json']) {
    assert.ok(!fs.readFileSync(root(f), 'utf8').includes(String.fromCharCode(0x2014)), f + ' has no em dash');
  }
});
