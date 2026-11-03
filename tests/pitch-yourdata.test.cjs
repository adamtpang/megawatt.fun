const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('../yourdata.js');
const P = require('../pitch-core.js');
const data = require('../data/expansion-map.json');

const csv = (text) => Y.parseText(text, 'x.csv');
const json = (obj) => Y.parseText(JSON.stringify(obj), 'x.json');

test('offer terms: valid CSV and JSON change the pitch numbers', () => {
  const r = P.loadYourData(csv('key,value\nkwPerHome,25\nkwhPerHome,50\ncostLowPerKwh,$280\ncostHighPerKwh,350\ntollPerKwYear,85\ntermYears,10\nmemberReservePct,20%\nreliabilityCutoffPct,60'), data.utilities);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.changed.sort(), ['costHighPerKwh', 'costLowPerKwh', 'kwPerHome', 'kwhPerHome', 'memberReservePct', 'reliabilityCutoffPct', 'termYears', 'tollPerKwYear']);
  assert.equal(r.targetCount, 0);
  const p = P.sizeProgram(100, 500000, r.terms);
  assert.equal(p.batteries, 4000);
  assert.equal(p.mwh, 200);
  assert.ok(Math.abs(p.dispatchMwh - 160) < 1e-9);
  const t = P.tollValue(r.terms, 100);
  assert.equal(t.perYear, 8500000); assert.equal(t.total, 85000000);
  // Cutoff from the file moves the offer rule: a 65th-percentile outage utility now gets distribution support.
  const pool = [];
  for (let i = 1; i <= 100; i++) pool.push({ id: 'p' + i, values: { saidi: i, saifi: null, storm: null, heat: null, demand_response: null, batteries: null, dynamic_pricing: null } });
  const x = { id: 'x', values: Object.assign({}, pool[0].values, { saidi: 65.5, wholesale: 0 }), detail: { rtos: 'No ISO balancing authority' } };
  const pc = P.signalPercentiles(x, pool);
  assert.equal(P.pickOffer(x, pc).rule, 4);
  assert.equal(P.pickOffer(x, pc, { terms: r.terms }).rule, 2);
  assert.match(P.questions(x, P.pickOffer(x, pc, { terms: r.terms }), r.terms).join(' '), /hold back 20% of each 50 kWh battery/);

  const j = P.loadYourData(json({ programMw: 250, cyclesPerYear: 365 }), data.utilities);
  assert.deepEqual(j.errors, []);
  assert.deepEqual(j.changed, ['programMw', 'cyclesPerYear']);
});

test('target list: matches by id, name, Name, ST and alias; targets go first in public order', () => {
  const r = P.loadYourData(csv('utility,status,owner,note\n5078-TX,signed,Ana,"Pilot, 50 MW"\nCoServ Electric,in talks,Ben,\n"A & N Electric Coop, VA",not contacted,,\nAustin Energy,in talks,,\nNot A Real Utility Co,in talks,,'), data.utilities);
  assert.deepEqual(r.errors, [], 'unmatched names never fail the file');
  assert.equal(r.targetCount, 3);
  assert.equal(r.targets['5078-TX'].status, 'in talks', 'later row wins');
  assert.equal(r.targets['84-VA'].status, 'not contacted');
  assert.ok(r.targets['1015-TX']);
  assert.equal(r.unmatched, 1);
  assert.ok(r.warnings.some((w) => /^Row 3: .*listed twice/.test(w)));
  assert.ok(r.warnings.some((w) => /^Row 6: no utility called "Not A Real Utility Co"/.test(w)));

  const typo = P.loadYourData(csv('utility,status\nAustin Enrgy,in talks'), data.utilities);
  assert.deepEqual(typo.errors, []);
  assert.match(typo.warnings[0], /Did you mean Austin Energy, TX \(id 1015-TX\)\?/);

  const dupName = data.utilities.find((u) => data.utilities.filter((v) => v.name === u.name).length > 1);
  const amb = P.loadYourData(csv('utility,status\n"' + dupName.name + '",in talks'), data.utilities);
  assert.match(amb.warnings[0], /matches \d utilities/);
  const pinned = P.loadYourData(csv('utility,state,status\n"' + dupName.name + '",' + dupName.state + ',in talks'), data.utilities);
  assert.ok(pinned.targets[dupName.id]);

  const all = P.rankState(data.utilities, 'TX', Infinity);
  const ordered = P.orderWithTargets(all, r.targets);
  const ids = ordered.slice(0, 2).map((x) => x.id);
  assert.deepEqual(ids.slice().sort(), ['1015-TX', '5078-TX']);
  assert.ok(ordered[0].rank < ordered[1].rank, 'targets keep public rank order');
  const rest = ordered.slice(2).map((x) => x.rank);
  assert.deepEqual(rest, rest.slice().sort((a, b) => a - b), 'non-targets keep public rank order');
  assert.equal(ordered.length, all.length);
});

test('one file can hold both parts (CSV and JSON)', () => {
  const r = P.loadYourData(csv('key,value,utility,status,owner,note\nkwPerHome,25,,,,\n,,5078-TX,signed,Ana,'), data.utilities);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.changed, ['kwPerHome']);
  assert.equal(r.targetCount, 1);
  const j = P.loadYourData(json({ terms: { tollPerKwYear: 90 }, targets: [{ utility: '1015-TX', status: 'in talks' }] }), data.utilities);
  assert.deepEqual(j.errors, []);
  assert.deepEqual(j.changed, ['tollPerKwYear']);
  assert.equal(j.targets['1015-TX'].status, 'in talks');
});

test('each error type is named by row', () => {
  const bad = P.loadYourData(csv('key,value,utility,status\nnope,1,,\nkwPerHome,abc,,\nkwhPerHome,9000,,\ncyclesPerYear,0,,\nkwPerHome,20,5078-TX,signed\n,,,stray'), data.utilities);
  assert.equal(bad.errors.length, 6);
  assert.match(bad.errors[0], /^Row 2: unknown key "nope"/);
  assert.match(bad.errors[1], /^Row 3: kwPerHome is not a number: "abc"/);
  assert.match(bad.errors[2], /^Row 4: kwhPerHome must be between 1 and 500 kWh\. Got 9000/);
  assert.match(bad.errors[3], /^Row 5: cyclesPerYear must be between 1 and 1000/);
  assert.match(bad.errors[4], /^Row 6: has both a key and a utility/);
  assert.match(bad.errors[5], /^Row 7: has no key and no utility/);
  const cross = P.loadYourData(csv('key,value\ncostLowPerKwh,500\ncostHighPerKwh,400'), data.utilities);
  assert.match(cross.errors[0], /costLowPerKwh \(500\) is above costHighPerKwh \(400\)/);
  const longStatus = P.loadYourData(csv('utility,status\n5078-TX,' + 'x'.repeat(61)), data.utilities);
  assert.match(longStatus.errors[0], /^Row 2: status is longer than 60/);
  assert.equal(P.loadYourData({ kind: 'csv', data: [] }, data.utilities).errors.length, 1);
  assert.match(P.loadYourData(json({ wat: 'x' }), data.utilities).errors[0], /unknown key "wat"/);
  assert.match(P.loadYourData(json([{ key: 'kwPerHome', value: 'x' }]), data.utilities).errors[0], /^Item 1: kwPerHome is not a number/);
  assert.match(P.loadYourData(json({ targets: 'CoServ' }), data.utilities).errors[0], /targets must be a list/);
});

test('template loads back with zero errors and zero changes; public data untouched', () => {
  const beforeData = JSON.stringify(data);
  const beforeSpec = JSON.stringify([P.SPEC, P.CLAIMS_TABLE, P.RELIABILITY_CUTOFF, P.WHOLESALE_CUTOFF, P.TERMS]);
  const text = Y.toCSV(P.templateRows(), P.TEMPLATE_COLUMNS);
  const round = P.loadYourData(Y.parseText(text, 'pitch-offer-terms.csv'), data.utilities);
  assert.deepEqual(round.errors, []);
  assert.deepEqual(round.changed, []);
  assert.equal(round.targetCount, 0);
  assert.deepEqual(round.terms, P.publicTerms());
  assert.equal(P.templateRows().length, P.TERMS.length);
  // Public values in the template are the numbers the public pitch uses.
  assert.equal(P.publicTerms().kwPerHome, 20);
  assert.equal(P.publicTerms().kwhPerHome, 39.2);
  assert.equal(P.publicTerms().costLowPerKwh, 300);
  assert.equal(P.publicTerms().reliabilityCutoffPct, 75);
  // Loading files never mutates public data or the public constants.
  P.loadYourData(csv('key,value\nkwPerHome,25\ncostLowPerKwh,100\nreliabilityCutoffPct,10'), data.utilities);
  P.loadYourData(csv('utility,status\n5078-TX,signed'), data.utilities);
  assert.equal(JSON.stringify(data), beforeData);
  assert.equal(JSON.stringify([P.SPEC, P.CLAIMS_TABLE, P.RELIABILITY_CUTOFF, P.WHOLESALE_CUTOFF, P.TERMS]), beforeSpec);
  assert.equal(P.sizeProgram(100, 500000).batteries, 5000, 'no terms still means Base public spec');
});

test('no em dashes in the new files', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const f of ['docs/plug-and-play/pitch.md', 'tests/pitch-yourdata.test.cjs']) {
    const p = path.join(__dirname, '..', f);
    if (fs.existsSync(p)) assert.ok(!fs.readFileSync(p, 'utf8').includes(String.fromCharCode(0x2014)), f);
  }
});
