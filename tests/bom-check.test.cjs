const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../bom-check-core.js');

test('the demo BOM flags single suppliers and ranks by the formula', () => {
  const res = B.check(B.DEMO_CSV);
  assert.deepEqual(res.errors, []);
  assert.equal(res.formula, 'single_source * lead_time_days * qty');
  assert.match(B.DEMO_NOTE, /Demo data/);
  assert.match(B.DEMO_CSV, /Demo Cell Works/);
  assert.equal(/base power|catl|tesla|samsung|byd/i.test(B.DEMO_CSV), false);

  const byPart = Object.fromEntries(res.rows.map((r) => [r.part_number, r]));
  assert.equal(byPart['DEMO-CELL-14'].single_supplier, true);
  assert.equal(byPart['DEMO-CELL-14'].block_score, 45 * 12);
  assert.equal(byPart['DEMO-INV-2'].single_supplier, false);
  assert.equal(byPart['DEMO-INV-2'].single_source, 0);
  assert.equal(byPart['DEMO-INV-2'].block_score, 0);
  assert.equal(byPart['DEMO-BMS-7'].single_supplier, true);
  assert.equal(byPart['DEMO-BMS-7'].lead_time_days, null);
  assert.equal(byPart['DEMO-BMS-7'].block_score, null);
  assert.equal(byPart['DEMO-BMS-7'].block_score_display, 'unknown');
  assert.equal(byPart['DEMO-DISC-1'].block_score, 14);
  assert.equal(byPart['DEMO-WIRE-9'].block_score, 0);

  assert.deepEqual(res.ranked.map((r) => r.part_number), [
    'DEMO-CELL-14', 'DEMO-DISC-1', 'DEMO-BMS-7', 'DEMO-INV-2', 'DEMO-MOD-3', 'DEMO-WIRE-9',
  ]);
  assert.equal(res.ranked[0].rank, 1);
  assert.equal(res.ranked[1].rank, 2);
  assert.equal(res.ranked[2].rank, null);
  assert.match(res.flagged_csv, /DEMO-CELL-14/);
  assert.match(res.flagged_csv, /DEMO-BMS-7/);
  assert.match(res.flagged_csv, /DEMO-DISC-1/);
  assert.equal(res.flagged_csv.includes('DEMO-INV-2'), false);
  assert.match(res.flagged_csv, /single_supplier,block_score/);
});

test('parser accepts quotes, header aliases, and semicolon or pipe alternates', () => {
  const csv = [
    'Part Number,Description,Quantity,Vendor,Alternate Suppliers,Lead Time (days)',
    '"DEMO-1","Widget, large",2,Demo Shop,"Demo Shop; Demo Shop",10',
    'DEMO-2,Other widget,1,Demo Alpha,Demo Beta|Demo Gamma,4',
  ].join('\n');
  const res = B.check(csv);
  assert.deepEqual(res.errors, []);
  assert.equal(res.rows[0].description, 'Widget, large');
  assert.equal(res.rows[0].qty, 2);
  assert.equal(res.rows[0].single_supplier, true);
  assert.equal(res.rows[0].block_score, 20);
  assert.equal(res.rows[1].single_supplier, false);
  assert.equal(res.rows[1].suppliers.length, 3);
  assert.equal(res.rows[1].block_score, 0);
});

test('a missing lead time is unknown, and a blank alternate list is a single supplier', () => {
  const res = B.check('part_number,description,qty,supplier,alt_suppliers\nDEMO-9,Demo board,3,Demo Only,\n');
  assert.deepEqual(res.errors, []);
  assert.ok(res.warnings.some((w) => /lead_time_days/.test(w)));
  assert.equal(res.rows[0].single_supplier, true);
  assert.equal(res.rows[0].block_score_display, 'unknown');
  assert.equal(res.rows[0].block_score, null);
});

test('bad rows and missing columns are errors, and duplicate part numbers are a warning', () => {
  const missing = B.check('description,qty\nDemo,1\n');
  assert.ok(missing.errors.some((e) => /part_number/.test(e)));
  assert.equal(missing.rows.length, 0);

  const bad = B.check('part_number,description,qty,supplier,lead_time_days\nDEMO-1,Demo,0,Demo Co,5\nDEMO-2,Demo,-3,Demo Co,2\nDEMO-3,,1,Demo Co,nope\n');
  assert.ok(bad.errors.some((e) => /Row 2: qty/.test(e)));
  assert.ok(bad.errors.some((e) => /Row 3: qty/.test(e)));
  assert.ok(bad.errors.some((e) => /Row 4: description/.test(e)));
  assert.ok(bad.errors.some((e) => /Row 4: lead_time_days/.test(e)));
  assert.equal(bad.rows.length, 0);

  const dup = B.check('part_number,description,qty,supplier\nDEMO-1,One,1,Demo A\nDEMO-1,Two,1,Demo B\n');
  assert.deepEqual(dup.errors, []);
  assert.equal(dup.rows.length, 2);
  assert.ok(dup.rows.every((r) => r.single_supplier));
  assert.ok(dup.warnings.some((w) => /not merged/.test(w)));
});

test('flagged CSV escapes quotes and leaves unknown scores blank of a fake zero', () => {
  const res = B.check('part_number,description,qty,supplier\n"DEMO-1","Say ""hi""",1,Demo Co\n');
  assert.equal(res.rows[0].block_score_display, 'unknown');
  assert.match(res.flagged_csv, /"Say ""hi"""/);
  assert.match(res.flagged_csv, /,unknown\n/);
  assert.equal(res.flagged_csv.includes(',0\n'), false);
});
