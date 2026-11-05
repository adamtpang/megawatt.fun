// Shared helpers for the /api/v1 tool endpoints. Vercel does not route files that
// start with an underscore, so this is not an endpoint itself.
//
// Rules every endpoint follows: CORS open to any origin, OPTIONS answers 204,
// only GET and POST, request bodies up to 1 MB sent as application/json or text/csv
// (any other Content-Type is a 415), and request bodies are never
// logged or stored. Nothing in this file writes anywhere.
'use strict';

const YD = require('../yourdata.js');

const MAX_BYTES = 1024 * 1024;
const SITE = 'https://megawatt.fun';

class HttpError extends Error {
  constructor(status, errors) {
    super(errors[0]);
    this.status = status;
    this.errors = errors;
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function send(res, status, obj, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(JSON.stringify(obj, null, 2) + '\n');
}

function header(req, name) {
  const h = req.headers || {};
  const v = h[name] != null ? h[name] : h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : (v == null ? '' : String(v));
}

function tooBig() {
  return new HttpError(413, ['Request body is larger than 1 MB. Send fewer rows per request.']);
}

// Read the raw request stream as bytes, stopping at the size limit.
function readStream(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > MAX_BYTES) { done = true; reject(tooBig()); return; }
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

/* The raw body after the platform's own JSON parser gave up (a UTF-8 byte order mark at the start
   is the usual cause), when the stream can still be read. null when it cannot: the stream already
   ended, or nothing arrives within a couple of seconds. */
function rawAfterParserFailed(req) {
  if (typeof req.on !== 'function' || req.readableEnded) return Promise.resolve(null);
  let timer;
  const wait = new Promise((resolve) => { timer = setTimeout(() => resolve(null), 2000); });
  return Promise.race([readStream(req), wait]).finally(() => clearTimeout(timer));
}

/* Which content types a POST body may use. JSON: any type that names json (application/json,
   application/problem+json, text/json). CSV: any type that names csv (text/csv, application/csv).
   No Content-Type at all: a body that starts with { or [ is read as JSON, anything else is a 415.
   Every other type (form-urlencoded, text/plain, multipart) is a 415, so curl -d without the
   header never silently runs the public case. */
function bodyKind(ct) {
  const t = String(ct || '').toLowerCase().split(';')[0].trim();
  if (!t) return 'none';
  if (t.includes('json')) return 'json';
  if (t.includes('csv')) return 'csv';
  return 'other';
}
function unsupported(ct) {
  const t = clip(String(ct || '').split(';')[0].trim(), 60);
  return new HttpError(415, [(t ? 'Content-Type "' + t + '" is not supported.' : 'The request has a body but no Content-Type.') +
    ' Send Content-Type: application/json with a JSON body (curl -H "Content-Type: application/json" -d \'{...}\'), or Content-Type: text/csv with a CSV file.']);
}
// A body that is not UTF-8 text: binary, UTF-16 without a byte order mark, or cp1252 / Latin-1 text.
// The messages are yourdata.js's, worded for a request instead of a file on a page.
function notText(problem) {
  return new HttpError(400, [String(problem).replace(/load that file\.$|load that\.$/, 'send that.').replace(/^This file/, 'The body')]);
}
const badJson = (extra) => new HttpError(400, ['Body is not valid JSON' + (extra || '. Check quotes, commas and brackets') + ', or send text/csv with Content-Type: text/csv for a CSV file.']);

/* Body as { kind: 'json', data } or { kind: 'csv', data: rows, text }, or null when empty.
   Works with a Vercel request (req.body parsed lazily by content type), a plain Node
   request stream, and test mocks where req.body is an object or a string. */
async function readBody(req) {
  const ct = header(req, 'content-type');
  const kind = bodyKind(ct);
  const len = Number(header(req, 'content-length'));
  if (Number.isFinite(len) && len > MAX_BYTES) throw tooBig();

  let body, parserFailed = false;
  try {
    body = req.body;
  } catch (e) {
    // Vercel throws here when the body is labelled JSON but does not parse. Read it ourselves
    // when the stream is still there, so a leading byte order mark is not a 400.
    parserFailed = true;
  }
  if (parserFailed) {
    body = await rawAfterParserFailed(req);
    if (body == null || !body.length) throw badJson('. Check quotes, commas and brackets');
  }
  if (body === undefined && typeof req.on === 'function') body = await readStream(req);
  // JSON null is not "no body": it is a JSON value that is not an object, so a 400 like any other.
  if (body === null && kind === 'json') return { kind: 'json', data: null };
  let problem = '';
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    if (body.length > MAX_BYTES) throw tooBig();
    if (!body.length) return null;
    const d = YD.decodeBytes(body);
    if (d.error) { problem = d.error; body = Buffer.from(body).toString('latin1'); } else body = d.text;
  }
  if (body == null) return null;

  if (typeof body === 'string') {
    if (!problem && Buffer.byteLength(body, 'utf8') > MAX_BYTES) throw tooBig();
    const t = body.replace(/^\uFEFF/, '').trim();
    if (!t) return null;
    const jsonish = t.startsWith('{') || t.startsWith('[');
    if (kind === 'other' || (kind === 'none' && !jsonish)) throw unsupported(ct);
    problem = problem || YD.textProblem(t);
    if (problem) throw notText(problem);
    if (kind === 'csv') return { kind: 'csv', data: YD.parseCSV(t), text: t };
    try { return { kind: 'json', data: JSON.parse(t) }; } catch (e) {
      throw badJson(': ' + e.message);
    }
  }
  if (typeof body === 'object') {
    // Vercel parses form-urlencoded bodies into an object. An empty one is no body; anything else is a 415.
    if (kind === 'other' || kind === 'csv') {
      if (!Array.isArray(body) && !Object.keys(body).length) return null;
      throw unsupported(ct);
    }
    let size;
    try { size = Buffer.byteLength(JSON.stringify(body), 'utf8'); } catch (e) { size = 0; }
    if (size > MAX_BYTES) throw tooBig();
    return { kind: 'json', data: body };
  }
  throw new HttpError(400, ['Body must be a JSON object or CSV text.']);
}

function query(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { return Object.fromEntries(new URL(req.url || '/', 'http://x').searchParams); } catch (e) { return {}; }
}

// A JSON body must be an object for the tools that take named options.
function objectBody(parsed) {
  if (!parsed) return {};
  if (parsed.kind !== 'json') return null;
  if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    throw new HttpError(400, ['Body must be a JSON object, for example {"state": "TX"}. See GET on this endpoint for the shape.']);
  }
  return parsed.data;
}

// Keys in an object body that the endpoint does not read, as warnings, with the closest known field.
function unknownKeys(obj, known) {
  return Object.keys(obj || {}).filter((k) => !known.includes(k)).map((k) => {
    const near = closest(k, known);
    return 'Ignored unknown field "' + clip(k) + '".' + (near ? ' Did you mean "' + near + '"?' : '');
  });
}

/* Query string parameters a POST does not read, as warnings with the closest field name.
   reads: the parameters this endpoint does read from the query string (may be empty).
   fields: every other field name worth suggesting (the JSON body's fields). */
function queryWarnings(req, reads, fields) {
  const q = query(req);
  const r = reads || [];
  const all = r.concat(fields || []);
  return Object.keys(q).filter((k) => !r.includes(k)).map((k) => {
    const near = closest(k, all);
    const where = near && !r.includes(near) ? ' (send it in the JSON body)' : '';
    return 'Ignored query string parameter "' + clip(k) + '".' + (near ? ' Did you mean "' + near + '"' + where + '?' : '') +
      (r.length ? ' This endpoint reads only ' + r.join(', ') + ' from the query string.' : ' This endpoint reads only the request body.');
  });
}

/* ---------- Echo, suggestions and output rounding ---------- */

// Text echoed back in a message, cut to n characters so a 100 KB value never comes back as a 100 KB error.
function clip(v, n) {
  const max = n || 40;
  const t = String(v == null ? '' : v);
  return t.length > max ? t.slice(0, max) + '...' : t;
}

// Edit distance, giving up (limit + 1) once it passes limit.
function lev(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}
// The known name closest to word (ignoring case, spaces, - and _), or null when none is close.
function closest(word, known) {
  const norm = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, '');
  const w = norm(word);
  if (!w || w.length > 60) return null;
  let best = null, bestD = Infinity;
  for (const k of known) {
    const d = lev(w, norm(k), 3);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best != null && bestD <= Math.max(1, Math.min(3, Math.floor(w.length / 3))) ? best : null;
}
// A known name matched in any case: "TOLL" finds "toll". Null when none matches.
function anyCase(word, known) {
  const w = String(word).trim().toLowerCase();
  return known.find((k) => k.toLowerCase() === w) || null;
}

/* Output numbers rounded for reading, without touching the core math: whole numbers stay, numbers
   of 1 or more go to 2 decimal places (dollars and cents, MW, weeks, DSCR), and numbers under 1
   keep 4 significant digits (shares, percentile ranks, rates), so a small share never reads as 0. */
function roundNum(x) {
  if (typeof x !== 'number' || !Number.isFinite(x) || Number.isInteger(x)) return x;
  const r = Math.abs(x) >= 1 ? Number(x.toFixed(2)) : Number(x.toPrecision(4));
  return Object.is(r, -0) ? 0 : r;
}
function roundDeep(v) {
  if (typeof v === 'number') return roundNum(v);
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = roundDeep(v[k]);
    return out;
  }
  return v;
}

/* Wrap a tool: { usage: () => object, post: async (parsed, req) => { inputs_used, result, warnings, sources } }.
   post throws HttpError(422, errors) for bad input. */
function endpoint(tool) {
  return async function handler(req, res) {
    setCors(res);
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') { res.statusCode = 204; res.setHeader('Content-Length', '0'); res.end(); return; }
    if (method === 'GET' || method === 'HEAD') {
      send(res, 200, tool.usage(), 's-maxage=3600, stale-while-revalidate=86400');
      return;
    }
    if (method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      send(res, 405, { ok: false, errors: ['Method ' + method + ' is not allowed. Use GET for usage or POST to run the tool.'] });
      return;
    }
    try {
      const parsed = await readBody(req);
      const out = await tool.post(parsed, req);
      // result numbers are rounded for reading; inputs_used stays exactly what the tool used.
      if (out.result) out.result = roundDeep(out.result);
      send(res, 200, Object.assign({ ok: true }, out, { warnings: capList(out.warnings || []), sources: out.sources || [] }));
    } catch (e) {
      if (e instanceof HttpError) { send(res, e.status, { ok: false, errors: capList(e.errors) }); return; }
      // Do not echo the request; report only that the tool failed.
      send(res, 500, { ok: false, errors: ['The tool failed on this input: ' + (e && e.message ? e.message : 'unknown error') + '. Check the request against GET on this endpoint.'] });
    }
  };
}

function invalid(errors) { return new HttpError(422, errors); }

// Error and warning lists: the first 50, then "And N more like these.", so a response stays small.
const MAX_MESSAGES = 50;
function capList(list) { return YD.capList(list, MAX_MESSAGES); }

function docsUrl(tool) { return SITE + '/plug-and-play#' + tool; }

/* ---------- Safe input helpers (any endpoint may use these) ---------- */

// Own-key lookups. A user-supplied key such as "__proto__" or "constructor" must never
// reach Object.prototype through a plain object.
function hasOwn(obj, key) { return obj != null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key); }
function getOwn(obj, key) { return hasOwn(obj, key) ? obj[key] : undefined; }
// A Map from rows, for user-keyed lookups: byKey(MAP.states, (s) => s.abbr).
function byKey(rows, keyFn) { return new Map((rows || []).map((r) => [keyFn(r), r])); }
// Names that are reserved on every JavaScript object. Ids and keys from a request may not use them.
function isReservedKey(key) {
  return typeof key === 'string' && (key === '__proto__' || key === 'prototype' || key in Object.prototype);
}

// Plain decimal numbers only: 12, -3.5, .5, 1e3. No hex (0x10), binary, octal, Infinity or NaN.
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/* Parse one numeric input. v may be a number or a string; booleans, arrays, objects and null
   are not numbers. opts: { min, max, integer, strip } where strip is a regex of characters to
   drop first (for example /[$,%\s]/g). Returns { ok: true, value } or { ok: false, error },
   where error finishes the sentence "<name> ...", for example "must be at most 10.". */
function parseNumber(v, opts) {
  const o = opts || {};
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    let t = (o.strip ? v.replace(o.strip, '') : v).trim();
    if (t === '') return { ok: false, error: 'is blank.' };
    // The site's comma rule (yourdata.js readNumber): a comma only as a thousands separator.
    if (t.includes(',')) {
      const r = YD.readNumber(t, /\s/g);
      if (r.comma) return { ok: false, error: 'is not a number: "' + clip(v) + '". ' + YD.COMMA_HINT, comma: true };
      if (Number.isFinite(r.value)) t = String(r.value);
    }
    if (!DECIMAL.test(t)) return { ok: false, error: 'is not a number: "' + clip(v) + '".' };
    n = Number(t);
  } else {
    return { ok: false, error: 'must be a number, got ' + (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v) + '.' };
  }
  if (!Number.isFinite(n)) return { ok: false, error: 'must be a finite number.' };
  if (o.integer && !Number.isInteger(n)) return { ok: false, error: 'must be a whole number.' };
  if (o.min != null && n < o.min) return { ok: false, error: 'must be at least ' + o.min + '.' };
  if (o.max != null && n > o.max) return { ok: false, error: 'must be at most ' + o.max + '.' };
  return { ok: true, value: n };
}

// A CSV body that is really JSON (sent with the wrong Content-Type) parses as one header row.
function looksLikeJsonCsv(parsed) {
  if (!parsed || parsed.kind !== 'csv') return false;
  const t = String(parsed.text || '').trim();
  return t.startsWith('{') || t.startsWith('[');
}
function jsonAsCsvError() {
  return invalid(['The body looks like JSON but was sent as CSV. Send it with Content-Type: application/json, or send CSV text with a header row.']);
}

module.exports = {
  MAX_BYTES, SITE, HttpError, setCors, send, readBody, query, objectBody, unknownKeys, endpoint, invalid, docsUrl, parseCSV: YD.parseCSV,
  hasOwn, getOwn, byKey, isReservedKey, parseNumber, looksLikeJsonCsv, jsonAsCsvError,
  clip, closest, anyCase, roundNum, roundDeep, bodyKind,
  queryWarnings, capList, MAX_MESSAGES, readNumber: YD.readNumber, commaHint: YD.commaHint, COMMA_HINT: YD.COMMA_HINT, normalizeText: YD.normalizeText,
};
