// POST /api/v1/supply: which parts in your bill of materials will run short, the same way /supply does.
// Math: supply-core.js (validate, analyze). Data: data/supply.json (category ids and public research).
'use strict';

const S = require('../../supply-core.js');
const DATA = require('../../data/supply.json');
const L = require('../_lib.js');

const IDS = DATA.parts.map((p) => p.id);
const PART = L.byKey(DATA.parts, (p) => p.id); // a Map: categories from a request never reach Object.prototype
const KNOWN = ['parts'];


function usage() {
  return {
    tool: 'supply',
    what: 'Reads your bill of materials and shows which parts will run short (lead time minus weeks of cover), which are single sourced, which carry a 25%+ tariff, and the tariff cost per battery.',
    post: {
      content_types: ['application/json', 'text/csv'],
      json_body: { parts: 'list of { ' + S.COLUMNS.join(', ') + ' } (a bare list also works)' },
      csv_body: 'The page\'s "Use your own data" file: columns ' + S.COLUMNS.join(', ') + '.',
      limits: 'At most ' + S.MAX_PARTS.toLocaleString('en-US') + ' parts per request. Numbers use a dot for decimals; a comma is only a thousands separator (1,200).',
      required: S.REQUIRED,
      categories: IDS.concat('other'),
    },
    example: {
      parts: [
        { part: 'Inverter module', category: 'power_electronics', supplier: 'Example Supplier A', country: 'Germany', lead_time_weeks: 30, on_hand_weeks: 12, second_source: 'no', tariff_pct: 25, unit_cost_usd: 900, qty_per_unit: 1 },
        { part: 'LFP cell', category: 'cells', supplier: 'Example Supplier C', country: 'China', lead_time_weeks: 16, on_hand_weeks: 8, second_source: 'yes', tariff_pct: 55, unit_cost_usd: 40, qty_per_unit: 12 },
      ],
    },
    returns: 'rows sorted by gap, biggest first, with flags; parts at risk; the longest gap; tariff cost per battery; and a link to the public research for each part\'s category.',
    docs: L.docsUrl('supply'),
    page: L.SITE + '/supply',
  };
}

async function post(parsed, req) {
  if (!parsed) throw L.invalid(['No parts found. Send { "parts": [ ... ] } or CSV with part, category and lead_time_weeks columns.']);
  if (L.looksLikeJsonCsv(parsed)) throw L.jsonAsCsvError();
  // JSON null, a number or a string is not a list of parts: a 400 like other non-object JSON.
  if (parsed.kind === 'json' && (parsed.data === null || typeof parsed.data !== 'object')) {
    throw new L.HttpError(400, ['Body must be a JSON object { "parts": [ ... ] } or a list of parts. See GET on this endpoint for the shape.']);
  }
  let warnings = L.queryWarnings(req, [], KNOWN);
  if (parsed.kind === 'json' && parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) warnings = warnings.concat(L.unknownKeys(parsed.data, KNOWN));
  const v = S.validate(parsed, IDS);
  if (v.errors.length) throw L.invalid(v.errors);
  const res = S.analyze(v.rows);
  const t = res.totals;

  const sum = S.summary(res); // the page's summary text, word for word
  const summary = sum.head + sum.rest;

  const rows = res.rows.map((r) => {
    const pub = PART.get(r.category);
    return {
      part: r.part, category: r.category, supplier: r.supplier, country: r.country,
      lead_time_weeks: r.lead_time_weeks, on_hand_weeks: r.on_hand_weeks, cover_weeks: r.cover, gap_weeks: r.gap,
      // The page's text for the gap, with enough decimals that lead time and cover read apart (3 wk against 2.99999 wk).
      gap_text: S.weeksText(r.gap, r.digits),
      second_source: r.second_source, tariff_pct: r.tariff_pct, unit_cost_usd: r.unit_cost_usd, qty_per_unit: r.qty_per_unit,
      tariff_cost_per_battery: r.tariffCost, flags: r.flags, note: r.note, row: r.line,
      public_research: pub ? { name: pub.name, our_read: pub.our_read.label, url: L.SITE + '/supply#part-' + pub.id } : null,
    };
  });

  const cats = Array.from(new Set(res.rows.map((r) => r.category))).filter((c) => PART.has(c));
  const sources = cats.map((c) => {
    const p = PART.get(c);
    return { category: c, title: 'Public research: ' + p.name, url: L.SITE + '/supply#part-' + c, lead_time: p.lead_time && p.lead_time.value ? { value: p.lead_time.value, url: p.lead_time.url || null, date: p.lead_time.date || null } : null };
  });

  return {
    inputs_used: { parts: v.rows.length, categories: cats.concat(res.rows.some((r) => r.category === 'other') ? ['other'] : []) },
    result: {
      summary,
      totals: {
        parts: t.parts, at_risk: t.atRisk, single_source: t.singleSource,
        tariff_per_battery: t.tariffPerBattery, tariff_parts: t.tariffParts, longest_gap: t.longest,
      },
      rows,
      method: 'Gap is lead time minus weeks of cover (inventory plus open orders); a missing cover counts as zero. Flags: Will run short (gap above 0), Single source (second_source no), Tariff 25%+.',
    },
    warnings: warnings.concat(v.warnings),
    sources,
  };
}

module.exports = L.endpoint({ usage, post });
