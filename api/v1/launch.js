// POST /api/v1/launch: weeks to a first install in one state, the same way /launch does.
// Math: launch-core.js (resolveSteps, schedule, bestShortening, resolveTennis, tennisCost).
// Data: data/launch-steps.json, data/expansion-map.json.
'use strict';

const LC = require('../../launch-core.js');
const PUBLIC = require('../../data/launch-steps.json');
const MAP = require('../../data/expansion-map.json');
const L = require('../_lib.js');

const STATES = L.byKey(MAP.states, (s) => s.abbr); // a Map: request values never reach Object.prototype
const KNOWN = ['state', 'path', 'case', 'rounds', 'steps'];
const MAX_ROUNDS = 3;

function usage() {
  return {
    tool: 'launch',
    what: 'Critical-path launch plan for one US state: weeks to the first install (fast and slow), the step that shortens launch most, and what each extra round of email back-and-forth costs.',
    post: {
      content_types: ['application/json', 'text/csv'],
      json_body: {
        state: 'two-letter state code, for example "TX" (optional, default "GA", the page default)',
        path: 'retail | utility (optional, default: the path the public data suggests for that state)',
        case: 'low | high: which case drives the critical path, best step and email-tennis cost (optional, default low, the fast case)',
        rounds: 'extra email-tennis rounds on every step with a loop, 0 to 3 (optional, default 1)',
        steps: 'your own steps (optional): a list of rows in the CSV shape { path, id, name, owner, low, high, depends_on: "a;b" or ["a","b"], round_weeks, note }, or { paths: { retail: { steps: [...] } }, tennis: [...] }',
      },
      csv_body: 'The page\'s "Use your own data" file: columns ' + LC.STEP_COLUMNS.join(', ') + '. Put state, path, case and rounds in the query string, for example ?state=TX&path=retail.',
      states: Array.from(STATES.keys()).sort(),
      paths: Object.keys(PUBLIC.paths),
    },
    example: { state: 'TX', case: 'low', rounds: 1 },
    returns: 'first install weeks fast and slow, total weeks, the critical path, the best step to shorten, email-tennis cost and worst loop, and every step with its start, finish and slack.',
    docs: L.docsUrl('launch'),
    page: L.SITE + '/launch',
  };
}

function stepsParsed(steps) {
  if (steps == null) return null;
  if (typeof steps === 'string') return { kind: 'csv', data: L.parseCSV(steps) };
  if (Array.isArray(steps)) return { kind: 'json', data: steps };
  if (typeof steps === 'object') return { kind: 'json', data: steps };
  throw L.invalid(['steps must be a list of step rows, an object { paths: {...} }, or CSV text.']);
}

const OPTIONS = ['state', 'path', 'case', 'rounds'];
const describe = (v) => (Array.isArray(v) ? 'a list' : v === null ? 'null' : typeof v === 'object' ? 'an object' : typeof v === 'string' ? JSON.stringify(L.clip(v)) : JSON.stringify(v));

/* state, path, case and rounds from the query string and a JSON body. Types are checked: in JSON,
   state, path and case are text and rounds is a number (the query string is always text). An
   option sent in both places must agree, or the request is refused rather than silently resolved. */
function readOptions(q, b) {
  const errors = [], out = {};
  for (const k of OPTIONS) {
    let qv = L.getOwn(q, k), bv = L.getOwn(b, k);
    if (Array.isArray(qv)) { errors.push(k + ' appears more than once in the query string. Send it once.'); continue; }
    if (qv != null && String(qv).trim() === '') qv = null;
    if (bv != null) {
      const typeOk = k === 'rounds' ? typeof bv === 'number' : typeof bv === 'string';
      if (!typeOk) { errors.push(k + ' must be ' + (k === 'rounds' ? 'a number, for example 1' : 'text, for example "' + { state: 'TX', path: 'retail', case: 'low' }[k] + '"') + ', got ' + describe(bv) + '.'); continue; }
      if (typeof bv === 'string' && bv.trim() === '') bv = null;
    }
    if (qv != null && bv != null && String(qv).trim().toLowerCase() !== String(bv).trim().toLowerCase()) {
      errors.push(k + ' is ' + describe(bv) + ' in the body but "' + L.clip(qv) + '" in the query string. Send it in one place.');
      continue;
    }
    out[k] = bv != null ? bv : (qv != null ? String(qv) : null);
  }
  if (errors.length) throw L.invalid(errors);
  return out;
}

async function post(parsed, req) {
  const q = L.query(req);
  let opts, own, warnings = [];
  if (L.looksLikeJsonCsv(parsed)) throw L.jsonAsCsvError();
  let b = {};
  if (parsed && parsed.kind === 'csv') own = parsed;
  else {
    b = L.objectBody(parsed);
    warnings = L.unknownKeys(b, KNOWN);
    own = stepsParsed(b.steps);
  }
  opts = readOptions(q, b);

  const errors = [];
  const abbr = opts.state == null ? 'GA' : opts.state.trim().toUpperCase();
  if (!STATES.has(abbr)) errors.push('state "' + L.clip(opts.state.trim()) + '" is not a two-letter US state code in the data (50 states and DC).');
  const kase = opts.case == null ? 'low' : opts.case.trim().toLowerCase();
  if (!['low', 'high'].includes(kase)) errors.push('case must be "low" (fast) or "high" (slow).');
  let rounds = 1;
  if (opts.rounds != null) {
    const n = L.parseNumber(opts.rounds, { integer: true, min: 0, max: MAX_ROUNDS });
    if (n.ok) rounds = n.value;
    else errors.push('rounds must be a whole number from 0 to ' + MAX_ROUNDS + ', got ' + JSON.stringify(typeof opts.rounds === 'string' ? L.clip(opts.rounds) : opts.rounds) + '.');
  }
  let pathId = opts.path == null ? null : opts.path.trim().toLowerCase();
  if (pathId && !L.hasOwn(PUBLIC.paths, pathId)) errors.push('path must be one of ' + Object.keys(PUBLIC.paths).join(', ') + '.');
  if (errors.length) throw L.invalid(errors);

  // A company's own steps on top of the public data (launch.js useData()).
  let DATA = PUBLIC, filePaths = [];
  if (own) {
    const r = LC.applyOverrides(PUBLIC, own);
    if (r.errors.length) throw L.invalid(r.errors);
    DATA = r.data; filePaths = r.paths; warnings = warnings.concat(r.warnings);
  }

  const st = STATES.get(abbr);
  const sug = LC.suggestPath(st);
  if (!pathId) pathId = filePaths.length && !filePaths.includes(sug.path) ? filePaths[0] : sug.path;
  if (pathId === 'retail' && !sug.retailAllowed) warnings.push('Retail provider is not available here: there is no residential retail choice in EIA-861 2025. The steps are shown anyway so you can compare, but a license would have nothing to sell into.');

  const list = LC.resolveSteps(DATA, pathId, abbr);
  let fast, slow;
  try { fast = LC.schedule(list, 'low'); slow = LC.schedule(list, 'high'); }
  catch (e) { throw L.invalid([e.message + '. Check the step durations and dependencies.']); }
  const cur = kase === 'low' ? fast : slow;
  const byId = new Map(list.map((s) => [s.id, s]));
  const name = (id) => (byId.has(id) ? byId.get(id).name : id);
  const first = (r) => (r.steps.first_installs ? r.steps.first_installs.ef : r.total);
  const firstFast = first(fast), firstSlow = first(slow);

  const lever = LC.bestShortening(list, kase);
  const next = lever.best ? lever.options.filter((o) => o.id !== lever.best.id && o.saved > 0)[0] : null;
  const best = lever.best && lever.best.saved > 0
    ? { id: lever.best.id, name: name(lever.best.id), cut_weeks: lever.best.cutWeeks, saved_weeks: lever.best.saved,
      text: 'Cutting ' + name(lever.best.id) + ' in half (' + lever.best.cutWeeks + ' weeks) saves ' + lever.best.saved + ' weeks overall.' + (next ? ' Next best: ' + name(next.id) + ' (' + next.saved + ' weeks).' : ''),
      next_best: next ? { id: next.id, name: name(next.id), saved_weeks: next.saved } : null }
    : { id: null, name: null, text: 'No single step: halving any one critical step saves nothing; parallel branches tie.' };

  const loops = LC.resolveTennis(DATA, list, abbr, pathId);
  const cost = LC.tennisCost(list, loops, rounds, kase);
  const caseName = kase === 'low' ? 'fast' : 'slow';
  const tennisText = rounds
    ? (rounds === 1 ? 'One extra round' : rounds + ' extra rounds') + ' on every step adds ' + cost.addedFirst + ' weeks before the first install (' + caseName + ' case), about ' + LC.weeksToMonths(cost.addedFirst) + ' months.'
    : 'Every step clean on the first try. That is the timeline above.';

  const ids = new Set(list.map((s) => s.id));
  const result = {
    state: abbr,
    state_name: st.name,
    path: pathId,
    path_label: DATA.paths[pathId].label,
    path_from_your_file: !!DATA.paths[pathId].yours,
    suggested: { path: sug.path, retail_allowed: sug.retailAllowed, reason: sug.reason },
    case: kase,
    first_install_weeks: { fast: firstFast, slow: firstSlow },
    first_install_months: { fast: LC.weeksToMonths(firstFast), slow: LC.weeksToMonths(firstSlow) },
    total_weeks: { fast: fast.total, slow: slow.total },
    total_months: { fast: LC.weeksToMonths(fast.total), slow: LC.weeksToMonths(slow.total) },
    critical_path: cur.criticalPath.map((id) => ({ id, name: name(id) })),
    critical_path_text: (kase === 'low' ? 'Fast' : 'Slow') + ' case. Critical path: ' + cur.criticalPath.map(name).join(' > ') + '.',
    best_step_to_shorten: best,
    email_tennis: {
      rounds,
      added_weeks_first_install: cost.addedFirst,
      added_weeks_total: cost.addedTotal,
      text: tennisText,
      worst_loop: cost.worst && cost.worst.delay > 0
        ? { step: cost.worst.step, name: name(cost.worst.step), delay_weeks: cost.worst.delay, text: 'Most expensive single loop: ' + name(cost.worst.step) + '. One round there delays the first install by ' + cost.worst.delay + ' weeks. Get that packet right first.' }
        : null,
      loops: loops.map((t) => ({ step: t.step, name: name(t.step), round_weeks: t.round_weeks, with: t.with, bounce: t.bounce || null, fix: t.fix || null, basis: t.basis || 'assumption', critical: !!(cur.steps[t.step] && cur.steps[t.step].critical) })),
    },
    steps: cur.order.map((id) => {
      const s = byId.get(id), r = cur.steps[id];
      return { id, name: s.name, owner: s.owner, low: s.low, high: s.high, depends_on: s.depends_on || [], start_week: r.es, finish_week: r.ef, slack_weeks: r.slack, critical: r.critical, basis: s.basis, state_override: !!s.override, note: s.note || '' };
    }),
    snags: (DATA.snags || []).filter((n) => ids.has(n.step)).map((n) => ({ step: n.step, title: n.title, note: n.note, kind: n.kind, on_critical_path: !!cur.steps[n.step].critical, source: n.source ? (DATA.sources[n.source] || {}).url || null : null })),
  };

  const used = new Set(list.map((s) => s.source).concat(loops.map((t) => t.source), result.snags.length ? (DATA.snags || []).filter((n) => ids.has(n.step)).map((n) => n.source) : []).filter(Boolean));
  const sources = Object.entries(DATA.sources || {}).filter(([k]) => used.has(k)).map(([k, s]) => ({ id: k, title: s.title, url: s.url.startsWith('http') ? s.url : L.SITE + s.url, retrieved: s.retrieved }));
  sources.push({ id: 'expansion-map', title: 'Retail choice and ISO share by state, EIA-861 2025', url: L.SITE + '/data/expansion-map.json', retrieved: MAP.generated });

  return {
    inputs_used: { state: abbr, path: pathId, case: kase, rounds, your_steps: filePaths },
    result,
    warnings,
    sources: sources.filter((s, i, a) => a.findIndex((x) => x.url === s.url) === i),
  };
}

module.exports = L.endpoint({ usage, post });
