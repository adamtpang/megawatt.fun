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
  near(r.itcFace, 0.3 * r.capex, 1e-9);
  near(r.itc, 0.3 * r.capex * 0.895, 1e-9);
  near(r.equity, r.capex - 695 - r.itc - r.debt, 1e-6);
});

test('no em dashes in the finance files', () => {
  for (const f of ['finance.html', 'finance.js', 'finance-core.js', 'finance.css', 'data/finance-defaults.json', 'tests/finance.test.cjs', 'api/v1/finance.js', 'docs/plug-and-play/finance.md', 'docs/api.md']) {
    const p = path.join(__dirname, '..', f);
    if (fs.existsSync(p)) assert.ok(!fs.readFileSync(p, 'utf8').includes(String.fromCharCode(0x2014)), f);
  }
});

// ---------- review fixes ----------

const DEF = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/finance-defaults.json'), 'utf8'));
const ZV = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/zone-value.json'), 'utf8'));
const FIELDS = DEF.groups.flatMap((g) => g.fields);
const field = (k) => FIELDS.find((f) => f.key === k);
function defaultInputs(over = {}) {
  const raw = { revenueCase: DEF.revenueCaseDefault, arbPerYear: ZV.zones.find((z) => z.id === DEF.zoneDefault).usdPerYear };
  for (const f of FIELDS) raw[f.key] = f.value;
  return F.normalize(Object.assign(raw, over));
}

test('tax credit: reduces the net cost debt and equity fund, not the cash flow', () => {
  const no = F.sizeDebt({ ...base, tollPerKwYear: 1000 });
  const yes = F.sizeDebt({ ...base, tollPerKwYear: 1000, itc: 0.3 });
  assert.equal(yes.itc, 3000);
  assert.equal(yes.netCapex, 7000);
  assert.equal(yes.year1Cfads, no.year1Cfads);
  assert.equal(yes.debt, 7000); // advance cap and net cost are both $7,000
  assert.equal(yes.equity, 0);
  // With a member payment the net cost binds below the advance cap.
  const both = F.sizeDebt({ ...base, tollPerKwYear: 1000, itc: 0.3, upfront: 1000 });
  assert.equal(both.netCapex, 6000);
  assert.equal(both.debt, 6000);
  assert.equal(both.binding, 'cost');
  assert.match(F.bindingText(both), /member payment and the tax credit/);
});

test('tax credit plus member payment above cost: nothing to finance, text says so', () => {
  const r = F.sizeDebt({ ...base, tollPerKwYear: 130, itc: 0.5, upfront: 6000 });
  assert.equal(r.netCapex, 0);
  assert.equal(r.debt, 0);
  assert.equal(r.equity, 0);
  const text = F.explain(r).join(' ');
  assert.match(text, /Nothing is left to finance/);
  assert.doesNotMatch(text, /too small|lend nothing/);
  assert.match(F.bindingText(r), /No debt needed/);
});

test('tax credit default is sourced from the statute, with eligibility and PFE notes', () => {
  const f = field('itcPct');
  assert.equal(f.value, 30);
  assert.equal(f.kind, 'sourced');
  assert.match(f.source, /law\.cornell\.edu\/uscode\/text\/26\/48E/);
  for (const re of [/48E/, /6418/, /25D/, /P\.L\. 119-21/, /Notice 2026-15/, /prohibited foreign entity/, /55%/]) assert.match(f.note, re);
});

test('default case does not hinge on the toll placeholder', () => {
  assert.equal(DEF.revenueCaseDefault, 'merchant');
  assert.equal(field('tollPerKwYear').kind, 'assumption');
  const a = F.sizeDebt(defaultInputs());
  const b = F.sizeDebt(defaultInputs({ tollPerKwYear: 0 }));
  const c = F.sizeDebt(defaultInputs({ tollPerKwYear: 500 }));
  assert.ok(a.debt > 0);
  assert.equal(a.debt, b.debt);
  assert.equal(a.debt, c.debt);
  // The first explain line names the biggest line and whether it is public.
  assert.match(F.explain(a)[0], /biggest revenue line.*public number/);
  // In the toll case the toll drives it, and the text says it is an assumption.
  const t = F.sizeDebt(defaultInputs({ revenueCase: 'toll' }));
  assert.match(F.explain(t)[0], /^The utility toll is the biggest revenue line.*labeled assumption/);
});

test('retail margin stays at 0 with its math and reason shown', () => {
  const f = field('retailMarginMonthly');
  assert.equal(f.value, 0);
  assert.equal(f.kind, 'assumption');
  assert.match(f.note, /Left at \$0 on purpose/);
  assert.match(f.note, /x kWh/);
});

test('generic fleet: 1,000 batteries, no company valuation or member count in the copy', () => {
  const f = field('fleetCount');
  assert.equal(f.value, 1000);
  assert.equal(f.integer, true);
  assert.equal(f.kind, 'assumption');
  for (const name of ['finance.html', 'finance.js', 'data/finance-defaults.json', 'api/v1/finance.js']) {
    const t = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
    assert.doesNotMatch(t, /30,000|30000|Series D|valuation|raised to date/, name);
  }
});

test('explain matches the binding limit in edge cases', () => {
  // kwh 0: cash flow is positive but there is no cost to finance.
  const k0 = F.sizeDebt(defaultInputs({ kwh: 0 }));
  assert.ok(k0.minCfads > 0);
  assert.equal(k0.debt, 0);
  assert.deepEqual(F.explain(k0), ['Installed cost is $0, so there is nothing to finance.']);
  assert.doesNotMatch(F.bindingText(k0), /weakest year/);
  // Advance rate 0: cash flow is fine, the cap is 0.
  const a0 = F.sizeDebt(defaultInputs({ advancePct: 0 }));
  assert.equal(a0.debt, 0);
  assert.equal(a0.binding, 'advance');
  assert.match(F.explain(a0).join(' '), /advance rate is 0%/);
  assert.doesNotMatch(F.explain(a0).join(' '), /too small|cash flow after operating cost/);
  assert.match(F.bindingText(a0), /advance rate is 0%/);
  // Negative cash flow: the text says the weakest year has nothing left.
  const neg = F.sizeDebt(defaultInputs({ opexPerYear: 5000 }));
  assert.equal(neg.binding, 'none');
  assert.match(F.explain(neg)[0], /lend nothing.*nothing is left to repay/);
  // Tiny debt service never prints absurd percentages.
  const tiny = F.sizeDebt({ ...base, tollPerKwYear: 1000, memberFeeMonthly: 10, capexPerKwh: 0.01 });
  for (const line of F.explain(tiny)) assert.doesNotMatch(line, /e\+|Infinity|NaN/);
});

test('every field has a min and a max, and the defaults sit inside them', () => {
  for (const f of FIELDS) {
    assert.ok(Number.isFinite(f.min) && Number.isFinite(f.max) && f.min < f.max, f.key);
    assert.ok(f.value >= f.min && f.value <= f.max, f.key);
    assert.equal(F.fieldError(f, f.value), null, f.key);
  }
});

test('parseDecimal accepts plain decimals only', () => {
  assert.equal(F.parseDecimal('12'), 12);
  assert.equal(F.parseDecimal(' -3.5 '), -3.5);
  assert.equal(F.parseDecimal('.5'), 0.5);
  assert.equal(F.parseDecimal('1e3'), 1000);
  assert.equal(F.parseDecimal('$1,200'), 1200);
  assert.equal(F.parseDecimal(8.5), 8.5);
  for (const bad of ['0x10', '0b1', '0o7', 'Infinity', '-Infinity', 'NaN', '', '  ', '1e999', '12abc', '1.2.3', true, null, [5], {}]) {
    assert.ok(Number.isNaN(F.parseDecimal(bad)), String(bad));
  }
});

test('validateFields: the page and the API share one set of rules', () => {
  const typed = Object.fromEntries(FIELDS.map((f) => [f.key, String(f.value)]));
  assert.deepEqual(F.validateFields(DEF, typed).errors, {});
  // Blank keeps the default, it is not 0.
  const blank = F.validateFields(DEF, { ...typed, capexPerKwh: '', ratePct: '   ' });
  assert.deepEqual(blank.errors, {});
  assert.equal(blank.values.capexPerKwh, 350);
  assert.equal(blank.values.ratePct, 8);
  const cases = {
    capexPerKwh: '-100', ratePct: '500', dscr: '0', lifeYears: '0', availabilityPct: '1000',
    kwh: '1e308', tollPerKwYear: '0x10', fleetCount: '2.5', tenorYears: '7.5', upfront: 'abc',
  };
  const { errors } = F.validateFields(DEF, { ...typed, ...cases });
  assert.deepEqual(Object.keys(errors).sort(), Object.keys(cases).sort());
  assert.match(errors.tollPerKwYear, /plain decimal/);
  assert.match(errors.fleetCount, /whole number/);
  assert.match(errors.kwh, /at most 1000/);
  assert.match(errors.capexPerKwh, /at least 0/);
  // fleetCount must be a positive whole number with a max.
  assert.ok(F.validateFields(DEF, { fleetCount: '0' }).errors.fleetCount);
  assert.ok(F.validateFields(DEF, { fleetCount: '20000000' }).errors.fleetCount);
  assert.deepEqual(F.validateFields(DEF, { fleetCount: '5000' }).errors, {});
});

test('the largest allowed inputs still give finite numbers', () => {
  const raw = { revenueCase: 'stacked', arbPerYear: F.ARB_MAX };
  for (const f of FIELDS) raw[f.key] = f.key === 'itcPct' ? 0 : f.max;
  const r = F.sizeDebt(F.normalize(raw));
  for (const k of ['capex', 'debt', 'equity', 'debtService', 'year1Cfads', 'minCfads']) assert.ok(Number.isFinite(r[k]), k);
  for (const line of F.explain(r)) assert.doesNotMatch(line, /e\+|Infinity|NaN/);
});

// ---------- energy-expert review ----------

test('credit sale price: cash = credit x price, face value when the price is not given', () => {
  const face = F.sizeDebt({ ...base, tollPerKwYear: 130, itc: 0.3 });
  assert.equal(face.itcPrice, 1);
  assert.equal(face.itc, 3000);
  const sold = F.sizeDebt({ ...base, tollPerKwYear: 130, itc: 0.3, itcPriceCents: 90 });
  assert.equal(sold.itcFace, 3000);
  near(sold.itc, 2700, 1e-9);
  near(sold.netCapex, 10000 - 2700, 1e-9);
  // The discount does not change cash flow, so DSCR-bound debt is the same and equity carries it.
  near(sold.debt, face.debt, 1e-9);
  near(sold.equity, face.equity + 300, 1e-9);
  assert.match(F.explain(sold).join(' '), /\$3,000 face value\), sold at 90 cents per dollar for \$2,700/);
  const f = field('itcPriceCents');
  assert.equal(f.value, 89.5);
  assert.equal(f.kind, 'sourced');
  assert.match(f.source, /crux\.com/);
  assert.match(f.note, /\$0\.895/);
});

test('ancillary services: counted in merchant and stacked, not toll; fades; default 0 assumption', () => {
  const inp = { ...base, tollPerKwYear: 60, arbPerYear: 100, ancPerKwYear: 20, availability: 0.5 };
  // 20 $/kW-yr x 10 kW x 50% availability = 100
  assert.equal(F.cashFlows({ ...inp, revenueCase: 'toll' }).year1Cfads, 300);
  assert.equal(F.cashFlows({ ...inp, revenueCase: 'merchant' }).year1Cfads, 50 + 100);
  assert.equal(F.cashFlows({ ...inp, revenueCase: 'stacked' }).year1Cfads, 300 + 50 + 100);
  const cf = F.cashFlows({ ...inp, revenueCase: 'merchant', degradation: 0.1 });
  near(cf.years[1].anc, 90, 1e-9);
  const f = field('ancPerKwYear');
  assert.equal(f.value, 0);
  assert.equal(f.kind, 'assumption');
  assert.match(f.source, /ercot\.com\/mktrules\/pilots\/ader/);
  for (const re of [/ADER/, /Non-Spin/, /ECRS/, /cannot also discharge/]) assert.match(f.note, re);
  // Default 0 leaves the default answer unchanged.
  near(F.sizeDebt(defaultInputs()).debt, F.sizeDebt(defaultInputs({ ancPerKwYear: 0 })).debt, 1e-9);
  assert.ok(F.sizeDebt(defaultInputs({ ancPerKwYear: 20 })).debt > F.sizeDebt(defaultInputs()).debt);
});

test('copy: cost basis label, location pricing, export and ADER, depreciation', () => {
  const cap = field('capexPerKwh');
  assert.match(cap.label, /cost basis/);
  assert.match(cap.note, /may include Base's margin/);
  assert.match(field('upfront').note, /vary by address/);
  const html = fs.readFileSync(path.join(__dirname, '../finance.html'), 'utf8');
  assert.match(html, /ercot\.com\/mktrules\/pilots\/ader/);
  assert.match(html, /export earns the load-zone price only if/);
  assert.match(html, /<strong>Depreciation<\/strong> is not modeled/);
  assert.doesNotMatch(html, /at face value/);
  assert.match(F.explain(F.sizeDebt(defaultInputs())).join(' '), /ADER aggregation/);
});
