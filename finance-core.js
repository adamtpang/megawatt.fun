/* Battery debt financing: pure math, no DOM.
   Used by finance.js in the browser (window.FinanceCore) and tests/finance.test.cjs in Node.
   Every input is passed in. Nothing here knows Base's real financing terms; those are not public. */
(function (root) {
  'use strict';

  // Inputs the page shows as percents. normalize() turns them into fractions.
  const PERCENT_FIELDS = ['availabilityPct', 'degradationPct', 'ratePct', 'advancePct'];

  // Which revenue lines count toward cash flow in each revenue case.
  // A tolled battery usually hands dispatch (and so the arbitrage) to the buyer of the toll,
  // so counting both is an upper bound that double counts the same kWh.
  const CASES = {
    toll: { toll: true, arb: false, label: 'Tolled to a utility' },
    merchant: { toll: false, arb: true, label: 'Merchant in ERCOT' },
    stacked: { toll: true, arb: true, label: 'Stacked (upper bound)' },
  };

  const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);
  const nonNeg = (x) => Math.max(0, num(x));

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
      if (typeof v === 'string' && !Number.isFinite(Number(v))) { out[k] = v; continue; }
      out[k] = num(v);
    }
    for (const k of PERCENT_FIELDS) {
      if (k in out) out[k.replace(/Pct$/, '')] = out[k] / 100;
    }
    return out;
  }

  // Cash flow available for debt service (CFADS), per battery, every year of its life.
  function cashFlows(inp) {
    const kase = CASES[inp.revenueCase] || CASES.toll;
    const kwh = nonNeg(inp.kwh), kw = nonNeg(inp.kw);
    const capex = nonNeg(inp.capexPerKwh) * kwh;
    const upfront = Math.min(nonNeg(inp.upfront), capex);
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
    return { caseId: CASES[inp.revenueCase] ? inp.revenueCase : 'toll', caseLabel: kase.label, capex, upfront, netCapex: capex - upfront, full, counted, opex, life, years, year1Cfads: years[0].cfads };
  }

  // Size the loan the way a lender does: level debt service, sized so the weakest year
  // still covers it by the target DSCR, then capped by an advance rate on capex.
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
    const capKind = advanceCap <= cf.netCapex ? 'advance' : 'cost';

    let debt, binding;
    if (dscrDebt <= 0) { debt = 0; binding = 'none'; }
    else if (dscrDebt <= cap) { debt = dscrDebt; binding = 'dscr'; }
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

  function fleet(r, count) {
    const n = nonNeg(count);
    return { count: n, capex: r.capex * n, upfront: r.upfront * n, debt: r.debt * n, equity: r.equity * n, debtService: r.debtService * n, year1Cfads: r.year1Cfads * n };
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

  // Plain-words summary of what carries the debt.
  function explain(r) {
    const lines = Object.entries(r.counted).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const out = [];
    if (r.debt <= 0) {
      out.push(`On these numbers a lender would lend nothing: the weakest year's cash flow is ${r.minCfads <= 0 ? 'zero or less' : 'too small'}. The whole net cost is equity.`);
      return out;
    }
    if (lines.length) {
      const total = lines.reduce((s, [, v]) => s + v, 0);
      const [topName, topVal] = lines[0];
      out.push(`${cap(LINE_NAMES[topName])} ${topName === 'member' ? 'carry' : 'carries'} the debt: ${pct(topVal / total)} of year 1 revenue.`);
    }
    const ds = r.debtService;
    out.push(`Energy arbitrage alone, in this zone, would cover ${pct(r.full.arb / ds)} of the yearly loan payment${r.counted.arb > 0 ? '' : ' (it does not count in this revenue case)'}.`);
    out.push(`Member fees alone cover ${pct(r.full.member / ds)} of it.`);
    if (r.binding === 'dscr') out.push(`Cash flow limits the loan, not the asset value. The loan is ${pct(r.debtPctCapex)} of capex, below the advance cap.`);
    else if (r.binding === 'advance') out.push('The advance rate limits the loan. Cash flow could support more, so more revenue does not raise the debt here.');
    else if (r.binding === 'cost') out.push('The loan already covers the full net cost after the member payment.');
    return out;
  }

  function pct(x) { return Number.isFinite(x) ? `${Math.round(x * 100)}%` : 'n/a'; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // A company's own inputs on top of the public defaults. parsed is
  // { kind: 'csv', data: [{ key, value }] } or { kind: 'json', data: { key: value } | { inputs: {...} } | [{ key, value }] }.
  // Special keys: revenueCase, zone, arbPerYear (own arbitrage $/battery/yr, replaces the zone).
  function applyOverrides(defaults, parsed, zoneIds) {
    const errors = [], warnings = [], changed = [];
    const d = JSON.parse(JSON.stringify(defaults));
    const byKey = Object.fromEntries(d.groups.flatMap((g) => g.fields).map((f) => [f.key, f]));
    const publicValue = Object.fromEntries(defaults.groups.flatMap((g) => g.fields).map((f) => [f.key, f.value]));
    const cases = Object.keys(CASES);
    let pairs;
    const data = parsed.data;
    if (Array.isArray(data)) pairs = data.map((r, i) => ({ key: r && r.key, value: r && r.value, line: i + 2 }));
    else if (data && typeof data === 'object') pairs = Object.entries(data.inputs || data).map(([key, value]) => ({ key, value }));
    else pairs = [];
    if (!pairs.length) errors.push('No rows found. The file needs key and value columns (CSV) or a key: value object (JSON).');
    const toNum = (v) => typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/[$,%\s]/g, ''));
    let revenueCase = null, zone = null, arbPerYear = null;
    for (const p of pairs) {
      const where = p.line ? 'Row ' + p.line + ': ' : '';
      const key = String(p.key == null ? '' : p.key).trim();
      if (!key) { errors.push(where + 'missing key.'); continue; }
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
      const v = toNum(p.value);
      if (!Number.isFinite(v)) { errors.push(where + key + ' is not a number: "' + p.value + '".'); continue; }
      if (key === 'arbPerYear') {
        if (v < 0) errors.push(where + 'arbPerYear cannot be negative.'); else arbPerYear = v;
        continue;
      }
      const f = byKey[key];
      if (!f) { errors.push(where + 'unknown key "' + key + '". Download the template for the full list.'); continue; }
      if (f.min != null && v < f.min) { errors.push(where + key + ' must be at least ' + f.min + '.'); continue; }
      if (f.max != null && v > f.max) { errors.push(where + key + ' must be at most ' + f.max + '.'); continue; }
      if (v !== f.value) changed.push(key);
      f.value = v; f.kind = 'yours'; f.note = 'Your file. Public default was ' + publicValue[key] + ' ' + f.unit + '.';
      delete f.source;
    }
    if (revenueCase) d.revenueCaseDefault = revenueCase;
    if (zone) d.zoneDefault = zone;
    return { defaults: d, errors, warnings, changed, arbPerYear };
  }

  // Template rows: every field with its public value, plus the special keys.
  function templateRows(defaults) {
    const rows = defaults.groups.flatMap((g) => g.fields).map((f) => ({ key: f.key, value: f.value, unit: f.unit, label: f.label, public_basis: f.kind }));
    rows.push({ key: 'revenueCase', value: defaults.revenueCaseDefault, unit: Object.keys(CASES).join(' | '), label: 'Revenue case', public_basis: 'assumption' });
    rows.push({ key: 'zone', value: defaults.zoneDefault, unit: 'ERCOT load zone', label: 'Arbitrage zone', public_basis: 'sourced' });
    rows.push({ key: 'arbPerYear', value: '', unit: '$/battery/yr', label: 'Your own arbitrage value (leave blank to use the zone)', public_basis: '' });
    return rows;
  }

  const api = { applyOverrides, templateRows, PERCENT_FIELDS, CASES, annuityFactor, annuityPayment, normalize, cashFlows, sizeDebt, fleet, batteriesForMw, sensitivity, explain };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FinanceCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
