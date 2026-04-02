/**
 * Pairwise and frequent-set combination discovery from match data.
 *
 * Discovers which template combinations co-occur in matches:
 * - Pairwise: all 2-template pairs per team per match (D-06)
 * - Frequent-set: k-template sets (k=2..maxSetSize) meeting minSupport (D-07)
 *
 * Uses direct enumeration (brute-force) since with only 5 templates the
 * combinatorial space is trivial (2^5 - 1 = 31 possible subsets).
 */
import type { ParsedMatch } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract distinct template IDs used by each team in a match,
 * optionally filtered by tick range.
 * Returns Map<teamId, Map<templateId, buildCount>>.
 */
function extractTeamTemplates(
  match: ParsedMatch,
  tickRange?: { start: number; end: number },
): Map<number, Map<string, number>> {
  const result = new Map<number, Map<string, number>>();

  for (const tick of match.ticks) {
    if (tickRange !== undefined) {
      if (tick.tick < tickRange.start || tick.tick >= tickRange.end) {
        continue;
      }
    }

    for (const action of tick.actions) {
      if (
        action.actionType === 'build' &&
        action.result === 'applied' &&
        action.templateId !== undefined
      ) {
        let teamMap = result.get(action.teamId);
        if (!teamMap) {
          teamMap = new Map<string, number>();
          result.set(action.teamId, teamMap);
        }
        teamMap.set(
          action.templateId,
          (teamMap.get(action.templateId) ?? 0) + 1,
        );
      }
    }
  }

  return result;
}

/**
 * Generate all k-element subsets from a sorted array.
 */
function kSubsets(items: string[], k: number): string[][] {
  const results: string[][] = [];

  function backtrack(start: number, current: string[]): void {
    if (current.length === k) {
      results.push([...current]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      current.push(items[i]);
      backtrack(i + 1, current);
      current.pop();
    }
  }

  backtrack(0, []);
  return results;
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Mine all pairwise (2-template) combinations from match data.
 *
 * For each match and team, extracts the set of distinct templates used
 * (within tickRange if provided), generates all 2-element subsets with
 * canonically sorted IDs joined with "+".
 *
 * @returns Map<matchIndex, Map<teamId, Map<pairId, minBuildCount>>>
 *          where minBuildCount = min(countA, countB) for D-08 log-weighting.
 */
export function minePairwiseCombinations(
  matches: ParsedMatch[],
  tickRange?: { start: number; end: number },
): Map<number, Map<number, Map<string, number>>> {
  const result = new Map<number, Map<number, Map<string, number>>>();

  for (let matchIdx = 0; matchIdx < matches.length; matchIdx++) {
    const match = matches[matchIdx];
    const teamTemplates = extractTeamTemplates(match, tickRange);
    const matchResult = new Map<number, Map<string, number>>();

    for (const [teamId, templateCounts] of teamTemplates) {
      const templateIds = Array.from(templateCounts.keys()).sort();
      const pairMap = new Map<string, number>();

      if (templateIds.length >= 2) {
        const pairs = kSubsets(templateIds, 2);
        for (const [a, b] of pairs) {
          const pairId = `${a}+${b}`; // Already sorted alphabetically
          const minCount = Math.min(
            templateCounts.get(a) ?? 0,
            templateCounts.get(b) ?? 0,
          );
          pairMap.set(pairId, minCount);
        }
      }

      matchResult.set(teamId, pairMap);
    }

    result.set(matchIdx, matchResult);
  }

  return result;
}

/**
 * Mine frequent template sets (k=2..maxSetSize) from match data using
 * direct enumeration.
 *
 * Counts support as number of (match, team) pairs where ALL members of
 * the subset were used. Filters by minSupport threshold.
 *
 * @param matches   Parsed match data
 * @param options   Mining configuration
 * @returns         Discovered frequent sets sorted by support descending
 */
export function mineFrequentSets(
  matches: ParsedMatch[],
  options?: {
    minSupport?: number;
    maxSetSize?: number;
    tickRange?: { start: number; end: number };
  },
): Array<{ setId: string; members: string[]; support: number }> {
  const minSupport = options?.minSupport ?? 5;
  const maxSetSize = options?.maxSetSize ?? 4;
  const tickRange = options?.tickRange;

  // Collect all (match, team) template sets
  const teamSets: Array<Set<string>> = [];
  const allTemplates = new Set<string>();

  for (const match of matches) {
    const teamTemplates = extractTeamTemplates(match, tickRange);
    for (const [, templateCounts] of teamTemplates) {
      const templates = new Set(templateCounts.keys());
      teamSets.push(templates);
      for (const t of templates) {
        allTemplates.add(t);
      }
    }
  }

  if (allTemplates.size === 0) {
    return [];
  }

  // Enumerate all k-subsets for k=2..maxSetSize
  const sortedTemplates = Array.from(allTemplates).sort();
  const results: Array<{ setId: string; members: string[]; support: number }> =
    [];

  for (let k = 2; k <= Math.min(maxSetSize, sortedTemplates.length); k++) {
    const subsets = kSubsets(sortedTemplates, k);

    for (const subset of subsets) {
      // Count support: number of (match, team) pairs containing all members
      let support = 0;
      for (const teamSet of teamSets) {
        if (subset.every((member) => teamSet.has(member))) {
          support++;
        }
      }

      if (support >= minSupport) {
        results.push({
          setId: subset.join('+'),
          members: subset,
          support,
        });
      }
    }
  }

  // Sort by support descending, then set size descending
  results.sort((a, b) => {
    if (b.support !== a.support) return b.support - a.support;
    return b.members.length - a.members.length;
  });

  return results;
}
