export interface Battery { capacity: number; power: number; efficiency: number; reserve: number; wear: number }
export type PriceRow = [date: string, hourEnding: number, repeated: 'N' | 'Y', dam: number, rtm: number];
export interface MonthResult { month: string; energy: number; wear: number; net: number; bought: number; sold: number; hours: number }
export interface Backtest { energy: number; wear: number; net: number; bought: number; sold: number; initialSOC: number; finalSOC: number; residualKWh: number; months: MonthResult[]; hours: number; baseline: number; parameters: Battery; mode: 'retail' | 'wholesale'; trace: unknown[] | null }
export interface Diagnostics { meanRT: number; meanDA: number; meanDASpread: number; meanAbsoluteSpread: number; volatility: number; negativeHours: number; last: PriceRow }
export const DEFAULTS: Readonly<Battery>;
export function parameters(input?: Partial<Battery>): Battery;
export function validateRows(rows: PriceRow[]): void;
export function backtest(rows: PriceRow[], battery?: Partial<Battery>, options?: { trace?: boolean; idle?: boolean; tariff?: { annualUsage: number; offPeak: number; peak: number; profile: 'flat' | 'evening' | 'daytime' } }): Backtest;
export function diagnostics(rows: PriceRow[]): Diagnostics;
