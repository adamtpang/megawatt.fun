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
  const fleetCount = FIN.groups.flatMap((g) => g.fields).find((f) => f.key === 'fleetCount').value;
  assert.equal(fleetCount, 1000);
  near(j.result.fleet.input.debt, want.debt * fleetCount, 1e-3);
  near(j.result.fleet.input.itc, want.itc * fleetCount, 1e-3);
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
  assert.ok(e.includes('Row 2: capexPerKwh is not a number: "abc". Use plain decimal digits.'), e.join(' | '));
  assert.ok(e.some((x) => x.startsWith('Row 3: unknown key "bogus"')));
  assert.ok(e.includes('Row 4: advancePct must be at most 100.'));
  assert.ok(e.some((x) => x.startsWith('Row 5: zone must be one of')));
  const j = await post('finance', { revenueCase: 'lease' });
  assert.equal(j.statusCode, 422);
  assert.match(j.json().errors[0], /revenueCase must be one of toll, merchant, stacked/);
});

test('finance default: merchant case, tax credit applied, toll placeholder not counted', async () => {
  const j = (await post('finance', undefined, {})).json();
  assert.equal(j.result.revenue_case, 'merchant');
  assert.equal(j.result.itc_rate, 0.3);
  near(j.result.itc, 0.3 * j.result.capex);
  near(j.result.net_capex, j.result.capex - j.result.upfront - j.result.itc);
  near(j.result.equity, j.result.net_capex - j.result.debt);
  assert.equal(j.result.year1_revenue_lines.counted.toll, 0);
  assert.match(j.result.itc_treatment, /6418/);
  assert.equal(j.result.binding_text, F.bindingText(F.sizeDebt(pageInputs())));
  assert.match(j.result.explain[0], /biggest revenue line/);
  const noToll = (await post('finance', { inputs: { tollPerKwYear: 0 } })).json();
  near(noToll.result.debt, j.result.debt);
  const usage = (await call('finance', 'GET')).json();
  for (const k of usage.post.input_keys) assert.ok(Number.isFinite(k.min) && Number.isFinite(k.max), k.key);
});

test('finance: __proto__, constructor and toString keys are 422 and pollute nothing', async () => {
  const bodies = [
    JSON.parse('{"inputs": {"__proto__": {"value": 1, "kind": "yours"}}}'),
    JSON.parse('{"inputs": {"constructor": 5}}'),
    JSON.parse('{"inputs": {"toString": 5, "hasOwnProperty": 1}}'),
    '{"inputs": {"__proto__": 5}}',
  ];
  for (const b of bodies) {
    const r = await post('finance', b);
    assert.equal(r.statusCode, 422, JSON.stringify(b));
    assert.ok(r.json().errors.some((e) => /unknown key/.test(e)), r.body);
  }
  const c = await post('finance', 'key,value\n__proto__,5\nconstructor,1\n', CSV_CT);
  assert.equal(c.statusCode, 422);
  assert.deepEqual(c.json().errors.map((e) => e.split('.')[0]), ['Row 2: unknown key "__proto__"', 'Row 3: unknown key "constructor"']);
  assert.equal(({}).value, undefined);
  assert.equal(({}).kind, undefined);
  // A normal request still works after the attempts.
  assert.equal((await post('finance', undefined, {})).statusCode, 200);
});

test('finance: hex, huge, infinite and fractional fleet values are 422', async () => {
  const cases = [
    [{ inputs: { tollPerKwYear: '0x10' } }, /tollPerKwYear is not a number: "0x10"/],
    [{ inputs: { kwh: 1e308 } }, /kwh must be at most 1000/],
    [{ inputs: { capexPerKwh: 'Infinity' } }, /capexPerKwh is not a number/],
    [{ inputs: { ratePct: [8] } }, /ratePct must be a single value/],
    [{ fleetCount: 2.5 }, /fleetCount must be a whole number/],
    [{ fleetCount: 0 }, /fleetCount must be at least 1/],
    [{ fleetCount: 1e12 }, /fleetCount must be at most 10000000/],
    [{ arbPerYear: 1e308 }, /arbPerYear must be at most/],
    [{ inputs: { itcPct: 90 } }, /itcPct must be at most 70/],
  ];
  for (const [body, re] of cases) {
    const r = await post('finance', body);
    assert.equal(r.statusCode, 422, JSON.stringify(body));
    assert.match(r.json().errors.join(' '), re);
  }
  const ok = (await post('finance', { fleetCount: 2500 })).json();
  assert.equal(ok.result.fleet.input.batteries, 2500);
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
  assert.equal(j.texas_zones.zones[0].id, 'LZ_WEST');
  assert.ok(j.texas_zones.zones.every((z) => z.kind === 'load zone' && z.id.startsWith('LZ_')));
  assert.deepEqual([j.texas_zones.schedule.charge_hours, j.texas_zones.schedule.discharge_hours], [[10, 14], [19, 21]]);
  assert.doesNotMatch(j.texas_zones.about, /5 to 9 PM|at night/);
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

// ==========================================================================================
// Input hardening: launch, supply, market (break-test of the live API, 2026-11-03).
// This block is self-contained; finance and pitch cases live in their own sections above.
// ==========================================================================================

const LIB = require('../api/_lib.js');

test('hardening: _lib parseNumber takes plain decimals only, finite and within bounds', () => {
  assert.deepEqual(LIB.parseNumber(2), { ok: true, value: 2 });
  assert.deepEqual(LIB.parseNumber(' 2.5 '), { ok: true, value: 2.5 });
  assert.deepEqual(LIB.parseNumber('$1,200', { strip: /[$,]/g }), { ok: true, value: 1200 });
  for (const bad of ['0x10', '0b1', 'Infinity', 'NaN', '1e', '', ' ', true, null, [1], { a: 1 }, undefined]) {
    assert.equal(LIB.parseNumber(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(LIB.parseNumber(1e308, { max: 10 }).error, 'must be at most 10.');
  assert.equal(LIB.parseNumber(-1, { min: 0 }).error, 'must be at least 0.');
  assert.equal(LIB.parseNumber(1.5, { integer: true }).error, 'must be a whole number.');
});

test('hardening: _lib own-key helpers never reach Object.prototype', () => {
  const o = { a: 1 };
  assert.equal(LIB.hasOwn(o, 'a'), true);
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(LIB.hasOwn(o, k), false, k);
    assert.equal(LIB.getOwn(o, k), undefined, k);
    assert.equal(LIB.isReservedKey(k), true, k);
  }
  assert.equal(LIB.isReservedKey('prototype'), true);
  assert.equal(LIB.isReservedKey('first_installs'), false);
  assert.equal(LIB.byKey([{ id: 'x' }], (r) => r.id).get('constructor'), undefined);
});

const STEP_HEAD = 'path,id,name,owner,low,high,depends_on,round_weeks,note\n';

test('hardening launch: reserved step ids are a 422 naming the row, never a 500', async () => {
  for (const id of ['__proto__', 'constructor', 'prototype', 'toString']) {
    const csv = STEP_HEAD + 'retail,' + id + ',X,O,1,2,,1,\nretail,first_installs,Y,O,1,2,' + id + ',,\n';
    const r = await post('launch', csv, CSV_CT, '/api/v1/launch?state=TX');
    assert.equal(r.statusCode, 422, id + ': ' + r.body);
    assert.match(r.json().errors[0], new RegExp('^Row 2: id "' + id + '" is a reserved name'));
  }
  const j = await post('launch', { state: 'TX', steps: { paths: { retail: { steps: [{ id: '__proto__', name: 'X', owner: 'O', low: 1, high: 2 }] } } } });
  assert.equal(j.statusCode, 422);
  assert.match(j.json().errors[0], /^retail step 1: id "__proto__" is a reserved name/);
});

test('hardening launch: options need the right JSON types', async () => {
  const r = await post('launch', { rounds: true, state: ['TX'], path: 7, case: { x: 1 } });
  assert.equal(r.statusCode, 422);
  const e = r.json().errors;
  assert.ok(e.includes('state must be text, for example "TX", got a list.'), e.join(' | '));
  assert.ok(e.includes('rounds must be a number, for example 1, got true.'), e.join(' | '));
  assert.ok(e.some((x) => x.startsWith('path must be text')));
  assert.ok(e.some((x) => x.startsWith('case must be text')));
  assert.equal((await post('launch', { rounds: '2' })).statusCode, 422);
  assert.equal((await post('launch', { rounds: 1.5 })).statusCode, 422);
  assert.equal((await post('launch', {}, JSON_CT, '/api/v1/launch?rounds=0x2')).statusCode, 422);
  assert.equal((await post('launch', { state: 'TX', path: 'constructor' })).statusCode, 422);
  assert.equal((await post('launch', { state: 'CONSTRUCTOR' })).statusCode, 422);
  // Query strings are text, and rounds parses from them.
  const q = (await post('launch', {}, JSON_CT, '/api/v1/launch?state=tx&rounds=2')).json();
  assert.deepEqual([q.inputs_used.state, q.inputs_used.rounds], ['TX', 2]);
});

test('hardening launch: a body option that conflicts with the query string is a 422', async () => {
  const r = await post('launch', { state: 'TX' }, JSON_CT, '/api/v1/launch?state=CA');
  assert.equal(r.statusCode, 422);
  assert.deepEqual(r.json().errors, ['state is "TX" in the body but "CA" in the query string. Send it in one place.']);
  const k = await post('launch', { rounds: 2 }, JSON_CT, '/api/v1/launch?rounds=1');
  assert.equal(k.statusCode, 422);
  // The same value in both places (any case) is fine.
  const ok = await post('launch', { state: 'tx', path: 'RETAIL' }, JSON_CT, '/api/v1/launch?state=TX&path=retail');
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().inputs_used.state, 'TX');
  // A repeated query parameter (Vercel gives a list) is refused.
  const res = mockRes();
  await H.launch({ method: 'POST', headers: JSON_CT, body: {}, url: '/x', query: { state: ['TX', 'CA'] } }, res);
  assert.equal(res.statusCode, 422);
  assert.match(res.json().errors[0], /^state appears more than once/);
});

test('hardening launch: text fields and numbers in JSON steps are type checked', async () => {
  const r = await post('launch', { state: 'TX', steps: [{ path: 'retail', id: 'a', name: { x: 1 }, owner: 'O', low: true, high: '0x10' }] });
  assert.equal(r.statusCode, 422);
  const e = r.json().errors;
  assert.ok(e.includes('Row 1: name must be text, got an object.'), e.join(' | '));
  assert.ok(e.includes('Row 1: low for a must be a number, got boolean.'), e.join(' | '));
  assert.ok(e.includes('Row 1: high for a is not a number: "0x10".'), e.join(' | '));
});

test('hardening launch: JSON sent as text/csv says to use application/json', async () => {
  const r = await post('launch', '{"state":"TX"}', CSV_CT);
  assert.equal(r.statusCode, 422);
  assert.match(r.json().errors[0], /looks like JSON .*Content-Type: application\/json/);
});

test('hardening supply: upper bounds are row errors, never Infinity', async () => {
  const r = await post('supply', { parts: [
    { part: 'A', category: 'cells', lead_time_weeks: 1e308 },
    { part: 'B', category: 'cells', lead_time_weeks: 4, on_hand_weeks: 521 },
    { part: 'C', category: 'cells', lead_time_weeks: 4, unit_cost_usd: 1e308, qty_per_unit: 1e9, tariff_pct: 501 },
  ] });
  assert.equal(r.statusCode, 422);
  const e = r.json().errors;
  assert.ok(e.some((x) => x.startsWith('Part 1: lead_time_weeks must be at most 520')), e.join(' | '));
  assert.ok(e.some((x) => x.startsWith('Part 2: on_hand_weeks must be at most 520')));
  assert.ok(e.some((x) => x.startsWith('Part 3: unit_cost_usd must be at most 1000000')));
  assert.ok(e.some((x) => x.startsWith('Part 3: qty_per_unit must be at most 10000')));
  assert.ok(e.some((x) => x.startsWith('Part 3: tariff_pct must be at most 500')));
  assert.ok(!r.body.includes('Infinity') && !r.body.includes('∞'));
  // At the limits it works.
  const ok = await post('supply', { parts: [{ part: 'A', category: 'cells', lead_time_weeks: 520, on_hand_weeks: 0, unit_cost_usd: 1000000, qty_per_unit: 10000, tariff_pct: 500 }] });
  assert.equal(ok.statusCode, 200, ok.body);
});

test('hardening supply: headers match case-insensitively; unknown columns are warned by name', async () => {
  const r = await post('supply', ' Part ,Category,Lead_Time_Weeks,Colour\nInverter,power_electronics,30\n', CSV_CT);
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json();
  assert.equal(j.result.rows[0].lead_time_weeks, 30);
  assert.ok(j.warnings.some((w) => w.startsWith('Ignored unknown column "Colour"')), j.warnings.join(' | '));
});

test('hardening supply: text fields must be text', async () => {
  const r = await post('supply', { parts: [{ part: { x: 1 }, category: ['cells'], lead_time_weeks: 4, supplier: true }] });
  assert.equal(r.statusCode, 422);
  const e = r.json().errors;
  assert.ok(e.includes('Part 1: part must be text, got an object.'), e.join(' | '));
  assert.ok(e.includes('Part 1: category must be text, got a list.'));
  assert.ok(e.includes('Part 1: supplier must be text, got boolean.'));
  assert.ok(!r.body.includes('[object Object]'));
  const n = await post('supply', { parts: [{ part: 'X', category: 'cells', lead_time_weeks: '0x10' }] });
  assert.deepEqual(n.json().errors, ['Part 1: lead_time_weeks is not a number: "0x10".']);
});

test('hardening supply: JSON sent as text/csv says to use application/json', async () => {
  const r = await post('supply', JSON.stringify({ parts: BOM }), CSV_CT);
  assert.equal(r.statusCode, 422);
  assert.match(r.json().errors[0], /looks like JSON .*Content-Type: application\/json/);
});

test('hardening market: weights are numbers from 0 to 10', async () => {
  const r = await post('market', { weights: { homes: 1e308, saidi: '', saifi: null, heat: '0x2', storm: true, retail: -1 } });
  assert.equal(r.statusCode, 422);
  const e = r.json().errors;
  assert.equal(e.length, 6, e.join(' | '));
  assert.ok(e.every((x) => /^weights: \w+ must be a number from 0 to 10/.test(x)), e.join(' | '));
  const ok = await post('market', { weights: { homes: 10, saidi: '2.5' } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual([ok.json().inputs_used.weights.homes, ok.json().inputs_used.weights.saidi], [10, 2.5]);
  assert.equal((await post('market', { weights: '' })).statusCode, 422);
  assert.equal((await post('market', { weights: { constructor: 1 } })).statusCode, 422);
});

test('hardening market: weights in the query string are warned about, not silently dropped', async () => {
  const c = (await post('market', 'zone,usd_per_year\nLZ_NORTH,1\n', CSV_CT, '/api/v1/market?weights=homes:0')).json();
  assert.equal(c.ok, true);
  assert.ok(c.warnings.some((w) => w.startsWith('Ignored "weights" in the query string')), c.warnings.join(' | '));
  const j = (await post('market', {}, JSON_CT, '/api/v1/market?foo=1')).json();
  assert.ok(j.warnings.includes('Ignored query string parameter "foo". This endpoint reads only the request body.'));
});

test('hardening market: reserved names in your metrics are clean errors', async () => {
  const r = await post('market', { metrics: 'state,cac\nconstructor,1\n__proto__,2\nTX,3\n' });
  assert.equal(r.statusCode, 422);
  const e = r.json().errors;
  assert.ok(e.includes('metrics: Row 2: unknown state "constructor". Use a two-letter code such as TX, or the full name.'), e.join(' | '));
  assert.ok(e.includes('metrics: Row 3: unknown state "__proto__". Use a two-letter code such as TX, or the full name.'));
  // A metric named "constructor" that a state leaves out is just missing, not a function.
  const ok = await post('market', { metrics: { states: { TX: { constructor: 5 }, FL: { other: 1 } } } });
  assert.equal(ok.statusCode, 200, ok.body);
});

// ---------- pitch: wires-only utilities and break tests ----------

test('pitch for a wires-only utility: no capacity offer, sourced explanation, not ranked', async () => {
  for (const [utility, src] of [['CenterPoint Energy', 'pura'], ['Oncor Electric Delivery Company LLC', 'pura'], ['4110-IL', 'il'], ['PECO Energy Co', 'pa'], ['14715-PA', 'pa']]) {
    const r = await post('pitch', { utility });
    assert.equal(r.statusCode, 200, r.body);
    const j = r.json();
    const res = j.result;
    assert.equal(res.offer.rule, 0, utility);
    assert.equal(res.offer.capacity_offer, false, utility);
    assert.notEqual(res.offer.id, 'bulk', utility);
    assert.ok(!res.offer.also_on_menu.includes('Bulk peaking capacity') || res.offer.id !== 'bulk');
    assert.ok(res.wires_only, utility);
    assert.match(res.wires_only.what, /delivers power but does not/);
    assert.match(res.wires_only.talk_about, /interconnection and distribution-level value, not a capacity purchase/);
    const keys = res.wires_only.sources.map((n) => j.sources.find((s) => s.n === n).key);
    assert.ok(keys.includes('eia') && keys.includes(src), utility + ': ' + keys.join(','));
    assert.ok(!res.who_to_call_first.rows.some((x) => x.wires_only && x.rank !== null));
    assert.ok(res.who_to_call_first.wires_only_in_state.some((x) => x.id === res.utility.id), utility);
    assert.ok(!res.questions.some((q) => /Accreditation|Dispatch windows/.test(q)));
  }
  const cnp = (await post('pitch', { utility: '8901-TX' })).json();
  assert.match(cnp.result.wires_only.route_to_homes, /Base Texas REP/);
  assert.ok(cnp.sources.some((s) => s.key === 'agents' && /basepowercompany\.com\/agents\.md/.test(s.url)));
  // Texas ranking: the six wires-only utilities are listed, not ranked; the top 10 is pitchable utilities.
  const wiresTx = cnp.result.who_to_call_first.wires_only_in_state.map((x) => x.id).sort();
  assert.deepEqual(wiresTx, ['11292-TX', '20404-TX', '3278-TX', '40051-TX', '44372-TX', '8901-TX'].sort());
  assert.equal(cnp.result.who_to_call_first.ranked_in_state, cnp.result.who_to_call_first.utilities_in_state - 6);
  assert.ok(cnp.result.who_to_call_first.rows.filter((x) => !x.current).every((x) => !x.wires_only));
  // Co-ops and city utilities keep a real offer, with the ERCOT 4CP sources.
  for (const utility of ['CoServ Electric', 'Austin Energy', '7752-TX', '14626-TX']) {
    const j = (await post('pitch', { utility })).json();
    assert.equal(j.result.wires_only, null, utility);
    assert.notEqual(j.result.offer.rule, 0, utility);
    assert.ok(j.sources.some((s) => s.key === 'tcos' && /25\.192/.test(s.url)), utility);
    assert.ok(j.result.questions.some((q) => /4CP/.test(q)), utility);
  }
});

test('pitch: built-in property names are 422 "No utility called", never 500', async () => {
  for (const utility of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf, TX', 'prototype']) {
    const r = await post('pitch', { utility });
    assert.equal(r.statusCode, 422, utility + ': ' + r.body);
    assert.match(r.json().errors[0], /^No utility called/, utility);
  }
  const q = await post('pitch', '', JSON_CT, '/api/v1/pitch?utility=constructor');
  assert.ok([400, 422].includes(q.statusCode), q.body);
  const csv = await post('pitch', 'key,value\ntollPerKwYear,85\n', CSV_CT, '/api/v1/pitch?utility=__proto__');
  assert.equal(csv.statusCode, 422, csv.body);
  assert.match(csv.json().errors[0], /^No utility called/);
  // A body key named __proto__ cannot smuggle in fields.
  const smuggle = await post('pitch', '{"__proto__": {"utility": "5078-TX"}}', JSON_CT);
  assert.equal(smuggle.statusCode, 422, smuggle.body);
  assert.match(smuggle.json().errors[0], /^utility is required/);
});

test('pitch: terms keys constructor and __proto__ are unknown keys, not "appears twice"', async () => {
  for (const body of ['{"utility":"5078-TX","terms":{"constructor":1}}', '{"utility":"5078-TX","terms":{"__proto__":1}}']) {
    const r = await post('pitch', body, JSON_CT);
    assert.equal(r.statusCode, 422, r.body);
    assert.match(r.json().errors.join(' '), /unknown key "(constructor|__proto__)"/);
    assert.ok(!/appears twice/.test(r.body));
  }
});

test('pitch: terms [], largeLoads "maybe", a mismatched state and bad numbers are clear 422s', async () => {
  const t = await post('pitch', { utility: '5078-TX', terms: [] });
  assert.equal(t.statusCode, 422);
  assert.match(t.json().errors[0], /^terms must be an object/);
  for (const largeLoads of ['maybe', 2, { a: 1 }, [true]]) {
    const r = await post('pitch', { utility: '5078-TX', largeLoads });
    assert.equal(r.statusCode, 422, JSON.stringify(largeLoads));
    assert.match(r.json().errors[0], /^largeLoads must be true or false/);
  }
  for (const [largeLoads, want] of [[true, 'speed'], ['yes', 'speed'], [1, 'speed'], [false, 'bulk'], ['no', 'bulk'], ['0', 'bulk']]) {
    const r = await post('pitch', { utility: '5078-TX', largeLoads });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().result.offer.id, want, JSON.stringify(largeLoads));
  }
  const s = await post('pitch', { utility: '5078-TX', state: 'IL' });
  assert.equal(s.statusCode, 422);
  assert.match(s.json().errors[0], /is CoServ Electric .* in TX, not IL/);
  assert.equal((await post('pitch', { utility: '5078-TX', state: 'tx' })).statusCode, 200);
  assert.equal((await post('pitch', { utility: 'Austin Energy', state: 'Texas' })).statusCode, 422);
  for (const mw of [1e308, '1e308', 0, -5, 5001, '0x10', true, 'abc']) {
    const r = await post('pitch', { utility: '5078-TX', mw });
    assert.equal(r.statusCode, 422, JSON.stringify(mw) + ' ' + r.body);
  }
  for (const key of P.TERMS.map((x) => x.key)) {
    const r = await post('pitch', { utility: '5078-TX', terms: { [key]: 1e308 } });
    assert.equal(r.statusCode, 422, key);
  }
  // Largest allowed inputs still give finite numbers everywhere.
  const big = await post('pitch', { utility: '5078-TX', mw: 5000, terms: { kwPerHome: 1, kwhPerHome: 500, costHighPerKwh: 5000, costLowPerKwh: 5000, tollPerKwYear: 1000, termYears: 40, memberReservePct: 99 } });
  assert.equal(big.statusCode, 200, big.body);
  assert.ok(!/Infinity|NaN/.test(big.body));
  assert.equal(big.json().result.program.batteries, 5000000);
});
