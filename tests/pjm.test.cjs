// PJM, the next market: pjm-core.js math, data/pjm-value.json invariants, and POST /api/v1/pjm.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../pjm-core.js');
const DATA = require('../data/pjm-value.json');
const H = require('../api/v1/pjm.js');

function mockRes() {
  return { statusCode: 0, headers: {}, body: undefined, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; }, json() { return JSON.parse(this.body); } };
}
async function call(method, body) {
  const res = mockRes();
  await H({ method, headers: { 'content-type': 'application/json' }, body, url: '/api/v1/pjm' }, res);
  return res;
}

const zone = (extra) => ({ id: 'X', energyByKw: { 1: 40, 2: 100, 3: 130 }, energyExportUsdPerYear: 500, nitsUsdPerMwYear: 50000, transmission: { bypassable: true }, ...extra });

test('tag math: capacity is kW x $/MW-day x 365 / 1000, transmission is kW x NITS / 1000', () => {
  const z = zone();
  const v = P.valueZone(z, { tagKw: 2, capacityUsdPerMwDay: 300 });
  assert.equal(v.capacity, 219); // 2 * 300 * 365 / 1000
  assert.equal(v.transmission, 100); // 2 * 50000 / 1000
  assert.equal(v.energy, 100);
  assert.equal(v.total, 419);
});

test('energy is capped at home load unless exports are allowed; nonbypassable transmission is 0', () => {
  assert.equal(P.valueZone(zone(), { tagKw: 3 }).energy, 130);
  assert.equal(P.valueZone(zone(), { tagKw: 0 }).energy, 0);
  assert.equal(P.valueZone(zone(), { tagKw: 2.2 }).energy, 100); // nearest step
  assert.equal(P.valueZone(zone(), { tagKw: 1, allowExports: true }).energy, 500);
  const oh = P.valueZone(zone({ transmission: { bypassable: false } }), { tagKw: 2 });
  assert.equal(oh.transmission, 0);
  assert.ok(oh.capacity > 0);
  assert.equal(P.DEFAULTS.allowExports, false);
});

test('tag rules: interval counts, unknown is held back as potential, profile is 0, no research counts as before', () => {
  const at = (status) => P.valueZone(zone({ tags: { status } }), { tagKw: 2, capacityUsdPerMwDay: 300 });
  assert.equal(at('interval').capacity, 219);
  assert.equal(at('partly').capacity, 219);
  assert.equal(at('interval').potential, 0);
  assert.equal(at('unknown').capacity, 0);
  assert.equal(at('unknown').transmission, 0);
  assert.equal(at('unknown').potential, 319); // 219 capacity + 100 transmission
  assert.equal(at('unknown').total, 100); // energy only
  assert.equal(at('profile').capacity, 0);
  assert.equal(at('profile').potential, 0);
  const counted = P.valueZone(zone({ tags: { status: 'unknown' } }), { tagKw: 2, capacityUsdPerMwDay: 300, countUnconfirmed: true });
  assert.equal(counted.capacity, 219);
  assert.equal(counted.potential, 0);
  assert.equal(P.valueZone(zone({ tags: { status: 'profile' } }), { tagKw: 2, countUnconfirmed: true }).capacity, 0);
  assert.equal(P.valueZone(zone(), { tagKw: 2, capacityUsdPerMwDay: 300 }).capacity, 219);
  assert.equal(P.DEFAULTS.countUnconfirmed, false);
});

test('hit rate scales both tags; switches drop streams', () => {
  const z = zone();
  const half = P.valueZone(z, { tagKw: 2, hitRate: 0.5, capacityUsdPerMwDay: 300 });
  assert.equal(half.capacity, 109.5);
  assert.equal(half.transmission, 50);
  const none = P.valueZone(z, { includeEnergy: false, includeCapacity: false, includeTransmission: 'false' });
  assert.equal(none.total, 0);
});

test('inputs: out of range and non-numbers are errors, unknown keys are ignored', () => {
  assert.equal(P.inputs({ tagKw: 9 }).errors.length, 1);
  assert.equal(P.inputs({ tagKw: '' }).errors.length, 1);
  assert.equal(P.inputs({ hitRate: 1.5 }).errors.length, 1);
  assert.equal(P.inputs({ tagKw: 'abc' }).errors.length, 1);
  assert.deepEqual(P.inputs({ nope: 1 }).errors, []);
  assert.equal(P.inputs({ tagKw: '4' }).inputs.tagKw, 4);
});

test('data: 20 utility zones, sourced NITS rates, a full year of prices each', () => {
  assert.equal(DATA.zones.length, 20);
  const ids = DATA.zones.map((z) => z.id);
  for (const id of ['COMED', 'PPL', 'PECO', 'PSEG', 'BGE', 'PEPCO', 'DOM']) assert.ok(ids.includes(id), id);
  for (const id of ['PJM-RTO', 'MID-ATL/APS', 'OVEC']) assert.ok(!ids.includes(id), id + ' is an aggregate or not a retail zone');
  const byId = Object.fromEntries(DATA.zones.map((z) => [z.id, z]));
  assert.equal(byId.PPL.nitsUsdPerMwYear, 112973);
  assert.equal(byId.COMED.nitsUsdPerMwYear, 46876);
  assert.equal(byId.PSEG.nitsUsdPerMwYear, 183352.99);
  assert.equal(byId.METED.nitsUsdPerMwYear, byId.PENELEC.nitsUsdPerMwYear);
  for (const z of DATA.zones) {
    assert.ok(z.hours >= 8700 && z.hours <= 8800, z.id + ' hours ' + z.hours);
    assert.ok(Number.isFinite(z.energyExportUsdPerYear), z.id);
    assert.ok(['open', 'partly', 'none'].includes(z.choice), z.id);
  }
  assert.equal(DATA.capacity.deliveryYears[0].usdPerMwDay, P.DEFAULTS.capacityUsdPerMwDay);
  assert.equal(DATA.capacity.deliveryYears[0].year, '2027/2028', 'summer 2026 tags are paid in 2027/2028');
  for (const id of ['AEP', 'ATSI', 'DAY', 'DEOK']) assert.equal(byId[id].transmission.bypassable, false, id + ' Ohio transmission is nonbypassable');
  for (const id of ['PPL', 'PECO', 'COMED', 'PSEG']) assert.equal(byId[id].transmission.bypassable, true, id);
  for (const z of DATA.zones) {
    assert.equal(Object.keys(z.energyByKw).length, 16, z.id);
    assert.ok(z.energyByKw[3] < z.energyExportUsdPerYear, z.id + ' home-load energy is below full export');
    assert.equal(z.peaks.rtoFiveCP.length, 5, z.id);
    assert.ok(z.peaks.zoneOneCP.date.startsWith('2026-'), z.id);
  }
  assert.equal(byId.COMED.timezone, 'Central');
  const TAGS = require('../data/pjm-tags.json');
  for (const id of ['COMED', 'PPL', 'METED', 'PENELEC', 'PSEG', 'ATSI']) assert.equal(byId[id].tags.status, 'interval', id);
  for (const id of ['PECO', 'DUQ']) assert.equal(byId[id].tags.status, 'profile', id);
  for (const id of ['BGE', 'PEPCO', 'JCPL', 'AECO', 'DPL', 'RECO', 'AEP', 'DAY', 'DEOK']) assert.equal(byId[id].tags.status, 'unknown', id);
  assert.equal(byId.APS.tags.status, 'partly');
  for (const [id, z] of Object.entries(TAGS.zones)) for (const u of z.utilities) {
    assert.match(u.plc.source, /^https:\/\//, id + ' capacity rule has a source');
    if (z.status === 'interval') assert.ok(u.plc.quote && u.plc.quote.length > 10, id + ' confirmed rule quotes the document');
  }
  assert.ok(!byId.APS.states.includes('VA') && !byId.AEP.states.includes('TN'));
  assert.ok(DATA.nits.source.startsWith('https://www.pjm.com/'));
});

test('API: GET is usage, POST matches the core, PPL nonbypassable zeroes only PPL transmission', async () => {
  const g = await call('GET');
  assert.equal(g.statusCode, 200);
  assert.equal(g.json().tool, 'pjm');
  const r = await call('POST', JSON.stringify({ tagKw: 3 }));
  assert.equal(r.statusCode, 200);
  const zones = r.json().result.zones;
  const core = P.rank(DATA.zones, { tagKw: 3 });
  assert.equal(zones[0].zone, core[0].zone.id);
  assert.equal(zones.length, 20);
  const nb = (await call('POST', JSON.stringify({ tagKw: 3, pplNonbypass: true }))).json().result.zones;
  const ppl = nb.find((z) => z.zone === 'PPL'), pseg = nb.find((z) => z.zone === 'PSEG');
  assert.equal(ppl.transmission_usd_yr, 0);
  assert.ok(pseg.transmission_usd_yr > 0);
  // Tag rules: counted where confirmed, 0 with a "potential" where not confirmed, 0 with none for a class profile.
  const z0 = (id) => zones.find((z) => z.zone === id);
  assert.equal(z0('COMED').tag_rules, 'interval');
  assert.ok(z0('COMED').capacity_usd_yr > 0 && z0('COMED').not_counted_if_confirmed_usd_yr === 0);
  assert.equal(z0('BGE').tag_rules, 'unknown');
  assert.ok(z0('BGE').capacity_usd_yr === 0 && z0('BGE').not_counted_if_confirmed_usd_yr > 0);
  assert.equal(z0('PECO').tag_rules, 'profile');
  assert.ok(z0('PECO').capacity_usd_yr === 0 && z0('PECO').not_counted_if_confirmed_usd_yr === 0);
  const all = (await call('POST', JSON.stringify({ tagKw: 3, countUnconfirmed: true }))).json().result.zones;
  assert.ok(all.find((z) => z.zone === 'BGE').capacity_usd_yr > 0, 'countUnconfirmed counts BGE');
  assert.equal(all.find((z) => z.zone === 'PECO').capacity_usd_yr, 0, 'a class-profile zone stays 0');
  const bad = await call('POST', JSON.stringify({ tagKw: 9, pplNonbypass: 'yes' }));
  assert.equal(bad.statusCode, 422);
  assert.equal(bad.json().errors.length, 2);
  const warn = (await call('POST', JSON.stringify({ tagkw: 3 }))).json().warnings;
  assert.match(warn[0], /Did you mean "tagKw"/);
});

test('page: no em dashes, quote is attributed as a report not a direct quote', () => {
  for (const f of ['pjm.html', 'pjm.js', 'pjm-core.js', 'pjm.css', 'api/v1/pjm.js', 'scripts/pjm-value.cjs', 'scripts/fetch-pjm-prices.cjs']) {
    assert.ok(!fs.readFileSync(path.join(__dirname, '..', f), 'utf8').includes(String.fromCharCode(0x2014)), f);
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'pjm.html'), 'utf8');
  assert.match(html, /Base said it saves customers money/);
  assert.doesNotMatch(html, /“Base saves customers money/);
});

// ---------- Use your own data: one row per zone ----------
const YD = require('../yourdata.js');
const IDS = DATA.zones.map((z) => z.id);
const csvFile = (t) => ({ kind: 'csv', data: YD.parseCSV(t) });

test('your data: values replace that zone only, blanks keep the public number', () => {
  const r = P.loadYours(csvFile('zone,home_kw,peak_coverage_pct,tag_rules,energy_usd_per_year,capacity_scale\ncomed,4,80,,,\nBGE,,,interval,,\nPECO,,,,"1,200",\n'), IDS);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.yours, { COMED: { homeKw: 4, hitRate: 0.8 }, BGE: { tagRules: 'interval' }, PECO: { energyUsdPerYear: 1200 } });
  const zones = P.applyYours(DATA.zones, r.yours);
  assert.equal(DATA.zones.find((z) => z.id === 'COMED').yours, undefined, 'public data is not changed');
  const v = (id, zs = zones) => P.valueZone(zs.find((z) => z.id === id), {});
  const pub = (id) => v(id, DATA.zones);
  // ComEd: 4 kW at 80% coverage. Capacity = 4 x 0.8 x 333.44 x 365 / 1000.
  assert.equal(v('COMED').capacity, Math.round(4 * 0.8 * 333.44 * 365 / 1000 * 100) / 100);
  assert.equal(v('COMED').energy, DATA.zones.find((z) => z.id === 'COMED').energyByKw[4]);
  assert.deepEqual(v('COMED').yours, ['homeKw', 'hitRate']);
  // BGE: the company says interval, so its tags now count and nothing is held back.
  assert.equal(pub('BGE').capacity, 0);
  assert.ok(v('BGE').capacity > 0);
  assert.equal(v('BGE').potential, 0);
  assert.equal(v('BGE').tagStatus, 'interval');
  // PECO: own energy value; tags stay 0 because the public rule is still a class profile.
  assert.equal(v('PECO').energy, 1200);
  assert.equal(v('PECO').capacity, 0);
  // A zone not in the file is untouched.
  assert.deepEqual(v('PPL'), pub('PPL'));
  // "profile" from the company zeroes a confirmed zone.
  const off = P.applyYours(DATA.zones, P.loadYours({ kind: 'json', data: { zones: [{ zone: 'PPL', tag_rules: 'profile' }] } }, IDS).yours);
  assert.equal(v('PPL', off).capacity, 0);
});

test('your data: bad files stop the load with a row-level message', () => {
  const bad = P.loadYours(csvFile('zone,home_kw,Foo\nNOPE,3,1\nCOMED,"3,5",\nCOMED,2,\nPPL,99,\nBGE,,\n'), IDS);
  assert.deepEqual(bad.yours, {});
  assert.match(bad.errors[0], /^Row 2: unknown zone "NOPE"/);
  assert.match(bad.errors[1], /^Row 3, column "home_kw": "3,5" is not a number\. A comma is only a thousands separator/);
  assert.match(bad.errors[2], /^Row 4: COMED appears again \(first at Row 3\)/);
  assert.match(bad.errors[3], /^Row 5, column "home_kw": 99 is outside 0 to 8 kW/);
  assert.match(bad.warnings[0], /Ignored unknown column "Foo"/);
  assert.match(P.loadYours({ kind: 'json', data: { zones: [{ zone: 'ppl', tag_rules: 'maybe' }] } }, IDS).errors[0], /tag_rules": "maybe" is not one of interval, profile, unknown/);
  assert.match(P.loadYours(csvFile('home_kw\n3\n'), IDS).errors[0], /needs a "zone" column/);
  assert.match(P.loadYours(csvFile('zone,home_kw\nCOMED,\n'), IDS).errors[0], /No zone has a value/);
  assert.match(P.loadYours({ kind: 'json', data: { zones: 'x' } }, IDS).errors[0], /one row per zone/);
  assert.match(P.loadYours({ kind: 'json', data: [1, 2] }, IDS).errors[0], /row of named fields/);
  assert.match(P.loadYours(csvFile('zone,Zone\nCOMED,PPL\n'), IDS).errors[0], /same column/);
  assert.match(P.loadYours({ kind: 'json', data: Array.from({ length: 201 }, () => ({ zone: 'COMED' })) }, IDS).errors[0], /limit is 200/);
  // Keys that could reach Object.prototype are just unknown zones.
  assert.match(P.loadYours({ kind: 'json', data: [{ zone: '__proto__', home_kw: 1 }] }, IDS).errors[0], /unknown zone/);
});

test('your data: the template round-trips and names every zone', () => {
  const text = YD.toCSV(P.templateRows(DATA.zones), P.COLUMNS);
  const rows = YD.parseCSV(text);
  assert.equal(rows.length, 20);
  assert.deepEqual(Object.keys(rows[0]), P.COLUMNS);
  // Loaded as is, the template only restates the public tag rules, so no total changes.
  const r = P.loadYours({ kind: 'csv', data: rows }, IDS);
  assert.deepEqual(r.errors, []);
  const a = P.rank(P.applyYours(DATA.zones, r.yours), {}).map((x) => [x.zone.id, x.value.total]);
  const b = P.rank(DATA.zones, {}).map((x) => [x.zone.id, x.value.total]);
  assert.deepEqual(a, b);
});

test('API: zones as JSON rows, as CSV text, and as a CSV body all match the core', async () => {
  const rows = [{ zone: 'COMED', home_kw: 4, peak_coverage_pct: 90 }, { zone: 'BGE', tag_rules: 'interval' }];
  const want = P.rank(P.applyYours(DATA.zones, P.loadYours({ kind: 'json', data: rows }, IDS).yours), {});
  const j = (await call('POST', JSON.stringify({ zones: rows }))).json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.inputs_used.your_zones, ['COMED', 'BGE']);
  assert.deepEqual(j.result.zones.map((z) => [z.zone, z.total_usd_yr]), want.map((x) => [x.zone.id, x.value.total]));
  assert.deepEqual(j.result.zones.find((z) => z.zone === 'COMED').yours, ['homeKw', 'hitRate']);
  const text = 'zone,home_kw,peak_coverage_pct,tag_rules\nCOMED,4,90,\nBGE,,,interval\n';
  const asText = (await call('POST', JSON.stringify({ zones: text }))).json();
  assert.deepEqual(asText.result.zones.map((z) => z.total_usd_yr), j.result.zones.map((z) => z.total_usd_yr));
  const res = mockRes();
  await H({ method: 'POST', headers: { 'content-type': 'text/csv' }, body: text, url: '/api/v1/pjm' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().result.zones.map((z) => z.total_usd_yr), j.result.zones.map((z) => z.total_usd_yr));
  const bad = await call('POST', JSON.stringify({ zones: [{ zone: 'NOPE', home_kw: 3 }] }));
  assert.equal(bad.statusCode, 422);
  assert.match(bad.json().errors[0], /unknown zone "NOPE"/);
  // The usage example runs.
  const ex = (await call('GET')).json().example;
  assert.equal((await call('POST', JSON.stringify(ex))).statusCode, 200);
});

// ---------- the day story on the homepage ----------
test('story data: every zone has 24 hourly prices, cheaper at night than in the evening', () => {
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const z of DATA.zones) {
    assert.equal(z.hourlyAvgRt.length, 24, z.id);
    assert.ok(z.hourlyAvgRt.every((x) => Number.isFinite(x)), z.id);
    assert.ok(mean(z.hourlyAvgRt.slice(1, 5)) < mean(z.hourlyAvgRt.slice(17, 21)), z.id + ' night is cheaper than evening');
    // The 24 hourly averages agree with the yearly average.
    assert.ok(Math.abs(mean(z.hourlyAvgRt) - z.avgRtUsdPerMwh) < 0.5, z.id);
  }
});

test('story page: four steps, the Blender house with a flat fallback, both sides, Base figures sourced', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'pjm.html'), 'utf8');
  for (const s of ['night', 'evening', 'peak', 'outage']) assert.match(html, new RegExp('role="tab"[^>]*data-step="' + s + '"'));
  assert.match(html, /id="house-canvas" hidden/);
  assert.match(html, /id="house-fallback"/);
  assert.match(html, /<script type="module" src="\/pjm-scene\.js"><\/script>/);
  assert.match(html, /The home<\/p>/);
  assert.match(html, /The company<\/p>/);
  // Base's published figures are stated as Base's, with a link, and the page stays independent.
  assert.match(html, /Base Power’s published Texas prices/);
  assert.match(html, /href="https:\/\/www\.basepowercompany\.com\/"/);
  assert.match(html, /Not affiliated with Base Power/);
  const scene = fs.readFileSync(path.join(__dirname, '..', 'pjm-scene.js'), 'utf8');
  assert.match(scene, /\/models\/house-suburban\.glb/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'models', 'house-suburban.glb')));
  assert.ok(!scene.includes(String.fromCharCode(0x2014)));
});
