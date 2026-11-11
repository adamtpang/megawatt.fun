/* Fleet-operator view of one installed battery.
   The page, POST /api/v1/home and the tests call evaluate().
   Location, zone prices and the homeowner-buys comparison come from home-roi-core.js.
   Debt, when the operator's cash is actually modeled, comes from finance-core.js.
   A line with no source is "not modeled yet". It is not stored as zero. */
(function (root) {
  'use strict';

  const H = typeof require === 'function' ? require('./home-roi-core.js') : root.HomeRoiCore;
  const F = typeof require === 'function' ? require('./finance-core.js') : root.FinanceCore;

  const PODCAST = {
    label: 'Zach Dell on David Senra, Sep 6 2026 (spoken, not a filing)',
    url: 'https://www.davidsenra.com/episode/zach-dell',
    date: '2026-09-06',
    notes: [
      { t: '~15:34', text: 'He sells electricity, not batteries. A membership is one-twentieth or even one-fortieth of owning the battery outright.' },
      { t: '~21:14', text: 'A homeowner who buys backup pays about 20 grand for a battery that sits idle. The fleet owner can use it about 99% of the time as a wholesale asset and share that value as a lower bill.' },
      { t: '~6:19 and ~7:47', text: 'Batteries move energy through time. The wholesale market he names is ERCOT.' },
      { t: '~22:32', text: 'He says about 80% of Texas is deregulated and 20% is still regulated. Austin Energy, CPS, and co-ops such as CoServ and Pedernales are the regulated side.' },
      { t: '~24:27', text: 'CoServ is a customer. He describes fleets on the order of 100 MW.' },
      { t: '~26:19', text: 'A regulated utility return, he says, is typically 9% unlevered on the capital it deploys. That is a remark about utility rate base, not this model\'s IRR.' },
      { t: '~28:03', text: 'On the regulated side he describes about 10-year contracts: megawatts as a service.' },
      { t: '~1:14:22', text: 'Make, move, store, sell.' },
    ],
  };

  const PURCHASE_ILLUSTRATION = 20000;
  const RETAIL_TDUS = { centerpoint: 'CenterPoint', oncor: 'Oncor', aep_central: 'AEP Texas Central', aep_north: 'AEP Texas North', tnmp: 'TNMP', lpl: 'Lubbock Power & Light' };
  const VENDOR_RULES = [
    { test: (n) => /austin energy/i.test(n), id: 'austin', label: 'Austin Energy' },
    { test: (n) => /san antonio/i.test(n), id: 'cps', label: 'CPS Energy' },
    { test: (n) => /pedernales/i.test(n), id: 'pec', label: 'Pedernales Electric Cooperative' },
    { test: (n) => /denton county elec/i.test(n), id: 'coserv', label: 'CoServ (Denton County Electric Cooperative)' },
  ];

  function notModeled(id, label, note) {
    return { id, label, status: 'not modeled yet', value: null, kind: null, note };
  }
  function modeled(id, label, value, kind, note, counted) {
    return { id, label, status: 'modeled', value, kind, note, counted: counted !== false };
  }

  function fieldOf(defaults, key) {
    let found = null;
    (defaults.groups || []).forEach((g) => (g.fields || []).forEach((f) => { if (f.key === key) found = f; }));
    return found;
  }

  function blank(v) { return v == null || String(v).trim() === ''; }

  function percentOrBlank(v, name) {
    if (blank(v)) return { set: false };
    const n = F.parseDecimal(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { error: name + ' must be a percent from 0 to 100, or left blank.' };
    return { set: true, pct: n };
  }

  function dollarsOrBlank(v, name) {
    if (blank(v)) return { set: false };
    const n = F.parseDecimal(v);
    if (!Number.isFinite(n) || n < 0 || n > F.ARB_MAX) return { error: name + ' must be a dollar amount from 0 to ' + F.ARB_MAX + ', or left blank.' };
    return { set: true, usd: n };
  }

  /* Member model: a retail-choice wires company (Power to Choose / the ZIP file's tdus).
     Vendor model: a municipal utility or co-op with no retail-choice wires company,
     or one of the co-ops Zach names. A ZIP that lists both is split. */
  function modeFor(info) {
    const tdus = info.tdus || [];
    const utilities = info.utilities || [];
    const retail = tdus.filter((id) => Object.prototype.hasOwnProperty.call(RETAIL_TDUS, id)).map((id) => RETAIL_TDUS[id]);
    const vendors = [];
    utilities.forEach((name) => {
      const rule = VENDOR_RULES.find((r) => r.test(name));
      if (rule && !vendors.some((v) => v.id === rule.id)) vendors.push({ id: rule.id, label: rule.label, name });
    });
    if (retail.length && vendors.length) {
      return {
        id: 'split', status: 'split',
        label: 'This ZIP lists both a retail-choice wires company and a municipal utility or co-op',
        retail, vendors,
        why: retail.join(', ') + ' is a retail-choice wires company in the ZIP file. ' + vendors.map((v) => v.label).join(', ') + ' is also listed. The meter decides which model applies. This page will not pick one.',
      };
    }
    if (retail.length) {
      return {
        id: 'member', status: 'member',
        label: 'Deregulated retail: the fleet owner sells electricity',
        retail, vendors: [],
        why: retail.join(', ') + ' is a retail-choice wires company on this ZIP (Power to Choose list in data/zip-launch.json). Zach\'s deregulated model is a retailer plus a fleet.',
      };
    }
    if (vendors.length) {
      return {
        id: 'vendor', status: 'vendor',
        label: 'Regulated territory: megawatts as a service',
        retail: [], vendors,
        why: vendors.map((v) => v.label).join(', ') + ' is a municipal utility or co-op on this ZIP, and no retail-choice wires company is listed. Zach\'s regulated model is a vendor on a multi-year contract.',
      };
    }
    const named = utilities.join(', ');
    if (named) {
      return {
        id: 'unknown', status: 'unknown',
        label: 'No fleet model for this wires company',
        retail: [], vendors: [],
        why: 'The ZIP file names ' + named + '. That is not a retail-choice wires company in the Power to Choose list, and it is not Austin Energy, CPS, CoServ, or Pedernales. The market mode is unknown.',
      };
    }
    return {
      id: 'unknown', status: 'unknown',
      label: 'No wires company on file',
      retail: [], vendors: [],
      why: 'This ZIP has no retail-choice wires company and no utility name in data/zip-launch.json, so the market mode is unknown.',
    };
  }

  function hardwareOf(defaults, input) {
    const capex = fieldOf(defaults, 'capexPerKwh');
    const shelf = capex ? capex.value : null;
    const which = input && input.hardware === 'base' ? 'base' : 'shelf';
    const parsed = percentOrBlank(input && input.reductionPct, 'Hardware reduction');
    if (parsed.error) return { error: parsed.error };
    const reductionPct = which === 'base' ? (parsed.set ? parsed.pct : 0) : 0;
    const landed = shelf == null ? null : shelf * (1 - reductionPct / 100);
    return {
      which,
      shelfPerKwh: shelf,
      landedPerKwh: landed,
      reductionPct,
      kind: which === 'base' ? 'assumption' : 'sourced',
      note: which === 'base'
        ? 'The off-the-shelf cost is the NREL figure. This case subtracts ' + reductionPct + '%, an assumption on this page. It is not a Base Core price. Base has not published a landed $/kWh that this tool uses.'
        : (capex ? capex.note : 'Off-the-shelf installed cost.'),
      source: capex && capex.source,
    };
  }

  function sizeOnCash(defaults, capexPerKwh, cashPerYear, fleetCount) {
    const raw = { revenueCase: 'merchant', zoneMarket: 'retail choice', arbPerYear: cashPerYear, fleetCount };
    (defaults.groups || []).forEach((g) => (g.fields || []).forEach((f) => { raw[f.key] = f.value; }));
    raw.capexPerKwh = capexPerKwh;
    raw.arbPerYear = cashPerYear;
    raw.memberFeeMonthly = 0;
    raw.retailMarginMonthly = 0;
    raw.tollPerKwYear = 0;
    raw.ancPerKwYear = 0;
    raw.upfront = 0;
    raw.revenueCase = 'merchant';
    raw.zoneMarket = 'retail choice';
    raw.fleetCount = fleetCount;
    const sized = F.sizeDebt(F.normalize(raw));
    const u = sized.returns.unlevered;
    return {
      sized: true,
      perBattery: sized.debt,
      equity: sized.equity,
      binding: sized.binding,
      bindingText: F.bindingText(sized),
      paybackYear: u.paybackYear,
      paysBack: u.paysBack,
      simpleRoi: u.invest > 0 ? u.net / u.invest : null,
      irr: u.irr,
      npv: u.npv,
      netCost: sized.netCapex,
      lifeYears: sized.life,
      fleetCount,
      fleetDebt: F.fleet(sized, fleetCount).debt,
      kind: 'partly sourced',
      note: 'finance-core.js sizes the loan on the operator cash below. Member fees, retail margin, toll and ancillary services are left out of this loan on purpose: those dollars are not modeled here.',
    };
  }

  function stackFor(home, mode, share, contract, gross) {
    const lines = [];
    lines.push(modeled(
      'timeshift',
      'Wholesale time-shift',
      gross,
      'partly sourced',
      'Gross earnings of one 20 kW / 39.2 kWh battery on the fixed ERCOT real-time clock in this load zone. ' + (home.earnings.arbitrage.note || ''),
      mode.id === 'member'
    ));
    if (mode.id === 'member') {
      if (!share.set) {
        lines.push(notModeled('billCredit', 'Member bill credit', 'The fleet shares wholesale value as a lower bill. No public share is on file, so this line is not modeled yet. Set a percent to subtract it. A blank is not treated as 0%.'));
      } else {
        lines.push(modeled('billCredit', 'Member bill credit', gross * share.pct / 100, 'assumption', share.pct + '% of the wholesale time-shift, an assumption you set. It is not Base\'s tariff.', true));
      }
    } else if (mode.id === 'vendor') {
      lines.push(notModeled('billCredit', 'Member bill credit', 'This ZIP is the vendor model. The member\'s bill is the utility\'s, not a retail plan this fleet sells. No bill credit is modeled.'));
    } else {
      lines.push(notModeled('billCredit', 'Member bill credit', 'The market mode is not settled, so a member bill credit is not modeled.'));
    }
    lines.push(notModeled('backup', 'Backup and reliability', 'Backup is the product the member keeps when the grid is down. No public dollar for that outage value is in the price file, so it is not modeled yet.'));
    if (mode.id === 'vendor') {
      if (!contract.set) {
        lines.push(notModeled('utility', 'Utility megawatts as a service', 'A regulated contract would pay the fleet over about 10 years. No contract price is published here, so the cash flow is not modeled yet. Zach\'s "typically 9% unlevered" remark is a citation, not a cash-flow input.'));
      } else {
        lines.push(modeled('utility', 'Utility megawatts as a service', contract.usd, 'assumption', 'A contract payment you typed, in dollars per battery per year. It is not a CoServ, Austin Energy, or CPS price.', true));
      }
    } else {
      lines.push(notModeled('utility', 'Utility megawatts as a service', 'That contract is the regulated model. This ZIP is not in that mode, so no utility payment is modeled.'));
    }
    lines.push(notModeled('ancillary', 'Ancillary services', 'No public net dollar for an aggregated home battery in ERCOT reserves is in this tool. Ancillary services are not modeled yet.'));
    return lines;
  }

  function operatorCash(mode, lines) {
    if (mode.id === 'member') {
      const gross = lines.find((l) => l.id === 'timeshift');
      const credit = lines.find((l) => l.id === 'billCredit');
      if (!credit || credit.status !== 'modeled') return { set: false, reason: 'Member bill credit is not modeled yet, so operator net cash and debt are not sized.' };
      return { set: true, usd: gross.value - credit.value, kind: 'partly sourced' };
    }
    if (mode.id === 'vendor') {
      const contract = lines.find((l) => l.id === 'utility');
      if (!contract || contract.status !== 'modeled') return { set: false, reason: 'The utility contract is not modeled yet, so operator cash and debt are not sized. Wholesale time-shift is shown as what the battery can move, not as cash the vendor keeps.' };
      return { set: true, usd: contract.value, kind: 'assumption' };
    }
    return { set: false, reason: 'The market mode is unknown or split, so operator cash is not sized.' };
  }

  function membership(hardware) {
    const purchase = PURCHASE_ILLUSTRATION;
    return {
      purchaseUsd: purchase,
      kind: 'partly sourced',
      twentieth: purchase / 20,
      fortieth: purchase / 40,
      note: 'Zach said a homeowner who buys backup pays about 20 grand, and that a membership is one-twentieth or even one-fortieth of owning it outright. The dollars here are that spoken illustration (20,000 / 20 and 20,000 / 40). They are not a Base membership price.',
      shelfUsd: hardware.shelfPerKwh == null ? null : hardware.shelfPerKwh * 39.2,
      landedUsd: hardware.landedPerKwh == null ? null : hardware.landedPerKwh * 39.2,
    };
  }

  /* input adds hardware ('shelf'|'base'), reductionPct, billCreditPct, contractUsd, marketMode.
     marketMode is used only when the ZIP itself is split. */
  function evaluate(input, data) {
    const home = H.evaluate(input, data);
    if (!home.ok) return home;
    const defaults = data.defaults;
    const hardware = hardwareOf(defaults, input || {});
    if (hardware.error) return { ok: false, errors: [hardware.error] };
    const share = percentOrBlank(input && input.billCreditPct, 'Member share');
    if (share.error) return { ok: false, errors: [share.error] };
    const contract = dollarsOrBlank(input && input.contractUsd, 'Utility contract');
    if (contract.error) return { ok: false, errors: [contract.error] };

    const territory = home.home || (home.resolution && home.resolution.info);
    let mode = territory ? modeFor(territory) : { id: 'unknown', status: 'unknown', label: 'No wires company yet', why: 'Pick a ZIP before the market mode can be read.', retail: [], vendors: [] };
    if (mode.id === 'split') {
      const pick = input && input.marketMode;
      if (pick === 'member' || pick === 'vendor') {
        mode = Object.assign({}, mode, {
          id: pick,
          status: pick,
          chosen: true,
          label: pick === 'member' ? 'Deregulated retail, chosen for this split ZIP' : 'Regulated vendor, chosen for this split ZIP',
        });
      }
    }

    const gross = home.zone ? home.zone.usdPerYear : null;
    const lines = home.zone ? stackFor(home, mode, share, contract, gross) : [];
    const cash = home.zone ? operatorCash(mode, lines) : { set: false, reason: 'No load zone yet.' };
    let operator = { sized: false, reason: cash.reason || 'Not sized.' };
    if (cash.set && hardware.landedPerKwh != null) {
      const count = home.debt ? home.debt.fleetCount : (fieldOf(defaults, 'fleetCount') || { value: 1 }).value;
      operator = sizeOnCash(defaults, hardware.landedPerKwh, cash.usd, count);
      operator.cashPerYear = cash.usd;
      operator.cashKind = cash.kind;
    }
    const cites = mode.vendors && mode.vendors.some((v) => v.id === 'coserv');
    return Object.assign({}, home, {
      podcast: PODCAST,
      marketMode: mode,
      hardware,
      stack: lines,
      operator,
      membership: membership(hardware),
      coservExample: !!(cites || (mode.vendors || []).some((v) => v.id === 'coserv')),
      homeowner: {
        label: 'Homeowner buys the battery',
        note: 'This is the comparison Zach calls broken: the household owns the pack, so it is not a wholesale desk. The figures below are the existing finance model at the off-the-shelf cost, including that model\'s own assumptions (a member fee, a retail margin, loan terms). Backup is not given a dollar there either.',
        simpleRoi: home.returns ? home.returns.simpleRoi : null,
        irr: home.returns ? home.returns.irr : null,
        paybackYear: home.returns ? home.returns.paybackYear : null,
        paysBack: home.returns ? home.returns.paysBack : false,
        debt: home.debt || null,
        kind: 'partly sourced',
      },
    });
  }

  const api = { PODCAST, PURCHASE_ILLUSTRATION, modeFor, hardwareOf, evaluate, RETAIL_TDUS, VENDOR_RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FleetRoiCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
