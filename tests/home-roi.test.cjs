const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../finance-core.js');
const MC = require('../market-core.js');
const H = require('../home-roi-core.js');
const ZONE = require('../data/zone-value.json');
const DEFAULTS = require('../data/finance-defaults.json');
const ZIP = require('../data/zip-launch.json');
const CURVE = require('../data/ercot-dam-houston.json');
const FINANCING = require('../data/financing.json');

const DATA = {
  zips: ZIP.zips,
  zipGenerated: ZIP.generated,
  zoneValue: ZONE,
  defaults: DEFAULTS,
  curve: CURVE,
  financing: FINANCING,
};

function field(key) {
  return DEFAULTS.groups.flatMap((g) => g.fields).find((f) => f.key === key);
}

test('77002 CenterPoint maps to LZ_HOUSTON and the loan matches finance-core', () => {
  const out = H.evaluate({ query: '77002', preset: 'suburban' }, DATA);
  assert.equal(out.ok, true);
  assert.equal(out.needsZone, false);
  assert.equal(out.zone.id, 'LZ_HOUSTON');
  assert.equal(out.zone.kind, 'partly sourced');
  assert.equal(out.earnings.arbitrage.value, ZONE.zones.find((z) => z.id === 'LZ_HOUSTON').usdPerYear);
  assert.equal(out.earnings.backup.value, 0);
  assert.equal(out.earnings.backup.kind, 'assumption');
  assert.equal(out.earnings.arbitrage.counted, true);
  assert.equal(out.zone.rank, 8);
  assert.equal(out.zone.of, 8);
  assert.equal(out.zone.best.id, 'LZ_WEST');
  const raw = { revenueCase: 'merchant', zone: 'LZ_HOUSTON', zoneMarket: 'retail choice', arbPerYear: out.earnings.arbitrage.value };
  for (const g of DEFAULTS.groups) for (const f of g.fields) raw[f.key] = f.value;
  const direct = F.sizeDebt(F.normalize(raw));
  assert.equal(out.debt.perBattery, direct.debt);
  assert.equal(out.returns.irr, direct.returns.unlevered.irr);
  assert.equal(out.returns.paybackYear, direct.returns.unlevered.paybackYear);
  assert.equal(out.debt.fleetCount, field('fleetCount').value);
  assert.equal(out.debt.fleetDebt, F.fleet(direct, out.debt.fleetCount).debt);
  assert.equal(out.curve.clock.charge.join(','), '11,12,13,14');
  assert.equal(out.curve.clock.discharge.join(','), '20,21');
  assert.equal(out.curve.day.hours.length, 24);
  assert.equal(out.curve.day.kind, 'sourced');
  assert.equal(out.historical.countedInLoan, false);
  assert.ok(out.historical.p50Usd > 0);
  assert.equal(out.preset.annualKwh, 1097 * 12);
  assert.equal(out.preset.kwhKind, 'sourced');
  assert.equal(out.retail.usdPerMonth, field('retailMarginMonthly').value);
});

test('an address is read for its ZIP', () => {
  const out = H.evaluate({ query: '800 Capitol St, Houston, TX 77002' }, DATA);
  assert.equal(out.zip, '77002');
  assert.equal(out.zone.id, 'LZ_HOUSTON');
});

test('Austin Energy is a NOIE zone and merchant arbitrage is not counted', () => {
  const out = H.evaluate({ query: '78704', preset: 'suburban', revenueCase: 'merchant' }, DATA);
  assert.equal(out.zone.id, 'LZ_AEN');
  assert.equal(out.zone.noChoice, true);
  assert.equal(out.earnings.arbitrage.counted, false);
  assert.equal(out.earnings.arbitrage.countedUsd, 0);
  assert.ok(out.earnings.arbitrage.value > 0);
});

test('Oncor does not pick North versus West', () => {
  const out = H.evaluate({ query: '75201' }, DATA);
  assert.equal(out.needsZone, true);
  assert.ok(out.resolution.candidates.includes('LZ_NORTH'));
  assert.ok(out.resolution.candidates.includes('LZ_WEST'));
  const picked = H.evaluate({ query: '75201', zone: 'LZ_NORTH' }, DATA);
  assert.equal(picked.zone.id, 'LZ_NORTH');
  assert.equal(picked.zone.kind, 'assumption');
  assert.equal(picked.debt.perBattery, F.sizeDebt(F.normalize(Object.assign(
    { revenueCase: 'merchant', zone: 'LZ_NORTH', zoneMarket: 'retail choice', arbPerYear: ZONE.zones.find((z) => z.id === 'LZ_NORTH').usdPerYear },
    Object.fromEntries(DEFAULTS.groups.flatMap((g) => g.fields).map((f) => [f.key, f.value])),
  ))).debt);
});

test('bungalow kWh is an assumption and scales the retail margin', () => {
  const out = H.evaluate({ query: '77002', preset: 'bungalow' }, DATA);
  assert.equal(out.preset.kwhKind, 'assumption');
  assert.equal(out.preset.annualKwh, 9000);
  const base = field('retailMarginMonthly').value;
  assert.equal(out.retail.usdPerMonth, Math.round(base * 9000 / (1097 * 12)));
  assert.notEqual(out.retail.usdPerMonth, base);
  assert.match(out.preset.kwhNote, /assumption/);
});

test('zone order is MarketCore.applyZones', () => {
  const ranked = H.rankZones(ZONE);
  const via = MC.applyZones(ZONE, {}).zones.map((z) => z.id);
  assert.deepEqual(ranked.map((z) => z.id), via);
});

test('a ZIP outside the file is an error, not a guessed zone', () => {
  const out = H.evaluate({ query: '99999' }, DATA);
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /99999/);
});

test('El Paso has no invented ERCOT zone', () => {
  const out = H.evaluate({ query: '79901' }, DATA);
  assert.equal(out.needsZone, true);
  assert.equal(out.resolution.status, 'unmapped');
  assert.equal(out.resolution.candidates.length, 0);
});

test('toll case counts the assumption toll and not arbitrage', () => {
  const out = H.evaluate({ query: '77002', revenueCase: 'toll' }, DATA);
  assert.equal(out.earnings.toll.counted, true);
  assert.equal(out.earnings.arbitrage.counted, false);
  assert.ok(out.earnings.toll.value > 0);
  assert.equal(out.earnings.toll.kind, 'assumption');
});

test('every returned figure has a basis', () => {
  const out = H.evaluate({ query: '78205', preset: 'ranch' }, DATA);
  assert.equal(out.zone.id, 'LZ_CPS');
  for (const line of [out.earnings.arbitrage, out.earnings.backup, out.earnings.toll, out.returns, out.debt, out.preset]) {
    assert.ok(line.kind || line.kwhKind, JSON.stringify(line));
  }
  assert.equal(out.preset.kwhKind, 'assumption');
  assert.ok(out.sources.every((s) => s.kind === 'sourced' || s.kind === 'partly sourced' || s.kind === 'assumption'));
});
