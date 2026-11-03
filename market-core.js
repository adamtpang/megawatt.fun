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
  // Plain decimal numbers only, after dropping $ , % and spaces: no hex (0x10), Infinity, true/false or lists.
  const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  const LOWER = /\s*\((lower|higher) is better\)\s*$/i;
  const STATE_COLS = ['state', 'abbr', 'state_abbr'];
  const ZONE_COL = 'zone', VALUE_COL = 'usd_per_year';

  // "$1,200" and "12%" are numbers; blank is null; anything else is NaN.
  function toNum(v) {
    if (typeof v === 'number') return v;
    if (v == null) return null;
    if (typeof v !== 'string') return NaN;
    const t = v.replace(/[$,%\s]/g, '');
    return t === '' ? null : DECIMAL.test(t) ? Number(t) : NaN;
  }
  const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
  const stateOf = (v) => (isText(v) ? ABBR.get(String(v).trim().toLowerCase().replace(/\s+/g, ' ')) || null : null);
  // A cell as shown in an error message.
  const shown = (v) => (isText(v) ? String(v) : Array.isArray(v) ? 'a list' : v === null ? 'null' : typeof v === 'object' ? 'an object' : String(v));
  const keyOf = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

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
    return { kind: null, error: 'No "state" column (your metrics) or "zone" column (Texas zone values) found. Columns were: ' + Object.keys(rows[0]).join(', ') + '.' };
  }

  // Rows to a common shape: [{ where, state, cells: { header: raw } }] plus factor list.
  function stateRows(parsed, errors) {
    const d = parsed.data;
    if (parsed.kind === 'json' && !Array.isArray(d)) {
      const declared = Array.isArray(d.factors) ? d.factors : [];
      const factors = [];
      declared.forEach((f, i) => {
        if (!f || typeof f !== 'object' || blank(f.key)) { errors.push('factors[' + i + ']: missing key.'); return; }
        if (!isText(f.key) || (f.label != null && !isText(f.label))) { errors.push('factors[' + i + ']: key and label must be text.'); return; }
        factors.push({ key: keyOf(f.key), label: blank(f.label) ? String(f.key) : String(f.label), higherIsBetter: f.higherIsBetter !== false, header: String(f.key) });
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
    return { factors, rows: rows.map((r, i) => ({ where: 'Row ' + (i + 2), raw: r[stateCol], cells: r })) };
  }

  /* Per-state metrics. Returns { factors: [{ id, key, label, higherIsBetter }], values: { TX: { id: n } },
     errors, warnings }. Factor ids are "yours_" + key so they never collide with public factors. */
  function loadStates(parsed) {
    const errors = [], warnings = [];
    const { factors, rows } = stateRows(parsed, errors);
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
        if (!Number.isFinite(v)) { errors.push(r.where + ', column "' + f.header + '": "' + shown(raw) + '" is not a number.'); return; }
        out[f.id] = v;
      });
      values[abbr] = out;
    });
    const used = factors.filter((f) => f.id && Object.values(values).some((v) => v[f.id] != null));
    factors.filter((f) => f.id && !used.includes(f)).forEach((f) => warnings.push('"' + f.label + '" has no values, so it is left out.'));
    if (!errors.length && !used.length) errors.push('No numeric metric columns with values. Add at least one column of numbers next to the state column.');
    used.forEach((f) => {
      const missing = STATES.map(([a]) => a).filter((a) => !values[a] || values[a][f.id] == null);
      if (missing.length) warnings.push('"' + f.label + '" has no value for ' + missing.length + ' state' + (missing.length === 1 ? '' : 's') + ' (' + missing.join(', ') + '). They are scored on the other factors, the same as missing public data.');
    });
    return { kind: 'states', factors: used.map(({ id, key, label, higherIsBetter }) => ({ id, key, label, higherIsBetter })), values, errors, warnings };
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
      if (!Number.isFinite(v)) { errors.push(r.where + ', column "usd_per_year": "' + shown(r.value) + '" is not a number.'); return; }
      if (v < 0) { errors.push(r.where + ': ' + id + ' cannot be negative.'); return; }
      zones[id] = v;
    });
    if (!errors.length && !Object.keys(zones).length) errors.push('No zone values found.');
    const kept = zoneIds.filter((id) => zones[id] == null);
    if (!errors.length && kept.length) warnings.push(kept.length + ' zone' + (kept.length === 1 ? '' : 's') + ' not in your file keep the public value (' + kept.join(', ') + ').');
    return { kind: 'zones', zones, errors, warnings };
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

  const api = { STATES, stateOf, detect, load, loadStates, loadZones, applyZones, rankValue, STATE_TEMPLATE_COLUMNS, stateTemplateRows, zoneTemplateRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MarketCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
