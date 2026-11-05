/* Battery debt financing: pure math, no DOM.
   Used by finance.js in the browser (window.FinanceCore), api/v1/finance.js and the Node tests.
   Every input is passed in. This is a generic model of one leased home battery, not any company's books. */
(function (root) {
  'use strict';

  // Inputs the page shows as percents. normalize() turns them into fractions.
  const PERCENT_FIELDS = ['availabilityPct', 'degradationPct', 'ratePct', 'advancePct', 'itcPct'];

  // Which revenue lines count toward cash flow in each revenue case.
  // A tolled battery usually hands dispatch (and so the arbitrage and any ancillary
  // services) to the buyer of the toll, so counting both is an upper bound that double
  // counts the same kWh. anc: ERCOT ancillary services through an ADER aggregation. Its
  // input is the value left after the arbitrage it displaces, so adding it to arbitrage
  // does not sell the same kWh twice.
  const CASES = {
    toll: { toll: true, arb: false, anc: false, label: 'Tolled to a utility' },
    merchant: { toll: false, arb: true, anc: true, label: 'Merchant in ERCOT' },
    stacked: { toll: true, arb: true, anc: true, label: 'Stacked (upper bound)' },
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

  // A number written in plain decimal digits that is too big to store (1e400 becomes Infinity).
  // Reported as out of range, not as "not a number".
  function isHuge(v) {
    if (typeof v === 'number') return v === Infinity || v === -Infinity;
    if (typeof v !== 'string') return false;
    const t = v.replace(/[$,%\s]/g, '');
    return DECIMAL.test(t) && !Number.isFinite(Number(t));
  }
  const rangeText = (f) => (f.min != null && f.max != null ? ' Allowed: ' + f.min + ' to ' + f.max + '.' : '');

  // Why a value is not allowed for field f, or null when it is fine.
  function fieldError(f, v) {
    if (!Number.isFinite(v)) return 'must be a number';
    if (f.integer && !Number.isInteger(v)) return 'must be a whole number';
    if (f.min != null && v < f.min) return 'must be at least ' + f.min;
    if (f.max != null && v > f.max) return 'must be at most ' + f.max;
    return null;
  }

  const fieldList = (defaults) => defaults.groups.flatMap((g) => g.fields);
  // Keys a file may set that are not fields in finance-defaults.json.
  const SPECIAL_KEYS = ['revenueCase', 'zone', 'arbPerYear'];
  // Columns of the CSV template. Others are ignored with a warning.
  const FILE_COLUMNS = ['key', 'value', 'unit', 'label', 'public_basis'];

  // Text echoed in a message, cut so a huge cell never comes back whole.
  function clip(v, n) { const t = String(v == null ? '' : v); const m = n || 40; return t.length > m ? t.slice(0, m) + '...' : t; }
  // NUL bytes or the replacement character: a binary file read as text.
  function looksBinary(t) { return /[\u0000\uFFFD]/.test(t); }
  // Edit distance with an early stop, for "Did you mean" on an unknown key.
  function lev(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > limit) return limit + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  // The known key closest to word (ignoring case, spaces, - and _), or null when none is close.
  function closest(word, known) {
    const norm = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, '');
    const w = norm(word);
    if (!w || w.length > 60) return null;
    let best = null, bestD = Infinity;
    for (const k of known) { const dd = lev(w, norm(k), 3); if (dd < bestD) { bestD = dd; best = k; } }
    return best != null && bestD <= Math.max(1, Math.min(3, Math.floor(w.length / 3))) ? best : null;
  }

  /* The page's form check, the same rules the API applies to a file.
     raw: { key: string as typed }. A blank keeps the field's current default.
     Returns { values: { key: number }, errors: { key: message } }. */
  function validateFields(defaults, raw) {
    const values = {}, errors = {};
    for (const f of fieldList(defaults)) {
      const s = has(raw, f.key) ? raw[f.key] : '';
      if (s == null || String(s).trim() === '') { values[f.key] = f.value; continue; }
      const v = parseDecimal(String(s));
      const why = Number.isFinite(v) ? fieldError(f, v) : isHuge(String(s)) ? 'is out of range: "' + String(s).trim() + '" is too large' : 'must be a plain decimal number';
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
    // Investment tax credit (IRC 48E), treated as cash at placed-in-service: sold under
    // IRC 6418 (transfer) at itcPriceCents per dollar of credit (face value when not given).
    // The cash lowers what debt and equity must fund.
    const itcRate = Math.min(1, nonNeg(inp.itc));
    const itcFace = itcRate * capex;
    const itcPrice = inp.itcPriceCents == null ? 1 : Math.min(1, nonNeg(inp.itcPriceCents) / 100);
    const itc = itcFace * itcPrice;
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
      anc: nonNeg(inp.ancPerKwYear) * kw * availability,
    };
    const counted = {
      member: full.member,
      retail: full.retail,
      toll: kase.toll ? full.toll : 0,
      arb: kase.arb ? full.arb : 0,
      anc: kase.anc ? full.anc : 0,
    };
    const opex = nonNeg(inp.opexPerYear);

    const years = [];
    for (let t = 1; t <= life; t++) {
      const fade = Math.pow(1 - deg, t - 1); // degradation hits dispatch value (toll, arbitrage, reserves), not member fees
      const row = {
        year: t,
        member: counted.member,
        retail: counted.retail,
        toll: counted.toll * fade,
        arb: counted.arb * fade,
        anc: counted.anc * fade,
        opex,
      };
      row.revenue = row.member + row.retail + row.toll + row.arb + row.anc;
      row.cfads = row.revenue - opex;
      years.push(row);
    }
    return { caseId, caseLabel: kase.label, capex, upfront, itcRate, itcFace, itcPrice, itc, netCapex, full, counted, opex, life, years, year1Cfads: years[0].cfads };
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
      ? 'Binding limit: net cost. The loan covers everything the member payment and the tax credit do not, so equity is $0. That rests on counting the tax-credit cash on day one; see the tax credit line below.'
      : 'No debt needed: the member payment and the tax credit cover the whole installed cost.';
  }

  function fleet(r, count) {
    const n = nonNeg(count);
    return { count: n, capex: r.capex * n, upfront: r.upfront * n, itc: r.itc * n, itcFace: r.itcFace * n, debt: r.debt * n, equity: r.equity * n, debtService: r.debtService * n, year1Cfads: r.year1Cfads * n };
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

  /* Who keeps the arbitrage value, per the current ERCOT Nodal Protocols (read 2026-11-04).
     Section 2: a Distributed Generator includes an Energy Storage System, and one of 1 MW or less
     not registered for Settlement is an Unregistered Distributed Generator (UDG). Section 11.4.4.3:
     the Adjusted Metered Load (AML) of a premise with a UDG is reduced by its metered outflow
     (15-minute AMS data when available). Section 6.6.3.2(1)(g): a QSE's AML at a Load Zone settles
     at the real-time Load Zone price. So outflow lowers the cost of whichever provider serves the home. */
  const EXPORT_TEXT = "Most of the 7 to 9 PM discharge is more than a home uses, so it is export. In ERCOT, outflow from an unregistered battery of 1 MW or less is settled as a cut to the settlement load of the home's retail provider, at the real-time load-zone price (Nodal Protocols 11.4.4.3 and 6.6.3.2), and charging adds to that load. So the arbitrage value lands with the home's retail provider. An owner that is that provider keeps it, with no ADER aggregation. A third-party owner gets it only by contract with the provider or by registering the battery with ERCOT. ADER is the route to ancillary services, not needed for this energy value.";

  const BRIDGE_TEXT = 'Simplification: the model nets the credit cash out of cost on day one. Real lenders usually fund the credit separately, with a bridge loan repaid when the credit sells, and size the term loan on cash flow and an advance rate on the full cost. The advance cap here already uses the full cost, so the credit changes the debt only when the net-cost cap binds.';

  const EQUITY_ZERO_TEXT = 'That only holds if the tax-credit cash is in hand on day one. In a real deal it arrives when the credit sells, so a bridge loan or equity carries it until then, and a term lender rarely funds all of what is left.';

  // Retail margin: what the number means, or plainly that it is left out.
  function retailText(r) {
    const yr = r.counted.retail;
    if (yr > 0) return `Retail energy margin adds ${usd(yr)} a year (${pct(yr / r.debtService)} of the loan payment). It belongs only to an owner that is also the home's retail provider. The default is derived from a published energy charge, a measured wholesale price and one labeled cost assumption (see the input note). Set it to 0 for a third-party owner.`;
    if (yr < 0) return `Retail energy margin is negative: the provider loses ${usd(-yr)} a year selling power to this home, and the loan has to carry that.`;
    return 'Retail energy margin is $0 here, so this answer leaves out what a retail provider normally earns on the power it sells, often its main revenue line. Try the derived default, $22 a month, or your own number.';
  }

  const LINE_NAMES = { member: 'member fees', retail: 'retail energy margin', toll: 'the utility toll', arb: 'energy arbitrage', anc: 'ancillary services' };
  // Where each revenue line's default comes from. The toll and ancillary services are placeholders; the
  // retail margin is derived from public numbers plus one labeled cost assumption, so it counts as an assumption.
  const LINE_BASIS = { member: 'sourced', retail: 'assumption', toll: 'assumption', arb: 'sourced', anc: 'assumption' };

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
      out.push(`Nothing is left to finance: the member pays ${usd(r.upfront)} and the tax credit sells for ${usd(r.itc)}, which together cover the ${usd(r.capex)} installed cost.`);
      return out;
    }
    if (r.binding === 'none') {
      out.push(`On these numbers a lender would lend nothing: the weakest year in the loan term has ${usd(r.minCfads)} of cash flow after operating cost, so nothing is left to repay a loan. The whole net cost is equity.`);
      driver();
      if (r.counted.retail <= 0) out.push(retailText(r));
      return out;
    }
    if (r.debt <= 0) {
      out.push('On these numbers a lender would lend nothing: the advance rate is 0%. The whole net cost is equity.');
      return out;
    }
    driver();
    const ds = r.debtService;
    out.push(`Energy arbitrage alone, in this zone, would cover ${pct(r.full.arb / ds)} of the yearly loan payment${r.counted.arb > 0 ? '' : ' (it does not count in this revenue case)'}.`);
    if (r.counted.arb > 0) out.push(EXPORT_TEXT);
    out.push(`Member fees alone cover ${pct(r.full.member / ds)} of it.`);
    out.push(retailText(r));
    if (r.itc > 0) {
      const sale = r.itcPrice < 1 ? `, sold at ${centsText(r.itcPrice)} cents per dollar for ${usd(r.itc)} in cash` : ', sold at face value';
      out.push(`The tax credit, ${pct(r.itcRate)} of cost (${usd(r.itcFace)} face value)${sale}, lowers what debt and equity must fund. It adds no yearly cash, so it does not raise the debt that cash flow can carry. ${BRIDGE_TEXT}`);
    }
    if (r.binding === 'dscr') out.push(`Cash flow limits the loan, not the asset value. The loan is ${pct(r.debtPctCapex)} of cost, below the advance cap.`);
    else if (r.binding === 'advance') out.push('The advance rate limits the loan. Cash flow could support more, so more revenue does not raise the debt here.');
    else if (r.binding === 'cost') out.push(`The loan already covers the full net cost after the member payment and the tax credit, so equity is $0.${r.itc > 0 ? ' ' + EQUITY_ZERO_TEXT : ''}`);
    return out;
  }

  function pct(x) {
    if (!Number.isFinite(x)) return 'n/a';
    if (x > 10) return 'more than 1,000%';
    return `${Math.round(x * 100)}%`;
  }
  function centsText(f) { return String(Math.round(f * 1000) / 10); }
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
    // Keys match in any case ("ratepct" is ratePct), the same as zone, state and case values.
    const KEYS = Array.from(byKey.keys()).concat(SPECIAL_KEYS);
    const canon = new Map(KEYS.map((k) => [k.toLowerCase(), k]));
    let pairs;
    const data = parsed && parsed.data;
    // A one-line CSV has no data rows, but its only line may be a data row with no header above it.
    if (Array.isArray(data) && !data.length && Array.isArray(data.headers) && data.headers.length && !data.headers.some((h) => h.trim().toLowerCase() === 'key')) {
      errors.push('No "key" column. The first line must be the header row key,value (download the template); this file\'s first line is "' + clip(data.headers.join(','), 60) + '".');
      return { defaults: d, errors, warnings, changed, arbPerYear: null, zone: null };
    }
    if (Array.isArray(data)) {
      // CSV headers (and JSON row keys) match case-insensitively and trimmed: Key,Value works.
      const head = Array.isArray(data.headers) ? data.headers : Object.keys(data.find((r) => r && typeof r === 'object') || {});
      const named = (name) => head.filter((h) => h.trim().toLowerCase() === name);
      const text = head.join(',') + ' ' + data.slice(0, 5).map((r) => (r && typeof r === 'object' ? Object.values(r).join(',') : '')).join(' ');
      if (looksBinary(text)) {
        errors.push('This file is not text. It looks like a binary file (a spreadsheet such as .xlsx, an image or a zip). Save it as CSV (UTF-8) with key and value columns.');
        return { defaults: d, errors, warnings, changed, arbPerYear: null, zone: null };
      }
      const dup = (data.duplicateHeaders || []).map((h) => 'Column "' + clip(h) + '" appears more than once. Keep one.');
      ['key', 'value'].forEach((c) => { const n = named(c); if (n.length > 1) dup.push('Columns "' + n.map((x) => clip(x)).join('" and "') + '" are the same column (names match in any case). Keep one.'); });
      if (dup.length) return { defaults: d, errors: dup, warnings, changed, arbPerYear: null, zone: null };
      if (data.length && (!named('key').length || !named('value').length)) {
        const missing = ['key', 'value'].filter((c) => !named(c).length);
        errors.push('No ' + missing.map((c) => '"' + c + '"').join(' or ') + ' column. The first line must be the header row key,value (download the template); this file\'s first line is "' + clip(head.join(','), 60) + '".');
        return { defaults: d, errors, warnings, changed, arbPerYear: null, zone: null };
      }
      head.filter((h) => h.trim() !== '' && !FILE_COLUMNS.includes(h.trim().toLowerCase()))
        .forEach((h) => warnings.push('Ignored unknown column "' + clip(h) + '". Known columns: ' + FILE_COLUMNS.join(', ') + '.'));
      const k = named('key')[0], v = named('value')[0];
      pairs = data.map((r, i) => ({ key: r && typeof r === 'object' ? r[k] : null, value: r && typeof r === 'object' ? r[v] : null, line: i + 2 }));
    } else if (data && typeof data === 'object') {
      const src = has(data, 'inputs') && data.inputs && typeof data.inputs === 'object' ? data.inputs : data;
      pairs = Object.keys(src).map((key) => ({ key, value: src[key] }));
    } else pairs = [];
    if (!pairs.length) errors.push('No rows found. The file needs key and value columns (CSV) or a key: value object (JSON).');
    let revenueCase = null, zone = null, arbPerYear = null;
    const firstAt = new Map(); // key -> where it first appeared, so a repeated row is an error, not "last row wins"
    for (const p of pairs) {
      const where = p.line ? 'Row ' + p.line + ': ' : '';
      const written = String(p.key == null ? '' : p.key).trim();
      if (!written) { errors.push(where + 'missing key.'); continue; }
      const key = canon.get(written.toLowerCase()) || written;
      if (firstAt.has(key)) { errors.push(where + key + ' appears again (first at ' + firstAt.get(key) + '). Keep one row per key.'); continue; }
      firstAt.set(key, p.line ? 'Row ' + p.line : 'an earlier entry');
      const isSpecial = SPECIAL_KEYS.includes(key);
      if (!isSpecial && !byKey.has(key)) {
        const near = closest(written, KEYS);
        errors.push(where + 'unknown key "' + clip(written) + '".' + (near ? ' Did you mean ' + near + '?' : '') + ' Download the template for the full list.');
        continue;
      }
      if (p.value !== null && typeof p.value === 'object') { errors.push(where + key + ' must be a single value, not a list or object.'); continue; }
      if (String(p.value == null ? '' : p.value).trim() === '') { warnings.push(where + key + ' is blank, so the public value stays.'); continue; }
      if (key === 'revenueCase') {
        // Any case: TOLL is toll, the same as zone.
        const c = String(p.value).trim().toLowerCase();
        if (!cases.includes(c)) errors.push(where + 'revenueCase must be one of ' + cases.join(', ') + ' (any case), got "' + clip(String(p.value).trim()) + '".');
        else revenueCase = c;
        continue;
      }
      if (key === 'zone') {
        // Any case: lz_north is LZ_NORTH, the same as the market page's zone file.
        const z = String(p.value).trim().toUpperCase();
        if (!zoneIds.includes(z)) errors.push(where + 'zone must be one of ' + zoneIds.join(', ') + ' (any case), got "' + clip(String(p.value).trim()) + '".');
        else zone = z;
        continue;
      }
      const v = parseDecimal(p.value);
      if (!Number.isFinite(v)) {
        const range = key === 'arbPerYear' ? ' Allowed: 0 to ' + ARB_MAX + '.' : rangeText(byKey.get(key));
        if (isHuge(p.value)) errors.push(where + key + ' is out of range: ' + (typeof p.value === 'string' ? '"' + clip(p.value.trim()) + '"' : 'the number') + ' is too large.' + range);
        else errors.push(where + key + ' is not a number: "' + clip(p.value) + '". Use plain decimal digits.');
        continue;
      }
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
    if (zone && arbPerYear != null) warnings.push('arbPerYear replaces the zone value, so zone ' + zone + ' is not used. Leave arbPerYear blank to use the zone.');
    // zone: the file's zone, or null when the file does not set one (the page then keeps the zone on screen).
    return { defaults: d, errors, warnings, changed, arbPerYear, zone };
  }

  /* The zone the /finance page shows after a file loads or is cleared, so the page and the API agree.
     zoneIds: zones on the page. current: the zone selected now. fileZone: the file's zone (applyOverrides
     .zone) or null. reset: true for "Back to public data", which restores the public default zone. */
  function pickZone(zoneIds, wanted, fallback) {
    return zoneIds.includes(wanted) ? wanted : zoneIds.includes(fallback) ? fallback : (zoneIds[0] || null);
  }
  function zoneAfterLoad(o) {
    if (o.reset) return pickZone(o.zoneIds, o.publicZone);
    return pickZone(o.zoneIds, o.fileZone || o.current, o.publicZone);
  }

  // Template rows: every field with its public value, plus the special keys.
  function templateRows(defaults) {
    const rows = fieldList(defaults).map((f) => ({ key: f.key, value: f.value, unit: f.unit, label: f.label, public_basis: f.kind }));
    rows.push({ key: 'revenueCase', value: defaults.revenueCaseDefault, unit: Object.keys(CASES).join(' | '), label: 'Revenue case', public_basis: 'assumption' });
    rows.push({ key: 'zone', value: defaults.zoneDefault, unit: 'ERCOT load zone', label: 'Arbitrage zone', public_basis: 'sourced' });
    rows.push({ key: 'arbPerYear', value: '', unit: '$/battery/yr', label: 'Your own arbitrage value (leave blank to use the zone)', public_basis: '' });
    return rows;
  }

  const api = { SPECIAL_KEYS, FILE_COLUMNS, pickZone, zoneAfterLoad, closest, EXPORT_TEXT, BRIDGE_TEXT, EQUITY_ZERO_TEXT, applyOverrides, templateRows, validateFields, parseDecimal, isHuge, fieldError, bindingText, PERCENT_FIELDS, CASES, ARB_MAX, annuityFactor, annuityPayment, normalize, cashFlows, sizeDebt, fleet, batteriesForMw, sensitivity, explain };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FinanceCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
