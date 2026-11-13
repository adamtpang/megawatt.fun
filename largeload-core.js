/* What a large load pays for power in Texas: the math behind /data-centers. Pure: no DOM, no network.
   Input is data/datacenter-ercot.json (scripts/datacenter-ercot.py). Used by largeload.js (window.LargeLoadCore)
   and the Node tests. (datacenter-core.js is a different, older file used by the Texas siting page.) */
(function (root) {
  'use strict';

  const HOURS = 8760;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const DEFAULTS = { mw: 100, runPct: 90, peaksAvoidedPct: 0, skipHours: 0 };
  const LIMITS = { mw: [1, 5000], runPct: [1, 100], peaksAvoidedPct: [0, 100] };

  function inputs(raw, steps) {
    const r = raw || {};
    const n = (k) => { const v = Number(r[k]); return Number.isFinite(v) ? clamp(v, LIMITS[k][0], LIMITS[k][1]) : DEFAULTS[k]; };
    const skip = Number(r.skipHours);
    return { mw: n('mw'), runPct: n('runPct'), peaksAvoidedPct: n('peaksAvoidedPct'), skipHours: steps.indexOf(skip) >= 0 ? skip : 0 };
  }

  /* A year's power bill for one site.
     - Energy: every hour at the zone's real-time price, less the priciest N hours if the site sits those out.
     - Transmission: the wires company's charge per kW of the site's demand in the four summer peak hours,
       billed every month. A site that is off the grid in those hours pays less.
     - Delivery and fixed charges: small, from the same tariff.
     Counted only where the tariff applies: in a city utility or co-op zone the wires charges are null, not zero. */
  function bill(data, zoneId, raw) {
    const p = inputs(raw, data.steps), z = data.zones.find((x) => x.id === zoneId), t = data.tariff;
    const run = p.runPct / 100, runMw = p.mw * run;
    const skipped = data.steps.indexOf(p.skipHours) >= 0 ? z.topHoursSumUsdPerMw[data.steps.indexOf(p.skipHours)] : 0;
    const energyFull = runMw * HOURS * z.avgRtUsdPerMwh;
    const energySaved = runMw * skipped;
    const mwh = runMw * (HOURS - p.skipHours);
    const tariffApplies = z.choice === 'open';
    const peakKw = runMw * 1000 * (1 - p.peaksAvoidedPct / 100);
    const perMwYear = t.per4cpKwMonthUsd * 12 * 1000;
    const transmission = tariffApplies ? peakKw * t.per4cpKwMonthUsd * 12 : null;
    const transmissionFull = tariffApplies ? runMw * 1000 * t.per4cpKwMonthUsd * 12 : null;
    const delivery = tariffApplies ? p.mw * 1000 * t.perBillingKwMonthUsd * 12 : null;
    const fixed = tariffApplies ? (t.customerMonthUsd + t.meteringMonthUsd) * 12 : null;
    const energy = energyFull - energySaved;
    const total = energy + (transmission || 0) + (delivery || 0) + (fixed || 0);
    return {
      inputs: p, zone: z, tariffApplies, mwh,
      energyUsd: energy, energyFullUsd: energyFull, energySavedUsd: energySaved,
      transmissionUsd: transmission, transmissionSavedUsd: tariffApplies ? transmissionFull - transmission : null,
      deliveryUsd: delivery, fixedUsd: fixed, totalUsd: total,
      perKwhUsd: mwh > 0 ? total / (mwh * 1000) : null,
      transmissionPerMwYearUsd: perMwYear,                // what one MW of peak demand costs in a year, at this tariff
      peakHoursShare: data.peaks.hours.length / HOURS,     // the four peak hours as a share of the year
    };
  }

  // Zones from cheapest average price to dearest, with the gap to the cheapest for a site of this size.
  function compare(data, raw) {
    const rows = data.zones.map((z) => { const b = bill(data, z.id, raw); return { id: z.id, name: z.name, choice: z.choice, avg: z.avgRtUsdPerMwh, energyUsd: b.energyUsd, hoursOver200: z.hoursOver200, max: z.maxRtUsdPerMwh }; })
      .sort((a, b) => a.energyUsd - b.energyUsd);
    return rows.map((r) => Object.assign(r, { overCheapestUsd: r.energyUsd - rows[0].energyUsd }));
  }

  const api = { bill, compare, inputs, DEFAULTS, LIMITS, HOURS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LargeLoadCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
