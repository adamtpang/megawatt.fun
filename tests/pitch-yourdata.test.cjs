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
  const r = P.loadYourData(csv('utility,status,owner,note\n5078-TX,signed,Ana,"Pilot, 50 MW"\n"A & N Electric Coop, VA",not contacted,,\nAustin Energy,in talks,,\nNot A Real Utility Co,in talks,,'), data.utilities);
  assert.deepEqual(r.errors, [], 'unmatched names never fail the file');
  assert.equal(r.targetCount, 3);
  assert.equal(r.targets['5078-TX'].status, 'signed');
  assert.equal(r.targets['84-VA'].status, 'not contacted');
  assert.ok(r.targets['1015-TX']);
  assert.equal(r.unmatched, 1);
  assert.ok(r.warnings.some((w) => /^Row 5: no utility called "Not A Real Utility Co"/.test(w)));
  // One utility on two rows, by id and by alias, is a row error, never "the later row wins".
  const twice = P.loadYourData(csv('utility,status\n5078-TX,signed\nCoServ Electric,in talks'), data.utilities);
  assert.equal(twice.errors.length, 1);
  assert.match(twice.errors[0], /^Row 3: .* is already listed \(5078-TX\)\. Keep one row per utility\.$/);

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
  // Austin Energy and CoServ are both existing Base partners: listed first as targets, but never given a cold rank.
  assert.ok(ordered.slice(0, 2).every((x) => x.partner && x.rank === null), 'partner targets stay unranked');
  const rest = ordered.slice(2).map((x) => x.rank);
  assert.deepEqual(rest.filter((x) => x !== null), rest.filter((x) => x !== null).sort((a, b) => a - b), 'non-targets keep public rank order');
  assert.ok(rest.slice(rest.findIndex((x) => x === null)).every((x) => x === null), 'wires-only rows come last, unranked');
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

// ---------- Wires-only utilities and user-keyed lookups ----------

const byId = (id) => data.utilities.find((u) => u.id === id);
const pickFor = (u, opts) => P.pickOffer(u, P.signalPercentiles(u, data.utilities), opts);

test('wires-only detection: Texas TDSPs, PECO, PPL; co-ops and city utilities stay pitchable', () => {
  const wires = {
    '44372-TX': 'eia-retail-share', // Oncor
    '8901-TX': 'eia-retail-share', // CenterPoint
    '3278-TX': 'eia-retail-share', // AEP Texas Central
    '20404-TX': 'eia-retail-share', // AEP Texas North
    '40051-TX': 'eia-retail-share', // TNMP
    '14940-PA': 'state-default-supply', // PECO
    '14715-PA': 'state-default-supply', // PPL
  };
  for (const id of Object.keys(wires)) {
    const u = byId(id);
    assert.ok(u, id);
    const w = P.wiresOnly(u);
    assert.ok(w, id + ' is wires-only');
    assert.equal(w.basis, wires[id], id);
    assert.match(w.what, /delivers power but does not/);
    const pick = pickFor(u);
    assert.equal(pick.rule, 0, id);
    assert.notEqual(pick.offer.id, 'bulk', id + ' gets no capacity offer');
    assert.match(pick.reason, /not a capacity purchase/);
    assert.equal(pickFor(u, { largeLoads: true }).offer.id, 'speed');
    assert.ok(!P.questions(u, pick).some((q) => /Accreditation|resource adequacy|Dispatch windows|Enrollment/.test(q)), id + ' questions skip capacity');
  }
  // Texas: PURA chapter 39 and Base's agents.md are cited; Base sells there as a retail provider.
  const cnp = P.wiresOnly(byId('8901-TX'));
  assert.deepEqual(cnp.sources, ['eia', 'pura']);
  assert.match(cnp.reason, /PURA chapter 39/);
  assert.match(cnp.baseRetail, /retail electric provider.*CenterPoint area.*10338/);
  assert.deepEqual(P.extraSources(byId('8901-TX'), pickFor(byId('8901-TX'))).map((s) => s.key), ['pura', 'agents']);
  // Illinois: ComEd and Ameren Illinois have a VPP tariff route in law (220 ILCS 5/16-107.9), so they are not wires-only.
  assert.equal(P.wiresOnly(byId('4110-IL')), null);
  assert.equal(P.wiresOnly(byId('56697-IL')), null);
  assert.match(P.wiresOnly(byId('14940-PA')).reason, /Pennsylvania PUC/);
  assert.match(P.wiresOnly(byId('14940-PA')).reason, /House Bill 2264/);
  assert.deepEqual(P.wiresOnly(byId('14940-PA')).sources, ['eia', 'pa', 'pahb2264']);
  assert.equal(P.wiresOnly(byId('14715-PA')).baseRetail, null, 'Base does not sell in Pennsylvania');

  for (const id of ['5078-TX', '1015-TX', '7752-TX', '14626-TX', '3248-GA']) { // CoServ, Austin Energy, GVEC, Pedernales, Central Georgia EMC
    const u = byId(id);
    assert.equal(P.wiresOnly(u), null, id + ' stays pitchable');
    assert.notEqual(pickFor(u).rule, 0, id);
  }
  // Every wires-only row in the file, so a data change that adds or drops one is seen here.
  assert.deepEqual(data.utilities.filter(P.wiresOnly).map((u) => u.id).sort(),
    ['11292-TX', '14715-PA', '14940-PA', '19390-PA', '20404-TX', '3278-TX', '40051-TX', '44372-TX', '5487-PA', '66101-PA', '8901-TX'].sort());
});

test('Illinois VPP tariff: ComEd and Ameren Illinois are pitchable, with the statute cited', () => {
  for (const id of ['4110-IL', '56697-IL']) {
    const u = byId(id);
    const pick = pickFor(u);
    assert.equal(pick.rule, 0, id);
    assert.equal(pick.variant, 'vpp', id);
    assert.equal(pick.offer.id, 'bulk', id);
    assert.ok(!pick.wires, id);
    assert.match(pick.reason, /16-107\.9/);
    assert.match(pick.reason, /31 December 2027/);
    assert.match(pick.reason, /capacity and transmission obligations/);
    assert.equal(pickFor(u, { largeLoads: true }).offer.id, 'speed');
    assert.deepEqual(P.extraSources(u, pick).map((s) => s.key), ['pa104458', 'sb25', 'ipaplan']);
    assert.ok(P.extraSources(u, pick).every((s) => /^https:\/\/(www\.)?(ilga\.gov|ipa\.illinois\.gov)\//.test(s.url)));
    const q = P.questions(u, pick);
    assert.ok(q.some((x) => /^Tariff timeline:/.test(x)), id);
    assert.ok(!q.some((x) => /^Accreditation:/.test(x)), id);
  }
  // ComEd's capacity is bought in PJM's auction, not by the IPA.
  assert.match(pickFor(byId('4110-IL')).reason, /capacity itself in PJM/);
  const il = P.rankState(data.utilities, 'IL', 10);
  assert.ok(il.some((x) => x.id === '4110-IL' && x.rank !== null && !x.wires));
  assert.ok(il.some((x) => x.id === '56697-IL' && x.rank !== null && !x.wires));
  // Pennsylvania has no such law yet, so PECO and PPL stay wires-only.
  assert.equal(P.ilVpp(byId('14940-PA')), null);
});

test('illustrative accredited MW: derated for the home reserve, NYISO 2-hour factor, labeled', () => {
  const prog = P.sizeProgram(100, 1e6);
  const a = P.accreditedExample(prog, P.publicTerms());
  assert.equal(a.pct, 64.65);
  assert.equal(a.reservePct, 20);
  assert.equal(a.reserveYours, false);
  assert.ok(Math.abs(a.kwFor2h - 39.2 * 0.8 / 2) < 1e-9);
  assert.ok(Math.abs(a.accreditedMw - 5000 * 15.68 / 1000 * 0.6465) < 1e-9);
  assert.match(a.text, /^Illustration, not this utility's rule/);
  assert.match(a.text, /PJM has no 2-hour class/);
  assert.match(a.source.url, /^https:\/\/www\.nyiso\.com\//);
  // Your reserve replaces the assumed 20%. With none, 39.2 kWh holds 19.6 kW for 2 hours, just under the 20 kW nameplate.
  const mine = P.accreditedExample(prog, Object.assign(P.publicTerms(), { memberReservePct: 0 }));
  assert.equal(mine.reserveYours, true);
  assert.ok(Math.abs(mine.kwFor2h - 19.6) < 1e-9);
  assert.equal(P.accreditedExample(null, P.publicTerms()), null);
});

test('partner count note reconciles 7 sourced partners with Base\'s "6 utility partners"', () => {
  assert.match(P.PARTNER_COUNT_NOTE, /3 metro areas, 6 utility partners/);
  assert.match(P.PARTNER_COUNT_NOTE, /Central Georgia EMC/);
  assert.match(P.PARTNER_COUNT_NOTE, /not confirmed/);
  assert.equal(Object.keys(P.KNOWN).filter((id) => P.partnerOf(id)).length, 7);
});

test('wires-only fallback list holds when the EIA retail share is missing', () => {
  for (const id of Object.keys(P.KNOWN_TDSP)) {
    const u = byId(id);
    const blanked = Object.assign({}, u, { values: Object.assign({}, u.values, { retail: null }) });
    const w = P.wiresOnly(blanked);
    assert.ok(w, id);
    assert.equal(w.basis, 'named-tdsp');
  }
  // A Pennsylvania co-op with no retail-choice homes is not caught by the state rule.
  assert.equal(P.wiresOnly({ id: 'x-PA', name: 'Some Coop', state: 'PA', values: { retail: 0 }, detail: { rtos: 'PJM' } }), null);
});

test('ERCOT co-ops and city utilities: the offer and questions name 4CP transmission and wholesale cost, with sources', () => {
  for (const id of ['5078-TX', '1015-TX', '7752-TX', '14626-TX']) {
    const u = byId(id);
    const pick = pickFor(u);
    if (pick.rule === 3) {
      assert.equal(pick.offer.id, 'bulk');
      assert.equal(pick.variant, 'peak');
      assert.match(pick.reason, /4CP/);
      assert.match(pick.reason, /wholesale energy/);
    }
    assert.ok(P.questions(u, pick).some((q) => /4CP transmission allocation/.test(q) && /wholesale energy/.test(q)), id);
    assert.deepEqual(P.extraSources(u, pick).map((s) => s.key), ['tcos', 'tcos12', 'tcos58000'], id);
  }
  assert.match(P.TCOS_SOURCES.rule.url, /puc\.texas\.gov/);
  // No made-up value: the ERCOT text carries no dollar figure.
  assert.ok(!/\$/.test(P.ERCOT_PEAK_VALUE));
});

test('who to call first: wires-only utilities are labeled and not ranked', () => {
  const tx = P.rankState(data.utilities, 'TX', Infinity);
  const wiresRows = tx.filter((x) => x.wires);
  assert.deepEqual(wiresRows.map((x) => x.id).sort(), ['11292-TX', '20404-TX', '3278-TX', '40051-TX', '44372-TX', '8901-TX'].sort());
  assert.ok(wiresRows.every((x) => x.rank === null));
  const ranked = tx.filter((x) => !x.wires && !x.partner);
  assert.deepEqual(ranked.map((x) => x.rank), ranked.map((_, i) => i + 1));
  assert.ok(P.rankState(data.utilities, 'TX', 10).every((x) => !x.wires), 'top 10 is pitchable utilities only');
  assert.ok(P.rankState(data.utilities, 'IL', 10).some((x) => x.id === '4110-IL' && x.rank !== null));
});

test('user text never resolves built-in object properties', () => {
  const idx = P.utilityIndex(data.utilities);
  for (const t of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf, TX', 'prototype']) {
    const m = P.matchUtility(idx, t);
    assert.equal(m.u, undefined, t);
    assert.equal(m.ambiguous, undefined, t);
  }
  // terms keys: unknown, never "appears twice".
  const j = P.loadYourData(Y.parseText('{"constructor": 1, "__proto__": 2, "toString": 3}', 'x.json'), data.utilities);
  assert.deepEqual(j.errors.map((e) => /unknown key "(.*?)"/.exec(e)[1]).sort(), ['__proto__', 'constructor', 'toString']);
  assert.ok(!j.warnings.some((w) => /appears twice/.test(w)), j.warnings.join(' | '));
  const c = P.loadYourData(csv('key,value\nconstructor,1\n__proto__,2'), data.utilities);
  assert.ok(c.errors.some((e) => /^Row 2: unknown key "constructor"/.test(e)), c.errors.join(' | '));
  assert.ok(c.errors.some((e) => /^Row 3: unknown key "__proto__"/.test(e)), c.errors.join(' | '));
  assert.equal(Object.getPrototypeOf(P.publicTerms()), Object.prototype, 'public terms object is untouched');
  // A target called "constructor" is unmatched, not a crash.
  const t = P.loadYourData(csv('utility,status\nconstructor,in talks'), data.utilities);
  assert.equal(t.targetCount, 0);
  assert.equal(t.unmatched, 1);
});

test('target with a state that disagrees with its id is skipped with a warning', () => {
  const r = P.loadYourData(csv('utility,state,status\n5078-TX,IL,in talks'), data.utilities);
  assert.deepEqual(r.errors, []);
  assert.equal(r.targetCount, 0);
  assert.match(r.warnings[0], /^Row 2: "5078-TX" is CoServ Electric .* in TX, not IL/);
  assert.ok(P.matchUtility(P.utilityIndex(data.utilities), '5078-TX', 'tx').u, 'same state in lower case still matches');
});

test('numeric terms: bounds on every key, plain decimals only, nothing reaches Infinity', () => {
  for (const t of P.TERMS) {
    assert.ok(Number.isFinite(t.min) && Number.isFinite(t.max), t.key + ' has bounds');
    const big = P.loadYourData(json({ [t.key]: 1e308 }), data.utilities);
    assert.ok(big.errors.some((e) => e.startsWith(t.key + ' must be between')), t.key);
    const low = P.loadYourData(json({ [t.key]: t.min - 1 }), data.utilities);
    assert.ok(low.errors.some((e) => e.startsWith(t.key + ' must be between')), t.key + ' below min');
  }
  for (const bad of ['0x10', '1e999', 'Infinity', 'NaN', '1.2.3']) {
    const r = P.loadYourData(csv('key,value\nprogramMw,' + bad), data.utilities);
    assert.ok(r.errors.some((e) => /programMw is not a number/.test(e)), bad + ': ' + r.errors.join(' | '));
  }
  assert.ok(P.loadYourData(json({ programMw: [50] }), data.utilities).errors.some((e) => /not a number/.test(e)), 'a list is not a number');
  assert.ok(P.loadYourData(json({ programMw: true }), data.utilities).errors.some((e) => /not a number/.test(e)), 'a boolean is not a number');
  assert.deepEqual(P.loadYourData(csv('key,value\nprogramMw,"1,000"\ntollPerKwYear,$85'), data.utilities).errors, []);
  // sizeProgram refuses out-of-range input rather than returning Infinity.
  assert.equal(P.sizeProgram(1e308, 1000), null);
  assert.equal(P.sizeProgram(Infinity, 1000), null);
  assert.equal(P.sizeProgram(5001, 1000), null);
  assert.equal(P.sizeProgram(100, 1000, { kwPerHome: 1e-300, kwhPerHome: 39.2 }), null);
  const max = P.sizeProgram(5000, 1, { kwPerHome: 1, kwhPerHome: 500, memberReservePct: 99 });
  for (const v of Object.values(max)) assert.ok(v === null || typeof v === 'boolean' || Number.isFinite(v), JSON.stringify(max));
  assert.equal(P.sizeProgram(100, 1000, { kwPerHome: 20, kwhPerHome: 39.2, memberReservePct: 1e308 }).dispatchMwh, undefined);
});

test('Texas who to call first: ERCOT utilities first, non-ERCOT labeled, partners never ranked cold', () => {
  const tx = P.rankState(data.utilities, 'TX', Infinity);
  const m = P.stateMarket(data.utilities, 'TX');
  assert.equal(m.market, 'ERCOT');
  assert.match(m.reason, /ERCOT/);
  const ranked = tx.filter((x) => x.rank !== null);
  const firstOut = ranked.findIndex((x) => x.inMarket === false);
  assert.ok(firstOut > 10, 'the whole top 10 is ERCOT');
  assert.ok(ranked.slice(0, firstOut).every((x) => x.inMarket === true));
  assert.ok(ranked.slice(firstOut).every((x) => x.inMarket === false && /^Outside ERCOT/.test(x.marketNote)));
  const top5 = P.rankState(data.utilities, 'TX', 5);
  assert.deepEqual(top5.map((x) => x.id), ['16604-TX', '14626-TX', '11501-TX', '19159-TX', '7559-TX']);
  for (const id of ['55937-TX', '17718-TX']) {
    const row = tx.find((x) => x.id === id);
    assert.ok(row.rank > firstOut, id + ' ranks after every ERCOT utility');
    assert.match(row.marketNote, /^Outside ERCOT \((MISO|SPP)\): different market rules/);
  }
  // Partners: unranked, after the cold list, before wires-only, and out of the starter target list.
  const partners = tx.filter((x) => x.partner);
  assert.deepEqual(partners.map((x) => x.id).sort(), ['1015-TX', '1175-TX', '5078-TX', '5701-TX', '6182-TX', '7752-TX'].sort());
  assert.ok(partners.every((x) => x.rank === null && !x.wires));
  const lastRanked = tx.map((x) => x.rank !== null).lastIndexOf(true);
  const firstWires = tx.findIndex((x) => x.wires);
  assert.ok(tx.every((x, i) => !x.partner || (i > lastRanked && i < firstWires)));
  assert.match(tx.find((x) => x.id === '5701-TX').marketNote, /^Outside ERCOT \(not in an ISO\)/);
  assert.ok(!tx.some((x) => x.id === '99999-TX'), 'EIA adjustment row is not a utility to call');
  // Georgia: Central Georgia EMC is a partner, not a cold prospect.
  assert.ok(P.rankState(data.utilities, 'GA', Infinity).some((x) => x.id === '3248-GA' && x.partner && x.rank === null));
});

test('a partner on your target list stays a partner: first as a target, still unranked', () => {
  const r = P.loadYourData(csv('utility,status\n7752-TX,expand'), data.utilities);
  const ordered = P.orderWithTargets(P.rankState(data.utilities, 'TX', Infinity), r.targets);
  assert.equal(ordered[0].id, '7752-TX');
  assert.equal(ordered[0].partner, true);
  assert.equal(ordered[0].rank, null);
});
