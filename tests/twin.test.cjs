// /twin: an hour-by-hour simulation of one real year. Engine in twin-core.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../twin-core.js');
const D = require('../deployment-core.js');
const P = require('../data/deployment/prices.json');
const L = require('../data/twin-ercot-load.json');
const DCD = require('../data/datacenter-ercot.json');
const ZV = require('../data/zone-value.json');
const GRID = require('../data/grid-ercot.json');

const root = (f) => path.join(__dirname, '..', f);
const year = (id) => T.withLoad(T.parsePrices(fs.readFileSync(root('data/deployment/' + id + '.csv'), 'utf8')), L);
const WEST = year('LZ_WEST');
const sum = (a) => a.reduce((s, x) => s + x, 0);
// A tiny hand-made year: two days, prices in $/MWh, grid demand in MW.
const tiny = (prices, grid) => prices.map((p, i) => ({ date: i < 24 ? '2026-07-01' : '2026-07-02', he: (i % 24) + 1, h: i % 24, price: p, gridMw: grid ? grid[i] : 50000 }));

test('data: 8,760 hours of prices and grid demand line up, and the peak matches the grid page', () => {
  assert.equal(WEST.length, 8760);
  assert.equal(L.period.hours, 8760);
  assert.deepEqual(L.clockChangeDays, { '2025-11-02': 25, '2026-03-08': 23 });
  assert.equal(Math.max(...WEST.map((r) => r.gridMw)), GRID.peak.mw);
  assert.ok(Math.abs(sum(WEST.map((r) => r.gridMw)) / 1000 - GRID.usedGwh) < 5, 'hourly demand sums to the year');
  assert.throws(() => T.withLoad([{ date: '1999-01-01', he: 1, h: 0, price: 1 }], L), /No grid demand/);
});

test('battery fixture, traced by hand: one cycle on a fixed clock', () => {
  // 10 kWh, 5 kW, no loss, no reserve. Charge hours 10-13 at $10, sell hours 19-20 at $100.
  const prices = Array.from({ length: 24 }, (_, h) => (h >= 19 && h < 21 ? 100 : 10));
  const r = T.battery(tiny(prices), { capacity: 10, power: 5, efficiency: 1, reserve: 0 }, { kind: 'clock' });
  assert.equal(r.boughtKwh, 10);                       // 5 + 5, then full
  assert.equal(r.soldKwh, 10);                         // 5 + 5, then empty
  assert.ok(Math.abs(r.cashUsd - (10 * 100 - 10 * 10) / 1000) < 1e-12); // $0.90
  assert.equal(r.trace[10].state, 'charge'); assert.equal(r.trace[12].state, 'idle', 'full after two hours');
  assert.equal(r.trace[19].state, 'run'); assert.equal(r.trace[20].soc, 0);
  assert.equal(r.cycles, 1);
});

test('battery fixture: losses are split between charging and discharging, and the reserve is a floor', () => {
  const prices = Array.from({ length: 24 }, () => 50);
  const r = T.battery(tiny(prices), { capacity: 10, power: 100, efficiency: 0.81, reserve: 0.2 }, { kind: 'clock' });
  // Starts at the 2 kWh floor. Fills 8 kWh, which takes 8 / 0.9 from the grid. Sells 8 * 0.9.
  assert.ok(Math.abs(r.boughtKwh - 8 / 0.9) < 1e-9);
  assert.ok(Math.abs(r.soldKwh - 8 * 0.9) < 1e-9);
  assert.ok(r.cashUsd < 0, 'flat prices lose the round-trip loss');
  assert.ok(r.trace.every((x) => x.soc >= 0.2 - 1e-9), 'never below the reserve');
  assert.ok(Math.abs(r.finalSoc - 0.2) < 1e-9);
});

test('the fixed clock on the real year matches the site\'s older backtest to the cent, in every zone', () => {
  for (const z of ZV.zones) {
    const mine = T.battery(year(z.id), {}, { kind: 'clock' });
    const ref = D.backtest(P.zones[z.id].rows, { capacity: 39.2, power: 20, efficiency: 0.88, reserve: 0.2, wear: 0 }, { schedule: 'solarEvening' });
    assert.ok(Math.abs(mine.cashUsd - ref.net) < 1e-6, z.id + ': ' + mine.cashUsd + ' vs ' + ref.net);
    assert.ok(Math.abs(mine.cashUsd - z.usdPerYear) < 0.006, z.id + ' matches data/zone-value.json');
    assert.ok(Math.abs(mine.soldKwh - ref.sold) < 1e-6);
  }
});

test('energy and money are conserved over the real year', () => {
  for (const kind of ['clock', 'watch', 'hindsight']) {
    const r = T.battery(WEST, {}, { kind }), eta = Math.sqrt(0.88);
    const stored = r.boughtKwh * eta - r.soldKwh / eta;
    assert.ok(Math.abs(stored - (r.finalSoc - 0.2) * 39.2) < 1e-6, kind + ': what went in less what came out is what is left');
    assert.ok(Math.abs(sum(r.days.map((d) => d.cash)) - r.cashUsd) < 1e-6, kind + ': days add up to the year');
    assert.ok(Math.abs(sum(r.months.map((m) => m.cash)) - r.cashUsd) < 1e-6, kind + ': months add up to the year');
    assert.ok(r.trace.every((x) => x.soc >= 0.2 - 1e-9 && x.soc <= 1 + 1e-9), kind + ': stays between the reserve and full');
    assert.equal(r.trace.length, 8760);
  }
});

test('hindsight is the ceiling, and the watching policy never looks ahead', () => {
  const clock = T.battery(WEST, {}, { kind: 'clock' }), hind = T.battery(WEST, {}, { kind: 'hindsight' });
  assert.ok(hind.cashUsd > clock.cashUsd);
  // Change every price after day 100. A causal policy must act the same for the first 100 days.
  const cut = T.byDay(WEST)[100].start, changed = WEST.map((r, i) => (i < cut ? r : Object.assign({}, r, { price: r.price * 3 + 7 })));
  const a = T.battery(WEST, {}, { kind: 'watch' }), b = T.battery(changed, {}, { kind: 'watch' });
  for (let i = 0; i < cut; i++) assert.equal(a.trace[i].state, b.trace[i].state, 'hour ' + i);
  assert.ok(a.trace.slice(0, 24 * 7).every((x) => x.state === 'idle'), 'idle until it has a week of prices');
});

test('outage: the home runs on the battery, below the reserve, until it is empty', () => {
  const prices = Array.from({ length: 48 }, () => 50);
  // 10 kWh, no loss, 20% reserve: 2 kWh at midnight. A 1 kW home lasts 2 hours of a 5 hour outage.
  const r = T.battery(tiny(prices), { capacity: 10, power: 5, efficiency: 1, reserve: 0.2 }, { kind: 'clock' }, { outage: { date: '2026-07-01', hour: 0, hours: 5, homeKw: 1 } });
  assert.equal(r.outage.hours, 5); assert.equal(r.outage.backupHours, 2); assert.equal(r.outage.unservedHours, 3); assert.equal(r.outage.held, false);
  assert.ok(Math.abs(r.outage.socAtStart - 0.2) < 1e-12);
  assert.equal(r.trace[4].soc, 0);
  assert.ok(r.trace.slice(0, 5).every((x) => x.state === 'outage' && x.charge === 0 && x.discharge === 0), 'no trading while the grid is down');
  const full = T.battery(tiny(prices), { capacity: 10, power: 5, efficiency: 1, reserve: 0.2 }, { kind: 'clock' }, { outage: { date: '2026-07-01', hour: 15, hours: 5, homeKw: 1 } });
  assert.equal(full.outage.held, true, 'full at 3 PM, so five hours is easy');
});

test('data center fixture, traced by hand: a battery that covers the peak hour', () => {
  // 10 MW site, 10 MW battery for 1 hour, no loss. Grid demand peaks at 5 PM on day one.
  const grid = Array.from({ length: 48 }, (_, i) => (i === 17 ? 90000 : 60000)), prices = Array.from({ length: 48 }, () => 40);
  const tariff = { per4cpKwMonthUsd: 5, perBillingKwMonthUsd: 0, customerMonthUsd: 0, meteringMonthUsd: 0 }, peaks = [{ date: '2026-07-01', hourEnding: 18 }];
  const none = T.dataCenter(tiny(prices, grid), { mw: 10, runPct: 100, batteryMw: 0 }, tariff, peaks);
  assert.equal(none.transmissionUsd, 10 * 1000 * 5 * 12);
  assert.equal(none.savedUsd, 0);
  const cfg = { mw: 10, runPct: 100, batteryMw: 10, batteryHours: 1, efficiency: 1, rule: 'level', gridTriggerMw: 80000 };
  const r = T.dataCenter(tiny(prices, grid), cfg, tariff, peaks);
  assert.equal(r.peaks[0].siteMw, 0); assert.equal(r.peaksFullyOff, 1);
  assert.equal(r.transmissionUsd, 0);
  assert.equal(r.triggerHours, 1); assert.equal(r.ranHours, 1);
  assert.equal(r.trace[17].state, 'run'); assert.equal(r.trace[24].state, 'charge', 'refills after midnight');
  assert.ok(Math.abs(r.gridMwh - none.gridMwh) < 1e-9, 'no loss: it buys back exactly what it used');
  assert.ok(Math.abs(r.savedUsd - 600000) < 1e-6, 'flat price, so the whole saving is the wires charge');
});

test('data center on the real year: with no battery it pays what the bill page says', () => {
  const LL = require('../largeload-core.js');
  const twin = T.dataCenter(WEST, { mw: 100, runPct: 90, batteryMw: 0 }, DCD.tariff, DCD.peaks.hours), page = LL.bill(DCD, 'LZ_WEST', { mw: 100, runPct: 90 });
  assert.ok(Math.abs(twin.totalUsd - page.totalUsd) / page.totalUsd < 0.0005, twin.totalUsd + ' vs ' + page.totalUsd);
  assert.ok(Math.abs(twin.transmissionUsd - page.transmissionUsd) < 1e-6);
  assert.equal(twin.peaks.length, 4);
});

test('data center on the real year: a fixed level drains the battery early; chasing the peak with enough hours holds', () => {
  const base = { mw: 100, runPct: 90, batteryMw: 90 };
  const level = T.dataCenter(WEST, Object.assign({ batteryHours: 2, rule: 'level', gridTriggerMw: 85000 }, base), DCD.tariff, DCD.peaks.hours);
  assert.equal(level.peaksFullyOff, 0);
  assert.ok(level.savedUsd < 0, 'it loses money');
  const short = T.dataCenter(WEST, Object.assign({ batteryHours: 2, rule: 'chase' }, base), DCD.tariff, DCD.peaks.hours);
  const long = T.dataCenter(WEST, Object.assign({ batteryHours: 4, rule: 'chase' }, base), DCD.tariff, DCD.peaks.hours);
  assert.ok(short.peaksFullyOff < 4);
  assert.equal(long.peaksFullyOff, 4);
  assert.ok(long.savedUsd > short.savedUsd && long.savedUsd > 0);
  assert.ok(long.transmissionSavedUsd <= level.baseline.transmissionUsd + 1e-6, 'cannot save more than the whole charge');
  assert.ok(long.trace.every((x) => x.soc >= -1e-9 && x.soc <= 1 + 1e-9));
  // The chase rule fires only on summer afternoons.
  assert.ok(long.trace.every((x) => !x.trigger || (x.date.slice(5, 7) >= '06' && x.date.slice(5, 7) <= '09' && x.h >= 15 && x.h < 19)));
});

test('the chase rule never looks ahead: later hours cannot change earlier decisions', () => {
  const cut = WEST.findIndex((r) => r.date === '2026-08-01'), changed = WEST.map((r, i) => (i < cut ? r : Object.assign({}, r, { gridMw: r.gridMw * 1.2 })));
  const cfg = { mw: 100, runPct: 90, batteryMw: 90, batteryHours: 4, rule: 'chase' };
  const a = T.dataCenter(WEST, cfg, DCD.tariff, DCD.peaks.hours), b = T.dataCenter(changed, cfg, DCD.tariff, DCD.peaks.hours);
  for (let i = 0; i < cut; i++) assert.equal(a.trace[i].state, b.trace[i].state, 'hour ' + i);
});

test('ramp test: reports the first value that holds', () => {
  const cfg = { mw: 100, runPct: 90, batteryMw: 90, rule: 'chase' };
  const r = T.ramp([1, 2, 3, 4, 5], (v) => T.dataCenter(WEST, Object.assign({ batteryHours: v }, cfg), DCD.tariff, DCD.peaks.hours), (x) => x.peaksFullyOff === 4);
  assert.equal(r.points.length, 5);
  assert.equal(r.holdsFrom, 4);
  assert.equal(T.ramp([1, 2], () => ({}), () => false).holdsFrom, null);
});

test('page: loads its parts, is first in the header, and has no em dash', () => {
  const html = fs.readFileSync(root('twin.html'), 'utf8');
  for (const f of ['vendor/carbon/styles.min.css', 'shell.css', 'day.css', 'twin.css', 'nav.js', 'finance-core.js', 'twin-core.js', 'twin.js', 'day-scene.js']) assert.ok(html.includes('/' + f), f);
  assert.match(html, /<link rel="canonical" href="https:\/\/megawatt\.fun\/twin">/);
  const header = /<!--mw-header-->[\s\S]*?<!--\/mw-header-->/.exec(fs.readFileSync(root('index.html'), 'utf8'))[0];
  assert.ok(header.includes('<a href="/twin">The twin</a>'));
  assert.ok(html.includes(header), 'the same header as the homepage');
  assert.match(html, /Not affiliated with Base Power, ERCOT, Oncor/);
  assert.match(html, /id="basis-rows"/);
  for (const f of ['twin.html', 'twin.css', 'twin.js', 'twin-core.js', 'scripts/twin-ercot.py']) assert.ok(!fs.readFileSync(root(f), 'utf8').includes(String.fromCharCode(0x2014)), f + ' has no em dash');
});
