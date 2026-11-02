const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('../yourdata.js');
const F = require('../finance-core.js');
const defaults = require('../data/finance-defaults.json');

test('CSV: quotes, commas, newlines, BOM, CRLF, blank lines', () => {
  const rows = Y.parseCSV('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,"multi\nline",\n');
  assert.deepEqual(rows, [{ a: '1', b: 'x, y', c: 'say "hi"' }, { a: '2', b: 'multi\nline', c: '' }]);
  const back = Y.parseCSV(Y.toCSV(rows));
  assert.deepEqual(back, rows);
});

test('parseText picks JSON or CSV and reports bad JSON', () => {
  assert.equal(Y.parseText('{"a":1}', 'x.json').kind, 'json');
  assert.equal(Y.parseText('a,b\n1,2', 'x.csv').kind, 'csv');
  assert.equal(Y.parseText('[{"a":1}]', 'noext').kind, 'json');
  assert.throws(() => Y.parseText('{bad', 'x.json'), /Not valid JSON/);
  assert.equal(Y.num('$1,200'), 1200);
  assert.ok(Number.isNaN(Y.num('')));
});

test('finance: overrides apply, bad rows are named, public defaults untouched', () => {
  const zones = ['LZ_NORTH', 'LZ_WEST'];
  const before = JSON.stringify(defaults);
  const ok = F.applyOverrides(defaults, Y.parseText('key,value\ncapexPerKwh,280\nrevenueCase,merchant\nzone,LZ_WEST\narbPerYear,150', 'a.csv'), zones);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.changed, ['capexPerKwh']);
  assert.equal(ok.defaults.revenueCaseDefault, 'merchant');
  assert.equal(ok.defaults.zoneDefault, 'LZ_WEST');
  assert.equal(ok.arbPerYear, 150);
  const f = ok.defaults.groups.flatMap((g) => g.fields).find((x) => x.key === 'capexPerKwh');
  assert.equal(f.kind, 'yours');
  assert.match(f.note, /Public default was 350/);
  assert.equal(JSON.stringify(defaults), before);
  const bad = F.applyOverrides(defaults, Y.parseText('key,value\ncapexPerKwh,abc\nnope,1\nrevenueCase,lease\nzone,LZ_MARS\ntollPerKwYear,-1', 'b.csv'), zones);
  assert.equal(bad.errors.length, 5);
  assert.match(bad.errors[0], /^Row 2: capexPerKwh is not a number/);
  assert.equal(F.applyOverrides(defaults, { kind: 'csv', data: [] }, zones).errors.length, 1);
  // The template loads back cleanly and changes nothing.
  const tpl = Y.parseText(Y.toCSV(F.templateRows(defaults)), 't.csv');
  const round = F.applyOverrides(defaults, tpl, ['LZ_NORTH', 'LZ_WEST', defaults.zoneDefault]);
  assert.deepEqual(round.errors, []);
  assert.deepEqual(round.changed, []);
});
