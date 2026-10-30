/* Independent offline replay. Public prices; synthetic devices and transport.
 * Reuses BaseCore's single-cycle planner, adapting its charge-side capacity
 * convention to symmetric physical charge/discharge losses. No device I/O. */
(function (root) {
  'use strict';
  const B = typeof module !== 'undefined' && module.exports ? require('./base-core.js') : root.BaseCore;
  const DEFAULTS = { capacity: 25, power: 5, efficiency: .88, reserve: .3, fleet: 100, affected: .3, seed: 42, fault: 'mixed', forecast: 'known' };
  const POLICIES = ['idle', 'clock', 'unguarded', 'guarded'];
  function config(input) {
    const o = Object.assign({}, DEFAULTS, input);
    for (const [key, lo, hi] of [['capacity', 1, 100], ['power', .1, 25], ['efficiency', .5, 1], ['reserve', 0, 1], ['fleet', 1, 500], ['affected', 0, 1], ['seed', 0, 4294967295]]) {
      if (!Number.isFinite(o[key]) || o[key] < lo || o[key] > hi) throw new RangeError(`Invalid ${key}`);
    }
    if (!Number.isInteger(o.fleet) || !Number.isInteger(o.seed)) throw new RangeError('Fleet and seed must be integers');
    if (!['none', 'duplicate', 'stale', 'late', 'mixed'].includes(o.fault) || !['known', 'shift'].includes(o.forecast)) throw new RangeError('Unknown scenario');
    return o;
  }
  function pricesValid(p) { if (!Array.isArray(p) || p.length !== 24 || !p.every(Number.isFinite)) throw new RangeError('Need 24 finite hourly prices'); }
  function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  function forecast(prices, kind) {
    pricesValid(prices);
    if (kind === 'known') return prices.slice();
    // A transparent synthetic timing error, not a trained forecast.
    return prices.map((_, h) => prices[(h + 21) % 24]);
  }
  function schedule(prices, o, policy) {
    const charge = Array(24).fill(0), discharge = Array(24).fill(0);
    if (policy === 'idle') return { charge, discharge };
    const eta = Math.sqrt(o.efficiency), usable = o.capacity * (1 - o.reserve);
    if (policy === 'clock') {
      let buy = Math.min(usable / eta, o.power * 5);
      let sell = buy * o.efficiency;
      for (let h = 0; h < 5; h++) { charge[h] = Math.min(o.power, buy); buy -= charge[h]; }
      for (let h = 17; h < 22; h++) { discharge[h] = Math.min(o.power, sell); sell -= discharge[h]; }
      return { charge, discharge };
    }
    return B.planDay(forecast(prices, o.forecast), { kwh: o.capacity / eta, kw: o.power, eff: o.efficiency, reservePct: o.reserve });
  }
  // Pure device-side command reducer. Idempotency covers applied IDs only;
  // retrying a previously rejected command is allowed inside its validity window.
  function applyCommand(device, command, now, o, guarded, telemetryAge) {
    if (!command || typeof command.id !== 'string' || !command.id || !['charge', 'discharge'].includes(command.kind) || !Number.isFinite(command.kwh) || command.kwh < 0 || !Number.isInteger(command.hour) || !Number.isInteger(command.expires) || command.expires <= command.hour || !Number.isFinite(now) || !Number.isFinite(telemetryAge) || telemetryAge < 0) throw new RangeError('Invalid command');
    const before = device.soc, eta = Math.sqrt(o.efficiency), floor = guarded ? o.capacity * o.reserve : 0;
    let reason = 'applied', charge = 0, discharge = 0;
    if (guarded && device.applied.has(command.id)) reason = 'duplicate ignored';
    else if (guarded && (now < command.hour || now >= command.expires)) reason = 'expired command';
    else if (guarded && telemetryAge > 1) reason = 'stale telemetry';
    else {
      // Aggregate hourly power limits apply across retries as well as commands.
      if (command.kind === 'charge') charge = Math.max(0, Math.min(command.kwh, o.power - device.charged, (o.capacity - device.soc) / eta));
      else discharge = Math.max(0, Math.min(command.kwh, o.power - device.discharged, (device.soc - floor) * eta));
      device.soc += charge * eta - discharge / eta;
      device.charged += charge; device.discharged += discharge;
      device.applied.add(command.id);
      if (charge + discharge < command.kwh - 1e-8) reason = guarded && command.kind === 'discharge' && device.soc <= floor + 1e-8 ? 'reserve limited' : 'physical limit';
    }
    return { before, after: device.soc, charge, discharge, reason };
  }
  function run(prices, input, policy) {
    pricesValid(prices); const o = config(input);
    if (!POLICIES.includes(policy)) throw new RangeError('Unknown policy');
    const plan = schedule(prices, o, policy), random = rng(o.seed), eta = Math.sqrt(o.efficiency), reserveKwh = o.capacity * o.reserve;
    const devices = Array.from({ length: o.fleet }, (_, i) => ({ id: i + 1, soc: reserveKwh, applied: new Set(), charged: 0, discharged: 0, affected: random() < o.affected, breached: false }));
    const trace = [], hours = [], matrix = devices.map(() => Array(24).fill('hold'));
    let cash = 0, purchased = 0, sold = 0, clipped = 0, rejected = 0, duplicates = 0, requested = 0;
    for (let h = 0; h < 24; h++) {
      const hour = { hour: h, scheduled: (plan.discharge[h] - plan.charge[h]) * o.fleet, delivered: 0, price: prices[h], minSoc: Infinity };
      for (const d of devices) {
        d.charged = 0; d.discharged = 0;
        const active = d.affected && h >= 16 && h <= 21;
        const stale = active && ['stale', 'mixed'].includes(o.fault);
        const age = stale ? h - 15 : 0;
        // Transport latency moves commands two hours, but never repeats them.
        const delayed = d.affected && ['late', 'mixed'].includes(o.fault);
        const candidates = [];
        for (let source = Math.max(0, h - 2); source <= h; source++) {
          const delay = delayed && source >= 16 && source <= 21 ? 2 : 0;
          if (source + delay !== h) continue;
          for (const kind of ['charge', 'discharge']) {
            const kwh = plan[kind][source];
            if (kwh > 1e-9) candidates.push({ id: `${d.id}:${source}:${kind}`, hour: source, expires: source + 1, kind, kwh });
          }
        }
        for (const c of candidates) {
          const retry = d.affected && c.hour >= 16 && c.hour <= 21 && ['duplicate', 'mixed'].includes(o.fault);
          for (let attempt = 1; attempt <= (retry ? 2 : 1); attempt++) {
            const r = applyCommand(d, c, h, o, policy === 'guarded', age);
            cash += (r.discharge - r.charge) * prices[h] / 1000;
            purchased += r.charge; sold += r.discharge;
            if (attempt === 1) { requested += c.kwh; clipped += Math.max(0, c.kwh - r.charge - r.discharge); }
            if (r.reason === 'duplicate ignored') duplicates++;
            if (['expired command', 'stale telemetry'].includes(r.reason)) rejected++;
            trace.push({ device: d.id, hourEnding: h + 1, commandHourEnding: c.hour + 1, commandId: c.id, attempt, requestedKwh: c.kwh, chargeKwh: r.charge, dischargeKwh: r.discharge, socBefore: r.before, socAfter: r.after, telemetryAgeHours: age, reason: r.reason, price: prices[h] });
          }
        }
        if (d.soc < reserveKwh - 1e-8) d.breached = true;
        hour.delivered += d.discharged - d.charged;
        hour.minSoc = Math.min(hour.minSoc, d.soc);
        matrix[d.id - 1][h] = d.soc < reserveKwh - 1e-8 ? 'breach' : stale && policy === 'guarded' ? 'stale' : d.discharged > 1e-8 ? 'discharge' : d.charged > 1e-8 ? 'charge' : 'hold';
      }
      hours.push(hour);
    }
    const endSoc = devices.reduce((s, d) => s + d.soc, 0), initialSoc = reserveKwh * o.fleet;
    const inventoryMark = (endSoc - initialSoc) * eta * prices[23] / 1000;
    const totalCharge = purchased * eta, totalDischarge = sold / eta;
    return { policy, config: o, cash, inventoryMark, markedValue: cash + inventoryMark, purchased, sold, requested, clipped, rejected, duplicates, reserveBreaches: devices.filter(d => d.breached).length, affectedDevices: devices.filter(d => d.affected).length, endSoc, initialSoc, lossKwh: purchased - totalCharge + totalDischarge - sold, balanceError: endSoc - initialSoc - totalCharge + totalDischarge, hours, matrix, trace };
  }
  function compare(prices, input) { return POLICIES.map(p => run(prices, input, p)); }
  function csv(result) {
    const keys = ['device','hourEnding','commandHourEnding','commandId','attempt','requestedKwh','chargeKwh','dischargeKwh','socBefore','socAfter','telemetryAgeHours','reason','price'];
    return keys.join(',') + '\n' + result.trace.map(r => keys.map(k => typeof r[k] === 'number' ? Number(r[k].toFixed(8)) : r[k]).join(',')).join('\n') + '\n';
  }
  const api = { DEFAULTS, POLICIES, config, forecast, schedule, applyCommand, run, compare, csv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DispatchBench = api;
})(typeof window !== 'undefined' ? window : globalThis);
