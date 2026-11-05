/* Your bill of materials: pure validation and shortage math, no DOM.
   Used by supply.js in the browser (window.SupplyCore) and tests/supply-yourdata.test.cjs in Node.
   Nothing here knows any company's real suppliers; the file brings them. */
(function (root) {
  'use strict';

  // Category ids match the part ids in data/supply.json, plus "other".
  const CATEGORIES = ['power_electronics', 'bms_memory', 'cells', 'cellular', 'grid_equipment', 'labor', 'metals'];
  const COLUMNS = ['part', 'category', 'supplier', 'country', 'lead_time_weeks', 'on_hand_weeks', 'second_source', 'tariff_pct', 'unit_cost_usd', 'qty_per_unit', 'note'];
  const REQUIRED = ['part', 'category', 'lead_time_weeks'];
  // Columns only the BOM CSV checker (bom-check-core.js) uses, to recognize its file here.
  const BOM_COLUMNS = ['part_number', 'description', 'qty', 'quantity', 'lead_time_days', 'on_hand_days', 'alt_suppliers', 'alt_qualified'];
  const NUMBERS = ['lead_time_weeks', 'on_hand_weeks', 'tariff_pct', 'unit_cost_usd', 'qty_per_unit'];
  const TEXTS = ['part', 'category', 'supplier', 'country', 'note'];
  const TARIFF_MAX = 500;
  // Upper bounds, so a typo like 1e308 is a row error instead of "Infinity wk" or "$∞".
  const MAX = { lead_time_weeks: 520, on_hand_weeks: 520, tariff_pct: TARIFF_MAX, unit_cost_usd: 1000000, qty_per_unit: 10000 };
  const MAX_NOTE = { lead_time_weeks: ' (10 years)', on_hand_weeks: ' (10 years)', tariff_pct: '', unit_cost_usd: ' dollars', qty_per_unit: ' per battery' };
  const TARIFF_FLAG = 25;
  // Most parts one file or request may hold. A real bill of materials has hundreds; 29,000 rows is a mistake
  // and would make a 20 MB answer.
  const MAX_PARTS = 2000;
  // The site's number rule (yourdata.js readNumber), looked up when used: in the browser yourdata.js loads after this file.
  const YD = () => (typeof module !== 'undefined' && module.exports ? require('./yourdata.js') : root.YourData);
  const YES = ['yes', 'y', 'true', '1'];
  const NO = ['no', 'n', 'false', '0'];

  // Text cells are strings, or numbers written as text (a part number). Objects, lists and true/false are not.
  const isText = (v) => v == null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
  const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'object' ? 'an object' : typeof v);
  const blank = (v) => v == null || (isText(v) && String(v).trim() === '');
  const text = (v) => (v != null && isText(v) ? String(v).trim() : '');
  // Plain decimal numbers only, after dropping $, % and spaces; a comma only as a thousands separator
  // (1,200, never 3,5). No hex (0x10), Infinity, true/false or lists.
  const toNum = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return NaN;
    const r = YD().readNumber(v);
    return r.value == null ? NaN : r.value;
  };
  // Header names match case-insensitively, trimmed, with spaces or hyphens read as underscores.
  const colKey = (h) => String(h).trim().toLowerCase().replace(/[\s-]+/g, '_');

  /* One row with its keys mapped onto COLUMNS. Unknown and repeated columns are noted in
     `unknown` and `dupes` (Maps keyed by the name as written), so each is warned once. */
  function normalizeRow(r, unknown, dupes) {
    const out = Object.create(null), from = Object.create(null);
    for (const k of Object.keys(r)) {
      const c = colKey(k);
      if (!COLUMNS.includes(c)) { if (k.trim() !== '' && !unknown.has(k)) unknown.set(k, true); continue; }
      if (c in from) { if (blank(out[c])) out[c] = r[k]; dupes.set(from[c] + '|' + k, [from[c], k]); continue; }
      from[c] = k;
      out[c] = r[k];
    }
    return out;
  }

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
    if (list.length > MAX_PARTS) {
      errors.push((isCsv ? 'The file has ' : 'The list has ') + list.length.toLocaleString('en-US') + ' parts. The limit is ' + MAX_PARTS.toLocaleString('en-US') + ' per ' + (isCsv ? 'file' : 'request') + '; split it.');
      return { rows, errors, warnings };
    }
    const seen = new Map(), unknown = new Map(), dupes = new Map();
    // The BOM CSV checker on /supply takes a different file (part_number, description, qty,
    // supplier, *_days). Say so when that file lands here, instead of listing every missing column.
    const first = list.find((r) => r && typeof r === 'object' && !Array.isArray(r));
    if (first) {
      const cols = Object.keys(first).map(colKey);
      const mine = cols.some((c) => c === 'category' || c === 'lead_time_weeks');
      const bom = cols.filter((c) => BOM_COLUMNS.includes(c));
      if (!mine && bom.length) {
        errors.push('This looks like a BOM checker file (it has ' + bom.join(', ') + '). This panel takes part, category and lead_time_weeks, with lead times in weeks. Use the BOM CSV checker on /supply for a part_number, description, qty, supplier file, or download this panel\'s template.');
        return { rows, errors, warnings };
      }
    }
    list.forEach((raw, i) => {
      const where = isCsv ? 'Row ' + (i + 2) + ': ' : 'Part ' + (i + 1) + ': ';
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(where + 'not an object.'); return; }
      const r = normalizeRow(raw, unknown, dupes);
      let bad = false;
      for (const k of TEXTS) {
        if (!isText(r[k])) { errors.push(where + k + ' must be text, got ' + kindOf(r[k]) + '.'); bad = true; }
      }
      for (const k of REQUIRED) if (isText(r[k]) && blank(r[k])) { errors.push(where + 'missing ' + k + '.'); bad = true; }
      const out = { line: where.slice(0, -2) };
      for (const k of ['part', 'supplier', 'country', 'note']) out[k] = text(r[k]);
      out.category = text(r.category).toLowerCase();
      if (out.category && !cats.includes(out.category)) {
        errors.push(where + 'unknown category "' + text(r.category) + '". Use one of ' + cats.join(', ') + '.');
        bad = true;
      }
      for (const k of NUMBERS) {
        if (blank(r[k])) { out[k] = null; continue; }
        if (typeof r[k] !== 'number' && typeof r[k] !== 'string') { errors.push(where + k + ' must be a number, got ' + kindOf(r[k]) + '.'); bad = true; continue; }
        const v = toNum(r[k]);
        if (!Number.isFinite(v)) { errors.push(where + k + ' is not a number: "' + text(r[k]).slice(0, 40) + '".' + YD().commaHint(r[k])); bad = true; continue; }
        if (v < 0) { errors.push(where + k + ' cannot be negative.'); bad = true; continue; }
        if (v > MAX[k]) { errors.push(where + k + ' must be at most ' + MAX[k] + MAX_NOTE[k] + ', got ' + text(r[k]) + '.'); bad = true; continue; }
        out[k] = v;
      }
      const ss = text(r.second_source).toLowerCase();
      if (typeof r.second_source === 'boolean') out.second_source = r.second_source;
      else if (!isText(r.second_source)) { errors.push(where + 'second_source must be yes or no, got ' + kindOf(r.second_source) + '.'); bad = true; }
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
    // A column written twice is an error on every tool: which value to use is the file's call, not ours.
    const dupErr = [];
    if (isCsv && Array.isArray(data)) (data.duplicateHeaders || []).forEach((h) => dupErr.push('Column "' + h + '" appears more than once. Keep one.'));
    for (const [a, b] of dupes.values()) dupErr.push('Columns "' + a + '" and "' + b + '" are the same column (names match in any case). Keep one.');
    const head = [];
    for (const k of unknown.keys()) head.push('Ignored unknown column "' + k + '". Known columns: ' + COLUMNS.join(', ') + '.');
    return { rows: dupErr.length ? [] : rows, errors: YD().onePerColumn(dupErr).concat(errors), warnings: head.concat(warnings) };
  }

  // Rows sorted by gap (lead time minus weeks of cover, biggest first), with flags and totals.
  function analyze(rows) {
    const out = rows.map((r) => {
      const cover = r.on_hand_weeks == null ? 0 : r.on_hand_weeks;
      // Rounded to a billionth of a week, so float noise (0.3 - 0.1 - 0.2) is no gap at all.
      const gap = Math.round((r.lead_time_weeks - cover) * 1e9) / 1e9 || 0;
      const flags = [];
      if (gap > 0) flags.push('Will run short');
      if (r.second_source === false) flags.push('Single source');
      if (r.tariff_pct != null && r.tariff_pct >= TARIFF_FLAG) flags.push('Tariff 25%+');
      const hasCost = r.unit_cost_usd != null && r.qty_per_unit != null && r.tariff_pct != null;
      const tariffCost = hasCost ? r.unit_cost_usd * r.qty_per_unit * r.tariff_pct / 100 : null;
      return Object.assign({}, r, { cover, gap, flags, tariffCost, digits: digitsFor(r.lead_time_weeks, cover, gap) });
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
        longest: out.length ? { part: out[0].part, gap: out[0].gap, digits: out[0].digits } : null,
      },
    };
  }

  const roundTo = (n, d) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
  /* Decimal places that keep a row's lead time and cover apart: 1, or more (up to 6) when one
     decimal would show a real gap as "3 wk / 3 wk" (lead 3, cover 2.99999). */
  function digitsFor(lead, cover, gap) {
    let d = 1;
    while (d < 6 && gap !== 0 && roundTo(lead, d) === roundTo(cover, d)) d++;
    return d;
  }

  // Weeks as shown on the page and in the API, to `digits` decimal places (default 1). A value that is
  // not zero never reads as 0: anything above 0 and under 0.1 weeks is "under 0.1 wk" (0.05 too, never a
  // rounded-up "0.1 wk"), so a tiny gap matches its "Will run short" flag.
  function weeksText(n, digits) {
    if (n == null) return '';
    const d = digits || 1, step = Math.pow(10, -d);
    const stepText = step.toFixed(d);
    if (n !== 0 && Math.abs(n) < step) return n < 0 ? 'under ' + stepText + ' wk spare' : 'under ' + stepText + ' wk'; // only a gap goes below 0
    return roundTo(n, d) + ' wk';
  }
  const money = (n) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const COST_COLS = ['unit_cost_usd', 'qty_per_unit', 'tariff_pct'];
  const andList = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

  /* The summary under "Your bill of materials", in plain text, the same on the page and in the API.
     Returns { head, rest }: head is the "N of M parts will run short." sentence. When no part has a
     tariff cost, it names only the columns rows are actually missing. */
  function summary(res) {
    const t = res.totals;
    const head = t.atRisk + ' of ' + t.parts + ' part' + (t.parts === 1 ? '' : 's') + ' will run short.';
    let rest = t.singleSource ? ' ' + t.singleSource + ' single sourced.' : '';
    if (t.longest && t.longest.gap > 0) rest += ' Longest gap: ' + t.longest.part + ', ' + weeksText(t.longest.gap, t.longest.digits) + '.';
    if (t.tariffParts) rest += ' Tariff cost per battery: ' + money(t.tariffPerBattery) + ' across ' + t.tariffParts + ' part' + (t.tariffParts === 1 ? '' : 's') + ' with cost, quantity and tariff.';
    else {
      const missing = COST_COLS.filter((k) => res.rows.some((r) => r[k] == null));
      rest += ' Add ' + andList(missing) + ' to see tariff cost per battery' + (missing.length < COST_COLS.length ? ' (a part needs all three: ' + andList(COST_COLS) + ').' : '.');
    }
    return { head, rest };
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

  const api = { CATEGORIES, COLUMNS, REQUIRED, BOM_COLUMNS, MAX_PARTS, validate, analyze, templateRows, weeksText, digitsFor, summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SupplyCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
