// /generation: where Texas power comes from. Math in generation-core.js, data from scripts/supply-ercot.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../generation-core.js');
const D = require('../data/supply-ercot.json');

const root = (f) => path.join(__dirname, '..', f);
const src = (id) => D.sources.find((s) => s.id === id);
const sum = (a) => a.reduce((s, x) => s + x, 0);

test('data: a full year of ERCOT generation, eight sources, shares that add up', () => {
  assert.equal(D.grid, 'ERCOT');
  assert.equal(D.period.days, 365);
  assert.equal(D.months.length, 12);
  assert.deepEqual(D.sources.map((s) => s.id), ['nuclear', 'coal', 'gas', 'wind', 'solar', 'other', 'hydro', 'biomass']);
  assert.ok(Math.abs(sum(D.sources.map((s) => s.share)) - 1) < 0.001);
  assert.ok(Math.abs(sum(D.sources.map((s) => s.gwh)) - D.totalGwh) < 1);
  assert.ok(D.totalGwh > 300000 && D.totalGwh < 700000, 'hundreds of TWh, the size of ERCOT');
  for (const s of D.sources) assert.equal(s.avgMwByHour.length, 24, s.id);
  assert.equal(D.priceByHourUsdPerMwh.length, 24);
});

test('data: the hourly averages and the monthly totals both rebuild the yearly energy', () => {
  for (const s of D.sources) {
    const fromHours = sum(s.avgMwByHour) * D.period.days / 1000; // MW averaged per hour, times days, in GWh
    assert.ok(Math.abs(fromHours - s.gwh) <= Math.max(2, s.gwh * 0.001), s.id + ' hours: ' + fromHours + ' vs ' + s.gwh);
    const fromMonths = sum(D.months.map((m) => m.gwh[s.id]));
    assert.ok(Math.abs(fromMonths - s.gwh) <= 1, s.id + ' months: ' + fromMonths + ' vs ' + s.gwh);
  }
});

test('data: sources are cited, and a category ERCOT does not explain is flagged, not renamed', () => {
  assert.match(D.sourceEnergy.page, /^https:\/\/www\.ercot\.com\//);
  assert.match(D.sourceCapacity.url, /^https:\/\/www\.ercot\.com\//);
  assert.match(D.sourceCapacity.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(src('other').name, 'Other');
  assert.equal(src('other').capacityMw, null, 'no capacity is invented for it');
  assert.match(D.storage.note, /does not say/);
  assert.ok(D.storage.chargingGwh > 0);
});

test('year: natural gas leads, and the quoted shares are sums of the real ones', () => {
  const y = C.year(D);
  assert.equal(y.ranked[0].id, 'gas');
  assert.ok(y.ranked.every((s, i) => i === 0 || y.ranked[i - 1].gwh >= s.gwh), 'largest first');
  assert.ok(Math.abs(y.weatherShare - (src('wind').share + src('solar').share)) < 1e-9);
  assert.ok(Math.abs(y.cleanShare - (src('wind').share + src('solar').share + src('hydro').share + src('nuclear').share)) < 1e-9);
  assert.equal(y.capacityShare('other'), null);
  assert.ok(y.capacityShare('solar') > src('solar').share, 'solar is a bigger share of capacity than of energy');
});

test('day: solar peaks near midday and is almost nothing at night; gas and the price peak in the evening', () => {
  const d = C.day(D);
  assert.ok(d.solarPeakHour >= 11 && d.solarPeakHour <= 14, 'solar peak hour ' + d.solarPeakHour);
  assert.ok(src('solar').avgMwByHour[2] < d.solarPeakMw * 0.01);
  assert.ok(d.gasPeakHour >= 17 && d.gasPeakHour <= 22, 'gas peak hour ' + d.gasPeakHour);
  assert.ok(d.gasPeakMw > d.gasLowMw);
  assert.ok(d.pricePeakHour >= 17 && d.pricePeakHour <= 21, 'price peak hour ' + d.pricePeakHour);
  assert.ok(d.priceLowHour >= 8 && d.priceLowHour <= 14, 'cheapest in solar hours: ' + d.priceLowHour);
  const h = C.hour(D, 12);
  assert.ok(Math.abs(h.totalMw - sum(D.sources.map((s) => s.avgMwByHour[12]))) < 1e-6);
  assert.equal(h.priceUsdPerMwh, D.priceByHourUsdPerMwh[12]);
});

test('months: twelve in order with totals', () => {
  const ms = C.months(D);
  assert.equal(ms[0].month, '2025-10');
  assert.equal(ms[11].month, '2026-09');
  for (const m of ms) assert.ok(Math.abs(m.totalGwh - sum(Object.values(m.gwh))) < 1e-6);
});

test('page: loads its parts, sits in the nav, and has no em dash', () => {
  const html = fs.readFileSync(root('generation.html'), 'utf8');
  for (const f of ['vendor/carbon/styles.min.css', 'shell.css', 'day.css', 'generation.css', 'nav.js', 'generation-core.js', 'generation.js']) assert.ok(html.includes('/' + f), f);
  assert.match(html, /<link rel="canonical" href="https:\/\/megawatt\.fun\/generation">/);
  assert.match(html, /class="mw-header"/);
  assert.ok(fs.readFileSync(root('index.html'), 'utf8').includes('<a href="/generation">Power supply</a>'), 'in the shared header');
  assert.match(fs.readFileSync(root('sitemap.xml'), 'utf8'), /megawatt\.fun\/generation</);
  for (const f of ['generation.html', 'generation.css', 'generation.js', 'generation-core.js', 'scripts/supply-ercot.py', 'data/supply-ercot.json']) {
    assert.ok(!fs.readFileSync(root(f), 'utf8').includes(String.fromCharCode(0x2014)), f + ' has no em dash');
  }
});
