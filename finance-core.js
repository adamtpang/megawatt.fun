/* Battery debt financing: pure math, no DOM.
   Used by finance.js in the browser (window.FinanceCore), api/v1/finance.js and the Node tests.
   Every input is passed in. This is a generic model of one leased home battery, not any company's books. */
(function (root) {
  'use strict';

  // Inputs the page shows as percents. normalize() turns them into fractions.
  const PERCENT_FIELDS = ['availabilityPct', 'degradationPct', 'ratePct', 'advancePct', 'itcPct'];

  // Which revenue lines count toward cash flow in each revenue case.
  // A tolled battery usually hands dispatch (and so the arbitrage) to the buyer of the toll,
  // so counting both is an upper bound that double counts the same kWh.
  const CASES = {
    toll: { toll: true, arb: false, label: 'Tolled to a utility' },
    merchant: { toll: false, arb: true, label: 'Merchant in ERCOT' },
    stacked: { toll: true, arb: true, label: 'Stacked (upper bound)' },
  };

  // Limits for the special keys that are not fields in finance-defaults.json.
  const ARB_MAX = 100000;

  const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
  const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);
  const nonNeg = (x) => Math.max(0, num(x));

  // Plain decimal numbers only: "12", "-3.5", ".5", "1e3". Strips $ , % and spaces first
  // (spreadsheet cells). Hex ("0x10"), binary, "Infinity" and blanks are NaN.
  const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  function parseDecimal(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v !== 'string') return NaN;
    const t = v.replace(/[$,%\s]/g, '');
    if (!DECIMAL.test(t)) return NaN;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }

  // Why a value is not allowed for field f, or null when it is fine.
  function fieldError(f, v) {
    if (!Number.isFinite(v)) return 'must be a number';
    if (f.integer && !Number.isInteger(v)) return 'must be a whole number';
    if (f.min != null && v < f.min) return 'must be at least ' + f.min;
    if (f.max != null && v > f.max) return 'must be at most ' + f.max;
    return null;
  }

  const fieldList = (defaults) => defaults.groups.flatMap((g) => g.fields);

  /* The page's form check, the same rules the API applies to a file.
     raw: { key: string as typed }. A blank keeps the field's current default.
     Returns { values: { key: number }, errors: { key: message } }. */
  function validateFields(defaults, raw) {
    const values = {}, errors = {};
    for (const f of fieldList(defaults)) {
      const s = has(raw, f.key) ? raw[f.key] : '';
      if (s == null || String(s).trim() === '') { values[f.key] = f.value; continue; }
      const v = parseDecimal(String(s));
      const why = Number.isFinite(v) ? fieldError(f, v) : 'must be a plain decimal number';
      if (why) errors[f.key] = f.label + ' ' + why + '.';
      else values[f.key] = v;
    }
    return { values, errors };
  }

  // Present value of 1 per year for `years` years at `rate`, payments at year end.
  function annuityFactor(rate, years) {
    const n = Math.floor(nonNeg(years));
    if (n <= 0) return 0;
    if (Math.abs(rate) < 1e-12) return n;
    return (1 - Math.pow(1 + rate, -n)) / rate;
  }

  // Level annual payment that pays off `principal` over `years` at `rate`.
  function annuityPayment(principal, rate, years) {
    const f = annuityFactor(rate, years);
    return f > 0 ? principal / f : 0;
  }

  // Raw page values (percents, strings) to model values (fractions, numbers).
  function normalize(raw) {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === '__proto__') continue;
      if (typeof v === 'string' && !Number.isFinite(Number(v))) { out[k] = v; continue; }
      out[k] = num(v);
    }
    for (const k of PERCENT_FIELDS) {
      if (has(out, k)) out[k.replace(/Pct$/, '')] = out[k] / 100;
    }
    return out;
  }

  // Cash flow available for debt service (CFADS), per battery, every year of its life.
  function cashFlows(inp) {
    const caseId = has(CASES, inp.revenueCase) ? inp.revenueCase : 'toll';
    const kase = CASES[caseId];
    const kwh = nonNeg(inp.kwh), kw = nonNeg(inp.kw);
    const capex = nonNeg(inp.capexPerKwh) * kwh;
    const upfront = Math.min(nonNeg(inp.upfront), capex);
    // Investment tax credit (IRC 48E), treated as cash at placed-in-service: sold at face value
    // under IRC 6418 (transfer). It lowers what debt and equity must fund.
    const itcRate = Math.min(1, nonNeg(inp.itc));
    const itc = itcRate * capex;
    const netCapex = Math.max(0, capex - upfront - itc);
    const availability = Math.min(1, nonNeg(inp.availability ?? 1));
    const deg = Math.min(1, nonNeg(inp.degradation));
    const life = Math.max(1, Math.floor(nonNeg(inp.lifeYears) || 1));

    // Year 1 value of each line, before the revenue case decides what counts.
    const full = {
      member: nonNeg(inp.memberFeeMonthly) * 12,
      retail: num(inp.retailMarginMonthly) * 12,
      toll: nonNeg(inp.tollPerKwYear) * kw * availability,
      arb: nonNeg(inp.arbPerYear) * availability,
    };
    const counted = {
      member: full.member,
      retail: full.retail,
      toll: kase.toll ? full.toll : 0,
      arb: kase.arb ? full.arb : 0,
    };
    const opex = nonNeg(inp.opexPerYear);

    const years = [];
    for (let t = 1; t <= life; t++) {
      const fade = Math.pow(1 - deg, t - 1); // degradation hits dispatch value, not member fees
      const row = {
        year: t,
        member: counted.member,
        retail: counted.retail,
        toll: counted.toll * fade,
        arb: counted.arb * fade,
        opex,
      };
      row.revenue = row.member + row.retail + row.toll + row.arb;
      row.cfads = row.revenue - opex;
      years.push(row);
    }
    return { caseId, caseLabel: kase.label, capex, upfront, itcRate, itc, netCapex, full, counted, opex, life, years, year1Cfads: years[0].cfads };
  }

  /* Size the loan the way a lender does: level debt service, sized so the weakest year
     still covers it by the target DSCR, then capped by an advance rate on cost and by
     the net cost (cost minus the member payment and the tax credit).
     binding: 'dscr' cash flow limits it, 'advance' the advance rate, 'cost' the net cost,
     'none' the weakest year has no cash after operating cost. */
  function sizeDebt(inp) {
    const cf = cashFlows(inp);
    const rate = num(inp.rate);
    const wantTenor = Math.max(1, Math.floor(nonNeg(inp.tenorYears) || 1));
    const tenor = Math.min(wantTenor, cf.life);
    const dscr = Math.max(0.01, num(inp.dscr, 1));
    const inTenor = cf.years.slice(0, tenor);
    const minCfads = Math.min(...inTenor.map((y) => y.cfads));
    const allowedPayment = Math.max(0, minCfads) / dscr;
    const dscrDebt = allowedPayment * annuityFactor(rate, tenor);
    const advanceCap = Math.min(1, nonNeg(inp.advance)) * cf.capex;
    const cap = Math.min(advanceCap, cf.netCapex);
    const capKind = advanceCap < cf.netCapex ? 'advance' : 'cost';

    let debt, binding;
    if (minCfads <= 0) { debt = 0; binding = 'none'; }
    else if (dscrDebt <= cap && cap > 0) { debt = dscrDebt; binding = 'dscr'; }
    else { debt = cap; binding = capKind; }

    const debtService = annuityPayment(debt, rate, tenor);
    const equity = Math.max(0, cf.netCapex - debt);
    return {
      ...cf, rate, tenor, tenorClamped: tenor < wantTenor, dscrTarget: dscr,
      minCfads, allowedPayment, dscrDebt, advanceCap, cap, debt, binding,
      debtService, equity,
      minDscr: debtService > 0 ? minCfads / debtService : null,
      debtPctCapex: cf.capex > 0 ? debt / cf.capex : 0,
    };
  }

  // One line for the "Binding limit" notice. Same text on the page and in the API.
  function bindingText(r) {
    if (r.binding === 'none') return 'No debt: the weakest year has no cash left after operating cost.';
    if (r.binding === 'dscr') return 'Binding limit: cash flow (DSCR). More revenue or a cheaper loan raises the debt.';
    if (r.binding === 'advance') {
      return r.advanceCap > 0
        ? 'Binding limit: advance rate on cost. Extra revenue does not raise the debt until the cap moves.'
        : 'No debt: the advance rate is 0%, so the lender lends nothing.';
    }
    return r.netCapex > 0
      ? 'Binding limit: net cost. The loan covers everything the member payment and the tax credit do not.'
      : 'No debt needed: the member payment and the tax credit cover the whole installed cost.';
  }

  function fleet(r, count) {
    const n = nonNeg(count);
    return { count: n, capex: r.capex * n, upfront: r.upfront * n, itc: r.itc * n, debt: r.debt * n, equity: r.equity * n, debtService: r.debtService * n, year1Cfads: r.year1Cfads * n };
  }

  // Batteries needed for a fleet of `mw` megawatts at `kw` per battery.
  function batteriesForMw(mw, kw) {
    return kw > 0 ? Math.ceil((nonNeg(mw) * 1000) / kw) : 0;
  }

  // Debt per battery across tolling prices (rows) and interest rates (columns, fractions).
  function sensitivity(inp, tolls, rates) {
    return tolls.map((toll) => ({
      toll,
      cells: rates.map((rate) => {
        const r = sizeDebt({ ...inp, tollPerKwYear: toll, rate });
        return { rate, debt: r.debt, binding: r.binding };
      }),
    }));
  }

  const LINE_NAMES = { member: 'member fees', retail: 'retail energy margin', toll: 'the utility toll', arb: 'energy arbitrage' };
  // Where each revenue line's default comes from. The toll and retail margin are placeholders.
  const LINE_BASIS = { member: 'sourced', retail: 'assumption', toll: 'assumption', arb: 'sourced' };

  /* Plain-words summary of what carries the debt and what limits it. Each line matches
     r.binding, so the text never says cash flow is too small when it is not. */
  function explain(r) {
    const out = [];
    const lines = Object.entries(r.counted).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const total = lines.reduce((s, [, v]) => s + v, 0);
    const driver = () => {
      if (!lines.length) return;
      const [topName, topVal] = lines[0];
      const share = pct(topVal / total);
      const basis = LINE_BASIS[topName] === 'assumption'
        ? ' That input is a labeled assumption, not a public number, so the answer is only as good as it is.'
        : ' That input is a public number.';
      out.push(`${cap(LINE_NAMES[topName])} ${topName === 'member' ? 'are' : 'is'} the biggest revenue line: ${share} of year 1 revenue.${basis}`);
    };

    if (r.capex <= 0) {
      out.push('Installed cost is $0, so there is nothing to finance.');
      return out;
    }
    if (r.netCapex <= 0) {
      out.push(`Nothing is left to finance: the member pays ${usd(r.upfront)} and the tax credit is worth ${usd(r.itc)}, which together cover the ${usd(r.capex)} installed cost.`);
      return out;
    }
    if (r.binding === 'none') {
      out.push(`On these numbers a lender would lend nothing: the weakest year in the loan term has ${usd(r.minCfads)} of cash flow after operating cost, so nothing is left to repay a loan. The whole net cost is equity.`);
      driver();
      return out;
    }
    if (r.debt <= 0) {
      out.push('On these numbers a lender would lend nothing: the advance rate is 0%. The whole net cost is equity.');
      return out;
    }
    driver();
    const ds = r.debtService;
    out.push(`Energy arbitrage alone, in this zone, would cover ${pct(r.full.arb / ds)} of the yearly loan payment${r.counted.arb > 0 ? '' : ' (it does not count in this revenue case)'}.`);
    out.push(`Member fees alone cover ${pct(r.full.member / ds)} of it.`);
    if (r.itc > 0) out.push(`The tax credit, ${pct(r.itcRate)} of cost (${usd(r.itc)}), lowers what debt and equity must fund. It adds no yearly cash, so it does not raise the debt that cash flow can carry.`);
    if (r.binding === 'dscr') out.push(`Cash flow limits the loan, not the asset value. The loan is ${pct(r.debtPctCapex)} of cost, below the advance cap.`);
    else if (r.binding === 'advance') out.push('The advance rate limits the loan. Cash flow could support more, so more revenue does not raise the debt here.');
    else if (r.binding === 'cost') out.push('The loan already covers the full net cost after the member payment and the tax credit.');
    return out;
  }

  function pct(x) {
    if (!Number.isFinite(x)) return 'n/a';
    if (x > 10) return 'more than 1,000%';
    return `${Math.round(x * 100)}%`;
  }
  function usd(x) { return Number.isFinite(x) ? `${x < 0 ? '-' : ''}$${Math.round(Math.abs(x)).toLocaleString('en-US')}` : 'n/a'; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* A company's own inputs on top of the public defaults. parsed is
     { kind: 'csv', data: [{ key, value }] } or { kind: 'json', data: { key: value } | { inputs: {...} } | [{ key, value }] }.
     Special keys: revenueCase, zone, arbPerYear (own arbitrage $/battery/yr, replaces the zone).
     Every lookup is by own key only, so "__proto__", "constructor" and the like are unknown keys. */
  function applyOverrides(defaults, parsed, zoneIds) {
    const errors = [], warnings = [], changed = [];
    const d = JSON.parse(JSON.stringify(defaults));
    const byKey = new Map(fieldList(d).map((f) => [f.key, f]));
    const publicValue = new Map(fieldList(defaults).map((f) => [f.key, f.value]));
    const cases = Object.keys(CASES);
    let pairs;
    const data = parsed && parsed.data;
    if (Array.isArray(data)) pairs = data.map((r, i) => ({ key: r && has(r, 'key') ? r.key : null, value: r && has(r, 'value') ? r.value : null, line: i + 2 }));
    else if (data && typeof data === 'object') {
      const src = has(data, 'inputs') && data.inputs && typeof data.inputs === 'object' ? data.inputs : data;
      pairs = Object.keys(src).map((key) => ({ key, value: src[key] }));
    } else pairs = [];
    if (!pairs.length) errors.push('No rows found. The file needs key and value columns (CSV) or a key: value object (JSON).');
    let revenueCase = null, zone = null, arbPerYear = null;
    for (const p of pairs) {
      const where = p.line ? 'Row ' + p.line + ': ' : '';
      const key = String(p.key == null ? '' : p.key).trim();
      if (!key) { errors.push(where + 'missing key.'); continue; }
      const isSpecial = key === 'revenueCase' || key === 'zone' || key === 'arbPerYear';
      if (!isSpecial && !byKey.has(key)) { errors.push(where + 'unknown key "' + key + '". Download the template for the full list.'); continue; }
      if (p.value !== null && typeof p.value === 'object') { errors.push(where + key + ' must be a single value, not a list or object.'); continue; }
      if (String(p.value == null ? '' : p.value).trim() === '') { warnings.push(where + key + ' is blank, so the public value stays.'); continue; }
      if (key === 'revenueCase') {
        if (!cases.includes(String(p.value).trim())) errors.push(where + 'revenueCase must be one of ' + cases.join(', ') + '.');
        else revenueCase = String(p.value).trim();
        continue;
      }
      if (key === 'zone') {
        if (!zoneIds.includes(String(p.value).trim())) errors.push(where + 'zone must be one of ' + zoneIds.join(', ') + '.');
        else zone = String(p.value).trim();
        continue;
      }
      const v = parseDecimal(p.value);
      if (!Number.isFinite(v)) { errors.push(where + key + ' is not a number: "' + p.value + '". Use plain decimal digits.'); continue; }
      if (key === 'arbPerYear') {
        if (v < 0) errors.push(where + 'arbPerYear cannot be negative.');
        else if (v > ARB_MAX) errors.push(where + 'arbPerYear must be at most ' + ARB_MAX + '.');
        else arbPerYear = v;
        continue;
      }
      const f = byKey.get(key);
      const why = fieldError(f, v);
      if (why) { errors.push(where + key + ' ' + why + '.'); continue; }
      // A value equal to the public one keeps its source and tag.
      if (v === publicValue.get(key)) continue;
      changed.push(key);
      f.value = v; f.kind = 'yours'; f.note = 'Your file. Public default was ' + publicValue.get(key) + ' ' + f.unit + '.';
      delete f.source;
    }
    if (revenueCase) d.revenueCaseDefault = revenueCase;
    if (zone) d.zoneDefault = zone;
    return { defaults: d, errors, warnings, changed, arbPerYear };
  }

  // Template rows: every field with its public value, plus the special keys.
  function templateRows(defaults) {
    const rows = fieldList(defaults).map((f) => ({ key: f.key, value: f.value, unit: f.unit, label: f.label, public_basis: f.kind }));
    rows.push({ key: 'revenueCase', value: defaults.revenueCaseDefault, unit: Object.keys(CASES).join(' | '), label: 'Revenue case', public_basis: 'assumption' });
    rows.push({ key: 'zone', value: defaults.zoneDefault, unit: 'ERCOT load zone', label: 'Arbitrage zone', public_basis: 'sourced' });
    rows.push({ key: 'arbPerYear', value: '', unit: '$/battery/yr', label: 'Your own arbitrage value (leave blank to use the zone)', public_basis: '' });
    return rows;
  }

  const api = { applyOverrides, templateRows, validateFields, parseDecimal, fieldError, bindingText, PERCENT_FIELDS, CASES, ARB_MAX, annuityFactor, annuityPayment, normalize, cashFlows, sizeDebt, fleet, batteriesForMw, sensitivity, explain };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FinanceCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
