import { loadPrices, valueStack, scoreCandidates, Candidate, DEFAULT_WEIGHTS } from '../market-intelligence';
async function consume() {
  const prices = await loadPrices();
  const point = prices.zones.LZ_HOUSTON;
  const value = valueStack(point, { capacity: 25 });
  const candidates: Candidate[] = [{ id: 'test', name: 'Unverified scenario', zone: 'LZ_HOUSTON', eligible: null,
    property: { installedCostUsd: null, usableAreaM2: null }, grid: { headroomKw: null },
    basis: 'missing', source: 'Missing', asOf: null }];
  const ranked = scoreCandidates(candidates, { LZ_HOUSTON: value.backtest }, DEFAULT_WEIGHTS);
  const nullable: number | null = ranked[0].score;
  // @ts-expect-error Battery capacity is numeric.
  valueStack(point, { capacity: '25' });
  // @ts-expect-error A partial scoring vector must not silently acquire hidden weights.
  scoreCandidates(candidates, {}, { energy: 100 });
  return nullable;
}
void consume;
