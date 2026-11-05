// POST /api/v1/market: rank the 50 states and DC for home batteries, and Texas zones by $/battery/year,
// the same way /market does. Scoring: market-score.js (market.js's scoring, made pure) on notes/score.js.
// Your-own-data validation: market-core.js. Data: data/expansion-map.json, data/market-states.json, data/zone-value.json.
'use strict';

const MC = require('../../market-core.js');
const MS = require('../../market-score.js');
const E = require('../../data/expansion-map.json');
const M = require('../../data/market-states.json');
const Z = require('../../data/zone-value.json');
const L = require('../_lib.js');

const ZONE_IDS = Z.zones.map((x) => x.id);
const KNOWN = ['weights', 'metrics', 'zones'];
const MAX_WEIGHT = 10;

function usage() {
  return {
    tool: 'market',
    what: 'Scores every state as a stack of percentile ranks (customer pull and market access), with your own weights and your own per-state metrics, and ranks Texas ERCOT load zones by what one battery earned from energy arbitrage.',
    post: {
      content_types: ['application/json', 'text/csv'],
      json_body: {
        weights: '{ factorId: weight } (optional; each weight a number from 0 to 10, the page slider runs 0 to 3; omitted factors keep their default, 1)',
        metrics: 'your per-state file (optional): { factors?: [{ key, label, higherIsBetter }], states: { "TX": { key: value } } }, or the same CSV text as a string. A metric needs values for at least ' + MC.MIN_STATES + ' states to count in the score; one with fewer is left out with a warning.',
        zones: 'your Texas zone file (optional): [{ zone, usd_per_year }], { "LZ_NORTH": 150 }, or CSV text "zone,usd_per_year". Zone ids in any case (lz_north works); values from 0 to ' + MC.ZONE_MAX + ' $ per battery per year, the same cap as arbPerYear on /finance.',
      },
      csv_body: 'The page\'s "Use your own data" file: either a state metrics file (a state column plus number columns; a header ending in " (lower is better)" ranks low values best) or a zone file (zone,usd_per_year). Weights cannot be sent with a CSV body; use JSON for that.',
      factors: E.factors.map((f) => ({ id: f.id, label: f.label, group: f.group, default_weight: f.weight })),
      your_factor_ids: 'Your metrics become factors with id "yours_" + the column name in snake case, for example "yours_install_cost_usd". You can weight them in the same request.',
      zones: ZONE_IDS,
    },
    example: { weights: { homes: 0 }, metrics: { factors: [{ key: 'install_cost_usd', higherIsBetter: false }], states: { TX: { install_cost_usd: 11500 }, FL: { install_cost_usd: 13200 }, GA: { install_cost_usd: 12800 }, AZ: { install_cost_usd: 12100 }, NC: { install_cost_usd: 13900 } } } },
    returns: 'states ranked best first with score (0 to 1), points (0 to 100, the number the page shows), tier (S, A, B, C, Later), rank (null when a state has no score, for example with every weight at 0), a plain-English reason and every factor\'s value and rank; Texas zones ranked by $/battery/year.',
    docs: L.docsUrl('market'),
    page: L.SITE + '/market',
  };
}

function asParsed(v, what) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const rows = L.parseCSV(v);
    if (!rows.length) throw L.invalid([what + ': the CSV text has no rows under its header.']);
    return { kind: 'csv', data: rows };
  }
  if (typeof v === 'object') return { kind: 'json', data: v };
  throw L.invalid([what + ' must be an object or CSV text.']);
}

// Request checks (input hardening): this endpoint reads only the body, so say so for any query parameter.
function queryWarnings(req) {
  return Object.keys(L.query(req)).map((k) => k === 'weights'
    ? 'Ignored "weights" in the query string. Send weights in a JSON body, with your CSV as a string: { "weights": { "homes": 0 }, "metrics": "state,...\\n" }.'
    : 'Ignored query string parameter "' + k + '". This endpoint reads only the request body.');
}

async function post(parsed, req) {
  if (L.looksLikeJsonCsv(parsed)) throw L.jsonAsCsvError();
  let statesFile = null, zonesFile = null, weightsIn = {}, warnings = queryWarnings(req), mp = 'metrics: ', zp = 'zones: ';
  if (parsed && parsed.kind === 'csv') {
    mp = zp = ''; // one CSV file: its messages need no field name
    const k = MC.detect(parsed);
    if (!k.kind) throw L.invalid([k.error]);
    if (k.kind === 'states') statesFile = parsed; else zonesFile = parsed;
  } else {
    const b = L.objectBody(parsed);
    warnings = warnings.concat(L.unknownKeys(b, KNOWN));
    if (b.weights != null && (typeof b.weights !== 'object' || Array.isArray(b.weights))) throw L.invalid(['weights must be an object of { factorId: weight }.']);
    weightsIn = b.weights || {};
    statesFile = asParsed(b.metrics, 'metrics');
    let z = b.zones;
    if (z != null && typeof z === 'object' && !('zones' in z)) z = { zones: z };
    zonesFile = asParsed(z, 'zones');
  }

  const errors = [];
  let yours = null, zones = null;
  if (statesFile) {
    if (statesFile.kind === 'json' && (Array.isArray(statesFile.data) || !statesFile.data.states)) errors.push('metrics needs a "states" object, like { "states": { "TX": { "install_cost_usd": 11500 } } }, or CSV text.');
    else {
      const r = MC.loadStates(statesFile);
      if (r.errors.length) errors.push(...r.errors.map((e) => mp + e));
      else { yours = r; warnings = warnings.concat(r.warnings.map((w) => mp + w)); }
    }
  }
  if (zonesFile) {
    const r = MC.loadZones(zonesFile, ZONE_IDS);
    if (r.errors.length) errors.push(...r.errors.map((e) => zp + e));
    else { zones = r.zones; warnings = warnings.concat(r.warnings.map((w) => zp + w)); }
  }

  const factorIds = MS.allFactors(E, yours).map((f) => f.id);
  const weights = {};
  for (const [written, w] of Object.entries(weightsIn)) {
    // A weight is a JSON number (or decimal text) from 0 to MAX_WEIGHT; "" and null are not 0.
    // Factor ids match in any case (HOMES is homes); an unknown id names the closest one.
    const n = L.parseNumber(w, { min: 0, max: MAX_WEIGHT });
    const id = L.anyCase(written, factorIds);
    if (!id) { const near = L.closest(written, factorIds); errors.push('weights: unknown factor "' + L.clip(written) + '".' + (near ? ' Did you mean "' + near + '"?' : '') + ' Use one of ' + factorIds.join(', ') + '.'); }
    else if (L.hasOwn(weights, id)) errors.push('weights: ' + id + ' is sent twice (as "' + L.clip(written) + '" too). Send it once.');
    else if (!n.ok) errors.push('weights: ' + id + ' must be a number from 0 to ' + MAX_WEIGHT + ' (the page slider runs 0 to 3), got ' + JSON.stringify(typeof w === 'string' ? L.clip(w) : w) + '.');
    else weights[id] = n.value;
  }
  if (errors.length) throw L.invalid(errors);

  const out = MS.scoreStates(E, M, { weights, yours });
  if (!out.states.some((s) => s.tier)) warnings.push('No state has a score. Every weight is 0, or no weighted factor has data.');
  const z = zones ? MC.applyZones(Z, zones) : MC.applyZones(Z, {});

  const tiers = MS.TIERS.map((t) => ({ tier: t.id, label: t.label, states: out.states.filter((s) => s.tier === t.id).map((s) => s.abbr) })).filter((t) => t.states.length);

  return {
    inputs_used: { weights: out.weights, your_factors: yours ? yours.factors.map((f) => f.id) : [], your_zones: zones ? Object.keys(zones) : [] },
    result: {
      method: 'Each factor is a percentile rank among the states that have a value (0 worst, 1 best; lower-is-better factors are flipped). The score is the weighted average of those ranks over the factors a state has, shown as points out of 100. Tiers: S 68+, A 58+, B 48+, C 38+, Later below.',
      factors: out.factors,
      tiers,
      states: out.states,
      texas_zones: {
        about: 'What one Base Core (20 kW / 39.2 kWh) would have earned in each ERCOT load zone, ' + Z.period.start + ' to ' + Z.period.endExclusive + ' (end not included), on one fixed daily clock: ' + Z.schedule.label + ', at real-time load zone prices. Only load zones are ranked; trading hubs are not places a home battery earns. Energy arbitrage only. Not Base revenue.',
        schedule: { charge_hours: Z.schedule.charge, discharge_hours: Z.schedule.discharge, note: 'Clock hours [start, end) Central; hour h is ERCOT hour ending h+1.' },
        zones: z.zones.map((x, i) => ({ rank: i + 1, id: x.id, kind: x.kind, usd_per_battery_year: x.usdPerYear, yours: x.yours, public_usd_per_battery_year: x.yours ? x.publicUsdPerYear : x.usdPerYear })),
      },
    },
    warnings,
    sources: E.sources.map((s) => ({ title: s.title, url: s.url || null }))
      .concat([M.sources.reliability, M.sources.price].map((s) => ({ title: s.title, url: s.url })))
      .concat([{ title: 'Data files', url: L.SITE + '/data/expansion-map.json' }, { title: 'Texas zone values and method', url: L.SITE + '/data/zone-value.json' }]),
  };
}

module.exports = L.endpoint({ usage, post });
