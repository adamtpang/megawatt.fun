const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../data/market-states.json');

test('market map covers all 50 states plus DC with finite EIA numbers', () => {
  assert.equal(d.states.length, 51);
  for (const s of d.states) {
    for (const k of ['customers', 'kwh_month', 'cents_kwh', 'bill_usd', 'saidi_2024', 'saidi_2025', 'saidi_avg']) assert.ok(Number.isFinite(s[k]) && s[k] > 0, `${s.name} ${k}`);
    assert.ok(Math.abs(s.saidi_avg - (s.saidi_2024 + s.saidi_2025) / 2) < 0.06, `${s.name} average`);
    assert.match(s.path, /^M[\d.,LMZ-]+Z$/);
  }
});

test('every source is a real URL and Base markets are states on the map', () => {
  for (const s of Object.values(d.sources)) assert.match(s.url, /^https:\/\//);
  for (const n of d.base_markets) assert.ok(d.states.some((s) => s.name === n), n);
});

test('spot checks against the EIA tables', () => {
  const tx = d.states.find((s) => s.name === 'Texas');
  assert.equal(tx.kwh_month, 1096); assert.equal(tx.cents_kwh, 14.94);
  assert.equal(tx.saidi_2024, 1270.6); assert.equal(tx.saidi_2025, 223.5);
  assert.equal(d.us.cents_kwh, 16.48);
});
