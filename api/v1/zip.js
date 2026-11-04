// POST /api/v1/zip: utility, permit office, interconnection path, and days to a
// first install for one US ZIP. Same lookup as the ZIP card on /launch.
// Math: zip-launch-core.js. Data: data/zip-launch.json.
'use strict';

const Z = require('../../zip-launch-core.js');
const DATA = require('../../data/zip-launch.json');
const L = require('../_lib.js');

const KNOWN = ['zip'];

function usage() {
  return {
    tool: 'zip',
    what: 'For one US ZIP: the wires utility, the permit office (city or county), the interconnection path, and a days-to-first-install total. Every figure is sourced, or the word unknown. Nothing is guessed.',
    post: {
      content_types: ['application/json'],
      json_body: { zip: '5-digit US ZIP, or ZIP+4 (optional in the query string instead, ?zip=78704)' },
      coverage: DATA.coverage.note,
      formula: DATA.formula.expression,
    },
    example: { zip: '78704' },
    returns: 'utility, permit office, SolarAPP+ yes or no, interconnection path, the three formula inputs, any published clock that matches, and days_to_first_install (a number or unknown).',
    docs: L.docsUrl('zip'),
    page: L.SITE + '/launch',
  };
}

async function post(parsed, req) {
  const q = L.query(req);
  let zip = L.getOwn(q, 'zip');
  if (Array.isArray(zip)) throw L.invalid(['zip appears more than once in the query string. Send it once.']);
  if (zip != null && String(zip).trim() === '') zip = null;
  let warnings = [];
  if (parsed && parsed.kind === 'csv') {
    throw L.invalid(['Send JSON {"zip": "78704"}. This endpoint does not read a CSV.']);
  }
  if (parsed && parsed.kind === 'json') {
    const b = L.objectBody(parsed);
    warnings = L.unknownKeys(b, KNOWN);
    let bz = L.getOwn(b, 'zip');
    if (typeof bz === 'string' && bz.trim() === '') bz = null;
    if (bz != null) {
      // Type errors (a number, a list, an object) come from the core with a clear message.
      if (typeof bz === 'string' && zip != null && bz.trim() !== String(zip).trim()) {
        throw L.invalid(['zip is "' + bz.trim().slice(0, 20) + '" in the body but "' + String(zip).trim().slice(0, 20) + '" in the query string. Send it in one place.']);
      }
      if (typeof bz !== 'string' && zip != null) {
        throw L.invalid(['zip is in both the body and the query string. Send it in one place.']);
      }
      zip = bz;
    }
  }
  const out = Z.lookup(DATA, zip);
  if (out.errors.length) throw L.invalid(out.errors);
  return {
    inputs_used: out.inputs_used,
    result: out.result,
    warnings: warnings.concat(out.warnings),
    sources: out.sources,
  };
}

module.exports = L.endpoint({ usage, post });
