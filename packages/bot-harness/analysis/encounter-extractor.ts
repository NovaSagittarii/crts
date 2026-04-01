/**
 * Match-to-encounter extraction for the Glicko-2 rating pipeline.
 *
 * Converts team-level match outcomes into template-vs-template (or
 * combination-vs-combination) encounters using the D-01 credit model:
 * each winning template earns fractional win credit against each losing
 * template, weighted by log(1 + buildCount) for diminishing returns.
 *
 * Supports game-phase tick-range filtering (D-02) so encounters can be
 * extracted for early/mid/late phases independently.
 */

import type { TickRecord } from '../types.js';
import type {
  GamePhaseRange,
  ParsedMatch,
  TemplateEncounter,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default game-phase tick boundaries per D-03 */
export const GAME_PHASE_DEFAULTS: GamePhaseRange[] = [
  { phase: 'early', start: 0, end: 200 },
  { phase: 'mid', start: 200, end: 600 },
  { phase: 'late', start: 600, end: Infinity },
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Count applied builds per template per team, optionally filtered by tick range.
 * Returns Map<teamId, Map<templateId, count>>.
 */
function countBuildsByTeam(
  ticks: TickRecord[],
  tickRange?: { start: number; end: number },
): Map<number, Map<string, number>> {
  const result = new Map<number, Map<string, number>>();

  for (const tick of ticks) {
    // Filter by tick range if provided
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
        let teamBuilds = result.get(action.teamId);
        if (!teamBuilds) {
          teamBuilds = new Map<string, number>();
          result.set(action.teamId, teamBuilds);
        }
        teamBuilds.set(
          action.templateId,
          (teamBuilds.get(action.templateId) ?? 0) + 1,
        );
      }
    }
  }

  return result;
}

/**
 * Determine win credit for a team based on match outcome.
 * Winner gets 1.0, loser gets 0.0, draw gets 0.5.
 */
function getTeamScore(
  teamId: number,
  winnerTeamId: number | null,
): number {
  if (winnerTeamId === null) return 0.5; // Draw
  return teamId === winnerTeamId ? 1.0 : 0.0;
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Extract template-vs-template encounters from a match using the D-01
 * credit model. Produces the cross-product of templates from each pair
 * of opposing teams, with log-weighted credit.
 *
 * @param match     Parsed match data
 * @param tickRange Optional tick range filter for game-phase separation
 * @returns         Array of template encounters
 */
export function extractTemplateEncounters(
  match: ParsedMatch,
  tickRange?: { start: number; end: number },
): TemplateEncounter[] {
  const buildsByTeam = countBuildsByTeam(match.ticks, tickRange);
  const winnerTeamId = match.outcome.winner?.teamId ?? null;

  const teamIds = Array.from(buildsByTeam.keys());
  const encounters: TemplateEncounter[] = [];

  // Generate cross-product for each pair of different teams
  for (const teamA of teamIds) {
    for (const teamB of teamIds) {
      if (teamA === teamB) continue;

      const buildsA = buildsByTeam.get(teamA)!;
      const buildsB = buildsByTeam.get(teamB)!;

      const scoreA = getTeamScore(teamA, winnerTeamId);
      const scoreB = getTeamScore(teamB, winnerTeamId);

      for (const [templateA, countA] of buildsA) {
        for (const [templateB, countB] of buildsB) {
          encounters.push({
            entityA: templateA,
            entityB: templateB,
            scoreA,
            scoreB,
            weightA: Math.log(1 + countA),
            weightB: Math.log(1 + countB),
          });
        }
      }
    }
  }

  return encounters;
}

/**
 * Extract combination-vs-combination encounters from a match using
 * pre-computed combination sets per team. Uses the same D-01 credit
 * model but weights by log(1 + min(memberCounts)) per D-08.
 *
 * @param match        Parsed match data
 * @param combinations Pre-computed combination sets per team (Map<teamId, Set<comboId>>)
 *                     where comboId is like "block+glider" (sorted alphabetically)
 * @param tickRange    Optional tick range filter for game-phase separation
 * @returns            Array of combination encounters
 */
export function extractCombinationEncounters(
  match: ParsedMatch,
  combinations: Map<number, Set<string>>,
  tickRange?: { start: number; end: number },
): TemplateEncounter[] {
  const buildsByTeam = countBuildsByTeam(match.ticks, tickRange);
  const winnerTeamId = match.outcome.winner?.teamId ?? null;

  const teamIds = Array.from(combinations.keys());
  const encounters: TemplateEncounter[] = [];

  for (const teamA of teamIds) {
    for (const teamB of teamIds) {
      if (teamA === teamB) continue;

      const combosA = combinations.get(teamA);
      const combosB = combinations.get(teamB);
      if (!combosA || !combosB) continue;

      const buildsA = buildsByTeam.get(teamA);
      const buildsB = buildsByTeam.get(teamB);
      if (!buildsA || !buildsB) continue;

      const scoreA = getTeamScore(teamA, winnerTeamId);
      const scoreB = getTeamScore(teamB, winnerTeamId);

      for (const comboA of combosA) {
        for (const comboB of combosB) {
          // Weight = log(1 + min(member counts))
          const membersA = comboA.split('+');
          const minCountA = Math.min(
            ...membersA.map((m) => buildsA.get(m) ?? 0),
          );

          const membersB = comboB.split('+');
          const minCountB = Math.min(
            ...membersB.map((m) => buildsB.get(m) ?? 0),
          );

          encounters.push({
            entityA: comboA,
            entityB: comboB,
            scoreA,
            scoreB,
            weightA: Math.log(1 + minCountA),
            weightB: Math.log(1 + minCountB),
          });
        }
      }
    }
  }

  return encounters;
}
