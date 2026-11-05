/* Market map: a company's own per-state metrics and Texas zone values. Pure, no DOM.
   Used by market.js in the browser (window.MarketCore) and tests/market-yourdata.test.cjs in Node.
   Input is what YourData.parseText returns: { kind: 'csv', data: [row objects] } or { kind: 'json', data }.
   Nothing here mutates the public data passed in. */
(function (root) {
  'use strict';

  const STATES = [
    ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
    ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'],
    ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
    ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'],
    ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'],
    ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
    ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
    ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
    ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
    ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ];
  // Maps, not plain objects: a state written as "constructor" or "__proto__" must not find Object.prototype.
  const ABBR = new Map(STATES.flatMap(([a, n]) => [[a.toLowerCase(), a], [n.toLowerCase(), a]]).concat([['washington dc', 'DC'], ['washington, dc', 'DC'], ['d.c.', 'DC']]));
  const NAME = new Map(STATES);
  const hasOwn = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const isText = (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
  // The site's number rule (yourdata.js readNumber), looked up when used: in the browser yourdata.js loads after this file.
  const YD = () => (typeof module !== 'undefined' && module.exports ? require('./yourdata.js') : root.YourData);
  const LOWER = /\s*\((lower|higher) is better\)\s*$/i;
  const STATE_COLS = ['state', 'abbr', 'state_abbr'];
  const ZONE_COL = 'zone', VALUE_COL = 'usd_per_year';
  // A metric needs values for at least this many states before it counts in the score.
  // Percentile ranks step by 1 / (n - 1): with one state it gets full marks, with two the
  // lower one gets 0 and scores below states with no data at all. Five gives steps of a
  // quarter, the same quarters the map legend colors by.
  const MIN_STATES = 5;
  // Most one battery can earn in a year, the same cap /finance puts on arbPerYear (FinanceCore.ARB_MAX).
  const ZONE_MAX = 100000;
  // Most metric columns one file may add. Each one is a factor in every state's answer, so 2,000 columns
  // would make a 13 MB response.
  const MAX_METRICS = 50;

  // "$1,200" and "12%" are numbers; blank is null; anything else is NaN, "3,5" included (a comma is
  // only a thousands separator).
  function toNum(v) {
    if (typeof v === 'number') return v;
    if (v == null) return null;
    if (typeof v !== 'string') return NaN;
    return YD().readNumber(v).value;
  }
  const hint = (v) => (typeof v === 'string' ? YD().commaHint(v) : '');
  const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
  const stateOf = (v) => (isText(v) ? ABBR.get(String(v).trim().toLowerCase().replace(/\s+/g, ' ')) || null : null);
  // A cell as shown in an error message.
  const shown = (v) => (isText(v) ? String(v) : Array.isArray(v) ? 'a list' : v === null ? 'null' : typeof v === 'object' ? 'an object' : String(v));
  const keyOf = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  // Text echoed in a message, cut so a huge cell never comes back whole.
  const clip = (v, n) => { const t = String(v == null ? '' : v); const m = n || 40; return t.length > m ? t.slice(0, m) + '...' : t; };
  /* higherIsBetter from a JSON factor: left out means true; true or false; or the text "true" or
     "false" in any case. Anything else ("no", 0, null) returns null, an error: a silent "higher is
     better" would reverse the ranking the file meant. */
  function higherIsBetterOf(f) {
    if (!Object.prototype.hasOwnProperty.call(f, 'higherIsBetter')) return true;
    const v = f.higherIsBetter;
    if (v === true || v === false) return v;
    if (typeof v === 'string') { const t = v.trim().toLowerCase(); if (t === 'true') return true; if (t === 'false') return false; }
    return null;
  }

  // Factor from a CSV header: "install_cost_usd (lower is better)" -> lower is better.
  function factorFromHeader(h) {
    const m = String(h).match(LOWER);
    const label = String(h).replace(LOWER, '').trim();
    return { key: keyOf(label), label, higherIsBetter: !(m && m[1].toLowerCase() === 'lower'), header: h };
  }

  // Which kind of rows a file holds, by its columns (CSV) or top-level keys (JSON).
  function detect(parsed) {
    const d = parsed && parsed.data;
    if (parsed && parsed.kind === 'json' && d && !Array.isArray(d) && typeof d === 'object') {
      if (d.states && d.zones) return { kind: null, error: 'The file has both "states" and "zones". Load one kind per file.' };
      if (d.states) return { kind: 'states' };
      if (d.zones) return { kind: 'zones' };
      return { kind: null, error: 'JSON needs a "states" object (your metrics) or a "zones" list (Texas zone values).' };
    }
    const rows = Array.isArray(d) ? d : [];
    if (!rows.length) return { kind: null, error: 'No rows found. Download a template to see the columns.' };
    const cols = Object.keys(rows[0]).map((c) => c.trim().toLowerCase());
    const hasState = cols.some((c) => STATE_COLS.includes(c)), hasZone = cols.includes(ZONE_COL);
    if (hasState && hasZone) return { kind: null, error: 'The file has both a state column and a zone column. Load one kind per file.' };
    if (hasState) return { kind: 'states' };
    if (hasZone) return { kind: 'zones' };
    return { kind: null, error: 'No "state" column (your metrics) or "zone" column (Texas zone values) found. Columns were: ' + Object.keys(rows[0]).slice(0, 20).map((c) => clip(c)).join(', ') + (Object.keys(rows[0]).length > 20 ? ', ...' : '') + '.' };
  }

  // Rows to a common shape: [{ where, state, cells: { header: raw } }] plus factor list.
  function stateRows(parsed, errors) {
    const d = parsed.data;
    if (parsed.kind === 'json' && !Array.isArray(d)) {
      // factors is optional, but when sent it must be a list: "x" or an object is an error, never ignored.
      if (d.factors != null && !Array.isArray(d.factors)) errors.push('factors must be a list like [{ "key": "install_cost_usd", "higherIsBetter": false }], got ' + shown(d.factors) + '.');
      const declared = Array.isArray(d.factors) ? d.factors : [];
      const factors = [];
      declared.forEach((f, i) => {
        if (!f || typeof f !== 'object' || blank(f.key)) { errors.push('factors[' + i + ']: missing key.'); return; }
        if (!isText(f.key) || (f.label != null && !isText(f.label))) { errors.push('factors[' + i + ']: key and label must be text.'); return; }
        const hib = higherIsBetterOf(f);
        if (hib === null) { errors.push('factors[' + i + ']: higherIsBetter must be true or false (or the text "true" or "false"), got ' + (typeof f.higherIsBetter === 'string' ? '"' + clip(f.higherIsBetter) + '"' : shown(f.higherIsBetter)) + '. Leave it out for higher is better.'); return; }
        factors.push({ key: keyOf(f.key), label: blank(f.label) ? String(f.key) : String(f.label), higherIsBetter: hib, header: String(f.key) });
      });
      const states = d.states && typeof d.states === 'object' && !Array.isArray(d.states) ? d.states : {};
      const seen = new Set(factors.map((f) => f.header));
      Object.values(states).forEach((v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach((k) => { if (!seen.has(k)) { seen.add(k); factors.push(factorFromHeader(k)); } });
      });
      return { factors, rows: Object.entries(states).map(([s, v]) => ({ where: 'states.' + s, raw: s, cells: v && typeof v === 'object' && !Array.isArray(v) ? v : {}, notObject: !(v && typeof v === 'object' && !Array.isArray(v)) })) };
    }
    const rows = d;
    const head = Object.keys(rows[0] || {});
    const stateCol = head.find((h) => STATE_COLS.includes(h.trim().toLowerCase()));
    const factors = head.filter((h) => h !== stateCol && h.trim() !== '').map(factorFromHeader);
    // parseCSV keeps one value per header name, so a repeated column would lose its other values.
    (rows.duplicateHeaders || []).forEach((h) => errors.push('Column "' + h + '" appears more than once. Keep one.'));
    return { factors, rows: rows.map((r, i) => ({ where: 'Row ' + (i + 2), raw: r[stateCol], cells: r })) };
  }

  /* Per-state metrics. Returns { factors: [{ id, key, label, higherIsBetter }], values: { TX: { id: n } },
     errors, warnings }. Factor ids are "yours_" + key so they never collide with public factors. */
  function loadStates(parsed) {
    const errors = [], warnings = [];
    const { factors, rows } = stateRows(parsed, errors);
    if (factors.length > MAX_METRICS) {
      return { kind: 'states', factors: [], values: {}, errors: ['The file has ' + factors.length.toLocaleString('en-US') + ' metric columns. The limit is ' + MAX_METRICS + '; keep the metrics you want ranked.'], warnings };
    }
    const ids = new Set();
    factors.forEach((f) => {
      if (!f.key) { errors.push('A metric column has no name.'); return; }
      f.id = 'yours_' + f.key;
      if (ids.has(f.id)) errors.push('Two metric columns are both named "' + f.label + '".');
      ids.add(f.id);
    });
    const values = {}, firstRow = new Map();
    rows.forEach((r) => {
      const abbr = stateOf(r.raw);
      if (blank(r.raw)) { errors.push(r.where + ': missing state.'); return; }
      if (!abbr) { errors.push(r.where + ': unknown state "' + shown(r.raw) + '". Use a two-letter code such as TX, or the full name.'); return; }
      if (firstRow.has(abbr)) { errors.push(r.where + ': ' + NAME.get(abbr) + ' appears again (first at ' + firstRow.get(abbr) + ').'); return; }
      firstRow.set(abbr, r.where);
      if (r.notObject) { errors.push(r.where + ': must be an object of { metric: number }.'); return; }
      const out = {};
      factors.forEach((f) => {
        const raw = hasOwn(r.cells, f.header) ? r.cells[f.header] : null; // own keys only
        if (blank(raw)) return;
        const v = toNum(raw);
        if (!Number.isFinite(v)) { errors.push(r.where + ', column "' + clip(f.header) + '": "' + clip(shown(raw)) + '" is not a number.' + hint(raw)); return; }
        out[f.id] = v;
      });
      values[abbr] = out;
    });
    const count = (f) => Object.values(values).filter((v) => v[f.id] != null).length;
    const withValues = factors.filter((f) => f.id && count(f) > 0);
    factors.filter((f) => f.id && !withValues.includes(f)).forEach((f) => warnings.push('"' + f.label + '" has no values, so it is left out.'));
    if (!errors.length && !withValues.length) errors.push('No numeric metric columns with values. Add at least one column of numbers next to the state column.');
    // Too few states to rank: left out of the score, and its values dropped, so it cannot move any state.
    const used = withValues.filter((f) => count(f) >= MIN_STATES);
    withValues.filter((f) => !used.includes(f)).forEach((f) => {
      const n = count(f);
      warnings.push('"' + f.label + '" has values for only ' + n + ' state' + (n === 1 ? '' : 's') + ', so it is left out of the score. A metric needs at least ' + MIN_STATES + ' states: a rank among fewer is not meaningful (one state would get full marks).');
      Object.values(values).forEach((v) => { delete v[f.id]; });
    });
    if (!errors.length && withValues.length && !used.length) errors.push('No metric has values for at least ' + MIN_STATES + ' states, so nothing can be ranked. Fill in at least ' + MIN_STATES + ' states for a metric.');
    used.forEach((f) => {
      const missing = STATES.map(([a]) => a).filter((a) => !values[a] || values[a][f.id] == null);
      if (missing.length) warnings.push('"' + f.label + '" has no value for ' + missing.length + ' state' + (missing.length === 1 ? '' : 's') + ' (' + missing.join(', ') + '). They are scored on the other factors, the same as missing public data.');
    });
    return { kind: 'states', factors: used.map(({ id, key, label, higherIsBetter }) => ({ id, key, label, higherIsBetter })), values, errors: YD().onePerColumn(errors), warnings };
  }

  /* Texas zone values. Returns { zones: { LZ_X: n }, errors, warnings }. */
  function loadZones(parsed, zoneIds) {
    const errors = [], warnings = [];
    const d = parsed.data;
    let rows;
    if (parsed.kind === 'json' && !Array.isArray(d)) {
      const z = d.zones;
      rows = Array.isArray(z) ? z.map((r, i) => ({ where: 'zones[' + i + ']', zone: r && (r.zone ?? r.id), value: r && (r.usd_per_year ?? r.usdPerYear) }))
        : z && typeof z === 'object' ? Object.entries(z).map(([k, v]) => ({ where: 'zones.' + k, zone: k, value: v })) : [];
    } else {
      const head = Object.keys(d[0] || {});
      const zc = head.find((h) => h.trim().toLowerCase() === ZONE_COL), vc = head.find((h) => h.trim().toLowerCase() === VALUE_COL);
      if (!vc) errors.push('Zone files need a "usd_per_year" column next to "zone".');
      (d.duplicateHeaders || []).forEach((h) => errors.push('Column "' + h + '" appears more than once. Keep one.'));
      const named = (c) => head.filter((h) => h.trim().toLowerCase() === c);
      [ZONE_COL, VALUE_COL].forEach((c) => { if (named(c).length > 1) errors.push('Columns "' + named(c).join('" and "') + '" are the same column (names match in any case). Keep one.'); });
      head.filter((h) => h.trim() !== '' && ![ZONE_COL, VALUE_COL].includes(h.trim().toLowerCase()))
        .forEach((h) => warnings.push('Ignored unknown column "' + clip(h) + '". Known columns: zone, usd_per_year.'));
      rows = d.map((r, i) => ({ where: 'Row ' + (i + 2), zone: r[zc], value: vc ? r[vc] : '' }));
    }
    const zones = {}, first = new Map();
    if (!errors.length) rows.forEach((r) => {
      const id = isText(r.zone) ? String(r.zone).trim().toUpperCase() : '';
      if (!id) { errors.push(r.where + ': missing zone.'); return; }
      if (!zoneIds.includes(id)) { errors.push(r.where + ': unknown zone "' + r.zone + '". Use one of ' + zoneIds.join(', ') + '.'); return; }
      if (first.has(id)) { errors.push(r.where + ': ' + id + ' appears again (first at ' + first.get(id) + ').'); return; }
      first.set(id, r.where);
      if (blank(r.value)) { warnings.push(r.where + ': ' + id + ' is blank, so the public value stays.'); return; }
      const v = toNum(r.value);
      if (!Number.isFinite(v)) { errors.push(r.where + ', column "usd_per_year": "' + clip(shown(r.value)) + '" is not a number.' + hint(r.value)); return; }
      if (v < 0) { errors.push(r.where + ': ' + id + ' cannot be negative.'); return; }
      if (v > ZONE_MAX) { errors.push(r.where + ': ' + id + ' must be at most ' + ZONE_MAX.toLocaleString('en-US') + ' $ per battery per year (the same cap as arbPerYear on /finance), got ' + shown(r.value) + '.'); return; }
      zones[id] = v;
    });
    if (!errors.length && !Object.keys(zones).length) errors.push('No zone values found.');
    const kept = zoneIds.filter((id) => zones[id] == null);
    if (!errors.length && kept.length) warnings.push(kept.length + ' zone' + (kept.length === 1 ? '' : 's') + ' not in your file keep the public value (' + kept.join(', ') + ').');
    return { kind: 'zones', zones, errors: YD().onePerColumn(errors), warnings };
  }

  // One entry point: detect the kind of rows, then validate.
  function load(parsed, zoneIds) {
    const k = detect(parsed);
    if (!k.kind) return { kind: null, errors: [k.error], warnings: [] };
    return k.kind === 'states' ? loadStates(parsed) : loadZones(parsed, zoneIds || []);
  }

  // A copy of the public zone-value file with your numbers swapped in, best first. Each zone gets yours: true|false.
  function applyZones(publicZ, zones) {
    const z = JSON.parse(JSON.stringify(publicZ));
    z.zones.forEach((x) => {
      x.yours = zones[x.id] != null;
      if (x.yours) { x.publicUsdPerYear = x.usdPerYear; x.usdPerYear = zones[x.id]; }
    });
    z.zones.sort((a, b) => b.usdPerYear - a.usdPerYear);
    return z;
  }

  // Value to rank: lower-is-better metrics are flipped so a higher rank is always better.
  const rankValue = (f, v) => (v == null || v !== v ? null : f.higherIsBetter === false ? -v : v);

  const STATE_TEMPLATE_COLUMNS = ['state', 'install_cost_usd (lower is better)', 'pipeline_homes'];
  function stateTemplateRows() {
    return STATES.map(([a]) => ({ state: a, 'install_cost_usd (lower is better)': '', pipeline_homes: '' }));
  }
  function zoneTemplateRows(publicZ) {
    return publicZ.zones.map((x) => ({ zone: x.id, usd_per_year: x.usdPerYear }));
  }

  const api = { higherIsBetterOf, STATES, MIN_STATES, ZONE_MAX, MAX_METRICS, stateOf, detect, load, loadStates, loadZones, applyZones, rankValue, STATE_TEMPLATE_COLUMNS, stateTemplateRows, zoneTemplateRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MarketCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
