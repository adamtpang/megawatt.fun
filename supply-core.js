/* Your bill of materials: pure validation and shortage math, no DOM.
   Used by supply.js in the browser (window.SupplyCore) and tests/supply-yourdata.test.cjs in Node.
   Nothing here knows any company's real suppliers; the file brings them. */
(function (root) {
  'use strict';

  // Category ids match the part ids in data/supply.json, plus "other".
  const CATEGORIES = ['power_electronics', 'bms_memory', 'cells', 'cellular', 'grid_equipment', 'labor', 'metals'];
  const COLUMNS = ['part', 'category', 'supplier', 'country', 'lead_time_weeks', 'on_hand_weeks', 'second_source', 'tariff_pct', 'unit_cost_usd', 'qty_per_unit', 'note'];
  const REQUIRED = ['part', 'category', 'lead_time_weeks'];
  const NUMBERS = ['lead_time_weeks', 'on_hand_weeks', 'tariff_pct', 'unit_cost_usd', 'qty_per_unit'];
  const TARIFF_MAX = 500;
  const TARIFF_FLAG = 25;
  const YES = ['yes', 'y', 'true', '1'];
  const NO = ['no', 'n', 'false', '0'];

  const blank = (v) => String(v == null ? '' : v).trim() === '';
  const text = (v) => String(v == null ? '' : v).trim();
  const toNum = (v) => typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/[$,%\s]/g, ''));

  // parsed is { kind: 'csv', data: [row] } or { kind: 'json', data: { parts: [row] } | [row] }.
  // Returns { rows, errors, warnings }. rows are normalized: numbers as numbers (null when blank),
  // second_source as true, false or null.
  function validate(parsed, categoryIds) {
    const cats = (categoryIds || CATEGORIES).concat('other');
    const errors = [], warnings = [], rows = [];
    const data = parsed && parsed.data;
    const isCsv = parsed && parsed.kind === 'csv';
    let list;
    if (Array.isArray(data)) list = data;
    else if (data && typeof data === 'object' && Array.isArray(data.parts)) list = data.parts;
    else list = [];
    if (!list.length) {
      errors.push(isCsv ? 'No rows found. The file needs a header row with part, category and lead_time_weeks, then one row per part.' : 'No parts found. The file needs { "parts": [ ... ] } with one object per part.');
      return { rows, errors, warnings };
    }
    const seen = new Map();
    list.forEach((r, i) => {
      const where = isCsv ? 'Row ' + (i + 2) + ': ' : 'Part ' + (i + 1) + ': ';
      if (!r || typeof r !== 'object') { errors.push(where + 'not an object.'); return; }
      let bad = false;
      for (const k of REQUIRED) if (blank(r[k])) { errors.push(where + 'missing ' + k + '.'); bad = true; }
      const out = { line: where.slice(0, -2) };
      for (const k of ['part', 'supplier', 'country', 'note']) out[k] = text(r[k]);
      out.category = text(r.category).toLowerCase();
      if (out.category && !cats.includes(out.category)) {
        errors.push(where + 'unknown category "' + text(r.category) + '". Use one of ' + cats.join(', ') + '.');
        bad = true;
      }
      for (const k of NUMBERS) {
        if (blank(r[k])) { out[k] = null; continue; }
        const v = toNum(r[k]);
        if (!Number.isFinite(v)) { errors.push(where + k + ' is not a number: "' + text(r[k]) + '".'); bad = true; continue; }
        if (v < 0) { errors.push(where + k + ' cannot be negative.'); bad = true; continue; }
        if (k === 'tariff_pct' && v > TARIFF_MAX) { errors.push(where + 'tariff_pct must be at most ' + TARIFF_MAX + '.'); bad = true; continue; }
        out[k] = v;
      }
      const ss = text(r.second_source).toLowerCase();
      if (typeof r.second_source === 'boolean') out.second_source = r.second_source;
      else if (!ss) out.second_source = null;
      else if (YES.includes(ss)) out.second_source = true;
      else if (NO.includes(ss)) out.second_source = false;
      else { errors.push(where + 'second_source must be yes or no, not "' + text(r.second_source) + '".'); bad = true; }
      if (out.part) {
        const key = out.part.toLowerCase();
        if (seen.has(key)) warnings.push(where + 'duplicate part name "' + out.part + '" (also ' + seen.get(key) + '). Both rows are kept.');
        else seen.set(key, out.line);
      }
      if (!bad) rows.push(out);
    });
    return { rows, errors, warnings };
  }

  // Rows sorted by gap (lead time minus weeks of cover, biggest first), with flags and totals.
  function analyze(rows) {
    const out = rows.map((r) => {
      const cover = r.on_hand_weeks == null ? 0 : r.on_hand_weeks;
      const gap = r.lead_time_weeks - cover;
      const flags = [];
      if (gap > 0) flags.push('Will run short');
      if (r.second_source === false) flags.push('Single source');
      if (r.tariff_pct != null && r.tariff_pct >= TARIFF_FLAG) flags.push('Tariff 25%+');
      const hasCost = r.unit_cost_usd != null && r.qty_per_unit != null && r.tariff_pct != null;
      const tariffCost = hasCost ? r.unit_cost_usd * r.qty_per_unit * r.tariff_pct / 100 : null;
      return Object.assign({}, r, { cover, gap, flags, tariffCost });
    }).sort((a, b) => b.gap - a.gap || a.part.localeCompare(b.part));
    const priced = out.filter((r) => r.tariffCost != null);
    return {
      rows: out,
      totals: {
        parts: out.length,
        atRisk: out.filter((r) => r.gap > 0).length,
        singleSource: out.filter((r) => r.second_source === false).length,
        tariffPerBattery: priced.reduce((s, r) => s + r.tariffCost, 0),
        tariffParts: priced.length,
        longest: out.length ? { part: out[0].part, gap: out[0].gap } : null,
      },
    };
  }

  // One plainly fictional row per category, for the downloadable template.
  function templateRows(categoryIds) {
    const cats = (categoryIds || CATEGORIES).concat('other');
    const sample = {
      power_electronics: ['Example inverter module', 'Germany', 30, 12, 'no', 25, 900, 1],
      bms_memory: ['Example BMS controller board', 'Taiwan', 20, 26, 'yes', 0, 120, 1],
      cells: ['Example LFP cell', 'China', 16, 8, 'yes', 55, 40, 12],
      cellular: ['Example LTE modem', 'Vietnam', 12, 4, 'no', 10, 35, 1],
      grid_equipment: ['Example meter collar', 'Mexico', 40, 10, 'no', 0, 150, 1],
      labor: ['Example install crew day', 'United States', 6, 3, 'yes', 0, 800, 1],
      metals: ['Example steel enclosure', 'United States', 10, 14, 'yes', 25, 300, 1],
      other: ['Example wiring harness', 'Mexico', 8, 2, 'no', 0, 60, 2],
    };
    return cats.map((c, i) => {
      const s = sample[c] || ['Example part ' + (i + 1), 'United States', 10, 5, 'yes', 0, 100, 1];
      return {
        part: s[0], category: c, supplier: 'Example Supplier ' + String.fromCharCode(65 + i), country: s[1],
        lead_time_weeks: s[2], on_hand_weeks: s[3], second_source: s[4], tariff_pct: s[5], unit_cost_usd: s[6], qty_per_unit: s[7],
        note: 'example row, replace',
      };
    });
  }

  const api = { CATEGORIES, COLUMNS, REQUIRED, validate, analyze, templateRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SupplyCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
