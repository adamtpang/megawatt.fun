const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../deployment-core.js');
const day = (buy = 20, sell = 100) => Array.from({ length: 24 }, (_, h) => ['2026-01-01', h+1, 'N', buy, h >= 17 && h < 21 ? sell : buy]);
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
test('known cash ledger: 20 kWh bought at $20/MWh, 20 sold at $100/MWh', () => {
  const r = D.backtest(day(), { efficiency: 1 });
  near(r.bought, 20); near(r.sold, 20); near(r.net, 1.6); near(r.finalSOC, r.initialSOC);
  near(D.backtest(day(), {}, { idle: true }).net, 0);
});
test('losses, reserve and power limits conserve energy at every step', () => {
  const r = D.backtest(day(), { efficiency: .81, reserve: .4, power: 2 }, { trace: true });
  let soc = r.initialSOC;
  for (const t of r.trace) {
    assert.ok(t.charge >= 0 && t.charge <= 2 && t.discharge >= 0 && t.discharge <= 2);
    assert.ok(!(t.charge > 0 && t.discharge > 0));
    near(t.soc, soc + t.charge * .9 - t.discharge / .9); soc = t.soc;
    assert.ok(soc >= 10 - 1e-9 && soc <= 25 + 1e-9);
  }
  near(r.bought * .9 - r.sold / .9, r.residualKWh);
});
test('bad days and negative prices are retained, not clipped', () => {
  assert.ok(D.backtest(day(100, 10)).net < 0);
  assert.ok(D.backtest(day(-20, 0), { efficiency: 1 }).net > 0);
});
test('perfect foresight cannot change the fixed-clock commands', () => {
  const a = D.backtest(day(), {}, { trace: true });
  const b = D.backtest(day(900, -50), {}, { trace: true });
  assert.deepEqual(a.trace.map(t => [t.charge, t.discharge]), b.trace.map(t => [t.charge, t.discharge]));
});
test('100% reserve is idle, including a flat retail tariff', () => {
  const r = D.backtest(day(), { reserve: 1 }, { tariff: { annualUsage: 100, profile: 'flat', offPeak: .2, peak: .2 } });
  near(r.net, 0); near(r.bought, 0); near(r.sold, 0);
});
test('flat retail tariff loses money with losses; cannot sell more than load', () => {
  const r = D.backtest(day(), {}, { tariff: { annualUsage: 1, profile: 'flat', offPeak: .2, peak: .2 }, trace: true });
  assert.ok(r.net < 0); assert.ok(r.sold <= 4/24 + 1e-9);
});
test('reject missing/nonfinite prices, duplicate intervals, invalid physics', () => {
  assert.throws(() => D.backtest([]));
  assert.throws(() => D.backtest([['2026-01-01', 1, 'N', 2, null]]));
  assert.throws(() => D.backtest([day()[0], day()[0]]));
  for (const p of [{ efficiency: 0 }, { reserve: 1.1 }, { capacity: NaN }, { power: -1 }]) assert.throws(() => D.backtest(day(), p));
});
test('repeated fall-back hour is distinct and spring-forward skips one', () => {
  const fall = day(); fall.splice(2, 0, ['2026-01-01', 2, 'Y', 20, 20]);
  assert.equal(D.backtest(fall).hours, 25);
  const spring = day(); spring.splice(2, 1); assert.equal(D.backtest(spring).hours, 23);
});
test('score responds to weighting; missing values do not become zero', () => {
  const sites = [{ id: 'a', segment: 'residential', zone: 'a', scale: 1 }, { id: 'b', segment: 'residential', zone: 'b', scale: 100 }, { id: 'missing', segment: 'residential', zone: 'c', scale: 500 }];
  const results = { a: { net: 100 }, b: { net: 10 } };
  assert.equal(D.rank(sites, results, .7)[0].id, 'a'); assert.equal(D.rank(sites, results, .3)[0].id, 'b');
  assert.equal(D.rank(sites, results).at(-1).score, null);
});
test('unknown compensation prevents a total; no payback on negative returns', () => {
  const r = D.backtest(day()); assert.equal(D.economics(r, { cost: 1000 }).total, null);
  const e = D.economics(r, { cost: 1000, operatorShare: 0, ancillary: 0, reliability: 0, annualCost: 0 }); near(e.total, r.energy);
  const bad = D.economics(D.backtest(day(100, 0)), { cost: 1000, operatorShare: 0, ancillary: 0, reliability: 0, annualCost: 0 });
  assert.equal(bad.payback, null); assert.equal(bad.status, 'no-positive-return');
});
test('checked-in real dataset covers the exact year and reconciles monthly cash', () => {
  const data = require('../data/deployment/prices.json');
  for (const z of Object.values(data.zones)) {
    assert.equal(z.rows.length, 8760); assert.equal(z.rtIntervals, 35040);
    assert.equal(z.rows[0][0], '2025-10-01'); assert.equal(z.rows.at(-1)[0], '2026-09-30');
    const days = new Map(); for (const row of z.rows) days.set(row[0], (days.get(row[0]) || 0) + 1);
    assert.equal(days.size, 365); assert.equal(days.get('2025-11-02'), 25); assert.equal(days.get('2026-03-08'), 23);
    for (const [date, count] of days) assert.equal(count, date === '2025-11-02' ? 25 : date === '2026-03-08' ? 23 : 24);
    const r = D.backtest(z.rows); assert.equal(r.months.length, 12);
    near(r.months.reduce((sum, m) => sum + m.net, 0), r.net, 1e-6);
    near(r.bought * Math.sqrt(.88) - r.sold / Math.sqrt(.88), r.residualKWh, 1e-6);
  }
});
test('real-data shortlist changes under the stated alternative; source artifacts match hashes', () => {
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
  const data = require('../data/deployment/prices.json'), sites = require('../data/deployment/sites.json');
  const results = Object.fromEntries(Object.entries(data.zones).map(([z, d]) => [z, D.backtest(d.rows)]));
  assert.equal(D.rank(sites.sites, results, .7)[0].id, 'dallas-home');
  assert.equal(D.rank(sites.sites, results, .3)[0].id, 'harris-home');
  const manifest = require('../data/deployment/manifest.json');
  for (const [file, hash] of Object.entries(manifest.outputs)) {
    const content = fs.readFileSync(path.join(__dirname, '../data/deployment', file));
    assert.equal(crypto.createHash('sha256').update(content).digest('hex'), hash, file);
  }
});
