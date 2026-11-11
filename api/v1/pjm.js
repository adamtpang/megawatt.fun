// POST /api/v1/pjm: one home battery's yearly value in each PJM utility zone, the same way /pjm does.
// Math: pjm-core.js. Data: data/pjm-value.json (scripts/pjm-value.cjs), data/pjm-states.json.
'use strict';

const P = require('../../pjm-core.js');
const DATA = require('../../data/pjm-value.json');
const L = require('../_lib.js');

const KNOWN = Object.keys(P.DEFAULTS).concat(['pplNonbypass', 'zones']);
const IDS = DATA.zones.map((z) => z.id);

function usage() {
  return {
    tool: 'pjm',
    what: 'One 20 kW / 39.2 kWh home battery’s yearly value in each PJM utility zone: energy on a fixed daily clock, the capacity tag (PLC) and the transmission tag (NSPL). Ranked, with retail choice per zone.',
    post: {
      content_types: ['application/json', 'text/csv'],
      json_body: {
        tagKw: 'home load the battery covers in the evening and at peaks, kW, 0 to 8 (default ' + P.DEFAULTS.tagKw + ', an assumption). Caps energy and sets both tags.',
        allowExports: 'true counts full 20 kW exports at the zone price, possible once PJM DER aggregation opens on 1 Feb 2028 (default false: home load only)',
        countUnconfirmed: 'true also counts capacity and transmission in zones where the utility\u2019s tag method is not confirmed (default false: counted only where the utility\u2019s documents confirm a home\u2019s own meter sets its tags)',
        hitRate: 'share of tag-setting peak hours covered, 0 to 1 (default 1)',
        capacityUsdPerMwDay: 'capacity price, $/MW-day (default ' + P.DEFAULTS.capacityUsdPerMwDay + ', PJM 2027/2028 BRA, the year summer 2026 tags are paid)',
        capacityScale: 'multiplier for zonal scaling and forecast pool factors, 0 to 2 (default 1)',
        includeEnergy: 'true or false (default true)', includeCapacity: 'true or false (default true)', includeTransmission: 'true or false (default true)',
        pplNonbypass: 'true models PPL’s proposed nonbypassable transmission charge: the PPL transmission tag is worth 0 to a supplier (default false)',
        zones: 'your own numbers per zone (optional): a list of rows { zone, home_kw, peak_coverage_pct, tag_rules, energy_usd_per_year, capacity_scale }, or the same as CSV text. Blank or missing fields keep the public number. tag_rules is interval, profile or unknown.',
      },
      csv_body: 'The page\u2019s "Use your own data" file: columns ' + P.COLUMNS.join(', ') + '. One row per zone.',
      zones: DATA.zones.map((z) => z.id),
    },
    example: { tagKw: 3, hitRate: 0.8, zones: [{ zone: 'COMED', home_kw: 4, peak_coverage_pct: 90 }, { zone: 'BGE', tag_rules: 'interval' }] },
    returns: 'zones ranked by total $/year with energy, capacity and transmission parts, retail choice, utility, states, whether transmission is bypassable, and the summer 2026 tag-setting hours.',
    data_as_of: { built: DATA.built, prices: DATA.period, nits: DATA.nits.effective },
    docs: L.docsUrl('pjm'),
    page: L.SITE + '/',
  };
}

async function post(parsed) {
  // A CSV body is the page's zone file; the other options then keep their defaults.
  const csv = !!parsed && parsed.kind === 'csv';
  const body = csv ? {} : L.objectBody(parsed);
  const warnings = L.unknownKeys(body, KNOWN);
  const raw = {};
  for (const k of Object.keys(P.DEFAULTS)) if (L.hasOwn(body, k)) raw[k] = body[k];
  const { inputs, errors } = P.inputs(raw);
  const nb = L.getOwn(body, 'pplNonbypass');
  if (nb != null && typeof nb !== 'boolean') errors.push('pplNonbypass must be true or false.');
  let yours = null;
  const zin = csv ? parsed : L.hasOwn(body, 'zones') && body.zones != null
    ? (typeof body.zones === 'string' ? { kind: 'csv', data: L.parseCSV(body.zones) } : { kind: 'json', data: body.zones })
    : null;
  if (zin) {
    const y = P.loadYours(zin, IDS);
    errors.push(...y.errors); warnings.push(...y.warnings); yours = y.yours;
  }
  if (errors.length) throw L.invalid(errors);
  const zones = P.applyYours(DATA.zones, yours).map((z) => (nb === true && z.id === 'PPL' ? { ...z, transmission: { ...z.transmission, bypassable: false } } : z));
  const ranked = P.rank(zones, inputs).map((r, i) => ({
    rank: i + 1, zone: r.zone.id, utility: r.zone.utility, states: r.zone.states, retail_choice: r.zone.choice,
    energy_usd_yr: r.value.energy, capacity_usd_yr: r.value.capacity, transmission_usd_yr: r.value.transmission, total_usd_yr: r.value.total,
    nits_usd_per_mw_yr: r.zone.nitsUsdPerMwYear,
    tag_rules: r.value.tagStatus, not_counted_if_confirmed_usd_yr: r.value.potential, yours: r.value.yours,
    transmission_bypassable: r.zone.transmission.bypassable,
    energy_full_export_usd_yr: r.zone.energyExportUsdPerYear,
    peaks: r.zone.peaks,
  }));
  return {
    inputs_used: { ...inputs, pplNonbypass: nb === true, your_zones: yours ? Object.keys(yours) : [] },
    result: { zones: ranked, method: DATA.method, period: DATA.period },
    warnings,
    sources: [DATA.pricesSource, ...DATA.capacity.deliveryYears.map((y) => ({ title: 'PJM ' + y.year + ' Base Residual Auction', url: y.source })), { title: 'PJM NITS rates, ' + DATA.nits.effective, url: DATA.nits.source }, DATA.baseSaysSource],
  };
}

module.exports = L.endpoint({ usage, post });
