/* Bring your own data: one shared panel for every tool.
   A tool calls YourData.mount({...}) with a template, a parser and an apply step.
   Files are read in the browser and never uploaded. The last file is kept in
   this browser's localStorage (when available) so a reload keeps it.
   Works in Node (module.exports, CSV helpers only) and the browser (window.YourData). */
(function (root) {
  'use strict';

  // RFC 4180 style CSV: quoted fields, doubled quotes, commas and newlines inside quotes.
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', q = false;
    const s = String(text).replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((x) => x.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((x) => x.trim() !== '')) rows.push(row);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim());
    const out = rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] == null ? '' : r[i]).trim()])));
    // A header written twice keeps only its last value in each row object. Record the names
    // (not enumerable, so the rows look the same) so a tool can warn instead of losing data quietly.
    const dup = head.filter((h, i) => h !== '' && head.indexOf(h) !== i).filter((h, i, a) => a.indexOf(h) === i);
    Object.defineProperty(out, 'duplicateHeaders', { value: dup, enumerable: false });
    // The header row as written, in file order (Object.keys puts number-like names such as "9" first).
    Object.defineProperty(out, 'headers', { value: head, enumerable: false });
    return out;
  }

  // Plain decimal numbers only: a negative number is data, not a formula.
  const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  /* One CSV cell, safe to open in a spreadsheet. Text that starts with =, +, -, @, tab or carriage
     return could run as a formula there (CSV injection), so it gets a leading apostrophe, as OWASP
     recommends. Numbers, and text that is a plain number such as "-5", are left alone. Every CSV the
     site writes (templates and downloads) goes through this. */
  function csvCell(v) {
    let t = v == null ? '' : String(v);
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(t) && !PLAIN_NUMBER.test(t)) t = "'" + t;
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  function toCSV(rows, columns) {
    const cols = columns || Object.keys(rows[0] || {});
    return [cols.map(csvCell).join(',')].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))).join('\n') + '\n';
  }

  /* ---------- Reading a file: binary, not UTF-8, UTF-16 ---------- */

  const BINARY_MSG = 'This file is not text. It looks like a binary file (a spreadsheet such as .xlsx, an image or a zip). Save it as CSV (UTF-8) and load that.';
  const NOT_UTF8_MSG = 'This file is text but not UTF-8. It looks like a Windows or Excel CSV saved as cp1252 or Latin-1, where an accented letter such as \u00E9 comes out garbled. In Excel use Save As, choose "CSV UTF-8 (Comma delimited)", and load that file.';
  const UTF16_MSG = 'This file is UTF-16 text without a byte order mark, so it cannot be read safely. In Excel use Save As, choose "CSV UTF-8 (Comma delimited)", and load that file.';

  // A file that is not text: NUL bytes, or the replacement character a binary file (a spreadsheet,
  // an image, a zip) turns into when read as UTF-8. textProblem() says which.
  function looksBinary(text) { return /[\u0000\uFFFD]/.test(String(text)); }

  /* What is wrong with text that was already decoded as UTF-8 (by a browser or a server), or ''
     when nothing is. A zip or spreadsheet signature, or NUL bytes, mean binary; NUL in every other
     character means UTF-16; replacement characters alone, among mostly readable text, mean a file
     saved in another encoding such as cp1252, not a binary file. */
  function textProblem(text) {
    const t = String(text == null ? '' : text);
    if (!/[\u0000\uFFFD]/.test(t)) return '';
    if (/^(PK\u0003\u0004|%PDF|GIF8)/.test(t)) return BINARY_MSG;
    const head = t.slice(0, 4000);
    if (/\u0000/.test(head)) {
      const start = head.slice(0, 64);
      let even = 0, odd = 0;
      for (let i = 0; i < start.length; i++) if (start[i] === '\u0000') { if (i % 2) odd++; else even++; }
      const half = Math.floor(start.length / 2);
      return half >= 4 && ((odd >= half * 0.9 && even === 0) || (even >= half * 0.9 && odd === 0)) ? UTF16_MSG : BINARY_MSG;
    }
    // Binary data is full of control characters; a cp1252 file only has a few bad letters.
    const control = (head.match(/[\u0001-\u0008\u000E-\u001F\u007F]/g) || []).length;
    return control / head.length > 0.05 ? BINARY_MSG : NOT_UTF8_MSG;
  }

  // Signatures of common binary files: zip (xlsx, docx), old Excel (xls), PDF, PNG, JPEG, GIF, gzip.
  const MAGIC = [[0x50, 0x4B, 0x03, 0x04], [0xD0, 0xCF, 0x11, 0xE0], [0x25, 0x50, 0x44, 0x46], [0x89, 0x50, 0x4E, 0x47], [0xFF, 0xD8, 0xFF], [0x47, 0x49, 0x46, 0x38], [0x1F, 0x8B]];

  /* A file's bytes (Uint8Array, ArrayBuffer or Node Buffer) to text. Returns { text } or { error }.
     UTF-8, with or without a byte order mark, is read as is; UTF-16 with a byte order mark is
     decoded; binary files, UTF-16 without a mark, and text in another encoding (cp1252, Latin-1)
     are errors that say how to save the file as CSV UTF-8. The pages and the API both use this. */
  function decodeBytes(input) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
    const starts = (sig) => sig.every((x, i) => b[i] === x);
    if (MAGIC.some(starts)) return { error: BINARY_MSG };
    let text;
    if (starts([0xFF, 0xFE]) || starts([0xFE, 0xFF])) {
      try { text = new TextDecoder(b[0] === 0xFF ? 'utf-16le' : 'utf-16be', { fatal: true }).decode(b.subarray(2)); } catch (e) { return { error: BINARY_MSG }; }
      return looksBinary(text) ? { error: BINARY_MSG } : { text: text.replace(/^\uFEFF/, '') };
    }
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) {
      // Not valid UTF-8. Decode loosely only to tell a binary file from text in another encoding.
      return { error: textProblem(new TextDecoder('utf-8').decode(b)) || NOT_UTF8_MSG };
    }
    text = text.replace(/^\uFEFF/, '');
    const p = textProblem(text);
    return p ? { error: p } : { text };
  }

  // Parse a file's text as JSON or CSV by extension, falling back on content.
  function parseText(text, name) {
    const problem = textProblem(text);
    if (problem) throw new Error(problem);
    const n = String(name || '').toLowerCase();
    const t = String(text).replace(/^\uFEFF/, '').trim();
    if (n.endsWith('.json') || (!n.endsWith('.csv') && (t.startsWith('{') || t.startsWith('[')))) {
      try { return { kind: 'json', data: JSON.parse(t) }; } catch (e) { throw new Error('Not valid JSON: ' + e.message); }
    }
    return { kind: 'csv', data: parseCSV(text) };
  }

  /* ---------- Numbers in cells: one rule for every tool, on the pages and in the API ---------- */

  // Plain decimal numbers only: 12, -3.5, .5, 1e3. No hex (0x10), Infinity or NaN.
  const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  // A comma is valid only as a thousands separator: 1,200 and 1,200.5, never 3,5 or 2,80.
  const THOUSANDS = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
  const COMMA_HINT = 'A comma is only a thousands separator (1,200). Use a dot for decimals: 3.5, not 3,5.';

  /* One number cell. v is a number or text; strip is a regex of characters to drop first
     (default $, % and spaces). Returns { value } (null when blank), or { value: NaN, error }.
     A comma that is not a thousands separator sets comma: true and is never read as 3,5 = 35. */
  function readNumber(v, strip) {
    if (typeof v === 'number') return { value: v };
    if (typeof v !== 'string') return { value: NaN, error: 'Not a number.' };
    let t = v.replace(strip || /[$%\s]/g, '');
    if (t === '') return { value: null };
    if (t.indexOf(',') >= 0) {
      if (!THOUSANDS.test(t)) return { value: NaN, error: COMMA_HINT, comma: true };
      t = t.replace(/,/g, '');
    }
    return DECIMAL.test(t) ? { value: Number(t) } : { value: NaN, error: 'Not a plain decimal number.' };
  }
  // ' ' + COMMA_HINT when v is text with a comma that is not a thousands separator, else ''.
  // Tools add it to their own "is not a number" message.
  function commaHint(v, strip) { return readNumber(v, strip).comma ? ' ' + COMMA_HINT : ''; }

  // Number from a cell: accepts "1,200", "$350", "12%". NaN when empty or invalid, "3,5" included.
  function num(v) {
    const r = readNumber(v);
    return r.value == null ? NaN : r.value;
  }

  /* ---------- Text typed into a box ---------- */

  // Fullwidth and other compatibility forms (\uFF17\uFF18\uFF17 is 787) read as plain text, the
  // same way on the pages and in the API.
  function normalizeText(v) {
    const t = String(v == null ? '' : v);
    return typeof t.normalize === 'function' ? t.normalize('NFKC') : t;
  }

  /* ---------- Column written twice ---------- */

  /* One message per column. A file with "high,high,High" gets "Column "high" appears more than once"
     and "Columns "high" and "High" are the same column" from two checks; keep the first message
     that names a column and drop later ones about the same column (names compared in any case,
     with spaces and hyphens read as underscores). Other messages pass through untouched. */
  function onePerColumn(messages) {
    const key = (h) => String(h).trim().toLowerCase().replace(/[\s-]+/g, '_');
    const seen = new Set();
    return (messages || []).filter((m) => {
      if (!/^Columns? "/.test(m)) return true;
      const names = [];
      String(m).replace(/"([^"]*)"/g, (_, n) => { names.push(key(n)); return _; });
      if (names.some((n) => seen.has(n))) return false;
      names.forEach((n) => seen.add(n));
      return true;
    });
  }

  /* ---------- Long lists ---------- */

  // The first n messages, then one "And N more like these." line, so a file with 15,000 bad
  // rows never comes back as a 3 MB error list.
  function capList(list, n) {
    const max = n || 50;
    if (!Array.isArray(list) || list.length <= max) return list;
    return list.slice(0, max).concat('And ' + (list.length - max).toLocaleString('en-US') + ' more like these.');
  }

  /* What the status line says when a file fails. active is the name of the file still in use
     from before (null when the public data is showing), so the page never looks as if the
     bad file was ignored and nothing else is loaded. Returns { title, items, note }. */
  function failureStatus(name, errors, active, title) {
    return {
      title: title || (name + ' was not loaded. Fix these and load it again:'),
      items: errors || [],
      note: active ? 'Still using ' + active + ', the file loaded before.' : 'Still using the public data.',
    };
  }

  const api = {
    parseCSV, toCSV, csvCell, looksBinary, textProblem, decodeBytes, parseText, readNumber, commaHint, num,
    normalizeText, capList, onePerColumn, failureStatus, COMMA_HINT, BINARY_MSG, NOT_UTF8_MSG, UTF16_MSG,
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
  };

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv' }));
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) n.append(k);
    return n;
  }

  /* opts: {
       el: host element, tool: 'finance', what: 'your costs and revenue',
       templates: [{ name: 'finance-inputs.csv', text: () => string, label }],
       docs: '/docs/plug-and-play#finance',
       load(parsed, fileName) -> { errors: [], warnings: [], summary: 'string', apply: fn },
       reset() } */
  function mount(opts) {
    const key = 'yourdata:' + opts.tool;
    const status = h('div', { class: 'yd-status', role: 'status', 'aria-live': 'polite' });
    const input = h('input', { type: 'file', accept: '.csv,.json,text/csv,application/json', id: 'yd-file-' + opts.tool, class: 'yd-file' });
    const label = h('label', { for: input.id, class: 'yd-btn yd-primary' }, 'Load your file');
    const reset = h('button', { type: 'button', class: 'yd-btn', hidden: '' }, 'Back to public data');
    const tpl = (opts.templates || []).map((t) => {
      const b = h('button', { type: 'button', class: 'yd-btn' }, t.label || ('Template: ' + t.name));
      b.addEventListener('click', () => download(t.name, t.text(), t.name.endsWith('.json') ? 'application/json' : 'text/csv'));
      return b;
    });
    const badge = h('span', { class: 'yd-badge', hidden: '' }, 'Your data');
    const box = h('details', { class: 'yd' },
      h('summary', {}, h('span', { text: 'Use your own data' }), badge),
      h('div', { class: 'yd-body' },
        h('p', { class: 'yd-lede' }, 'Swap the public numbers for ' + opts.what + '. Download a template, fill it in, load it. The file is read in this browser and never uploaded.'),
        h('div', { class: 'yd-actions' }, ...tpl, input, label, reset),
        status,
        opts.docs ? h('p', { class: 'yd-small' }, h('a', { href: opts.docs }, 'File format and field list')) : null));
    opts.el.append(box);

    // Name of the file whose data is on the page now, or null for the public data.
    let active = null;

    function show(kind, title, items, note) {
      status.textContent = '';
      status.className = 'yd-status is-' + kind;
      status.append(h('p', {}, h('strong', { text: title })));
      if (items && items.length) status.append(h('ul', {}, ...items.slice(0, 12).map((x) => h('li', { text: x }))));
      if (items && items.length > 12) status.append(h('p', { text: 'And ' + (items.length - 12) + ' more.' }));
      if (note) status.append(h('p', { class: 'yd-still', text: note }));
    }
    function fail(name, errors, title) {
      const f = failureStatus(name, errors, active, title);
      show('error', f.title, f.items, f.note);
      return false;
    }

    function use(text, name, fromStore) {
      let parsed;
      try { parsed = parseText(text, name); } catch (e) { return fail(name, [e.message], 'Could not read ' + name); }
      let res;
      try { res = opts.load(parsed, name); } catch (e) { return fail(name, [e.message], 'Could not use ' + name); }
      if (res.errors && res.errors.length) return fail(name, res.errors);
      res.apply();
      active = name;
      badge.hidden = false; reset.hidden = false;
      const saved = fromStore || store.set(key, { name, text });
      show('ok', (fromStore ? 'Using your saved file ' : 'Using ') + name + '. ' + (res.summary || ''),
        (res.warnings || []).concat(saved ? ['Kept in this browser only. Use "Back to public data" to clear it.'] : []));
      return true;
    }

    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) return;
      if (f.size > 5e6) { fail(f.name, [], f.name + ' is larger than 5 MB.'); return; }
      // Bytes, not f.text(): a cp1252 or UTF-16 file gets its own message instead of "binary".
      f.arrayBuffer().then((buf) => {
        input.value = '';
        const d = decodeBytes(new Uint8Array(buf));
        if (d.error) { fail(f.name, [d.error], 'Could not read ' + f.name); return; }
        use(d.text, f.name, false);
      });
    });
    reset.addEventListener('click', () => {
      store.del(key); opts.reset();
      active = null;
      badge.hidden = true; reset.hidden = true;
      show('ok', 'Back to the public data.', []);
    });

    const saved = store.get(key);
    if (saved && saved.text) { if (!use(saved.text, saved.name, true)) store.del(key); }
    return { use: (text, name) => use(text, name, false) };
  }

  root.YourData = Object.assign({ mount, download }, api);
})(typeof window !== 'undefined' ? window : this);
