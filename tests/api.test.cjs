// The /api/v1 handlers, called with mock requests. Each POST result is checked against the
// core functions the pages use, on the same inputs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const F = require('../finance-core.js');
const LC = require('../launch-core.js');
const S = require('../supply-core.js');
const P = require('../pitch-core.js');
const FIN = require('../data/finance-defaults.json');
const ZONES = require('../data/zone-value.json');
const LAUNCH = require('../data/launch-steps.json');
const MAP = require('../data/expansion-map.json');
const SUPPLY = require('../data/supply.json');

const H = {
  health: require('../api/v1/health.js'),
  finance: require('../api/v1/finance.js'),
  launch: require('../api/v1/launch.js'),
  supply: require('../api/v1/supply.js'),
  market: require('../api/v1/market.js'),
  pitch: require('../api/v1/pitch.js'),
};
const TOOLS = ['finance', 'launch', 'supply', 'market', 'pitch'];
const JSON_CT = { 'content-type': 'application/json' };
const CSV_CT = { 'content-type': 'text/csv' };

function mockRes() {
  return {
    statusCode: 0, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b; },
    json() { return JSON.parse(this.body); },
  };
}
async function call(tool, method, body, headers = JSON_CT, url = '/api/v1/' + tool) {
  const res = mockRes();
  await H[tool]({ method, headers, body, url }, res);
  return res;
}
const post = (tool, body, headers, url) => call(tool, 'POST', body, headers, url);
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

// ---------- health ----------

test('health: status, version, endpoints, data dates, note', async () => {
  const old = process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  const r = await call('health', 'GET');
  assert.equal(r.statusCode, 200);
  const j = r.json();
  assert.equal(j.status, 'ok');
  assert.equal(j.version, 'local');
  assert.deepEqual(j.endpoints.map((e) => e.path), ['/api/v1/health'].concat(TOOLS.map((t) => '/api/v1/' + t)));
  assert.equal(j.data_as_of.finance_defaults, FIN.built);
  assert.equal(j.data_as_of.zone_value.period_start, ZONES.period.start);
  assert.equal(j.data_as_of.launch_steps, LAUNCH.generated);
  assert.equal(j.data_as_of.expansion_map, MAP.generated);
  assert.equal(j.note, 'Public data only. Nothing you send is stored.');
  assert.equal(r.headers['access-control-allow-origin'], '*');

  process.env.VERCEL_GIT_COMMIT_SHA = '23181e5abcdef0123456789';
  assert.equal((await call('health', 'GET')).json().version, '23181e5');
  if (old === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA; else process.env.VERCEL_GIT_COMMIT_SHA = old;

  assert.equal((await call('health', 'POST', {})).statusCode, 405);
});

// ---------- GET usage, CORS, methods ----------

test('GET on each tool returns usage with an example and the docs link', async () => {
  for (const t of TOOLS) {
    const r = await call(t, 'GET');
    assert.equal(r.statusCode, 200, t);
    const j = r.json();
    assert.equal(j.tool, t);
    assert.ok(j.what && j.post && j.example, t);
    assert.equal(j.docs, 'https://megawatt.fun/plug-and-play#' + t);
    assert.match(r.headers['cache-control'], /s-maxage=3600/);
    assert.equal(r.headers['access-control-allow-origin'], '*');
  }
});

test('each GET example runs as a POST', async () => {
  for (const t of TOOLS) {
    const ex = (await call(t, 'GET')).json().example;
    const r = await post(t, ex);
    assert.equal(r.statusCode, 200, t + ': ' + r.body);
    const j = r.json();
    assert.equal(j.ok, true);
    assert.ok(j.inputs_used && j.result && Array.isArray(j.warnings) && Array.isArray(j.sources), t);
    assert.equal(r.headers['cache-control'], 'no-store');
  }
});

test('OPTIONS is 204 with CORS headers', async () => {
  for (const t of ['health'].concat(TOOLS)) {
    const r = await call(t, 'OPTIONS');
    assert.equal(r.statusCode, 204, t);
    assert.equal(r.headers['access-control-allow-origin'], '*');
    assert.match(r.headers['access-control-allow-methods'], /GET, POST, OPTIONS/);
    assert.match(r.headers['access-control-allow-headers'], /Content-Type/);
  }
});

test('other methods are 405', async () => {
  for (const t of TOOLS) {
    const r = await call(t, 'PUT', {});
    assert.equal(r.statusCode, 405, t);
    assert.equal(r.json().ok, false);
    assert.match(r.headers.allow, /POST/);
  }
});

// ---------- body handling ----------

test('bad JSON is 400 with a clear message', async () => {
  for (const t of TOOLS) {
    const r = await post(t, '{"inputs": {', JSON_CT);
    assert.equal(r.statusCode, 400, t);
    assert.match(r.json().errors[0], /not valid JSON/);
  }
  // Vercel's lazy req.body throws on bad JSON; that is a 400 too.
  const req = { method: 'POST', headers: JSON_CT, url: '/' };
  Object.defineProperty(req, 'body', { get() { throw new Error('Invalid JSON'); } });
  const res = mockRes();
  await H.finance(req, res);
  assert.equal(res.statusCode, 400);
});

test('a JSON body that is not an object is 400', async () => {
  const r = await post('launch', [1, 2]);
  assert.equal(r.statusCode, 400);
});

test('bodies over 1 MB are 413', async () => {
  const big = 'x'.repeat(1024 * 1024 + 10);
  for (const t of TOOLS) {
    assert.equal((await post(t, big, CSV_CT)).statusCode, 413, t + ' string');
  }
  assert.equal((await post('finance', { inputs: { note: big } })).statusCode, 413, 'object');
  assert.equal((await post('finance', undefined, { 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024) })).statusCode, 413, 'content-length');
  // A raw stream with no parsed body.
  const req = Readable.from([Buffer.from(big)]);
  Object.assign(req, { method: 'POST', headers: CSV_CT, url: '/' });
  const res = mockRes();
  await H.supply(req, res);
  assert.equal(res.statusCode, 413);
});

test('a raw request stream is read like a parsed body', async () => {
  const req = Readable.from([Buffer.from(JSON.stringify({ state: 'TX' }))]);
  Object.assign(req, { method: 'POST', headers: JSON_CT, url: '/' });
  const res = mockRes();
  await H.launch(req, res);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().result.state, 'TX');
});

// ---------- finance ----------

// The page's readInputs() on the public defaults, with overrides, then F.normalize.
function pageInputs(over = {}, zoneId = FIN.zoneDefault, arb = null) {
  const raw = { revenueCase: over.revenueCase || FIN.revenueCaseDefault };
  for (const f of FIN.groups.flatMap((g) => g.fields)) raw[f.key] = over[f.key] != null ? over[f.key] : f.value;
  raw.arbPerYear = arb != null ? arb : ZONES.zones.find((z) => z.id === zoneId).usdPerYear;
  return F.normalize(raw);
}

test('finance POST matches F.sizeDebt on the same inputs', async () => {
  const r = await post('finance', { inputs: { capexPerKwh: 280, tollPerKwYear: 90, ratePct: 8.5 }, revenueCase: 'stacked', zone: 'LZ_HOUSTON' });
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json();
  const want = F.sizeDebt(pageInputs({ capexPerKwh: 280, tollPerKwYear: 90, ratePct: 8.5, revenueCase: 'stacked' }, 'LZ_HOUSTON'));
  near(j.result.debt, want.debt);
  near(j.result.equity, want.equity);
  near(j.result.debt_service, want.debtService);
  near(j.result.year1_cfads, want.year1Cfads);
  near(j.result.min_dscr, want.minDscr);
  assert.equal(j.result.binding, want.binding);
  assert.equal(j.result.cfads_by_year.length, want.years.length);
  near(j.result.cfads_by_year[3].cfads, want.years[3].cfads);
  assert.deepEqual(j.result.explain.slice(0, F.explain(want).length), F.explain(want));
  assert.deepEqual(j.inputs_used.yours.sort(), ['capexPerKwh', 'ratePct', 'tollPerKwYear']);
  assert.equal(j.inputs_used.zone, 'LZ_HOUSTON');
  // Fleet and 100 MW roll-ups.
  near(j.result.fleet.input.debt, want.debt * 30000, 1e-3);
  assert.equal(j.result.fleet.mw_100.batteries, F.batteriesForMw(100, 20));
});

test('finance with no body is the public default, and arbPerYear replaces the zone', async () => {
  const d = (await post('finance', undefined, {})).json();
  near(d.result.debt, F.sizeDebt(pageInputs()).debt);
  assert.equal(d.result.binding, 'dscr');
  const a = (await post('finance', { arbPerYear: 400, revenueCase: 'merchant' })).json();
  near(a.result.debt, F.sizeDebt(pageInputs({ revenueCase: 'merchant' }, null, 400)).debt);
  assert.equal(a.inputs_used.zone, null);
});

test('finance CSV body gives the same answer as JSON', async () => {
  const csv = 'key,value\ncapexPerKwh,280\ntollPerKwYear,90\nratePct,8.5\nrevenueCase,toll\n';
  const c = (await post('finance', csv, CSV_CT)).json();
  const j = (await post('finance', { inputs: { capexPerKwh: 280, tollPerKwYear: 90, ratePct: 8.5 }, revenueCase: 'toll' })).json();
  assert.equal(c.ok, true);
  near(c.result.debt, j.result.debt);
});

test('finance bad input is 422 with row-named errors', async () => {
  const r = await post('finance', 'key,value\ncapexPerKwh,abc\nbogus,1\nadvancePct,150\nzone,LZ_MARS\n', CSV_CT);
  assert.equal(r.statusCode, 422);
  const e = r.json().errors;
  assert.ok(e.includes('Row 2: capexPerKwh is not a number: "abc".'), e.join(' | '));
  assert.ok(e.some((x) => x.startsWith('Row 3: unknown key "bogus"')));
  assert.ok(e.includes('Row 4: advancePct must be at most 100.'));
  assert.ok(e.some((x) => x.startsWith('Row 5: zone must be one of')));
  const j = await post('finance', { revenueCase: 'lease' });
  assert.equal(j.statusCode, 422);
  assert.match(j.json().errors[0], /revenueCase must be one of toll, merchant, stacked/);
});

// ---------- launch ----------

test('launch POST matches the core schedule, best step and email tennis', async () => {
  const r = await post('launch', { state: 'TX', case: 'high', rounds: 2 });
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json().result;
  const sug = LC.suggestPath(MAP.states.find((s) => s.abbr === 'TX'));
  assert.equal(j.path, sug.path);
  const list = LC.resolveSteps(LAUNCH, sug.path, 'TX');
  const fast = LC.schedule(list, 'low'), slow = LC.schedule(list, 'high');
  assert.equal(j.total_weeks.fast, fast.total);
  assert.equal(j.total_weeks.slow, slow.total);
  assert.equal(j.first_install_weeks.fast, fast.steps.first_installs.ef);
  assert.equal(j.first_install_weeks.slow, slow.steps.first_installs.ef);
  assert.deepEqual(j.critical_path.map((x) => x.id), slow.criticalPath);
  const lever = LC.bestShortening(list, 'high');
  assert.equal(j.best_step_to_shorten.id, lever.best.id);
  assert.equal(j.best_step_to_shorten.saved_weeks, lever.best.saved);
  const cost = LC.tennisCost(list, LC.resolveTennis(LAUNCH, list, 'TX', sug.path), 2, 'high');
  assert.equal(j.email_tennis.added_weeks_first_install, cost.addedFirst);
  assert.equal(j.email_tennis.worst_loop.step, cost.worst.step);
});

test('launch defaults: GA, suggested path, fast case, one round', async () => {
  const j = (await post('launch', {})).json();
  assert.deepEqual(j.inputs_used, { state: 'GA', path: LC.suggestPath(MAP.states.find((s) => s.abbr === 'GA')).path, case: 'low', rounds: 1, your_steps: [] });
  const w = (await post('launch', { state: 'GA', path: 'retail' })).json();
  assert.ok(w.warnings.some((x) => x.startsWith('Retail provider is not available here')));
});

test('launch with your own steps, as CSV with options in the query', async () => {
  const csv = 'path,id,name,owner,low,high,depends_on,round_weeks,note\n' +
    'retail,entity,Form the company,Legal,1,3,,,\n' +
    'retail,license,Retail license,Regulatory,10,14,entity,3,Filed with staff\n' +
    'retail,edi,Market testing,Ops,6,9,license,,\n' +
    'retail,first_installs,First installs,Field,2,3,license;edi,,\n';
  const r = await post('launch', csv, CSV_CT, '/api/v1/launch?state=TX&path=retail&rounds=0');
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json();
  assert.equal(j.result.total_weeks.fast, 19);
  assert.equal(j.result.total_weeks.slow, 29);
  assert.equal(j.result.path_from_your_file, true);
  assert.deepEqual(j.inputs_used.your_steps, ['retail']);
  assert.equal(j.result.email_tennis.rounds, 0);
  // The same steps as JSON rows, with depends_on as a list.
  const rows = [
    { path: 'retail', id: 'a', name: 'A', owner: 'X', low: 2, high: 4, depends_on: [] },
    { path: 'retail', id: 'first_installs', name: 'B', owner: 'X', low: 3, high: 5, depends_on: ['a'] },
  ];
  const k = (await post('launch', { state: 'TX', steps: rows })).json();
  assert.equal(k.result.first_install_weeks.fast, 5);
  assert.equal(k.result.first_install_weeks.slow, 9);
});

test('launch bad input is 422 with row-named errors', async () => {
  const csv = 'path,id,name,owner,low,high,depends_on\nretail,a,A,X,abc,3,\nretail,b,B,X,2,1,nope\n';
  const r = await post('launch', csv, CSV_CT, '/api/v1/launch?state=TX');
  assert.equal(r.statusCode, 422);
  const e = r.json().errors;
  assert.ok(e.includes('Row 2: low for a is not a number: "abc".'), e.join(' | '));
  assert.ok(e.includes('Row 3: high (1) for b is less than low (2).'), e.join(' | '));
  const s = await post('launch', { state: 'ZZ', rounds: 9, case: 'medium' });
  assert.equal(s.statusCode, 422);
  assert.equal(s.json().errors.length, 3);
});

// ---------- supply ----------

const BOM = [
  { part: 'Inverter module', category: 'power_electronics', supplier: 'Example Supplier A', country: 'Germany', lead_time_weeks: 30, on_hand_weeks: 12, second_source: 'no', tariff_pct: 25, unit_cost_usd: 900, qty_per_unit: 1 },
  { part: 'LFP cell', category: 'cells', supplier: 'Example Supplier C', country: 'China', lead_time_weeks: 16, on_hand_weeks: 8, second_source: 'yes', tariff_pct: 55, unit_cost_usd: 40, qty_per_unit: 12 },
  { part: 'Steel enclosure', category: 'metals', lead_time_weeks: 10, on_hand_weeks: 14, second_source: 'yes' },
];

test('supply POST matches analyze()', async () => {
  const r = await post('supply', { parts: BOM });
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json().result;
  const want = S.analyze(S.validate({ kind: 'json', data: { parts: BOM } }, SUPPLY.parts.map((p) => p.id)).rows);
  assert.deepEqual(j.rows.map((x) => x.part), want.rows.map((x) => x.part));
  assert.deepEqual(j.rows.map((x) => x.gap_weeks), want.rows.map((x) => x.gap));
  assert.deepEqual(j.rows.map((x) => x.flags), want.rows.map((x) => x.flags));
  assert.equal(j.totals.at_risk, want.totals.atRisk);
  near(j.totals.tariff_per_battery, want.totals.tariffPerBattery);
  assert.deepEqual(j.totals.longest_gap, want.totals.longest);
  assert.equal(j.rows[0].public_research.url, 'https://megawatt.fun/supply#part-power_electronics');
  assert.match(j.summary, /^2 of 3 parts will run short\./);
});

test('supply CSV body and bare list give the same rows', async () => {
  const csv = 'part,category,supplier,country,lead_time_weeks,on_hand_weeks,second_source,tariff_pct,unit_cost_usd,qty_per_unit,note\n' +
    'Inverter module,power_electronics,Example Supplier A,Germany,30,12,no,25,900,1,\n' +
    'LFP cell,cells,Example Supplier C,China,16,8,yes,55,40,12,\n' +
    'Steel enclosure,metals,,,10,14,yes,,,,\n';
  const c = (await post('supply', csv, CSV_CT)).json();
  const l = (await post('supply', BOM)).json();
  assert.deepEqual(c.result.totals, l.result.totals);
});

test('supply bad input is 422 with row-named errors', async () => {
  const r = await post('supply', 'part,category,lead_time_weeks,second_source\nA,cells,,maybe\nB,rockets,4,\n', CSV_CT);
  assert.equal(r.statusCode, 422);
  const e = r.json().errors;
  assert.ok(e.includes('Row 2: missing lead_time_weeks.'), e.join(' | '));
  assert.ok(e.includes('Row 2: second_source must be yes or no, not "maybe".'));
  assert.ok(e.some((x) => x.startsWith('Row 3: unknown category "rockets"')));
  const j = await post('supply', { parts: [{ part: 'X', category: 'cells', lead_time_weeks: -1 }] });
  assert.deepEqual(j.json().errors, ['Part 1: lead_time_weeks cannot be negative.']);
  assert.equal((await post('supply', undefined, {})).statusCode, 422);
});

// ---------- market ----------

// Expected values are from the narrative that analysis/build_expansion.py (an independent Python
// implementation of the same score) wrote into data/expansion-map.json.
test('market default weights match the published score: Michigan 76, Texas 71, Maryland 69', async () => {
  const j = (await post('market', {})).json().result;
  assert.equal(j.states.length, 51);
  assert.deepEqual(j.states.slice(0, 3).map((s) => [s.name, s.points, s.tier]), [['Michigan', 76, 'S'], ['Texas', 71, 'S'], ['Maryland', 69, 'S']]);
  const at = (n) => j.states.find((s) => s.name === n);
  assert.deepEqual([at('Illinois').rank, at('Illinois').points], [8, 60]);
  assert.deepEqual([at('Georgia').rank, at('Georgia').points], [30, 47]);
  assert.deepEqual([at('Connecticut').rank, at('Connecticut').points], [19, 54]);
  assert.match(at('Michigan').why, /^Leads on outage duration/);
  assert.equal(j.texas_zones.zones[0].id, 'LZ_LCRA');
});

test('market with homes weighted 0 matches the published re-ranking: Michigan 75, Maryland 70, Texas 68', async () => {
  const j = (await post('market', { weights: { homes: 0 } })).json().result;
  assert.deepEqual(j.states.slice(0, 3).map((s) => [s.name, s.points]), [['Michigan', 75], ['Maryland', 70], ['Texas', 68]]);
});

test('market adds your own metrics and zones', async () => {
  const r = await post('market', {
    metrics: 'state,install_cost_usd (lower is better)\nTX,11500\nFL,13200\nGeorgia,12800\n',
    zones: { LZ_WEST: 500 },
    weights: { yours_install_cost_usd: 3 },
  });
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json();
  assert.deepEqual(j.inputs_used.your_factors, ['yours_install_cost_usd']);
  const tx = j.result.states.find((s) => s.abbr === 'TX');
  assert.equal(tx.factors.yours_install_cost_usd.value, 11500);
  assert.equal(tx.factors.yours_install_cost_usd.rank, 1);
  assert.equal(j.result.texas_zones.zones[0].id, 'LZ_WEST');
  assert.equal(j.result.texas_zones.zones[0].yours, true);
  assert.ok(j.warnings.some((w) => w.startsWith('metrics: "install_cost_usd" has no value for 48 states')));
});

test('market CSV body is detected as a zone file', async () => {
  const j = (await post('market', 'zone,usd_per_year\nLZ_NORTH,1\n', CSV_CT)).json();
  assert.equal(j.result.texas_zones.zones.at(-1).id, 'LZ_NORTH');
});

test('market bad input is 422 with row-named errors', async () => {
  const r = await post('market', { metrics: 'state,cac\nTX,10\nAtlantis,5\nFL,lots\n', weights: { vibes: 2 } });
  assert.equal(r.statusCode, 422);
  const e = r.json().errors;
  assert.ok(e.includes('metrics: Row 3: unknown state "Atlantis". Use a two-letter code such as TX, or the full name.'), e.join(' | '));
  assert.ok(e.includes('metrics: Row 4, column "cac": "lots" is not a number.'));
  assert.ok(e.some((x) => x.startsWith('weights: unknown factor "vibes"')));
  const z = await post('market', 'zone,usd_per_year\nLZ_MARS,1\n', CSV_CT);
  assert.equal(z.statusCode, 422);
  assert.match(z.json().errors[0], /^Row 2: unknown zone "LZ_MARS"/);
});

// ---------- pitch ----------

test('pitch POST matches the core offer rule, headline and call ranking', async () => {
  const r = await post('pitch', { utility: 'CoServ Electric' });
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json().result;
  const u = MAP.utilities.find((x) => x.id === '5078-TX');
  const pcts = P.signalPercentiles(u, MAP.utilities);
  const pick = P.pickOffer(u, pcts, { largeLoads: false, terms: P.publicTerms() });
  assert.equal(j.utility.id, '5078-TX');
  assert.equal(j.headline, P.headline(u, P.strongestSignal(pcts)));
  assert.equal(j.offer.id, pick.offer.id);
  assert.equal(j.offer.rule, pick.rule);
  assert.deepEqual(j.questions, P.questions(u, pick, P.publicTerms()));
  assert.equal(j.program.batteries, 5000);
  assert.deepEqual(j.landed_cost.rows[0].this_program_usd, P.landedCost(196, P.CLAIMS_TABLE[0]));
  const top = P.rankState(MAP.utilities, 'TX', 10);
  assert.deepEqual(j.who_to_call_first.rows.slice(0, 10).map((x) => x.id), top.map((x) => x.id));
  assert.ok(j.who_to_call_first.rows.some((x) => x.current));
});

test('pitch with your terms, targets and a large-load queue', async () => {
  const r = await post('pitch', { utility: '5078-TX', largeLoads: true, terms: { tollPerKwYear: 85, termYears: 10, kwPerHome: 25 }, targets: [{ utility: 'Austin Energy', status: 'in talks', owner: 'Ben' }] });
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json();
  assert.equal(j.result.offer.id, 'speed');
  assert.equal(j.result.program.batteries, 4000);
  assert.equal(j.result.your_offer.per_year_usd, 100 * 1000 * 85);
  assert.equal(j.result.your_offer.total_usd, 100 * 1000 * 85 * 10);
  assert.equal(j.result.who_to_call_first.rows[0].id, '1015-TX');
  assert.deepEqual(j.inputs_used.yours.sort(), ['kwPerHome', 'termYears', 'tollPerKwYear']);
});

test('pitch CSV body with the utility in the query', async () => {
  const csv = 'key,value,utility,status,owner,note\ntollPerKwYear,85,,,,\n,,5078-TX,signed,Ana,Pilot live\n';
  const j = (await post('pitch', csv, CSV_CT, '/api/v1/pitch?utility=5078-TX')).json();
  assert.equal(j.ok, true);
  assert.equal(j.result.your_target.status, 'signed');
});

test('pitch bad input is 422 with clear errors', async () => {
  assert.match((await post('pitch', {})).json().errors[0], /^utility is required/);
  const u = await post('pitch', { utility: 'Austin Enrgy', state: 'TX' });
  assert.equal(u.statusCode, 422);
  assert.match(u.json().errors[0], /Did you mean/);
  const t = await post('pitch', 'key,value\ncostLowPerKwh,9000\nbogus,1\n', CSV_CT, '/api/v1/pitch?utility=5078-TX');
  assert.equal(t.statusCode, 422);
  const e = t.json().errors;
  assert.ok(e.some((x) => x.startsWith('Row 2: costLowPerKwh must be between 1 and 5000')), e.join(' | '));
  assert.ok(e.some((x) => x.startsWith('Row 3: unknown key "bogus"')));
});
