// Pass-3 review fixes (2026-11-04) for supply, market, pitch, launch, the ZIP box, the BOM checker and
// yourdata.js, checked on the cores and pages. The API cases are in tests/api.test.cjs, in the block
// headed "pass 3 review". Item numbers are the review's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const YD = require('../yourdata.js');
const S = require('../supply-core.js');
const MC = require('../market-core.js');
const P = require('../pitch-core.js');
const LC = require('../launch-core.js');
const B = require('../bom-check-core.js');
const Z = require('../zip-launch-core.js');
const MAP = require('../data/expansion-map.json');
const MARKET = require('../data/market-states.json');
const STEPS = require('../data/launch-steps.json');

const csv = (t) => ({ kind: 'csv', data: YD.parseCSV(t) });

// ---------- 1. one comma rule everywhere ----------

test('1 the comma rule: a comma is only a thousands separator, on every tool', () => {
  assert.equal(YD.num('1,200'), 1200);
  assert.equal(YD.num('-1,200.5'), -1200.5);
  assert.equal(YD.num('$1,200'), 1200);
  for (const bad of ['3,5', '$2,80%', '1,2345', '12,34', ',5', '1,,000']) {
    assert.ok(Number.isNaN(YD.num(bad)), bad);
    assert.equal(YD.readNumber(bad).comma, true, bad);
  }
  assert.match(YD.commaHint('3,5'), /Use a dot for decimals/);
  assert.equal(YD.commaHint('3.5'), '');

  const sup = S.validate(csv('part,category,lead_time_weeks,unit_cost_usd\nA,cells,"3,5",1\nB,cells,4,"1,200"\n'));
  assert.equal(sup.errors.length, 1);
  assert.match(sup.errors[0], /^Row 2: lead_time_weeks is not a number: "3,5"\. A comma is only a thousands separator/);

  const st = MC.loadStates(csv('state,cost\nTX,"3,5"\nFL,1\nGA,2\nAZ,3\nNC,4\n'));
  assert.match(st.errors[0], /Row 2, column "cost": "3,5" is not a number\. A comma is only a thousands separator/);
  const zn = MC.loadZones(csv('zone,usd_per_year\nLZ_WEST,"2,80"\n'), ['LZ_WEST']);
  assert.match(zn.errors[0], /"2,80" is not a number\. A comma/);
  assert.equal(MC.loadZones(csv('zone,usd_per_year\nLZ_WEST,"1,200"\n'), ['LZ_WEST']).zones.LZ_WEST, 1200);

  const pj = P.loadYourData({ kind: 'json', data: { tollPerKwYear: '3,5' } }, MAP.utilities);
  assert.match(pj.errors[0], /^tollPerKwYear is not a number: "3,5"\. A comma/);
  const pc = P.loadYourData(csv('key,value\ntollPerKwYear,"$2,80%"\n'), MAP.utilities);
  assert.match(pc.errors[0], /^Row 2: tollPerKwYear is not a number/);
  assert.deepEqual(P.loadYourData(csv('key,value\ncostLowPerKwh,"1,000"\ncostHighPerKwh,"1,200"\n'), MAP.utilities).errors, []);

  const bom = B.check('part_number,description,qty,supplier,lead_time_days\nA,b,"3,5",s,"1,200"\n');
  assert.match(bom.errors[0], /qty is not a plain decimal number: "3,5"\. A comma/);
  assert.equal(B.check('part_number,description,qty,supplier,lead_time_days\nA,b,3,s,"1,200"\n').rows[0].lead_time_days, 1200);

  const lc = LC.applyOverrides(STEPS, csv('path,id,name,owner,low,high\nretail,a,A,o,"1,5",2\n'));
  assert.match(lc.errors[0], /low for a is not a number: "1,5"\. A comma/);
});

// ---------- 5 and 13. not UTF-8, UTF-16, binary ----------

test('5 decodeBytes: cp1252 is "not UTF-8" with the CSV UTF-8 fix, UTF-16 with a mark is read, binary is binary', () => {
  const latin = YD.decodeBytes(Buffer.from('part,category\nCaf\xe9,cells\n', 'latin1'));
  assert.match(latin.error, /not UTF-8/);
  assert.match(latin.error, /CSV UTF-8 \(Comma delimited\)/);
  assert.doesNotMatch(latin.error, /binary/);
  const le = YD.decodeBytes(Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('key,value\nCafé,7\n', 'utf16le')]));
  assert.equal(le.text, 'key,value\nCafé,7\n');
  assert.match(YD.decodeBytes(Buffer.from('key,value\n', 'utf16le')).error, /UTF-16 text without a byte order mark/);
  assert.equal(YD.decodeBytes(Buffer.from('﻿a,b\n1,2', 'utf8')).text, 'a,b\n1,2');
  assert.match(YD.decodeBytes(Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0, 0, 0])).error, /not text\. It looks like a binary file/);
  // Text already decoded by a browser or server: replacement characters alone mean another encoding.
  assert.match(YD.textProblem('Caf�,1\n'), /not UTF-8/);
  assert.match(YD.textProblem('PK\u0003\u0004\u0014\u0000\u0000'), /binary/);
  assert.equal(YD.textProblem('plain, text\n'), '');
  assert.throws(() => YD.parseText('Caf�,1\n', 'x.csv'), /not UTF-8/);
});

test('13 BOM checker: a zip renamed .csv is a binary file, not "no data rows"; cp1252 says save as CSV UTF-8', () => {
  const zip = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0, 0, 0, 0x61, 0x2E, 0x78, 0x6D, 0x6C]).toString('utf8');
  const r = B.check(zip);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /binary file/);
  assert.match(B.check('part_number,description,qty,supplier\nA,Caf�,1,s\n').errors[0], /not UTF-8/);
  const page = fs.readFileSync(path.join(ROOT, 'bom-check.js'), 'utf8');
  assert.match(page, /readAsArrayBuffer/);
  assert.match(page, /decodeBytes/);
  assert.match(fs.readFileSync(path.join(ROOT, 'yourdata.js'), 'utf8'), /f\.arrayBuffer\(\)/);
});

// ---------- 6. fullwidth text ----------

test('6 fullwidth digits and letters read the same in the ZIP box, the pitch box and the API', () => {
  assert.equal(Z.normalizeZip('７８７０４'), '78704');
  assert.equal(Z.lookup(require('../data/zip-launch.json'), '７８７０４').inputs_used.zip, '78704');
  const idx = P.utilityIndex(MAP.utilities);
  assert.equal(P.matchUtility(idx, 'ＣｏＳｅｒｖ').u.id, '5078-TX');
  assert.equal(P.matchUtility(idx, '５０７８-TX').u.id, '5078-TX');
});

// ---------- 7 and 14. launch ids, paths, duplicate columns ----------

test('7 launch: ids match in any case, a and A are a duplicate, path takes any case', () => {
  const dup = LC.applyOverrides(STEPS, csv('path,id,name,owner,low,high,depends_on\nretail,a,A,o,1,2,\nretail,A,A2,o,1,2,a\n'));
  assert.deepEqual(dup.errors, ['Row 3: duplicate id "A" in retail (also Row 2, as "a"; ids match in any case).']);
  const ok = LC.applyOverrides(STEPS, csv('path,id,name,owner,low,high,depends_on\nRETAIL,a,A,o,1,2,\nRetail,b,B,o,1,2,A\nretail,First_Installs,F,o,1,1,B\n'));
  assert.deepEqual(ok.errors, []);
  const steps = ok.data.paths.retail.steps;
  assert.deepEqual(steps.map((s) => s.depends_on), [[], ['a'], ['b']]);
  assert.equal(steps[2].id, 'first_installs', 'the first-install step keeps the spelling the page reads');
  const json = LC.applyOverrides(STEPS, { kind: 'json', data: { paths: { RETAIL: { steps: [{ id: 'x', name: 'X', low: 1, high: 2 }] } }, tennis: [{ step: 'X', round_weeks: 2 }] } });
  assert.deepEqual(json.errors, []);
  assert.deepEqual(json.paths, ['retail']);
});

test('14 a column written twice and in another case is reported once, on every tool', () => {
  const one = (errs) => assert.equal(errs.filter((e) => /^Columns? "/.test(e)).length, 1, errs.join(' | '));
  one(LC.applyOverrides(STEPS, csv('path,id,name,owner,low,high,high,High\nretail,a,A,o,1,2,3,4\n')).errors);
  one(S.validate(csv('part,category,lead_time_weeks,lead_time_weeks,Lead_Time_Weeks\nA,cells,1,2,3\n')).errors);
  one(P.loadYourData(csv('key,value,value,Value\ntermYears,10,12,3\n'), MAP.utilities).errors);
  one(MC.load(csv('zone,usd_per_year,usd_per_year,USD_per_year\nLZ_WEST,1,2,3\n'), ['LZ_WEST']).errors);
  one(B.check('part_number,description,qty,supplier,qty,QTY\nA,b,1,s,2,3\n').errors);
});

// ---------- 14. launch hash routing ----------

async function launchPage(startHash) {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', hidden: false, value: '', dataset: {}, setAttribute() {}, removeAttribute() {}, addEventListener() {}, querySelectorAll: () => [] });
    return els.get(id);
  };
  const listeners = {};
  const location = { hash: startHash };
  const history = { replaceState(_s, _t, url) { location.hash = url; } };
  const window = { addEventListener: (k, f) => { listeners[k] = f; } };
  // Only real element ids (lower case and hyphens) exist; "__proto__" or a decoded junk hash does not.
  const document = { readyState: 'complete', getElementById: (id) => (/^[a-z][a-z-]*$/.test(id) ? el(id) : null), addEventListener() {} };
  const json = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
  const fetch = async (url) => ({ ok: true, json: async () => json(url.replace('/data/', '')) });
  const ctx = vm.createContext({ window, document, location, history, fetch, console, Map, Set, Promise, JSON, Math, Object, String, Number, Array, Error, decodeURIComponent });
  window.LaunchCore = LC;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'launch.js'), 'utf8'), ctx);
  for (let i = 0; i < 20 && !listeners.hashchange; i++) await new Promise((r) => setImmediate(r));
  return { el, location, fire: (h) => { location.hash = h; listeners.hashchange(); } };
}

test('14 launch hash: extra segments still open the state; junk is rewritten to what the page shows', async () => {
  const pg = await launchPage('#CA/retail/extra');
  assert.equal(pg.el('state').value, 'CA');
  assert.equal(pg.location.hash, '#CA/retail');
  for (const junk of ['#__proto__', '#%E2%80%AE', '#ZZ', '#TX/', '#tx/RETAIL/x']) {
    pg.fire(junk);
    assert.match(pg.location.hash, /^#[A-Z]{2}\/(retail|utility)$/, junk + ' leaves ' + pg.location.hash);
    assert.equal(pg.location.hash.slice(1, 3), pg.el('state').value, junk + ': the URL names the state on screen');
  }
  pg.fire('#zip-form');
  assert.equal(pg.location.hash, '#zip-form', 'a section link is left alone');
  const fresh = await launchPage('#__proto__');
  assert.equal(fresh.el('state').value, 'GA');
  assert.match(fresh.location.hash, /^#GA\//);
});

// ---------- 9. caps ----------

test('9 caps: 2,000 parts, 50 metric columns, and long message lists end in "And N more"', () => {
  const rows = ['part,category,lead_time_weeks'].concat(Array.from({ length: 2001 }, (_, i) => 'P' + i + ',cells,1')).join('\n');
  assert.match(S.validate(csv(rows)).errors[0], /^The file has 2,001 parts\. The limit is 2,000 per file; split it\.$/);
  assert.equal(S.validate(csv(rows.split('\n').slice(0, 2001).join('\n'))).errors.length, 0);
  const head = 'state,' + Array.from({ length: 51 }, (_, i) => 'm' + i).join(',');
  assert.match(MC.loadStates(csv(head + '\nTX,' + Array(51).fill(1).join(',') + '\n')).errors[0], /51 metric columns\. The limit is 50/);
  const capped = YD.capList(Array.from({ length: 120 }, (_, i) => 'e' + i), 50);
  assert.equal(capped.length, 51);
  assert.equal(capped[50], 'And 70 more like these.');
  assert.equal(YD.capList(['a'], 50).length, 1);
});

// ---------- 11. supply rounding ----------

test('11 supply: rounding never hides a real gap; float noise is no gap', () => {
  const r = S.analyze(S.validate({ kind: 'json', data: [{ part: 'A', category: 'cells', lead_time_weeks: 3, on_hand_weeks: 2.99999 }] }).rows).rows[0];
  assert.equal(r.digits, 5);
  assert.deepEqual([S.weeksText(r.lead_time_weeks, r.digits), S.weeksText(r.cover, r.digits), S.weeksText(r.gap, r.digits)], ['3 wk', '2.99999 wk', '0.00001 wk']);
  assert.equal(r.gap, 0.00001);
  const noise = S.analyze(S.validate({ kind: 'json', data: [{ part: 'B', category: 'cells', lead_time_weeks: 0.3, on_hand_weeks: 0.1 + 0.2 }] }).rows).rows[0];
  assert.equal(noise.gap, 0);
  assert.deepEqual(noise.flags, []);
  assert.equal(S.weeksText(12.34), '12.3 wk');
  assert.equal(S.weeksText(0.05), 'under 0.1 wk');
  const page = fs.readFileSync(path.join(ROOT, 'supply.js'), 'utf8');
  assert.match(page, /wk\(r\.lead_time_weeks, r\.digits\)/);
});

// ---------- 12. pitch targets and terms ----------

test('12 pitch: unknown targets are row errors, suggestions prefer the pitch state, termYears is whole', () => {
  const nope = P.loadYourData({ kind: 'json', data: { targets: [{ utility: 'Nope Power' }] } }, MAP.utilities, { state: 'TX' });
  assert.equal(nope.errors.length, 1);
  assert.doesNotMatch(nope.errors[0], /Did you mean/, 'no far-off Michigan name on a Texas pitch');
  const typo = P.loadYourData({ kind: 'json', data: { targets: [{ utility: 'Austin Enrgy' }] } }, MAP.utilities, { state: 'TX' });
  assert.match(typo.errors[0], /Did you mean Austin Energy, TX/);
  const term = P.loadYourData({ kind: 'json', data: { termYears: 2.5 } }, MAP.utilities);
  assert.deepEqual(term.errors, ['termYears must be a whole number of years. Got 2.5.']);
  assert.deepEqual(P.loadYourData({ kind: 'json', data: { termYears: 10 } }, MAP.utilities).errors, []);
});

// ---------- 15, 16, 17. pitch copy ----------

test('15 capacity illustration fits the market: accredited only in PJM, MISO, ISO-NE, NYISO; ERCOT shows 2-hour peak MW', () => {
  const byId = (id) => MAP.utilities.find((u) => u.id === id);
  const prog = P.sizeProgram(100, 1e6, P.publicTerms());
  const comed = P.capacityExample(prog, P.publicTerms(), byId('4110-IL'));
  assert.equal(comed.kind, 'accredited');
  assert.ok(comed.accredited && Math.abs(comed.accredited.accreditedMw - 5000 * 15.68 / 1000 * 0.6465) < 1e-9);
  const coserv = P.capacityExample(prog, P.publicTerms(), byId('5078-TX'));
  assert.equal(coserv.kind, 'ercot');
  assert.equal(coserv.accredited, null);
  assert.ok(Math.abs(coserv.mwFor2h - 78.4) < 1e-9);
  assert.match(coserv.text, /energy-only market, so nothing here is accredited/);
  assert.match(coserv.text, /4CP/);
  assert.doesNotMatch(coserv.text, /NYISO|64\.65/);
  assert.equal(P.capacityExample(prog, P.publicTerms(), byId('5701-TX')).kind, 'none');
  assert.equal(P.capacityConcept({ detail: { rtos: 'MISO, SPP' } }).kind, 'accredited');
  assert.equal(P.capacityConcept({ detail: { rtos: 'CAISO' } }).kind, 'none');
});

test('16 and 17 pitch copy: utility-programs eyebrow, neutral partner note, El Paso Electric as a pilot', () => {
  const html = fs.readFileSync(path.join(ROOT, 'pitch.html'), 'utf8');
  assert.doesNotMatch(html, /Business to government/);
  assert.match(html, /<p class="eyebrow">Utility programs<\/p>/);
  assert.doesNotMatch(html, /leaves out|not confirmed|without either being wrong/);
  assert.match(html, /reports "3 metro areas, 6 utility partners" over the last 12 months/);
  assert.match(html, /Runs a pilot with Base/);
  assert.equal(P.known('5701-TX').label, 'Runs a pilot with Base');
  assert.match(P.known('5701-TX').note, /pilot/);
});

// ---------- 10. /pitch page: MW checked like the API ----------

function el(id, REG) {
  const e = {
    id, value: '', hidden: true, disabled: false, className: '', innerHTML: '', children: [], attrs: {}, listeners: {}, classes: new Set(),
    get firstChild() { return e.children[0] || null; },
    classList: { add: (c) => e.classes.add(c), remove: (c) => e.classes.delete(c), contains: (c) => e.classes.has(c) },
    setAttribute(k, v) { e.attrs[k] = String(v); }, removeAttribute(k) { delete e.attrs[k]; }, getAttribute(k) { return k in e.attrs ? e.attrs[k] : null; },
    addEventListener(t, f) { (e.listeners[t] = e.listeners[t] || []).push(f); },
    appendChild(c) { e.children.push(c); return c; },
    insertBefore(c) { e.children.unshift(c); if (c.id) REG[c.id] = c; return c; },
    scrollIntoView() {},
    closest() { return 'data-id' in e.attrs ? e : null; },
    fire(t, ev) { (e.listeners[t] || []).forEach((f) => f(Object.assign({ preventDefault() {}, target: e }, ev || {}))); },
  };
  Object.defineProperty(e, 'textContent', {
    get() { return e._text + e.children.map((c) => c.textContent || '').join(''); },
    set(v) { e._text = String(v); e.children = []; },
  });
  e._text = '';
  return e;
}

async function pitchPage() {
  const REG = {};
  ['controls', 'build', 'status', 'utility-list', 'utility', 'mw', 'largeloads', 'print', 'ranking-panel', 'sheet', 'ranking-title', 'ranking-help', 'ranking'].forEach((id) => { REG[id] = el(id, REG); });
  REG.mw.value = '100';
  const document = {
    readyState: 'complete', getElementById: (id) => REG[id] || null, createDocumentFragment: () => el('', REG),
    createElement: () => el('', REG), createTextNode: (t) => ({ textContent: String(t) }), addEventListener() {},
  };
  const files = { '/data/expansion-map.json': MAP, '/data/market-states.json': MARKET };
  const window = { document, print() {} };
  const ctx = vm.createContext({ window, document, fetch: (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(files[u]) }), console, Promise, TextDecoder, Uint8Array });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'yourdata.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'pitch-core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'pitch.js'), 'utf8'), ctx);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  return { $: REG, build(t) { REG.utility.value = t; REG.controls.fire('submit'); }, mw(v) { REG.mw.value = v; REG.mw.fire('input'); } };
}

test('10 pitch page: an out-of-range program size is an error, never "Ready" with "Program size: n/a"', async () => {
  const pg = await pitchPage();
  pg.build('Austin Energy');
  assert.match(pg.$.status.textContent, /^Ready/);
  for (const bad of ['-3', '5001', '', '0', '3,5']) {
    pg.mw(bad);
    assert.match(pg.$.status.className, /notice-red/, JSON.stringify(bad));
    assert.match(pg.$.status.textContent, /program size/i, JSON.stringify(bad));
    assert.match(pg.$.sheet.innerHTML, /Program size must be a number above 0|Enter a program size/);
  }
  assert.match(pg.$.status.textContent, /Use a dot for decimals/, '"3,5" names the comma rule');
  pg.mw('0.5');
  assert.match(pg.$.status.textContent, /^Ready/, '0.5 MW is valid, as on the API');
  assert.match(pg.$.sheet.innerHTML, /<dd>25<\/dd>/, '0.5 MW is 25 batteries');
  // One battery in a big utility is a tiny share: "under 0.01%", never "0.00%".
  pg.mw('0.02');
  assert.ok(pg.$.sheet.innerHTML.includes('<dd>under 0.01%</dd>'));
  assert.ok(!pg.$.sheet.innerHTML.includes('0.00%'));
  // An ERCOT utility gets the 2-hour peak MW, not an accredited MW at the NYISO factor.
  pg.mw('100');
  assert.match(pg.$.sheet.innerHTML, /pt-capacity-ercot/);
  assert.doesNotMatch(pg.$.sheet.innerHTML, /nyiso\.com/);
  pg.build('ComEd');
  assert.match(pg.$.sheet.innerHTML, /pt-capacity-accredited/);
  assert.match(pg.$.sheet.innerHTML, /nyiso\.com/);
  const html = fs.readFileSync(path.join(ROOT, 'pitch.html'), 'utf8');
  assert.match(html, /<input id="mw" type="number" min="0" max="5000" step="any"/);
});

// ---------- 18. /tools copy ----------

test('18 /tools: no "Tool 00x" labels; experiments with a smaller battery say so', () => {
  const html = fs.readFileSync(path.join(ROOT, 'tools.html'), 'utf8');
  assert.doesNotMatch(html, /Tool 00\d/);
  assert.match(html, /Experiment · fleet dispatch/);
  assert.match(html, /smaller generic battery \(25 kWh \/ 5 kW\), not the 20 kW \/ 39\.2 kWh/);
  assert.match(html, /<\/details>\r?\n<\/main>\r?\n<footer/, 'the footer is outside the collapsed notes');
  assert.match(fs.readFileSync(path.join(ROOT, 'deploy.html'), 'utf8'), /not the 20 kW \/ 39\.2 kWh unit the five tools use/);
  assert.match(fs.readFileSync(path.join(ROOT, 'base.html'), 'utf8'), /5 kW rate is a generic assumption/);
});

test('pass 3 files carry no em dashes', () => {
  for (const f of ['yourdata.js', 'api/_lib.js', 'supply-core.js', 'supply.js', 'market-core.js', 'pitch-core.js', 'pitch.js', 'pitch.html', 'launch-core.js', 'launch.js', 'zip-launch-core.js', 'bom-check-core.js', 'bom-check.js', 'tools.html', 'site.css',
    'api/v1/launch.js', 'api/v1/supply.js', 'api/v1/market.js', 'api/v1/pitch.js', 'api/v1/zip.js', 'docs/api.md', 'docs/plug-and-play/supply.md', 'docs/plug-and-play/market.md', 'docs/plug-and-play/pitch.md', 'docs/plug-and-play/launch.md', 'tests/pass3-tools.test.cjs']) {
    assert.ok(!fs.readFileSync(path.join(ROOT, f), 'utf8').includes(String.fromCharCode(0x2014)), f);
  }
});
