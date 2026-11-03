// GET /api/v1/health: is the API up, which build is it, and how old is the public data.
'use strict';

const L = require('../_lib.js');
const FIN = require('../../data/finance-defaults.json');
const ZONE = require('../../data/zone-value.json');
const LAUNCH = require('../../data/launch-steps.json');
const SUPPLY = require('../../data/supply.json');
const MAP = require('../../data/expansion-map.json');
const MARKET = require('../../data/market-states.json');
const ZIP = require('../../data/zip-launch.json');

const TOOLS = [
  ['finance', 'Debt, equity, CFADS and DSCR for one home battery, plus fleet and 100 MW roll-ups.'],
  ['launch', 'Weeks to a first install in a state, the critical path, and what email back-and-forth costs.'],
  ['supply', 'Which parts in your bill of materials will run short, and tariff cost per battery.'],
  ['market', 'States ranked for home batteries, and Texas zones ranked by $/battery/year.'],
  ['pitch', 'The outside-view pitch for one utility, and who to call first in its state.'],
  ['zip', 'Wires utility, permit office, interconnection path, and days to a first install for one US ZIP.'],
];

function version() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return sha ? String(sha).slice(0, 7) : 'local';
}

function body() {
  return {
    status: 'ok',
    version: version(),
    endpoints: [{ path: '/api/v1/health', methods: ['GET'], what: 'This check.' }].concat(TOOLS.map(([t, what]) => ({
      path: '/api/v1/' + t, methods: ['GET', 'POST'], what, usage: 'GET for the request shape and an example', docs: L.docsUrl(t),
    }))),
    data_as_of: {
      finance_defaults: FIN.built,
      zone_value: { built: ZONE.built, period_start: ZONE.period.start, period_end_exclusive: ZONE.period.endExclusive },
      launch_steps: LAUNCH.generated,
      supply: SUPPLY.generated,
      expansion_map: MAP.generated,
      market_states: MARKET.retrieved,
      zip_launch: ZIP.generated,
    },
    docs: L.SITE + '/docs/api.md',
    note: 'Public data only. Nothing you send is stored.',
  };
}

module.exports = async function health(req, res) {
  L.setCors(res);
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') { res.statusCode = 204; res.setHeader('Content-Length', '0'); res.end(); return; }
  if (method !== 'GET' && method !== 'HEAD') {
    res.setHeader('Allow', 'GET, OPTIONS');
    L.send(res, 405, { ok: false, errors: ['Method ' + method + ' is not allowed. Use GET.'] });
    return;
  }
  L.send(res, 200, body(), 'no-store');
};
