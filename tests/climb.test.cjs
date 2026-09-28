const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BASELINE_TW, BASELINE_YEAR, powerTW, yearsTo } = require('../climb.js');
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/kardashev-baseline.json'), 'utf8'));

test('baseline derives from the saved source and leap-year duration', () => {
  assert.equal(BASELINE_YEAR, baseline.year);
  assert.equal(BASELINE_TW, baseline.primary_energy_twh / baseline.hours_in_year);
  assert.equal(baseline.hours_in_year, 366 * 24);
  assert.equal(((Math.log10(BASELINE_TW * 1e12) - 6) / 10).toFixed(3), '0.730');
});
test('K increments encode power ratios, not linear completion', () => {
  assert.equal(powerTW(.8), 100);
  assert.equal(powerTW(.9), 1000);
  assert.equal(powerTW(1), 10000);
  assert.ok(Math.abs(powerTW(.75) - Math.sqrt(1000)) < 1e-10);
  assert.ok(BASELINE_TW / powerTW(1) < .003);
});
test('arrival is the first whole year reaching the target', () => {
  for (const k of [.75,.8,.9,1]) {
    for (const growth of [.1,2,5]) {
      const target = powerTW(k), years = yearsTo(target,growth);
      assert.ok(BASELINE_TW * (1 + growth/100)**years >= target - 1e-8);
      assert.ok(BASELINE_TW * (1 + growth/100)**(years-1) < target);
    }
  }
});
test('zero growth, already reached targets and invalid inputs are explicit', () => {
  assert.equal(yearsTo(100,0), Infinity);
  assert.equal(yearsTo(10,0), 0);
  assert.throws(() => yearsTo(100,-1),RangeError);
  assert.throws(() => yearsTo(NaN,2),RangeError);
});
