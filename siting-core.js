/* Home-battery siting math. No DOM, no network.
   profit = (spread $/MWh / 1000) * cycles/year * usable kWh * round-trip efficiency - degradation $/year.
   The spread is an input. This file does not choose a node or invent a price. */
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

  function batteryProfit(input) {
    const spread = num(input && input.spreadUsdPerMwh);
    const cycles = num(input && input.cyclesPerYear);
    const usable = num(input && input.usableKwh);
    const rte = num(input && input.roundTripEfficiency);
    const degradation = num(input && input.degradationUsdPerYear);
    const errors = [];
    if (spread === null) errors.push('spreadUsdPerMwh');
    if (cycles === null || cycles < 0) errors.push('cyclesPerYear');
    if (usable === null || usable < 0) errors.push('usableKwh');
    if (rte === null || rte < 0 || rte > 1) errors.push('roundTripEfficiency');
    if (degradation === null || degradation < 0) errors.push('degradationUsdPerYear');
    if (errors.length) return { ok: false, errors: errors };
    const spreadPerKwh = spread / 1000;
    const gross = spreadPerKwh * cycles * usable * rte;
    return {
      ok: true,
      errors: [],
      spreadUsdPerKwh: spreadPerKwh,
      grossUsdPerYear: gross,
      profitUsdPerYear: gross - degradation,
    };
  }

  function rejectParcel(area) {
    if (!area || typeof area !== 'object') return 'missing area';
    const banned = ['owner', 'ownerName', 'address', 'street', 'parcel', 'account'];
    for (let i = 0; i < banned.length; i++) {
      if (Object.prototype.hasOwnProperty.call(area, banned[i])) return banned[i];
    }
    return '';
  }

  function rankAreas(areas, assumptions, spreadKey) {
    const key = spreadKey || 'spreadUsdPerMwh';
    const ranked = [];
    const skipped = [];
    for (let i = 0; i < areas.length; i++) {
      const area = areas[i];
      const banned = rejectParcel(area);
      if (banned) {
        skipped.push({ id: area && area.id, reason: 'parcel field ' + banned });
        continue;
      }
      const spread = num(area[key]);
      if (spread === null) {
        skipped.push({ id: area.id, reason: 'no spread' });
        continue;
      }
      const profit = batteryProfit({
        spreadUsdPerMwh: spread,
        cyclesPerYear: assumptions.cyclesPerYear,
        usableKwh: assumptions.usableKwh,
        roundTripEfficiency: assumptions.roundTripEfficiency,
        degradationUsdPerYear: assumptions.degradationUsdPerYear,
      });
      if (!profit.ok) {
        skipped.push({ id: area.id, reason: profit.errors.join(',') });
        continue;
      }
      const homes = num(area.singleFamily);
      ranked.push({
        id: area.id,
        name: area.name,
        kind: area.kind,
        countyGeoid: area.countyGeoid,
        countyName: area.countyName,
        zone: area.zone || null,
        zoneAssignment: area.zoneAssignment || null,
        flag: area.flag || null,
        singleFamily: homes,
        spreadUsdPerMwh: spread,
        grossUsdPerYear: profit.grossUsdPerYear,
        profitUsdPerYear: profit.profitUsdPerYear,
        screenUsdPerYear: homes === null ? null : profit.profitUsdPerYear * homes,
      });
    }
    ranked.sort(function (a, b) {
      if (b.profitUsdPerYear !== a.profitUsdPerYear) return b.profitUsdPerYear - a.profitUsdPerYear;
      const homesA = a.singleFamily === null ? -1 : a.singleFamily;
      const homesB = b.singleFamily === null ? -1 : b.singleFamily;
      if (homesB !== homesA) return homesB - homesA;
      return String(a.id).localeCompare(String(b.id));
    });
    return { ranked: ranked, skipped: skipped };
  }

  const api = { batteryProfit: batteryProfit, rankAreas: rankAreas, rejectParcel: rejectParcel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SitingCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
