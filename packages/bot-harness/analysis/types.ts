import type { MatchHeader, MatchOutcomeRecord, TickRecord } from '../types.js';

/** Parsed NDJSON match file decomposed into header, ticks, and outcome */
export interface ParsedMatch {
  header: MatchHeader;
  ticks: TickRecord[];
  outcome: MatchOutcomeRecord;
}

/** Confidence interval with center estimate and sample size */
export interface ConfidenceInterval {
  lower: number;
  upper: number;
  center: number;
  n: number;
}

/** Win rate with associated confidence interval */
export interface WinRateWithCI {
  winRate: number;
  wins: number;
  total: number;
  ci: ConfidenceInterval;
}

/** Per-template win rate across three analysis perspectives (D-01) */
export interface TemplateWinRate {
  templateId: string;
  templateName: string;
  presence: WinRateWithCI;
  usageWeighted: WinRateWithCI;
  firstBuild: WinRateWithCI;
}

/** Per-strategy win rate across three analysis perspectives (D-03) */
export interface StrategyWinRate {
  strategyId: string;
  strategyLabel: string;
  presence: WinRateWithCI;
  usageWeighted: WinRateWithCI;
  firstBuild: WinRateWithCI;
}

/** Feature vector for strategy clustering (D-05) */
export interface StrategyFeatureVector {
  firstBuildTick: number;
  buildDensity: number;
  buildBurstiness: number;
  avgResourcesAtBuild: number;
  resourceEfficiency: number;
  territoryGrowthRate: number;
  finalTerritoryRatio: number;
  uniqueTemplatesUsed: number;
  templateEntropy: number;
  avgDistanceToEnemy: number;
  structureSpread: number;
}

/** Assignment of a match+team to a strategy cluster */
export interface StrategyAssignment {
  matchIndex: number;
  teamId: number;
  features: StrategyFeatureVector;
  ruleLabel: string;
  clusterId: number;
}

/** K-means clustering result */
export interface ClusterResult {
  centroids: number[][];
  assignments: number[];
  k: number;
  wcss: number;
  iterations: number;
}

/** Frequent build sequence pattern */
export interface SequencePattern {
  pattern: string[];
  support: number;
  frequency: number;
}

/** Per-generation training data snapshot */
export interface GenerationData {
  generation: number;
  episode: number;
  matchCount: number;
  strategyDistribution: Record<string, number>;
  templateWinRates: TemplateWinRate[];
}

/** Complete balance analysis report (D-12 single combined JSON) */
export interface BalanceReport {
  metadata: {
    matchDir: string;
    matchCount: number;
    generatedAt: string;
    confidence: number;
  };
  templateWinRates: TemplateWinRate[];
  strategyWinRates: StrategyWinRate[];
  strategyAssignments: StrategyAssignment[];
  clusters: ClusterResult;
  sequencePatterns: SequencePattern[];
  generations: GenerationData[];
  ratings?: RatingsReport;
}

/** Configuration for analysis pipeline */
export interface AnalysisConfig {
  confidence: number;
  minMatches: number;
  maxPatternLength: number;
  k: number;
  firstNBuilds: number;
}

// ---------------------------------------------------------------------------
// Phase 22: Glicko-2 Structure Strength Ratings
// ---------------------------------------------------------------------------

/** Glicko-2 rating for a single entity */
export interface Glicko2Rating {
  rating: number; // Display scale (centered on 1500)
  rd: number; // Rating deviation (display scale)
  volatility: number; // Sigma
}

/** Result of a single match from entity's perspective (Glicko-2 context) */
export interface Glicko2MatchResult {
  opponentRating: number; // Display scale
  opponentRd: number; // Display scale
  score: number; // 1.0 = win, 0.5 = draw, 0.0 = loss
}

/** Template-vs-template encounter extracted from match data (D-01) */
export interface TemplateEncounter {
  entityA: string; // Template/combo ID from winning (or team A) side
  entityB: string; // Template/combo ID from losing (or team B) side
  scoreA: number; // Fractional win credit (1.0 win, 0.5 draw, 0.0 loss)
  scoreB: number; // 1 - scoreA
  weightA: number; // log(1 + buildCountA) -- diminishing returns weighting
  weightB: number; // log(1 + buildCountB)
}

/** Game phase definition for per-phase rating pools (D-02, D-03) */
export type GamePhase = 'early' | 'mid' | 'late' | 'full';

/** Tick range for game phase filtering */
export interface GamePhaseRange {
  phase: GamePhase;
  start: number;
  end: number; // Infinity for unbounded (late phase)
}

/** Entity type for rating pools */
export type RatingEntityType = 'individual' | 'pairwise' | 'frequent-set';

/** Outlier classification flags (D-10, D-12) */
export type OutlierFlag =
  | 'statistical-outlier-high'
  | 'statistical-outlier-low'
  | 'dominant'
  | 'niche-strong'
  | 'trap';

/** A rated entity with Glicko-2 rating and metadata */
export interface RatedEntity {
  id: string;
  name: string;
  entityType: RatingEntityType;
  phase: GamePhase;
  rating: Glicko2Rating;
  provisional: boolean; // RD > 150 per D-04
  matchCount: number;
  pickRate: number;
  outlierFlags: OutlierFlag[];
}

/** Configuration for a rating pool */
export interface RatingPoolConfig {
  name: string;
  entityType: RatingEntityType;
  phase: GamePhase;
  tickRange: GamePhaseRange | null;
}

/** Serialized rating pool for worker thread communication */
export interface SerializedRatingPool {
  config: RatingPoolConfig;
  entities: Array<{ id: string; rating: Glicko2Rating }>;
  encounters: TemplateEncounter[];
}

/** Ratings section of the extended BalanceReport (D-16) */
export interface RatingsReport {
  hyperparameters: {
    initialRating: number;
    initialRd: number;
    initialVolatility: number;
    tau: number;
    phaseBoundaries: { earlyEnd: number; midEnd: number };
  };
  individual: {
    early: RatedEntity[];
    mid: RatedEntity[];
    late: RatedEntity[];
  };
  pairwise: RatedEntity[];
  frequentSets: RatedEntity[];
  outliers: {
    perPhase: {
      early: RatedEntity[];
      mid: RatedEntity[];
      late: RatedEntity[];
    };
    overall: RatedEntity[];
  };
}
