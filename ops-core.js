/* Synthetic deployment study; MIT Airsup DES engine is kept separate and credited. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { require('./vendor/airsup/des.js'); module.exports = factory(globalThis.FactorySkill); }
  else root.DeploymentOps = factory(root.FactorySkill);
})(globalThis, function (FS) {
  'use strict';
  const DEFAULTS = Object.freeze({ crews: 6, commissioning: 2, installHours: 3, buffer: 12, target: 24, seed: 11 });
  const STAGES = [
    ['review', 'Site review', .5, 3, 'Review an already eligible site. Permits and customer scheduling are outside this model.'],
    ['prep', 'Battery prep', .75, 4, 'Allocate a battery and kit. Assumes replenished material; no supply forecast.'],
    ['delivery', 'Delivery', 1, 5, 'Aggregate delivery service time. No street routing or truck optimization.'],
    ['install', 'Installation', 3, 6, 'One crew per job. No shared workforce or travel-time optimization.'],
    ['commission', 'Commissioning', .75, 2, 'One commissioning resource per job. No actual utility approval feed.'],
    ['fleet', 'Fleet enrollment', .25, 2, 'Completed installation becomes a modeled fleet member; no telemetry connection.']
  ];
  function parameters(input = {}) {
    const p = { ...DEFAULTS, ...input };
    for (const key of Object.keys(p)) if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`Unknown setting: ${key}`);
    for (const [key, min, max, integer] of [['crews', 1, 24, true], ['commissioning', 1, 12, true], ['installHours', .5, 12, false], ['buffer', 1, 60, true], ['target', 1, 100, true], ['seed', 1, 2147483647, true]]) {
      if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max || (integer && !Number.isInteger(p[key]))) throw new Error(`${key} must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`);
    }
    return p;
  }
  function spec(input = {}) {
    const p = parameters(input);
    return { id: 'deployment-ops', title: 'From battery to backup', product: { name: 'installation', unit: 'homes', perToken: 1 },
      demand: { perDay: p.target }, calendar: { shifts: 1, hoursPerShift: 8, startHour: 8 },
      sizing: { targetUtil: .85 }, release: 'capacity', seed: p.seed,
      stations: STAGES.map(([id, name, hours, servers, note]) => ({ id, name, ct: (id === 'install' ? p.installHours : hours) * 3600,
        servers: id === 'install' ? p.crews : id === 'commission' ? p.commissioning : servers,
        cv: .1, buffer: p.buffer, batch: 1, yield: 1, note: `Synthetic assumption. ${note}`,
        mtbf: id === 'install' ? 40 * 3600 : 0, mttr: id === 'install' ? 3600 : 0 })) };
  }
  function create(input = {}) { const plan = FS.plan(spec(input)); return { plan, sim: new FS.Sim(plan) }; }
  function forecast(input = {}, days = 30) {
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Forecast horizon must be 1–90 production days.');
    const { plan, sim } = create(input);
    sim.runUntil(Math.max(.5 * plan.daySec, plan.pathCT * 2.5));
    const t0 = sim.t, shipped = sim.shipped;
    const before = Object.fromEntries(sim.list.map(s => [s.id, sim.totals(s)]));
    const failures = Object.fromEntries(sim.list.map(s => [s.id, s.failures]));
    sim.runUntil(t0 + days * plan.daySec);
    // Use cumulative counters across the full horizon. The upstream live window
    // retains only 24 production hours and is unsuitable for 30-shift statistics.
    const st = Object.fromEntries(sim.list.map(s => {
      const totals = sim.totals(s), resourceSeconds = s.servers.length * days * plan.daySec;
      const fractions = Object.fromEntries(['busy', 'blocked', 'idle', 'down'].map(k => [k, (totals[k] - before[s.id][k]) / resourceSeconds]));
      return [s.id, { ...fractions, starved: fractions.idle, active: fractions.busy + fractions.down }];
    }));
    const bottleneck = [...sim.list].sort((a,b) => st[b.id].active - st[a.id].active)[0].id;
    return { perDay: (sim.shipped - shipped) / days, completed: sim.shipped - shipped, bottleneck, st,
      wip: sim.wip(), days, failures: Object.fromEntries(sim.list.map(s => [s.id, s.failures - failures[s.id]])) };
  }
  function snapshot(sim) {
    const win = sim.window();
    const stages = sim.list.map(s => ({ id: s.id, name: sim.plan.byId[s.id].name,
      queue: Object.values(s.inputs).reduce((sum, arr) => sum + arr.length, 0),
      busyCount: s.servers.filter(v => v.state === 'busy').length,
      downCount: s.servers.filter(v => v.state === 'down').length,
      servers: s.servers.filter(v => !v.retire).length, progress: s.servers.map(v => sim.progress(v)), ...win.st[s.id] }));
    return { seconds: sim.t, clock: sim.clock(), completed: sim.shipped, wip: sim.wip(), throughput: sim.perDay(),
      bottleneck: sim.bottleneck().id, leadHours: sim.leadEw / 3600, stages };
  }
  function apply(sim, input) {
    const p = parameters(input);
    sim.setServers('install', p.crews); sim.setServers('commission', p.commissioning);
    sim.setCT('install', p.installHours * 3600);
    for (const s of STAGES) sim.setBuffer(s[0], p.buffer);
    sim.resetWindow();
  }
  return { DEFAULTS, STAGES, parameters, spec, create, forecast, snapshot, apply };
});
