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

  // A file that is not text: NUL bytes, or the replacement character a binary file (a spreadsheet,
  // an image, a zip) turns into when read as UTF-8.
  function looksBinary(text) { return /[\u0000\uFFFD]/.test(String(text)); }

  // Parse a file's text as JSON or CSV by extension, falling back on content.
  function parseText(text, name) {
    if (looksBinary(text)) throw new Error('This file is not text. It looks like a binary file (a spreadsheet such as .xlsx, an image or a zip). Save it as CSV (UTF-8) and load that.');
    const n = String(name || '').toLowerCase();
    const t = String(text).trim();
    if (n.endsWith('.json') || (!n.endsWith('.csv') && (t.startsWith('{') || t.startsWith('[')))) {
      try { return { kind: 'json', data: JSON.parse(t) }; } catch (e) { throw new Error('Not valid JSON: ' + e.message); }
    }
    return { kind: 'csv', data: parseCSV(text) };
  }

  // Number from a cell: accepts "1,200", "$350", "12%". Returns NaN when empty or invalid.
  function num(v) {
    if (typeof v === 'number') return v;
    const t = String(v == null ? '' : v).replace(/[$,%\s]/g, '');
    return t === '' ? NaN : Number(t);
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

  const api = { parseCSV, toCSV, csvCell, looksBinary, parseText, num, failureStatus };

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
      f.text().then((t) => { use(t, f.name, false); input.value = ''; });
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
