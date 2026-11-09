// POST /api/v1/home: one Texas home, one battery. Same math as the homepage.
'use strict';

const H = require('../../fleet-roi-core.js');
const L = require('../_lib.js');
const ZONE = require('../../data/zone-value.json');
const DEFAULTS = require('../../data/finance-defaults.json');
const ZIP = require('../../data/zip-launch.json');
const CURVE = require('../../data/ercot-dam-houston.json');
const FINANCING = require('../../data/financing.json');

const DATA = {
  zips: ZIP.zips,
  zipGenerated: ZIP.generated,
  zoneValue: ZONE,
  defaults: DEFAULTS,
  curve: CURVE,
  financing: FINANCING,
};

function usage() {
  return {
    tool: 'home',
    what: 'Fleet-operator economics for one installed battery at a Texas ZIP: wholesale time-shift from the ERCOT replay, an optional member bill-credit share, an optional utility contract in regulated territory, and debt from finance-core when that cash is modeled. A homeowner-buys comparison is included and labeled.',
    post: {
      content_types: ['application/json'],
      json_body: {
        query: 'A Texas ZIP (77002) or place name (Houston). A street address is used only for a ZIP inside it.',
        preset: 'bungalow | suburban | ranch. Default suburban. Annual kWh is the 2024 Texas average for suburban, and a labeled assumption for the other two.',
        zone: 'Optional ERCOT load zone. Required when the ZIP is served by a wires company that spans more than one zone (Oncor, TNMP) or when no zone is on file.',
        revenueCase: 'toll | merchant | stacked. Default ' + (DEFAULTS.revenueCaseDefault || 'merchant') + '.',
        fleetCount: 'Batteries in the fleet roll-up. Default is the public fleet size.',
        hardware: 'shelf (default) or base. base applies reductionPct to the off-the-shelf $/kWh. The percent is an assumption, not a Base Core price.',
        reductionPct: '0 to 100. Used only when hardware is base. Blank or omitted means 0.',
        billCreditPct: 'Percent of wholesale time-shift passed to the member. Blank means not modeled yet, not 0.',
        contractUsd: 'Dollars per battery per year from a utility contract. Blank means not modeled yet. Used in the vendor model.',
        marketMode: 'member or vendor. Used only when the ZIP lists both a retail-choice wires company and a municipal utility or co-op.',
      },
    },
    example: { query: '77002', preset: 'suburban', revenueCase: 'merchant' },
    docs: L.docsUrl('home'),
    page: L.SITE + '/',
  };
}

module.exports = L.endpoint({
  usage,
  post(parsed) {
    if (L.looksLikeJsonCsv(parsed)) throw L.jsonAsCsvError();
    const body = parsed && parsed.kind === 'json' ? L.objectBody(parsed) : null;
    if (!body) throw L.invalid(['Send JSON: { "query": "77002", "preset": "suburban" }.']);
    const warnings = L.unknownKeys(body, ['query', 'preset', 'zone', 'revenueCase', 'fleetCount', 'hardware', 'reductionPct', 'billCreditPct', 'contractUsd', 'marketMode']);
    const result = H.evaluate({
      query: body.query,
      preset: body.preset,
      zone: body.zone,
      revenueCase: body.revenueCase,
      fleetCount: body.fleetCount,
      hardware: body.hardware,
      reductionPct: body.reductionPct,
      billCreditPct: body.billCreditPct,
      contractUsd: body.contractUsd,
      marketMode: body.marketMode,
    }, DATA);
    if (!result.ok) throw L.invalid(result.errors);
    return {
      inputs_used: { query: body.query, preset: body.preset || 'suburban', zone: body.zone || null, revenueCase: body.revenueCase || DEFAULTS.revenueCaseDefault, fleetCount: body.fleetCount == null ? null : body.fleetCount },
      result,
      warnings,
      sources: result.sources || [],
    };
  },
});
