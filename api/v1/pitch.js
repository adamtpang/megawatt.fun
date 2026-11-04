// POST /api/v1/pitch: the one-page utility pitch from /pitch, as JSON.
// Rules: pitch-core.js (signalPercentiles, strongestSignal, pickOffer, headline, sizeProgram, landedCost,
// questions, rankState, loadYourData). Data: data/expansion-map.json, data/market-states.json.
'use strict';

const P = require('../../pitch-core.js');
const D = require('../../data/expansion-map.json');
const M = require('../../data/market-states.json');
const L = require('../_lib.js');

const IDX = P.utilityIndex(D.utilities);
const BY_ID = new Map(D.utilities.map((u) => [u.id, u]));
const KNOWN = ['utility', 'state', 'mw', 'largeLoads', 'terms', 'targets'];

function usage() {
  return {
    tool: 'pitch',
    what: 'Builds the outside-view pitch for one utility from public data: its strongest outage or risk signal and percentile, the Base offer that fits and why, program size, landed cost range, questions to ask, and who to call first in its state.',
    post: {
      content_types: ['application/json', 'text/csv'],
      json_body: {
        utility: 'required, at most ' + P.MAX_NAME + ' characters: EIA id as in the data (for example "5078-TX"), the name, "Name, ST", a public alias such as "CoServ Electric", or a common short name such as "Oncor" or "ComEd". utility, state, mw and largeLoads may also go in the query string; sent in both places they must agree.',
        state: 'two-letter state to narrow a name match (optional). If it disagrees with the utility, the request is a 422.',
        mw: 'program size in MW (optional, default terms.programMw, public 100). Sending both mw and a different terms.programMw is a 422. Batteries come whole, so a tiny size is rounded up.',
        largeLoads: 'true or false: large loads are waiting to connect; picks Speed to power (optional, default false). Anything else is a 422.',
        terms: '{ key: value } offer terms (optional): ' + P.TERMS.map((t) => t.key).join(', '),
        targets: 'your target list (optional, at most ' + P.MAX_TARGETS + ' items): [{ utility, state, status, owner, note }], all text',
      },
      csv_body: 'The page\'s "Use your own data" file: key,value rows for offer terms and utility,status,owner,note rows for targets. Put utility (and optionally state, mw, largeLoads) in the query string, for example ?utility=5078-TX.',
      terms: P.TERMS.map((t) => ({ key: t.key, label: t.label, unit: t.unit, public_value: t.value, min: t.min, max: t.max, basis: t.basis })),
    },
    example: { utility: 'CoServ Electric', state: 'TX', terms: { tollPerKwYear: 85, termYears: 10 }, targets: [{ utility: 'Austin Energy', status: 'in talks', owner: 'Ben' }] },
    returns: 'utility, headline signal and percentile, recommended offer and the rule that picked it, program size, landed cost range, deal structure, questions to ask, and who to call first in that state (utilities in the main market of the state first; existing Base partners listed after the ranking as expansion conversations, never as cold prospects).',
    docs: L.docsUrl('pitch'),
    page: L.SITE + '/pitch',
  };
}

// largeLoads: a real yes or no. Anything else ("maybe", 2, an object) is an error, never a silent false.
const YES = ['1', 'true', 'yes', 'on'], NO = ['0', 'false', 'no', 'off', ''];
function yesNo(v) {
  if (v === true || v === false) return v;
  if (v == null) return false;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = String(v).trim().toLowerCase();
  return YES.includes(t) ? true : NO.includes(t) ? false : null;
}
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
function numberIn(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && DECIMAL.test(v.trim())) return Number(v.trim());
  return NaN;
}

// pitch.js sourcesFor(), numbered the same way.
function sourcesFor(u, pick) {
  const find = (prefix) => D.sources.filter((s) => s.title.indexOf(prefix) === 0)[0];
  const eia = find('EIA Form 861'), fema = find('FEMA National Risk Index');
  const list = [
    { key: 'eia', title: eia.title, url: eia.url, date: 'released 7 Oct 2026; compiled in /data/expansion-map.json on ' + D.generated },
    { key: 'fema', title: fema.title, url: fema.url, date: 'version December 2025, queried 2026-10-27' },
    { key: 'epa', title: M.sources.reliability.title, url: M.sources.reliability.url, date: 'years 2024 and 2025, retrieved ' + M.retrieved },
    { key: 'price', title: M.sources.price.title, url: M.sources.price.url, date: 'year 2024, retrieved ' + M.retrieved },
    { key: 'base', title: P.BASE_SOURCE.title, url: P.BASE_SOURCE.url, date: 'retrieved ' + P.BASE_SOURCE.retrieved },
  ];
  if (pick.source) list.push({ key: 'ercot', title: pick.source.title, url: pick.source.url, date: 'retrieved ' + pick.source.retrieved });
  P.extraSources(u, pick).forEach((s) => list.push({ key: s.key, title: s.title, url: s.url, date: 'retrieved ' + s.retrieved }));
  const k = P.known(u.id);
  if (k && k.aliasSource) list.push({ key: 'alias', title: k.aliasSource.title, url: k.aliasSource.url, date: 'retrieved ' + k.aliasSource.retrieved });
  if (k && k.source && k.source.url !== P.BASE_SOURCE.url) list.push({ key: 'known', title: k.source.title, url: k.source.url, date: k.source.retrieved });
  list.forEach((s, i) => { s.n = i + 1; });
  return list;
}

const QUERY_KNOWN = ['utility', 'state', 'mw', 'largeLoads'];
const describe = (v) => (Array.isArray(v) ? 'a list' : v === null ? 'null' : typeof v === 'object' ? 'an object' : typeof v === 'string' ? '"' + P.clip(v) + '"' : JSON.stringify(v));

/* utility, state, mw and largeLoads from the query string and a JSON body. A value sent in both places must
   agree (same text, same number, same yes or no, or the same utility by another name), or the request is a 422,
   never silently resolved. Same rule as /api/v1/launch. */
function readOptions(q, b) {
  const errors = [], out = Object.create(null);
  for (const k of QUERY_KNOWN) {
    let qv = L.getOwn(q, k), bv = L.getOwn(b, k);
    if (Array.isArray(qv)) { errors.push(k + ' appears more than once in the query string. Send it once.'); continue; }
    if (qv != null && String(qv).trim() === '') qv = undefined;
    if (typeof bv === 'string' && bv.trim() === '') bv = undefined;
    if (bv === null) bv = undefined;
    if (qv !== undefined && bv !== undefined && !same(k, qv, bv)) {
      errors.push(k + ' is ' + describe(bv) + ' in the body but "' + P.clip(String(qv)) + '" in the query string. Send it in one place.');
      continue;
    }
    out[k] = bv !== undefined ? bv : qv;
  }
  if (errors.length) throw L.invalid(errors);
  return out;
}
function same(k, a, b) {
  if (k === 'mw') { const x = numberIn(a), y = numberIn(b); return Number.isFinite(x) && Number.isFinite(y) ? x === y : String(a).trim() === String(b).trim(); }
  if (k === 'largeLoads') { const x = yesNo(a), y = yesNo(b); return x !== null && x === y; }
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
  if (k !== 'utility' || a.length > P.MAX_NAME || b.length > P.MAX_NAME) return false;
  // Two names for one utility ("5078-TX" and "CoServ Electric") agree.
  const x = P.matchUtility(IDX, a, null, { suggest: false }), y = P.matchUtility(IDX, b, null, { suggest: false });
  return !!(x.u && y.u && x.u.id === y.u.id);
}

async function post(parsed, req) {
  // JSON sent as text/csv parses as one strange header row. Say so instead of "utility is required".
  if (L.looksLikeJsonCsv(parsed)) throw L.jsonAsCsvError();
  const q = L.query(req);
  let b = Object.create(null), own = null, warnings = [];
  if (parsed && parsed.kind === 'csv') own = parsed;
  else {
    b = L.objectBody(parsed) || {};
    warnings = L.unknownKeys(b, KNOWN);
    const terms = L.getOwn(b, 'terms'), targets = L.getOwn(b, 'targets');
    if (terms != null || targets != null) {
      if (terms != null && (typeof terms !== 'object' || Array.isArray(terms))) throw L.invalid(['terms must be an object of { key: value }, for example { "tollPerKwYear": 85 }. Got ' + (Array.isArray(terms) ? 'a list' : typeof terms) + '.']);
      if (Array.isArray(targets) && targets.length > P.MAX_TARGETS) throw L.invalid(['targets has ' + targets.length + ' items. The limit is ' + P.MAX_TARGETS + ' per request; split the list.']);
      own = { kind: 'json', data: { terms: terms || {}, targets: targets == null ? undefined : targets } };
    }
  }
  const opts = readOptions(q, b);

  // Offer terms and targets: the page's "Use your own data" loader.
  let T = P.publicTerms(), changed = [], targets = {}, given = [];
  if (own) {
    const r = P.loadYourData(own, D.utilities);
    // An empty terms object with no targets is not an error here; the page needs a file, the API does not.
    const onlyEmpty = r.errors.length === 1 && /^No rows found/.test(r.errors[0]);
    if (r.errors.length && !onlyEmpty) throw L.invalid(r.errors);
    if (!onlyEmpty) { T = r.terms; changed = r.changed; targets = r.targets; given = r.given; warnings = warnings.concat(r.warnings); }
  }

  // The utility. Type and length are checked before any matching, so a huge name costs nothing.
  if (opts.state != null && typeof opts.state !== 'string') throw L.invalid(['state must be text, a two-letter code such as "TX". Got ' + describe(opts.state) + '.']);
  if (opts.state != null && !/^[A-Za-z]{2}$/.test(opts.state.trim())) throw L.invalid(['state must be a two-letter code such as "TX". Got "' + P.clip(opts.state) + '".']);
  if (opts.utility != null && typeof opts.utility !== 'string') throw L.invalid(['utility must be text: an EIA id such as "5078-TX", a name, "Name, ST", or an alias.']);
  if (opts.utility == null || opts.utility.trim() === '') throw L.invalid(['utility is required: an EIA id such as "5078-TX", a name, "Name, ST", or an alias such as "CoServ Electric".']);
  if (opts.utility.trim().length > P.MAX_NAME) throw L.invalid(['utility is ' + opts.utility.trim().length + ' characters. The limit is ' + P.MAX_NAME + '; send an EIA id such as "5078-TX" or a name.']);
  const asked = P.clip(opts.utility.trim());
  const m = P.matchUtility(IDX, opts.utility, opts.state);
  if (m.stateMismatch) throw L.invalid(['utility "' + asked + '" is ' + P.displayName(m.stateMismatch) + ' in ' + m.stateMismatch.state + ', not ' + m.state + '. Fix state or leave it out.']);
  if (m.ambiguous) throw L.invalid(['utility "' + asked + '" matches ' + m.ambiguous.length + ' utilities (' + m.ambiguous.slice(0, 10).map((u) => u.id + ' ' + u.name).join('; ') + (m.ambiguous.length > 10 ? '; ...' : '') + '). Use the id or add a state.']);
  if (!m.u) throw L.invalid(['No utility called "' + asked + '"' + (opts.state ? ' in ' + opts.state.trim().toUpperCase() : '') + (m.suggestion ? '. Did you mean ' + P.displayName(m.suggestion) + ', ' + m.suggestion.state + ' (id ' + m.suggestion.id + ')?' : '.')]);
  const u = m.u;

  const mwGiven = opts.mw != null;
  const mwIn = mwGiven ? numberIn(opts.mw) : T.programMw;
  if (!Number.isFinite(mwIn) || mwIn <= 0 || mwIn > 5000) throw L.invalid(['mw must be a number above 0 and at most 5000.']);
  // mw and an offer-terms programMw are the same thing. Both set and different is a conflict, not a silent pick.
  if (mwGiven && given.includes('programMw') && mwIn !== T.programMw) throw L.invalid(['mw is ' + mwIn + ' but programMw in your offer terms is ' + T.programMw + '. Send the program size in one place.']);
  const largeLoads = yesNo(opts.largeLoads);
  if (largeLoads === null) throw L.invalid(['largeLoads must be true or false. Got ' + describe(opts.largeLoads) + '.']);

  // pitch.js render(), without the HTML.
  const st = D.states.filter((s) => s.abbr === u.state)[0] || { name: u.state, values: {} };
  const ms = M.states.filter((s) => s.name === st.name)[0] || {};
  const prog = P.sizeProgram(mwIn, u.values.homes, T);
  const pcts = P.signalPercentiles(u, D.utilities);
  const sig = P.strongestSignal(pcts);
  const pick = P.pickOffer(u, pcts, { largeLoads, terms: T });
  const src = sourcesFor(u, pick);
  const known = P.known(u.id);
  const costYours = changed.includes('costLowPerKwh') || changed.includes('costHighPerKwh');
  const timeYours = changed.includes('deployMonthsLow') || changed.includes('deployMonthsHigh');

  const ratio = (a, b) => (P.isNum(a) && P.isNum(b) && b > 0 ? (a / b).toFixed(1) + 'x' : null);
  const said = [];
  const rs = ratio(u.values.saidi, st.values.saidi), ru = ratio(u.values.saidi, M.us.saidi_2025);
  if (rs && ru) said.push('Outage minutes run ' + rs + ' the ' + st.name + ' total and ' + ru + ' the US figure.');
  if (P.isNum(ms.cents_kwh)) said.push(st.name + ' homes paid ' + ms.cents_kwh.toFixed(2) + ' cents/kWh and $' + ms.bill_usd.toFixed(2) + ' a month on average in 2024, against ' + M.us.cents_kwh.toFixed(2) + ' cents and $' + M.us.bill_usd.toFixed(2) + ' for the US. That is a state average, not this utility\'s tariff.');

  const SIGNAL_LABELS = { saidi: 'Outage minutes per customer (SAIDI, 2025, with major events)', saifi: 'Outages per customer (SAIFI, 2025, with major events)', storm: 'Storm risk (FEMA NRI score, 0 to 100)', heat: 'Heat-wave risk (FEMA NRI score, 0 to 100)', demand_response: 'Demand-response enrollments per 1,000 homes', batteries: 'Net-metered home batteries per 1,000 homes', dynamic_pricing: 'Dynamic-pricing enrollments per 1,000 homes' };
  const signals = Object.keys(SIGNAL_LABELS).map((k) => ({ id: k, label: SIGNAL_LABELS[k], utility: pcts[k].value, state: P.isNum(st.values[k]) ? st.values[k] : null, us: k === 'saidi' ? M.us.saidi_2025 : null, percentile: pcts[k].pct, of_utilities: pcts[k].n }));

  const claims = P.CLAIMS_TABLE.map((row, i) => {
    let r = row, time = row.time, yoursRow = false;
    if (i === 0 && (costYours || timeYours)) {
      r = { option: row.option, low: T.costLowPerKwh, high: T.costHighPerKwh, cost: row.cost };
      if (timeYours) time = T.deployMonthsLow === T.deployMonthsHigh ? T.deployMonthsLow + ' months' : T.deployMonthsLow + ' to ' + T.deployMonthsHigh + ' months';
      yoursRow = true;
    }
    const c = prog ? P.landedCost(prog.mwh, r) : null;
    return { option: row.option, yours: yoursRow, time_to_deploy_100mw: time, cost_per_kwh: { low: r.low, high: r.high }, this_program_usd: c };
  });

  const all = P.rankState(D.utilities, u.state, Infinity);
  const ordered = P.orderWithTargets(all, targets);
  const nMine = all.filter((x) => P.own(targets, x.id)).length;
  // Your targets, then the cold top 10, then existing Base partners (unranked: an expansion conversation, not a cold call).
  const partnersInState = all.filter((x) => x.partner);
  const top = ordered.slice(0, nMine).concat(ordered.slice(nMine).filter((x) => x.rank !== null && x.rank <= 10), partnersInState.filter((x) => !P.own(targets, x.id)));
  const wiresInState = all.filter((x) => x.wires);
  const market = P.stateMarket(D.utilities, u.state);
  const partner = P.partnerFrame(u);
  const mine = all.filter((x) => x.id === u.id)[0];
  if (mine && top.indexOf(mine) < 0) top.push(mine);

  const tv = prog ? P.tollValue(T, prog.mw) : null;
  const others = ['bulk', 'distribution', 'speed'].filter((k) => k !== pick.offer.id).map((k) => P.OFFERS[k].name);

  const result = {
    utility: { id: u.id, name: u.name, display_name: P.displayName(u), state: u.state, state_name: st.name, residential_customers: u.values.homes, balancing_authority: u.detail.rtos, reporting_note: u.detail.note || null },
    headline: P.headline(u, sig),
    headline_signal: sig ? { id: sig.id, label: SIGNAL_LABELS[sig.id], value: sig.value, percentile: sig.pct, of_utilities: sig.n, text: 'higher than ' + Math.round(sig.pct * 100) + '% of US utilities' } : null,
    public_link_to_base: known ? { note: known.note, source: known.source.url, base_partner: !!partner } : null,
    base_partner: partner ? { status: partner.label, program: partner.program, since: partner.since, framing: partner.framing, note: known.note, source: known.source.url } : null,
    your_target: P.own(targets, u.id) || null,
    offer: { id: pick.offer.id, name: pick.offer.name, variant: pick.variant, quote: pick.offer.quote, rule: pick.rule, reason: pick.reason, also_on_menu: others, capacity_offer: pick.offer.id === 'bulk' },
    wires_only: pick.wires ? {
      what: pick.wires.what + ' It is not a buyer for a capacity program.',
      why: pick.wires.reason, detected_by: pick.wires.basis,
      route_to_homes: 'In its area a home-battery company reaches homes as a retail provider.' + (pick.wires.baseRetail ? ' ' + pick.wires.baseRetail : ''),
      talk_about: 'interconnection and distribution-level value, not a capacity purchase',
      sources: src.filter((s) => pick.wires.sources.includes(s.key) || s.key === pick.wires.baseSource).map((s) => s.n),
    } : null,
    program: prog ? {
      mw: prog.mw, nameplate_mw: prog.nameplateMw, rounded_up: prog.roundedUp, batteries: prog.batteries, kw_per_battery: prog.kw, kwh_per_battery: prog.kwh, mwh: prog.mwh, hours_at_full_output: prog.hours,
      share_of_residential_customers: prog.share, dispatchable_mwh: P.isNum(prog.dispatchMwh) ? prog.dispatchMwh : null,
      note: (prog.roundedUp ? P.roundedUpNote(prog) + ' ' : '') + 'Nameplate is not accredited capacity, and each home keeps a backup reserve.' + (P.isNum(prog.share) && prog.share > 1 ? ' This program needs more batteries than the utility has residential customers.' : ''),
    } : null,
    landed_cost: { about: 'Base\'s own comparison table (Base attributes it to EnergySage, Lazard and Wood Mackenzie), times this program\'s MWh. Arithmetic on a claim, not a quote.', rows: claims },
    your_offer: tv ? { toll_per_kw_year: T.tollPerKwYear, per_year_usd: tv.perYear, term_years: P.isNum(T.termYears) ? T.termYears : null, total_usd: tv.total } : null,
    problem: { comparison: said, signals, wholesale_share: P.isNum(u.values.wholesale) ? u.values.wholesale : null, retail_share: P.isNum(u.values.retail) ? u.values.retail : null },
    deal_structure: [
      { name: 'Toll', what: 'Base owns the batteries. The utility pays for performance.', to_settle: 'term, the performance metric, and penalties for shortfall' },
      { name: 'Build-transfer', what: 'Base builds the fleet and the utility takes ownership.', to_settle: 'who operates the fleet after transfer, and how the asset is financed and approved' },
    ],
    questions: P.questions(u, pick, T),
    who_to_call_first: {
      state: u.state,
      method: 'Ranked by residential customers x SAIDI minutes (EIA-861 2025), a stand-in for customer minutes interrupted. ' + market.reason + ' Existing Base partners are not ranked as cold prospects; they are listed after the ranking as an expansion conversation. Wires-only utilities, which deliver power but do not buy it, are not ranked.' + (nMine ? ' Your ' + nMine + ' target' + (nMine === 1 ? '' : 's') + ' in this state come first, still in public rank order.' : ''),
      preferred_market: market.market,
      market_reason: market.reason,
      utilities_in_state: all.length,
      ranked_in_state: all.filter((x) => x.rank !== null).length,
      rows: top.map((x) => ({ rank: x.rank, id: x.id, name: x.name, wires_only: x.wires, base_partner: x.partner, status: x.partner ? P.PARTNER_LABEL : null, market: x.market, outside_preferred_market: x.inMarket === false, market_note: x.marketNote, residential_customers: x.customers, saidi_minutes: x.saidi, customer_minutes: x.score, your_target: P.own(targets, x.id) || null, current: x.id === u.id })),
      base_partners_in_state: partnersInState.map((x) => { const k = P.partnerOf(x.id); return { id: x.id, name: x.name, status: P.PARTNER_LABEL, program: k.program, since: k.since || null, source: k.source.url }; }),
      wires_only_in_state: wiresInState.map((x) => ({ id: x.id, name: x.name, residential_customers: x.customers })),
      your_targets_elsewhere: Object.keys(targets).map((id) => BY_ID.get(id)).filter((x) => x && x.state !== u.state).map((x) => ({ id: x.id, name: P.displayName(x), state: x.state, status: targets[x.id].status })),
    },
  };

  return {
    inputs_used: { utility: u.id, mw: mwIn, largeLoads, terms: T, yours: changed, targets: Object.keys(targets) },
    result,
    warnings,
    sources: src.map((s) => ({ n: s.n, key: s.key, title: s.title, url: s.url, date: s.date })),
  };
}

module.exports = L.endpoint({ usage, post });
