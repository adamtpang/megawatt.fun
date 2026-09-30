const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../base-core.js');

const cached = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/ercot-dam-houston.json'), 'utf8'));
const cachedDay = { date: cached.delivery_date, prices: cached.hours.map((h) => h.usd_mwh) };

test('planner keeps the audit fix: no losing marginal pairs', () => {
  // The AUDIT.md regression: [0,50,0,50,0,50], 3 kWh usable, 1 kW, lossless. Old planner $0.05, fixed $0.10.
  const prices = [0, 50, 0, 50, 0, 50, ...new Array(18).fill(0)];
  const plan = B.planDay(prices, { kwh: 3, kw: 1, eff: 1, reservePct: 0 });
  assert.ok(Math.abs(plan.profit - 0.10) < 1e-9, `profit ${plan.profit}`);
});

test('flat prices: no cycle, battery just holds reserve', () => {
  const day = B.simulateDay(new Array(24).fill(30));
  assert.equal(day.profit, 0);
  assert.ok(day.hours.every((h) => h.state === 'reserve'));
  assert.match(B.summarize(day), /held its charge/);
});

test('energy is conserved and the day ends at the reserve', () => {
  const day = B.simulateDay(cachedDay.prices);
  assert.ok(Math.abs(day.endSoc - day.reserveKwh) < 1e-6);
  const min = Math.min(...day.hours.map((h) => h.soc)), max = Math.max(...day.hours.map((h) => h.soc));
  assert.ok(min >= day.reserveKwh - 1e-6, 'never dips into backup');
  assert.ok(max <= B.ASSUMPTIONS.batteryKwh + 1e-6, 'never overfills');
});

test('stale or missing live data falls back to the last good day, and says so', () => {
  const now = new Date('2026-10-10T12:00:00-05:00');
  const stale = { date: '2026-10-01', prices: cachedDay.prices };
  const r = B.pickPrices(stale, cachedDay, now);
  assert.equal(r.status, 'fallback');
  assert.match(r.note, /last good day/);
  assert.equal(B.pickPrices(null, cachedDay, now).status, 'fallback');
  assert.equal(B.pickPrices({ date: '2026-10-10', prices: [1, 2] }, cachedDay, now).status, 'fallback');
  assert.equal(B.pickPrices(null, null, now).status, 'none');
  const fresh = { date: '2026-10-10', prices: cachedDay.prices };
  assert.equal(B.pickPrices(fresh, cachedDay, now).status, 'live');
});

test('an unreachable battery shows a message and no numbers', () => {
  for (const report of [null, undefined, {}, { socKwh: NaN }]) {
    const v = B.batteryView(report);
    assert.equal(v.reachable, false);
    assert.equal(v.message, "We can't reach your battery right now.");
    assert.equal(v.socKwh, undefined);
  }
  assert.deepEqual(B.batteryView({ socKwh: 19.6 }), { reachable: true, socKwh: 19.6 });
});

test('cached ERCOT file is a real 24-hour day with provenance', () => {
  assert.equal(cached.hours.length, 24);
  assert.ok(cached.source.startsWith('https://www.ercot.com/'));
  assert.ok(cached.downloaded && cached.delivery_date);
});
