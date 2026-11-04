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
  // Removed: a republished 2025 claim about where earlier Base batteries were made, and republisher copies of Base's release.
  assert.ok(!/made in China/i.test(s));
  assert.ok(!s.includes('01net') && !s.includes('newsio'));
  assert.ok(!d.gaps.some(g => /threshold/i.test(g)), 'stale foreign-content gap line is gone');
});

test('supply: storage credit threshold matches /finance (55% for 2026, IRS Notice 2026-15)', () => {
  const n = d.parts.find(p => p.id === 'cells').policy.find(q => /Notice 2026-15/.test(q.name));
  assert.ok(n && /55%/.test(n.value) && /55%/.test(n.quote));
  assert.equal(n.url, 'https://www.irs.gov/pub/irs-drop/n-26-15.pdf');
});

test('supply: tariff entries cite primary sources', () => {
  const pol = d.parts.find(p => p.id === 'cells').policy;
  const by = re => pol.find(q => re.test(q.name));
  assert.match(by(/Supreme Court/).url, /supremecourt\.gov/);
  assert.match(by(/Section 122/).url, /whitehouse\.gov/);
  const s301 = by(/60 economies/);
  assert.match(s301.url, /ustr\.gov/);
  assert.match(s301.value, /12\.5%/);
});

test('supply: memory card has sourced parts, end-of-life notices and mitigations', () => {
  const m = d.parts.find(p => p.id === 'bms_memory');
  for (const k of ['memory_parts', 'eol', 'mitigations']) {
    assert.ok(Array.isArray(m[k]) && m[k].length >= 3, k);
    for (const x of m[k]) assert.ok(x.url || x.basis === 'inference', k + ' ' + (x.part || x.who || x.name));
  }
  for (const x of [...m.memory_parts, ...m.eol]) assert.ok(x.quote && x.date, x.part || x.who);
});
