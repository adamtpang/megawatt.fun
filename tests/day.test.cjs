// Homepage: one average day of a home battery, and who makes what. Math in day-core.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../day-core.js');
const P = require('../pjm-core.js');
const F = require('../finance-core.js');
const V = require('../data/pjm-value.json');
const D = require('../data/finance-defaults.json');

const root = (f) => path.join(__dirname, '..', f);
const zone = (id) => V.zones.find((z) => z.id === id);
const dayOf = (id) => C.day(zone(id), V.schedule, V.spec, P.DEFAULTS.tagKw);

test('day: 24 hours, the battery ends the day where it started, and never leaves 0 to 100%', () => {
  for (const z of V.zones) {
    const d = C.day(z, V.schedule, V.spec, P.DEFAULTS.tagKw);
    assert.equal(d.hours.length, 24, z.id);
    assert.ok(d.hours.every((h) => h.soc >= 0 && h.soc <= 1), z.id);
    assert.ok(Math.abs(d.hours[23].soc - d.low) < 1e-9, z.id + ' ends at its low point');
    assert.ok(Math.abs(Math.max(...d.hours.map((h) => h.soc)) - 1) < 1e-9, z.id + ' fills up');
  }
});

test('day: charges in the cheap window, runs the home in the evening window, by the published clock', () => {
  const d = dayOf('COMED');
  assert.deepEqual(d.hours.filter((h) => h.state === 'charge').map((h) => h.i), [1, 2, 3, 4]);
  assert.deepEqual(d.hours.filter((h) => h.state === 'run').map((h) => h.i), [17, 18, 19, 20]);
  assert.equal(d.out, P.DEFAULTS.tagKw * 4);
  assert.ok(d.evening > d.night, 'evening power costs more than night power');
});

test('day: cash is negative while buying and ends positive; it matches the hand sum', () => {
  const d = dayOf('COMED'), h = zone('COMED').hourlyAvgRt;
  assert.ok(d.hours[4].cash < 0);
  const buy = (d.out / V.spec.efficiency / 4) * (h[1] + h[2] + h[3] + h[4]) / 1000;
  const sell = d.homeKw * (h[17] + h[18] + h[19] + h[20]) / 1000;
  assert.ok(Math.abs(d.hours[23].cash - (sell - buy)) < 1e-9);
  assert.ok(d.hours[23].cash > 0);
});

test('day: the average day lands near the yearly energy figure the PJM tool reports', () => {
  // The yearly figure uses every real hour, so an average day times 365 is close, not equal.
  const perYear = dayOf('COMED').hours[23].cash * 365, model = P.valueZone(zone('COMED'), {}).energy;
  assert.ok(Math.abs(perYear - model) / model < 0.25, perYear + ' vs ' + model);
});

test('day: ComEd peaks begin at 4 PM Central, outside the evening window', () => {
  const d = dayOf('COMED');
  assert.equal(d.peakHour, 16);
  assert.equal(d.peakMissed, true);
  assert.equal(d.allPeaksSameHour, true);
  assert.equal(d.hours[16].peak, true);
});

test('sky: a color pair for every hour, dark at night and light at noon', () => {
  const lum = (c) => parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16);
  for (let h = 0; h < 24; h++) for (const c of C.sky(h)) assert.match(c, /^#[0-9a-f]{6}$/);
  assert.ok(lum(C.sky(12)[0]) > lum(C.sky(2)[0]) * 3);
  assert.equal(C.daylight(2), 0);
  assert.equal(C.daylight(12), 1);
});

test('load: a large load pays energy, capacity and transmission; Ohio transmission is fixed', () => {
  const rate = V.capacity.deliveryYears[0].usdPerMwDay;
  const L = C.load(zone('COMED'), rate, 100, 0.9);
  assert.ok(Math.abs(L.energy - 100 * zone('COMED').avgRtUsdPerMwh * 8760 * 0.9) < 1e-6);
  assert.ok(Math.abs(L.capPerMw - rate * 365) < 1e-9);
  assert.equal(L.txFixed, false);
  assert.ok(Math.abs(L.avoidedPerMw - (L.capPerMw + L.txPerMw)) < 1e-9);
  assert.ok(Math.abs(L.total - (L.energy + L.capacity + L.transmission)) < 1e-6);
  const ohio = C.load(zone('ATSI'), rate, 100, 0.9);
  assert.equal(ohio.txFixed, true);
  assert.ok(ohio.transmission > 0, 'still paid');
  assert.ok(Math.abs(ohio.avoidedPerMw - ohio.capPerMw) < 1e-9, 'but not avoidable');
});

test('fund: one battery\'s PJM value feeds the debt model; starting inputs are the published figures', () => {
  const v = P.valueZone(zone('COMED'), {}), base = C.fundBase(D);
  assert.equal(base.capexPerKwh, 350);
  const raw = C.fundRaw(D, v);
  assert.equal(raw.upfront, 695);
  assert.equal(raw.memberFeeMonthly, 19);
  assert.equal(raw.retailMarginMonthly, 0);
  assert.equal(raw.arbPerYear, v.energy);
  assert.ok(Math.abs(raw.tollPerKwYear * raw.kw - (v.capacity + v.transmission)) < 1e-9);
  const r = C.fund(F, D, v);
  assert.ok(r.debt > 0 && r.debt < r.netCapex, 'cash flow supports part of the cost');
  assert.equal(r.binding, 'dscr');
  assert.ok(Math.abs(r.debt + r.equity - r.netCapex) < 1e-6);
});

test('fund: a utility that pays more supports more debt, and the funded cost is the break-even', () => {
  const comed = P.valueZone(zone('COMED'), {}), pseg = P.valueZone(zone('PSEG'), {});
  assert.ok(C.fund(F, D, pseg).debt > C.fund(F, D, comed).debt);
  const cost = C.fundedCost(F, D, comed);
  assert.ok(cost > 0 && cost < 350, 'below the published cost: ' + cost);
  assert.ok(C.fund(F, D, comed, { capexPerKwh: cost - 1 }).equity < 0.5);
  assert.ok(C.fund(F, D, comed, { capexPerKwh: cost + 5 }).equity > 0.5);
});

test('page: the homepage loads its parts, links the other tools, and keeps the independence line', () => {
  const html = fs.readFileSync(root('index.html'), 'utf8');
  for (const f of ['day.css', 'pjm-core.js', 'finance-core.js', 'day-core.js', 'day.js', 'day-scene.js']) assert.ok(html.includes('/' + f), f);
  for (const href of ['/pjm', '/market', '/battery', '/live', '/notes', '/about', '/privacy', '/sources']) assert.ok(html.includes('href="' + href + '"'), href);
  assert.match(html, /id="stage-canvas" hidden/);
  assert.match(html, /id="stage-fallback"/);
  assert.match(html, /<input id="hour" type="range" min="0" max="23"/);
  assert.match(html, /Not affiliated with Base Power/);
  assert.equal((html.match(/role="tab"/g) || []).length, 4);
  for (const f of ['index.html', 'day.css', 'day.js', 'day-core.js', 'day-scene.js']) {
    assert.ok(!fs.readFileSync(root(f), 'utf8').includes(String.fromCharCode(0x2014)), f + ' has no em dash');
  }
  assert.ok(fs.existsSync(root('fonts/bricolage-grotesque-latin-800-normal.woff2')));
  assert.ok(!fs.readFileSync(root('day.css'), 'utf8').includes('fonts.googleapis'), 'fonts are self-hosted');
  assert.ok(!html.includes('fonts.googleapis'), 'fonts are self-hosted');
});

test('page: the PJM ranking moved to /pjm and nothing still redirects it home', () => {
  const pjm = fs.readFileSync(root('pjm.html'), 'utf8');
  assert.match(pjm, /<link rel="canonical" href="https:\/\/megawatt\.fun\/pjm">/);
  const vercel = JSON.parse(fs.readFileSync(root('vercel.json'), 'utf8'));
  assert.ok(!vercel.redirects.some((r) => r.source === '/pjm'));
  assert.match(fs.readFileSync(root('sitemap.xml'), 'utf8'), /megawatt\.fun\/pjm</);
});
