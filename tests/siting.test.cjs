const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Siting = require('../siting-core.js');
const Dc = require('../datacenter-core.js');

test('battery profit matches the published formula', () => {
  const out = Siting.batteryProfit({
    spreadUsdPerMwh: 10,
    cyclesPerYear: 100,
    usableKwh: 10,
    roundTripEfficiency: 0.5,
    degradationUsdPerYear: 1,
  });
  assert.equal(out.ok, true);
  // (10 / 1000) * 100 * 10 * 0.5 - 1 = 5 - 1
  assert.equal(out.grossUsdPerYear, 5);
  assert.equal(out.profitUsdPerYear, 4);
});

test('a negative spread stays negative and is not floored', () => {
  const out = Siting.batteryProfit({
    spreadUsdPerMwh: -20,
    cyclesPerYear: 10,
    usableKwh: 5,
    roundTripEfficiency: 1,
    degradationUsdPerYear: 0,
  });
  assert.equal(out.profitUsdPerYear, -1);
});

test('efficiency outside 0 to 1 and a missing spread are rejected', () => {
  const bad = Siting.batteryProfit({
    spreadUsdPerMwh: 5,
    cyclesPerYear: 1,
    usableKwh: 1,
    roundTripEfficiency: 1.2,
    degradationUsdPerYear: 0,
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.includes('roundTripEfficiency'));
  const missing = Siting.batteryProfit({ cyclesPerYear: 1, usableKwh: 1, roundTripEfficiency: 1, degradationUsdPerYear: 0 });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.includes('spreadUsdPerMwh'));
});

test('ranking uses the spread, drops a parcel field, and does not invent a home count', () => {
  const areas = [
    { id: 'b', kind: 'tract', name: 'B', singleFamily: 10, spreadUsdPerMwh: 5 },
    { id: 'a', kind: 'tract', name: 'A', singleFamily: 3, spreadUsdPerMwh: 20 },
    { id: 'c', kind: 'tract', name: 'C', singleFamily: null, spreadUsdPerMwh: null },
    { id: 'secret', owner: 'Not Stored', address: '1 Main', spreadUsdPerMwh: 100, singleFamily: 1 },
  ];
  const assumptions = { cyclesPerYear: 100, usableKwh: 10, roundTripEfficiency: 1, degradationUsdPerYear: 0 };
  const out = Siting.rankAreas(areas, assumptions);
  assert.deepEqual(out.ranked.map((row) => row.id), ['a', 'b']);
  assert.equal(out.ranked[0].profitUsdPerYear, 20);
  assert.equal(out.ranked[1].profitUsdPerYear, 5);
  assert.equal(out.ranked[1].screenUsdPerYear, 50);
  assert.ok(out.skipped.some((row) => row.id === 'secret' && row.reason.startsWith('parcel field')));
  assert.ok(out.skipped.some((row) => row.id === 'c'));
});

test('data center backup value uses the same formula at 1 MW', () => {
  const backup = Dc.backupValue({
    spreadUsdPerMwh: 10,
    cyclesPerYear: 100,
    durationHours: 4,
    roundTripEfficiency: 0.5,
    degradationUsdPerMwYear: 1,
  });
  const home = Siting.batteryProfit({
    spreadUsdPerMwh: 10,
    cyclesPerYear: 100,
    usableKwh: 4000,
    roundTripEfficiency: 0.5,
    degradationUsdPerYear: 1,
  });
  assert.equal(backup.ok, true);
  assert.equal(backup.valueUsdPerMwYear, home.profitUsdPerYear);
});

test('a missing capex stays missing and is not treated as zero in the complete result', () => {
  const out = Dc.perMw({
    powerUsdPerMwh: 40,
    hoursPerYear: 100,
    capacityFactor: 0.5,
    capexUsdPerMw: null,
    lifeYears: null,
    opexUsdPerMwYear: null,
    spreadUsdPerMwh: 10,
    backupCyclesPerYear: 1,
    backupDurationHours: 1,
    backupRoundTripEfficiency: 1,
    backupDegradationUsdPerMwYear: 0,
  });
  assert.equal(out.partial, true);
  assert.equal(out.energyUsdPerMwYear, 2000);
  assert.equal(out.capitalRecoveryUsdPerMwYear, null);
  assert.ok(out.missing.includes('capital'));
  assert.ok(out.missing.includes('opex'));
  assert.equal(out.ok, false);
});

test('straight-line capital recovery is capex divided by life', () => {
  const out = Dc.perMw({
    powerUsdPerMwh: 0,
    hoursPerYear: 8760,
    capacityFactor: 1,
    capexUsdPerMw: 1000,
    lifeYears: 10,
    opexUsdPerMwYear: 25,
    spreadUsdPerMwh: 0,
    backupCyclesPerYear: 0,
    backupDurationHours: 0,
    backupRoundTripEfficiency: 1,
    backupDegradationUsdPerMwYear: 0,
  });
  assert.equal(out.ok, true);
  assert.equal(out.capitalRecoveryUsdPerMwYear, 100);
  assert.equal(out.energyUsdPerMwYear, 0);
  assert.equal(out.netUsdPerMwYear, -125);
});

test('committed siting snapshot has sources, no parcel fields, and labeled large-load rules', () => {
  const root = path.join(__dirname, '..', 'data', 'siting');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const areas = JSON.parse(fs.readFileSync(path.join(root, 'areas.json'), 'utf8'));
  const large = JSON.parse(fs.readFileSync(path.join(root, 'large-load.json'), 'utf8'));
  const territory = JSON.parse(fs.readFileSync(path.join(root, 'territory.json'), 'utf8'));
  assert.ok(manifest.sources.length >= 5);
  for (const source of manifest.sources) {
    assert.equal(typeof source.url, 'string');
    assert.ok(source.url.startsWith('http'));
    assert.ok(source.retrievedAt || source.detail);
  }
  assert.match(manifest.formula, /spreadUsdPerMwh \/ 1000/);
  const sample = areas.tracts[0];
  assert.equal(Object.hasOwn(sample, 'owner'), false);
  assert.equal(Object.hasOwn(sample, 'address'), false);
  assert.ok(areas.tracts.length > 1000);
  assert.ok(territory.zips.length > 1000);
  const flags = new Set(territory.zips.map((row) => row.flag));
  assert.ok(flags.has('deregulated'));
  assert.ok(flags.has('coop_muni'));
  assert.equal(large.textFigures.find((row) => row.id === 'approved-to-energize').value, 8927);
  assert.equal(large.rules.find((row) => row.id === 'puct-58481-proposal').label, 'PROPOSAL');
  assert.match(large.whatItIs, /not a data-center census|does not say these loads are data centers/);
  const houston = territory.zips.find((row) => row.zip === '77002');
  const austin = territory.zips.find((row) => row.zip === '78704');
  assert.equal(houston.flag, 'deregulated');
  assert.equal(austin.flag, 'coop_muni');
  const austinArea = areas.zips.find((row) => row.id === '78704');
  const houstonArea = areas.zips.find((row) => row.id === '77002');
  assert.equal(austinArea.zone, 'LZ_AEN');
  assert.equal(austinArea.flag, 'coop_muni');
  assert.equal(houstonArea.zone, null);
  assert.equal(JSON.stringify(areas).includes('"owner"'), false);
  assert.ok(areas.tracts.every((row) => row.singleFamily === null || row.singleFamily >= 0));
});
