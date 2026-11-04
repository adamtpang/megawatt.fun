/* ZIP to first install. Pure lookup, no DOM.
   The page (zip-launch.js) and POST /api/v1/zip both call lookup().
   Data: data/zip-launch.json. A missing figure is the string "unknown". */
(function (root) {
  'use strict';

  const UNKNOWN = 'unknown';

  function text(v) { return String(v == null ? '' : v).trim(); }

  function normalizeZip(input) {
    const s = text(input);
    const m = s.match(/^(\d{5})(?:-\d{4})?$/);
    return m ? m[1] : null;
  }

  function sourceOf(data, id) {
    const s = data.sources && data.sources[id];
    if (!s) return null;
    return { id, title: s.title, url: s.url, dated: s.dated || null, retrieved: s.retrieved || null };
  }

  function nameHas(name, needle) {
    const n = text(name).toLowerCase();
    const q = text(needle).toLowerCase();
    if (!q) return false;
    if (q.length <= 4) return new RegExp('(^|[^a-z0-9])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(n);
    return n.includes(q);
  }

  function isErcotTdu(data, name) {
    return (data.ercot_tdu_names || []).some((n) => nameHas(name, n));
  }

  // The Texas retail-choice block from Power to Choose, or null when the file has none.
  function retailChoice(data) {
    const rc = data.retail_choice;
    return rc && rc.tdus ? rc : null;
  }

  // A wires company Power to Choose sells plans over, matched by EIA number. Statewide, not per ZIP:
  // a city utility or co-op that is in retail choice anywhere is in it everywhere it serves.
  function choiceTduFor(data, utility, state) {
    const rc = retailChoice(data);
    if (!rc || state !== 'TX' || !utility) return null;
    for (const key of Object.keys(rc.tdus)) {
      const t = rc.tdus[key];
      if (t.eia_id && String(t.eia_id) === String(utility.eia_id)) return Object.assign({ key }, t);
    }
    return null;
  }

  function pathFor(data, utility, state) {
    const own = utility.ownership;
    const rc = retailChoice(data);
    const choice = choiceTduFor(data, utility, state);
    const srcOf = (u) => (u.source === 'ptc' ? ['ptc'] : ['openei-2024']);
    if (choice && (own === 'Municipal' || own === 'Cooperative')) {
      const kind = own === 'Municipal' ? 'City-owned' : 'Cooperative';
      return {
        id: 'retail_choice_public',
        label: kind + ' wires utility inside Texas retail choice',
        detail: 'Power to Choose, the PUCT plan site, lists retail plans over ' + choice.name + ' as the wires company. A retail electric provider sells the power. ' + choice.name + ' owns the wires and interconnects the battery.' + (choice.note ? ' ' + choice.note : ''),
        sources: srcOf(utility).concat(['ptc'], choice.source ? [choice.source] : []),
      };
    }
    if (own === 'Municipal') {
      const tx = state === 'TX' && rc;
      return {
        id: 'municipal',
        label: 'Municipal utility',
        detail: tx
          ? 'OpenEI lists this utility as municipal, and Power to Choose (PUCT) lists no retail plans over it as of ' + rc.retrieved + ', so it is outside Texas retail choice. The city utility sells the power and interconnects a home battery.'
          : 'OpenEI lists this utility as municipal. The city utility sells the power and interconnects a home battery.',
        sources: tx ? ['openei-2024', 'ptc'] : ['openei-2024'],
      };
    }
    if (own === 'Cooperative') {
      const tx = state === 'TX' && rc;
      return {
        id: 'cooperative',
        label: 'Electric cooperative',
        detail: tx
          ? 'OpenEI lists this utility as a cooperative, and Power to Choose (PUCT) lists no retail plans over it as of ' + rc.retrieved + ', so it has not opted into Texas retail choice. The co-op sells the power and interconnects a member battery.'
          : 'OpenEI lists this utility as a cooperative. The co-op interconnects a member battery. Whether it has opted into retail choice is not in this file, so that part is unknown.',
        sources: tx ? ['openei-2024', 'ptc'] : ['openei-2024'],
      };
    }
    if (own === 'Investor Owned' && state === 'TX' && isErcotTdu(data, utility.name)) {
      return {
        id: 'ercot_tdu',
        label: 'ERCOT wires utility',
        detail: 'This name is one of the four investor-owned transmission and distribution utilities PUCT names inside ERCOT: CenterPoint, Oncor, TNMP, and AEP Texas.' + (utility.source === 'ptc' ? ' Power to Choose (PUCT) lists retail plans over it in this ZIP.' : '') + ' The wires company interconnects the battery. A retail electric provider sells the power.',
        sources: srcOf(utility).concat(['puct-ercot-tdus']),
      };
    }
    if (own === 'Investor Owned' && state === 'TX') {
      return {
        id: 'texas_iou_bundled',
        label: 'Texas investor-owned utility, not one of the four ERCOT TDUs',
        detail: 'OpenEI lists an investor-owned utility, and the name is not CenterPoint, Oncor, TNMP, or AEP Texas. PUCT names those four as the wires utilities inside ERCOT retail choice. Service type on this row is ' + (utility.service_type || UNKNOWN) + '. PUCT 25.211(m) is the interconnection outside limit for an electric utility.',
        sources: ['openei-2024', 'puct-ercot-tdus', 'puct-25211'],
      };
    }
    if (own === 'Investor Owned') {
      return {
        id: 'investor_owned',
        label: 'Investor-owned utility',
        detail: 'OpenEI lists an investor-owned utility. The interconnection path outside Texas is unknown in this file.',
        sources: ['openei-2024'],
      };
    }
    return {
      id: UNKNOWN,
      label: UNKNOWN,
      detail: 'OpenEI ownership is ' + (own || UNKNOWN) + '. No interconnection path is on file for that ownership.',
      sources: ['openei-2024'],
    };
  }

  function clockApplies(clock, utility, state) {
    const a = clock.applies || {};
    if (!utility) return false;
    if (a.eia_id && String(utility.eia_id) !== String(a.eia_id)) return false;
    if (a.ownership && utility.ownership !== a.ownership) return false;
    if (a.state && state !== a.state) return false;
    if (a.name_includes && !nameHas(utility.name, a.name_includes)) return false;
    return true;
  }

  function publicClock(clock, matched) {
    return {
      id: clock.id,
      input: clock.input,
      fills_input: !!clock.fills_input,
      kind: clock.kind,
      low_days: clock.low_days == null ? null : clock.low_days,
      high_days: clock.high_days == null ? null : clock.high_days,
      unit: clock.unit || null,
      display: clock.display,
      about: clock.about,
      quote: clock.quote,
      source: clock.source,
      matched: !!matched,
    };
  }

  function pointDays(clock) {
    if (!clock.fills_input || clock.kind !== 'point' || clock.unit !== 'calendar days') return null;
    const n = Number(clock.low_days);
    if (!Number.isFinite(n) || n < 0) return null;
    if (clock.high_days != null && Number(clock.high_days) !== n) return null;
    return n;
  }

  function estimateDays(data, utilities, state) {
    const matched = [];
    for (const clock of data.clocks || []) {
      if ((utilities || []).some((u) => clockApplies(clock, u, state))) matched.push(clock);
    }
    const byInput = {};
    for (const clock of matched) {
      const days = pointDays(clock);
      if (days == null) continue;
      (byInput[clock.input] || (byInput[clock.input] = [])).push({ clock, days });
    }
    const formula = (data.formula && data.formula.expression) || 'permit_review_days + interconnection_days + crew_days';
    const inputs = ['permit_review_days', 'interconnection_days', 'crew_days'].map((id) => {
      const hits = byInput[id] || [];
      if (hits.length === 1) {
        return { id, days: hits[0].days, display: String(hits[0].days), detail: 'Calendar-day figure from ' + hits[0].clock.id + '.' };
      }
      if (hits.length > 1) {
        return { id, days: null, display: UNKNOWN, detail: 'More than one calendar-day figure applies, so this input is unknown.' };
      }
      const related = matched.filter((c) => c.input === id);
      let detail = 'No calendar-day number is on file.';
      if (id === 'permit_review_days') detail = 'No published permit-review duration is on file for this permit office.';
      if (id === 'crew_days') detail = 'No sourced crew or construction duration is on file.';
      if (id === 'interconnection_days' && related.length) detail = 'A published clock is on file, and it is not a single calendar-day number, so it is not added.';
      if (id === 'interconnection_days' && !related.length) detail = 'No interconnection duration is on file for this utility.';
      return { id, days: null, display: UNKNOWN, detail };
    });
    const complete = inputs.every((i) => i.days != null);
    const days = complete ? inputs.reduce((s, i) => s + i.days, 0) : null;
    return {
      days,
      display: days == null ? UNKNOWN : String(days),
      unit: days == null ? null : 'calendar days',
      formula,
      rule: (data.formula && data.formula.rule) || '',
      inputs,
      clocks: matched.map((c) => publicClock(c, true)),
    };
  }

  function prettyPlace(name) {
    return text(name).replace(/\s+(city|town|village|borough|municipality)$/i, '');
  }

  function normKey(name, kind) {
    let n = text(name).toLowerCase().replace(/&/g, ' and ');
    if (kind === 'county') n = n.replace(/\s+county$/, '');
    else n = n.replace(/\s+(city|town|village|borough|municipality)$/, '');
    return n.replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function ahjFor(data, rec) {
    const min = data.ahj_rule && Number(data.ahj_rule.min_incorporated_land_share);
    const cutoff = Number.isFinite(min) ? min : 0.5;
    const rule = (data.ahj_rule && data.ahj_rule.text) || '';
    const place = rec.place;
    if (place && place.incorporated && Number(place.land_share) >= cutoff) {
      return {
        name: prettyPlace(place.name),
        raw_name: place.name,
        kind: 'city',
        land_share: place.land_share,
        rule,
      };
    }
    return {
      name: rec.county.name,
      raw_name: rec.county.name,
      kind: 'county',
      land_share: rec.county.land_share,
      rule,
    };
  }

  function solarappFor(data, ahj, state) {
    const block = data.solarapp || {};
    const base = {
      on_list: null,
      display: UNKNOWN,
      pv: null,
      solar_plus_storage: null,
      main_panel_upgrade: null,
      main_breaker_derate: null,
      subtitle: null,
      jurisdiction: null,
      url: null,
      file_modified: block.file_modified || null,
      note: 'SolarAPP+ status is unknown.',
    };
    if (!ahj || !Array.isArray(block.jurisdictions)) return base;
    const key = normKey(ahj.raw_name, ahj.kind);
    const rowKind = (name) => (/\bcounty\b/i.test(name) ? 'county' : 'city');
    const hit = block.jurisdictions.find((j) => j.state === state && rowKind(j.name) === ahj.kind && normKey(j.name, ahj.kind) === key);
    if (!hit) {
      return {
        on_list: false,
        display: 'no',
        pv: null,
        solar_plus_storage: null,
        main_panel_upgrade: null,
        main_breaker_derate: null,
        subtitle: null,
        jurisdiction: null,
        url: null,
        file_modified: block.file_modified || null,
        note: 'Not on the SolarAPP+ list for this permit office, as of the file date. That is a sourced no.',
      };
    }
    const storage = !!hit.solar_plus_storage;
    return {
      on_list: true,
      display: 'yes',
      pv: !!hit.pv,
      solar_plus_storage: storage,
      main_panel_upgrade: !!hit.main_panel_upgrade,
      main_breaker_derate: !!hit.main_breaker_derate,
      subtitle: hit.subtitle || '',
      jurisdiction: hit.name,
      url: hit.url || null,
      file_modified: block.file_modified || null,
      note: storage
        ? 'On the SolarAPP+ list, including solar plus storage.'
        : 'On the SolarAPP+ list for solar PV. Solar plus storage is not marked, so a home battery is not shown as covered.',
    };
  }

  function emptyDays(data) {
    const formula = (data.formula && data.formula.expression) || 'permit_review_days + interconnection_days + crew_days';
    return {
      days: null,
      display: UNKNOWN,
      unit: null,
      formula,
      rule: (data.formula && data.formula.rule) || '',
      inputs: ['permit_review_days', 'interconnection_days', 'crew_days'].map((id) => ({ id, days: null, display: UNKNOWN, detail: 'Not enough is on file to fill this input.' })),
      clocks: [],
    };
  }

  function referenceClocks(data, matchedIds) {
    return (data.clocks || []).map((c) => publicClock(c, matchedIds.has(c.id)));
  }

  function collectSources(data, ids) {
    const out = [];
    const seen = new Set();
    for (const id of ids) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const s = sourceOf(data, id);
      if (s) out.push(s);
    }
    return out;
  }

  // A ZIP must arrive as text. A number loses leading zeros (Connecticut 06103 becomes 6103),
  // and a list or an object is not a ZIP, so each gets its own message instead of a guess.
  function inputError(input) {
    if (input == null || typeof input === 'string') return null;
    if (typeof input === 'number') return 'ZIP must be text, for example "06103", not the number ' + input + '. A number drops leading zeros.';
    const kind = Array.isArray(input) ? 'a list' : typeof input === 'object' ? 'an object' : typeof input;
    return 'ZIP must be text, for example "78704", not ' + kind + '.';
  }

  function lookup(data, input) {
    const bad = inputError(input);
    if (bad) return { errors: [bad], warnings: [], inputs_used: { zip: null }, result: null, sources: [] };
    const raw = text(input);
    const zip = normalizeZip(raw);
    if (!zip) {
      const shown = raw.length > 20 ? raw.slice(0, 20) + '...' : raw;
      return { errors: ['ZIP "' + shown + '" is not a 5-digit US ZIP code.'], warnings: [], inputs_used: { zip: raw }, result: null, sources: [] };
    }
    const rec = data.zips && data.zips[zip];
    const coverage = data.coverage || {};
    const shared = {
      zip,
      explainer: data.explainer || '',
      coverage_note: coverage.note || '',
      gaps: (coverage.gaps || []).concat(rec && coverage.gaps_by_state && Array.isArray(coverage.gaps_by_state[rec.state]) ? coverage.gaps_by_state[rec.state] : []),
    };
    if (!rec) {
      return {
        errors: [],
        warnings: ['This ZIP is not in the committed file (Texas, Illinois, Georgia, and Connecticut ZCTAs).'],
        inputs_used: { zip },
        sources: collectSources(data, ['openei-2024', 'census-zcta-county', 'census-zcta-place']),
        result: Object.assign(shared, {
          covered: false,
          state: null,
          utility: null,
          utilities: [],
          retail_marketers: [],
          county: null,
          place: null,
          ahj: null,
          solarapp: { on_list: null, display: UNKNOWN, pv: null, solar_plus_storage: null, file_modified: (data.solarapp || {}).file_modified || null, note: 'SolarAPP+ status is unknown because the ZIP is not covered.' },
          interconnection_path: { id: UNKNOWN, label: UNKNOWN, detail: 'The ZIP is not in the file, so the interconnection path is unknown.' },
          days_to_first_install: emptyDays(data),
          reference_clocks: referenceClocks(data, new Set()),
        }),
      };
    }

    const rc = retailChoice(data);
    const warnings = [];
    // OpenEI rows first, then any Power to Choose wires company OpenEI does not already name.
    // One entry per EIA number. The build already merges OpenEI's Bundled and Delivery rows; this guards older files.
    const base = [];
    for (const u of rec.utilities || []) {
      const same = base.find((b) => String(b.eia_id) === String(u.eia_id));
      if (!same) base.push(Object.assign({ source: 'openei-2024' }, u));
      else if (u.service_type && !String(same.service_type).split(' and ').includes(u.service_type)) same.service_type = String(same.service_type).split(' and ').concat(u.service_type).sort().join(' and ');
    }
    const tduKeys = Array.isArray(rec.tdus) ? rec.tdus : null;
    if (rc && tduKeys) {
      for (const key of tduKeys) {
        const t = rc.tdus[key];
        if (!t) continue;
        const known = base.find((u) => t.eia_id && String(u.eia_id) === String(t.eia_id));
        if (known) known.ptc_listed = true;
        else base.push({ name: t.name, eia_id: t.eia_id || UNKNOWN, ownership: t.ownership, service_type: 'Delivery', source: 'ptc', ptc_listed: true });
      }
    } else if (rc && rec.state === 'TX') {
      warnings.push('Power to Choose did not answer for this ZIP, so whether it is inside Texas retail choice is unknown.');
    }
    const utilities = base.map((u) => Object.assign({}, u, { path: pathFor(data, u, rec.state) }));
    let path;
    if (!utilities.length) {
      path = { id: UNKNOWN, label: UNKNOWN, detail: 'No wires utility is listed for this ZIP, so the interconnection path is unknown.', sources: ['openei-2024'] };
      if (rec.retail_marketers && rec.retail_marketers.length) {
        warnings.push('OpenEI lists ' + rec.retail_marketers.join(', ') + ' here as a retail power marketer. That is not the wires utility, so the utility is unknown.');
      } else if (rc && tduKeys) {
        warnings.push('Neither the OpenEI ZIP file nor Power to Choose names a wires utility here.');
      } else {
        warnings.push('The OpenEI ZIP file does not name a wires utility here.');
      }
    } else if (utilities.length === 1) {
      path = utilities[0].path;
    } else {
      const ids = new Set(utilities.map((u) => u.path.id));
      path = ids.size === 1
        ? Object.assign({}, utilities[0].path, { detail: utilities[0].path.detail + ' More than one utility is listed; each one has this same path.' })
        : { id: UNKNOWN, label: UNKNOWN, detail: 'More than one wires utility is listed, and they do not share a path. Each utility is listed with its own path.', sources: ['openei-2024'] };
      const choiceNames = utilities.filter((u) => u.ptc_listed).map((u) => u.name);
      const otherNames = utilities.filter((u) => !u.ptc_listed).map((u) => u.name);
      if (choiceNames.length && otherNames.length) {
        warnings.push('This ZIP is split. Power to Choose lists retail plans here over ' + choiceNames.join(' and ') + ', and OpenEI also lists ' + otherNames.join(', ') + '. Which one serves a home is on its electric bill.');
      } else {
        warnings.push('More than one wires utility is listed for this ZIP. Confirm the one on the bill.');
      }
    }

    const ahj = ahjFor(data, rec);
    const solar = solarappFor(data, ahj, rec.state);
    const days = estimateDays(data, utilities, rec.state);
    const matched = new Set(days.clocks.map((c) => c.id));
    const sourceIds = ['openei-2024', 'census-zcta-county', 'census-zcta-place', 'solarapp'];
    for (const u of utilities) for (const id of u.path.sources || []) sourceIds.push(id);
    for (const id of path.sources || []) sourceIds.push(id);
    if (rc && rec.state === 'TX') sourceIds.push('ptc');
    for (const c of days.clocks) sourceIds.push(c.source);

    const utility = utilities.length === 1 ? utilities[0] : null;
    return {
      errors: [],
      warnings,
      inputs_used: { zip },
      sources: collectSources(data, sourceIds),
      result: Object.assign(shared, {
        covered: true,
        state: rec.state,
        utility,
        utilities,
        retail_marketers: rec.retail_marketers || [],
        county: rec.county,
        place: rec.place || null,
        ahj,
        solarapp: solar,
        interconnection_path: { id: path.id, label: path.label, detail: path.detail },
        days_to_first_install: days,
        reference_clocks: referenceClocks(data, matched),
      }),
    };
  }

  const api = { UNKNOWN, normalizeZip, lookup, ahjFor, solarappFor, estimateDays, pathFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ZipLaunch = api;
})(typeof window !== 'undefined' ? window : globalThis);
