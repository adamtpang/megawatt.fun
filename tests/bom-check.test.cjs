const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../bom-check-core.js');

test('the demo BOM ranks by gap, doubles single source, and keeps qty out of the score', () => {
  const res = B.check(B.DEMO_CSV);
  assert.deepEqual(res.errors, []);
  assert.equal(res.formula, 'max(0, lead_time_days - on_hand_days) * (2 if single source, else 1); ties broken by spend (qty * unit_cost_usd)');
  assert.match(B.DEMO_NOTE, /Demo data/);
  assert.match(B.DEMO_CSV, /Demo Cell Works/);
  assert.equal(/base power|catl|tesla|samsung|byd/i.test(B.DEMO_CSV), false);

  const byPart = Object.fromEntries(res.rows.map((r) => [r.part_number, r]));
  // 45 lead - 20 on hand = 25 short, one supplier: 25 x 2. Twelve per build does not multiply it.
  assert.equal(byPart['DEMO-CELL-14'].gap_days, 25);
  assert.equal(byPart['DEMO-CELL-14'].sourcing, 'single');
  assert.equal(byPart['DEMO-CELL-14'].block_score, 50);
  // Qualified second source: gap 20, not doubled.
  assert.equal(byPart['DEMO-INV-2'].sourcing, 'qualified');
  assert.equal(byPart['DEMO-INV-2'].single_source, 0);
  assert.equal(byPart['DEMO-INV-2'].block_score, 20);
  // An alternate is listed but not qualified: still single source.
  assert.equal(byPart['DEMO-MOD-3'].single_supplier, false);
  assert.equal(byPart['DEMO-MOD-3'].sourcing, 'alt_unqualified');
  assert.equal(byPart['DEMO-MOD-3'].flag, 'Alternate listed, not qualified');
  assert.equal(byPart['DEMO-MOD-3'].block_score, 42);
  // Unknown lead time stays unknown.
  assert.equal(byPart['DEMO-BMS-7'].lead_time_days, null);
  assert.equal(byPart['DEMO-BMS-7'].block_score, null);
  assert.equal(byPart['DEMO-BMS-7'].block_score_display, 'unknown');
  // Stock covers the lead time: score 0, still flagged as single supplier.
  assert.equal(byPart['DEMO-DISC-1'].gap_days, -16);
  assert.equal(byPart['DEMO-DISC-1'].block_score, 0);
  assert.equal(byPart['DEMO-DISC-1'].flag, 'Single supplier');
  assert.equal(byPart['DEMO-WIRE-9'].block_score, 7);
  assert.equal(byPart['DEMO-WIRE-9'].spend_usd, 100);

  assert.deepEqual(res.ranked.map((r) => r.part_number), [
    'DEMO-CELL-14', 'DEMO-MOD-3', 'DEMO-INV-2', 'DEMO-WIRE-9', 'DEMO-BMS-7', 'DEMO-DISC-1',
  ]);
  assert.deepEqual(res.ranked.map((r) => r.rank), [1, 2, 3, 4, null, null]);
  for (const p of ['DEMO-CELL-14', 'DEMO-MOD-3', 'DEMO-BMS-7', 'DEMO-DISC-1']) assert.match(res.flagged_csv, new RegExp(p));
  assert.equal(res.flagged_csv.includes('DEMO-INV-2'), false);
  assert.equal(res.flagged_csv.includes('DEMO-WIRE-9'), false);
  assert.match(res.flagged_csv, /gap_days,unit_cost_usd,spend_usd,sourcing,block_score/);
  assert.match(res.flagged_csv, /Alternate listed, not qualified/);
});

test('quantity does not change the score; spend breaks ties', () => {
  const csv = [
    'part_number,description,qty,supplier,lead_time_days,on_hand_days,unit_cost_usd',
    'DEMO-A,One per build,1,Demo A,30,0,10',
    'DEMO-B,Twelve per build,12,Demo B,30,0,10',
    'DEMO-C,Pricey,1,Demo C,30,0,500',
  ].join('\n');
  const res = B.check(csv);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.rows.map((r) => r.block_score), [60, 60, 60]);
  // Same score: highest spend first (500, then 120, then 10).
  assert.deepEqual(res.ranked.map((r) => r.part_number), ['DEMO-C', 'DEMO-B', 'DEMO-A']);
});

test('parser accepts quotes, header aliases, and semicolon or pipe alternates', () => {
  const csv = [
    'Part Number,Description,Quantity,Vendor,Alternate Suppliers,Second Source Qualified,Lead Time (days),Days On Hand,Unit Cost',
    '"DEMO-1","Widget, large",2,Demo Shop,"Demo Shop; Demo Shop",,10,4,"$1,200"',
    'DEMO-2,Other widget,1,Demo Alpha,Demo Beta|Demo Gamma,Yes,4,,',
  ].join('\n');
  const res = B.check(csv);
  assert.deepEqual(res.errors, []);
  assert.equal(res.rows[0].description, 'Widget, large');
  assert.equal(res.rows[0].qty, 2);
  assert.equal(res.rows[0].single_supplier, true);
  assert.equal(res.rows[0].block_score, (10 - 4) * 2);
  assert.equal(res.rows[0].spend_usd, 2400);
  assert.equal(res.rows[1].single_supplier, false);
  assert.equal(res.rows[1].suppliers.length, 3);
  assert.equal(res.rows[1].sourcing, 'qualified');
  assert.equal(res.rows[1].block_score, 4);
});

test('listed alternates without alt_qualified are not counted as a second source', () => {
  const res = B.check('part_number,description,qty,supplier,alt_suppliers,lead_time_days\nDEMO-1,Demo,1,Demo A,Demo B,10\n');
  assert.deepEqual(res.errors, []);
  assert.ok(res.warnings.some((w) => /alt_qualified/.test(w)));
  assert.ok(res.warnings.some((w) => /on_hand_days/.test(w)));
  assert.equal(res.rows[0].sourcing, 'alt_unqualified');
  assert.equal(res.rows[0].single_source, 1);
  assert.equal(res.rows[0].block_score, 20);
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

  const bad = B.check('part_number,description,qty,supplier,lead_time_days,on_hand_days,alt_qualified,unit_cost_usd\nDEMO-1,Demo,0,Demo Co,5,,,\nDEMO-2,Demo,-3,Demo Co,2,,,\nDEMO-3,,1,Demo Co,nope,-1,maybe,abc\n');
  assert.ok(bad.errors.some((e) => /Row 2: qty/.test(e)));
  assert.ok(bad.errors.some((e) => /Row 3: qty/.test(e)));
  assert.ok(bad.errors.some((e) => /Row 4: description/.test(e)));
  assert.ok(bad.errors.some((e) => /Row 4: lead_time_days/.test(e)));
  assert.ok(bad.errors.some((e) => /Row 4: on_hand_days/.test(e)));
  assert.ok(bad.errors.some((e) => /Row 4: alt_qualified/.test(e)));
  assert.ok(bad.errors.some((e) => /Row 4: unit_cost_usd/.test(e)));
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

test('the page shows the new formula and no em dashes in the BOM files', () => {
  const js = fs.readFileSync(path.join(__dirname, '../bom-check.js'), 'utf8');
  assert.match(js, /B\.FORMULA_NOTE/);
  assert.match(js, /not qualified/);
  assert.match(B.FORMULA_NOTE, /Quantity does not raise the score/);
  for (const f of ['bom-check.js', 'bom-check-core.js', 'tests/bom-check.test.cjs']) {
    assert.ok(!fs.readFileSync(path.join(__dirname, '..', f), 'utf8').includes(String.fromCharCode(0x2014)), f);
  }
});

// ---------- break-test fixes, 2026-11-04 ----------

test('numbers are plain decimals with upper bounds: no hex quantities, no Infinity scores', () => {
  const head = 'part_number,description,qty,supplier,lead_time_days,on_hand_days,unit_cost_usd\n';
  const r = B.check(head + 'A,a,0x10,s,1e308,,\nB,b,"1,200",s,5,-1,$3\nC,c,,s,1e400,Infinity,2000000\nD,d,10001,s,3651,3650,0x1\n');
  assert.deepEqual(r.errors, [
    'Row 2: qty is not a plain decimal number: "0x10".',
    'Row 2: lead_time_days must be at most 3,650 (10 years), got 1e308.',
    'Row 3: on_hand_days must be 0 or more, or blank.',
    'Row 4: qty is empty. It must be a number greater than 0.',
    'Row 4: lead_time_days must be at most 3,650 (10 years), got 1e400.',
    'Row 4: on_hand_days is not a plain decimal number: "Infinity".',
    'Row 4: unit_cost_usd must be at most 1,000,000 dollars, got 2000000.',
    'Row 5: qty must be at most 10,000, got 10001.',
    'Row 5: lead_time_days must be at most 3,650 (10 years), got 3651.',
    'Row 5: unit_cost_usd is not a plain decimal number: "0x1".',
  ]);
  assert.match(B.check(head + 'A,a,0,s,5,,\n').errors[0], /^Row 2: qty must be greater than 0\.$/);
  const ok = B.check(head + 'A,a,"1,200",s,3650,0,"$1,000,000"\n');
  assert.deepEqual(ok.errors, []);
  assert.deepEqual([ok.rows[0].qty, ok.rows[0].block_score, ok.rows[0].unit_cost_usd], [1200, 7300, 1000000]);
  assert.ok(Number.isFinite(ok.rows[0].block_score));
});
