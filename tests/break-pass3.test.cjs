// Break-test pass 3 (2026-11-04): one test or more per finding, against the API handlers and the
// cores the pages use. Numbers in the brief are the item numbers from the break-test report.
const test = require('node:test');
const assert = require('node:assert/strict');

const L = require('../api/_lib.js');
const F = require('../finance-core.js');
const LC = require('../launch-core.js');
const S = require('../supply-core.js');
const P = require('../pitch-core.js');
const MC = require('../market-core.js');
const B = require('../bom-check-core.js');
const YD = require('../yourdata.js');
const Z = require('../zip-launch-core.js');
const DB = require('../dispatch-bench-core.js');
const FIN = require('../data/finance-defaults.json');
const ZONES = require('../data/zone-value.json');
const UT = require('../data/expansion-map.json').utilities;

const H = {
  finance: require('../api/v1/finance.js'), launch: require('../api/v1/launch.js'), supply: require('../api/v1/supply.js'),
  market: require('../api/v1/market.js'), pitch: require('../api/v1/pitch.js'), zip: require('../api/v1/zip.js'),
};
const JSON_CT = { 'content-type': 'application/json' };
const CSV_CT = { 'content-type': 'text/csv' };
function mockRes() {
  return { statusCode: 0, headers: {}, body: undefined, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; }, json() { return JSON.parse(this.body); } };
}
async function post(tool, body, headers = JSON_CT, url = '/api/v1/' + tool) {
  const res = mockRes();
  await H[tool]({ method: 'POST', headers, body, url }, res);
  return res;
}
const csv = (t) => ({ kind: 'csv', data: YD.parseCSV(t) });
const chain = (n) => ['path,id,name,owner,low,high,depends_on,round_weeks']
  .concat(Array.from({ length: n }, (_, i) => 'retail,s' + i + ',S' + i + ',Ops,0.01,0.02,' + (i ? 's' + (i - 1) : '') + ',1')).join('\n') + '\n';

// ---------- 1. launch: step cap and linear-time critical path ----------

test('1 launch: over 300 steps per path is a clear 422; the 300-step case runs well under a second', async () => {
  for (const n of [301, 2000, 8000]) {
    const t0 = Date.now();
    const r = await post('launch', chain(n), CSV_CT, '/api/v1/launch?state=TX&rounds=3');
    assert.equal(r.statusCode, 422);
    assert.deepEqual(r.json().errors, ['retail: ' + n + ' steps is over the limit of 300 steps per path. Merge small steps into larger ones, or split the plan into phases.']);
    assert.ok(Date.now() - t0 < 1000, n + ' steps took ' + (Date.now() - t0) + ' ms');
  }
  const t0 = Date.now();
  const ok = await post('launch', chain(300), CSV_CT, '/api/v1/launch?state=TX&rounds=3');
  const ms = Date.now() - t0;
  assert.equal(ok.statusCode, 200);
  assert.ok(ms < 1000, '300 steps took ' + ms + ' ms');
  // The page reads the same core, so it shows the same error.
  assert.match(LC.applyOverrides(require('../data/launch-steps.json'), csv(chain(301))).errors[0], /over the limit of 300 steps per path/);
});

test('1 launch: the faster bestShortening and tennisCost give the same answers as a full reschedule', () => {
  const steps = [
    { id: 'a', name: 'A', low: 4, high: 8 }, { id: 'b', name: 'B', low: 2, high: 3, depends_on: ['a'] },
    { id: 'c', name: 'C', low: 6, high: 6, depends_on: ['a'] }, { id: 'first_installs', name: 'F', low: 1, high: 2, depends_on: ['b', 'c'] },
  ];
  for (const key of ['low', 'high']) {
    const base = LC.schedule(steps, key).total;
    const b = LC.bestShortening(steps, key);
    for (const o of b.options) {
      const trial = steps.map((s) => (s.id === o.id ? Object.assign({}, s, { [key]: s[key] / 2 }) : s));
      assert.equal(o.saved, Math.round((base - LC.schedule(trial, key).total) * 10) / 10, key + ' ' + o.id);
    }
  }
  const c = LC.tennisCost(steps, [{ step: 'c', round_weeks: 2 }, { step: 'b', round_weeks: 1 }], 1, 'low');
  assert.equal(c.addedFirst, 2);
  assert.deepEqual(c.worst, { step: 'c', delay: 2 });
  assert.throws(() => LC.schedule([{ id: 'x', name: 'X', low: 1, high: 1, depends_on: ['y'] }, { id: 'y', name: 'Y', low: 1, high: 1, depends_on: ['x'] }]), /Cycle in launch steps: x -> y -> x/);
});

// ---------- 2. finance: page zone and API agree after a file load ----------

test('2 finance: a file without a zone keeps the zone; reset restores the public default; page and API agree', async () => {
  const ids = ZONES.zones.slice().sort((a, b) => b.usdPerYear - a.usdPerYear).map((z) => z.id);
  const file = 'key,value\nratePct,9\ncapexPerKwh,300\n';
  // Page: the zone shown at load, then after the file (finance.js useDefaults with FinanceCore.zoneAfterLoad).
  const initial = F.pickZone(ids, FIN.zoneDefault);
  assert.equal(initial, 'LZ_NORTH');
  const r = F.applyOverrides(FIN, csv(file), ids);
  assert.deepEqual(r.errors, []);
  assert.equal(r.zone, null);
  const pageZone = F.zoneAfterLoad({ zoneIds: ids, current: initial, fileZone: r.zone, publicZone: FIN.zoneDefault });
  assert.equal(pageZone, 'LZ_NORTH');
  // API on the same file.
  const api = (await post('finance', file, CSV_CT)).json();
  assert.equal(api.inputs_used.zone, pageZone);
  const z = ZONES.zones.find((x) => x.id === pageZone);
  const pageInputs = Object.assign({ revenueCase: r.defaults.revenueCaseDefault, arbPerYear: z.usdPerYear }, Object.fromEntries(r.defaults.groups.flatMap((g) => g.fields).map((f) => [f.key, f.value])));
  const page = F.sizeDebt(F.normalize(pageInputs));
  assert.equal(api.result.debt, L.roundNum(page.debt));
  assert.equal(api.result.min_dscr, L.roundNum(page.minDscr));
  // A zone the user picked stays; a file's zone wins; reset goes back to the public default.
  assert.equal(F.zoneAfterLoad({ zoneIds: ids, current: 'LZ_HOUSTON', fileZone: null, publicZone: FIN.zoneDefault }), 'LZ_HOUSTON');
  assert.equal(F.zoneAfterLoad({ zoneIds: ids, current: 'LZ_HOUSTON', fileZone: 'LZ_SOUTH', publicZone: FIN.zoneDefault }), 'LZ_SOUTH');
  assert.equal(F.zoneAfterLoad({ zoneIds: ids, current: 'LZ_WEST', fileZone: null, publicZone: FIN.zoneDefault, reset: true }), 'LZ_NORTH');
  assert.equal(F.applyOverrides(FIN, csv('key,value\nzone,lz_south\n'), ids).zone, 'LZ_SOUTH');
});

// ---------- 3. market: higherIsBetter must be a real yes or no ----------

test('3 market: higherIsBetter accepts true, false and "true"/"false"; anything else is a 422', async () => {
  const states = Object.fromEntries(['TX', 'FL', 'GA', 'AZ', 'NC'].map((s, i) => [s, { x: i }]));
  for (const bad of ['no', 0, null, 'maybe', 1]) {
    const r = await post('market', { metrics: { factors: [{ key: 'x', higherIsBetter: bad }], states } });
    assert.equal(r.statusCode, 422, JSON.stringify(bad));
    assert.match(r.json().errors[0], /factors\[0\]: higherIsBetter must be true or false/);
  }
  for (const [v, want] of [[false, false], ['FALSE', false], ['true', true], [true, true], [undefined, true]]) {
    const f = v === undefined ? { key: 'x' } : { key: 'x', higherIsBetter: v };
    const r = MC.loadStates({ kind: 'json', data: { factors: [f], states } });
    assert.deepEqual(r.errors, []);
    assert.equal(r.factors[0].higherIsBetter, want, JSON.stringify(v));
  }
});

// ---------- 4. pitch: inputs_used reports the program size used ----------

test('4 pitch: inputs_used.terms.programMw is the mw the pitch was built on', async () => {
  const j = (await post('pitch', { utility: 'CoServ Electric', mw: 50 })).json();
  assert.equal(j.inputs_used.mw, 50);
  assert.equal(j.inputs_used.terms.programMw, 50);
  assert.equal(j.result.program.mw, 50);
  const d = (await post('pitch', { utility: 'CoServ Electric' })).json();
  assert.equal(d.inputs_used.terms.programMw, 100);
});

// ---------- 5. finance: kw must be above 0 ----------

test('5 finance: kw 0 is a 422 on the API and an error on the page form', async () => {
  const r = await post('finance', { inputs: { kw: 0 } });
  assert.equal(r.statusCode, 422);
  assert.match(r.json().errors[0], /^kw must be at least 0\.1/);
  assert.ok(F.validateFields(FIN, { kw: '0' }).errors.kw);
  assert.equal((await post('finance', { inputs: { kw: 0.5 } })).statusCode, 200);
});

// ---------- 6. content types: 415 for anything but JSON and CSV ----------

test('6 every tool: a form-urlencoded or text/plain body is a 415 naming application/json', async () => {
  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  for (const tool of Object.keys(H)) {
    for (const [headers, body] of [[form, '{"state":"TX"}'], [form, { '{"zip":"78704"}': '' }], [{ 'content-type': 'text/plain' }, '{"a":1}'], [{}, 'state=TX']]) {
      const r = await post(tool, body, headers);
      assert.equal(r.statusCode, 415, tool + ' ' + JSON.stringify(headers));
      assert.match(r.json().errors[0], /Content-Type: application\/json/);
    }
    // No Content-Type with a JSON-looking body is read as JSON; an empty form body is no body.
    assert.notEqual((await post(tool, '{}', {})).statusCode, 415, tool);
    assert.notEqual((await post(tool, {}, form)).statusCode, 415, tool);
  }
  assert.equal((await post('finance', '{"revenueCase":"toll"}', {})).json().inputs_used.revenueCase, 'toll');
});

// ---------- 7. CSV problems handled the same way on every tool ----------

test('7 a key on two rows is a row error on finance and pitch', () => {
  assert.match(F.applyOverrides(FIN, csv('key,value\nratePct,9\nratepct,8\n'), ['LZ_NORTH']).errors[0], /^Row 3: ratePct appears again \(first at Row 2\)/);
  const p = P.loadYourData(csv('key,value\ntollPerKwYear,80\ntollPerKwYear,90\n'), UT);
  assert.deepEqual(p.errors, ['Row 3: tollPerKwYear appears again (first at Row 2). Keep one row per key.']);
});

test('7 a column written twice is an error on finance, launch, pitch, supply, market and the BOM checker', () => {
  const twice = /appears more than once\. Keep one\.$|are the same column .*Keep one\.$/;
  const launchData = require('../data/launch-steps.json');
  const cases = {
    finance: F.applyOverrides(FIN, csv('key,value,value\nratePct,9,8\n'), ['LZ_NORTH']).errors,
    financeCase: F.applyOverrides(FIN, csv('key,Key,value\nratePct,x,9\n'), ['LZ_NORTH']).errors,
    launch: LC.applyOverrides(launchData, csv('path,id,name,owner,low,high,high\nretail,a,A,Me,1,2,3\n')).errors,
    pitch: P.loadYourData(csv('key,value,Value\ntollPerKwYear,80,90\n'), UT).errors,
    supply: S.validate(csv('part,category,lead_time_weeks,lead_time_weeks\nA,cells,5,9\n')).errors,
    market: MC.load(csv('state,cac,cac\nTX,1,2\n'), []).errors,
    zones: MC.load(csv('zone,usd_per_year,usd_per_year\nLZ_NORTH,1,2\n'), ['LZ_NORTH']).errors,
    bom: B.check('part_number,description,qty,supplier,qty\nP,D,1,S,2\n').errors,
  };
  for (const [k, errs] of Object.entries(cases)) assert.ok(errs.some((e) => twice.test(e)), k + ': ' + errs.join(' | '));
});

test('7 unknown extra columns warn on every tool, finance included', () => {
  const warned = (ws) => ws.some((w) => /^Ignored unknown column "colour"/.test(w));
  assert.ok(warned(F.applyOverrides(FIN, csv('key,value,colour\nratePct,9,red\n'), ['LZ_NORTH']).warnings));
  assert.ok(warned(LC.applyOverrides(require('../data/launch-steps.json'), csv('path,id,name,owner,low,high,colour\nretail,first_installs,A,Me,1,2,red\n')).warnings));
  assert.ok(warned(P.loadYourData(csv('key,value,colour\ntollPerKwYear,80,red\n'), UT).warnings));
  assert.ok(warned(S.validate(csv('part,category,lead_time_weeks,colour\nA,cells,5,red\n')).warnings));
  assert.ok(warned(MC.load(csv('zone,usd_per_year,colour\nLZ_NORTH,1,red\n'), ['LZ_NORTH']).warnings));
  assert.ok(warned(B.check('part_number,description,qty,supplier,colour\nP,D,1,S,red\n').warnings));
});

// ---------- 8. any case for enum values and keys, with a suggestion ----------

test('8 revenueCase, file keys and weights match in any case; an unknown key names the closest one', async () => {
  const r = (await post('finance', { revenueCase: 'TOLL' })).json();
  assert.equal(r.ok, true);
  assert.equal(r.inputs_used.revenueCase, 'toll');
  assert.equal((await post('finance', { revenueCase: 'toll', inputs: { revenueCase: 'TOLL' } })).statusCode, 200);
  const c = (await post('finance', 'key,value\nratepct,9\nREVENUECASE,Stacked\n', CSV_CT)).json();
  assert.equal(c.ok, true);
  assert.equal(c.inputs_used.ratePct, 9);
  assert.equal(c.inputs_used.revenueCase, 'stacked');
  const u = (await post('finance', 'key,value\nratPct,9\n', CSV_CT)).json();
  assert.deepEqual(u.errors, ['Row 2: unknown key "ratPct". Did you mean ratePct? Download the template for the full list.']);
  assert.equal(P.loadYourData(csv('key,value\nTOLLPERKWYEAR,80\n'), UT).terms.tollPerKwYear, 80);
  assert.match(P.loadYourData(csv('key,value\ntollPerKwYr,80\n'), UT).errors[0], /Did you mean tollPerKwYear\?/);
  const m = (await post('market', { weights: { HOMES: 0 } })).json();
  assert.equal(m.ok, true);
  assert.equal(m.inputs_used.weights.homes, 0);
  assert.match((await post('market', { weights: { homs: 1 } })).json().errors[0], /Did you mean "homes"\?/);
  assert.match((await post('launch', { stat: 'TX' })).json().warnings[0], /^Ignored unknown field "stat"\. Did you mean "state"\?$/);
});

// ---------- 9. echoes are clipped ----------

test('9 launch: a huge state comes back clipped, not as a 100 KB error', async () => {
  const r = await post('launch', { state: 'X'.repeat(100000) });
  assert.equal(r.statusCode, 422);
  assert.ok(r.body.length < 1000, r.body.length + ' bytes');
  assert.match(r.json().errors[0], /^state "X{40}\.\.\." is not a two-letter/);
  const k = await post('finance', { inputs: { ['k'.repeat(5000)]: 1 } });
  assert.ok(k.body.length < 1000);
});

// ---------- 10. supply page: two BOM formats, CSV injection, grammar ----------

test('10 BOM checker: the supply panel file is recognized; missing columns are one message', () => {
  const panel = B.check('part,category,lead_time_weeks\nA,cells,5\n');
  assert.equal(panel.errors.length, 1);
  assert.match(panel.errors[0], /^This looks like the supply panel format \(it has category, lead_time_weeks\)\. Load that file with "Use your own data" at the top of this page/);
  const miss = B.check('part_number,colour\nP,red\n');
  assert.deepEqual(miss.errors, ['Missing columns description, qty, supplier. Required columns: part_number, description, qty, supplier.']);
  assert.deepEqual(B.check('part_number,description,qty\nP,D,1\n').errors, ['Missing column supplier. Required columns: part_number, description, qty, supplier.']);
});

test('10 every CSV the site writes escapes formula cells with an apostrophe', () => {
  const hdr = B.DEMO_CSV.split('\n')[0];
  const res = B.check(hdr + '\n=1+1,@SUM(A1),1,+cmd|calc,,,5,0,1\n');
  assert.deepEqual(res.errors, []);
  const line = res.flagged_csv.split('\n')[1];
  assert.ok(line.startsWith("'=1+1,'@SUM(A1),1,'+cmd|calc,"), line);
  assert.equal(B.csvCell('-5'), '-5');
  assert.equal(B.csvCell(-5), '-5');
  assert.equal(B.csvCell('-x'), "'-x");
  assert.equal(YD.toCSV([{ a: '=HYPERLINK("x")', b: -3, c: '@x', d: '\tx' }]), 'a,b,c,d\n"\'=HYPERLINK(""x"")",-3,\'@x,\'\tx\n');
  assert.equal(YD.csvCell('+1.5'), '+1.5');
  // The dispatch bench trace: numbers stay numbers, no cell starts with = + or @.
  const data = require('../data/ercot-dam-houston.json');
  const trace = DB.csv(DB.run(data.hours.map((h) => h.usd_mwh), {}, 'guarded'));
  assert.ok(!/(^|,)[=+@]/m.test(trace), 'formula cell in the bench trace');
});

test('10 BOM checker page: "1 of 1 row has", "2 of 3 rows have"', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'bom-check.js'), 'utf8');
  assert.match(src, /\(flagged === 1 \? ' has' : ' have'\) \+ ' no qualified second source\./);
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'supply.html'), 'utf8');
  assert.match(html, /Two boxes, two file formats\./);
});

// ---------- 11. supply weeks text ----------

test('11 supply: anything under 0.1 week reads "under 0.1 wk"', async () => {
  assert.equal(S.weeksText(0.05), 'under 0.1 wk');
  const j = (await post('supply', [{ part: 'A', category: 'cells', lead_time_weeks: 0.05 }])).json();
  assert.match(j.result.summary, /Longest gap: A, under 0\.1 wk\./);
});

// ---------- 12. market factors must be a list ----------

test('12 market: metrics.factors that is not a list is a 422', async () => {
  const states = Object.fromEntries(['TX', 'FL', 'GA', 'AZ', 'NC'].map((s, i) => [s, { x: i }]));
  for (const f of ['x', { key: 'x' }, 5]) {
    const r = await post('market', { metrics: { factors: f, states } });
    assert.equal(r.statusCode, 422);
    assert.match(r.json().errors[0], /^metrics: factors must be a list/);
  }
});

// ---------- 13. output numbers are rounded at the API boundary ----------

test('13 API results carry no float noise; inputs_used is untouched', async () => {
  assert.equal(L.roundNum(68600000.00000001), 68600000);
  assert.equal(L.roundNum(3.0000000000000004), 3);
  assert.equal(L.roundNum(1.9600000000000002), 1.96);
  assert.equal(L.roundNum(0.8979591836734694), 0.898);
  assert.equal(L.roundNum(0.000012346), 0.00001235);
  assert.equal(L.roundNum(-0.00001), -0.00001);
  const noisy = /\d\.\d{5,}/;
  for (const [tool, body] of [['finance', {}], ['market', {}], ['pitch', { utility: 'CoServ Electric' }], ['launch', { state: 'TX' }], ['supply', [{ part: 'A', category: 'cells', lead_time_weeks: 1.1, on_hand_weeks: 0.2 }]]]) {
    const j = (await post(tool, body)).json();
    const nums = JSON.stringify(j.result).match(/-?\d+\.\d+(e-?\d+)?/g) || [];
    const bad = nums.filter((n) => noisy.test(n) && Math.abs(Number(n)) >= 1);
    assert.deepEqual(bad, [], tool);
  }
});

// ---------- 14. zip ----------

test('14 zip: no zip says required; ZIP+4 with or without the dash uses the first five digits', async () => {
  for (const body of [undefined, {}, { zip: null }, { zip: '' }]) {
    const r = await post('zip', body);
    assert.equal(r.statusCode, 422);
    assert.match(r.json().errors[0], /^zip is required/);
  }
  for (const z of ['78704-1234', '787041234']) {
    const r = (await post('zip', { zip: z })).json();
    assert.equal(r.ok, true, z);
    assert.equal(r.inputs_used.zip, '78704');
  }
  assert.equal(Z.normalizeZip('787041234'), '78704');
  assert.equal(Z.normalizeZip('7870412345'), null);
});

// ---------- 15. finance: headerless and binary files ----------

test('15 finance: a headerless CSV and a binary file each get their own message', async () => {
  const h = F.applyOverrides(FIN, csv('ratePct,9\ncapexPerKwh,300\n'), ['LZ_NORTH']);
  assert.deepEqual(h.errors, ['No "key" or "value" column. The first line must be the header row key,value (download the template); this file\'s first line is "ratePct,9".']);
  const b = F.applyOverrides(FIN, csv('PK\u0003\u0004\u0000\u0000,�\nx,y\n'), ['LZ_NORTH']);
  assert.match(b.errors[0], /^This file is not text/);
  assert.throws(() => YD.parseText('PK\u0003\u0004\u0000', 'inputs.xlsx'), /This file is not text/);
  const api = await post('finance', 'PK\u0003\u0004\u0000\u0000junk', CSV_CT);
  assert.equal(api.statusCode, 400);
  assert.match(api.json().errors[0], /^The body is not text/);
  const ah = (await post('finance', 'ratePct,9\n', CSV_CT)).json();
  assert.match(ah.errors[0], /^No "key" column\. The first line must be the header row key,value/);
});
