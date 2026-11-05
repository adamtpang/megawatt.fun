// POST /api/v1/finance: size the debt on one home battery, the same way /finance does, and say whether it pays.
// Math: finance-core.js (sizeDebt, returns, explain, fleet, sensitivity). Data: data/finance-defaults.json, data/zone-value.json.
'use strict';

const F = require('../../finance-core.js');
const DEFAULTS = require('../../data/finance-defaults.json');
const ZONE_VALUE = require('../../data/zone-value.json');
const L = require('../_lib.js');

const ZONES = (ZONE_VALUE.zones || []).slice().sort((a, b) => b.usdPerYear - a.usdPerYear);
const ZONE_IDS = ZONES.map((z) => z.id);
const SPECIAL = ['preset', 'revenueCase', 'zone', 'arbPerYear'];
const KNOWN = ['inputs', 'preset', 'revenueCase', 'zone', 'arbPerYear', 'fleetCount'];
const PRESETS = F.presetIds(DEFAULTS);

const fields = (d) => d.groups.flatMap((g) => g.fields);
const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
const publicRetail = fields(DEFAULTS).find((f) => f.key === 'retailMarginMonthly').value;

function usage() {
  return {
    tool: 'finance',
    what: 'Sizes the loan on one generic leased home battery the way a lender does (level debt service, target DSCR, advance-rate cap), after the member payment and the storage investment tax credit, says whether it pays back (unlevered and equity IRR, NPV at a stated discount rate, payback year), then rolls it up to your fleet and to 100 MW. Generic public defaults, not the books of any real company.',
    post: {
      content_types: ['application/json', 'text/csv'],
      json_body: {
        inputs: '{ key: value } for any input key below (optional; omitted keys keep the public value)',
        preset: 'optional: ' + PRESETS.join(' | ') + ' loads a company\'s published figures (its public claims, not its economics) before your inputs. Leave it out for the generic defaults.',
        revenueCase: 'toll | merchant | stacked, any case (optional, default ' + DEFAULTS.revenueCaseDefault + ')',
        zone: 'ERCOT zone for the arbitrage value, any case (optional, default ' + DEFAULTS.zoneDefault + '): ' + ZONE_IDS.join(', ') + '. LZ_AEN, LZ_CPS, LZ_LCRA and LZ_RAYBN are city-utility or co-op zones without retail choice: there the retail margin and merchant arbitrage do not count, and the answer says to try the toll case.',
        arbPerYear: 'your own arbitrage value, $ per battery per year, 0 to ' + F.ARB_MAX + '; replaces the zone, with a warning when you send both (optional)',
        fleetCount: 'batteries in your fleet roll-up, a whole number from 1 to 10,000,000 (optional, same as inputs.fleetCount)',
        conflicts: 'preset, revenueCase, zone, arbPerYear and fleetCount may be sent at the top level or inside inputs. Sent in both places with different values is a 422.',
      },
      csv_body: 'The page\'s "Use your own data" file: key,value columns (header in any case), one row per input. Same keys, including preset, revenueCase, zone and arbPerYear. Keys and their text values match in any case (ratepct is ratePct, TOLL is toll); an unknown key is a 422 that names the closest key. A key on two rows, a column written twice, or a file without the key,value header row is a 422. Columns other than key, value, unit, label and public_basis are ignored with a warning. JSON sent as text/csv is a 422 that says to use application/json.',
      query_string: 'Not read. Any query parameter comes back as a warning naming the closest body field.',
      input_keys: fields(DEFAULTS).map((f) => ({ key: f.key, unit: f.unit, public_value: f.value, min: f.min, max: f.max, integer: !!f.integer, basis: f.kind })),
      numbers: 'Plain decimal numbers only (12, 8.5, 1e3). A comma is allowed only as a thousands separator (1,200 or 1,234.5); "3,5" is a 422 that says to use a dot for decimals. Hex such as 0x10, Infinity and out-of-range values are 422 errors. A number too large to store (1e400) is reported as out of range.',
    },
    example: { inputs: { capexPerKwh: 900, itcPct: 30, tollPerKwYear: 90, ratePct: 8.5 }, revenueCase: 'toll', zone: 'LZ_NORTH' },
    returns: 'debt, equity, CFADS by year, DSCR, binding limit, returns (unlevered and equity IRR, NPV, payback, and plain words on whether it pays back and what is left out), plain-English explain lines, the fleet and 100 MW roll-up, and a toll x rate sensitivity grid.',
    docs: L.docsUrl('finance'),
    page: L.SITE + '/finance',
  };
}

// Two ways of writing one input that mean the same thing: 100 and "100", LZ_NORTH and lz_north, toll and TOLL.
function sameValue(key, a, b) {
  const x = F.parseDecimal(a), y = F.parseDecimal(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return x === y;
  const t = (v) => String(v).trim();
  return key === 'zone' || key === 'revenueCase' || key === 'preset' ? t(a).toUpperCase() === t(b).toUpperCase() : t(a) === t(b);
}

// Body to the parsed-file shape finance-core's applyOverrides reads.
function toOverrides(parsed) {
  if (!parsed) return { parsed: null, warnings: [] };
  if (L.looksLikeJsonCsv(parsed)) throw L.jsonAsCsvError();
  if (parsed.kind === 'csv') return { parsed, warnings: [] };
  const b = L.objectBody(parsed);
  const warnings = L.unknownKeys(b, KNOWN);
  if (b.inputs != null && (typeof b.inputs !== 'object' || Array.isArray(b.inputs))) throw L.invalid(['inputs must be an object of { key: value }.']);
  // A null-prototype object, so a key such as "__proto__" stays an own key and
  // applyOverrides reports it as unknown instead of it changing the object's prototype.
  const flat = Object.create(null);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  if (b.inputs != null) for (const k of Object.keys(b.inputs)) flat[k] = b.inputs[k];
  // A key sent both at the top level and inside inputs must agree. Different values are a
  // 422, never a silent pick of one of them.
  const conflicts = [];
  for (const k of SPECIAL.concat('fleetCount')) {
    if (!own(b, k) || b[k] == null) continue;
    if (b.inputs != null && own(b.inputs, k) && b.inputs[k] != null && !sameValue(k, b[k], b.inputs[k])) {
      conflicts.push(k + ' is ' + JSON.stringify(b[k]) + ' at the top level but ' + JSON.stringify(b.inputs[k]) + ' in inputs. Send it once, or the same value in both places.');
      continue;
    }
    flat[k] = b[k];
  }
  if (conflicts.length) throw L.invalid(conflicts);
  return { parsed: Object.keys(flat).length ? { kind: 'json', data: flat } : null, warnings };
}

// finance.js readInputs(), with the DOM swapped for the defaults object.
function readInputs(d, arbOverride) {
  const raw = { revenueCase: d.revenueCaseDefault };
  for (const f of fields(d)) raw[f.key] = Number(f.value);
  const zoneId = F.pickZone(ZONE_IDS, d.zoneDefault); // the same pick as the page's setDefaults()
  const z = ZONES.find((x) => x.id === zoneId);
  raw.arbPerYear = arbOverride != null ? arbOverride : (z ? z.usdPerYear : 0);
  // The zone's retail market decides whether a retail margin and merchant arbitrage can be kept.
  // With your own arbitrage value the zone is not used, so neither is its market.
  raw.zone = arbOverride != null ? null : zoneId;
  raw.zoneMarket = arbOverride != null || !z ? null : z.market || null;
  return { raw, zone: raw.zone, inp: F.normalize(raw) };
}

function fleetRow(a) {
  return { batteries: a.count, capex: a.capex, upfront: a.upfront, itc_face: a.itcFace, itc: a.itc, debt: a.debt, equity: a.equity, debt_service: a.debtService, year1_cfads: a.year1Cfads };
}

function measureRow(m) {
  return m ? { invest: m.invest, cash_total: m.cashTotal, net: m.net, irr: m.irr, npv: m.npv, payback_year: m.paybackYear, pays_back: m.paysBack } : null;
}

// Query parameters are never read on a POST; each one is a warning with the closest body field.
function queryWarnings(req) {
  if (!req) return [];
  const names = KNOWN.concat(fields(DEFAULTS).map((f) => f.key));
  if (typeof L.queryWarnings === 'function') return L.queryWarnings(req, [], names);
  return Object.keys(L.query(req)).map((k) => {
    const near = L.closest(k, names);
    return 'Ignored query string parameter "' + L.clip(k) + '".' + (near ? ' Did you mean "' + near + '" (send it in the JSON body)?' : '') + ' This endpoint reads only the request body.';
  });
}

async function post(parsed, req) {
  const { parsed: over, warnings: bodyWarnings } = toOverrides(parsed);
  let d = DEFAULTS, arb = null, changed = [], preset = null, warnings = queryWarnings(req).concat(bodyWarnings);
  if (over) {
    const r = F.applyOverrides(DEFAULTS, over, ZONE_IDS);
    if (r.errors.length) throw L.invalid(r.errors);
    d = r.defaults; arb = r.arbPerYear; changed = r.changed; preset = r.preset; warnings = warnings.concat(r.warnings);
  }
  const { raw, zone, inp } = readInputs(d, arb);
  const r = F.sizeDebt(inp);
  const zoneRow = ZONES.find((x) => x.id === zone) || null;
  const noChoice = r.noChoice;
  if (noChoice) warnings.push(zone + ' has no retail choice (' + zoneRow.who + '). The retail margin and merchant arbitrage do not count there; the value goes to the utility. Try revenueCase toll for a utility partnership.');

  const explain = F.explain(r, { basis: F.lineBasis(d, arb), retailDefault: publicRetail });
  if (r.tenorClamped) explain.push(`The loan term was cut to ${r.tenor} years so it does not outlive the battery.`);

  const mwCount = F.batteriesForMw(100, inp.kw);
  const tolls = [0, 30, 60, 90, 120, 180], rates = [0.06, 0.08, 0.10, 0.12];
  const R = r.returns;

  const result = {
    preset,
    preset_label: preset ? DEFAULTS.presets[preset].label : null,
    preset_about: preset ? DEFAULTS.presets[preset].about : null,
    revenue_case: r.caseId,
    revenue_case_label: r.caseLabel,
    zone_market: zoneRow ? { zone: zoneRow.id, market: zoneRow.market, who: zoneRow.who, retail_choice: zoneRow.market === 'retail choice' } : null,
    capex: r.capex,
    upfront: r.upfront,
    itc_rate: r.itcRate,
    itc_face: r.itcFace,
    itc_price: r.itcPrice,
    itc: r.itc,
    itc_treatment: 'IRC 48E storage credit, sold for cash when the battery goes into service (IRC 6418 transfer) at itc_price per dollar of credit (input itcPriceCents; public default 89.5 cents, Crux 2026-vintage ITC average). itc = itc_face x itc_price, and it lowers net_capex. ' + F.BRIDGE_TEXT + ' Left out: timing, bridge loan interest, recapture, basis reduction and bonus adders. ' + F.ITC_PROJECT_TEXT,
    export_settlement: F.EXPORT_TEXT,
    arbitrage_basis: 'Energy arbitrage is ' + F.ARB_BASIS_TEXT + '.',
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
    returns: {
      discount_rate: R.discountRate,
      unlevered: measureRow(R.unlevered),
      equity: measureRow(R.equity),
      pays_back: R.unlevered.paysBack,
      text: F.returnsText(r),
      about: 'Unlevered: pay the net cost (installed cost minus member payment minus tax-credit cash) in year 0, get CFADS every year of life. Equity: put in the equity, get CFADS minus the loan payment. IRR is null when it is not defined (for example no equity). No taxes, depreciation, residual value or escalators.',
    },
    explain,
    cfads_by_year: r.years.map((y) => ({ year: y.year, member: y.member, retail: y.retail, toll: y.toll, arb: y.arb, anc: y.anc, opex: y.opex, revenue: y.revenue, cfads: y.cfads, in_tenor: y.year <= r.tenor })),
    fleet: {
      input: Object.assign({ mw: F.fleet(r, inp.fleetCount).count * inp.kw / 1000 }, fleetRow(F.fleet(r, inp.fleetCount))),
      mw_100: Object.assign({ mw: mwCount * inp.kw / 1000 }, fleetRow(F.fleet(r, mwCount))),
    },
    sensitivity: {
      about: 'Debt per battery. Rows: utility toll, $/kW-year. Columns: interest rate. All other inputs as sent.',
      rows: F.sensitivity(inp, tolls, rates).map((row) => ({ toll: row.toll, cells: row.cells.map((c) => ({ rate: c.rate, debt: round2(c.debt), binding: c.binding })) })),
    },
  };

  const sources = fields(d).filter((f) => f.source).map((f) => Object.assign({ input: f.key, url: f.source, retrieved: f.retrieved }, f.kind === 'preset' ? { note: f.presetLabel + ': a public claim, not the company\'s economics.' } : {}));
  sources.push({ input: 'arbPerYear', url: L.SITE + '/data/zone-value.json', note: arb != null ? 'Not used: you sent your own arbPerYear.' : `ERCOT ${zone} energy arbitrage, ${ZONE_VALUE.period.start} to ${ZONE_VALUE.period.endExclusive} (end not included). ${F.ARB_BASIS_TEXT}.` });
  if (zoneRow && ZONE_VALUE.markets) for (const url of ZONE_VALUE.markets.sources) sources.push({ input: 'zone market', url, note: zoneRow.id + ': ' + zoneRow.market + '.' });

  const inputsUsed = Object.assign({}, raw, { zone, preset, yours: changed.concat(arb != null ? ['arbPerYear'] : []) });
  delete inputsUsed.zoneMarket;
  return { inputs_used: inputsUsed, result, warnings, sources };
}

module.exports = L.endpoint({ usage, post });
module.exports.readInputs = readInputs;
