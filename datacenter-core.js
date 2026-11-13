/* Data-center unit economics per MW. No DOM and no home-siting import.
   The same battery formula is repeated here so this file can move to its own product.
   A missing capex, opex, or capacity factor stays null. It is not stored as zero. */
(function (root) {
  'use strict';

  function num(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function backupValue(input) {
    const spread = num(input.spreadUsdPerMwh);
    const cycles = num(input.cyclesPerYear);
    const durationHours = num(input.durationHours);
    const rte = num(input.roundTripEfficiency);
    const degradation = num(input.degradationUsdPerMwYear);
    const errors = [];
    if (spread === null) errors.push('spreadUsdPerMwh');
    if (cycles === null || cycles < 0) errors.push('cyclesPerYear');
    if (durationHours === null || durationHours < 0) errors.push('durationHours');
    if (rte === null || rte < 0 || rte > 1) errors.push('roundTripEfficiency');
    if (degradation === null || degradation < 0) errors.push('degradationUsdPerMwYear');
    if (errors.length) return { ok: false, errors: errors };
    // 1 MW for durationHours stores durationHours MWh, which is durationHours * 1000 kWh.
    const usableKwh = durationHours * 1000;
    const gross = (spread / 1000) * cycles * usableKwh * rte;
    return { ok: true, errors: [], grossUsdPerMwYear: gross, valueUsdPerMwYear: gross - degradation };
  }

  function perMw(input) {
    const power = num(input.powerUsdPerMwh);
    const hours = num(input.hoursPerYear);
    const capacityFactor = num(input.capacityFactor);
    const capex = num(input.capexUsdPerMw);
    const life = num(input.lifeYears);
    const opex = num(input.opexUsdPerMwYear);
    const missing = [];
    let energy = null;
    if (power === null || hours === null || hours < 0 || capacityFactor === null || capacityFactor < 0 || capacityFactor > 1) {
      missing.push('energy');
    } else {
      energy = power * hours * capacityFactor;
    }
    let capital = null;
    if (capex === null || life === null || life <= 0 || capex < 0) missing.push('capital');
    else capital = capex / life;
    let operating = null;
    if (opex === null || opex < 0) missing.push('opex');
    else operating = opex;
    const backup = backupValue({
      spreadUsdPerMwh: input.spreadUsdPerMwh,
      cyclesPerYear: input.backupCyclesPerYear,
      durationHours: input.backupDurationHours,
      roundTripEfficiency: input.backupRoundTripEfficiency,
      degradationUsdPerMwYear: input.backupDegradationUsdPerMwYear,
    });
    if (!backup.ok) missing.push('flexibility');
    const costPieces = [];
    if (energy !== null) costPieces.push(energy);
    if (capital !== null) costPieces.push(capital);
    if (operating !== null) costPieces.push(operating);
    const cost = costPieces.length ? costPieces.reduce(function (sum, part) { return sum + part; }, 0) : null;
    let net = null;
    if (cost !== null || backup.ok) {
      net = (backup.ok ? backup.valueUsdPerMwYear : 0) - (cost || 0);
    }
    return {
      ok: missing.length === 0,
      missing: missing,
      energyUsdPerMwYear: energy,
      capitalRecoveryUsdPerMwYear: capital,
      opexUsdPerMwYear: operating,
      flexibilityUsdPerMwYear: backup.ok ? backup.valueUsdPerMwYear : null,
      flexibilityGrossUsdPerMwYear: backup.ok ? backup.grossUsdPerMwYear : null,
      netUsdPerMwYear: net,
      partial: missing.length > 0,
    };
  }

  const api = { backupValue: backupValue, perMw: perMw };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DatacenterCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
