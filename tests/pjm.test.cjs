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
  const ppl = nb.find((z) => z.zone === 'PPL'), peco = nb.find((z) => z.zone === 'PECO');
  assert.equal(ppl.transmission_usd_yr, 0);
  assert.ok(peco.transmission_usd_yr > 0);
  const bad = await call('POST', JSON.stringify({ tagKw: 9, pplNonbypass: 'yes' }));
  assert.equal(bad.statusCode, 422);
  assert.equal(bad.json().errors.length, 2);
  const warn = (await call('POST', JSON.stringify({ tagkw: 3 }))).json().warnings;
  assert.match(warn[0], /Did you mean "tagKw"/);
});

test('page: no em dashes, quote is attributed as a report not a direct quote', () => {
  for (const f of ['index.html', 'pjm.js', 'pjm-core.js', 'pjm.css', 'api/v1/pjm.js', 'scripts/pjm-value.cjs', 'scripts/fetch-pjm-prices.cjs']) {
    assert.ok(!fs.readFileSync(path.join(__dirname, '..', f), 'utf8').includes(String.fromCharCode(0x2014)), f);
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /Base said it saves customers money/);
  assert.doesNotMatch(html, /“Base saves customers money/);
});
