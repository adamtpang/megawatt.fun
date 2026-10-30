const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../deployment-core.js');
const prices = require('../data/deployment/prices.json');
const z = require('../data/zone-value.json');

test('saved zone values reproduce from the raw ERCOT prices', () => {
  for (const row of z.zones) {
    const r = D.backtest(prices.zones[row.id].rows, z.spec);
    assert.ok(Math.abs(r.net - row.usdPerYear) < 0.01, row.id);
  }
});

test('zones are sorted best first and cover every settlement point', () => {
  assert.equal(z.zones.length, Object.keys(prices.zones).length);
  for (let i = 1; i < z.zones.length; i++) assert.ok(z.zones[i - 1].usdPerYear >= z.zones[i].usdPerYear);
  assert.equal(z.spec.capacity, 39.2); assert.equal(z.spec.power, 20);
});
