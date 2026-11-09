const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../finance-core.js');
const Fleet = require('../fleet-roi-core.js');
const ZONE = require('../data/zone-value.json');
const DEFAULTS = require('../data/finance-defaults.json');
const ZIP = require('../data/zip-launch.json');
const CURVE = require('../data/ercot-dam-houston.json');
const FINANCING = require('../data/financing.json');

const DATA = { zips: ZIP.zips, zipGenerated: ZIP.generated, zoneValue: ZONE, defaults: DEFAULTS, curve: CURVE, financing: FINANCING };
const houston = ZONE.zones.find((z) => z.id === 'LZ_HOUSTON').usdPerYear;

function line(out, id) { return out.stack.find((l) => l.id === id); }

test('Houston 77002 is the member model and does not invent a bill credit', () => {
  const out = Fleet.evaluate({ query: '77002', preset: 'suburban' }, DATA);
  assert.equal(out.ok, true);
  assert.equal(out.marketMode.id, 'member');
  assert.equal(line(out, 'timeshift').value, houston);
  assert.equal(line(out, 'timeshift').kind, 'partly sourced');
  assert.equal(line(out, 'billCredit').status, 'not modeled yet');
  assert.equal(line(out, 'billCredit').value, null);
  assert.equal(line(out, 'backup').status, 'not modeled yet');
  assert.equal(line(out, 'backup').value, null);
  assert.equal(line(out, 'ancillary').status, 'not modeled yet');
  assert.equal(line(out, 'utility').status, 'not modeled yet');
  assert.equal(out.operator.sized, false);
  assert.match(out.operator.reason, /not modeled yet/);
});

test('a member share is an assumption and the loan matches finance-core', () => {
  const out = Fleet.evaluate({ query: '77002', billCreditPct: 40 }, DATA);
  const credit = line(out, 'billCredit');
  assert.equal(credit.status, 'modeled');
  assert.equal(credit.kind, 'assumption');
  assert.equal(credit.value, houston * 0.4);
  assert.equal(out.operator.sized, true);
  assert.equal(out.operator.cashPerYear, houston * 0.6);
  const capex = DEFAULTS.groups.flatMap((g) => g.fields).find((f) => f.key === 'capexPerKwh').value;
  const raw = { revenueCase: 'merchant', zoneMarket: 'retail choice', arbPerYear: houston * 0.6, fleetCount: out.operator.fleetCount };
  for (const g of DEFAULTS.groups) for (const f of g.fields) raw[f.key] = f.value;
  raw.capexPerKwh = capex;
  raw.arbPerYear = houston * 0.6;
  raw.memberFeeMonthly = 0;
  raw.retailMarginMonthly = 0;
  raw.tollPerKwYear = 0;
  raw.ancPerKwYear = 0;
  raw.upfront = 0;
  const direct = F.sizeDebt(F.normalize(raw));
  assert.equal(out.operator.perBattery, direct.debt);
  assert.equal(out.operator.irr, direct.returns.unlevered.irr);
});

test('Austin 78704 is the vendor model and the 9% remark is not a cash flow', () => {
  const out = Fleet.evaluate({ query: '78704' }, DATA);
  assert.equal(out.marketMode.id, 'vendor');
  assert.match(out.marketMode.why, /Austin Energy/);
  assert.equal(line(out, 'utility').status, 'not modeled yet');
  assert.match(line(out, 'utility').note, /9%/);
  assert.equal(out.operator.sized, false);
  assert.equal(line(out, 'timeshift').counted, false);
  assert.ok(out.podcast.notes.some((n) => n.t === '~26:19'));
});

test('a typed utility contract is an assumption and sizes debt', () => {
  const out = Fleet.evaluate({ query: '78704', contractUsd: 500 }, DATA);
  assert.equal(line(out, 'utility').kind, 'assumption');
  assert.equal(line(out, 'utility').value, 500);
  assert.equal(out.operator.cashPerYear, 500);
  assert.equal(out.operator.sized, true);
});

test('Base-built cost is a percent off the shelf price, not a Base Core price', () => {
  const shelf = Fleet.evaluate({ query: '77002', hardware: 'shelf', reductionPct: 25 }, DATA);
  const base = Fleet.evaluate({ query: '77002', hardware: 'base', reductionPct: 25, billCreditPct: 0 }, DATA);
  assert.equal(shelf.hardware.kind, 'sourced');
  assert.equal(shelf.hardware.reductionPct, 0);
  assert.equal(base.hardware.kind, 'assumption');
  assert.equal(base.hardware.landedPerKwh, shelf.hardware.shelfPerKwh * 0.75);
  assert.match(base.hardware.note, /not a Base Core price/i);
  assert.equal(base.operator.sized, true);
});

test('homeowner comparison still shows the buy-it-yourself path', () => {
  const out = Fleet.evaluate({ query: '77002' }, DATA);
  assert.equal(out.homeowner.label, 'Homeowner buys the battery');
  assert.equal(out.homeowner.paysBack, false);
  assert.ok(out.homeowner.simpleRoi < 0);
  assert.equal(out.membership.purchaseUsd, 20000);
  assert.equal(out.membership.twentieth, 1000);
  assert.equal(out.membership.fortieth, 500);
  assert.match(out.membership.note, /not a Base membership price/);
});

test('a CoServ ZIP is split with Oncor and names the 100 MW example only as speech', () => {
  const out = Fleet.evaluate({ query: '75007' }, DATA);
  assert.equal(out.marketMode.status === 'split' || out.marketMode.id === 'split', true);
  assert.ok(out.marketMode.vendors.some((v) => v.id === 'coserv'));
  assert.equal(out.operator.sized, false);
  const picked = Fleet.evaluate({ query: '75007', marketMode: 'vendor', zone: 'LZ_NORTH' }, DATA);
  assert.equal(picked.marketMode.id, 'vendor');
  assert.equal(picked.coservExample, true);
});

test('a share above 100 is an error, not a clipped credit', () => {
  const out = Fleet.evaluate({ query: '77002', billCreditPct: 140 }, DATA);
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /Member share/);
});

test('El Paso stays unknown instead of a guessed fleet model', () => {
  const out = Fleet.evaluate({ query: '79901' }, DATA);
  assert.equal(out.marketMode.id, 'unknown');
  assert.equal(out.operator.sized, false);
});
