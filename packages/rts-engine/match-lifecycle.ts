export type MatchLifecycleStatus =
  | 'lobby'
  | 'countdown'
  | 'active'
  | 'finished';

export type MatchLifecycleEvent =
  | 'start-countdown'
  | 'cancel-countdown'
  | 'countdown-complete'
  | 'finish'
  | 'restart-countdown';

export interface LifecyclePreconditions {
  hasRequiredPlayers: boolean;
  allPlayersConnected: boolean;
  reconnectHoldPending: boolean;
}

export type MatchLifecycleRejectionReason =
  | 'invalid-transition'
  | 'start-preconditions-not-met';

export interface LifecycleTransitionResult {
  allowed: boolean;
  nextStatus: MatchLifecycleStatus;
  reason?: MatchLifecycleRejectionReason;
}

export interface TeamOutcomeSnapshot {
  teamId: number;
  coreHp: number;
  coreHpBeforeResolution: number;
  coreDestroyed: boolean;
  territoryCellCount: number;
  queuedBuildCount: number;
  appliedBuildCount: number;
  rejectedBuildCount: number;
}

export type TeamStandingOutcome = 'winner' | 'defeated' | 'eliminated';

export interface RankedTeamOutcome {
  rank: number;
  teamId: number;
  outcome: TeamStandingOutcome;
  finalCoreHp: number;
  coreState: 'intact' | 'destroyed';
  territoryCellCount: number;
  queuedBuildCount: number;
  appliedBuildCount: number;
  rejectedBuildCount: number;
}

export interface MatchOutcome {
  winner: RankedTeamOutcome;
  ranked: RankedTeamOutcome[];
  comparator: typeof OUTCOME_COMPARATOR_DESCRIPTION;
}

export const OUTCOME_COMPARATOR_DESCRIPTION =
  'coreHpBeforeResolution desc -> territoryCellCount desc -> appliedBuildCount desc -> teamId asc';

function isStartPreconditionsSatisfied(
  preconditions: LifecyclePreconditions | undefined,
): boolean {
  if (!preconditions) {
    return false;
  }

  return (
    preconditions.hasRequiredPlayers &&
    preconditions.allPlayersConnected &&
    !preconditions.reconnectHoldPending
  );
}

export function transitionMatchLifecycle(
  currentStatus: MatchLifecycleStatus,
  event: MatchLifecycleEvent,
  preconditions?: LifecyclePreconditions,
): LifecycleTransitionResult {
  switch (event) {
    case 'start-countdown': {
      if (currentStatus !== 'lobby') {
        return {
          allowed: false,
          nextStatus: currentStatus,
          reason: 'invalid-transition',
        };
      }
      if (!isStartPreconditionsSatisfied(preconditions)) {
        return {
          allowed: false,
          nextStatus: currentStatus,
          reason: 'start-preconditions-not-met',
        };
      }
      return { allowed: true, nextStatus: 'countdown' };
    }

    case 'restart-countdown': {
      if (currentStatus !== 'finished') {
        return {
          allowed: false,
          nextStatus: currentStatus,
          reason: 'invalid-transition',
        };
      }
      if (!isStartPreconditionsSatisfied(preconditions)) {
        return {
          allowed: false,
          nextStatus: currentStatus,
          reason: 'start-preconditions-not-met',
        };
      }
      return { allowed: true, nextStatus: 'countdown' };
    }

    case 'cancel-countdown': {
      if (currentStatus !== 'countdown') {
        return {
          allowed: false,
          nextStatus: currentStatus,
          reason: 'invalid-transition',
        };
      }
      return { allowed: true, nextStatus: 'lobby' };
    }

    case 'countdown-complete': {
      if (currentStatus !== 'countdown') {
        return {
          allowed: false,
          nextStatus: currentStatus,
          reason: 'invalid-transition',
        };
      }
      return { allowed: true, nextStatus: 'active' };
    }

    case 'finish': {
      if (currentStatus !== 'active') {
        return {
          allowed: false,
          nextStatus: currentStatus,
          reason: 'invalid-transition',
        };
      }
      return { allowed: true, nextStatus: 'finished' };
    }

    default: {
      const _exhaustive: never = event;
      return {
        allowed: false,
        nextStatus: currentStatus,
        reason: 'invalid-transition',
      };
    }
  }
}

function compareOutcomeSnapshots(
  left: TeamOutcomeSnapshot,
  right: TeamOutcomeSnapshot,
): number {
  if (left.coreHpBeforeResolution !== right.coreHpBeforeResolution) {
    return right.coreHpBeforeResolution - left.coreHpBeforeResolution;
  }
  if (left.territoryCellCount !== right.territoryCellCount) {
    return right.territoryCellCount - left.territoryCellCount;
  }
  if (left.appliedBuildCount !== right.appliedBuildCount) {
    return right.appliedBuildCount - left.appliedBuildCount;
  }
  return left.teamId - right.teamId;
}

export function rankTeamsForOutcome(
  snapshots: TeamOutcomeSnapshot[],
): RankedTeamOutcome[] {
  const rankedSnapshots = [...snapshots].sort(compareOutcomeSnapshots);

  return rankedSnapshots.map((snapshot, index) => {
    const rank = index + 1;
    const outcome: TeamStandingOutcome =
      rank === 1
        ? 'winner'
        : snapshot.coreDestroyed
          ? 'eliminated'
          : 'defeated';

    return {
      rank,
      teamId: snapshot.teamId,
      outcome,
      finalCoreHp: snapshot.coreHp,
      coreState: snapshot.coreDestroyed ? 'destroyed' : 'intact',
      territoryCellCount: snapshot.territoryCellCount,
      queuedBuildCount: snapshot.queuedBuildCount,
      appliedBuildCount: snapshot.appliedBuildCount,
      rejectedBuildCount: snapshot.rejectedBuildCount,
    };
  });
}

export function determineMatchOutcome(
  snapshots: TeamOutcomeSnapshot[],
): MatchOutcome | null {
  if (snapshots.length === 0) {
    return null;
  }

  const ranked = rankTeamsForOutcome(snapshots);
  return {
    winner: ranked[0],
    ranked,
    comparator: OUTCOME_COMPARATOR_DESCRIPTION,
  };
}
