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
  assert.match(f.note, new RegExp('Public default was ' + defaults.groups.flatMap((g) => g.fields).find((x) => x.key === 'capexPerKwh').value + ' '));
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

test('finance: __proto__ and other inherited names are unknown keys, and nothing is polluted', () => {
  const zones = ['LZ_NORTH'];
  const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__'];
  const csv = 'key,value\n' + names.map((n) => n + ',5').join('\n');
  const r = F.applyOverrides(defaults, Y.parseText(csv, 'evil.csv'), zones);
  assert.equal(r.errors.length, names.length);
  names.forEach((n, i) => assert.ok(r.errors[i].startsWith('Row ' + (i + 2) + ': unknown key "' + n + '"'), r.errors[i]));
  assert.deepEqual(r.changed, []);
  assert.equal(({}).value, undefined);
  assert.equal(({}).kind, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'value'), false);
  // JSON: an own "__proto__" key from JSON.parse, at the top level and inside inputs.
  for (const text of ['{"__proto__": {"value": 1, "kind": "yours"}}', '{"inputs": {"__proto__": 5, "constructor": 1}}']) {
    const j = F.applyOverrides(defaults, Y.parseText(text, 'evil.json'), zones);
    assert.ok(j.errors.some((e) => /unknown key "__proto__"/.test(e)), text + ' ' + j.errors.join(' | '));
    assert.equal(({}).value, undefined);
    assert.equal(({}).kind, undefined);
  }
});

test('finance file: hex, Infinity, huge and fractional counts are rejected like on the page', () => {
  const r = F.applyOverrides(defaults, Y.parseText('key,value\ntollPerKwYear,0x10\nkwh,1e308\ncapexPerKwh,Infinity\nfleetCount,2.5\narbPerYear,1e9\nfleetCount,0\nitcPct,80', 'b.csv'), ['LZ_NORTH']);
  assert.deepEqual(r.errors, [
    'Row 2: tollPerKwYear is not a number: "0x10". Use plain decimal digits.',
    'Row 3: kwh must be at most 1000.',
    'Row 4: capexPerKwh is not a number: "Infinity". Use plain decimal digits.',
    'Row 5: fleetCount must be a whole number.',
    'Row 6: arbPerYear must be at most ' + F.ARB_MAX + '.',
    // A key given twice is an error, not "last row wins".
    'Row 7: fleetCount appears again (first at Row 5). Keep one row per key.',
    'Row 8: itcPct must be at most 70.',
  ]);
  assert.deepEqual(F.applyOverrides(defaults, Y.parseText('key,value\nfleetCount,0', 'd.csv'), ['LZ_NORTH']).errors, ['Row 2: fleetCount must be at least 1.']);
  const ok = F.applyOverrides(defaults, Y.parseText('key,value\nitcPct,40\nfleetCount,"2,500"', 'c.csv'), ['LZ_NORTH']);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.changed, ['itcPct', 'fleetCount']);
});

// ---------- break-test fixes, 2026-11-04 ----------

test('parseCSV records a header written twice (last value kept), without changing the rows', () => {
  const rows = Y.parseCSV('a,b,a\n1,2,3\n');
  assert.deepEqual(rows, [{ a: '3', b: '2' }]);
  assert.deepEqual(rows.duplicateHeaders, ['a']);
  assert.deepEqual(Object.keys(rows), ['0']);
  assert.deepEqual(Y.parseCSV('a,b\n1,2\n').duplicateHeaders, []);
});

test('a failed load says which earlier file is still in use', () => {
  const f = Y.failureStatus('bad.csv', ['Row 2: missing key.'], 'good.csv');
  assert.equal(f.title, 'bad.csv was not loaded. Fix these and load it again:');
  assert.deepEqual(f.items, ['Row 2: missing key.']);
  assert.equal(f.note, 'Still using good.csv, the file loaded before.');
  assert.equal(Y.failureStatus('bad.csv', ['x'], null).note, 'Still using the public data.');
  assert.equal(Y.failureStatus('big.csv', [], 'good.csv', 'big.csv is larger than 5 MB.').title, 'big.csv is larger than 5 MB.');
});

test('finance file: Key,Value headers in any case, duplicate keys, zone in any case, arbPerYear over a zone', () => {
  const zones = ['LZ_NORTH', 'LZ_WEST'];
  const mixed = F.applyOverrides(defaults, Y.parseText('Key,VALUE\ncapexPerKwh,300\n', 'm.csv'), zones);
  assert.deepEqual(mixed.errors, []);
  assert.deepEqual(mixed.changed, ['capexPerKwh']);
  const dup = F.applyOverrides(defaults, Y.parseText('key,value\ncapexPerKwh,300\ncapexPerKwh,310\n', 'd.csv'), zones);
  assert.deepEqual(dup.errors, ['Row 3: capexPerKwh appears again (first at Row 2). Keep one row per key.']);
  const lower = F.applyOverrides(defaults, { kind: 'json', data: { zone: 'lz_west' } }, zones);
  assert.deepEqual(lower.errors, []);
  assert.equal(lower.defaults.zoneDefault, 'LZ_WEST');
  assert.match(F.applyOverrides(defaults, { kind: 'json', data: { zone: 'lz_mars' } }, zones).errors[0], /zone must be one of LZ_NORTH, LZ_WEST \(any case\), got "lz_mars"/);
  const both = F.applyOverrides(defaults, { kind: 'json', data: { zone: 'LZ_WEST', arbPerYear: 150 } }, zones);
  assert.deepEqual(both.errors, []);
  assert.ok(both.warnings.includes('arbPerYear replaces the zone value, so zone LZ_WEST is not used. Leave arbPerYear blank to use the zone.'), both.warnings.join(' | '));
});

test('finance file: a number too large to store is out of range, quoting what was typed', () => {
  const j = F.applyOverrides(defaults, Y.parseText('{"capexPerKwh":1e400}', 'x.json'), ['LZ_NORTH']);
  assert.equal(j.errors.length, 1);
  assert.match(j.errors[0], /^capexPerKwh is out of range: the number is too large\. Allowed: \d+ to \d+\.$/);
  assert.doesNotMatch(j.errors[0], /Infinity|not a number/);
  const c = F.applyOverrides(defaults, Y.parseText('key,value\ncapexPerKwh,1e400\narbPerYear,-1e999\n', 'x.csv'), ['LZ_NORTH']);
  assert.match(c.errors[0], /^Row 2: capexPerKwh is out of range: "1e400" is too large\. Allowed: /);
  assert.match(c.errors[1], /^Row 3: arbPerYear is out of range: "-1e999" is too large\. Allowed: 0 to 100000\.$/);
  // The page's input fields say the same.
  const v = F.validateFields(defaults, { capexPerKwh: '1e400' });
  assert.match(v.errors.capexPerKwh, /out of range: "1e400" is too large/);
});
