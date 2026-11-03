const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('../yourdata.js');
const S = require('../supply-core.js');
const d = require('../data/supply.json');

const ids = d.parts.map((p) => p.id);
const head = S.COLUMNS.join(',');
const load = (text, name) => S.validate(Y.parseText(text, name || 'bom.csv'), ids);

test('supply bom: categories match the public research cards', () => {
  assert.deepEqual(ids.slice().sort(), S.CATEGORIES.slice().sort());
});

test('supply bom: a valid file loads, sorts by gap, and flags', () => {
  const v = load(head + '\n' +
    'Cell,cells,A,CN,16,8,yes,55,40,12,\n' +
    'Inverter,power_electronics,B,DE,30,12,no,25,900,1,\n' +
    'Modem,cellular,C,VN,4,10,yes,10,35,1,\n' +
    'Harness,other,D,MX,8,,no,,60,2,\n');
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  const a = S.analyze(v.rows);
  assert.deepEqual(a.rows.map((r) => [r.part, r.gap]), [['Inverter', 18], ['Cell', 8], ['Harness', 8], ['Modem', -6]]);
  assert.deepEqual(a.rows[0].flags, ['Will run short', 'Single source', 'Tariff 25%+']);
  assert.deepEqual(a.rows[1].flags, ['Will run short', 'Tariff 25%+']);
  assert.deepEqual(a.rows[2].flags, ['Will run short', 'Single source']);
  assert.equal(a.rows[2].cover, 0);
  assert.deepEqual(a.rows[3].flags, []);
  assert.equal(a.totals.atRisk, 3);
  assert.equal(a.totals.singleSource, 2);
  assert.deepEqual(a.totals.longest, { part: 'Inverter', gap: 18 });
  // 40*12*0.55 + 900*1*0.25 + 35*1*0.10 = 264 + 225 + 3.5; Harness has no tariff, so it is left out.
  assert.equal(a.totals.tariffPerBattery, 492.5);
  assert.equal(a.totals.tariffParts, 3);
  assert.equal(a.rows.find((r) => r.part === 'Harness').tariffCost, null);
});

test('supply bom: only part, category and lead time are required; JSON works', () => {
  const v = S.validate(Y.parseText(JSON.stringify({ parts: [{ part: 'Steel', category: 'METALS', lead_time_weeks: 10 }, { part: 'Crew', category: 'labor', lead_time_weeks: '6', second_source: true }] }), 'bom.json'), ids);
  assert.deepEqual(v.errors, []);
  assert.equal(v.rows[0].category, 'metals');
  assert.equal(v.rows[0].on_hand_weeks, null);
  assert.equal(v.rows[1].second_source, true);
  const a = S.analyze(v.rows);
  assert.equal(a.totals.tariffPerBattery, 0);
  assert.equal(a.totals.tariffParts, 0);
});

test('supply bom: each error type is named by row', () => {
  const v = load(head + '\n' +
    ',cells,A,CN,16,8,yes,0,1,1,\n' +
    'X,,A,CN,16,8,yes,0,1,1,\n' +
    'Y,cells,A,CN,,8,yes,0,1,1,\n' +
    'Z,batteries,A,CN,16,8,yes,0,1,1,\n' +
    'W,cells,A,CN,soon,8,yes,0,1,1,\n' +
    'V,cells,A,CN,16,-2,yes,0,1,1,\n' +
    'U,cells,A,CN,16,8,yes,600,1,1,\n' +
    'T,cells,A,CN,16,8,maybe,0,1,1,\n');
  assert.equal(v.errors.length, 8);
  assert.match(v.errors[0], /^Row 2: missing part/);
  assert.match(v.errors[1], /^Row 3: missing category/);
  assert.match(v.errors[2], /^Row 4: missing lead_time_weeks/);
  assert.match(v.errors[3], /^Row 5: unknown category "batteries"/);
  assert.match(v.errors[4], /^Row 6: lead_time_weeks is not a number/);
  assert.match(v.errors[5], /^Row 7: on_hand_weeks cannot be negative/);
  assert.match(v.errors[6], /^Row 8: tariff_pct must be at most 500/);
  assert.match(v.errors[7], /^Row 9: second_source must be yes or no/);
  assert.equal(load('').errors.length, 1);
  assert.equal(S.validate(Y.parseText('{"foo":1}', 'x.json'), ids).errors.length, 1);
});

test('supply bom: duplicate part names are a warning, not an error', () => {
  const v = load(head + '\nCell,cells,A,CN,16,8,yes,,,,\ncell,cells,B,KR,12,8,yes,,,,\n');
  assert.deepEqual(v.errors, []);
  assert.equal(v.rows.length, 2);
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0], /^Row 3: duplicate part name "cell" \(also Row 2\)/);
});

test('supply bom: the template is fictional, covers every category, and loads back clean', () => {
  const rows = S.templateRows(ids);
  assert.deepEqual(rows.map((r) => r.category), ids.concat('other'));
  for (const r of rows) {
    assert.match(r.supplier, /^Example Supplier [A-Z]$/);
    assert.equal(r.note, 'example row, replace');
  }
  const v = load(Y.toCSV(rows, S.COLUMNS));
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.equal(v.rows.length, rows.length);
});

test('supply bom: no em dashes in the new files', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const f of ['supply-core.js', 'supply.js', 'supply.css', 'supply.html', 'docs/plug-and-play/supply.md']) {
    assert.ok(!fs.readFileSync(path.join(__dirname, '..', f), 'utf8').includes(String.fromCharCode(0x2014)), f);
  }
});
