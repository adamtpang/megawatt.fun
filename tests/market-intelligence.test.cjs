const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../market-intelligence.js'), D = require('../deployment-core.js');
const prices = require('../data/deployment/prices.json');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const clone = () => structuredClone(prices);
test('all published hubs, hub averages and load zones pass physical-hour validation', () => {
  M.validateDataset(prices);
  assert.equal(Object.keys(prices.zones).length, 15);
  for (const [kind, count] of [['hub', 5], ['hub-average', 2], ['load-zone', 8]]) assert.equal(Object.values(prices.zones).filter(x => x.kind === kind).length, count);
});
test('reject missing hours, false DST flags and impossible spike totals', () => {
  const p = clone(); p.zones.LZ_HOUSTON.rows.pop(); assert.throws(() => M.validateDataset(p), /coverage/);
  const q = clone(); q.zones.LZ_HOUSTON.rows[0][2] = 'Y'; assert.throws(() => M.validateDataset(q), /coverage/);
  const r = clone(); r.zones.LZ_HOUSTON.spikeIntervalsByHour[0] = 2000; assert.throws(() => M.validateDataset(r), /spike count/);
});
test('loader coalesces requests, refreshes on demand and retries failures', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, json: async () => prices }; };
  await Promise.all([M.loadPrices({ fetcher }), M.loadPrices({ fetcher })]); assert.equal(calls, 1);
  await M.loadPrices({ fetcher, refresh: true }); assert.equal(calls, 2);
  let attempts = 0;
  const retry = async () => ++attempts === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => prices };
  await assert.rejects(M.loadPrices({ fetcher: retry }), /503/);
  await M.loadPrices({ fetcher: retry }); assert.equal(attempts, 2);
});
test('spread, volatility and spike shares have independently known answers', () => {
  const series = { rows: [['2026-01-01', 1, 'N', 30, 10], ['2026-01-01', 2, 'N', 20, 50]], spikeIntervalsByHour: [1, 3, ...Array(22).fill(0)], spikeThresholdPerMWh: 100 };
  const r = M.valueStack(series);
  near(r.diagnostics.meanRT, 30); near(r.diagnostics.meanDA, 25);
  near(r.diagnostics.meanDASpread, -5); near(r.diagnostics.meanAbsoluteSpread, 25); near(r.diagnostics.volatility, 20);
  near(r.spikeHours[0].share, .25); near(r.spikeHours[1].rate, .75);
  near(r.topThreeHourShare, 1); assert.deepEqual(r.topHours, [1, 0]);
  assert.equal(r.total, null); assert.equal(r.ancillary, null); assert.equal(r.reliability, null);
  series.spikeIntervalsByHour.fill(0); const empty = M.valueStack(series);
  assert.equal(empty.topThreeHourShare, 0); assert.deepEqual(empty.topHours, []);
});
test('monthly P&L retains profitable and losing months and reconciles with annual cash', () => {
  const rows = ['2026-01-01', '2026-02-01'].flatMap((date, i) => Array.from({ length: 24 }, (_, h) => [date, h + 1, 'N', 0, h >= 17 && h < 21 ? (i ? 10 : 100) : (i ? 100 : 20)]));
  const r = D.backtest(rows, { efficiency: 1, wear: .01 });
  near(r.months[0].net, 1.4); near(r.months[1].net, -2);
  near(r.net, -.6); near(r.months.reduce((sum, m) => sum + m.net, 0), r.net);
  near(D.backtest(rows, {}, { idle: true }).net, 0);
});
test('real West load-zone replay preserves four losing months', () => {
  const stack = M.valueStack(prices.zones.LZ_WEST);
  assert.equal(stack.backtest.months.length, 12);
  assert.deepEqual(stack.backtest.months.filter(m => m.net < 0).map(m => m.month), ['2025-12', '2026-02', '2026-05', '2026-06']);
  near(stack.energy, stack.backtest.months.reduce((sum, m) => sum + m.net, 0));
});
const candidates = () => [
  { id: 'a', name: 'A', zone: 'LZ_HOUSTON', eligible: true, property: { installedCostUsd: 1000, usableAreaM2: 20 }, grid: { headroomKw: 10 }, basis: 'synthetic', source: 'test fixture', asOf: null },
  { id: 'b', name: 'B', zone: 'LZ_NORTH', eligible: true, property: { installedCostUsd: 2000, usableAreaM2: 10 }, grid: { headroomKw: 5 }, basis: 'synthetic', source: 'test fixture', asOf: null }
];
const results = { LZ_HOUSTON: { net: 100 }, LZ_NORTH: { net: 200 } };
test('every property/grid weight changes the score with the declared direction', () => {
  for (const key of Object.keys(M.FACTORS)) {
    const weights = Object.fromEntries(Object.keys(M.FACTORS).map(k => [k, k === key ? 100 : 0]));
    const ranked = M.scoreCandidates(candidates(), results, weights);
    assert.equal(ranked[0].id, key === 'energy' ? 'b' : 'a'); near(ranked[0].score, 100); near(ranked[1].score, 0);
  }
  const rows = M.scoreCandidates(candidates(), results); near(rows[0].score, 60); near(rows[1].score, 40);
  for (const row of rows) near(Object.values(row.breakdown).reduce((s, b) => s + b.points, 0), row.score);
});
test('eligibility and active missing inputs gate scores without silent reweighting', () => {
  const c = candidates(); c[0].property.installedCostUsd = null; c[1].eligible = false;
  assert.ok(M.scoreCandidates(c, results).every(r => r.score === null));
  const onlyEnergy = { energy: 100, installedCost: 0, usableArea: 0, headroom: 0 };
  const r = M.scoreCandidates(c, results, onlyEnergy); near(r[0].score, 50); assert.equal(r[1].status, 'excluded');
  c[0].eligible = null; assert.equal(M.scoreCandidates(c, results, onlyEnergy)[0].score, null);
  c[0].eligible = true; c[0].zone = 'LZ_UNKNOWN'; assert.equal(M.scoreCandidates(c, results, { energy: 0, installedCost: 0, usableArea: 100, headroom: 0 })[0].score, null);
});
test('invalid weights, duplicate IDs and nonfinite/negative property inputs fail closed', () => {
  assert.throws(() => M.normalizedWeights({ energy: 0, installedCost: 0, usableArea: 0, headroom: 0 }), /positive/);
  assert.throws(() => M.normalizedWeights({ ...M.DEFAULT_WEIGHTS, energy: NaN }));
  assert.throws(() => M.normalizedWeights({ ...M.DEFAULT_WEIGHTS, hiddenFactor: 1 }), /Unknown/);
  const c = candidates(); c[1].id = c[0].id; assert.throws(() => M.scoreCandidates(c, results), /unique/);
  c[1].id = 'b'; c[0].grid.headroomKw = -1; assert.throws(() => M.scoreCandidates(c, results), /Invalid headroom/);
});
