import type { MatchOutcome, RankedTeamOutcome } from '#rts-engine';

export interface MatchConfig {
  seed: number;
  gridWidth: number;
  gridHeight: number;
  maxTicks: number;
  hashCheckpointInterval: number;
}

export interface MatchResult {
  seed: number;
  config: MatchConfig;
  outcome: MatchOutcome | null;
  totalTicks: number;
  bots: [string, string];
  isDraw: boolean;
}

// NDJSON line types (per D-05)
export interface MatchHeader {
  type: 'header';
  seed: number;
  config: MatchConfig;
  bots: [string, string];
  startedAt: string;
}

export interface TickActionRecord {
  teamId: number;
  actionType: 'build' | 'destroy';
  templateId?: string;
  x?: number;
  y?: number;
  transform?: unknown;
  result: string;
  structureKey?: string;
}

export interface TickEconomyRecord {
  teamId: number;
  resources: number;
  income: number;
}

export interface TickRecord {
  type: 'tick';
  tick: number;
  actions: TickActionRecord[];
  economy: TickEconomyRecord[];
  buildOutcomes: number;
  destroyOutcomes: number;
  hash?: string;
}

export interface MatchOutcomeRecord {
  type: 'outcome';
  totalTicks: number;
  winner: RankedTeamOutcome | null;
  ranked: RankedTeamOutcome[];
  isDraw: boolean;
}

export type NdjsonLine = MatchHeader | TickRecord | MatchOutcomeRecord;

export interface MatchCallbacks {
  onTickComplete?: (tick: number, tickRecord: TickRecord) => void;
  onMatchComplete?: (result: MatchResult) => void;
}

export const DEFAULT_MAX_TICKS = 2000;
export const DEFAULT_HASH_CHECKPOINT_INTERVAL = 50;
export const DEFAULT_GRID_WIDTH = 52;
export const DEFAULT_GRID_HEIGHT = 52;
