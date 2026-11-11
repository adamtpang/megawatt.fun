// What one Base Core could earn in each PJM utility zone, written to data/pjm-value.json.
// Inputs (git-ignored cache, rebuilt by the fetch scripts):
//   analysis/cache/pjm/prices.json       scripts/fetch-pjm-prices.cjs  12 months of zone RT and DA prices
//   analysis/cache/pjm/load-summer.json  scripts/fetch-pjm-peaks.cjs   June to September zone load, for tag hours
// Energy: deployment-core.js's tested fixed-clock backtest with the existing "overnight" clock (charge 1 AM to
// 5 AM, discharge 5 PM to 9 PM, local time). That clock predates this file and was not picked by searching PJM
// prices. Two cases per zone:
//   - load offset (today): the battery serves the home's own evening load, so discharge is capped at that load.
//     Computed for 0.5 to 8 kW. This is what a supplier keeps through lower wholesale load, where the utility
//     settles its load on the home's interval meter.
//   - full export at 20 kW: needs PJM's DER aggregator model for energy, live from 1 Feb 2028.
// Capacity and transmission are tag values, computed in pjm-core.js from the rates below.
// Usage: node scripts/pjm-value.cjs
const fs = require('fs'), path = require('path');
const D = require('../deployment-core.js');
const P = require('../pjm-core.js');
const CACHE = path.join(__dirname, '..', 'analysis', 'cache', 'pjm');
const prices = JSON.parse(fs.readFileSync(path.join(CACHE, 'prices.json'), 'utf8'));
const load = JSON.parse(fs.readFileSync(path.join(CACHE, 'load-summer.json'), 'utf8'));
const spec = { capacity: 39.2, power: 20, efficiency: 0.88, reserve: 0.2, wear: 0 };
const scheduleName = 'overnight';
const schedule = D.schedule(scheduleName);
const KW_STEPS = Array.from({ length: 16 }, (_, i) => (i + 1) / 2); // 0.5 to 8 kW
const CENTRAL = new Set(['COMED']); // PJM reports Eastern prevailing time; ComEd homes live on Central time.

const NITS_SOURCE = 'https://www.pjm.com/-/media/DotCom/markets-ops/settlements/network-integration-trans-service-june-2026.pdf';
// PJM zonal NITS rates, $/MW-year, effective June 2026 (PJM ATRR and NITS rate table). ME and PENELEC share
// the Mid-Atlantic Interstate Transmission rate. Dominion also has a separate $518.27 underground charge.
// Regional expansion (Schedule 12) charges, also allocated on NSPL, are not included.
const NITS = { AECO: 85511.0, AEP: 138848.55, APS: 28519.21, ATSI: 91371.62, BGE: 56999.0, COMED: 46876.0, DAY: 54290.7, DEOK: 52721.0, DOM: 85190.65, DPL: 67517.0, DUQ: 74004.25, EKPC: 26173.0, JCPL: 45900.24, METED: 96066.49, PECO: 29542.0, PENELEC: 96066.49, PEPCO: 60491.36, PPL: 112973.0, PSEG: 183352.99, RECO: 53766.0 };

const BASE_IL = 'https://www.basepowercompany.com/_bpc/files/ENC6_mP2RRd-de1nBi7v6w-esa-uds-v09302026-docx.pdf';
// Who serves homes in each zone, and whether a home can choose its supplier there.
const ZONES = {
  AECO: { utility: 'Atlantic City Electric', states: ['NJ'], choice: 'open' },
  AEP: { utility: 'AEP (Ohio, Appalachian, Indiana Michigan, Kentucky, Wheeling)', states: ['OH', 'VA', 'WV', 'IN', 'MI', 'KY'], choice: 'partly', choiceNote: 'AEP Ohio only' },
  APS: { utility: 'FirstEnergy: West Penn, Potomac Edison, Mon Power', states: ['PA', 'MD', 'WV'], choice: 'partly', choiceNote: 'Pennsylvania and Maryland parts only' },
  ATSI: { utility: 'FirstEnergy Ohio (Ohio Edison, Illuminating, Toledo Edison) and Penn Power', states: ['OH', 'PA'], choice: 'open' },
  BGE: { utility: 'Baltimore Gas and Electric', states: ['MD'], choice: 'open' },
  COMED: { utility: 'ComEd', states: ['IL'], choice: 'open', base: 'Base Retail holds Illinois ARES certificate 26-0121 and offers a Battery Time of Use plan to ComEd homes', baseSource: BASE_IL, baseStatus: 'operating' },
  DAY: { utility: 'AES Ohio', states: ['OH'], choice: 'open' },
  DEOK: { utility: 'Duke Energy Ohio and Kentucky', states: ['OH', 'KY'], choice: 'partly', choiceNote: 'Ohio part only' },
  DOM: { utility: 'Dominion Energy Virginia', states: ['VA', 'NC'], choice: 'none', choiceNote: 'Virginia residential choice is limited' },
  DPL: { utility: 'Delmarva Power', states: ['DE', 'MD'], choice: 'open' },
  DUQ: { utility: 'Duquesne Light', states: ['PA'], choice: 'open' },
  EKPC: { utility: 'East Kentucky Power Cooperative', states: ['KY'], choice: 'none' },
  JCPL: { utility: 'Jersey Central Power and Light', states: ['NJ'], choice: 'open' },
  METED: { utility: 'Met-Ed (FirstEnergy Pennsylvania)', states: ['PA'], choice: 'open' },
  PECO: { utility: 'PECO', states: ['PA'], choice: 'open' },
  PENELEC: { utility: 'Penelec (FirstEnergy Pennsylvania)', states: ['PA'], choice: 'open' },
  PEPCO: { utility: 'Pepco', states: ['DC', 'MD'], choice: 'open' },
  PPL: { utility: 'PPL Electric Utilities', states: ['PA'], choice: 'open', base: 'Base Retail filed comments in PPL dockets at the Pennsylvania PUC (Nov 2026)', baseSource: 'https://www.energychoicematters.com/news/retail-supplier-expresses-concern-with-ppl-electric-s-nonbypassable-nits-proposa', baseStatus: 'docket' },
  PSEG: { utility: 'PSE&G', states: ['NJ'], choice: 'open' },
  RECO: { utility: 'Rockland Electric', states: ['NJ'], choice: 'open' },
};
// Transmission tags a supplier cannot keep: Ohio utilities recover transmission from every customer
// through a nonbypassable rider. Elsewhere the supplier is assumed to be billed NITS for its load.
const TX = {
  AEP: { bypassable: false, note: 'AEP Ohio recovers transmission through the nonbypassable Basic Transmission Cost Rider (BTCR) (secondary source).', source: 'https://www.energychoicematters.com/stories/20260318e.html' },
  ATSI: { bypassable: false, note: 'FirstEnergy Ohio recovers transmission through Rider NMB, charged to all customers. Penn Power (Pennsylvania) is not covered by this.', source: 'https://www.firstenergycorp.com/content/dam/customer/Customer%20Choice/Files/Ohio/tariffs/OE-2026-Electric-Service.pdf' },
  DAY: { bypassable: false, note: 'AES Ohio recovers transmission through the nonbypassable rider TCRR-N.', source: 'https://www.aes-ohio.com/sites/default/files/2022-06/T08%20-%2021%20TCRR-N%206-1-22.pdf' },
  DEOK: { bypassable: false, note: 'Duke Energy Ohio recovers transmission through Rider BTR, believed nonbypassable; not confirmed on the tariff. Counted as 0 to stay conservative.', source: 'unverified' },
};
const TX_DEFAULT = { bypassable: true, note: 'Assumed: the retail supplier is billed NITS for its customers’ NSPL. Check the utility tariff before counting it.', source: null };
// How each utility sets a home's tags. Only PPL is sourced so far.
const PJM_TAGS = 'https://www.pjm.com/markets-and-operations/billing-settlements-and-credit/theo-plc-and-nspl.aspx';
const TAG_METHOD = {
  PPL: { text: 'PPL sets each customer’s PLC from interval load on the five PPL zone peaks, not the five PJM-wide peaks.', source: 'https://www.pplelectric.com/-/media/PPLElectric/At-Your-Service/Docs/General-Supplier-Reference-Information/HowPPLCalculatesCustomerPLCs-Starting2011.pdf' },
};
const TAG_DEFAULT = { text: 'Not confirmed: whether this utility sets residential tags from the home’s interval meter or a class load profile. Only an interval-meter method lets a battery move the tag.', source: PJM_TAGS };

// Launch flags: sourced rules that change whether a battery-owning supplier can capture this zone's value.
// Details and more sources: data/pjm-states.json.
const MD_SB1 = 'https://mgaleg.maryland.gov/2024RS/fnotes/bil_0001/sb0001.pdf';
const MD_UCB = 'https://psc.maryland.gov/wp-content/uploads/2026/04/Order_SB1-Res-Cessation-of-POR-PC65.pdf';
const MD_TEXT = 'Maryland caps a residential supplier price at the trailing 12-month utility default rate, limits contracts to 12 months and bars variable rates (SB 1, 2024)';
const MD_BILL = 'Maryland utilities stopped billing for residential suppliers and buying their receivables, effective 1 Jan 2026 (PSC Order 92384, approved Apr 2026, with exceptions), so a supplier bills members itself';
const FE_PA = { text: 'FirstEnergy Pennsylvania will buy supplier receivables only for prices at or below the utility price to compare, for contracts from 1 June 2027 (P-2026-3060298; reported by trade press, not confirmed on the docket)', source: 'https://www.energychoicematters.com/news/pennsylvania-puc-adopts-rate-cap-for-eligibility-for-purchase-of-receivables-por' };
const FLAGS = {
  BGE: [{ text: MD_TEXT + '.', source: MD_SB1 }, { text: MD_BILL + '.', source: MD_UCB }],
  PEPCO: [{ text: 'Maryland part: ' + MD_TEXT + '.', source: MD_SB1 }, { text: 'Maryland part: ' + MD_BILL + '.', source: MD_UCB }],
  DPL: [{ text: 'Maryland part: ' + MD_TEXT + '. Delaware is not affected.', source: MD_SB1 }],
  APS: [{ text: 'Maryland part (Potomac Edison): ' + MD_TEXT + '.', source: MD_SB1 }, { text: 'Pennsylvania part (West Penn): ' + FE_PA.text + '.', source: FE_PA.source }],
  METED: [{ text: FE_PA.text + '.', source: FE_PA.source }],
  PENELEC: [{ text: FE_PA.text + '.', source: FE_PA.source }],
  ATSI: [{ text: 'Pennsylvania part (Penn Power): ' + FE_PA.text + '.', source: FE_PA.source }],
  PPL: [{ text: 'PPL proposes a nonbypassable transmission rider, which would end the transmission tag saving for suppliers; Base Retail asked for a supplier opt-out (P-2026-3065185).', source: 'https://www.puc.pa.gov/docket/P-2026-3065185' }],
};

// Shift a zone's Eastern rows to local time: local hour-ending h on Central time is Eastern hour-ending h+1.
function localRows(id, rows) {
  if (!CENTRAL.has(id)) return rows;
  return rows.slice(0, -1).map((r, i) => [r[0], r[1], r[2], rows[i + 1][3], rows[i + 1][4]]);
}

// Tag-setting hours from metered load, June to September: the zone's single peak hour (1CP, sets NSPL) and the
// five highest daily peaks (5CP). PJM's capacity PLC uses the five PJM-wide (RTO) daily peaks for most utilities.
function peaks(series, shift) {
  const byDay = new Map();
  for (const [t, mw] of series) {
    const day = t.slice(0, 10), cur = byDay.get(day);
    if (!cur || mw > cur[1]) byDay.set(day, [t, mw]);
  }
  const days = [...byDay.values()].sort((a, b) => b[1] - a[1]);
  const fmt = ([t, mw]) => {
    const beginHour = Number(t.slice(11, 13)) - shift; // local begin hour
    return { date: t.slice(0, 10), localStart: beginHour, mw: Math.round(mw) };
  };
  return { oneCP: fmt(days[0]), fiveCP: days.slice(0, 5).map(fmt) };
}
const DISCHARGE = schedule.discharge; // [17, 21]: begin hours 17 to 20
const covered = (h) => h >= DISCHARGE[0] && h < DISCHARGE[1];
const rto = peaks(load.zones.RTO, 0);

const r2 = (x) => Math.round(x * 100) / 100;
const zones = Object.keys(ZONES).map((id) => {
  const z = prices.zones[id];
  if (!z) throw new Error('No prices for ' + id);
  if (!load.zones[id]) throw new Error('No load for ' + id);
  const rows = localRows(id, z.rows);
  const full = D.backtest(rows, spec, { schedule });
  const energyByKw = {};
  for (const kw of KW_STEPS) energyByKw[kw] = r2(D.backtest(rows, { ...spec, power: kw }, { schedule }).net);
  const rts = z.rows.map((x) => x[4]);
  const monthly = full.months.map((m) => ({ month: m.month, usd: r2(m.net) }));
  const best2 = [...monthly].sort((a, b) => b.usd - a.usd).slice(0, 2);
  const shift = CENTRAL.has(id) ? 1 : 0;
  const zp = peaks(load.zones[id], shift);
  const rtoLocal = rto.fiveCP.map((p) => ({ ...p, localStart: p.localStart - shift }));
  const tx = TX[id] || TX_DEFAULT;
  return {
    id, ...ZONES[id], flags: FLAGS[id] || [],
    nitsUsdPerMwYear: NITS[id],
    transmission: { bypassable: tx.bypassable, note: tx.note, source: tx.source },
    tagMethod: TAG_METHOD[id] || TAG_DEFAULT,
    timezone: CENTRAL.has(id) ? 'Central' : 'Eastern',
    energyByKw,
    energyExportUsdPerYear: r2(full.net),
    energyMonthly: monthly,
    energyTopTwoMonths: { months: best2.map((m) => m.month), share: full.net > 0 ? Math.round((best2.reduce((a, m) => a + m.usd, 0) / full.net) * 1000) / 1000 : null },
    peaks: {
      zoneOneCP: { ...zp.oneCP, coveredByClock: covered(zp.oneCP.localStart) },
      zoneFiveCP: zp.fiveCP.map((p) => ({ ...p, coveredByClock: covered(p.localStart) })),
      rtoFiveCP: rtoLocal.map((p) => ({ ...p, coveredByClock: covered(p.localStart) })),
    },
    maxRtUsdPerMwh: r2(Math.max(...rts)),
    hours: z.rows.length,
    avgRtUsdPerMwh: r2(rts.reduce((a, b) => a + b, 0) / rts.length),
  };
});
const defaults = P.rank(zones, {});
const out = {
  built: new Date().toISOString().slice(0, 10),
  period: prices.period,
  spec: { ...spec, label: 'Base Core: 20 kW / 39.2 kWh (Base utilities page); 88% round trip and 20% backup reserve are assumptions' },
  schedule: { name: scheduleName, ...schedule, label: 'Charge 1 AM to 5 AM, discharge 5 PM to 9 PM, local time (Central in ComEd, Eastern elsewhere)' },
  kwSteps: KW_STEPS,
  exportsFrom: { date: '2028-02-01', what: 'PJM DER aggregator participation in energy and ancillary services', source: 'https://www.pjm.com/-/media/DotCom/committees-groups/subcommittees/disrs/postings/ferc-order-no-2222-overview.pdf' },
  capacity: {
    deliveryYears: [
      { year: '2027/2028', usdPerMwDay: 333.44, tagsFrom: 'summer 2026 peaks', source: 'https://www.pjm.com/-/media/DotCom/markets-ops/rpm/rpm-auction-info/2027-2028/2027-2028-bra-report.pdf' },
      { year: '2028/2029', usdPerMwDay: 325.0, tagsFrom: 'summer 2027 peaks', source: 'https://www.pjm.com/-/media/DotCom/markets-ops/rpm/rpm-auction-info/2028-2029/2028-2029-bra-results-report.pdf' },
      { year: '2026/2027', usdPerMwDay: 329.17, tagsFrom: 'summer 2025 peaks (already set)', source: 'https://insidelines.pjm.com/pjm-auction-procures-134311-mw-of-generation-resources-supply-responds-to-price-signal/' },
    ],
    note: 'All three auctions cleared at the price cap across PJM. Without the cap, PJM simulated $529.80/MW-day for 2027/2028 and $776.69 in the ComEd area for 2028/2029. A supplier is billed PLC x zonal scaling factor x forecast pool requirement x final zonal price; those factors are folded into one adjustable multiplier here.',
  },
  peaksSource: { title: 'PJM Data Miner 2: hrl_load_metered, June to September ' + load.year + ', load areas summed by zone. Peak hours computed here; PJM’s official 5CP list may differ slightly.', url: 'https://dataminer2.pjm.com/' },
  nits: { effective: 'June 2026', source: NITS_SOURCE },
  baseSaysSource: { title: 'Energy Choice Matters, 2 Nov 2026: Base Retail comments on PPL nonbypassable NITS (P-2026-3065185, P-2026-3065186, P-2024-3047290)', url: 'https://www.energychoicematters.com/news/retail-supplier-expresses-concern-with-ppl-electric-s-nonbypassable-nits-proposa' },
  pricesSource: { title: 'PJM Data Miner 2: rt_hrl_lmps and da_hrl_lmps, zone prices', url: 'https://dataminer2.pjm.com/' },
  method: 'Energy: a fixed daily clock (charge 1 to 5 AM, discharge 5 to 9 PM, local time) at the zone real-time price over 12 real months, the same tested backtest as the Texas zones. Today the battery can only serve the home’s own load, so energy is capped at the home load you set; full 20 kW exports need PJM’s DER aggregator model, live from 1 Feb 2028. Capacity: tag kW x capacity price x 365 x a scaling multiplier. Transmission: tag kW x the zone NITS rate, and 0 where transmission is a nonbypassable utility charge. Tags are set by summer peaks and paid the following year. Home load is an assumption. Load-offset and tag value reach a supplier only where the utility settles and tags the home on its interval meter. Not Base revenue.',
  zones: zones.sort((a, b) => b.energyExportUsdPerYear - a.energyExportUsdPerYear),
  rankedAtDefaults: defaults.map((x) => ({ id: x.zone.id, ...x.value })),
};
fs.writeFileSync(path.join(__dirname, '..', 'data', 'pjm-value.json'), JSON.stringify(out, null, 2) + '\n');
console.log(defaults.map((x) => `${x.zone.id} ${x.value.total} (e ${x.value.energy} c ${x.value.capacity} t ${x.value.transmission})`).join('\n'));
console.log('RTO 5CP', JSON.stringify(rto.fiveCP));
