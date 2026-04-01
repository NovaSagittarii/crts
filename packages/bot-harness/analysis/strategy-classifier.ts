import type {
  ParsedMatch,
  StrategyAssignment,
  StrategyFeatureVector,
} from './types.js';
import type { TickActionRecord, TickEconomyRecord } from '../types.js';
import { mean, shannonEntropy, stddev } from './stats.js';

/**
 * Extract a StrategyFeatureVector from a match's tick records for a given team.
 *
 * Walks all ticks and computes build timing, density, diversity, economy,
 * territory, and spatial features.
 */
export function extractFeatures(
  match: ParsedMatch,
  teamId: number,
): StrategyFeatureVector {
  const { ticks, outcome } = match;
  const totalTicks = ticks.length;

  // Collect applied builds and rejected builds for this team
  const appliedBuildTicks: number[] = [];
  const rejectedCount = { value: 0 };
  const templateCounts: Record<string, number> = {};
  const buildPositions: Array<{ x: number; y: number }> = [];
  const resourcesAtBuildTicks: number[] = [];

  // Track opponent build positions for distance calculation
  const opponentPositions: Array<{ x: number; y: number }> = [];

  // Track economy over time for territory growth rate
  const teamEconomyEntries: TickEconomyRecord[] = [];

  for (const tick of ticks) {
    // Collect economy data for this team
    for (const econ of tick.economy) {
      if (econ.teamId === teamId) {
        teamEconomyEntries.push(econ);
      }
    }

    // Process actions
    for (const action of tick.actions) {
      if (action.actionType !== 'build') continue;

      if (action.teamId === teamId) {
        if (action.result === 'applied') {
          appliedBuildTicks.push(tick.tick);
          if (action.templateId) {
            templateCounts[action.templateId] =
              (templateCounts[action.templateId] ?? 0) + 1;
          }
          if (action.x !== undefined && action.y !== undefined) {
            buildPositions.push({ x: action.x, y: action.y });
          }
          // Capture economy at this tick for this team
          const econ = tick.economy.find(
            (e: TickEconomyRecord) => e.teamId === teamId,
          );
          if (econ) {
            resourcesAtBuildTicks.push(econ.resources);
          }
        } else {
          rejectedCount.value++;
        }
      } else {
        // Opponent build positions for distance calc
        if (action.result === 'applied' && action.x !== undefined && action.y !== undefined) {
          opponentPositions.push({ x: action.x, y: action.y });
        }
      }
    }
  }

  const appliedCount = appliedBuildTicks.length;

  // firstBuildTick
  const firstBuildTick =
    appliedBuildTicks.length > 0 ? appliedBuildTicks[0] : 0;

  // buildDensity: (applied builds / totalTicks) * 100
  const buildDensity = totalTicks > 0 ? (appliedCount / totalTicks) * 100 : 0;

  // buildBurstiness: stddev of inter-build intervals
  let buildBurstiness = 0;
  if (appliedBuildTicks.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < appliedBuildTicks.length; i++) {
      intervals.push(appliedBuildTicks[i] - appliedBuildTicks[i - 1]);
    }
    buildBurstiness = stddev(intervals);
  }

  // avgResourcesAtBuild
  const avgResourcesAtBuild = mean(resourcesAtBuildTicks);

  // resourceEfficiency
  const totalAttempts = appliedCount + rejectedCount.value;
  const resourceEfficiency =
    totalAttempts > 0 ? appliedCount / totalAttempts : 0;

  // territoryGrowthRate: (finalIncome - initialIncome) / totalTicks * 100
  let territoryGrowthRate = 0;
  if (teamEconomyEntries.length >= 2 && totalTicks > 0) {
    const initialIncome = teamEconomyEntries[0].income;
    const finalIncome = teamEconomyEntries[teamEconomyEntries.length - 1].income;
    territoryGrowthRate = ((finalIncome - initialIncome) / totalTicks) * 100;
  }

  // finalTerritoryRatio: from ranked outcome
  let finalTerritoryRatio = 0;
  if (outcome.ranked.length > 0) {
    const totalTerritoryCells = outcome.ranked.reduce(
      (sum, r) => sum + r.territoryCellCount,
      0,
    );
    const teamOutcome = outcome.ranked.find((r) => r.teamId === teamId);
    if (teamOutcome && totalTerritoryCells > 0) {
      finalTerritoryRatio =
        teamOutcome.territoryCellCount / totalTerritoryCells;
    }
  }

  // uniqueTemplatesUsed
  const uniqueTemplatesUsed = Object.keys(templateCounts).length;

  // templateEntropy
  const buildCountValues = Object.values(templateCounts);
  const templateEntropy = shannonEntropy(buildCountValues);

  // avgDistanceToEnemy: mean Euclidean distance from own builds to opponent builds
  let avgDistanceToEnemy = 0;
  if (buildPositions.length > 0 && opponentPositions.length > 0) {
    const distances: number[] = [];
    for (const pos of buildPositions) {
      for (const opp of opponentPositions) {
        const dx = pos.x - opp.x;
        const dy = pos.y - opp.y;
        distances.push(Math.sqrt(dx * dx + dy * dy));
      }
    }
    avgDistanceToEnemy = mean(distances);
  }

  // structureSpread: stddev of build positions from centroid
  let structureSpread = 0;
  if (buildPositions.length >= 2) {
    const centroidX = mean(buildPositions.map((p) => p.x));
    const centroidY = mean(buildPositions.map((p) => p.y));
    const distancesFromCentroid = buildPositions.map((p) => {
      const dx = p.x - centroidX;
      const dy = p.y - centroidY;
      return Math.sqrt(dx * dx + dy * dy);
    });
    structureSpread = stddev(distancesFromCentroid);
  }

  return {
    firstBuildTick,
    buildDensity,
    buildBurstiness,
    avgResourcesAtBuild,
    resourceEfficiency,
    territoryGrowthRate,
    finalTerritoryRatio,
    uniqueTemplatesUsed,
    templateEntropy,
    avgDistanceToEnemy,
    structureSpread,
  };
}

/**
 * Rule-based strategy classifier using Conway-appropriate labels.
 *
 * Labels are observable-metric-based (not intent-based).
 * Priority order: mono-template > template-heavy > early-builder > diverse-placer > economy-saver > balanced.
 */
export function classifyStrategy(
  features: StrategyFeatureVector,
  buildCounts: Record<string, number>,
  totalTicks: number,
): string {
  const totalBuilds = Object.values(buildCounts).reduce(
    (sum, c) => sum + c,
    0,
  );

  if (totalBuilds > 0) {
    // Find dominant template
    let dominantId = '';
    let dominantCount = 0;
    for (const [id, count] of Object.entries(buildCounts)) {
      if (count > dominantCount) {
        dominantCount = count;
        dominantId = id;
      }
    }

    const dominantFraction = dominantCount / totalBuilds;

    // Rule 1: Mono-template (only one template used, 100%)
    if (features.uniqueTemplatesUsed <= 1 && dominantFraction >= 1.0) {
      return `mono-${dominantId}`;
    }

    // Rule 2: Template-heavy (>60% one template)
    if (dominantFraction > 0.6) {
      return `${dominantId}-heavy`;
    }
  }

  // Rule 3: Early builder (first build in first 5% of match and high density)
  if (
    totalTicks > 0 &&
    features.firstBuildTick / totalTicks < 0.05 &&
    features.buildDensity > 2.0
  ) {
    return 'early-builder';
  }

  // Rule 4: Diverse placer (high entropy and many templates)
  if (features.templateEntropy > 1.5 && features.uniqueTemplatesUsed >= 4) {
    return 'diverse-placer';
  }

  // Rule 5: Economy saver (low density, high efficiency)
  if (features.buildDensity < 0.5 && features.resourceEfficiency > 0.8) {
    return 'economy-saver';
  }

  // Default
  return 'balanced';
}

/**
 * Classify all teams across all matches.
 *
 * Returns one StrategyAssignment per team per match, with ruleLabel populated
 * and clusterId set to -1 (unassigned until clustering).
 */
export function classifyAll(matches: ParsedMatch[]): StrategyAssignment[] {
  const assignments: StrategyAssignment[] = [];

  for (let matchIndex = 0; matchIndex < matches.length; matchIndex++) {
    const match = matches[matchIndex];
    const totalTicks = match.ticks.length;

    // Get team IDs from the ranked outcome
    const teamIds = match.outcome.ranked.map((r) => r.teamId);

    for (const teamId of teamIds) {
      const features = extractFeatures(match, teamId);

      // Build template counts for this team
      const buildCounts: Record<string, number> = {};
      for (const tick of match.ticks) {
        for (const action of tick.actions) {
          if (
            action.teamId === teamId &&
            action.actionType === 'build' &&
            action.result === 'applied' &&
            action.templateId
          ) {
            buildCounts[action.templateId] =
              (buildCounts[action.templateId] ?? 0) + 1;
          }
        }
      }

      const ruleLabel = classifyStrategy(features, buildCounts, totalTicks);

      assignments.push({
        matchIndex,
        teamId,
        features,
        ruleLabel,
        clusterId: -1,
      });
    }
  }

  return assignments;
}
