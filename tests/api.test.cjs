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
  zip: require('../api/v1/zip.js'),
};
const ZIP = require('../data/zip-launch.json');
const TOOLS = ['finance', 'launch', 'supply', 'market', 'pitch', 'zip'];
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
// API result numbers are rounded at the boundary (api/_lib.js roundNum), so compare rounded values.
const L = require('../api/_lib.js');
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(L.roundNum(a) - L.roundNum(b)) <= tol, `${a} vs ${b}`);

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
  assert.equal(j.data_as_of.zip_launch, ZIP.generated);
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
  const z = arb != null ? null : ZONES.zones.find((x) => x.id === zoneId);
  raw.arbPerYear = arb != null ? arb : z.usdPerYear;
  raw.zone = z ? z.id : null;
  raw.zoneMarket = z ? z.market : null;
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
  const basis = Object.assign(F.lineBasis(FIN, null), { toll: 'yours' });
  const retailDefault = FIN.groups.flatMap((g) => g.fields).find((f) => f.key === 'retailMarginMonthly').value;
  const wantText = F.explain(want, { basis, retailDefault });
  assert.deepEqual(j.result.explain.slice(0, wantText.length), wantText);
  near(j.result.returns.unlevered.npv, want.returns.unlevered.npv);
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
  near(j.result.itc_face, 0.3 * j.result.capex);
  assert.equal(j.result.itc_price, 0.895);
  near(j.result.itc, 0.3 * j.result.capex * 0.895);
  assert.equal(j.result.year1_revenue_lines.counted.anc, 0);
  const anc = (await post('finance', { inputs: { ancPerKwYear: 20 } })).json();
  const avail = FIN.groups.flatMap((g) => g.fields).find((f) => f.key === 'availabilityPct').value / 100;
  near(anc.result.year1_revenue_lines.counted.anc, 20 * 20 * avail);
  near(anc.result.debt, F.sizeDebt(pageInputs({ ancPerKwYear: 20 })).debt);
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

// Expected values are the equal-weight score with the retail-choice path included,
// the same ranking the expansion-map narrative publishes in data/expansion-map.json.
test('market default weights match the published score: Texas 73, Michigan 73, Maryland 71', async () => {
  const j = (await post('market', {})).json().result;
  assert.equal(j.states.length, 51);
  assert.deepEqual(j.states.slice(0, 3).map((s) => [s.name, s.points, s.tier]), [['Texas', 73, 'S'], ['Michigan', 73, 'S'], ['Maryland', 71, 'S']]);
  const at = (n) => j.states.find((s) => s.name === n);
  assert.deepEqual([at('Illinois').rank, at('Illinois').points], [7, 62]);
  assert.deepEqual([at('Pennsylvania').rank, at('Pennsylvania').points], [6, 63]);
  assert.deepEqual([at('California').rank, at('California').points], [4, 66]);
  assert.deepEqual([at('Georgia').rank, at('Georgia').points], [32, 46]);
  assert.deepEqual([at('Connecticut').rank, at('Connecticut').points], [13, 57]);
  assert.equal(at('Colorado').footprint.status, 'equipment');
  assert.match(at('Michigan').why, /^Leads on outage duration/);
  assert.equal(j.texas_zones.zones[0].id, 'LZ_WEST');
  assert.ok(j.texas_zones.zones.every((z) => z.kind === 'load zone' && z.id.startsWith('LZ_')));
  assert.deepEqual([j.texas_zones.schedule.charge_hours, j.texas_zones.schedule.discharge_hours], [[10, 14], [19, 21]]);
  assert.doesNotMatch(j.texas_zones.about, /5 to 9 PM|at night/);
});

test('market with homes weighted 0 matches the published re-ranking: Maryland 72, Michigan 71, Texas 70', async () => {
  const j = (await post('market', { weights: { homes: 0 } })).json().result;
  assert.deepEqual(j.states.slice(0, 3).map((s) => [s.name, s.points]), [['Maryland', 72], ['Michigan', 71], ['Texas', 70]]);
});

test('market adds your own metrics and zones', async () => {
  const r = await post('market', {
    metrics: 'state,install_cost_usd (lower is better)\nTX,11500\nFL,13200\nGeorgia,12800\nAZ,12100\nNC,13900\n',
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
  assert.ok(j.warnings.some((w) => w.startsWith('metrics: "install_cost_usd" has no value for 46 states')));
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
  const ok = await post('market', { metrics: { states: { TX: { constructor: 5 }, FL: { other: 1 }, GA: { constructor: 1, other: 1 }, AZ: { constructor: 2, other: 2 }, NC: { constructor: 3, other: 3 }, OH: { constructor: 4, other: 4 } } } });
  assert.equal(ok.statusCode, 200, ok.body);
});

// ---------- pitch: wires-only utilities and break tests ----------

test('pitch for a wires-only utility: no capacity offer, sourced explanation, not ranked', async () => {
  for (const [utility, src] of [['CenterPoint Energy', 'pura'], ['Oncor Electric Delivery Company LLC', 'pura'], ['PECO Energy Co', 'pa'], ['14715-PA', 'pa']]) {
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
  assert.equal(cnp.result.who_to_call_first.ranked_in_state, cnp.result.who_to_call_first.utilities_in_state - 6 - cnp.result.who_to_call_first.base_partners_in_state.length);
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

// ---------- pitch: Base partners, ERCOT-first Texas ranking, 12CP citation ----------

test('pitch for an existing Base partner: labeled, framed as expansion, sourced, not ranked cold', async () => {
  for (const [utility, id] of [['7752-TX', '7752-TX'], ['Bandera Electric Coop, Inc', '1175-TX'], ['6182-TX', '6182-TX'], ['El Paso Electric Co, TX', '5701-TX'], ['3248-GA', '3248-GA']]) {
    const r = await post('pitch', { utility });
    assert.equal(r.statusCode, 200, r.body);
    const j = r.json();
    const res = j.result;
    assert.equal(res.utility.id, id);
    // El Paso Electric's own release calls its program a pilot, so it is labeled one.
    const label = id === '5701-TX' ? 'Runs a pilot with Base' : 'Already a Base partner';
    assert.equal(res.base_partner.status, label, utility);
    assert.match(res.base_partner.framing, /not a cold pitch/);
    assert.ok(j.sources.some((s) => s.url === res.base_partner.source), utility + ': partner source listed');
    assert.match(res.questions[0], /^Existing program:/);
    const row = res.who_to_call_first.rows.find((x) => x.id === id);
    assert.ok(row && row.base_partner && row.rank === null && row.status === label, utility);
    assert.ok(res.who_to_call_first.base_partners_in_state.some((x) => x.id === id));
  }
  const cold = (await post('pitch', { utility: '14626-TX' })).json().result;
  assert.equal(cold.base_partner, null);
  assert.ok(cold.who_to_call_first.rows.every((x) => !x.base_partner || x.rank === null));
});

test('pitch Texas ranking: ERCOT first, non-ERCOT labeled, partners after the cold top 10', async () => {
  const w = (await post('pitch', { utility: '55937-TX' })).json().result.who_to_call_first;
  assert.equal(w.preferred_market, 'ERCOT');
  assert.match(w.method, /ERCOT/);
  assert.match(w.method, /Existing Base partners are not ranked as cold prospects/);
  const ranked = w.rows.filter((x) => x.rank !== null);
  assert.deepEqual(ranked.slice(0, 5).map((x) => x.id), ['16604-TX', '14626-TX', '11501-TX', '19159-TX', '7559-TX']);
  assert.ok(ranked.slice(0, 10).every((x) => !x.outside_preferred_market && x.market === 'ERCOT'));
  const entergy = w.rows.find((x) => x.id === '55937-TX');
  assert.ok(entergy.current && entergy.outside_preferred_market && entergy.rank > 10);
  assert.match(entergy.market_note, /^Outside ERCOT \(MISO\)/);
  assert.deepEqual(w.base_partners_in_state.map((x) => x.id).sort(), ['1015-TX', '1175-TX', '5078-TX', '5701-TX', '6182-TX', '7752-TX'].sort());
  const firstPartner = w.rows.findIndex((x) => x.base_partner);
  assert.ok(firstPartner >= 10 && w.rows.slice(0, firstPartner).every((x) => !x.base_partner));
  assert.equal(w.ranked_in_state, w.utilities_in_state - w.wires_only_in_state.length - w.base_partners_in_state.length);
});

test('pitch ERCOT sources cite PUCT Project No. 58000 for 4CP to 12CP', async () => {
  const j = (await post('pitch', { utility: '14626-TX' })).json();
  const k = j.sources.map((s) => s.key);
  assert.ok(k.includes('tcos12') && k.includes('tcos58000'), k.join(','));
  assert.match(j.sources.find((s) => s.key === 'tcos12').title, /Project No\. 58000/);
  assert.match(j.sources.find((s) => s.key === 'tcos58000').url, /ControlNumber=58000/);
  assert.ok(!j.sources.some((s) => /Project 58484\b/.test(s.title) && s.key === 'tcos12'));
  assert.ok(j.result.offer.reason.includes('Project No. 58000') || j.result.offer.rule !== 3);
});

// ---------- pitch: break-test fixes (long names, short names, conflicts, text types, CSV headers) ----------

test('pitch: a huge utility name is refused fast, before any matching, and never echoed whole', async () => {
  for (const n of [50000, 200000]) {
    const t = Date.now();
    const r = await post('pitch', { utility: 'A'.repeat(n) });
    assert.ok(Date.now() - t < 500, n + ' chars took ' + (Date.now() - t) + ' ms');
    assert.equal(r.statusCode, 422);
    assert.ok(r.body.length < 400, 'error does not echo the name: ' + r.body.length + ' bytes');
    assert.match(r.json().errors[0], new RegExp('^utility is ' + n + ' characters\\. The limit is 200'));
  }
  // Same cap in the query string, and a 200-character miss echoes only a clipped copy.
  assert.equal((await post('pitch', '', JSON_CT, '/api/v1/pitch?utility=' + 'B'.repeat(5000))).statusCode, 422);
  const near = await post('pitch', { utility: 'A'.repeat(200) });
  assert.equal(near.statusCode, 422);
  assert.match(near.json().errors[0], /\.\.\. \(200 characters\)/);
});

test('pitch: target lists are capped at 500 rows and each name at 200 characters', async () => {
  const many = await post('pitch', { utility: '5078-TX', targets: Array.from({ length: 501 }, () => ({ utility: '1015-TX' })) });
  assert.equal(many.statusCode, 422);
  assert.deepEqual(many.json().errors, ['targets has 501 items. The limit is 500 per request; split the list.']);
  const csv = 'utility,status\n' + Array.from({ length: 501 }, () => '1015-TX,target').join('\n') + '\n';
  const c = await post('pitch', csv, CSV_CT, '/api/v1/pitch?utility=5078-TX');
  assert.equal(c.statusCode, 422);
  assert.match(c.json().errors[0], /target list has 501 rows\. The limit is 500/);
  const long = await post('pitch', { utility: '5078-TX', targets: [{ utility: 'Z'.repeat(100000) }] });
  assert.equal(long.statusCode, 422);
  assert.deepEqual(long.json().errors, ['targets item 1: utility is 100000 characters. The limit is 200.']);
  // 500 near-miss names, all just under the cap: still quick, every row reported, no row echoed whole.
  const t = Date.now();
  const slow = await post('pitch', { utility: '5078-TX', targets: Array.from({ length: 500 }, (_, i) => ({ utility: 'Q'.repeat(190) + i })) });
  assert.ok(Date.now() - t < 3000, '500 unmatched targets took ' + (Date.now() - t) + ' ms');
  // Unknown targets are row errors (pass 3, item 12), and an error list is capped at 50 plus one "And N more" line.
  assert.equal(slow.statusCode, 422);
  const w = slow.json().errors;
  assert.equal(w.length, 51);
  assert.equal(w[50], 'And 450 more like these.');
  assert.ok(w.slice(0, 50).every((x) => /no utility called/.test(x) && x.length < 260), w[0]);
});

test('pitch: common short names and names without Co / Inc resolve on the API', async () => {
  const cases = { Oncor: '44372-TX', ComEd: '4110-IL', CoServ: '5078-TX', 'coserv electric': '5078-TX', 'Austin Energy': '1015-TX', '5078-tx': '5078-TX',
    'Commonwealth Edison': '4110-IL', 'Georgia Power': '7140-GA', 'PG&E': '14328-CA', 'Con Edison': '4226-NY', CenterPoint: '8901-TX', 'Oncor, TX': '44372-TX' };
  for (const [utility, id] of Object.entries(cases)) {
    const r = await post('pitch', { utility });
    assert.equal(r.statusCode, 200, utility + ': ' + r.body);
    assert.equal(r.json().inputs_used.utility, id, utility);
  }
  const aep = await post('pitch', { utility: 'AEP Texas' });
  assert.equal(aep.statusCode, 422);
  assert.match(aep.json().errors[0], /matches 2 utilities \(3278-TX .*20404-TX/);
  assert.equal((await post('pitch', { utility: 'Pepco', state: 'MD' })).json().inputs_used.utility, '15270-MD');
  // Exact legal names still win over a looser key.
  assert.equal((await post('pitch', { utility: 'Oncor Electric Delivery Company LLC' })).json().inputs_used.utility, '44372-TX');
  // Short names also work in a target list.
  const t = (await post('pitch', { utility: '5078-TX', targets: [{ utility: 'Oncor', status: 'in talks' }, { utility: 'ComEd' }] })).json();
  assert.deepEqual(t.inputs_used.targets.sort(), ['4110-IL', '44372-TX']);
});

test('pitch: a program smaller than one battery says it was rounded up, with real precision', async () => {
  const j = (await post('pitch', { utility: '5078-TX', mw: 0.0001 })).json();
  const p = j.result.program;
  assert.equal(p.mw, 0.0001);
  assert.equal(p.batteries, 1);
  assert.equal(p.nameplate_mw, 0.02);
  assert.equal(p.rounded_up, true);
  near(p.mwh, 0.0392);
  assert.match(p.note, /You asked for 0\.1 kW\. Batteries come whole, so this is 1 battery at 20 kW each: 20 kW nameplate, rounded up\./);
  const even = (await post('pitch', { utility: '5078-TX', mw: 100 })).json().result.program;
  assert.equal(even.rounded_up, false);
  assert.ok(!/rounded up/.test(even.note));
  assert.equal(P.fmtPower(0.0001), '0.1 kW');
  assert.equal(P.fmtPower(0.02), '20 kW');
  assert.equal(P.fmtPower(100), '100 MW');
  assert.equal(P.fmtPower(2.5), '2.5 MW');
  assert.equal(P.fmtEnergy(0.0392), '39.2 kWh');
  assert.equal(P.fmtEnergy(196), '196 MWh');
});

test('pitch: body and query string must agree, and mw must agree with terms.programMw', async () => {
  const u = await post('pitch', { utility: '5078-TX' }, JSON_CT, '/api/v1/pitch?utility=1015-TX');
  assert.equal(u.statusCode, 422);
  assert.deepEqual(u.json().errors, ['utility is "5078-TX" in the body but "1015-TX" in the query string. Send it in one place.']);
  // Same value, or the same utility by another name, is fine.
  assert.equal((await post('pitch', { utility: '5078-TX' }, JSON_CT, '/api/v1/pitch?utility=5078-tx')).statusCode, 200);
  assert.equal((await post('pitch', { utility: 'CoServ Electric' }, JSON_CT, '/api/v1/pitch?utility=5078-TX')).statusCode, 200);
  const s = await post('pitch', { utility: '5078-TX', state: 'TX' }, JSON_CT, '/api/v1/pitch?state=GA');
  assert.equal(s.statusCode, 422);
  assert.match(s.json().errors[0], /^state is "TX" in the body but "GA" in the query string/);
  assert.equal((await post('pitch', { utility: '5078-TX', mw: 50 }, JSON_CT, '/api/v1/pitch?mw=60')).statusCode, 422);
  assert.equal((await post('pitch', { utility: '5078-TX', mw: 50 }, JSON_CT, '/api/v1/pitch?mw=50.0')).statusCode, 200);
  assert.equal((await post('pitch', { utility: '5078-TX', largeLoads: true }, JSON_CT, '/api/v1/pitch?largeLoads=no')).statusCode, 422);
  assert.equal((await post('pitch', { utility: '5078-TX', largeLoads: true }, JSON_CT, '/api/v1/pitch?largeLoads=yes')).statusCode, 200);
  // A repeated query parameter is ambiguous too.
  const rep = await call('pitch', 'POST', { utility: '5078-TX' }, JSON_CT, '/api/v1/pitch');
  assert.equal(rep.statusCode, 200);
  const res = mockRes();
  await H.pitch({ method: 'POST', headers: JSON_CT, body: {}, url: '/api/v1/pitch', query: { utility: ['5078-TX', '1015-TX'] } }, res);
  assert.equal(res.statusCode, 422);
  assert.match(res.json().errors[0], /^utility appears more than once/);
  // mw vs programMw.
  const c = await post('pitch', { utility: '5078-TX', mw: 50, terms: { programMw: 80 } });
  assert.equal(c.statusCode, 422);
  assert.deepEqual(c.json().errors, ['mw is 50 but programMw in your offer terms is 80. Send the program size in one place.']);
  assert.equal((await post('pitch', { utility: '5078-TX', mw: 80, terms: { programMw: 80 } })).statusCode, 200);
  assert.equal((await post('pitch', { utility: '5078-TX', terms: { programMw: 80 } })).json().inputs_used.mw, 80);
  assert.equal((await post('pitch', { utility: '5078-TX', mw: 50, terms: { programMw: 100 } })).statusCode, 422, 'programMw at its public value still counts as sent');
  const csv = await post('pitch', 'key,value\nprogramMw,80\n', CSV_CT, '/api/v1/pitch?utility=5078-TX&mw=50');
  assert.equal(csv.statusCode, 422);
  assert.match(csv.json().errors[0], /^mw is 50 but programMw/);
});

test('pitch: text fields must be text, with the row named', async () => {
  const o = await post('pitch', { utility: '5078-TX', targets: [{ utility: { a: 1 } }] });
  assert.equal(o.statusCode, 422);
  assert.deepEqual(o.json().errors, ['targets item 1: utility must be text, got an object.']);
  assert.ok(!o.body.includes('[object Object]'));
  const s = await post('pitch', { utility: '5078-TX', targets: [{ utility: '1015-TX' }, { utility: '1015-TX', status: ['x'] }] });
  assert.equal(s.statusCode, 422);
  assert.deepEqual(s.json().errors, ['targets item 2: status must be text, got a list.']);
  for (const k of ['owner', 'note', 'state']) {
    const r = await post('pitch', { utility: '5078-TX', targets: [{ utility: '1015-TX', [k]: { x: 1 } }] });
    assert.equal(r.statusCode, 422, k);
    assert.match(r.json().errors[0], new RegExp('^targets item 1: ' + k + ' must be text'));
  }
  assert.equal((await post('pitch', { utility: '5078-TX', targets: [5078] })).statusCode, 422);
  assert.match((await post('pitch', { utility: '5078-TX', state: ['TX'] })).json().errors[0], /^state must be text/);
  assert.match((await post('pitch', { utility: '5078-TX', terms: { tollPerKwYear: { a: 1 } } })).json().errors[0], /tollPerKwYear is not a number: an object\./);
  // A status that is a number is fine (it is shown as text).
  assert.equal((await post('pitch', { utility: '5078-TX', targets: [{ utility: '1015-TX', status: 2 }] })).statusCode, 200);
});

test('pitch: CSV headers in any case and spacing; unknown columns are a warning', async () => {
  const csv = ' Utility , STATUS,Owner,Extra Notes\n1015-TX,in talks,Ben,x\n';
  const r = await post('pitch', csv, CSV_CT, '/api/v1/pitch?utility=5078-TX');
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json();
  assert.deepEqual(j.inputs_used.targets, ['1015-TX']);
  const row = j.result.who_to_call_first.rows.find((x) => x.id === '1015-TX');
  assert.equal(row.your_target.status, 'in talks');
  assert.equal(row.your_target.owner, 'Ben');
  assert.ok(j.warnings.some((w) => /^Ignored unknown column "Extra Notes"/.test(w)), j.warnings.join(' | '));
  const terms = await post('pitch', 'KEY,Value\ntollPerKwYear,85\n', CSV_CT, '/api/v1/pitch?utility=5078-TX');
  assert.equal(terms.statusCode, 200, terms.body);
  assert.equal(terms.json().inputs_used.terms.tollPerKwYear, 85);
});

test('pitch: a JSON body sent as text/csv says to use application/json', async () => {
  for (const body of ['{"utility":"5078-TX"}', '[{"utility":"5078-TX"}]', '  {"utility": "5078-TX", "mw": 10}']) {
    const r = await post('pitch', body, CSV_CT, '/api/v1/pitch');
    assert.equal(r.statusCode, 422);
    assert.match(r.json().errors[0], /looks like JSON but was sent as CSV\. Send it with Content-Type: application\/json/);
  }
});

// ==========================================================================================
// Break-test fixes, 2026-11-04: market, finance and supply. Self-contained block.
// ==========================================================================================

test('break-test market: one or two states for your metric never earn full marks', async () => {
  const one = await post('market', { metrics: { factors: [{ key: 'install_cost_usd', higherIsBetter: false }], states: { TX: { install_cost_usd: 999999 } } } });
  assert.equal(one.statusCode, 422);
  assert.ok(one.json().errors.includes('metrics: No metric has values for at least 5 states, so nothing can be ranked. Fill in at least 5 states for a metric.'), one.body);
  const two = await post('market', { metrics: 'state,thin,good\nTX,999999,1\nFL,1,2\nGA,,3\nAZ,,4\nNC,,5\n' });
  assert.equal(two.statusCode, 200, two.body);
  const j = two.json();
  assert.deepEqual(j.inputs_used.your_factors, ['yours_good']);
  assert.ok(j.warnings.some((w) => /^metrics: "thin" has values for only 2 states, so it is left out of the score/.test(w)), j.warnings.join(' | '));
});

test('break-test market: zones are capped like arbPerYear and accept any case; zero weights give no rank', async () => {
  const big = await post('market', { zones: { LZ_NORTH: 1e12 } });
  assert.equal(big.statusCode, 422);
  assert.match(big.json().errors[0], /^zones: zones\.LZ_NORTH: LZ_NORTH must be at most 100,000/);
  const low = await post('market', { zones: { lz_north: 500 } });
  assert.equal(low.statusCode, 200, low.body);
  assert.deepEqual(low.json().inputs_used.your_zones, ['LZ_NORTH']);
  const ids = MAP.factors.map((f) => f.id);
  const zero = (await post('market', { weights: Object.fromEntries(ids.map((id) => [id, 0])) })).json();
  assert.ok(zero.result.states.every((s) => s.rank === null && s.score === null));
});

test('break-test finance: top-level and inputs values that disagree are 422; equal ones are fine', async () => {
  const r = await post('finance', { fleetCount: 100, inputs: { fleetCount: 200 }, zone: 'LZ_NORTH', revenueCase: 'toll' });
  assert.equal(r.statusCode, 422);
  assert.deepEqual(r.json().errors, ['fleetCount is 100 at the top level but 200 in inputs. Send it once, or the same value in both places.']);
  const z = await post('finance', { zone: 'LZ_NORTH', inputs: { zone: 'LZ_WEST' } });
  assert.equal(z.statusCode, 422);
  assert.match(z.json().errors[0], /^zone is "LZ_NORTH" at the top level but "LZ_WEST" in inputs/);
  const same = await post('finance', { fleetCount: 100, inputs: { fleetCount: '100' }, zone: 'lz_west', revenueCase: 'merchant' });
  assert.equal(same.statusCode, 200, same.body);
  assert.equal(same.json().inputs_used.zone, 'LZ_WEST');
  assert.equal(same.json().inputs_used.fleetCount, 100);
  const sameZone = await post('finance', { zone: 'LZ_WEST', inputs: { zone: 'lz_west' } });
  assert.equal(sameZone.statusCode, 200, sameZone.body);
});

test('break-test finance: arbPerYear over a zone is a warning; duplicate CSV keys and JSON-as-CSV are 422', async () => {
  const both = (await post('finance', { zone: 'LZ_WEST', arbPerYear: 150 })).json();
  assert.equal(both.ok, true);
  assert.equal(both.inputs_used.arbPerYear, 150);
  assert.ok(both.warnings.includes('arbPerYear replaces the zone value, so zone LZ_WEST is not used. Leave arbPerYear blank to use the zone.'), both.warnings.join(' | '));
  const dup = await post('finance', 'key,value\ncapexPerKwh,300\ncapexPerKwh,310\n', CSV_CT);
  assert.equal(dup.statusCode, 422);
  assert.deepEqual(dup.json().errors, ['Row 3: capexPerKwh appears again (first at Row 2). Keep one row per key.']);
  const mixed = await post('finance', 'Key,Value\ncapexPerKwh,300\n', CSV_CT);
  assert.equal(mixed.statusCode, 200, mixed.body);
  assert.deepEqual(mixed.json().inputs_used.yours, ['capexPerKwh']);
  const asCsv = await post('finance', JSON.stringify({ inputs: { capexPerKwh: 300 } }), CSV_CT);
  assert.equal(asCsv.statusCode, 422);
  assert.match(asCsv.json().errors[0], /looks like JSON .*Content-Type: application\/json/);
});

test('break-test finance: 1e400 is out of range, not "Infinity is not a number"', async () => {
  const r = await post('finance', '{"inputs":{"capexPerKwh":1e400}}', JSON_CT);
  assert.equal(r.statusCode, 422);
  assert.match(r.json().errors[0], /^capexPerKwh is out of range: the number is too large\. Allowed: /);
  const c = await post('finance', 'key,value\ncapexPerKwh,1e400\n', CSV_CT);
  assert.match(c.json().errors[0], /^Row 2: capexPerKwh is out of range: "1e400" is too large\./);
  assert.ok(!r.body.includes('Infinity') && !c.body.includes('Infinity'));
});

test('break-test supply: duplicate columns are a 422; tiny gaps and the tariff hint read right', async () => {
  const dup = (await post('supply', 'part,category,lead_time_weeks,lead_time_weeks\nA,cells,5,9\n', CSV_CT)).json();
  assert.equal(dup.ok, false);
  assert.deepEqual(dup.errors, ['Column "lead_time_weeks" appears more than once. Keep one.']);
  const tiny = (await post('supply', { parts: [{ part: 'A', category: 'cells', lead_time_weeks: 0.0001, on_hand_weeks: 0.00005, tariff_pct: 30 }] })).json();
  // Lead 0.0001 against cover 0.00005: shown to enough decimals that the gap is visible (pass 3, item 11).
  assert.match(tiny.result.summary, /^1 of 1 part will run short\. Longest gap: A, 0\.00005 wk\. Add unit_cost_usd and qty_per_unit to see tariff cost per battery/);
  assert.doesNotMatch(tiny.result.summary, /tariff_pct to see/);
});

// Finance settlement, retail margin and tax-credit bridge, 2026-11-04. Self-contained block.
test('finance API: derived retail margin default, export settlement text, and $0 margin note', async () => {
  const d = (await post('finance', undefined, {})).json();
  assert.equal(d.inputs_used.retailMarginMonthly, 63);
  near(d.result.year1_revenue_lines.counted.retail, 756);
  near(d.result.debt_pct_capex, 0.1419, 0.0005);
  assert.equal(d.result.export_settlement, F.EXPORT_TEXT);
  assert.match(d.result.export_settlement, /11\.4\.4\.3/);
  assert.match(d.result.itc_treatment, /bridge loan/);
  const z = (await post('finance', { inputs: { retailMarginMonthly: 0 } })).json();
  assert.ok(z.result.explain.some((l) => /leaves out what a retail provider normally earns/.test(l)));
  assert.ok(z.result.debt < d.result.debt);
  const usage = (await call('finance', 'GET')).json();
  assert.equal(usage.post.input_keys.find((k) => k.key === 'retailMarginMonthly').public_value, 63);
});

test('finance API: equity at $0 always comes with a note', async () => {
  const j = (await post('finance', { inputs: { retailMarginMonthly: 1000, upfront: 5000 } })).json();
  assert.equal(j.result.binding, 'cost');
  assert.equal(j.result.equity, 0);
  assert.match(j.result.binding_text, /equity is \$0/);
  assert.ok(j.result.explain.some((l) => l.includes(F.EQUITY_ZERO_TEXT)));
});

// ---------- pitch: Illinois VPP route, accredited MW example, partner count (2026-11-04) ----------

test('pitch for ComEd: Illinois VPP tariff route, ranked, statute sourced', async () => {
  const r = await post('pitch', { utility: 'ComEd' });
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json(), res = j.result;
  assert.equal(res.wires_only, null);
  assert.equal(res.offer.rule, 0);
  assert.equal(res.offer.variant, 'vpp');
  assert.equal(res.offer.capacity_offer, true);
  assert.equal(res.state_program.statute, '220 ILCS 5/16-107.9 (Public Act 104-0458)');
  assert.equal(res.state_program.file_by, '31 December 2027');
  const keys = res.state_program.sources.map((n) => j.sources.find((s) => s.n === n).key);
  assert.deepEqual(keys, ['pa104458', 'sb25', 'ipaplan']);
  const me = res.who_to_call_first.rows.find((x) => x.id === '4110-IL');
  assert.ok(me && me.rank !== null && !me.wires_only);
  assert.equal((await post('pitch', { utility: 'PECO Energy Co' })).json().result.state_program, null);
});

test('pitch program carries an illustrative accredited MW, labeled an assumption', async () => {
  // Accreditation only in a capacity market: ComEd (PJM). CoServ (ERCOT) gets the 2-hour peak MW instead (pass 3, item 15).
  const j = (await post('pitch', { utility: 'ComEd' })).json();
  const a = j.result.program.accredited_example;
  assert.equal(a.basis, 'assumption');
  assert.equal(a.factor_pct, 64.65);
  assert.equal(a.accredited_mw, L.roundNum(5000 * 15.68 / 1000 * 0.6465));
  assert.ok(a.sources.length === 2 && a.sources.every((n) => j.sources.some((s) => s.n === n)));
  assert.equal(j.result.program.capacity_example.kind, 'accredited');
  const mine = (await post('pitch', { utility: 'ComEd', terms: { memberReservePct: 50 } })).json().result.program.accredited_example;
  assert.equal(mine.reserve_pct, 50);
  assert.equal(mine.reserve_from_your_file, true);
  const tx = (await post('pitch', { utility: 'CoServ Electric' })).json();
  assert.equal(tx.result.program.accredited_example, null);
  assert.equal(tx.result.program.capacity_example.kind, 'ercot');
  assert.equal(tx.result.program.capacity_example.mw_for_2h, L.roundNum(5000 * 15.68 / 1000));
  assert.match(tx.result.program.capacity_example.text, /ERCOT runs an energy-only market, so nothing here is accredited/);
  assert.ok(!tx.sources.some((s) => s.key === 'nyisocaf'), 'no NYISO source on an ERCOT pitch');
  assert.match(tx.result.who_to_call_first.method, /6 utility partners/);
});

test('market: Colorado and Connecticut carry equipment-only marks; the retail-choice flag is legal, not a share cut', async () => {
  const j = (await post('market', {})).json().result;
  for (const a of ['CO', 'CT']) {
    const s = j.states.find((x) => x.abbr === a);
    assert.equal(s.footprint.status, 'equipment');
    assert.equal(s.footprint.source.url, 'https://www.basepowercompany.com/');
  }
  const lp = (a) => j.states.find((x) => x.abbr === a).factors.launch_path.value;
  assert.deepEqual(['TX', 'IL', 'PA', 'CA', 'MI', 'GA'].map(lp), [1, 1, 1, 0, 0, 0]);
});

// ==========================================================================================
// Finance review fixes, 2026-11-04: generic defaults, Base preset, returns, zones without
// retail choice, comma rule, query parameters, null and BOM bodies. Self-contained block.
// ==========================================================================================

test('finance API: generic default says plainly that it does not pay back, with returns', async () => {
  const j = (await post('finance', undefined, {})).json();
  const R = j.result.returns;
  assert.equal(j.result.preset, null);
  assert.equal(j.inputs_used.capexPerKwh, 1290);
  assert.equal(j.inputs_used.upfront, 0);
  assert.equal(j.inputs_used.memberFeeMonthly, 35);
  assert.equal(R.discount_rate, 0.1);
  assert.equal(R.pays_back, false);
  assert.equal(R.unlevered.payback_year, null);
  assert.ok(R.unlevered.cash_total < R.unlevered.invest);
  assert.ok(R.unlevered.irr < 0 && R.unlevered.npv < 0, JSON.stringify(R.unlevered));
  assert.ok(R.equity && R.equity.invest > 0);
  assert.match(R.text[0], /^On these inputs the battery does not pay back/);
  assert.ok(R.text.includes(F.LEFT_OUT_TEXT));
  for (const re of [/price spikes outside the fixed 7 to 9 PM window/, /ancillary services/, /depreciation/, /value after its useful life/]) assert.match(F.LEFT_OUT_TEXT, re);
  assert.ok(j.result.explain.includes(R.text[0]));
  assert.match(j.result.arbitrage_basis, /derived from public ERCOT prices with assumptions \(a fixed charge and discharge clock, 88% round trip, 20% backup reserve\)/);
  assert.match(j.result.itc_treatment, /1\.48E-3\(c\)\(4\)\(ii\)/);
  assert.equal(j.result.zone_market.retail_choice, true);
  // No Base economic figure in the default path (the battery size cites the spec the zone values were simulated for).
  for (const s of j.sources.filter((x) => ['capexPerKwh', 'upfront', 'memberFeeMonthly', 'retailMarginMonthly', 'availabilityPct'].includes(x.input))) assert.doesNotMatch(s.url, /basepowercompany|bpc-web-static/, s.input);
});

test('finance API: preset base_published loads Base\'s public claims, labeled, and reproduces the reviewer arithmetic', async () => {
  const r = await post('finance', { preset: 'base_published' });
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json();
  assert.equal(j.result.preset, 'base_published');
  assert.match(j.result.preset_label, /Base Power's published figures/);
  assert.match(j.result.preset_about, /public claims .*not Base's economics/);
  assert.equal(j.inputs_used.preset, 'base_published');
  assert.deepEqual([j.inputs_used.capexPerKwh, j.inputs_used.upfront, j.inputs_used.memberFeeMonthly, j.inputs_used.retailMarginMonthly], [350, 695, 19, 22]);
  const u = j.result.returns.unlevered;
  near(u.invest, 9341, 1);
  near(u.cash_total, 8860, 1);
  assert.equal(j.result.returns.pays_back, false);
  assert.ok(j.sources.some((s) => /basepowercompany/.test(s.url) && /public claim/.test(s.note)));
  // Any case, in inputs too, and in a CSV row; your own values go on top of the preset.
  const c = (await post('finance', 'key,value\ncapexPerKwh,300\npreset,BASE_PUBLISHED\n', CSV_CT)).json();
  assert.equal(c.result.preset, 'base_published');
  assert.equal(c.inputs_used.capexPerKwh, 300);
  assert.equal(c.inputs_used.upfront, 695);
  assert.deepEqual(c.inputs_used.yours, ['capexPerKwh']);
  assert.equal((await post('finance', { inputs: { preset: 'base_published' } })).json().result.preset, 'base_published');
  const bad = await post('finance', { preset: 'tesla' });
  assert.equal(bad.statusCode, 422);
  assert.match(bad.json().errors[0], /^preset must be one of base_published/);
  const clash = await post('finance', { preset: 'base_published', inputs: { preset: 'x' } });
  assert.equal(clash.statusCode, 422);
});

test('finance API: zones without retail choice drop retail margin and merchant arbitrage and suggest the toll', async () => {
  for (const zone of ['LZ_AEN', 'LZ_CPS', 'LZ_LCRA', 'LZ_RAYBN']) {
    const j = (await post('finance', { zone })).json();
    assert.equal(j.result.zone_market.retail_choice, false, zone);
    assert.equal(j.result.year1_revenue_lines.counted.retail, 0, zone);
    assert.equal(j.result.year1_revenue_lines.counted.arb, 0, zone);
    assert.ok(j.result.year1_revenue_lines.full.arb > 0, zone);
    assert.match(j.result.explain[0], new RegExp('^' + zone + ' is city-utility or co-op territory.*PURA 40\\.051 and 41\\.051.*try the toll case'));
    assert.ok(j.warnings.some((w) => w.startsWith(zone + ' has no retail choice') && /revenueCase toll/.test(w)), zone);
    assert.ok(j.sources.some((s) => /932NPRR/.test(s.url)), zone);
  }
  const toll = (await post('finance', { zone: 'LZ_AEN', revenueCase: 'toll' })).json();
  assert.ok(toll.result.year1_revenue_lines.counted.toll > 0);
  const north = (await post('finance', { zone: 'LZ_NORTH' })).json();
  assert.ok(north.result.year1_revenue_lines.counted.arb > 0);
  assert.equal(north.warnings.length, 0);
  // Your own arbitrage value replaces the zone, so the zone's market does not apply.
  assert.ok((await post('finance', { arbPerYear: 300 })).json().result.year1_revenue_lines.counted.retail > 0);
});

test('finance API: comma rule, query parameters, null and BOM bodies, duplicate value column', async () => {
  for (const v of ['3,5', '$2,80%', '1,0000']) {
    const r = await post('finance', { inputs: { ratePct: v } });
    assert.equal(r.statusCode, 422, v);
    assert.match(r.json().errors[0], /^ratePct is not a number: .*Use a dot for decimals/, v);
  }
  const csv = await post('finance', 'key,value\nratePct,"8,5"\ncapexPerKwh,"1,200"\n', CSV_CT);
  assert.equal(csv.statusCode, 422);
  assert.deepEqual(csv.json().errors.length, 1);
  assert.match(csv.json().errors[0], /^Row 2: ratePct is not a number: "8,5"\. A comma is only a thousands separator/);
  const thousands = (await post('finance', { inputs: { capexPerKwh: '1,200', fleetCount: '2,500' } })).json();
  assert.equal(thousands.inputs_used.capexPerKwh, 1200);
  assert.equal(thousands.result.fleet.input.batteries, 2500);
  // Query parameters on a POST are never silently ignored.
  const q = (await post('finance', {}, JSON_CT, '/api/v1/finance?zone=LZ_WEST&ratepct=9')).json();
  assert.equal(q.inputs_used.zone, FIN.zoneDefault);
  assert.ok(q.warnings.some((w) => /^Ignored query string parameter "zone"\. Did you mean "zone"/.test(w)), q.warnings.join(' | '));
  assert.ok(q.warnings.some((w) => /^Ignored query string parameter "ratepct"\. Did you mean "ratePct"/.test(w)), q.warnings.join(' | '));
  // A JSON body of null is a 400 like any other non-object; a byte order mark is stripped.
  assert.equal((await post('finance', 'null', JSON_CT)).statusCode, 400);
  assert.equal((await post('finance', null, JSON_CT)).statusCode, 400);
  const bom = await post('finance', '﻿{"inputs":{"capexPerKwh":300}}', JSON_CT);
  assert.equal(bom.statusCode, 200, bom.body);
  assert.equal(bom.json().inputs_used.capexPerKwh, 300);
  const bomCsv = await post('finance', '﻿key,value\ncapexPerKwh,300\n', CSV_CT);
  assert.equal(bomCsv.statusCode, 200, bomCsv.body);
  // A value column written twice is reported once.
  const dup = await post('finance', 'key,value,value\ncapexPerKwh,300,310\n', CSV_CT);
  assert.equal(dup.statusCode, 422);
  assert.deepEqual(dup.json().errors, ['Column "value" appears more than once. Keep one.']);
});


// ---------- pass 3 review (2026-11-04): supply, market, pitch, launch, zip and the shared request rules ----------
// Self-contained block. Item numbers are the review's. Core and page cases: tests/pass3-tools.test.cjs.

test('pass 3 item 1: a decimal comma is a 422 that says to use a dot, on every endpoint; 1,200 still works', async () => {
  const sup = await post('supply', 'part,category,lead_time_weeks\nA,cells,"3,5"\n', CSV_CT);
  assert.equal(sup.statusCode, 422);
  assert.match(sup.json().errors[0], /"3,5"\. A comma is only a thousands separator \(1,200\)\. Use a dot for decimals/);
  assert.equal((await post('supply', 'part,category,lead_time_weeks,unit_cost_usd\nA,cells,3,"1,200"\n', CSV_CT)).json().result.rows[0].unit_cost_usd, 1200);
  const met = await post('market', { metrics: 'state,cost\nTX,"3,5"\nFL,1\nGA,2\nAZ,3\nNC,4\n' });
  assert.match(met.json().errors[0], /^metrics: Row 2, column "cost": "3,5" is not a number\. A comma/);
  const zon = await post('market', { zones: { LZ_WEST: '2,80' } });
  assert.match(zon.json().errors[0], /^zones: .*"2,80" is not a number\. A comma/);
  const w = await post('market', { weights: { homes: '1,5' } });
  assert.match(w.json().errors[0], /weights: homes must be a number/);
  for (const [body, ct, url] of [[{ utility: '5078-TX', terms: { tollPerKwYear: '3,5' } }, JSON_CT], ['key,value\ntollPerKwYear,"$2,80%"\n', CSV_CT, '/api/v1/pitch?utility=5078-TX']]) {
    const r = await post('pitch', body, ct, url);
    assert.equal(r.statusCode, 422);
    assert.match(r.json().errors[0], /tollPerKwYear is not a number.*A comma is only a thousands separator/);
  }
  assert.match((await post('pitch', { utility: '5078-TX', mw: '3,5' })).json().errors[0], /^mw must be a number above 0 and at most 5000\. A comma/);
  assert.equal((await post('pitch', { utility: '5078-TX', mw: '1,000' })).json().inputs_used.mw, 1000);
  assert.match((await post('launch', {}, JSON_CT, '/api/v1/launch?rounds=1,5')).json().errors[0], /^rounds must be a whole number from 0 to 3, got "1,5"/);
  assert.equal(L.parseNumber('1,200', {}).value, 1200);
  assert.equal(L.parseNumber('3,5', {}).comma, true);
});

test('pass 3 item 2: query parameters a POST does not read are warnings with the closest field, everywhere', async () => {
  const la = (await post('launch', {}, JSON_CT, '/api/v1/launch?stat=TX')).json();
  assert.ok(la.warnings.some((x) => /^Ignored query string parameter "stat"\. Did you mean "state"\?/.test(x)), la.warnings.join(' | '));
  const pi = (await post('pitch', { utility: '5078-TX' }, JSON_CT, '/api/v1/pitch?mww=5&terms=x')).json();
  assert.ok(pi.warnings.some((x) => /"mww"\. Did you mean "mw"\?/.test(x)));
  assert.ok(pi.warnings.some((x) => /"terms"\. Did you mean "terms" \(send it in the JSON body\)\?/.test(x)));
  const su = (await post('supply', { parts: [{ part: 'A', category: 'cells', lead_time_weeks: 3 }] }, JSON_CT, '/api/v1/supply?part=1')).json();
  assert.match(su.warnings[0], /^Ignored query string parameter "part"\. Did you mean "parts" \(send it in the JSON body\)\? This endpoint reads only the request body\.$/);
  const zi = (await post('zip', { zip: '78704' }, JSON_CT, '/api/v1/zip?zipp=1')).json();
  assert.ok(zi.warnings.some((x) => /"zipp"\. Did you mean "zip"\? This endpoint reads only zip from the query string\./.test(x)), zi.warnings.join(' | '));
  const ma = (await post('market', {}, JSON_CT, '/api/v1/market?zone=x')).json();
  assert.ok(ma.warnings.some((x) => /"zone"\. Did you mean "zones" \(send it in the JSON body\)\?/.test(x)));
});

test('pass 3 item 3: a JSON body of null is a 400 on every endpoint, never the public case', async () => {
  for (const tool of ['launch', 'market', 'pitch', 'supply', 'zip']) {
    for (const body of [null, 'null']) {
      const r = await post(tool, body);
      assert.equal(r.statusCode, 400, tool + ' ' + JSON.stringify(body) + ': ' + r.body);
      assert.match(r.json().errors[0], /^Body must be a JSON object/);
    }
  }
});

test('pass 3 item 4: a UTF-8 byte order mark before JSON is fine, also when the platform parser gave up', async () => {
  assert.equal((await post('launch', '﻿{"state":"TX"}')).json().inputs_used.state, 'TX');
  // Vercel throws on req.body for a BOM; the handler then reads the stream itself.
  const raw = (bytes) => {
    const req = Readable.from([bytes]);
    Object.defineProperty(req, 'body', { get() { throw new Error('Invalid JSON'); } });
    return Object.assign(req, { method: 'POST', headers: JSON_CT, url: '/api/v1/launch' });
  };
  const res = mockRes();
  await H.launch(raw(Buffer.from('﻿{"state":"TX"}', 'utf8')), res);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().inputs_used.state, 'TX');
  // A stream that already ended cannot be re-read: still a 400, not a hang.
  const done = raw(Buffer.from('{bad', 'utf8'));
  done.resume(); await new Promise((r) => done.on('end', r));
  const res2 = mockRes();
  await H.launch(done, res2);
  assert.equal(res2.statusCode, 400);
  assert.match(res2.json().errors[0], /^Body is not valid JSON/);
});

test('pass 3 item 5: cp1252 and UTF-16 bodies get their own messages; UTF-16 with a mark is read', async () => {
  const latin = await post('supply', Buffer.from('part,category,lead_time_weeks\nCaf\xe9,cells,3\n', 'latin1'), CSV_CT);
  assert.equal(latin.statusCode, 400);
  assert.match(latin.json().errors[0], /^The body is text but not UTF-8\..*"CSV UTF-8 \(Comma delimited\)", and send that\.$/);
  const u16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('part,category,lead_time_weeks\nCafé,cells,3\n', 'utf16le')]);
  const ok = await post('supply', u16, CSV_CT);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().result.rows[0].part, 'Café');
  assert.match((await post('supply', Buffer.from('part,category\n', 'utf16le'), CSV_CT)).json().errors[0], /UTF-16 text without a byte order mark/);
  const zip = await post('supply', Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0, 0, 0, 0x61]), CSV_CT);
  assert.equal(zip.statusCode, 400);
  assert.match(zip.json().errors[0], /^The body is not text\. It looks like a binary file/);
});

test('pass 3 items 6 and 8: fullwidth ZIP and utility read as plain text; ZIP+4 and its 5-digit ZIP agree', async () => {
  assert.equal((await post('zip', { zip: '７８７０４' })).json().inputs_used.zip, '78704');
  assert.equal((await post('pitch', { utility: 'ＣｏＳｅｒｖ' })).json().inputs_used.utility, '5078-TX');
  const same = await post('zip', { zip: '78704-1234' }, JSON_CT, '/api/v1/zip?zip=78704');
  assert.equal(same.statusCode, 200, same.body);
  const diff = await post('zip', { zip: '78704-1234' }, JSON_CT, '/api/v1/zip?zip=78705');
  assert.equal(diff.statusCode, 422);
});

test('pass 3 item 7: launch step ids match in any case; path RETAIL works', async () => {
  const dup = await post('launch', 'path,id,name,owner,low,high,depends_on\nretail,a,A,o,1,2,\nretail,A,A2,o,1,2,a\n', CSV_CT, '/api/v1/launch?state=TX');
  assert.equal(dup.statusCode, 422);
  assert.match(dup.json().errors[0], /duplicate id "A" in retail \(also Row 2, as "a"; ids match in any case\)/);
  const ok = await post('launch', 'path,id,name,owner,low,high,depends_on\nRETAIL,a,A,o,1,2,\nretail,first_installs,F,o,1,1,A\n', CSV_CT, '/api/v1/launch?state=TX&path=RETAIL');
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(ok.json().result.critical_path.map((x) => x.id), ['a', 'first_installs']);
});

test('pass 3 item 9: response and error sizes are capped', async () => {
  const many = 'part,category,lead_time_weeks\n' + Array.from({ length: 2001 }, (_, i) => 'P' + i + ',cells,1').join('\n');
  const sup = await post('supply', many, CSV_CT);
  assert.equal(sup.statusCode, 422);
  assert.match(sup.json().errors[0], /2,001 parts\. The limit is 2,000/);
  const wide = 'state,' + Array.from({ length: 2000 }, (_, i) => 'm' + i).join(',') + '\nTX,' + Array(2000).fill(1).join(',') + '\n';
  const mk = await post('market', wide, CSV_CT);
  assert.equal(mk.statusCode, 422);
  assert.ok(mk.body.length < 2000, 'market error stays small: ' + mk.body.length);
  const weights = Object.fromEntries(Array.from({ length: 15000 }, (_, i) => ['nope' + i, 1]));
  const wr = await post('market', { weights });
  assert.equal(wr.statusCode, 422);
  assert.equal(wr.json().errors.length, 51);
  assert.equal(wr.json().errors[50], 'And 14,950 more like these.');
  assert.ok(wr.body.length < 100000, 'error list is small: ' + wr.body.length);
});

test('pass 3 items 11 and 12: supply gap text keeps its precision; pitch target and term rules', async () => {
  const s = (await post('supply', { parts: [{ part: 'A', category: 'cells', lead_time_weeks: 3, on_hand_weeks: 2.99999 }] })).json().result.rows[0];
  assert.equal(s.gap_weeks, 0.00001);
  assert.equal(s.gap_text, '0.00001 wk');
  const t = await post('pitch', { utility: 'CoServ', targets: [{ utility: 'Nope Power' }] });
  assert.equal(t.statusCode, 422);
  assert.doesNotMatch(t.json().errors[0], /MI/);
  const typo = await post('pitch', { utility: 'CoServ', targets: [{ utility: 'Austin Enrgy' }] });
  assert.match(typo.json().errors[0], /Did you mean Austin Energy, TX/);
  assert.deepEqual((await post('pitch', { utility: 'CoServ', terms: { termYears: 2.5 } })).json().errors, ['termYears must be a whole number of years. Got 2.5.']);
});
