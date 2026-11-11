/* PJM value of one home battery, by utility zone. Pure functions, shared by pjm.html, api/v1/pjm.js and tests.
   Three value streams, the ones Base names in its Pennsylvania PUC comments (P-2026-3065185, Nov 2026):
   1. Energy: a fixed daily clock at the zone's real-time price (backtested offline into data/pjm-value.json).
      Today a battery behind a home meter can only serve that home's load, so energy is capped at the home
      load (energyByKw). Full 20 kW exports (energyExportUsdPerYear) need PJM's DER aggregator model (Feb 2028).
   2. Capacity: lowering the home's peak load contribution (PLC tag) x the PJM capacity price.
   3. Transmission: lowering the home's network service peak load (NSPL tag) x the zone's NITS rate, and 0
      where transmission is a nonbypassable utility charge (zone.transmission.bypassable === false).
   Tags are counted only where the utility's documents confirm the home's own meter sets them (zone.tags.status).
   Tag value is only reachable where the utility sets the tag from the home's own interval meter and the
   load-serving entity (a retail supplier, or a utility partner) is the one billed for it. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PjmCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const DEFAULTS = Object.freeze({
    tagKw: 3,               // home load the battery covers in the evening and at peaks, kW (assumption)
    capacityUsdPerMwDay: 333.44, // PJM 2027/2028 BRA: the year summer 2026 tags are paid in
    capacityScale: 1,       // zonal scaling factor x forecast pool requirement, folded into one multiplier
    hitRate: 1,             // share of tag-setting peak hours the battery actually covers
    includeEnergy: true, includeCapacity: true, includeTransmission: true,
    allowExports: false,    // true: full 20 kW exports at the zone price (PJM DER aggregation, from Feb 2028)
    countUnconfirmed: false, // true: also count tags where the utility's tag method is not confirmed
  });
  const LIMITS = { tagKw: [0, 8], capacityUsdPerMwDay: [0, 2000], capacityScale: [0, 2], hitRate: [0, 1] };

  function inputs(raw) {
    const out = { ...DEFAULTS }, errors = [];
    for (const [k, v] of Object.entries(raw || {})) {
      if (!(k in DEFAULTS)) continue;
      if (typeof DEFAULTS[k] === 'boolean') { out[k] = v === true || v === 'true' || v === 1 || v === '1'; continue; }
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      const [lo, hi] = LIMITS[k];
      if (String(v).trim() === '' || !Number.isFinite(n) || n < lo || n > hi) errors.push(`${k} must be a number from ${lo} to ${hi}.`);
      else out[k] = n;
    }
    return { inputs: out, errors };
  }

  // Dollars a year per kW of tag reduction.
  const capacityPerKwYear = (p) => (p.capacityUsdPerMwDay * 365 * p.capacityScale) / 1000;
  const transmissionPerKwYear = (zone) => (zone.transmission && zone.transmission.bypassable === false ? 0 : (zone.nitsUsdPerMwYear || 0) / 1000);

  // Energy for a home load of kw: the backtest at the nearest 0.5 kW step (built offline), 0 at 0 kW.
  function energyFor(zone, kw, allowExports) {
    if (allowExports) return zone.energyExportUsdPerYear;
    if (!(kw > 0)) return 0;
    const steps = Object.keys(zone.energyByKw || {}).map(Number).sort((a, b) => a - b);
    if (!steps.length) return 0;
    const k = steps.reduce((best, s) => (Math.abs(s - kw) < Math.abs(best - kw) ? s : best), steps[0]);
    return zone.energyByKw[k];
  }

  // 'interval' | 'partly' | 'profile' | 'unknown'. Zones without research data count as confirmed,
  // so a caller's own zone list (and older data) behaves as before.
  // A company's own per-zone value (zone.yours, from applyYours) wins over the public research.
  const tagStatus = (zone) => (zone.yours && zone.yours.tagRules) || (zone.tags && zone.tags.status) || 'interval';

  function valueZone(zone, raw) {
    const { inputs: g } = inputs(raw);
    // Per-zone numbers from a loaded file replace the page-wide ones for that zone only.
    const y = zone.yours || {};
    const p = { ...g, tagKw: y.homeKw ?? g.tagKw, hitRate: y.hitRate ?? g.hitRate, capacityScale: y.capacityScale ?? g.capacityScale };
    const kw = p.tagKw * p.hitRate;
    const energy = !p.includeEnergy ? 0 : y.energyUsdPerYear != null ? y.energyUsdPerYear : energyFor(zone, p.tagKw, p.allowExports);
    const capFull = p.includeCapacity ? kw * capacityPerKwYear(p) : 0;
    const txFull = p.includeTransmission ? kw * transmissionPerKwYear(zone) : 0;
    // Tags count only where the utility sets them from the home's own interval meter.
    const status = tagStatus(zone);
    const counted = status === 'interval' || status === 'partly' || (status === 'unknown' && p.countUnconfirmed);
    const possible = status !== 'profile';
    const capacity = counted ? capFull : 0, transmission = counted ? txFull : 0;
    const r = (x) => Math.round(x * 100) / 100;
    return {
      id: zone.id, energy: r(energy), capacity: r(capacity), transmission: r(transmission), total: r(energy + capacity + transmission),
      tagStatus: status,
      yours: Object.keys(y),
      // What the tags would add if an unconfirmed method turns out to be interval-based.
      potential: r(!counted && possible ? capFull + txFull : 0),
    };
  }

  function rank(zones, raw) {
    return zones.map((z) => ({ zone: z, value: valueZone(z, raw) })).sort((a, b) => b.value.total - a.value.total || a.zone.id.localeCompare(b.zone.id));
  }

  // ---------- a company's own numbers, one row per zone ----------
  // Input is what YourData.parseText returns: { kind: 'csv', data: [rows] } or { kind: 'json', data }.
  // Every column but zone is optional; a blank cell keeps the public number for that zone.
  const YD = () => (typeof module !== 'undefined' && module.exports ? require('./yourdata.js') : (typeof window !== 'undefined' ? window : globalThis).YourData);
  const COLUMNS = ['zone', 'home_kw', 'peak_coverage_pct', 'tag_rules', 'energy_usd_per_year', 'capacity_scale'];
  const FIELD = {
    home_kw: { key: 'homeKw', lo: 0, hi: 8, what: 'kW' },
    peak_coverage_pct: { key: 'hitRate', lo: 0, hi: 100, what: '%', scale: 0.01 },
    energy_usd_per_year: { key: 'energyUsdPerYear', lo: 0, hi: 100000, what: '$ a year' },
    capacity_scale: { key: 'capacityScale', lo: 0, hi: 2, what: 'x' },
  };
  const RULES = ['interval', 'profile', 'unknown'];
  const MAX_ROWS = 200;
  const clip = (v) => { const t = String(v); return t.length > 60 ? t.slice(0, 60) + '...' : t; };
  const blank = (v) => v == null || String(v).trim() === '';

  function loadYours(parsed, zoneIds) {
    const errors = [], warnings = [], yours = {};
    const d = parsed && parsed.data;
    let rows = null;
    if (parsed && parsed.kind === 'csv') rows = d;
    else if (Array.isArray(d)) rows = d;
    else if (d && typeof d === 'object' && Array.isArray(d.zones)) rows = d.zones;
    if (!Array.isArray(rows)) return { yours, errors: ['Send one row per zone: a CSV with a "zone" column, or JSON { "zones": [ { "zone": "COMED", "home_kw": 3 } ] }.'], warnings };
    if (!rows.length) return { yours, errors: ['The file has no rows.'], warnings };
    if (rows.length > MAX_ROWS) return { yours, errors: ['The file has ' + rows.length + ' rows. The limit is ' + MAX_ROWS + ' (there are ' + zoneIds.length + ' zones).'], warnings };
    if (!rows.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return { yours, errors: ['Each zone must be a row of named fields, for example { "zone": "COMED", "home_kw": 3 }.'], warnings };
    // Column names match in any case; unknown columns are named and ignored.
    const head = new Map();
    rows.forEach((r) => Object.keys(r).forEach((k) => { const n = k.trim().toLowerCase(); if (!head.has(n)) head.set(n, new Set()); head.get(n).add(k); }));
    ((d && d.duplicateHeaders) || []).forEach((h) => errors.push('Column "' + clip(h) + '" appears more than once. Keep one.'));
    for (const [n, ks] of head) {
      if (!n) continue;
      if (!COLUMNS.includes(n)) warnings.push('Ignored unknown column "' + clip([...ks][0]) + '". Known columns: ' + COLUMNS.join(', ') + '.');
      else if (ks.size > 1) errors.push('Columns "' + [...ks].join('" and "') + '" are the same column (names match in any case). Keep one.');
    }
    if (!head.has('zone')) errors.push('The file needs a "zone" column with PJM zone codes such as COMED or PPL.');
    if (errors.length) return { yours, errors, warnings };
    const get = (r, n) => { const k = [...(head.get(n) || [])][0]; return k === undefined ? undefined : r[k]; };
    const first = new Map();
    rows.forEach((r, i) => {
      const where = parsed.kind === 'csv' ? 'Row ' + (i + 2) : 'zones[' + i + ']';
      const zr = get(r, 'zone');
      const id = typeof zr === 'string' ? zr.trim().toUpperCase() : '';
      if (!id) { errors.push(where + ': missing zone.'); return; }
      if (!zoneIds.includes(id)) { errors.push(where + ': unknown zone "' + clip(zr) + '". Use one of ' + zoneIds.join(', ') + '.'); return; }
      if (first.has(id)) { errors.push(where + ': ' + id + ' appears again (first at ' + first.get(id) + ').'); return; }
      first.set(id, where);
      const out = {}, before = errors.length;
      for (const [col, f] of Object.entries(FIELD)) {
        const v = get(r, col);
        if (blank(v)) continue;
        const rd = YD().readNumber(v), n = rd.value;
        if (n == null) continue;
        if (!Number.isFinite(n)) { errors.push(where + ', column "' + col + '": "' + clip(v) + '" is not a number.' + (rd.comma ? ' ' + YD().COMMA_HINT : '')); continue; }
        if (n < f.lo || n > f.hi) { errors.push(where + ', column "' + col + '": ' + n + ' is outside ' + f.lo + ' to ' + f.hi + ' ' + f.what + '.'); continue; }
        out[f.key] = f.scale ? Math.round(n * f.scale * 1e6) / 1e6 : n;
      }
      const tr = get(r, 'tag_rules');
      if (!blank(tr)) {
        const t = String(tr).trim().toLowerCase();
        if (!RULES.includes(t)) errors.push(where + ', column "tag_rules": "' + clip(tr) + '" is not one of ' + RULES.join(', ') + '.');
        else out.tagRules = t;
      }
      if (Object.keys(out).length) yours[id] = out;
      else if (errors.length === before) warnings.push(where + ': ' + id + ' has no values, so its public numbers stay.');
    });
    if (!errors.length && !Object.keys(yours).length) errors.push('No zone has a value. Fill in at least one cell next to a zone.');
    return { yours: errors.length ? {} : yours, errors, warnings };
  }

  // Zones with the company's values attached. Does not change the zones passed in.
  function applyYours(zones, yours) {
    return zones.map((z) => (yours && Object.prototype.hasOwnProperty.call(yours, z.id) ? { ...z, yours: { ...yours[z.id] } } : z));
  }

  // Template: every zone, with the public tag rule filled in so it can be corrected.
  function templateRows(zones) {
    return zones.map((z) => ({ zone: z.id, home_kw: '', peak_coverage_pct: '', tag_rules: (z.tags && (z.tags.status === 'partly' ? 'interval' : z.tags.status)) || '', energy_usd_per_year: '', capacity_scale: '' }));
  }

  return { DEFAULTS, LIMITS, inputs, capacityPerKwYear, transmissionPerKwYear, energyFor, tagStatus, valueZone, rank, COLUMNS, RULES, MAX_ROWS, loadYours, applyYours, templateRows };
});
