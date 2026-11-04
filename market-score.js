/* State scoring for the market map, as pure functions. Used by api/v1/market.js in Node.
   This is market.js's rank(), rescore(), why() and factorFmt() with the DOM and page state
   taken out, so the API gives the same scores and tiers as /market for the same weights.
   Ranking math: notes/score.js. Your-own-data validation: market-core.js. */
(function (root) {
  'use strict';

  const ES = typeof require === 'function' ? require('./notes/score.js') : root.ExpansionScore;
  const MC = typeof require === 'function' ? require('./market-core.js') : root.MarketCore;

  const fmt = (n, d = 0) => (n === null || n === undefined || n !== n) ? 'n/a' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

  // market.js started(): expansion-map states that have a shape in market-states.json, merged.
  function mergeStates(E, M) {
    const shape = Object.fromEntries(M.states.map((s) => [s.name, s]));
    return E.states.filter((s) => shape[s.name]).map((s) => Object.assign({}, shape[s.name], s, { values: s.values, detail: s.detail || {} }));
  }

  // Public factors, then your own factors (from MarketCore.loadStates) tagged yours, weight 1.
  function allFactors(E, yours) {
    const mine = yours ? yours.factors.map((f) => Object.assign({}, f, { yours: true, group: 'Yours', weight: 1 })) : [];
    return E.factors.concat(mine);
  }

  // Default weights: each public factor's own weight, 1 for yours. Overrides on top.
  function defaultWeights(factors) {
    return Object.fromEntries(factors.map((f) => [f.id, f.weight]));
  }

  // A factor's raw value for a state or utility row. Your metrics are per state only.
  function val(row, f, yours) {
    if (!f.yours) return row.values[f.id];
    const v = row.abbr && !row.state && yours && yours.values[row.abbr];
    return v && v[f.id] != null ? v[f.id] : null;
  }

  function factorFmt(f, v) {
    if (v === null || v === undefined || v !== v) return 'n/a';
    if (f.yours) return fmt(v, Number.isInteger(v) ? 0 : 2);
    const id = f.id;
    if (id === 'homes' || id === 'saidi') return fmt(v);
    if (id === 'saifi') return fmt(v, 2);
    if (id === 'retail' || id === 'wholesale') return fmt(v * 100, 1) + '%';
    if (id === 'storm' || id === 'heat') return fmt(v, 1);
    return fmt(v, 2);
  }

  // Percentile rank of every factor across rows, then the weighted composite.
  function rank(rows, factors, weights, yours) {
    const table = {};
    rows.forEach((row) => { table[row.id] = { id: row.id }; });
    factors.forEach((f) => {
      const r = ES.percentileRanks(rows.map((row) => MC.rankValue(f, val(row, f, yours))));
      rows.forEach((row, i) => { table[row.id][f.id] = r[i]; });
    });
    const rankRows = rows.map((row) => table[row.id]);
    const sc = ES.composite(rankRows, weights);
    return rows.map((row, i) => ({ row, score: sc[i], factors: rankRows[i] }));
  }

  function why(st, it, factors, weights, yours) {
    const parts = factors.filter((f) => weights[f.id] > 0 && it.factors[f.id] != null).map((f) => ({ f, r: it.factors[f.id] })).sort((a, b) => b.r - a.r);
    if (!parts.length) return 'No weighted factor has a published value here.';
    const ph = (f) => `${f.yours ? 'your ' + f.label : f.label.toLowerCase()} ${factorFmt(f, val(st, f, yours))}`;
    let t = 'Leads on ' + parts.slice(0, 2).map((p) => ph(p.f)).join(' and ') + '.';
    const low = parts[parts.length - 1];
    if (parts.length > 2 && low.r < 0.5) t += ' Weakest: ' + ph(low.f) + '.';
    return t;
  }

  /* Score every state. opts: { weights: { id: n } (merged over defaults), yours: MarketCore.loadStates result or null }.
     Returns { factors, weights, states: [{ rank, abbr, name, score, points, tier, why, footprint, factors: { id: { value, rank } } }] }
     best first, ties by name, the same order as the page's tier list. */
  function scoreStates(E, M, opts) {
    opts = opts || {};
    const yours = opts.yours || null;
    const factors = allFactors(E, yours);
    const weights = Object.assign(defaultWeights(factors), opts.weights || {});
    const states = mergeStates(E, M);
    const ranked = rank(states, factors, weights, yours).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.row.name.localeCompare(b.row.name));
    return {
      factors: factors.map((f) => ({ id: f.id, label: f.label, group: f.group, yours: !!f.yours, higherIsBetter: f.higherIsBetter !== false, weight: weights[f.id] })),
      weights,
      // Only scored states are ranked, the same as the page: with every weight at 0, rank is null.
      states: ranked.map((it, i) => ({
        rank: it.score === null || it.score === undefined ? null : i + 1,
        abbr: it.row.abbr,
        name: it.row.name,
        score: it.score,
        points: it.score === null || it.score === undefined ? null : Math.round(it.score * 100),
        tier: ES.tierOf(it.score),
        why: why(it.row, it, factors, weights, yours),
        footprint: it.row.footprint || null,
        factors: Object.fromEntries(factors.map((f) => [f.id, { value: val(it.row, f, yours), shown: factorFmt(f, val(it.row, f, yours)), rank: it.factors[f.id] }])),
      })),
    };
  }

  const TIERS = [
    { id: 'S', label: 'Target first' }, { id: 'A', label: 'Strong case' }, { id: 'B', label: 'Mixed' },
    { id: 'C', label: 'One constraint leads' }, { id: 'Later', label: 'Thin public case' },
  ];

  const api = { mergeStates, allFactors, defaultWeights, rank, why, factorFmt, scoreStates, TIERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MarketScore = api;
})(typeof window !== 'undefined' ? window : globalThis);
