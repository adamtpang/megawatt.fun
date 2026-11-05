/* BOM CSV checker. Parses and flags in memory. No upload, no network.
   Columns: part_number, description, qty, supplier, and optional
   alt_suppliers, alt_qualified, lead_time_days, on_hand_days, unit_cost_usd.
   gap_days = lead_time_days - on_hand_days (blank or missing stock counts as 0 days).
   block_score = max(0, gap_days) * (2 if single source, else 1).
   Single source means no qualified second source: one named supplier, or alternates
   listed but not marked qualified. A listed alternate is not a qualified second source
   until it has passed qualification for this part.
   Quantity does not multiply the score: one missing part blocks a build whether you need
   1 or 12. Spend (qty * unit_cost_usd) only breaks ties.
   A missing lead time leaves the score unknown. It is not treated as zero.
   Demo rows are fictional. They are not any real company's suppliers. */
(function (root) {
  'use strict';

  const YD = (typeof module !== 'undefined' && module.exports) ? require('./yourdata.js') : null;
  const COLUMNS = ['part_number', 'description', 'qty', 'supplier', 'alt_suppliers', 'alt_qualified', 'lead_time_days', 'on_hand_days', 'unit_cost_usd'];
  const REQUIRED = ['part_number', 'description', 'qty', 'supplier'];
  // Columns only the supply panel's own-data file (supply-core.js) uses, to recognize it here.
  const PANEL_COLUMNS = ['category', 'lead_time_weeks', 'on_hand_weeks', 'second_source', 'tariff_pct', 'qty_per_unit'];
  const HEADER = {
    part_number: 'part_number', part: 'part_number', sku: 'part_number', pn: 'part_number',
    description: 'description', desc: 'description',
    qty: 'qty', quantity: 'qty',
    supplier: 'supplier', vendor: 'supplier',
    alt_suppliers: 'alt_suppliers', alt_supplier: 'alt_suppliers', alternates: 'alt_suppliers', alternate_suppliers: 'alt_suppliers',
    alt_qualified: 'alt_qualified', alternate_qualified: 'alt_qualified', second_source_qualified: 'alt_qualified', qualified_second_source: 'alt_qualified', qualified: 'alt_qualified',
    lead_time_days: 'lead_time_days', lead_time: 'lead_time_days', lead_days: 'lead_time_days', lead_time_day: 'lead_time_days',
    on_hand_days: 'on_hand_days', days_on_hand: 'on_hand_days', inventory_days: 'on_hand_days', coverage_days: 'on_hand_days', days_of_cover: 'on_hand_days',
    unit_cost_usd: 'unit_cost_usd', unit_cost: 'unit_cost_usd', unit_price: 'unit_cost_usd', cost: 'unit_cost_usd',
  };
  const SINGLE_SOURCE_MULTIPLIER = 2;
  const FORMULA = 'max(0, lead_time_days - on_hand_days) * (2 if single source, else 1); ties broken by spend (qty * unit_cost_usd)';
  const FORMULA_NOTE = 'Gap is lead time minus days of stock on hand: how many days a reorder placed today would leave the build short. Single source (no qualified second source) doubles it. A listed alternate counts only when alt_qualified is yes. Quantity does not raise the score, because one missing part stops a build whether you need 1 or 12. Spend only breaks ties.';
  const DEMO_NOTE = 'Demo data. Made-up part numbers, suppliers, stock and prices. Not a real company, and not Base Power or any real supplier list.';
  const DEMO_CSV = [
    'part_number,description,qty,supplier,alt_suppliers,alt_qualified,lead_time_days,on_hand_days,unit_cost_usd',
    'DEMO-CELL-14,Demo LFP cell module,12,Demo Cell Works,,,45,20,180',
    'DEMO-INV-2,Demo hybrid inverter,1,Demo Power Parts,Demo Inverter Co; Northwind Demo Supply,yes,30,10,1400',
    'DEMO-BMS-7,Demo battery management board,1,Demo Silicon Bench,,,,5,95',
    'DEMO-MOD-3,Demo LTE modem,2,Demo Radio Shop,Demo Airlink Parts,no,21,0,40',
    'DEMO-DISC-1,Demo visible disconnect switch,1,Demo Switch Foundry,,,14,30,120',
    'DEMO-WIRE-9,Demo 4/0 copper whip,4,Demo Wire Co,Demo Cable Co,yes,7,0,25',
    '',
  ].join('\n');

  const SOURCING_LABEL = {
    single: 'Single supplier',
    alt_unqualified: 'Alternate listed, not qualified',
    qualified: 'Qualified second source',
  };

  function cellText(v) { return String(v == null ? '' : v).trim(); }

  function normHeader(h) {
    return cellText(h).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  // yourdata.js: the CSV parser, the text check and the number rule every tool shares.
  function yd() {
    if (YD) return YD;
    if (typeof window !== 'undefined' && window.YourData) return window.YourData;
    throw new Error('CSV parser is not loaded.');
  }
  function parseCSV(text) { return yd().parseCSV(text); }

  function splitAlts(value) {
    const t = cellText(value);
    if (!t) return [];
    const sep = t.includes(';') ? ';' : (t.includes('|') ? '|' : ',');
    return t.split(sep).map((s) => s.trim()).filter(Boolean);
  }

  function supplierKey(name) { return cellText(name).toLowerCase(); }

  function uniqueSuppliers(primary, alts) {
    const seen = new Set();
    const out = [];
    for (const name of [primary].concat(alts)) {
      const k = supplierKey(name);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(cellText(name));
    }
    return out;
  }

  // yes/no cell. Blank is no: a listed alternate is not assumed qualified.
  function parseYesNo(v) {
    const t = cellText(v).toLowerCase();
    if (t === '') return false;
    if (['yes', 'y', 'true', '1', 'qualified'].includes(t)) return true;
    if (['no', 'n', 'false', '0', 'not qualified', 'unqualified'].includes(t)) return false;
    return null;
  }

  // Plain decimal numbers only, after dropping $ and spaces, with a comma only as a thousands
  // separator (1,200, never 3,5): the site's rule, yourdata.js readNumber. No hex (0x10), Infinity or NaN.
  // Upper bounds, so a typo such as 1e308 is a row error instead of a block score of Infinity.
  // Days match /supply's 520-week cap (10 years); cost and quantity match its unit_cost_usd and qty_per_unit caps.
  const MAX = { qty: 10000, lead_time_days: 3650, on_hand_days: 3650, unit_cost_usd: 1000000 };
  const MAX_NOTE = { qty: '', lead_time_days: ' (10 years)', on_hand_days: ' (10 years)', unit_cost_usd: ' dollars' };

  /* One numeric cell. Returns { value } (null when blank and blank is allowed) or { error }
     where error finishes "Row N: <column> ...". */
  function parseCell(v, col, opts) {
    const raw = cellText(v);
    const r = yd().readNumber(raw, /[$\s]/g);
    if (r.value === null) return opts.required ? { error: col + ' is empty. It must be a number greater than 0.' } : { value: null };
    if (r.comma) return { error: col + ' is not a plain decimal number: "' + raw.slice(0, 40) + '". ' + yd().COMMA_HINT };
    if (r.error) return { error: col + ' is not a plain decimal number: "' + raw.slice(0, 40) + '".' };
    const n = r.value;
    if (!Number.isFinite(n) || n > MAX[col]) return { error: col + ' must be at most ' + MAX[col].toLocaleString('en-US') + MAX_NOTE[col] + ', got ' + raw + '.' };
    if (opts.positive ? n <= 0 : n < 0) return { error: col + (opts.positive ? ' must be greater than 0.' : ' must be 0 or more, or blank.') };
    return { value: n };
  }

  // Plain decimal numbers only, for the formula check below (a negative number is data, not a formula).
  const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  /* One CSV cell. A text cell that starts with =, +, -, @, tab or carriage return could run as a
     formula when the file is opened in a spreadsheet (CSV injection), so it gets a leading
     apostrophe, as OWASP recommends. Plain numbers such as -5 are left alone. */
  function csvCell(v) {
    let t = v == null ? '' : String(v);
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(t) && !PLAIN_NUMBER.test(t)) t = "'" + t;
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  function toCSV(rows, columns) {
    const cols = columns || COLUMNS;
    return [cols.join(',')].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))).join('\n') + '\n';
  }

  function fail(errors, warnings) {
    return { errors: yd().onePerColumn(errors), warnings, rows: [], ranked: [], flagged_csv: '', formula: FORMULA, formula_note: FORMULA_NOTE };
  }

  // text: CSV. Returns { errors, warnings, rows, ranked, flagged_csv, formula, formula_note, demo_note }.
  // rows keep file order. ranked is the block order. flagged_csv is single-source rows only
  // (one supplier, or alternates that are not qualified).
  function check(text) {
    const errors = [];
    const warnings = [];
    // A spreadsheet, zip or image, or text that is not UTF-8, gets the same message as every other tool,
    // never "no data rows".
    const problem = yd().textProblem(text);
    if (problem) return fail([problem], warnings);
    let table;
    try { table = parseCSV(text); } catch (e) {
      return fail(['Could not read that CSV: ' + e.message], warnings);
    }
    if (!table.length) {
      return fail(['The CSV has no data rows. Required columns: ' + REQUIRED.join(', ') + '.'], warnings);
    }
    const original = Object.keys(table[0]);
    const mapped = [];
    const seen = new Set();
    // A column written twice is an error on every tool: which value to use is the file's call.
    (table.duplicateHeaders || []).forEach((h) => errors.push('Column "' + h + '" appears more than once. Keep one.'));
    const ignored = [];
    for (const h of original) {
      const key = HEADER[normHeader(h)];
      if (!key) { if (cellText(h)) ignored.push(h); continue; }
      if (seen.has(key)) { errors.push('Columns "' + mapped.find((p) => p[1] === key)[0] + '" and "' + h + '" are the same column (' + key + '). Keep one.'); continue; }
      seen.add(key);
      mapped.push([h, key]);
    }
    const missing = REQUIRED.filter((req) => !seen.has(req));
    // The supply panel's file (part, category, lead_time_weeks) is a different format. Say so,
    // instead of listing every BOM column it lacks.
    const panelCols = original.map(normHeader).filter((h) => PANEL_COLUMNS.includes(h));
    if (missing.length && panelCols.length) {
      return fail(['This looks like the supply panel format (it has ' + panelCols.join(', ') + '). Load that file with "Use your own data" at the top of this page. This checker takes part_number, description, qty and supplier, with lead times in days.'], []);
    }
    if (missing.length) errors.push('Missing column' + (missing.length === 1 ? ' ' : 's ') + missing.join(', ') + '. Required columns: ' + REQUIRED.join(', ') + '.');
    ignored.forEach((h) => warnings.push('Ignored unknown column "' + h + '". Known columns: ' + COLUMNS.join(', ') + '.'));
    if (!seen.has('lead_time_days')) warnings.push('No lead_time_days column. Every score is unknown until lead times are added.');
    if (!seen.has('on_hand_days')) warnings.push('No on_hand_days column. Stock on hand counts as 0 days, so each gap equals the full lead time.');
    if (!seen.has('alt_suppliers')) warnings.push('No alt_suppliers column. A row with a supplier is treated as a single supplier.');
    else if (!seen.has('alt_qualified')) warnings.push('No alt_qualified column. Listed alternates are treated as not qualified, so those rows still count as single source.');
    if (!seen.has('unit_cost_usd')) warnings.push('No unit_cost_usd column. Ties in score are broken by file order, not spend.');
    if (errors.length) return fail(errors, warnings);

    const rows = [];
    const partRows = {};
    table.forEach((raw, i) => {
      const line = i + 2;
      const cell = (key) => {
        const pair = mapped.find((p) => p[1] === key);
        return pair ? raw[pair[0]] : '';
      };
      const part = cellText(cell('part_number'));
      const description = cellText(cell('description'));
      const supplier = cellText(cell('supplier'));
      const qtyRaw = cellText(cell('qty'));
      const alts = splitAlts(cell('alt_suppliers'));
      const rowErrors = [];
      if (!part) rowErrors.push('Row ' + line + ': part_number is empty.');
      if (!description) rowErrors.push('Row ' + line + ': description is empty.');
      if (!supplier) rowErrors.push('Row ' + line + ': supplier is empty.');
      const num = (col, opts) => {
        const r = parseCell(col === 'qty' ? qtyRaw : cell(col), col, opts || {});
        if (r.error) rowErrors.push('Row ' + line + ': ' + r.error);
        return r.error ? null : r.value;
      };
      const qty = num('qty', { required: true, positive: true });
      const lead = num('lead_time_days');
      const onHand = num('on_hand_days');
      const unitCost = num('unit_cost_usd');
      const qualified = parseYesNo(cell('alt_qualified'));
      if (qualified === null) rowErrors.push('Row ' + line + ': alt_qualified must be yes, no or blank.');
      if (rowErrors.length) { errors.push.apply(errors, rowErrors); return; }

      const names = uniqueSuppliers(supplier, alts);
      const single = names.length === 1;
      if (single && qualified) warnings.push('Row ' + line + ': alt_qualified is yes but no other supplier is named, so the row stays single source.');
      const sourcing = single ? 'single' : (qualified ? 'qualified' : 'alt_unqualified');
      const singleSource = sourcing !== 'qualified';
      const cover = onHand == null ? 0 : onHand;
      const gap = lead == null ? null : lead - cover;
      let score = null;
      let display = 'unknown';
      if (gap != null) {
        score = Math.max(0, gap) * (singleSource ? SINGLE_SOURCE_MULTIPLIER : 1);
        display = String(score);
      }
      const spend = unitCost == null ? null : qty * unitCost;
      const row = {
        line,
        part_number: part,
        description,
        qty,
        supplier,
        alt_suppliers: alts.join('; '),
        alt_qualified: single ? '' : (qualified ? 'yes' : 'no'),
        lead_time_days: lead,
        on_hand_days: onHand,
        gap_days: gap,
        unit_cost_usd: unitCost,
        spend_usd: spend,
        suppliers: names,
        single_supplier: single,
        sourcing,
        sourcing_label: SOURCING_LABEL[sourcing],
        single_source: singleSource ? 1 : 0,
        block_score: score,
        block_score_display: display,
        flag: singleSource ? SOURCING_LABEL[sourcing] : '',
      };
      rows.push(row);
      (partRows[part] || (partRows[part] = [])).push(line);
    });
    if (errors.length) return fail(errors, warnings);

    Object.keys(partRows).forEach((part) => {
      if (partRows[part].length > 1) {
        warnings.push('Part ' + part + ' is on rows ' + partRows[part].join(' and ') + '. Rows are not merged, so a second row is not counted as a second supplier.');
      }
    });

    // Positive scores first (highest first), then unknown, then rows covered by stock.
    // Ties: higher spend first, then file order.
    const ranked = rows.slice().sort((a, b) => {
      const group = (r) => (r.block_score == null ? 1 : (r.block_score > 0 ? 0 : 2));
      const ga = group(a), gb = group(b);
      if (ga !== gb) return ga - gb;
      if (ga === 0 && b.block_score !== a.block_score) return b.block_score - a.block_score;
      const sa = a.spend_usd == null ? -1 : a.spend_usd, sb = b.spend_usd == null ? -1 : b.spend_usd;
      if (sa !== sb) return sb - sa;
      return a.line - b.line;
    });
    let rank = 0;
    ranked.forEach((r) => {
      if (r.block_score != null && r.block_score > 0) r.rank = ++rank;
      else r.rank = null;
    });

    const blank = (v) => (v == null ? '' : v);
    const flagged = ranked.filter((r) => r.single_source === 1).map((r) => ({
      part_number: r.part_number,
      description: r.description,
      qty: r.qty,
      supplier: r.supplier,
      alt_suppliers: r.alt_suppliers,
      alt_qualified: r.alt_qualified,
      lead_time_days: blank(r.lead_time_days),
      on_hand_days: blank(r.on_hand_days),
      gap_days: blank(r.gap_days),
      unit_cost_usd: blank(r.unit_cost_usd),
      spend_usd: blank(r.spend_usd),
      sourcing: r.sourcing_label,
      block_score: r.block_score_display,
    }));
    const flagged_csv = toCSV(flagged, ['part_number', 'description', 'qty', 'supplier', 'alt_suppliers', 'alt_qualified', 'lead_time_days', 'on_hand_days', 'gap_days', 'unit_cost_usd', 'spend_usd', 'sourcing', 'block_score']);
    return { errors, warnings, rows, ranked, flagged_csv, formula: FORMULA, formula_note: FORMULA_NOTE, demo_note: null };
  }

  const api = { COLUMNS, REQUIRED, PANEL_COLUMNS, csvCell, MAX, FORMULA, FORMULA_NOTE, SINGLE_SOURCE_MULTIPLIER, SOURCING_LABEL, DEMO_CSV, DEMO_NOTE, check, splitAlts, toCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BomCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
