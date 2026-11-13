// /grid: how power moves through Texas. Math and flow geometry in grid-core.js, data from scripts/grid-ercot.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../grid-core.js');
const D = require('../data/grid-ercot.json');
const S = require('../data/supply-ercot.json');

const root = (f) => path.join(__dirname, '..', f);
const sum = (a) => a.reduce((s, x) => s + x, 0);

test('data: a year of ERCOT load in eight regions that add up to the whole', () => {
  assert.equal(D.grid, 'ERCOT');
  assert.ok(D.period.hours >= 8758 && D.period.hours <= 8762);
  assert.equal(D.zones.length, 8);
  assert.ok(Math.abs(sum(D.zones.map((z) => z.gwh)) - D.usedGwh) < D.usedGwh * 0.002, 'regions sum to ERCOT');
  assert.ok(Math.abs(sum(D.zones.map((z) => z.share)) - 1) < 0.003);
  assert.ok(D.zones.every((z, i) => i === 0 || D.zones[i - 1].gwh >= z.gwh), 'largest first');
  for (const z of D.zones) assert.ok(Math.abs(z.gwh / z.previousGwh - 1 - z.change) < 0.001, z.id + ' change matches its two years');
});

test('data: what was made balances what was used and stored, and matches the supply page', () => {
  assert.ok(Math.abs(D.madeGwh - S.totalGwh) < 1, 'same generation total as /generation');
  for (const s of D.sources) assert.ok(Math.abs(s.gwh - S.sources.find((x) => x.id === s.id).gwh) < 0.2, s.id);
  assert.ok(Math.abs(D.storage.chargingGwh - S.storage.chargingGwh) < 0.2);
  assert.ok(Math.abs(D.madeGwh - D.usedGwh - D.storage.chargingGwh - D.differenceGwh) < 0.5);
  assert.ok(Math.abs(D.differenceGwh) / D.madeGwh < 0.01, 'made and used agree within 1%');
});

test('data: the peak is above the average, which is above the low; average matches energy over hours', () => {
  assert.ok(D.peak.mw > D.averageMw && D.averageMw > D.low.mw);
  assert.ok(Math.abs(D.averageMw - D.usedGwh * 1000 / D.period.hours) < 5);
  assert.match(D.peak.date, /^2026-0[6-9]/, 'the peak is in summer');
  assert.ok(D.peak.hourEnding >= 15 && D.peak.hourEnding <= 21, 'and in the late afternoon or evening');
});

test('data: each source is priced at the hour it ran; a source that runs at cheap hours earns less', () => {
  for (const s of D.sources) {
    assert.ok(s.avgPriceUsdPerMwh > 0, s.id);
    assert.ok(Math.abs(s.valueUsd - s.gwh * 1000 * s.avgPriceUsdPerMwh) < s.valueUsd * 0.01 + 5e5, s.id + ' value is energy times its average price');
  }
  const p = (id) => D.sources.find((s) => s.id === id).avgPriceUsdPerMwh;
  assert.ok(p('solar') < p('gas'), 'solar earns less per MWh than gas');
  assert.ok(p('solar') < D.averagePriceUsdPerMwh, 'and less than the plain average price');
  assert.ok(D.storage.chargingAvgPriceUsdPerMwh < D.averagePriceUsdPerMwh, 'batteries charge at cheaper than average hours');
  assert.ok(D.loadAvgPriceUsdPerMwh > D.averagePriceUsdPerMwh, 'demand is higher in dear hours');
  assert.match(D.notIncluded, /customer type/);
});

test('flow: both sides fill the same height, nothing overlaps, and thickness follows energy', () => {
  const f = C.flow(D, 900, 440, { nodeW: 12, gap: 5 });
  for (const side of [f.left, f.right]) {
    for (let i = 1; i < side.length; i++) assert.ok(side[i].y >= side[i - 1].y + side[i - 1].h - 1e-6, 'no overlap');
    const last = side[side.length - 1];
    assert.ok(Math.abs(last.y + last.h - (f.mid.y + f.mid.h)) < 1.5, 'reaches the bottom of the grid node');
    assert.ok(side.every((n) => /^M[\d. ]+C/.test(n.path) && n.path.endsWith('Z')));
  }
  assert.equal(f.left[0].id, 'gas');
  assert.ok(f.left[0].h > f.left[1].h);
  assert.equal(f.right[f.right.length - 1].id, 'charging');
  assert.ok(f.left.some((n) => n.id === 'small'), 'hydro and biomass are one strand');
  assert.ok(Math.abs(f.madeGwh - D.madeGwh) < 0.5);
  assert.ok(Math.abs(sum(f.left.map((n) => n.share)) - 1) < 1e-9 && Math.abs(sum(f.right.map((n) => n.share)) - 1) < 1e-9);
});

test('facts: the page\'s sentences are computed from the data', () => {
  const F = C.facts(D);
  assert.equal(F.biggest.id, D.zones[0].id);
  assert.ok(D.zones.every((z) => z.change <= F.fastest.change));
  assert.ok(D.zones.every((z) => z.gwh - z.previousGwh <= F.addedGwh + 1e-9));
  assert.ok(Math.abs(F.peakOverAverage - D.peak.mw / D.averageMw) < 1e-9);
  assert.ok(Math.abs(F.totalValueUsd - sum(D.sources.map((s) => s.valueUsd))) < 1);
});

test('page: loads its parts, sits in the header under Grid, and has no em dash', () => {
  const html = fs.readFileSync(root('grid.html'), 'utf8');
  for (const f of ['vendor/carbon/styles.min.css', 'shell.css', 'day.css', 'generation.css', 'grid.css', 'nav.js', 'grid-core.js', 'grid.js']) assert.ok(html.includes('/' + f), f);
  assert.match(html, /<link rel="canonical" href="https:\/\/megawatt\.fun\/grid">/);
  const header = /<!--mw-header-->[\s\S]*?<!--\/mw-header-->/.exec(fs.readFileSync(root('index.html'), 'utf8'))[0];
  assert.ok(header.includes('<a href="/grid">How power flows</a>') && header.includes('<a href="/live">Live prices</a>'));
  assert.ok(html.includes(header), 'the same header as the homepage');
  assert.match(fs.readFileSync(root('sitemap.xml'), 'utf8'), /megawatt\.fun\/grid</);
  for (const f of ['grid.html', 'grid.css', 'grid.js', 'grid-core.js', 'scripts/grid-ercot.py', 'data/grid-ercot.json']) {
    assert.ok(!fs.readFileSync(root(f), 'utf8').includes(String.fromCharCode(0x2014)), f + ' has no em dash');
  }
});
