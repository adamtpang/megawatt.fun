const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('../yourdata.js');
const L = require('../launch-core.js');
const data = require('../data/launch-steps.json');

const HEAD = 'path,id,name,owner,low,high,depends_on,round_weeks,note\n';
const load = (text, name = 'x.csv') => L.applyOverrides(data, Y.parseText(text, name));

test('a valid CSV replaces one path, keeps the other, and skips state overrides', () => {
  const before = JSON.stringify(data);
  const r = load(HEAD +
    'retail,entity,Form the company,Legal,1,3,,,\n' +
    'retail,license,Retail license,Regulatory,10,14,entity,3,"Filed with staff, then cured"\n' +
    'retail,edi,Market testing,Ops,6,9,license,,\n' +
    'retail,first_installs,First installs,Field,2,3,license;edi,,\n');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.paths, ['retail']);
  assert.match(r.summary, /Retail provider \(4 steps\)/);
  assert.match(r.summary, /keeps the public steps/);
  const tx = L.resolveSteps(r.data, 'retail', 'TX');
  assert.equal(tx.length, 4);
  assert.ok(tx.every(s => s.basis === 'yours' && !s.override));
  assert.equal(tx.find(s => s.id === 'license').low, 10); // TX override (6 to 17) does not apply
  assert.equal(tx.find(s => s.id === 'license').note, 'Filed with staff, then cured');
  assert.deepEqual(tx.find(s => s.id === 'first_installs').depends_on, ['license', 'edi']);
  assert.equal(L.schedule(tx, 'low').total, 1 + 10 + 6 + 2);
  // Utility keeps the public steps and state overrides.
  assert.deepEqual(L.resolveSteps(r.data, 'utility', 'GA'), L.resolveSteps(data, 'utility', 'GA'));
  // Email tennis: loaded round_weeks replaces the step's cost; steps without one keep the public loop.
  const loops = L.resolveTennis(r.data, tx, 'TX', 'retail');
  const lic = loops.filter(t => t.step === 'license');
  assert.equal(lic.length, 1);
  assert.equal(lic[0].round_weeks, 3);
  assert.equal(lic[0].basis, 'yours');
  assert.equal(loops.find(t => t.step === 'edi').round_weeks, 17); // public TX loop kept
  // A shared step id in the other path keeps its public loop.
  const permitRetail = load(HEAD + 'retail,permitting,Permits,Field,1,2,,9,\n');
  assert.deepEqual(permitRetail.errors, []);
  const ga = L.resolveTennis(permitRetail.data, L.resolveSteps(permitRetail.data, 'utility', 'GA'), 'GA', 'utility');
  assert.equal(ga.find(t => t.step === 'permitting').round_weeks, 2);
  // The public data object is untouched.
  assert.equal(JSON.stringify(data), before);
});

test('JSON shape with a tennis list loads the same way', () => {
  const r = load(JSON.stringify({
    paths: { utility: { steps: [
      { id: 'deal', name: 'Utility deal', owner: 'BD', low: 8, high: 20, depends_on: [], note: '' },
      { id: 'first_installs', name: 'First installs', owner: 'Field', low: 2, high: 4, depends_on: ['deal'] },
    ] } },
    tennis: [{ step: 'deal', round_weeks: 5, with: 'Utility staff', bounce: 'Redlines', fix: 'One redline pass' }],
  }), 'x.json');
  assert.deepEqual(r.errors, []);
  const steps = L.resolveSteps(r.data, 'utility', 'GA');
  const t = L.resolveTennis(r.data, steps, 'GA', 'utility');
  assert.equal(t.length, 1);
  assert.equal(t[0].round_weeks, 5);
  assert.equal(t[0].with, 'Utility staff');
  assert.equal(L.tennisCost(steps, t, 1, 'low').addedFirst, 5);
});

test('every error type is reported with its row', () => {
  const r = load(HEAD +
    'wholesale,a,A,X,1,2,,,\n' +       // row 2 unknown path
    'retail,,No id,X,1,2,,,\n' +       // row 3 missing id
    'retail,b,,X,1,2,,,\n' +           // row 4 missing name
    'retail,c,C,X,abc,2,,,\n' +        // row 5 non-numeric low
    'retail,d,D,X,-1,2,,,\n' +         // row 6 negative low
    'retail,e,E,X,5,3,,,\n' +          // row 7 high < low
    'retail,f,F,X,1,300,,,\n' +        // row 8 over 260 weeks
    'retail,g,G,X,1,2,,soon,\n' +      // row 9 bad round_weeks
    'retail,h,H,X,1,2,,,\n' +
    'retail,h,H again,X,1,2,,,\n' +    // row 11 duplicate id
    'retail,i,I,X,1,2,ghost,,\n');     // row 12 unknown depends_on
  const want = [
    /^Row 2: unknown path "wholesale"/,
    /^Row 3: missing id/,
    /^Row 4: missing name for b/,
    /^Row 5: low for c is not a number: "abc"/,
    /^Row 6: low for d cannot be negative/,
    /^Row 7: high \(3\) for e is less than low \(5\)/,
    /^Row 8: high for f is over 260 weeks/,
    /^Row 9: round_weeks for g must be a number/,
    /^Row 11: duplicate id "h" in retail \(also Row 10\)/,
    /^Row 12: i depends on unknown step "ghost"/,
  ];
  assert.equal(r.errors.length, want.length, r.errors.join('\n'));
  want.forEach((re, i) => assert.match(r.errors[i], re));
  assert.deepEqual(r.paths, []);
  assert.equal(load('path,id\n').errors.length, 1);
  assert.match(load('{"tennis":[{"step":"nope","round_weeks":2}],"paths":{"retail":{"steps":[{"id":"a","name":"A","owner":"X","low":1,"high":2}]}}}', 'x.json').errors[0], /^tennis 1: step "nope"/);
});

test('cycles are caught through schedule()', () => {
  const r = load(HEAD +
    'retail,a,A,X,1,2,c,,\n' +
    'retail,b,B,X,1,2,a,,\n' +
    'retail,c,C,X,1,2,b,,\n');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^retail: cycle in depends_on: /);
  assert.match(load(HEAD + 'utility,a,A,X,1,2,a,,\n').errors[0], /cycle/);
});

test('the template for each path and state loads back with zero errors and the same timeline', () => {
  for (const [pid, abbr] of [['retail', 'TX'], ['retail', 'IL'], ['utility', 'GA']]) {
    const csv = Y.toCSV(L.templateRows(data, pid, abbr), L.STEP_COLUMNS);
    assert.ok(csv.startsWith(HEAD));
    const r = load(csv);
    assert.deepEqual(r.errors, [], pid + ' ' + abbr);
    assert.deepEqual(r.warnings, []);
    const mine = L.resolveSteps(r.data, pid, 'OH'); // the file wins in any state
    const pub = L.resolveSteps(data, pid, abbr);
    for (const k of ['low', 'high']) assert.equal(L.schedule(mine, k).total, L.schedule(pub, k).total);
    const rw = t => Object.fromEntries(t.map(x => [x.step, x.round_weeks]));
    assert.deepEqual(rw(L.resolveTennis(r.data, mine, 'OH', pid)), rw(L.resolveTennis(data, pub, abbr, pid)));
  }
  assert.ok(!JSON.stringify(L.templateRows(data, 'retail', 'TX')).includes(String.fromCharCode(0x2014)));
});

// ---------- input hardening (2026-11-03) ----------

test('reserved step ids are row errors, and nothing reaches Object.prototype', () => {
  for (const id of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']) {
    const r = load(HEAD + 'retail,' + id + ',X,O,1,2,,1,\nretail,first_installs,Y,O,1,2,' + id + ',,\n');
    assert.match(r.errors[0], new RegExp('^Row 2: id "' + id + '" is a reserved name'), id);
    assert.deepEqual(r.paths, []);
  }
  assert.equal({}.polluted, undefined);
  assert.equal(L.isReserved('first_installs'), false);
});

test('core lookups use own keys: a step id "constructor" is not found on an empty object', () => {
  // The core functions are also called with page edits, so they must not trust ids either.
  const steps = [{ id: 'constructor', low: 1, high: 2, depends_on: [] }, { id: 'toString', low: 2, high: 3, depends_on: ['constructor'] }];
  const edited = L.applyEdits(steps, {});
  assert.deepEqual(edited.map(s => !!s.edited), [false, false]);
  const s = L.schedule(steps, 'low');
  assert.equal(Object.getPrototypeOf(s.steps), null);
  assert.equal(s.total, 3);
  // Before the fix this threw "invalid duration for low: 1function Object()...".
  assert.equal(L.tennisCost(steps, [], 1, 'low').addedFirst, 0);
  assert.equal(L.bestShortening(steps, 'low').best.saved, 1);
  assert.deepEqual(L.resolveSteps({ paths: { p: { steps } } }, 'p', 'TX').map(x => !!x.override), [false, false]);
});

test('JSON rows need text for text fields and numbers for durations', () => {
  const r = L.applyOverrides(data, { kind: 'json', data: [
    { path: 'retail', id: 'a', name: { x: 1 }, owner: 'O', low: true, high: [2] },
    { path: ['retail'], id: 'b', name: 'B', low: 1, high: 2 },
    { path: 'retail', id: 'c', name: 'C', owner: 'O', low: 1, high: 2, depends_on: { a: 1 } },
    5,
  ] });
  assert.ok(r.errors.includes('Row 1: name must be text, got an object.'), r.errors.join(' | '));
  assert.ok(r.errors.includes('Row 1: low for a must be a number, got boolean.'));
  assert.ok(r.errors.includes('Row 1: high for a must be a number, got a list.'));
  assert.ok(r.errors.some(e => e.startsWith('Row 2: path must be text, got a list.')));
  assert.ok(r.errors.some(e => e.startsWith('Row 3: depends_on must be text')));
  assert.ok(r.errors.some(e => e.startsWith('Row 4: each step must be an object')));
  assert.ok(!r.errors.join(' ').includes('[object Object]'));
});

test('durations are plain decimals: hex and Infinity are not numbers', () => {
  const r = load(HEAD + 'retail,a,A,O,0x10,2,,,\nretail,b,B,O,1,Infinity,,,\nretail,c,C,O,1,2,,0b11,\n');
  assert.ok(r.errors.includes('Row 2: low for a is not a number: "0x10".'), r.errors.join(' | '));
  assert.ok(r.errors.includes('Row 3: high for b is not a number: "Infinity".'));
  assert.ok(r.errors.some(e => e.startsWith('Row 4: round_weeks for c must be a number from 0 to 260')));
});
