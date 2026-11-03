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
    'Row 7: fleetCount must be at least 1.',
    'Row 8: itcPct must be at most 70.',
  ]);
  const ok = F.applyOverrides(defaults, Y.parseText('key,value\nitcPct,40\nfleetCount,"2,500"', 'c.csv'), ['LZ_NORTH']);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.changed, ['itcPct', 'fleetCount']);
});
