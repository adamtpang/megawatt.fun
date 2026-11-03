// POST /api/v1/finance: size the debt on one home battery, the same way /finance does.
// Math: finance-core.js (sizeDebt, explain, fleet, sensitivity). Data: data/finance-defaults.json, data/zone-value.json.
'use strict';

const F = require('../../finance-core.js');
const DEFAULTS = require('../../data/finance-defaults.json');
const ZONE_VALUE = require('../../data/zone-value.json');
const L = require('../_lib.js');

const ZONES = (ZONE_VALUE.zones || []).slice().sort((a, b) => b.usdPerYear - a.usdPerYear);
const ZONE_IDS = ZONES.map((z) => z.id);
const SPECIAL = ['revenueCase', 'zone', 'arbPerYear'];
const KNOWN = ['inputs', 'revenueCase', 'zone', 'arbPerYear', 'fleetCount'];

const fields = (d) => d.groups.flatMap((g) => g.fields);
const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);

function usage() {
  return {
    tool: 'finance',
    what: 'Sizes the loan on one leased home battery the way a lender does (level debt service, target DSCR, advance-rate cap), after the member payment and the storage investment tax credit, then rolls it up to your fleet and to 100 MW. A generic model, not the books of any real company.',
    post: {
      content_types: ['application/json', 'text/csv'],
      json_body: {
        inputs: '{ key: value } for any input key below (optional; omitted keys keep the public value)',
        revenueCase: 'toll | merchant | stacked (optional, default ' + DEFAULTS.revenueCaseDefault + ')',
        zone: 'ERCOT zone for the arbitrage value (optional, default ' + DEFAULTS.zoneDefault + '): ' + ZONE_IDS.join(', '),
        arbPerYear: 'your own arbitrage value, $ per battery per year; replaces the zone (optional)',
        fleetCount: 'batteries in your fleet roll-up, a whole number from 1 to 10,000,000 (optional, same as inputs.fleetCount)',
      },
      csv_body: 'The page\'s "Use your own data" file: key,value columns, one row per input. Same keys, including revenueCase, zone and arbPerYear.',
      input_keys: fields(DEFAULTS).map((f) => ({ key: f.key, unit: f.unit, public_value: f.value, min: f.min, max: f.max, integer: !!f.integer, basis: f.kind })),
      numbers: 'Plain decimal numbers only (12, 8.5, 1e3). Hex such as 0x10, Infinity and out-of-range values are 422 errors.',
    },
    example: { inputs: { capexPerKwh: 280, itcPct: 30, tollPerKwYear: 90, ratePct: 8.5 }, revenueCase: 'toll', zone: 'LZ_NORTH' },
    returns: 'debt, equity, CFADS by year, DSCR, binding limit, plain-English explain lines, the fleet and 100 MW roll-up, and a toll x rate sensitivity grid.',
    docs: L.docsUrl('finance'),
    page: L.SITE + '/finance',
  };
}

// Body to the parsed-file shape finance-core's applyOverrides reads.
function toOverrides(parsed) {
  if (!parsed) return { parsed: null, warnings: [] };
  if (parsed.kind === 'csv') return { parsed, warnings: [] };
  const b = L.objectBody(parsed);
  const warnings = L.unknownKeys(b, KNOWN);
  if (b.inputs != null && (typeof b.inputs !== 'object' || Array.isArray(b.inputs))) throw L.invalid(['inputs must be an object of { key: value }.']);
  // A null-prototype object, so a key such as "__proto__" stays an own key and
  // applyOverrides reports it as unknown instead of it changing the object's prototype.
  const flat = Object.create(null);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  if (b.inputs != null) for (const k of Object.keys(b.inputs)) flat[k] = b.inputs[k];
  for (const k of SPECIAL.concat('fleetCount')) if (own(b, k) && b[k] != null) flat[k] = b[k];
  return { parsed: Object.keys(flat).length ? { kind: 'json', data: flat } : null, warnings };
}

// finance.js readInputs(), with the DOM swapped for the defaults object.
function readInputs(d, arbOverride) {
  const raw = { revenueCase: d.revenueCaseDefault };
  for (const f of fields(d)) raw[f.key] = Number(f.value);
  const zoneId = ZONES.some((z) => z.id === d.zoneDefault) ? d.zoneDefault : (ZONES[0] && ZONES[0].id);
  const z = ZONES.find((x) => x.id === zoneId);
  raw.arbPerYear = arbOverride != null ? arbOverride : (z ? z.usdPerYear : 0);
  return { raw, zone: arbOverride != null ? null : zoneId, inp: F.normalize(raw) };
}

function fleetRow(a) {
  return { batteries: a.count, capex: a.capex, upfront: a.upfront, itc: a.itc, debt: a.debt, equity: a.equity, debt_service: a.debtService, year1_cfads: a.year1Cfads };
}

async function post(parsed) {
  const { parsed: over, warnings: bodyWarnings } = toOverrides(parsed);
  let d = DEFAULTS, arb = null, changed = [], warnings = bodyWarnings.slice();
  if (over) {
    const r = F.applyOverrides(DEFAULTS, over, ZONE_IDS);
    if (r.errors.length) throw L.invalid(r.errors);
    d = r.defaults; arb = r.arbPerYear; changed = r.changed; warnings = warnings.concat(r.warnings);
  }
  const { raw, zone, inp } = readInputs(d, arb);
  const r = F.sizeDebt(inp);

  const explain = F.explain(r);
  if (r.tenorClamped) explain.push(`The loan term was cut to ${r.tenor} years so it does not outlive the battery.`);

  const mwCount = F.batteriesForMw(100, inp.kw);
  const tolls = [0, 30, 60, 90, 120, 180], rates = [0.06, 0.08, 0.10, 0.12];

  const result = {
    revenue_case: r.caseId,
    revenue_case_label: r.caseLabel,
    capex: r.capex,
    upfront: r.upfront,
    itc_rate: r.itcRate,
    itc: r.itc,
    itc_treatment: 'IRC 48E storage credit, sold for cash at face value when the battery goes into service (IRC 6418 transfer). It lowers net_capex. Left out: the transfer discount, timing, recapture, basis reduction and bonus adders.',
    net_capex: r.netCapex,
    year1_revenue_lines: { counted: r.counted, full: r.full, opex: r.opex },
    year1_cfads: r.year1Cfads,
    min_cfads_in_tenor: r.minCfads,
    dscr_target: r.dscrTarget,
    allowed_payment: r.allowedPayment,
    dscr_debt: r.dscrDebt,
    advance_cap: r.advanceCap,
    debt: r.debt,
    equity: r.equity,
    debt_pct_capex: r.debtPctCapex,
    debt_service: r.debtService,
    min_dscr: r.minDscr,
    rate: r.rate,
    tenor_years: r.tenor,
    tenor_clamped: r.tenorClamped,
    binding: r.binding,
    binding_text: F.bindingText(r),
    explain,
    cfads_by_year: r.years.map((y) => ({ year: y.year, member: y.member, retail: y.retail, toll: y.toll, arb: y.arb, opex: y.opex, revenue: y.revenue, cfads: y.cfads, in_tenor: y.year <= r.tenor })),
    fleet: {
      input: Object.assign({ mw: F.fleet(r, inp.fleetCount).count * inp.kw / 1000 }, fleetRow(F.fleet(r, inp.fleetCount))),
      mw_100: Object.assign({ mw: mwCount * inp.kw / 1000 }, fleetRow(F.fleet(r, mwCount))),
    },
    sensitivity: {
      about: 'Debt per battery. Rows: utility toll, $/kW-year. Columns: interest rate. All other inputs as sent.',
      rows: F.sensitivity(inp, tolls, rates).map((row) => ({ toll: row.toll, cells: row.cells.map((c) => ({ rate: c.rate, debt: round2(c.debt), binding: c.binding })) })),
    },
  };

  const sources = fields(d).filter((f) => f.source).map((f) => ({ input: f.key, url: f.source, retrieved: f.retrieved }));
  sources.push({ input: 'arbPerYear', url: L.SITE + '/data/zone-value.json', note: arb != null ? 'Not used: you sent your own arbPerYear.' : `ERCOT ${zone} energy arbitrage, ${ZONE_VALUE.period.start} to ${ZONE_VALUE.period.endExclusive} (end not included).` });

  return {
    inputs_used: Object.assign({}, raw, { zone, yours: changed.concat(arb != null ? ['arbPerYear'] : []) }),
    result,
    warnings,
    sources,
  };
}

module.exports = L.endpoint({ usage, post });
module.exports.readInputs = readInputs;
