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
  near(r.capex, 1290 * 39.2, 1e-9);
  assert.ok(r.debt > 0 && r.debt <= r.cap);
  near(r.itcFace, 0.3 * r.capex, 1e-9);
  near(r.itc, 0.3 * r.capex * 0.895, 1e-9);
  near(r.equity, r.capex - raw.upfront - r.itc - r.debt, 1e-6);
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
  // The first explain line names the biggest line and where its number comes from.
  assert.match(F.explain(a, { basis: F.lineBasis(DEF, null) })[0], /^Retail energy margin is the biggest revenue line.*derived from public data with one labeled assumption/);
  // In the toll case the toll drives it, and the text says it is an assumption.
  const t = F.sizeDebt(defaultInputs({ revenueCase: 'toll' }));
  assert.match(F.explain(t)[0], /^The utility toll is the biggest revenue line.*labeled assumption/);
});

test('retail margin default is derived from public statewide data: the shown math reproduces the value', () => {
  const f = field('retailMarginMonthly');
  assert.equal(f.kind, 'assumption'); // one input (other supply cost) is a labeled assumption
  assert.match(f.source, /eia\.gov\/electricity\/data\/eia861/);
  // (REP retail price - delivery - load-weighted wholesale - other supply cost) x kWh a month, in dollars.
  const retail = 16.66, delivery = 5.21, wholesale = 3.70, other = 2.0, kwh = 1097;
  near((retail - delivery - wholesale - other) * kwh / 100, 63.08, 0.01);
  assert.equal(f.value, Math.round((retail - delivery - wholesale - other) * kwh / 100));
  for (const re of [/16\.66 cents\/kWh/, /5\.21 cents\/kWh/, /3\.70 cents\/kWh/, /2\.0 cents\/kWh, an assumption/, /1,097 kWh/, /EIA-861/, /\$63\.08/, /gross margin/, /set it to 0 for a third-party owner/, /LZ_AEN, LZ_CPS, LZ_LCRA, LZ_RAYBN/]) assert.match(f.note, re);
  // No Base figure in the generic default.
  assert.doesNotMatch(f.note + f.source, /Base|bpc-web-static/);
});

test('retail margin: counts toward debt, and $0 says it is left out', () => {
  const r = F.sizeDebt(defaultInputs());
  near(r.counted.retail, 63 * 12, 1e-9);
  near(r.debtPctCapex, 0.1419, 0.0005);
  const opts = { retailDefault: field('retailMarginMonthly').value };
  assert.match(F.explain(r, opts).join(' '), /Retail energy margin adds \$756 a year.*only to an owner that is also the home's retail provider, where retail choice exists.*gross margin/);
  const zero = F.sizeDebt(defaultInputs({ retailMarginMonthly: 0 }));
  assert.ok(zero.debt < r.debt);
  const text = F.explain(zero, opts).join(' ');
  assert.match(text, /Retail energy margin is \$0 here, so this answer leaves out what a retail provider normally earns/);
  assert.match(text, new RegExp('\\$' + field('retailMarginMonthly').value + ' a month'));
  // Without the option the text still points at the input note.
  assert.match(F.explain(zero).join(' '), /the derived default in the input note/);
  // No debt at all still says the margin is left out.
  const none = F.sizeDebt(defaultInputs({ retailMarginMonthly: 0, memberFeeMonthly: 0, opexPerYear: 5000 }));
  assert.equal(none.binding, 'none');
  assert.match(F.explain(none).join(' '), /leaves out what a retail provider/);
  // Negative margin is named, not hidden.
  assert.match(F.explain(F.sizeDebt(defaultInputs({ retailMarginMonthly: -5 }))).join(' '), /Retail energy margin is negative/);
});

test('export settlement copy cites the Protocols and splits owner cases', () => {
  const t = F.EXPORT_TEXT;
  for (const re of [/11\.4\.4\.3/, /6\.6\.3\.2/, /1 MW or less/, /home's retail provider/, /no ADER aggregation/, /third-party owner/, /ancillary services/]) assert.match(t, re);
  assert.doesNotMatch(t, /only if the battery is in an ERCOT ADER aggregation/);
  const r = F.sizeDebt(defaultInputs());
  assert.ok(F.explain(r).includes(t));
  // Not shown when arbitrage does not count.
  assert.ok(!F.explain(F.sizeDebt(defaultInputs({ revenueCase: 'toll' }))).includes(t));
});

test('tax credit: bridge-loan simplification is stated, and $0 equity always has a note', () => {
  const r = F.sizeDebt(defaultInputs());
  assert.match(F.explain(r).join(' '), /bridge loan repaid when the credit sells/);
  assert.match(F.BRIDGE_TEXT, /advance rate on the full cost/);
  // The advance cap uses the full installed cost, not cost net of the credit.
  near(r.advanceCap, 0.7 * r.capex, 1e-9);
  // Net-cost cap binds: equity 0, and both the binding line and explain say why.
  const big = F.sizeDebt(defaultInputs({ retailMarginMonthly: 1000, upfront: 5000 }));
  assert.equal(big.binding, 'cost');
  assert.equal(big.equity, 0);
  assert.match(F.bindingText(big), /equity is \$0/);
  const text = F.explain(big).join(' ');
  assert.match(text, /so equity is \$0/);
  assert.ok(text.includes(F.EQUITY_ZERO_TEXT));
  // Sweep: whenever equity is 0 with something to finance, a line says so.
  for (const m of [0, 50, 100, 200, 400, 800]) for (const adv of [50, 70, 90, 100]) {
    const x = F.sizeDebt(defaultInputs({ retailMarginMonthly: m, advancePct: adv }));
    if (x.equity <= 0 && x.netCapex > 0) assert.match(F.explain(x).join(' ') + F.bindingText(x), /equity is \$0/, `margin ${m} advance ${adv}`);
  }
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
  assert.equal(F.parseDecimal('1,234,567.5'), 1234567.5);
  assert.equal(F.parseDecimal('-1,200'), -1200);
  // A comma is only a thousands separator: never 3,5 = 35 or $2,80% = 280.
  for (const bad of ['3,5', '$2,80%', '1,0000', '12,34,567', ',5', '1,', '1,200,5', '+1,200']) {
    assert.ok(Number.isNaN(F.parseDecimal(bad)), bad);
    assert.equal(F.badComma(bad), true, bad);
  }
  assert.equal(F.badComma('3,5'), true);
  assert.equal(F.badComma('1,200'), false);
  assert.equal(F.badComma('35'), false);
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
  assert.equal(blank.values.capexPerKwh, 1290);
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
  assert.match(cap.note, /NREL/);
  // Base's figures and their caveats now live in the optional preset.
  const P = Object.fromEntries(DEF.presets.base_published.values.map((v) => [v.key, v]));
  assert.match(P.capexPerKwh.note, /may include Base's margin/);
  assert.match(P.upfront.note, /vary by address/);
  const html = fs.readFileSync(path.join(__dirname, '../finance.html'), 'utf8');
  assert.match(html, /ercot\.com\/mktrules\/pilots\/ader/);
  assert.doesNotMatch(html, /export earns the load-zone price only if/);
  for (const re of [/Who keeps the export value/, /\(a\) The owner is the home's retail provider/, /\(b\) The owner is a third party/, /\(c\) <a href="https:\/\/www\.ercot\.com\/mktrules\/pilots\/ader">/, /11\.4\.4\.3/, /6\.6\.3\.2/, /25\.217\(f\)\(2\)/, /Not settled by these sources/, /bridge loan sized on the credit/]) assert.match(html, re);
  assert.match(html, /<strong>Depreciation<\/strong> is not modeled/);
  assert.doesNotMatch(html, /at face value/);
  assert.match(F.explain(F.sizeDebt(defaultInputs())).join(' '), /no ADER aggregation/);
});

// ---------- review fixes, 2026-11-04: generic defaults, returns, zones, ADER, ITC, comma rule ----------

const HTML = fs.readFileSync(path.join(__dirname, '../finance.html'), 'utf8');
const zoneInputs = (zoneId, over = {}) => {
  const z = ZV.zones.find((x) => x.id === zoneId);
  return defaultInputs(Object.assign({ arbPerYear: z.usdPerYear, zone: z.id, zoneMarket: z.market }, over));
};

test('generic defaults: no Base economics in the default path; Base figures only in a labeled preset', () => {
  const cap = field('capexPerKwh');
  assert.equal(cap.value, 1290);
  assert.equal(cap.kind, 'sourced');
  assert.match(cap.note, /\(\$4\.70 - \$2\.68\) x 8,000 W = \$16,160 for 12\.5 kWh, is \$1,293\/kWh/);
  near((4.70 - 2.68) * 8000 / 12.5, 1292.8, 1e-9);
  for (const k of ['capexPerKwh', 'upfront', 'memberFeeMonthly', 'retailMarginMonthly', 'availabilityPct']) {
    const f = field(k);
    assert.doesNotMatch(String(f.source || ''), /basepowercompany|bpc-web-static/, k);
    assert.doesNotMatch(f.note, /Base's|Base Core|Base says/, k);
  }
  assert.equal(field('upfront').value, 0);
  assert.equal(field('upfront').kind, 'assumption');
  assert.equal(field('memberFeeMonthly').value, 35);
  assert.equal(field('memberFeeMonthly').kind, 'assumption');
  assert.match(field('memberFeeMonthly').note, /not a market average/);
  const p = DEF.presets.base_published;
  assert.match(p.label, /Base Power's published figures/);
  assert.match(p.about, /public claims .*not Base's economics/);
  const P = F.applyPreset(DEF, 'base_published');
  const pf = (k) => P.groups.flatMap((g) => g.fields).find((f) => f.key === k);
  assert.deepEqual(['capexPerKwh', 'upfront', 'memberFeeMonthly', 'availabilityPct', 'retailMarginMonthly'].map((k) => pf(k).value), [350, 695, 19, 96, 22]);
  for (const k of ['capexPerKwh', 'upfront', 'memberFeeMonthly']) {
    assert.equal(pf(k).kind, 'preset');
    assert.match(pf(k).note, /a public claim, not the company's economics/);
    assert.match(pf(k).source, /basepowercompany\.com/);
  }
  assert.match(pf('retailMarginMonthly').note, /not Base's margin/);
  assert.equal(pf('ratePct').kind, 'assumption'); // untouched fields stay generic
  assert.equal(F.applyPreset(DEF, 'nope'), null);
  assert.equal(field('capexPerKwh').value, 1290); // the generic defaults object is never changed
  // A file can name the preset, and its own rows go on top.
  const r = F.applyOverrides(DEF, { kind: 'csv', data: [{ key: 'capexPerKwh', value: '300' }, { key: 'PRESET', value: 'Base_Published' }] }, ['LZ_NORTH']);
  assert.deepEqual(r.errors, []);
  assert.equal(r.preset, 'base_published');
  assert.deepEqual(r.changed, ['capexPerKwh']);
  const rf = (k) => r.defaults.groups.flatMap((g) => g.fields).find((f) => f.key === k);
  assert.equal(rf('upfront').value, 695);
  assert.match(rf('capexPerKwh').note, /Preset value was 350/);
  assert.match(F.applyOverrides(DEF, { kind: 'json', data: { preset: 'tesla' } }, ['LZ_NORTH']).errors[0], /^preset must be one of base_published/);
  // The template carries a blank preset row and loads back with no change.
  const rows = F.templateRows(DEF);
  assert.ok(rows.some((x) => x.key === 'preset' && x.value === ''));
});

test('returns: NPV, IRR and payback on known flows', () => {
  near(F.npv(0.1, [-100, 110]), 0, 1e-9);
  near(F.irr([-100, 110]), 0.1, 1e-7);
  near(F.irr([-1000, 300, 300, 300, 300]), 0.0771384, 1e-6);
  near(F.irr([-100, 40, 40]), 2 / (Math.sqrt(11) - 1) - 1, 1e-7); // -13.7%: negative IRR when the cash never covers the cost
  assert.equal(F.irr([100, 10]), null);
  assert.equal(F.irr([-100, -10]), null);
  assert.equal(F.payback([-100, 40, 40, 40]), 3);
  assert.equal(F.payback([-100, 40, 40]), null);
  // On the flat test battery: $10,000 cost, $1,300 a year for 10 years.
  const r = F.sizeDebt({ ...base, tollPerKwYear: 130, discount: 0.08 });
  const u = r.returns.unlevered;
  assert.equal(u.invest, 10000);
  assert.equal(u.cashTotal, 13000);
  assert.equal(u.paybackYear, 8);
  near(u.npv, -10000 + 1300 * F.annuityFactor(0.08, 10), 1e-6);
  near(F.npv(u.irr, r.returns.unleveredFlows), 0, 1e-4);
  // Equity: equity in, CFADS minus the payment back.
  const e = r.returns.equity;
  near(e.invest, r.equity, 1e-9);
  near(e.cashTotal, 10 * (1300 - r.debtService), 1e-6);
  // No equity: equity return not defined, and the text says so.
  const z = F.sizeDebt({ ...base, tollPerKwYear: 1000, itc: 0.3, upfront: 1000 });
  assert.equal(z.equity, 0);
  assert.equal(z.returns.equity, null);
  assert.match(F.returnsText(z).join(' '), /equity return is not defined/);
});

test('returns: the generic default does not pay back and says so, with the left-out items', () => {
  const r = F.sizeDebt(defaultInputs());
  const u = r.returns.unlevered;
  assert.equal(r.returns.discountRate, 0.1);
  assert.equal(u.paysBack, false);
  assert.ok(u.cashTotal < r.netCapex);
  assert.ok(u.irr < 0 && u.npv < 0);
  const text = F.returnsText(r);
  assert.match(text[0], /^On these inputs the battery does not pay back: over its 12-year life its cash flow adds up to \$[\d,]+ \(not discounted\), less than the \$[\d,]+ net cost/);
  assert.match(text[0], /unlevered IRR\): -\d+\.\d%\. NPV at 10%: -\$/);
  assert.equal(text[text.length - 1], F.LEFT_OUT_TEXT);
  const ex = F.explain(r);
  assert.equal(ex[1], text[0]); // right after the biggest-line sentence
  // Not tuned: the Base preset reproduces the reviewer's arithmetic and also does not pay back.
  const P = F.applyPreset(DEF, 'base_published');
  const raw = { revenueCase: P.revenueCaseDefault, arbPerYear: ZV.zones.find((z) => z.id === 'LZ_NORTH').usdPerYear };
  for (const f of P.groups.flatMap((g) => g.fields)) raw[f.key] = f.value;
  const b = F.sizeDebt(F.normalize(raw));
  near(b.netCapex, 9341, 1);
  near(b.returns.unlevered.cashTotal, 8860, 1);
  assert.equal(b.returns.unlevered.paysBack, false);
  // When it does pay, the text gives the year.
  const good = F.sizeDebt(defaultInputs({ capexPerKwh: 300, retailMarginMonthly: 100 }));
  assert.equal(good.returns.unlevered.paysBack, true);
  assert.match(F.returnsText(good)[0], /^The battery pays back its \$[\d,]+ net cost in year \d+ of 12/);
  const df = field('discountPct');
  assert.equal(df.value, 10);
  assert.equal(df.kind, 'assumption');
  assert.ok(F.PERCENT_FIELDS.includes('discountPct'));
});

test('zones without retail choice: labeled in the zone file with sources, and finance drops retail and merchant arbitrage', () => {
  const byId = Object.fromEntries(ZV.zones.map((z) => [z.id, z]));
  for (const id of ['LZ_AEN', 'LZ_CPS', 'LZ_LCRA', 'LZ_RAYBN']) assert.equal(byId[id].market, 'utility or co-op', id);
  for (const id of ['LZ_NORTH', 'LZ_HOUSTON', 'LZ_SOUTH', 'LZ_WEST']) assert.equal(byId[id].market, 'retail choice', id);
  assert.match(byId.LZ_AEN.who, /Austin Energy/);
  assert.match(byId.LZ_CPS.who, /CPS Energy/);
  assert.match(byId.LZ_RAYBN.who, /Rayburn/);
  assert.ok(ZV.markets.sources.some((u) => /932NPRR/.test(u)));
  assert.ok(ZV.markets.sources.some((u) => /40\.051/.test(u)) && ZV.markets.sources.some((u) => /41\.051/.test(u)));
  assert.match(ZV.markets.about, /reachable only through a utility partnership|reaches it only through a utility partnership/);
  // The zone script writes the same labels, so a rebuild keeps them.
  const script = fs.readFileSync(path.join(__dirname, '../scripts/zone-value.cjs'), 'utf8');
  for (const z of ZV.zones) assert.ok(script.includes(z.id + ": { market: '" + z.market + "', who: '" + z.who + "' }"), z.id);
  const north = F.sizeDebt(zoneInputs('LZ_NORTH'));
  const aen = F.sizeDebt(zoneInputs('LZ_AEN'));
  assert.equal(aen.noChoice, true);
  assert.equal(aen.counted.retail, 0);
  assert.equal(aen.counted.arb, 0);
  assert.ok(aen.full.arb > 0 && aen.full.retail > 0);
  assert.ok(north.counted.arb > 0 && north.counted.retail > 0);
  const t = F.explain(aen);
  assert.equal(t[0], F.noChoiceText(aen));
  assert.match(t[0], /^LZ_AEN is city-utility or co-op territory .*PURA 40\.051 and 41\.051.*try the toll case\.$/);
  assert.match(t.join(' '), /Retail energy margin is not counted: in LZ_AEN/);
  assert.match(t.join(' '), /it does not count: in this zone it goes to the utility/);
  // The toll case still works there: that is the utility partnership.
  const toll = F.sizeDebt(zoneInputs('LZ_AEN', { revenueCase: 'toll' }));
  assert.ok(toll.counted.toll > 0);
  // The page labels each zone too.
  const page = fs.readFileSync(path.join(__dirname, '../finance.js'), 'utf8');
  assert.match(page, /city utility or co-op, no retail choice/);
  assert.match(page, /raw\.zoneMarket = /);
  assert.match(HTML, /Zones without retail choice/);
  const market = fs.readFileSync(path.join(__dirname, '../market.js'), 'utf8');
  assert.match(market, /Utility or co-op territory/);
  assert.match(market, /reachable only through a utility partnership/);
});

test('arbitrage is labeled derived from public prices with assumptions, never "a public number"', () => {
  const r = F.sizeDebt(defaultInputs({ retailMarginMonthly: 0, memberFeeMonthly: 0 }));
  const first = F.explain(r)[0];
  assert.match(first, /^Energy arbitrage is the biggest revenue line.*derived from public ERCOT prices with assumptions \(a fixed charge and discharge clock, 88% round trip, 20% backup reserve\)/);
  for (const line of F.explain(F.sizeDebt(defaultInputs()))) assert.doesNotMatch(line, /That input is a public number/);
  assert.match(HTML, /Derived from public prices with assumptions/);
  assert.doesNotMatch(HTML, /Energy arbitrage zone <span class="badge badge-green">Sourced data/);
  // Your own arbitrage value is tagged as yours.
  assert.match(F.explain(r, { basis: F.lineBasis(DEF, 400) })[0], /That input is your own number/);
});

test('ADER status is current: Phase 3.2 limits, ECRS subscription, Phase 4 ADESR, each sourced to ERCOT', () => {
  const n = field('ancPerKwYear').note;
  for (const re of [/Phase 3\.2 limits took effect on 2026-02-27/, /500 MW/, /100 MW of Non-Spin and 100 MW of ECRS/, /ECRS fully subscribed/, /Phase 4, proposed for the December 2026 ERCOT board/, /ADESR/, /not eligible for ancillary services/]) assert.match(n, re);
  assert.doesNotMatch(n, /Phase 3 proposed RRS/);
  for (const url of ['10.1-Aggregate-Distributed-Energy-Resource-ADER-Pilot-Project-Phase-3.3.pdf', '14.-ADER-Pilot-Program-Update_04012026.pdf', 'ADER_Phase-4_WMWG_09252026.pdf', '06.-ADER_Phase-4_WMS_10072026.pdf']) assert.ok(HTML.includes(url), url);
  assert.doesNotMatch(HTML, /4\.3-Aggregate-Distributed-Energy-Resource-ADER-Pilot-Project-Phase-3\.pdf/);
});

test('under-1 MW credit: a one-line caveat on single-facility treatment, labeled a risk to check', () => {
  assert.match(F.ITC_PROJECT_TEXT, /^Risk to check:/);
  assert.match(F.ITC_PROJECT_TEXT, /Treas\. Reg\. 1\.48E-3\(c\)\(4\)\(ii\)/);
  assert.match(F.ITC_PROJECT_TEXT, /common ownership, financing and aggregated dispatch/);
  assert.ok(F.explain(F.sizeDebt(defaultInputs())).some((l) => l.includes(F.ITC_PROJECT_TEXT)));
  assert.match(field('itcPct').note, /Risk to check, not a conclusion/);
  assert.match(HTML, /a risk to check with tax counsel, not a conclusion/);
});

test('comma rule: a comma is only a thousands separator, on the page form and in a file', () => {
  const v = F.validateFields(DEF, { ratePct: '3,5', capexPerKwh: '1,200', upfront: '$2,80%' });
  assert.equal(v.values.capexPerKwh, 1200);
  assert.match(v.errors.ratePct, /^Interest rate is not a number: "3,5"\. A comma is only a thousands separator \(1,200\)\. Use a dot for decimals: 3\.5, not 3,5\.$/);
  assert.match(v.errors.upfront, /is not a number: "\$2,80%"/);
  const r = F.applyOverrides(DEF, { kind: 'csv', data: [{ key: 'ratePct', value: '8,5' }, { key: 'kwh', value: '1,000' }] }, ['LZ_NORTH']);
  assert.deepEqual(r.errors, ['Row 2: ratePct is not a number: "8,5". ' + F.COMMA_HINT]);
  const ok = F.applyOverrides(DEF, { kind: 'json', data: { kwh: '1,000', fleetCount: '2,500' } }, ['LZ_NORTH']);
  assert.deepEqual(ok.errors, []);
});

test('a value column written twice is reported once', () => {
  const data = [{ key: 'ratePct', value: '9' }];
  data.headers = ['key', 'value', 'value'];
  data.duplicateHeaders = ['value'];
  assert.deepEqual(F.applyOverrides(DEF, { kind: 'csv', data }, ['LZ_NORTH']).errors, ['Column "value" appears more than once. Keep one.']);
});
