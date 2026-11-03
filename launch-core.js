/* Launch planner core: pure functions for the /launch page.
   Critical path method on a small step graph. No DOM, no network.
   Works in Node (module.exports) and the browser (window.LaunchCore). */
(function (root) {
  'use strict';

  function round1(x) { return Math.round(x * 10) / 10; }

  // Own-key lookups only: a step id such as "constructor" must never reach Object.prototype.
  const hasOwn = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
  // Names reserved on every JavaScript object. A step id may not use them.
  function isReserved(k) { return k === '__proto__' || k === 'prototype' || k in Object.prototype; }

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
    const out = Object.create(null); // keyed by step id
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
      const e = hasOwn(edits, s.id) ? edits[s.id] : null;
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
    const byState = hasOwn(data.overrides, abbr) ? data.overrides[abbr] : null;
    const ov = byState && hasOwn(byState, pathId) ? byState[pathId] : {};
    return path.steps.map(s => {
      const o = hasOwn(ov, s.id) ? ov[s.id] : null;
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

  // Email tennis loops for the steps in a path, with state-specific round costs merged in.
  // pathId is optional: when given, loops scoped to another path (t.path) or replaced
  // for this path by a company's own file (t.except_paths) are left out.
  function resolveTennis(data, steps, abbr, pathId) {
    const ids = new Set(steps.map(s => s.id));
    return (data.tennis || []).filter(t => ids.has(t.step) &&
      (!pathId || ((!t.path || t.path === pathId) && !(t.except_paths || []).includes(pathId)))).map(t => {
      const c = Object.assign({}, t, hasOwn(t.states, abbr) ? t.states[abbr] : {});
      delete c.states;
      delete c.except_paths;
      return c;
    });
  }

  const MAX_WEEKS = 260;
  const STEP_COLUMNS = ['path', 'id', 'name', 'owner', 'low', 'high', 'depends_on', 'round_weeks', 'note'];

  // Text cells: strings, or numbers written as text. Objects, lists and true/false are not text.
  function isText(v) { return v == null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)); }
  function cellText(v) { return v != null && isText(v) ? String(v).trim() : ''; }
  function kindOf(v) { return v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'object' ? 'an object' : typeof v; }
  // Plain decimal numbers only: no hex (0x10), Infinity, true/false, lists or objects.
  const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  function cellNum(v) {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return NaN;
    const t = v.replace(/\s/g, '');
    return DECIMAL.test(t) ? Number(t) : NaN;
  }
  // A cell as shown in an error message.
  function shown(v) { return v == null || typeof v === 'string' || typeof v === 'number' ? cellText(v) : kindOf(v); }
  function depList(v) {
    if (Array.isArray(v)) return v.map(cellText).filter(Boolean);
    return cellText(v).split(';').map(x => x.trim()).filter(Boolean);
  }

  // A company's own launch steps on top of the public data. parsed is
  // { kind: 'csv', data: [{ path, id, name, owner, low, high, depends_on: 'a;b', round_weeks, note }] }
  // or { kind: 'json', data: { paths: { retail: { steps: [...] } }, tennis: [{ step, round_weeks, with, bounce, fix }] } }.
  // A path in the file replaces that path's steps for every state; paths not in the file keep the public steps.
  // Returns { data, errors, warnings, summary, paths }. The input data is never mutated.
  function applyOverrides(data, parsed) {
    const errors = [], warnings = [];
    const d = JSON.parse(JSON.stringify(data));
    const pathIds = Object.keys(data.paths || {});
    const raw = parsed && parsed.data;
    const entries = []; // { pid, where, r }
    const tennisIn = []; // { where, t }
    if (Array.isArray(raw)) {
      raw.forEach((r, i) => entries.push({ pid: cellText(r && r.path), where: 'Row ' + (i + (parsed.kind === 'csv' ? 2 : 1)) + ': ', r }));
    } else if (raw && typeof raw === 'object') {
      const ps = raw.paths;
      if (ps != null && (typeof ps !== 'object' || Array.isArray(ps))) errors.push('"paths" must be an object like { "retail": { "steps": [...] } }.');
      else {
        for (const [pid, p] of Object.entries(ps || {})) {
          const list = p && Array.isArray(p.steps) ? p.steps : null;
          if (!list) { errors.push(pid + ': needs a "steps" list.'); continue; }
          if (!list.length) { errors.push(pid + ': the "steps" list is empty.'); continue; }
          list.forEach((r, i) => entries.push({ pid, where: pid + ' step ' + (i + 1) + ': ', r }));
        }
      }
      if (raw.tennis != null && !Array.isArray(raw.tennis)) errors.push('"tennis" must be a list of { step, round_weeks }.');
      else (raw.tennis || []).forEach((t, i) => tennisIn.push({ where: 'tennis ' + (i + 1) + ': ', t: t || {} }));
    }
    if (!entries.length && !errors.length) errors.push('No steps found. Use the CSV columns ' + STEP_COLUMNS.join(', ') + ', or JSON { "paths": { "retail": { "steps": [...] } } }.');

    // Validate each row and group it by path.
    const byPath = Object.create(null); // pid -> [{ where, step, rw }]
    for (const { pid, where, r } of entries) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) { errors.push(where + 'each step must be an object with ' + STEP_COLUMNS.join(', ') + '.'); continue; }
      if (!isText(r.path) && Array.isArray(raw)) { errors.push(where + 'path must be text, got ' + kindOf(r.path) + '. Use ' + pathIds.join(' or ') + '.'); continue; }
      if (!pid) { errors.push(where + 'missing path. Use ' + pathIds.join(' or ') + '.'); continue; }
      if (!pathIds.includes(pid)) { errors.push(where + 'unknown path "' + pid + '". Use ' + pathIds.join(' or ') + '.'); continue; }
      const id = cellText(r.id), name = cellText(r.name);
      let bad = false;
      for (const k of ['id', 'name', 'owner', 'note']) {
        if (!isText(r[k])) { errors.push(where + k + ' must be text, got ' + kindOf(r[k]) + '.'); bad = true; }
      }
      if (Array.isArray(r.depends_on) ? !r.depends_on.every(isText) : !isText(r.depends_on)) {
        errors.push(where + 'depends_on must be text like "a;b" or a list of step ids.'); bad = true;
      }
      if (!id) { if (isText(r.id)) errors.push(where + 'missing id.'); bad = true; }
      else if (!/^[A-Za-z0-9_.-]+$/.test(id)) { errors.push(where + 'id "' + id + '" may only use letters, digits, _ . and -.'); bad = true; }
      else if (isReserved(id)) { errors.push(where + 'id "' + id + '" is a reserved name. Use another id, such as "' + id.replace(/^_+|_+$/g, '') + '_step".'); bad = true; }
      if (!name) { if (isText(r.name)) errors.push(where + 'missing name' + (id ? ' for ' + id : '') + '.'); bad = true; }
      const label = id || 'this step';
      const dur = {};
      for (const k of ['low', 'high']) {
        const v = cellNum(r[k]);
        if (!Number.isFinite(v)) {
          errors.push(where + k + ' for ' + label + (r[k] == null || typeof r[k] === 'string' || typeof r[k] === 'number' ? ' is not a number: "' + cellText(r[k]) + '".' : ' must be a number, got ' + kindOf(r[k]) + '.'));
          bad = true;
        }
        else if (v < 0) { errors.push(where + k + ' for ' + label + ' cannot be negative.'); bad = true; }
        else if (v > MAX_WEEKS) { errors.push(where + k + ' for ' + label + ' is over ' + MAX_WEEKS + ' weeks (5 years).'); bad = true; }
        else dur[k] = v;
      }
      if (dur.low != null && dur.high != null && dur.high < dur.low) { errors.push(where + 'high (' + dur.high + ') for ' + label + ' is less than low (' + dur.low + ').'); bad = true; }
      let rw = null;
      if (shown(r.round_weeks) !== '') {
        const v = cellNum(r.round_weeks);
        if (!Number.isFinite(v) || v < 0 || v > MAX_WEEKS) { errors.push(where + 'round_weeks for ' + label + ' must be a number from 0 to ' + MAX_WEEKS + ', got "' + shown(r.round_weeks) + '".'); bad = true; }
        else rw = v;
      }
      let owner = cellText(r.owner);
      if (!owner && !bad) { warnings.push(where + label + ' has no owner, shown as "Owner not set".'); owner = 'Owner not set'; }
      if (bad) continue;
      (byPath[pid] = byPath[pid] || []).push({ where, rw, step: { id, name, owner, low: dur.low, high: dur.high, depends_on: depList(r.depends_on), note: cellText(r.note), basis: 'yours' } });
    }

    // Per path: duplicates, unknown dependencies, then cycles via schedule().
    const filePaths = Object.keys(byPath);
    for (const pid of filePaths) {
      const rows = byPath[pid];
      const seen = new Map();
      let ok = true;
      for (const x of rows) {
        if (seen.has(x.step.id)) { errors.push(x.where + 'duplicate id "' + x.step.id + '" in ' + pid + ' (also ' + seen.get(x.step.id).replace(/: $/, '') + ').'); ok = false; }
        else seen.set(x.step.id, x.where);
      }
      for (const x of rows) {
        for (const dep of x.step.depends_on) {
          if (!seen.has(dep)) { errors.push(x.where + x.step.id + ' depends on unknown step "' + dep + '" in ' + pid + '.'); ok = false; }
        }
      }
      if (ok) {
        try { schedule(rows.map(x => x.step), 'low'); }
        catch (e) { errors.push(pid + ': ' + e.message.replace(/^Cycle in launch steps/, 'cycle in depends_on') + '.'); }
      }
      if (!seen.has('first_installs')) warnings.push(pid + ': no step with id first_installs, so "First install" uses the end of the whole timeline.');
    }

    // JSON tennis entries: each must name a step from the file.
    const extraTennis = new Map(); // pid -> Map(step id -> entry)
    for (const { where, t } of tennisIn) {
      if (!isText(t.step)) { errors.push(where + 'step must be text, got ' + kindOf(t.step) + '.'); continue; }
      const sid = cellText(t.step);
      const owners = filePaths.filter(pid => byPath[pid].some(x => x.step.id === sid));
      if (!sid) { errors.push(where + 'missing step.'); continue; }
      if (!owners.length) { errors.push(where + 'step "' + sid + '" is not one of the steps in your file.'); continue; }
      const v = cellNum(t.round_weeks);
      if (!Number.isFinite(v) || v < 0 || v > MAX_WEEKS) { errors.push(where + 'round_weeks for ' + sid + ' must be a number from 0 to ' + MAX_WEEKS + '.'); continue; }
      const e = { round_weeks: v };
      const notText = ['with', 'bounce', 'fix'].filter(k => !isText(t[k]));
      if (notText.length) { errors.push(where + notText.join(', ') + ' must be text.'); continue; }
      for (const k of ['with', 'bounce', 'fix']) if (cellText(t[k])) e[k] = cellText(t[k]);
      for (const pid of owners) {
        if (!extraTennis.has(pid)) extraTennis.set(pid, new Map());
        extraTennis.get(pid).set(sid, e);
      }
    }

    if (errors.length) return { data: d, errors, warnings, summary: '', paths: [] };

    // Apply: replace each file path's steps, drop its state overrides, scope its email tennis.
    let loops = 0;
    for (const pid of filePaths) {
      d.paths[pid] = Object.assign({}, d.paths[pid], { steps: byPath[pid].map(x => x.step), yours: true });
      for (const abbr of Object.keys(d.overrides || {})) delete d.overrides[abbr][pid];
      const rounds = new Map(); // step id -> entry
      for (const x of byPath[pid]) if (x.rw != null) rounds.set(x.step.id, { round_weeks: x.rw });
      for (const [sid, e] of (extraTennis.get(pid) || [])) rounds.set(sid, Object.assign(rounds.get(sid) || {}, e));
      d.tennis = d.tennis || [];
      for (const [sid, e] of rounds) {
        const pub = d.tennis.find(t => t.step === sid && !t.path);
        if (pub) pub.except_paths = (pub.except_paths || []).concat(pid);
        const base = pub ? { with: pub.with, bounce: pub.bounce, fix: pub.fix } : { with: 'The other side', bounce: '', fix: '' };
        d.tennis.push(Object.assign(base, e, { step: sid, path: pid, basis: 'yours' }));
        loops++;
      }
    }
    const kept = pathIds.filter(p => !filePaths.includes(p));
    const summary = 'Your steps for ' + filePaths.map(p => (d.paths[p].label || p) + ' (' + byPath[p].length + ' steps)').join(' and ') +
      (loops ? ', with ' + loops + ' email-tennis round cost' + (loops === 1 ? '' : 's') : '') + '.' +
      (kept.length ? ' ' + kept.map(p => d.paths[p].label || p).join(' and ') + ' keeps the public steps.' : '');
    return { data: d, errors, warnings, summary, paths: filePaths };
  }

  // Template rows: the path's resolved steps for one state, with each step's email-tennis round cost.
  function templateRows(data, pathId, abbr) {
    const steps = resolveSteps(data, pathId, abbr);
    const rw = new Map(resolveTennis(data, steps, abbr, pathId).map(t => [t.step, t.round_weeks]));
    return steps.map(s => ({
      path: pathId, id: s.id, name: s.name, owner: s.owner, low: s.low, high: s.high,
      depends_on: (s.depends_on || []).join(';'), round_weeks: rw.get(s.id) == null ? '' : rw.get(s.id), note: s.note || ''
    }));
  }

  // Add `rounds` extra back-and-forth rounds to every step that has a loop,
  // then reschedule. Returns the new schedule and the weeks it added.
  function tennisCost(steps, loops, rounds, key) {
    key = key || 'low';
    const base = schedule(steps, key);
    const extra = new Map(loops.map(t => [t.step, t.round_weeks * rounds]));
    const trial = steps.map(s => extra.get(s.id) ? Object.assign({}, s, { [key]: durationOf(s, key) + extra.get(s.id) }) : s);
    const after = schedule(trial, key);
    const first = r => r.steps.first_installs ? r.steps.first_installs.ef : r.total;
    // Which single loop, if it took one round, delays first install most?
    const worst = loops.map(t => {
      const one = steps.map(s => s.id === t.step ? Object.assign({}, s, { [key]: durationOf(s, key) + t.round_weeks }) : s);
      return { step: t.step, delay: round1(first(schedule(one, key)) - first(base)) };
    }).sort((a, b) => b.delay - a.delay)[0] || null;
    return { schedule: after, addedFirst: round1(first(after) - first(base)), addedTotal: round1(after.total - base.total), worst };
  }

  function weeksToMonths(w) { return round1(w * 7 / 30.4375); }

  const api = { topoOrder, schedule, applyEdits, bestShortening, resolveSteps, suggestPath, weeksToMonths, resolveTennis, tennisCost, applyOverrides, templateRows, isReserved, STEP_COLUMNS, MAX_WEEKS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LaunchCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
