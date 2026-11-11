/* PJM value of one home battery, by utility zone. Pure functions, shared by pjm.html, api/v1/pjm.js and tests.
   Three value streams, the ones Base names in its Pennsylvania PUC comments (P-2026-3065185, Nov 2026):
   1. Energy: a fixed daily clock at the zone's real-time price (backtested offline into data/pjm-value.json).
      Today a battery behind a home meter can only serve that home's load, so energy is capped at the home
      load (energyByKw). Full 20 kW exports (energyExportUsdPerYear) need PJM's DER aggregator model (Feb 2028).
   2. Capacity: lowering the home's peak load contribution (PLC tag) x the PJM capacity price.
   3. Transmission: lowering the home's network service peak load (NSPL tag) x the zone's NITS rate, and 0
      where transmission is a nonbypassable utility charge (zone.transmission.bypassable === false).
   Tag value is only reachable where the utility sets the tag from the home's own interval meter and the
   load-serving entity (a retail supplier, or a utility partner) is the one billed for it. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PjmCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const DEFAULTS = Object.freeze({
    tagKw: 3,               // home load the battery covers in the evening and at peaks, kW (assumption)
    capacityUsdPerMwDay: 333.44, // PJM 2027/2028 BRA: the year summer 2026 tags are paid in
    capacityScale: 1,       // zonal scaling factor x forecast pool requirement, folded into one multiplier
    hitRate: 1,             // share of tag-setting peak hours the battery actually covers
    includeEnergy: true, includeCapacity: true, includeTransmission: true,
    allowExports: false,    // true: full 20 kW exports at the zone price (PJM DER aggregation, from Feb 2028)
  });
  const LIMITS = { tagKw: [0, 8], capacityUsdPerMwDay: [0, 2000], capacityScale: [0, 2], hitRate: [0, 1] };

  function inputs(raw) {
    const out = { ...DEFAULTS }, errors = [];
    for (const [k, v] of Object.entries(raw || {})) {
      if (!(k in DEFAULTS)) continue;
      if (typeof DEFAULTS[k] === 'boolean') { out[k] = v === true || v === 'true' || v === 1 || v === '1'; continue; }
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      const [lo, hi] = LIMITS[k];
      if (String(v).trim() === '' || !Number.isFinite(n) || n < lo || n > hi) errors.push(`${k} must be a number from ${lo} to ${hi}.`);
      else out[k] = n;
    }
    return { inputs: out, errors };
  }

  // Dollars a year per kW of tag reduction.
  const capacityPerKwYear = (p) => (p.capacityUsdPerMwDay * 365 * p.capacityScale) / 1000;
  const transmissionPerKwYear = (zone) => (zone.transmission && zone.transmission.bypassable === false ? 0 : (zone.nitsUsdPerMwYear || 0) / 1000);

  // Energy for a home load of kw: the backtest at the nearest 0.5 kW step (built offline), 0 at 0 kW.
  function energyFor(zone, kw, allowExports) {
    if (allowExports) return zone.energyExportUsdPerYear;
    if (!(kw > 0)) return 0;
    const steps = Object.keys(zone.energyByKw || {}).map(Number).sort((a, b) => a - b);
    if (!steps.length) return 0;
    const k = steps.reduce((best, s) => (Math.abs(s - kw) < Math.abs(best - kw) ? s : best), steps[0]);
    return zone.energyByKw[k];
  }

  function valueZone(zone, raw) {
    const { inputs: p } = inputs(raw);
    const kw = p.tagKw * p.hitRate;
    const energy = p.includeEnergy ? energyFor(zone, p.tagKw, p.allowExports) : 0;
    const capacity = p.includeCapacity ? kw * capacityPerKwYear(p) : 0;
    const transmission = p.includeTransmission ? kw * transmissionPerKwYear(zone) : 0;
    const r = (x) => Math.round(x * 100) / 100;
    return { id: zone.id, energy: r(energy), capacity: r(capacity), transmission: r(transmission), total: r(energy + capacity + transmission) };
  }

  function rank(zones, raw) {
    return zones.map((z) => ({ zone: z, value: valueZone(z, raw) })).sort((a, b) => b.value.total - a.value.total || a.zone.id.localeCompare(b.zone.id));
  }

  return { DEFAULTS, LIMITS, inputs, capacityPerKwYear, transmissionPerKwYear, energyFor, valueZone, rank };
});
