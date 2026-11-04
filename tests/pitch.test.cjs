const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../pitch-core.js');
const data = require('../data/expansion-map.json');

function u(id, state, values, rtos) {
  return { id, name: 'Util ' + id, state, values: Object.assign({ homes: null, saidi: null, saifi: null, storm: null, heat: null, retail: null, wholesale: null, batteries: null, demand_response: null, dynamic_pricing: null }, values), detail: { rtos: rtos || 'No ISO balancing authority' } };
}

test('batteries from MW: 20 kW and 39.2 kWh per unit', () => {
  const p = P.sizeProgram(100, 500000);
  assert.equal(p.batteries, 5000);
  assert.ok(Math.abs(p.mwh - 196) < 1e-9);
  assert.equal(p.share, 0.01);
  assert.ok(Math.abs(p.hours - 1.96) < 1e-9);
  assert.equal(P.sizeProgram(1, 100).batteries, 50);
  assert.equal(P.sizeProgram(0.03, 100).batteries, 2, 'partial batteries round up');
  assert.equal(P.sizeProgram(100, null).share, null, 'unknown customers gives null share');
  assert.equal(P.sizeProgram(0, 100), null);
  assert.equal(P.sizeProgram(NaN, 100), null);
});

test('percentile ignores nulls and returns null for null input', () => {
  const vals = [1, 2, null, 3, 4, undefined];
  assert.equal(P.percentile(vals, 3), 0.5);
  assert.equal(P.percentile(vals, 1), 0);
  assert.equal(P.percentile(vals, null), null);
  assert.equal(P.percentile([null, null], 5), null);
});

const pool = [];
for (let i = 1; i <= 100; i++) pool.push(u('p' + i, 'ZZ', { saidi: i, saifi: i / 100, storm: i, heat: i, demand_response: i }));

test('offer rule: large loads first, then outages, then wholesale, then default', () => {
  const bad = u('bad', 'ZZ', { saidi: 90.5, saifi: 0.1, wholesale: 1 }, 'PJM');
  const pb = P.signalPercentiles(bad, pool);
  assert.equal(P.pickOffer(bad, pb, { largeLoads: true }).offer.id, 'speed');
  const r = P.pickOffer(bad, pb);
  assert.equal(r.offer.id, 'distribution'); assert.equal(r.rule, 2);

  const pjm = u('pjm', 'ZZ', { saidi: 10.5, saifi: 0.1, wholesale: 0.8 }, 'PJM');
  const rp = P.pickOffer(pjm, P.signalPercentiles(pjm, pool));
  assert.equal(rp.offer.id, 'bulk'); assert.equal(rp.variant, 'accredited'); assert.equal(rp.rule, 3);

  const ercot = u('erc', 'ZZ', { saidi: 10.5, wholesale: 1 }, 'ERCOT');
  const re = P.pickOffer(ercot, P.signalPercentiles(ercot, pool));
  assert.equal(re.offer.id, 'bulk'); assert.equal(re.variant, 'peak');

  const vi = u('vi', 'ZZ', { saidi: 10.5, wholesale: 0 });
  const rv = P.pickOffer(vi, P.signalPercentiles(vi, pool));
  assert.equal(rv.offer.id, 'bulk'); assert.equal(rv.rule, 4);
});

test('offer rule survives null outage and wholesale values', () => {
  const nul = u('nul', 'ZZ', {});
  const pc = P.signalPercentiles(nul, pool);
  assert.equal(pc.saidi.pct, null);
  const r = P.pickOffer(nul, pc);
  assert.equal(r.offer.id, 'bulk'); assert.equal(r.rule, 4);
  assert.equal(P.strongestSignal(pc), null);
  assert.match(P.headline(nul, null), /questions/);
});

test('strongest signal and headline', () => {
  const x = u('x', 'ZZ', { saidi: 20.5, storm: 95.5, heat: 50.5 });
  const s = P.strongestSignal(P.signalPercentiles(x, pool));
  assert.equal(s.id, 'storm'); assert.equal(Math.round(s.pct * 100), 95);
  assert.match(P.headline(x, s), /Storm risk .* higher than 95% of US utilities/);
});

test('state ranking: customers x SAIDI, nulls last, other states excluded', () => {
  const rows = [
    u('a', 'AA', { homes: 1000, saidi: 100 }),
    u('b', 'AA', { homes: 500, saidi: 300 }),
    u('c', 'AA', { homes: 9999999, saidi: null }),
    u('d', 'AA', { homes: 2000, saidi: 10 }),
    u('e', 'BB', { homes: 1e9, saidi: 1e9 })
  ];
  const r = P.rankState(rows, 'AA', 10);
  assert.deepEqual(r.map((x) => x.id), ['b', 'a', 'd', 'c']);
  assert.equal(r[0].score, 150000);
  assert.equal(r[3].score, null);
  assert.equal(P.rankState(rows, 'AA', 2).length, 2);
});

test('landed cost uses Base claimed $/kWh', () => {
  const c = P.landedCost(196, P.CLAIMS_TABLE[0]);
  assert.equal(c.low, 58800000); assert.equal(c.high, 78400000);
  assert.equal(P.landedCost(null, P.CLAIMS_TABLE[0]), null);
});

test('real data: default utility exists and known ids resolve', () => {
  for (const id of Object.keys(P.KNOWN)) assert.ok(data.utilities.some((x) => x.id === id), id);
  const coserv = data.utilities.find((x) => x.id === '5078-TX');
  assert.equal(P.displayName(coserv), 'CoServ Electric (Denton County Elec Coop, Inc)');
  const pc = P.signalPercentiles(coserv, data.utilities);
  const pick = P.pickOffer(coserv, pc);
  assert.equal(pick.offer.id, 'bulk');
  assert.ok(P.questions(coserv, pick).length >= 6);
});

test('no em dashes in pitch files', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const f of ['pitch-core.js', 'pitch.js', 'pitch.html', 'pitch.css']) {
    const p = path.join(__dirname, '..', f);
    if (fs.existsSync(p)) assert.ok(!fs.readFileSync(p, 'utf8').includes(String.fromCharCode(0x2014)), f);
  }
});

test('Base partners: every partner is sourced, dated where announced, and its EIA id names the right utility', () => {
  const expect = {
    '5078-TX': /Denton County/, '1015-TX': /Austin Energy/, '1175-TX': /Bandera/, '6182-TX': /Farmers Electric/,
    '7752-TX': /Guadalupe Valley/, '5701-TX': /El Paso Electric/, '3248-GA': /Central Georgia/
  };
  const partners = Object.keys(P.KNOWN).filter((id) => P.partnerOf(id));
  assert.deepEqual(partners.sort(), Object.keys(expect).sort());
  for (const id of partners) {
    const k = P.KNOWN[id], row = data.utilities.find((x) => x.id === id);
    assert.ok(row, id);
    assert.match(row.name, expect[id], id);
    assert.ok(k.source && /^https:\/\//.test(k.source.url) && k.source.title && k.source.retrieved, id);
    assert.ok(k.note && k.program, id);
    if (k.since) assert.match(k.since, /^20\d\d-\d\d$/, id);
  }
  assert.equal(P.KNOWN['1175-TX'].since, '2025-03');
  assert.equal(P.KNOWN['6182-TX'].since, '2025-12');
  assert.equal(P.KNOWN['7752-TX'].since, '2026-04');
  // ComEd is a retail license, not a utility partner.
  assert.equal(P.partnerOf('4110-IL'), null);
  assert.ok(P.known('4110-IL'));
});

test('partner pitch is framed as expansion, with existing-program questions first', () => {
  const g = data.utilities.find((x) => x.id === '7752-TX');
  const f = P.partnerFrame(g);
  assert.equal(f.label, 'Already a Base partner');
  assert.match(f.framing, /not a cold pitch/);
  assert.match(f.framing, /expanding the existing program/);
  const pick = P.pickOffer(g, P.signalPercentiles(g, data.utilities));
  const q = P.questions(g, pick);
  assert.match(q[0], /^Existing program: .*50 MW residential battery program/);
  assert.match(q[1], /^Expansion:/);
  const cold = data.utilities.find((x) => x.id === '14626-TX');
  assert.equal(P.partnerFrame(cold), null);
  assert.ok(!P.questions(cold, P.pickOffer(cold, P.signalPercentiles(cold, data.utilities))).some((x) => /^Existing program/.test(x)));
});

test('market-first ranking: a dominant ISO ranks first, others follow labeled; split states rank together', () => {
  const rows = [
    u('a', 'AA', { homes: 9000, saidi: 100 }, 'ERCOT'),
    u('b', 'AA', { homes: 1000, saidi: 9000 }, 'MISO'),
    u('c', 'AA', { homes: 500, saidi: 50 }, 'ERCOT, SPP'),
    u('99999-AA', 'AA', { homes: 1e6, saidi: 1e6 }, 'ERCOT')
  ];
  const m = P.stateMarket(rows, 'AA');
  assert.equal(m.market, 'ERCOT');
  assert.ok(m.share > 0.8);
  const r = P.rankState(rows, 'AA', 10);
  assert.deepEqual(r.map((x) => x.id), ['a', 'c', 'b'], 'in-market first; adjustment row left out');
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3]);
  assert.equal(r[0].marketNote, null);
  assert.match(r[1].marketNote, /^Partly outside ERCOT \(also SPP\)/);
  assert.match(r[2].marketNote, /^Outside ERCOT \(MISO\): different market rules/);
  // A split state (no market at 80%) ranks everyone together by score.
  const split = [u('a', 'BB', { homes: 600, saidi: 1 }, 'PJM'), u('b', 'BB', { homes: 400, saidi: 100 }, 'MISO')];
  assert.equal(P.stateMarket(split, 'BB').market, null);
  assert.deepEqual(P.rankState(split, 'BB', 10).map((x) => x.id), ['b', 'a']);
  assert.ok(P.rankState(split, 'BB', 10).every((x) => x.marketNote === null && x.inMarket === null));
  // A state mostly outside any ISO does not prefer "no ISO".
  assert.equal(P.stateMarket([u('a', 'CC', { homes: 900 }), u('b', 'CC', { homes: 100 }, 'SPP')], 'CC').market, null);
});

test('4CP to 12CP citation: Texas Register notice for PUCT Project No. 58000, not 58484', () => {
  assert.match(P.ERCOT_PEAK_VALUE, /Project No\. 58000/);
  assert.match(P.ERCOT_PEAK_VALUE, /Texas Register on 24 July 2026/);
  assert.ok(!/58484/.test(P.ERCOT_PEAK_VALUE), '58484 is the SB 6 study, not the rulemaking');
  assert.match(P.TCOS_SOURCES.proposal.title, /Project No\. 58000/);
  assert.match(P.TCOS_SOURCES.proposal.url, /sos\.texas\.gov\/texreg\/archive\/July242026/);
  assert.match(P.TCOS_SOURCES.project.url, /interchange\.puc\.texas\.gov.*ControlNumber=58000/);
  assert.match(P.TCOS_SOURCES.project.title, /Rulemaking to Update Wholesale and IOU Retail Transmission Cost Recovery in the ERCOT Region/);
  assert.match(P.TCOS_SOURCES.project.title, /58484/);
});
