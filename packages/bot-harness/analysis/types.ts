import type {
  MatchHeader,
  MatchOutcomeRecord,
  TickRecord,
} from '../types.js';

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
}

/** Configuration for analysis pipeline */
export interface AnalysisConfig {
  confidence: number;
  minMatches: number;
  maxPatternLength: number;
  k: number;
  firstNBuilds: number;
}
