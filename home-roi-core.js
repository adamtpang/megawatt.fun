/* Home battery ROI: one Texas home, one battery.
   Pure, no DOM. The page (home.js), POST /api/v1/home and the tests all call evaluate().
   Zone ranking reuses market-core.js. State context reuses market-score.js when those
   files are passed in. Debt, payback and IRR reuse finance-core.js. Nothing here invents
   a price or a dollar that is not in the data passed in. */
(function (root) {
  'use strict';

  const MC = typeof require === 'function' ? require('./market-core.js') : root.MarketCore;
  const F = typeof require === 'function' ? require('./finance-core.js') : root.FinanceCore;
  const ZL = typeof require === 'function' ? require('./zip-launch-core.js') : root.ZipLaunch;
  const MS = typeof require === 'function' ? require('./market-score.js') : root.MarketScore;

  const PRESETS = {
    bungalow: {
      id: 'bungalow',
      label: 'Small bungalow',
      stories: 1,
      annualKwh: 9000,
      kwhKind: 'assumption',
      kwhNote: 'A round figure below the 2024 Texas residential average. No public bungalow total is in this repo, so this is an assumption.',
    },
    suburban: {
      id: 'suburban',
      label: '2-story suburban',
      stories: 2,
      annualKwh: 1097 * 12,
      kwhKind: 'sourced',
      kwhNote: '1,097 kWh a month times 12. That monthly figure is the 2024 Texas residential average used in finance-defaults.json (EIA-861).',
    },
    ranch: {
      id: 'ranch',
      label: 'Large ranch',
      stories: 1,
      annualKwh: 18000,
      kwhKind: 'assumption',
      kwhNote: 'A round figure above the 2024 Texas residential average. No public ranch total is in this repo, so this is an assumption.',
    },
  };

  /* Wires company to the load zones named for it in data/zone-value.json "who".
     A list of one zone is definite. A longer list means the company spans those zones
     and a ZIP is not enough to pick. A company that is not in this table is not assigned. */
  const TDU_ZONES = {
    centerpoint: ['LZ_HOUSTON'],
    aep_central: ['LZ_SOUTH'],
    aep_north: ['LZ_WEST'],
    oncor: ['LZ_NORTH', 'LZ_WEST'],
    tnmp: ['LZ_NORTH', 'LZ_WEST'],
  };

  /* NOIEs named in ERCOT's NPRR 932 list and in zone-value.json. Matched on the OpenEI name. */
  const UTILITY_ZONES = [
    { test: (name) => /austin energy/i.test(name), zone: 'LZ_AEN', who: 'Austin Energy' },
    { test: (name) => /san antonio/i.test(name), zone: 'LZ_CPS', who: 'CPS Energy (City Public Service)' },
  ];

  const ZONE_SOURCE = {
    url: '/data/zone-value.json',
    publicUrl: 'https://www.ercot.com/files/docs/2019/06/14/932NPRR-04_PRS_Report_061319.doc',
    retrieved: '2026-11-04',
  };

  function fieldMap(defaults) {
    const out = {};
    (defaults.groups || []).forEach((g) => (g.fields || []).forEach((f) => { out[f.key] = f; }));
    return out;
  }

  function rawFromDefaults(defaults) {
    const raw = { revenueCase: defaults.revenueCaseDefault || 'merchant' };
    Object.values(fieldMap(defaults)).forEach((f) => { raw[f.key] = f.value; });
    return raw;
  }

  function presetOf(id) {
    const key = String(id || 'suburban').trim().toLowerCase();
    return PRESETS[key] || null;
  }

  function clockHours(zoneValue) {
    const s = (zoneValue && zoneValue.schedule) || {};
    const span = (pair) => {
      if (!Array.isArray(pair) || pair.length !== 2) return [];
      const out = [];
      for (let h = pair[0]; h < pair[1]; h++) out.push(h + 1);
      return out;
    };
    return { charge: span(s.charge), discharge: span(s.discharge), label: s.label || '' };
  }

  function zonesById(zoneValue) {
    const map = new Map();
    ((zoneValue && zoneValue.zones) || []).forEach((z) => map.set(z.id, z));
    return map;
  }

  /* Where one battery earns most: the public zone file, best first, via MarketCore.applyZones. */
  function rankZones(zoneValue) {
    return MC.applyZones(zoneValue, {}).zones;
  }

  function utilityRule(name) {
    return UTILITY_ZONES.find((r) => r.test(name)) || null;
  }

  function describeRecord(record) {
    const tdus = Array.isArray(record.tdus) ? record.tdus.slice() : [];
    const utilities = (record.utilities || []).map((u) => u && u.name).filter(Boolean);
    const place = record.place && record.place.name;
    const county = record.county && record.county.name;
    return { tdus, utilities, place: place || null, county: county || null, state: record.state || null };
  }

  /* Candidates for one ZIP record. status is 'mapped', 'choose' or 'unmapped'. */
  function zonesForRecord(record) {
    const info = describeRecord(record);
    const definite = [];
    const maybe = [];
    const why = [];
    info.tdus.forEach((key) => {
      const zones = TDU_ZONES[key];
      if (!zones) {
        why.push(key + ' is a wires company in the ZIP file, and no load zone is named for it in zone-value.json.');
        return;
      }
      if (zones.length === 1) {
        definite.push(zones[0]);
        why.push(key + ' is named only under ' + zones[0] + ' in zone-value.json.');
      } else {
        zones.forEach((z) => { if (!maybe.includes(z)) maybe.push(z); });
        why.push(key + ' is named under ' + zones.join(' and ') + ' in zone-value.json, so the ZIP does not pick one.');
      }
    });
    info.utilities.forEach((name) => {
      const rule = utilityRule(name);
      if (!rule) return;
      definite.push(rule.zone);
      why.push(name + ' is ' + rule.who + ', load zone ' + rule.zone + '.');
    });
    const unique = (list) => list.filter((z, i) => list.indexOf(z) === i);
    const def = unique(definite);
    const may = unique(maybe).filter((z) => !def.includes(z));
    if (def.length === 1 && may.length === 0) {
      return { status: 'mapped', zone: def[0], candidates: def, why, info, kind: 'partly sourced' };
    }
    const candidates = unique(def.concat(may));
    if (candidates.length) {
      return { status: 'choose', zone: null, candidates, why, info, kind: 'partly sourced' };
    }
    if (!info.tdus.length && !info.utilities.length) {
      why.push('The ZIP file names no wires company here.');
    } else if (!info.tdus.length) {
      why.push('No ERCOT retail-choice wires company is listed, and none of the named utilities is a NOIE load zone in zone-value.json.');
    }
    return { status: 'unmapped', zone: null, candidates: [], why, info, kind: 'assumption' };
  }

  function lookupZip(zips, query) {
    const text = String(query == null ? '' : query).trim();
    if (!text) return { error: 'Enter a Texas address or ZIP.' };
    const direct = ZL.normalizeZip(text);
    if (direct) {
      const record = zips[direct];
      if (!record) return { error: 'ZIP ' + direct + ' is not in data/zip-launch.json.' };
      return { zip: direct, record, matched: 'zip' };
    }
    const embedded = text.match(/\b(\d{5})(?:-\d{4})?\b/);
    if (embedded && zips[embedded[1]]) return { zip: embedded[1], record: zips[embedded[1]], matched: 'zip' };
    if (embedded && !zips[embedded[1]]) return { error: 'ZIP ' + embedded[1] + ' is not in the Texas file.' };
    const needle = text.toLowerCase().replace(/,/g, ' ').replace(/\b(texas|tx|usa)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const hits = [];
    Object.keys(zips).forEach((zip) => {
      const rec = zips[zip];
      if (!rec || rec.state !== 'TX' || !rec.place || !rec.place.name) return;
      const place = String(rec.place.name).toLowerCase().replace(/\s+(city|town|village|cdp)$/i, '');
      if (place === needle) hits.push({ zip, record: rec });
    });
    if (!hits.length) return { error: 'No Texas ZIP or place named "' + text.slice(0, 80) + '" is in the file. Enter a 5-digit ZIP.' };
    return { matches: hits, matched: 'place' };
  }

  function resolvePlace(zips, query) {
    const found = lookupZip(zips, query);
    if (found.error) return found;
    if (found.record) {
      if (found.record.state !== 'TX') return { error: 'ZIP ' + found.zip + ' is in ' + found.record.state + '. This tool starts with Texas, inside ERCOT.' };
      return Object.assign({ resolution: zonesForRecord(found.record) }, found);
    }
    const resolutions = found.matches.map((hit) => zonesForRecord(hit.record));
    const mapped = resolutions.filter((r) => r.status === 'mapped').map((r) => r.zone);
    const unique = mapped.filter((z, i) => mapped.indexOf(z) === i);
    if (found.matches.length && unique.length === 1 && resolutions.every((r) => r.status === 'mapped' && r.zone === unique[0])) {
      return { zip: found.matches[0].zip, record: found.matches[0].record, matched: 'place', placeCount: found.matches.length, resolution: resolutions[0] };
    }
    return { error: 'That place covers more than one ERCOT situation. Enter a 5-digit ZIP.', placeCount: found.matches.length };
  }

  function retailFor(preset, defaults) {
    const field = fieldMap(defaults).retailMarginMonthly;
    const base = field ? field.value : 0;
    const stateKwh = PRESETS.suburban.annualKwh;
    if (preset.annualKwh === stateKwh) {
      return { usdPerMonth: base, kind: 'partly sourced', note: field ? field.note : '' };
    }
    const scaled = Math.round(base * preset.annualKwh / stateKwh);
    return {
      usdPerMonth: scaled,
      kind: 'partly sourced',
      note: 'The statewide margin is $' + base + ' a month at ' + stateKwh.toLocaleString('en-US') + ' kWh a year. This home is ' + preset.annualKwh.toLocaleString('en-US') + ' kWh a year (' + preset.kwhKind + '), so the margin is scaled by that ratio and rounded to the dollar. ' + preset.kwhNote,
    };
  }

  function attachCurve(zoneValue, curve) {
    const clock = clockHours(zoneValue);
    if (!curve || !Array.isArray(curve.hours)) return { clock, day: null };
    return {
      clock,
      day: {
        settlementPoint: curve.settlement_point,
        market: curve.market,
        deliveryDate: curve.delivery_date,
        downloaded: curve.downloaded,
        source: curve.source,
        units: curve.units,
        kind: 'sourced',
        note: 'This day is the picture behind the house. It is a Houston hub day-ahead curve, not the load-zone year the earnings use.',
        hours: curve.hours.map((h) => ({ hourEnding: h.hour_ending, usdMwh: h.usd_mwh })),
      },
    };
  }

  function historicalFor(financing, zoneId) {
    const block = financing && financing.zones && financing.zones[zoneId];
    if (!block) return null;
    return {
      kind: 'sourced',
      countedInLoan: false,
      p50Usd: block.p50_usd,
      worstUsd: block.worst_usd,
      worstYear: block.worst_year,
      bestYear: block.best_year,
      years: (block.years || []).map((y) => y.year),
      note: 'ERCOT day-ahead load-zone prices, report 13060, 2018 through 2025, from data/financing.json. A different dispatch than the real-time clock, so it is not added to the loan.',
    };
  }

  function stateContext(expansion, marketStates) {
    if (!expansion || !marketStates || !MS || !MS.scoreStates) return null;
    const scored = MS.scoreStates(expansion, marketStates);
    const tx = (scored.states || []).find((s) => s.abbr === 'TX');
    if (!tx) return null;
    return {
      kind: 'sourced',
      rank: tx.rank,
      of: scored.states.length,
      points: tx.points,
      tier: tx.tier,
      why: tx.why,
      note: 'This is the public state score (where a home-battery program fits). It is not what one battery earns.',
    };
  }

  function moneyTag(kind, label, value, extra) {
    return Object.assign({ kind, label, value }, extra || {});
  }

  /* input: { query, preset, zone, revenueCase, fleetCount }
     data: { zips, zoneValue, defaults, curve, financing, expansion, marketStates } */
  function evaluate(input, data) {
    const inp = input || {};
    const dataIn = data || {};
    const errors = [];
    const preset = presetOf(inp.preset || 'suburban');
    if (!preset) errors.push('Unknown home preset. Use bungalow, suburban or ranch.');
    if (!dataIn.zips || !dataIn.zoneValue || !dataIn.defaults) errors.push('Public data is missing.');
    if (errors.length) return { ok: false, errors };

    const cases = F.CASES;
    const revenueCase = Object.prototype.hasOwnProperty.call(cases, inp.revenueCase) ? inp.revenueCase : (dataIn.defaults.revenueCaseDefault || 'merchant');
    const fields = fieldMap(dataIn.defaults);
    let fleetCount = fields.fleetCount ? fields.fleetCount.value : 1000;
    if (inp.fleetCount != null && String(inp.fleetCount).trim() !== '') {
      const n = F.parseDecimal(inp.fleetCount);
      const why = fields.fleetCount ? F.fieldError(fields.fleetCount, n) : null;
      if (!Number.isFinite(n) || why) errors.push('Fleet size ' + (why || 'must be a whole number') + '.');
      else fleetCount = n;
    }
    if (errors.length) return { ok: false, errors };

    const found = resolvePlace(dataIn.zips, inp.query);
    if (found.error) return { ok: false, errors: [found.error] };

    const byId = zonesById(dataIn.zoneValue);
    const ranked = rankZones(dataIn.zoneValue);
    let resolution = found.resolution;
    let zoneBasis = resolution.kind;
    const wanted = inp.zone != null && String(inp.zone).trim() !== '' ? String(inp.zone).trim().toUpperCase() : '';
    if (wanted) {
      if (!byId.has(wanted)) return { ok: false, errors: ['Unknown load zone "' + wanted + '". Use one of ' + ranked.map((z) => z.id).join(', ') + '.'] };
      if (resolution.status !== 'mapped' || resolution.zone !== wanted) zoneBasis = 'assumption';
      resolution = Object.assign({}, resolution, { status: 'mapped', zone: wanted, chosen: true });
    }
    if (resolution.status !== 'mapped') {
      return {
        ok: true,
        needsZone: true,
        zip: found.zip,
        matched: found.matched,
        preset,
        resolution,
        zones: ranked.map((z, i) => ({ id: z.id, rank: i + 1, usdPerYear: z.usdPerYear, market: z.market, who: z.who })),
        errors: [],
      };
    }

    const zone = byId.get(resolution.zone);
    const retail = retailFor(preset, dataIn.defaults);
    const raw = rawFromDefaults(dataIn.defaults);
    raw.revenueCase = revenueCase;
    raw.arbPerYear = zone.usdPerYear;
    raw.zone = zone.id;
    raw.zoneMarket = zone.market;
    raw.retailMarginMonthly = retail.usdPerMonth;
    raw.fleetCount = fleetCount;
    const sized = F.sizeDebt(F.normalize(raw));
    const fleet = F.fleet(sized, fleetCount);
    const mw = F.batteriesForMw(100, sized.kw || raw.kw);
    const fleet100 = F.fleet(sized, mw);
    const basis = F.lineBasis(dataIn.defaults, null);
    if (preset.id !== 'suburban') basis.retail = 'derived';
    const explained = F.explain(sized, { basis, retailDefault: fields.retailMarginMonthly ? fields.retailMarginMonthly.value : retail.usdPerMonth });
    const rank = ranked.findIndex((z) => z.id === zone.id) + 1;
    const tollUsd = (raw.tollPerKwYear || 0) * (raw.kw || 0) * ((raw.availabilityPct || 0) / 100);
    const ancUsd = (raw.ancPerKwYear || 0) * (raw.kw || 0) * ((raw.availabilityPct || 0) / 100);
    const reserve = dataIn.zoneValue.spec && dataIn.zoneValue.spec.reserve;
    const u = sized.returns.unlevered;
    const simpleRoi = u.invest > 0 ? u.net / u.invest : null;
    const curve = attachCurve(dataIn.zoneValue, dataIn.curve);

    const earnings = {
      arbitrage: moneyTag('partly sourced', 'Energy arbitrage', zone.usdPerYear, {
        counted: sized.counted.arb > 0,
        countedUsd: sized.counted.arb,
        note: F.ARB_BASIS_TEXT + ' Period ' + dataIn.zoneValue.period.start + ' to ' + dataIn.zoneValue.period.endExclusive + ' (file built ' + dataIn.zoneValue.built + ').',
        source: 'https://www.ercot.com/mktinfo/prices',
      }),
      backup: moneyTag('assumption', 'Backup value', 0, {
        counted: false,
        reserve,
        note: 'The price replay holds back a ' + Math.round((reserve || 0) * 100) + '% reserve (an assumption in zone-value.json). No public outage dollar is in that file, so backup adds $0 of cash flow. The reserve already lowers the arbitrage, because that energy is not sold.',
      }),
      toll: moneyTag('assumption', 'Utility toll', tollUsd, {
        counted: sized.counted.toll > 0,
        countedUsd: sized.counted.toll,
        perKwYear: raw.tollPerKwYear,
        note: fields.tollPerKwYear ? fields.tollPerKwYear.note : 'Assumption.',
      }),
      ancillary: moneyTag('assumption', 'Ancillary services', ancUsd, {
        counted: sized.counted.anc > 0,
        countedUsd: sized.counted.anc,
        note: fields.ancPerKwYear ? fields.ancPerKwYear.note : 'Left at $0.',
      }),
    };

    return {
      ok: true,
      needsZone: false,
      errors: [],
      zip: found.zip,
      matched: found.matched,
      placeCount: found.placeCount || 1,
      preset: {
        id: preset.id,
        label: preset.label,
        stories: preset.stories,
        annualKwh: preset.annualKwh,
        kwhKind: preset.kwhKind,
        kwhNote: preset.kwhNote,
        model: '/models/house-' + preset.id + '.glb',
      },
      home: resolution.info,
      zone: {
        id: zone.id,
        rank,
        of: ranked.length,
        usdPerYear: zone.usdPerYear,
        market: zone.market,
        who: zone.who,
        kind: zoneBasis,
        noChoice: sized.noChoice,
        best: { id: ranked[0].id, usdPerYear: ranked[0].usdPerYear },
        why: resolution.why,
      },
      revenueCase: { id: sized.caseId, label: sized.caseLabel },
      earnings,
      retail: retail,
      returns: {
        paybackYear: u.paybackYear,
        paysBack: u.paysBack,
        lifeYears: sized.life,
        simpleRoi,
        irr: u.irr,
        npv: u.npv,
        discountRate: sized.returns.discountRate,
        netCost: sized.netCapex,
        kind: 'partly sourced',
        note: 'Payback, simple ROI and IRR come from finance-core.js on the cash flows above. Simple ROI is undiscounted profit divided by net cost. The mix of sourced prices and assumed loan terms makes the result partly sourced.',
      },
      debt: {
        perBattery: sized.debt,
        equity: sized.equity,
        binding: sized.binding,
        bindingText: F.bindingText(sized),
        debtService: sized.debtService,
        minDscr: sized.minDscr,
        dscrTarget: sized.dscrTarget,
        fleetCount,
        fleetDebt: fleet.debt,
        batteriesPer100Mw: mw,
        debtPer100Mw: fleet100.debt,
        kind: 'partly sourced',
      },
      explain: explained,
      historical: historicalFor(dataIn.financing, zone.id),
      state: stateContext(dataIn.expansion, dataIn.marketStates),
      curve,
      spec: dataIn.zoneValue.spec,
      sources: sourcesFor(dataIn, zone, preset),
    };
  }

  function sourcesFor(dataIn, zone, preset) {
    const period = dataIn.zoneValue.period;
    const list = [
      { id: 'rt-prices', kind: 'sourced', label: 'ERCOT real-time load-zone prices', url: 'https://www.ercot.com/mktinfo/prices', dated: period.start + ' to ' + period.endExclusive, retrieved: dataIn.zoneValue.built },
      { id: 'zone-file', kind: 'partly sourced', label: 'Fixed-clock arbitrage for one 20 kW / 39.2 kWh battery', url: '/data/zone-value.json', dated: period.asOf, retrieved: dataIn.zoneValue.built },
      { id: 'zip', kind: 'sourced', label: 'ZIP, place, and wires company', url: '/data/zip-launch.json', dated: null, retrieved: dataIn.zipGenerated || null },
      { id: 'noie', kind: 'sourced', label: 'NOIE load zones (Austin Energy, CPS, Rayburn, LCRA)', url: ZONE_SOURCE.publicUrl, dated: '2019-06-13', retrieved: ZONE_SOURCE.retrieved },
      { id: 'capex', kind: 'sourced', label: 'Installed cost basis', url: 'https://static-cdn.publive.online/saur-energy/media/pdf_files/2023/10u.s.-solar-photovoltaic-system-and-energy-storage-cost-benchmarks-with-minimum-sustainable-price-analysis_-q1-2023.pdf', dated: 'Q1 2023', retrieved: '2026-11-04' },
    ];
    if (preset.kwhKind === 'sourced') {
      list.push({ id: 'usage', kind: 'sourced', label: 'Texas residential use', url: 'https://www.eia.gov/electricity/data/eia861/', dated: '2024', retrieved: '2026-11-04' });
    } else {
      list.push({ id: 'usage', kind: 'assumption', label: preset.label + ' annual kWh', url: null, dated: null, retrieved: null, note: preset.kwhNote });
    }
    if (dataIn.curve) {
      list.push({ id: 'curve', kind: 'sourced', label: 'Day shown on the house', url: dataIn.curve.source, dated: dataIn.curve.delivery_date, retrieved: dataIn.curve.downloaded });
    }
    if (dataIn.financing && dataIn.financing.zones && dataIn.financing.zones[zone.id]) {
      list.push({ id: 'dam-history', kind: 'sourced', label: 'Day-ahead load-zone history (not in the loan)', url: 'https://www.ercot.com/mp/data-products/data-product-details?id=NP4-180-ER', dated: '2018-2025', retrieved: dataIn.financing.generated || null });
    }
    list.push({ id: 'zone-' + zone.id, kind: 'partly sourced', label: zone.id + ' footprint', url: '/data/zone-value.json', note: zone.who });
    return list;
  }

  const api = { PRESETS, TDU_ZONES, evaluate, resolvePlace, zonesForRecord, rankZones, clockHours, presetOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HomeRoiCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
