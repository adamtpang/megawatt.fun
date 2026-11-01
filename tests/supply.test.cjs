const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('../data/supply.json');

test('supply: every shown number has a link and a publisher', () => {
  assert.ok(d.parts.length >= 6);
  for (const p of d.parts) {
    assert.ok(p.name && p.what_it_does && p.risk_note && p.our_read && p.our_read.label, p.id);
    for (const k of ['lead_time', 'price_trend', 'concentration']) {
      const f = p[k];
      if (f && f.value) assert.ok(f.url && f.publisher, p.id + ' ' + k);
    }
    for (const q of p.policy || []) assert.ok(q.url, p.id + ' policy ' + q.name);
  }
  for (const b of d.base_public) assert.ok(b.url && b.claim, b.claim);
  const ranks = d.parts.map(p => p.our_read.rank);
  assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b));
});

test('supply: no em dashes, and left-out claims stay out', () => {
  const s = JSON.stringify(d);
  assert.ok(!s.includes(String.fromCharCode(0x2014)));
  assert.ok(!s.includes('TBPN'));
  assert.ok(!/55% for/.test(s));
});
