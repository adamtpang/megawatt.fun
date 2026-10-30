/* Launch planner core: pure functions for the /launch page.
   Critical path method on a small step graph. No DOM, no network.
   Works in Node (module.exports) and the browser (window.LaunchCore). */
(function (root) {
  'use strict';

  function round1(x) { return Math.round(x * 10) / 10; }

  // Check ids and dependencies, then return step ids in dependency order.
  // Throws on duplicate ids, unknown dependencies, bad durations, or cycles.
  function topoOrder(steps) {
    const byId = new Map();
    for (const s of steps) {
      if (!s || typeof s.id !== 'string' || !s.id) throw new Error('Every step needs an id');
      if (byId.has(s.id)) throw new Error('Duplicate step id: ' + s.id);
      byId.set(s.id, s);
    }
    for (const s of steps) {
      for (const d of s.depends_on || []) {
        if (!byId.has(d)) throw new Error('Step ' + s.id + ' depends on unknown step ' + d);
      }
    }
    const state = new Map(); // 1 = visiting, 2 = done
    const order = [];
    function visit(id, trail) {
      const st = state.get(id);
      if (st === 2) return;
      if (st === 1) throw new Error('Cycle in launch steps: ' + trail.concat(id).join(' -> '));
      state.set(id, 1);
      for (const d of byId.get(id).depends_on || []) visit(d, trail.concat(id));
      state.set(id, 2);
      order.push(id);
    }
    for (const s of steps) visit(s.id, []);
    return order;
  }

  function durationOf(step, key) {
    const v = typeof key === 'function' ? key(step) : step[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new Error('Step ' + step.id + ' has an invalid duration for ' + (typeof key === 'string' ? key : 'case') + ': ' + v);
    }
    return v;
  }

  // Forward and backward pass. key is 'low', 'high', or a function step -> weeks.
  // Returns earliest/latest start and finish, slack, critical flags, total weeks,
  // and one critical chain from start to finish.
  function schedule(steps, key) {
    key = key || 'low';
    const order = topoOrder(steps);
    const byId = new Map(steps.map(s => [s.id, s]));
    const out = {};
    for (const id of order) {
      const s = byId.get(id);
      const dur = durationOf(s, key);
      let es = 0;
      for (const d of s.depends_on || []) es = Math.max(es, out[d].ef);
      out[id] = { id, dur, es, ef: es + dur };
    }
    let total = 0;
    for (const id of order) total = Math.max(total, out[id].ef);
    const succ = new Map(order.map(id => [id, []]));
    for (const s of steps) for (const d of s.depends_on || []) succ.get(d).push(s.id);
    for (let i = order.length - 1; i >= 0; i--) {
      const r = out[order[i]];
      let lf = total;
      for (const n of succ.get(r.id)) lf = Math.min(lf, out[n].ls);
      r.lf = lf;
      r.ls = lf - r.dur;
      r.slack = Math.max(0, r.ls - r.es);
      r.critical = Math.abs(r.ls - r.es) < 1e-9;
    }
    // One chain: start from a critical step finishing at total, walk back through
    // critical predecessors whose finish equals this step's start.
    const path = [];
    let cur = order.filter(id => out[id].critical && Math.abs(out[id].ef - total) < 1e-9)
      .sort((a, b) => out[b].dur - out[a].dur)[0];
    while (cur) {
      path.unshift(cur);
      const s = byId.get(cur);
      const prev = (s.depends_on || []).filter(d => out[d].critical && Math.abs(out[d].ef - out[cur].es) < 1e-9)
        .sort((a, b) => out[b].dur - out[a].dur)[0];
      cur = prev;
    }
    return { steps: out, order, total, criticalPath: path };
  }

  // Return a copy of steps with user edits applied. edits: { id: { low, high } }.
  function applyEdits(steps, edits) {
    edits = edits || {};
    return steps.map(s => {
      const e = edits[s.id];
      if (!e) return Object.assign({}, s);
      const c = Object.assign({}, s);
      if (Number.isFinite(e.low)) c.low = e.low;
      if (Number.isFinite(e.high)) c.high = e.high;
      if (c.high < c.low) c.high = c.low;
      c.edited = true;
      return c;
    });
  }

  // For each critical step, how many weeks would the launch save if that step
  // took `factor` of its time (default half)? Returns the best one and the list.
  function bestShortening(steps, key, factor) {
    key = key || 'low';
    factor = factor == null ? 0.5 : factor;
    const base = schedule(steps, key);
    const options = [];
    for (const id of base.order) {
      if (!base.steps[id].critical || base.steps[id].dur === 0) continue;
      const trial = steps.map(s => s.id === id ? Object.assign({}, s, { [key]: durationOf(s, key) * factor }) : s);
      const t = schedule(trial, key).total;
      options.push({ id, saved: round1(base.total - t), cutWeeks: round1(base.steps[id].dur * (1 - factor)) });
    }
    options.sort((a, b) => b.saved - a.saved || b.cutWeeks - a.cutWeeks);
    return { best: options[0] || null, options, total: base.total };
  }

  // Merge state-specific overrides into a path's default steps.
  function resolveSteps(data, pathId, abbr) {
    const path = data.paths[pathId];
    if (!path) throw new Error('Unknown path ' + pathId);
    const ov = ((data.overrides || {})[abbr] || {})[pathId] || {};
    return path.steps.map(s => {
      const o = ov[s.id];
      const c = Object.assign({}, s, { depends_on: (s.depends_on || []).slice() });
      if (o) { Object.assign(c, o); c.override = true; }
      return c;
    });
  }

  // Which path does the public data point to? state is an expansion-map.json row.
  function suggestPath(state) {
    const retail = state && state.values ? state.values.retail : 0;
    const wholesale = state && state.values ? state.values.wholesale : 0;
    const pct = Math.round(retail * 100);
    if (!(retail > 0)) {
      return { path: 'utility', retailAllowed: false, reason: 'No residential customers in ' + state.name + ' buy power from a competitive supplier in EIA-861 2025. There is no retail market to enter, so a utility or co-op partnership is the path.' };
    }
    if (retail < 0.15) {
      return { path: 'utility', retailAllowed: true, reason: 'Only ' + pct + '% of residential customers in ' + state.name + ' buy from a competitive supplier. Retail choice exists on paper, but the market is thin. A utility partnership is likely the faster route to volume.' };
    }
    return { path: 'retail', retailAllowed: true, reason: pct + '% of residential customers in ' + state.name + ' buy from a competitive supplier' + (wholesale > 0.5 ? ', and ' + Math.round(wholesale * 100) + '% are inside an ISO/RTO' : '') + '. A licensed retail provider can sell a battery plan directly, the way Base does in Texas and Illinois.' };
  }

  function weeksToMonths(w) { return round1(w * 7 / 30.4375); }

  const api = { topoOrder, schedule, applyEdits, bestShortening, resolveSteps, suggestPath, weeksToMonths };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LaunchCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
