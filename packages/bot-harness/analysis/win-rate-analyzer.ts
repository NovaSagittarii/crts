import { createDefaultStructureTemplates } from '#rts-engine';

import type { TickActionRecord } from '../types.js';
import type {
  AnalysisConfig,
  ParsedMatch,
  StrategyAssignment,
  StrategyWinRate,
  TemplateWinRate,
  WinRateWithCI,
} from './types.js';
import { wilsonScoreInterval } from './stats.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Map of templateId -> templateName from the default templates */
function buildTemplateNameMap(): Map<string, string> {
  const templates = createDefaultStructureTemplates();
  const map = new Map<string, string>();
  for (const t of templates) {
    map.set(t.id, t.name);
  }
  return map;
}

/**
 * Extract all applied build actions with valid templateId from a match.
 * Groups by teamId.
 */
function extractBuildsByTeam(
  match: ParsedMatch,
): Map<number, TickActionRecord[]> {
  const result = new Map<number, TickActionRecord[]>();

  for (const tick of match.ticks) {
    for (const action of tick.actions) {
      if (
        action.actionType === 'build' &&
        action.result === 'applied' &&
        action.templateId !== undefined
      ) {
        let teamActions = result.get(action.teamId);
        if (!teamActions) {
          teamActions = [];
          result.set(action.teamId, teamActions);
        }
        teamActions.push(action);
      }
    }
  }

  return result;
}

/**
 * Determine the win credit for a given teamId in a match.
 * Returns 1.0 for winner, 0.0 for loser, 0.5 for draw.
 */
function getWinCredit(match: ParsedMatch, teamId: number): number {
  if (match.outcome.isDraw) {
    return 0.5;
  }
  if (match.outcome.winner && match.outcome.winner.teamId === teamId) {
    return 1.0;
  }
  return 0.0;
}

/**
 * Create a zero WinRateWithCI using Wilson score for the empty case.
 */
function zeroWinRate(confidence: number): WinRateWithCI {
  return {
    winRate: 0,
    wins: 0,
    total: 0,
    ci: wilsonScoreInterval(0, 0, confidence),
  };
}

/**
 * Build a WinRateWithCI from accumulated wins and total.
 */
function buildWinRate(
  wins: number,
  total: number,
  confidence: number,
): WinRateWithCI {
  if (total === 0) {
    return zeroWinRate(confidence);
  }
  return {
    winRate: wins / total,
    wins,
    total,
    ci: wilsonScoreInterval(wins, total, confidence),
  };
}

// ---------------------------------------------------------------------------
// Per-template win rates
// ---------------------------------------------------------------------------

interface TemplateAccumulator {
  presenceWins: number;
  presenceTotal: number;
  usageWins: number;
  usageTotal: number;
  firstBuildWins: number;
  firstBuildTotal: number;
}

/**
 * Compute per-template win rates using three attribution methods.
 *
 * 1. **Presence-based**: For each (match, team) pair where the template was built,
 *    contribute 1 observation. Win credit = 1.0 for winner, 0.5 for draw, 0.0 for loser.
 *
 * 2. **Usage-weighted**: Same as presence but weighted by build count.
 *    If a team built "block" 3 times in a winning match, contributes 3 wins / 3 total.
 *
 * 3. **First-build**: Only considers the first `config.firstNBuilds` builds per team per match.
 *    Applies presence-based logic on this subset.
 */
export function computeTemplateWinRates(
  matches: ParsedMatch[],
  config: AnalysisConfig,
): TemplateWinRate[] {
  if (matches.length === 0) {
    return [];
  }

  const templateNames = buildTemplateNameMap();
  const accumulators = new Map<string, TemplateAccumulator>();

  // Initialize accumulators for all known templates
  for (const [id] of templateNames) {
    accumulators.set(id, {
      presenceWins: 0,
      presenceTotal: 0,
      usageWins: 0,
      usageTotal: 0,
      firstBuildWins: 0,
      firstBuildTotal: 0,
    });
  }

  for (const match of matches) {
    const buildsByTeam = extractBuildsByTeam(match);

    for (const [teamId, actions] of buildsByTeam) {
      const winCredit = getWinCredit(match, teamId);

      // Group actions by templateId for this team in this match
      const templateCounts = new Map<string, number>();
      for (const action of actions) {
        const tid = action.templateId!;
        templateCounts.set(tid, (templateCounts.get(tid) ?? 0) + 1);
      }

      // Presence-based: each template present for this team contributes 1 observation
      for (const [tid] of templateCounts) {
        let acc = accumulators.get(tid);
        if (!acc) {
          // Template not in defaults (unknown template), create accumulator
          acc = {
            presenceWins: 0,
            presenceTotal: 0,
            usageWins: 0,
            usageTotal: 0,
            firstBuildWins: 0,
            firstBuildTotal: 0,
          };
          accumulators.set(tid, acc);
          templateNames.set(tid, tid); // Use id as name for unknown templates
        }
        acc.presenceWins += winCredit;
        acc.presenceTotal += 1;
      }

      // Usage-weighted: each build contributes 1 observation
      for (const [tid, count] of templateCounts) {
        const acc = accumulators.get(tid)!;
        acc.usageWins += winCredit * count;
        acc.usageTotal += count;
      }

      // First-build: only consider first N builds per team
      const firstNActions = actions.slice(0, config.firstNBuilds);
      const firstBuildTemplates = new Set<string>();
      for (const action of firstNActions) {
        firstBuildTemplates.add(action.templateId!);
      }

      for (const tid of firstBuildTemplates) {
        const acc = accumulators.get(tid)!;
        acc.firstBuildWins += winCredit;
        acc.firstBuildTotal += 1;
      }
    }
  }

  // Build results
  const results: TemplateWinRate[] = [];
  for (const [tid, acc] of accumulators) {
    results.push({
      templateId: tid,
      templateName: templateNames.get(tid) ?? tid,
      presence: buildWinRate(acc.presenceWins, acc.presenceTotal, config.confidence),
      usageWeighted: buildWinRate(acc.usageWins, acc.usageTotal, config.confidence),
      firstBuild: buildWinRate(acc.firstBuildWins, acc.firstBuildTotal, config.confidence),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Per-strategy win rates
// ---------------------------------------------------------------------------

interface StrategyAccumulator {
  presenceWins: number;
  presenceTotal: number;
  usageWins: number;
  usageTotal: number;
  firstBuildWins: number;
  firstBuildTotal: number;
}

/**
 * Compute per-strategy win rates using three attribution methods.
 *
 * Strategy assignments map (matchIndex, teamId) pairs to strategy labels.
 * The three attribution methods mirror the template analysis:
 *
 * 1. **Presence-based**: Each (match, team) assignment contributes 1 observation.
 * 2. **Usage-weighted**: Weighted by number of builds the team made in that match.
 * 3. **First-build**: Only considers first N builds per team for weighting.
 */
export function computeStrategyWinRates(
  matches: ParsedMatch[],
  assignments: StrategyAssignment[],
  config: AnalysisConfig,
): StrategyWinRate[] {
  if (matches.length === 0 || assignments.length === 0) {
    return [];
  }

  // Index assignments by (matchIndex, teamId) for fast lookup
  const assignmentMap = new Map<string, StrategyAssignment>();
  for (const a of assignments) {
    assignmentMap.set(`${String(a.matchIndex)}-${String(a.teamId)}`, a);
  }

  // Collect unique strategy labels
  const strategyAccumulators = new Map<string, StrategyAccumulator>();

  for (let matchIdx = 0; matchIdx < matches.length; matchIdx++) {
    const match = matches[matchIdx];
    const buildsByTeam = extractBuildsByTeam(match);

    // Get all team IDs involved (from assignments for this match)
    const teamsInMatch = new Set<number>();
    for (const a of assignments) {
      if (a.matchIndex === matchIdx) {
        teamsInMatch.add(a.teamId);
      }
    }

    for (const teamId of teamsInMatch) {
      const key = `${String(matchIdx)}-${String(teamId)}`;
      const assignment = assignmentMap.get(key);
      if (!assignment) continue;

      const strategyLabel = assignment.ruleLabel;
      const winCredit = getWinCredit(match, teamId);

      let acc = strategyAccumulators.get(strategyLabel);
      if (!acc) {
        acc = {
          presenceWins: 0,
          presenceTotal: 0,
          usageWins: 0,
          usageTotal: 0,
          firstBuildWins: 0,
          firstBuildTotal: 0,
        };
        strategyAccumulators.set(strategyLabel, acc);
      }

      // Presence: 1 observation per (match, team) assignment
      acc.presenceWins += winCredit;
      acc.presenceTotal += 1;

      // Usage-weighted: weight by total builds in this match for this team
      const teamActions = buildsByTeam.get(teamId) ?? [];
      const totalBuilds = teamActions.length;
      if (totalBuilds > 0) {
        acc.usageWins += winCredit * totalBuilds;
        acc.usageTotal += totalBuilds;
      } else {
        // Team had no builds, still count as 1 observation for usage-weighted
        acc.usageWins += winCredit;
        acc.usageTotal += 1;
      }

      // First-build: weight by number of builds in first N
      const firstNActions = teamActions.slice(0, config.firstNBuilds);
      const firstNCount = firstNActions.length;
      if (firstNCount > 0) {
        acc.firstBuildWins += winCredit * firstNCount;
        acc.firstBuildTotal += firstNCount;
      } else {
        acc.firstBuildWins += winCredit;
        acc.firstBuildTotal += 1;
      }
    }
  }

  // Build results
  const results: StrategyWinRate[] = [];
  for (const [label, acc] of strategyAccumulators) {
    results.push({
      strategyId: label,
      strategyLabel: label,
      presence: buildWinRate(acc.presenceWins, acc.presenceTotal, config.confidence),
      usageWeighted: buildWinRate(acc.usageWins, acc.usageTotal, config.confidence),
      firstBuild: buildWinRate(acc.firstBuildWins, acc.firstBuildTotal, config.confidence),
    });
  }

  return results;
}
