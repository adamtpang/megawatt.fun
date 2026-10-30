const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../launch-core.js');
const data = require('../data/launch-steps.json');
const map = require('../data/expansion-map.json');

const step = (id, low, deps = [], high = low) => ({ id, low, high, depends_on: deps });

test('critical path on a small known DAG', () => {
  // a(2) -> b(3) -> d(1); a -> c(1) -> d. Critical: a, b, d. Total 6.
  const steps = [step('a', 2), step('b', 3, ['a']), step('c', 1, ['a']), step('d', 1, ['b', 'c'])];
  const r = L.schedule(steps, 'low');
  assert.equal(r.total, 6);
  assert.deepEqual(r.criticalPath, ['a', 'b', 'd']);
  assert.equal(r.steps.c.es, 2);
  assert.equal(r.steps.c.ef, 3);
  assert.equal(r.steps.c.slack, 2);
  assert.equal(r.steps.c.critical, false);
  assert.equal(r.steps.d.es, 5);
  for (const id of ['a', 'b', 'd']) assert.equal(r.steps[id].critical, true);
});

test('parallel branches: the longest branch sets the total', () => {
  const steps = [step('start', 1), step('x', 4, ['start']), step('y', 9, ['start']), step('z', 2, ['start']), step('end', 1, ['x', 'y', 'z'])];
  const r = L.schedule(steps, 'low');
  assert.equal(r.total, 11);
  assert.deepEqual(r.criticalPath, ['start', 'y', 'end']);
  assert.equal(r.steps.x.slack, 5);
  assert.equal(r.steps.z.slack, 7);
  // low and high are scheduled independently
  const hi = L.schedule([step('p', 1, [], 10), step('q', 5, [], 2)], 'high');
  assert.equal(hi.total, 10);
  assert.deepEqual(hi.criticalPath, ['p']);
});

test('cycles, unknown dependencies, duplicates and bad durations throw', () => {
  assert.throws(() => L.schedule([step('a', 1, ['c']), step('b', 1, ['a']), step('c', 1, ['b'])]), /Cycle/);
  assert.throws(() => L.schedule([step('a', 1, ['a'])]), /Cycle/);
  assert.throws(() => L.schedule([step('a', 1, ['ghost'])]), /unknown step/);
  assert.throws(() => L.schedule([step('a', 1), step('a', 2)]), /Duplicate/);
  assert.throws(() => L.schedule([step('a', -1)]), /invalid duration/);
  assert.throws(() => L.schedule([{ id: 'a', depends_on: [] }], 'low'), /invalid duration/);
});

test('editing a non-critical step does not change the total until it becomes critical', () => {
  const steps = [step('a', 2), step('b', 6, ['a']), step('c', 1, ['a']), step('d', 1, ['b', 'c'])];
  const base = L.schedule(steps, 'low');
  assert.equal(base.total, 9);
  assert.equal(base.steps.c.slack, 5);
  for (const w of [2, 4, 6]) {
    const r = L.schedule(L.applyEdits(steps, { c: { low: w } }), 'low');
    assert.equal(r.total, 9, `c=${w} weeks should stay inside its slack`);
  }
  const tie = L.schedule(L.applyEdits(steps, { c: { low: 6 } }), 'low');
  assert.equal(tie.steps.c.critical, true);
  const over = L.schedule(L.applyEdits(steps, { c: { low: 8 } }), 'low');
  assert.equal(over.total, 11);
  assert.deepEqual(over.criticalPath, ['a', 'c', 'd']);
  assert.equal(over.steps.b.critical, false);
});

test('applyEdits does not mutate input and keeps high >= low', () => {
  const steps = [step('a', 2, [], 5)];
  const e = L.applyEdits(steps, { a: { low: 7 } });
  assert.equal(steps[0].low, 2);
  assert.equal(e[0].low, 7);
  assert.equal(e[0].high, 7);
  assert.equal(e[0].edited, true);
});

test('bestShortening picks the critical step that saves the most', () => {
  // Total 9 via a-b-d. Halving b (6 -> 3) would save 3, but the a-c-d branch (7) then sets the total, so it saves 2.
  // Halving a saves 1, halving d saves 0.5.
  const steps = [step('a', 2), step('b', 6, ['a']), step('c', 4, ['a']), step('d', 1, ['b', 'c'])];
  const r = L.bestShortening(steps, 'low');
  assert.equal(r.total, 9);
  assert.equal(r.best.id, 'b');
  assert.equal(r.best.saved, 2); // limited by the c branch
  assert.ok(r.options.every(o => ['a', 'b', 'd'].includes(o.id)));
});

test('launch-steps.json: both paths are valid DAGs with sourced or labeled durations', () => {
  const ids = new Set(Object.keys(data.sources));
  for (const [pid, p] of Object.entries(data.paths)) {
    for (const s of p.steps) {
      assert.ok(s.low <= s.high, `${pid}.${s.id} low <= high`);
      assert.ok(['sourced', 'partly', 'assumption'].includes(s.basis), `${pid}.${s.id} basis`);
      if (s.basis !== 'assumption') assert.ok(ids.has(s.source), `${pid}.${s.id} source`);
    }
    for (const k of ['low', 'high']) assert.ok(L.schedule(p.steps, k).total > 0);
  }
  for (const [abbr, o] of Object.entries(data.overrides)) {
    for (const [pid, steps] of Object.entries(o)) {
      for (const [sid, v] of Object.entries(steps)) {
        assert.ok(data.paths[pid].steps.some(s => s.id === sid), `${abbr} override ${sid}`);
        assert.ok(ids.has(v.source), `${abbr} ${sid} source`);
      }
    }
  }
  for (const s of Object.values(data.sources)) assert.match(s.url, /^(https:\/\/|\/data\/)/);
  for (const n of data.snags) {
    assert.ok(Object.values(data.paths).some(p => p.steps.some(s => s.id === n.step)), `snag ${n.id} step`);
    if (n.source) assert.ok(ids.has(n.source));
  }
  assert.ok(!JSON.stringify(data).includes(String.fromCharCode(0x2014)), 'no em dashes');
});

test('path suggestion follows retail share from the expansion map', () => {
  const by = Object.fromEntries(map.states.map(s => [s.abbr, s]));
  assert.equal(L.suggestPath(by.GA).path, 'utility');
  assert.equal(L.suggestPath(by.GA).retailAllowed, false);
  assert.equal(L.suggestPath(by.TX).path, 'retail');
  assert.equal(L.suggestPath(by.OH).path, 'retail');
  assert.equal(map.states.length, 51);
  const ga = L.schedule(L.resolveSteps(data, 'utility', 'GA'), 'low');
  assert.ok(ga.total > 0);
  const tx = L.resolveSteps(data, 'retail', 'TX');
  assert.equal(tx.find(s => s.id === 'edi').source, 'ercot-flights');
});
