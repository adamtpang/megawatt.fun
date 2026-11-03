/* BOM CSV checker. Parses and flags in memory. No upload, no network.
   Columns: part_number, description, qty, supplier, and optional
   alt_suppliers, lead_time_days.
   block_score = single_source * lead_time_days * qty.
   single_source is 1 when the row names one supplier, otherwise 0.
   A missing lead time leaves the score unknown. It is not treated as zero.
   Demo rows are fictional. They are not any real company's suppliers. */
(function (root) {
  'use strict';

  const YD = (typeof module !== 'undefined' && module.exports) ? require('./yourdata.js') : null;
  const COLUMNS = ['part_number', 'description', 'qty', 'supplier', 'alt_suppliers', 'lead_time_days'];
  const REQUIRED = ['part_number', 'description', 'qty', 'supplier'];
  const HEADER = {
    part_number: 'part_number', part: 'part_number', sku: 'part_number', pn: 'part_number',
    description: 'description', desc: 'description',
    qty: 'qty', quantity: 'qty',
    supplier: 'supplier', vendor: 'supplier',
    alt_suppliers: 'alt_suppliers', alt_supplier: 'alt_suppliers', alternates: 'alt_suppliers', alternate_suppliers: 'alt_suppliers',
    lead_time_days: 'lead_time_days', lead_time: 'lead_time_days', lead_days: 'lead_time_days', lead_time_day: 'lead_time_days',
  };
  const FORMULA = 'single_source * lead_time_days * qty';
  const DEMO_NOTE = 'Demo data. Made-up part numbers and suppliers. Not a real company, and not Base Power or any real supplier list.';
  const DEMO_CSV = [
    'part_number,description,qty,supplier,alt_suppliers,lead_time_days',
    'DEMO-CELL-14,Demo LFP cell module,12,Demo Cell Works,,45',
    'DEMO-INV-2,Demo hybrid inverter,1,Demo Power Parts,Demo Inverter Co; Northwind Demo Supply,30',
    'DEMO-BMS-7,Demo battery management board,1,Demo Silicon Bench,,',
    'DEMO-MOD-3,Demo LTE modem,2,Demo Radio Shop,Demo Airlink Parts,21',
    'DEMO-DISC-1,Demo visible disconnect switch,1,Demo Switch Foundry,,14',
    'DEMO-WIRE-9,Demo 4/0 copper whip,4,Demo Wire Co,Demo Cable Co,7',
    '',
  ].join('\n');

  function cellText(v) { return String(v == null ? '' : v).trim(); }

  function normHeader(h) {
    return cellText(h).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function parseCSV(text) {
    if (YD) return YD.parseCSV(text);
    if (typeof window !== 'undefined' && window.YourData) return window.YourData.parseCSV(text);
    throw new Error('CSV parser is not loaded.');
  }

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

  function csvCell(v) {
    const t = v == null ? '' : String(v);
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  function toCSV(rows, columns) {
    const cols = columns || COLUMNS;
    return [cols.join(',')].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))).join('\n') + '\n';
  }

  // text: CSV. Returns { errors, warnings, rows, ranked, flagged_csv, formula, demo_note }.
  // rows keep file order. ranked is the block order. flagged_csv is single-supplier rows only.
  function check(text) {
    const errors = [];
    const warnings = [];
    let table;
    try { table = parseCSV(text); } catch (e) {
      return { errors: ['Could not read that CSV: ' + e.message], warnings, rows: [], ranked: [], flagged_csv: '', formula: FORMULA };
    }
    if (!table.length) {
      return { errors: ['The CSV has no data rows. Required columns: ' + REQUIRED.join(', ') + '.'], warnings, rows: [], ranked: [], flagged_csv: '', formula: FORMULA };
    }
    const original = Object.keys(table[0]);
    const mapped = [];
    const seen = new Set();
    for (const h of original) {
      const key = HEADER[normHeader(h)];
      if (!key) { warnings.push('Ignored column "' + h + '".'); continue; }
      if (seen.has(key)) { errors.push('Duplicate column "' + h + '" maps to ' + key + '.'); continue; }
      seen.add(key);
      mapped.push([h, key]);
    }
    for (const req of REQUIRED) {
      if (!seen.has(req)) errors.push('Missing column ' + req + '. Required columns: ' + REQUIRED.join(', ') + '.');
    }
    if (!seen.has('lead_time_days')) warnings.push('No lead_time_days column. Single-supplier scores that need a lead time are unknown.');
    if (!seen.has('alt_suppliers')) warnings.push('No alt_suppliers column. A row with a supplier is treated as a single supplier.');
    if (errors.length) return { errors, warnings, rows: [], ranked: [], flagged_csv: '', formula: FORMULA };

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
      const leadRaw = cellText(cell('lead_time_days'));
      const alts = splitAlts(cell('alt_suppliers'));
      const rowErrors = [];
      if (!part) rowErrors.push('Row ' + line + ': part_number is empty.');
      if (!description) rowErrors.push('Row ' + line + ': description is empty.');
      if (!supplier) rowErrors.push('Row ' + line + ': supplier is empty.');
      const qty = Number(qtyRaw.replace(/,/g, ''));
      if (qtyRaw === '' || !Number.isFinite(qty) || qty <= 0) rowErrors.push('Row ' + line + ': qty must be a number greater than 0.');
      let lead = null;
      if (leadRaw !== '') {
        const n = Number(leadRaw.replace(/,/g, ''));
        if (!Number.isFinite(n) || n < 0) rowErrors.push('Row ' + line + ': lead_time_days must be a number that is 0 or more, or blank.');
        else lead = n;
      }
      if (rowErrors.length) { errors.push.apply(errors, rowErrors); return; }
      const names = uniqueSuppliers(supplier, alts);
      const single = names.length === 1;
      let score = null;
      let score_display = 'unknown';
      if (!single) { score = 0; score_display = '0'; }
      else if (lead == null) { score = null; score_display = 'unknown'; }
      else { score = lead * qty; score_display = String(score); }
      const row = {
        line,
        part_number: part,
        description,
        qty,
        supplier,
        alt_suppliers: alts.join('; '),
        lead_time_days: lead,
        suppliers: names,
        single_supplier: single,
        single_source: single ? 1 : 0,
        block_score: score,
        block_score_display: score_display,
        flag: single ? 'Single supplier' : '',
      };
      rows.push(row);
      (partRows[part] || (partRows[part] = [])).push(line);
    });
    if (errors.length) return { errors, warnings, rows: [], ranked: [], flagged_csv: '', formula: FORMULA };

    Object.keys(partRows).forEach((part) => {
      if (partRows[part].length > 1) {
        warnings.push('Part ' + part + ' is on rows ' + partRows[part].join(' and ') + '. Rows are not merged, so a second row is not counted as a second supplier.');
      }
    });

    const ranked = rows.slice().sort((a, b) => {
      const group = (r) => (r.block_score == null ? 1 : (r.block_score > 0 ? 0 : 2));
      const ga = group(a), gb = group(b);
      if (ga !== gb) return ga - gb;
      if (ga === 0 && b.block_score !== a.block_score) return b.block_score - a.block_score;
      return a.line - b.line;
    });
    let rank = 0;
    ranked.forEach((r) => {
      if (r.block_score != null && r.block_score > 0) r.rank = ++rank;
      else r.rank = null;
    });

    const flagged = ranked.filter((r) => r.single_supplier).map((r) => ({
      part_number: r.part_number,
      description: r.description,
      qty: r.qty,
      supplier: r.supplier,
      alt_suppliers: r.alt_suppliers,
      lead_time_days: r.lead_time_days == null ? '' : r.lead_time_days,
      single_supplier: 'yes',
      block_score: r.block_score_display,
    }));
    const flagged_csv = toCSV(flagged, ['part_number', 'description', 'qty', 'supplier', 'alt_suppliers', 'lead_time_days', 'single_supplier', 'block_score']);
    return { errors, warnings, rows, ranked, flagged_csv, formula: FORMULA, demo_note: null };
  }

  const api = { COLUMNS, REQUIRED, FORMULA, DEMO_CSV, DEMO_NOTE, check, splitAlts, toCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BomCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
