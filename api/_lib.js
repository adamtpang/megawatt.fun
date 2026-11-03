// Shared helpers for the /api/v1 tool endpoints. Vercel does not route files that
// start with an underscore, so this is not an endpoint itself.
//
// Rules every endpoint follows: CORS open to any origin, OPTIONS answers 204,
// only GET and POST, request bodies up to 1 MB, and request bodies are never
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

// Read the raw request stream, stopping at the size limit.
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
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

/* Body as { kind: 'json', data } or { kind: 'csv', data: rows, text }, or null when empty.
   Works with a Vercel request (req.body parsed lazily by content type), a plain Node
   request stream, and test mocks where req.body is an object or a string. */
async function readBody(req) {
  const ct = header(req, 'content-type').toLowerCase();
  const len = Number(header(req, 'content-length'));
  if (Number.isFinite(len) && len > MAX_BYTES) throw tooBig();

  let body;
  try {
    body = req.body;
  } catch (e) {
    // Vercel throws here when the body is labelled JSON but does not parse.
    throw new HttpError(400, ['Body is not valid JSON. Check quotes, commas and brackets, or send text/csv with Content-Type: text/csv.']);
  }
  if (body === undefined && typeof req.on === 'function') body = await readStream(req);
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (body == null) return null;

  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) throw tooBig();
    const t = body.replace(/^﻿/, '').trim();
    if (!t) return null;
    const isCsv = ct.includes('csv') || (!ct.includes('json') && !(t.startsWith('{') || t.startsWith('[')));
    if (isCsv) return { kind: 'csv', data: YD.parseCSV(t), text: t };
    try { return { kind: 'json', data: JSON.parse(t) }; } catch (e) {
      throw new HttpError(400, ['Body is not valid JSON: ' + e.message + '. Send text/csv with Content-Type: text/csv for a CSV file.']);
    }
  }
  if (typeof body === 'object') {
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

// Keys in an object body that the endpoint does not read, as warnings.
function unknownKeys(obj, known) {
  return Object.keys(obj || {}).filter((k) => !known.includes(k)).map((k) => 'Ignored unknown field "' + k + '".');
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
      send(res, 200, Object.assign({ ok: true }, out, { warnings: out.warnings || [], sources: out.sources || [] }));
    } catch (e) {
      if (e instanceof HttpError) { send(res, e.status, { ok: false, errors: e.errors }); return; }
      // Do not echo the request; report only that the tool failed.
      send(res, 500, { ok: false, errors: ['The tool failed on this input: ' + (e && e.message ? e.message : 'unknown error') + '. Check the request against GET on this endpoint.'] });
    }
  };
}

function invalid(errors) { return new HttpError(422, errors); }

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
    const t = (o.strip ? v.replace(o.strip, '') : v).trim();
    if (t === '') return { ok: false, error: 'is blank.' };
    if (!DECIMAL.test(t)) return { ok: false, error: 'is not a number: "' + v + '".' };
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
};
