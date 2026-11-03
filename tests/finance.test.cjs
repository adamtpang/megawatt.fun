const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../finance-core.js');

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

// A flat, easy-to-check battery: no fade, full availability, one revenue line.
const base = {
  capexPerKwh: 100, kwh: 100, kw: 10, upfront: 0,
  memberFeeMonthly: 0, retailMarginMonthly: 0, tollPerKwYear: 0, arbPerYear: 0,
  availability: 1, opexPerYear: 0, degradation: 0, lifeYears: 10,
  rate: 0.08, tenorYears: 10, dscr: 1.3, advance: 0.7, revenueCase: 'toll',
};

test('annuity payment matches a known value', () => {
  // $100,000 at 6% over 30 years: standard mortgage table gives $7,264.89 a year.
  near(F.annuityPayment(100000, 0.06, 30), 7264.89, 0.01);
  // $10,000 at 8% over 10 years: annuity factor 6.710081, payment $1,490.29.
  near(F.annuityFactor(0.08, 10), 6.710081, 1e-6);
  near(F.annuityPayment(10000, 0.08, 10), 1490.29, 0.01);
  // Zero rate is straight division.
  assert.equal(F.annuityPayment(1200, 0, 12), 100);
});

test('CFADS arithmetic: fees + margin + toll x kW x availability + arbitrage - opex', () => {
  const cf = F.cashFlows({ ...base, memberFeeMonthly: 19, retailMarginMonthly: 5, tollPerKwYear: 60, availability: 0.96, arbPerYear: 100, opexPerYear: 150, revenueCase: 'stacked' });
  // 228 + 60 + 576 + 96 - 150
  near(cf.year1Cfads, 228 + 60 + 60 * 10 * 0.96 + 100 * 0.96 - 150, 1e-9);
  assert.equal(cf.years.length, 10);
});

test('revenue case decides what counts: toll excludes arbitrage, merchant excludes toll', () => {
  const inp = { ...base, tollPerKwYear: 60, arbPerYear: 100 };
  assert.equal(F.cashFlows({ ...inp, revenueCase: 'toll' }).year1Cfads, 600);
  assert.equal(F.cashFlows({ ...inp, revenueCase: 'merchant' }).year1Cfads, 100);
  assert.equal(F.cashFlows({ ...inp, revenueCase: 'stacked' }).year1Cfads, 700);
});

test('degradation fades dispatch revenue but not member fees', () => {
  const cf = F.cashFlows({ ...base, memberFeeMonthly: 10, tollPerKwYear: 100, degradation: 0.1 });
  near(cf.years[0].cfads, 120 + 1000, 1e-9);
  near(cf.years[1].cfads, 120 + 900, 1e-9);
  near(cf.years[2].cfads, 120 + 810, 1e-9);
});

test('DSCR sizing: level payment = weakest-year CFADS / DSCR, debt = PV of that payment', () => {
  // CFADS $1,300 every year, DSCR 1.3 -> payment $1,000 -> debt = 1000 x 6.710081 = $6,710.08.
  // Capex $10,000 x 70% = $7,000 cap, so DSCR binds.
  const r = F.sizeDebt({ ...base, tollPerKwYear: 130 });
  near(r.allowedPayment, 1000, 1e-9);
  near(r.debt, 6710.08, 0.01);
  assert.equal(r.binding, 'dscr');
  near(r.debtService, 1000, 1e-6);
  near(r.minDscr, 1.3, 1e-9);
  near(r.equity, 10000 - 6710.08, 0.01);
});

test('DSCR sizing uses the weakest year inside the loan term', () => {
  const r = F.sizeDebt({ ...base, tollPerKwYear: 130, degradation: 0.05 });
  near(r.minCfads, 1300 * Math.pow(0.95, 9), 1e-9);
  assert.equal(r.binding, 'dscr');
});

test('advance-rate cap binds when cash flow could support more', () => {
  const r = F.sizeDebt({ ...base, tollPerKwYear: 1000 });
  assert.ok(r.dscrDebt > 7000);
  assert.equal(r.debt, 7000);
  assert.equal(r.binding, 'advance');
  assert.ok(r.minDscr > 1.3);
});

test('upfront payment lowers equity, and debt never exceeds net cost', () => {
  const r = F.sizeDebt({ ...base, tollPerKwYear: 1000, upfront: 5000 });
  assert.equal(r.netCapex, 5000);
  assert.equal(r.debt, 5000);
  assert.equal(r.binding, 'cost');
  assert.equal(r.equity, 0);
});

test('zero revenue gives zero debt; all net cost is equity', () => {
  const r = F.sizeDebt({ ...base, opexPerYear: 150 });
  assert.equal(r.debt, 0);
  assert.equal(r.binding, 'none');
  assert.equal(r.debtService, 0);
  assert.equal(r.equity, 10000);
  assert.match(F.explain(r).join(' '), /lend nothing/);
});

test('loan term is clamped to useful life', () => {
  const r = F.sizeDebt({ ...base, tollPerKwYear: 130, tenorYears: 20, lifeYears: 12 });
  assert.equal(r.tenor, 12);
  assert.equal(r.tenorClamped, true);
});

test('fleet totals and the 100 MW view', () => {
  const r = F.sizeDebt({ ...base, tollPerKwYear: 130 });
  const f = F.fleet(r, 30000);
  near(f.debt, r.debt * 30000, 1e-6);
  near(f.capex + 0, 10000 * 30000, 1e-6);
  assert.equal(F.batteriesForMw(100, 20), 5000);
});

test('sensitivity grid: more toll never means less debt, higher rate never means more', () => {
  const g = F.sensitivity(base, [0, 60, 120], [0.06, 0.1]);
  assert.equal(g.length, 3);
  for (let i = 1; i < g.length; i++) for (let j = 0; j < 2; j++) assert.ok(g[i].cells[j].debt >= g[i - 1].cells[j].debt);
  for (const row of g) assert.ok(row.cells[0].debt >= row.cells[1].debt);
});

test('page defaults load, normalize, and produce a sane result', () => {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/finance-defaults.json'), 'utf8'));
  const zones = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/zone-value.json'), 'utf8')).zones;
  const raw = { revenueCase: d.revenueCaseDefault, arbPerYear: zones.find((z) => z.id === d.zoneDefault).usdPerYear };
  for (const g of d.groups) for (const f of g.fields) {
    assert.ok(f.kind === 'sourced' || f.kind === 'assumption', f.key);
    if (f.kind === 'sourced') assert.match(f.source, /^https:\/\//, f.key);
    raw[f.key] = f.value;
  }
  const r = F.sizeDebt(F.normalize(raw));
  near(r.capex, 350 * 39.2, 1e-9);
  assert.ok(r.debt > 0 && r.debt <= r.cap);
  near(r.equity, r.capex - 695 - r.debt, 1e-6);
});

test('no em dashes in the finance files', () => {
  for (const f of ['finance.html', 'finance.js', 'finance-core.js', 'finance.css', 'data/finance-defaults.json', 'tests/finance.test.cjs']) {
    const p = path.join(__dirname, '..', f);
    if (fs.existsSync(p)) assert.ok(!fs.readFileSync(p, 'utf8').includes(String.fromCharCode(0x2014)), f);
  }
});
