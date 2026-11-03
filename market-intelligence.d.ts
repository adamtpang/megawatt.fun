import { Battery, PriceRow, Backtest, Diagnostics } from './deployment-core';
export type PointName = `HB_${string}` | `LZ_${string}`;
export interface PointSeries { kind: 'hub' | 'hub-average' | 'load-zone'; settlementType: 'HU' | 'SH' | 'AH' | 'LZ'; rows: PriceRow[]; spikeIntervalsByHour: number[]; spikeThresholdPerMWh: 100; rtIntervals: number }
export interface PriceDataset { schemaVersion: 2; period: { start: string; endExclusive: string; asOf: string; timezone: 'America/Chicago'; expectedHours: number; description: string }; columns: ['date', 'hourEnding', 'repeated', 'dam', 'rtm']; zones: Record<PointName, PointSeries>; sources: { id: string; url: string; retrievedAt: string; sha256: string; bytes: number }[] }
export interface ValueStack { diagnostics: Diagnostics; backtest: Backtest; spikeHours: { hour: number; count: number; share: number; rate: number }[]; spikeThresholdPerMWh: number; spikeIntervals: number; topThreeHourShare: number; topHours: number[]; energy: number; ancillary: null; reliability: null; total: null }
export type Factor = 'energy' | 'installedCost' | 'usableArea' | 'headroom';
export type Weights = Record<Factor, number>;
export interface Candidate { id: string; name: string; zone: PointName; eligible: boolean | null; property: { installedCostUsd: number | null; usableAreaM2: number | null }; grid: { headroomKw: number | null }; basis: 'missing' | 'synthetic' | 'user-scenario'; source: string; asOf: string | null }
export interface ScoredCandidate extends Candidate { values: Record<Factor, number | null>; missing: string[]; status: 'excluded' | 'missing-inputs' | 'scored'; score: number | null; breakdown: Partial<Record<Factor, { value: number; normalized: number; weight: number; points: number }>> }
export const FACTORS: Readonly<Record<Factor, { label: string; direction: 'higher' | 'lower'; unit: string }>>;
export const DEFAULT_WEIGHTS: Readonly<Weights>;
export function validateDataset(data: unknown): PriceDataset;
export function loadPrices(options?: { url?: string; fetcher?: typeof fetch; refresh?: boolean }): Promise<PriceDataset>;
export function valueStack(series: PointSeries, battery?: Partial<Battery>): ValueStack;
export function normalizedWeights(input?: Weights): Weights;
export function scoreCandidates(candidates: Candidate[], results: Record<string, Backtest>, weights?: Weights): ScoredCandidate[];
