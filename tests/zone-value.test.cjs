const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../deployment-core.js');
const prices = require('../data/deployment/prices.json');
const z = require('../data/zone-value.json');

test('saved zone and hub values reproduce from the raw ERCOT prices on the saved clock', () => {
  assert.equal(z.schedule.name, 'solarEvening');
  assert.deepEqual([z.schedule.charge, z.schedule.discharge], [D.SCHEDULES.solarEvening.charge, D.SCHEDULES.solarEvening.discharge]);
  for (const row of z.zones.concat(z.hubs.points)) {
    const r = D.backtest(prices.zones[row.id].rows, z.spec, { schedule: z.schedule });
    assert.ok(Math.abs(r.net - row.usdPerYear) < 0.01, row.id);
  }
});

test('ranked list is load zones only, best first; hubs are kept apart and cover the rest', () => {
  assert.ok(z.zones.length > 0);
  for (const row of z.zones) { assert.equal(row.kind, 'load zone'); assert.match(row.id, /^LZ_/); }
  for (const row of z.hubs.points) { assert.equal(row.kind, 'hub'); assert.match(row.id, /^HB_/); }
  assert.equal(z.zones.length + z.hubs.points.length, Object.keys(prices.zones).length);
  for (let i = 1; i < z.zones.length; i++) assert.ok(z.zones[i - 1].usdPerYear >= z.zones[i].usdPerYear);
  assert.equal(z.spec.capacity, 39.2); assert.equal(z.spec.power, 20);
});

test('the evening clock beats the old overnight clock for a 2-hour battery in every load zone', () => {
  // The old clock sells from 17:00 at 20 kW and is empty by about 18:30, missing HE20 and HE21.
  for (const row of z.zones) {
    const old = D.backtest(prices.zones[row.id].rows, z.spec, { schedule: 'overnight' }).net;
    assert.ok(row.usdPerYear > old, row.id);
  }
});

test('copy describes the saved clock, not the old one', () => {
  const text = z.method + ' ' + z.schedule.label;
  assert.match(text, /10 AM to 2 PM/); assert.match(text, /7 (PM )?to 9 PM/);
  assert.doesNotMatch(text, /1 to 5 AM|5 to 9 PM/);
});
