import { describe, expect, test } from 'vitest';

import {
  determineMatchOutcome,
  rankTeamsForOutcome,
  transitionMatchLifecycle,
  type LifecyclePreconditions,
  type TeamOutcomeSnapshot,
} from './match-lifecycle.js';

const READY_PRECONDITIONS: LifecyclePreconditions = {
  hasRequiredPlayers: true,
  allPlayersConnected: true,
  reconnectHoldPending: false,
};

describe('match lifecycle helpers', () => {
  test('allows canonical lifecycle progression from lobby to finished', () => {
    const toCountdown = transitionMatchLifecycle(
      'lobby',
      'start-countdown',
      READY_PRECONDITIONS,
    );
    expect(toCountdown.allowed).toBe(true);
    expect(toCountdown.nextStatus).toBe('countdown');

    const toActive = transitionMatchLifecycle(
      'countdown',
      'countdown-complete',
    );
    expect(toActive.allowed).toBe(true);
    expect(toActive.nextStatus).toBe('active');

    const toFinished = transitionMatchLifecycle('active', 'finish');
    expect(toFinished.allowed).toBe(true);
    expect(toFinished.nextStatus).toBe('finished');
  });

  test('allows host cancel transition from countdown back to lobby', () => {
    const result = transitionMatchLifecycle('countdown', 'cancel-countdown');
    expect(result.allowed).toBe(true);
    expect(result.nextStatus).toBe('lobby');
  });

  test('guards restart from finished until start preconditions are satisfied', () => {
    const blocked = transitionMatchLifecycle('finished', 'restart-countdown', {
      hasRequiredPlayers: true,
      allPlayersConnected: false,
      reconnectHoldPending: false,
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.nextStatus).toBe('finished');
    expect(blocked.reason).toBe('start-preconditions-not-met');

    const allowed = transitionMatchLifecycle(
      'finished',
      'restart-countdown',
      READY_PRECONDITIONS,
    );
    expect(allowed.allowed).toBe(true);
    expect(allowed.nextStatus).toBe('countdown');
  });
});

describe('canonical breach ranking', () => {
  test('orders same-tick eliminations by documented total-order comparator', () => {
    const ranked = rankTeamsForOutcome([
      {
        teamId: 4,
        coreHp: 0,
        coreHpBeforeResolution: 1,
        coreDestroyed: true,
        territoryCellCount: 12,
        queuedBuildCount: 2,
        appliedBuildCount: 3,
        rejectedBuildCount: 1,
      },
      {
        teamId: 2,
        coreHp: 0,
        coreHpBeforeResolution: 1,
        coreDestroyed: true,
        territoryCellCount: 12,
        queuedBuildCount: 4,
        appliedBuildCount: 3,
        rejectedBuildCount: 0,
      },
      {
        teamId: 7,
        coreHp: 0,
        coreHpBeforeResolution: 1,
        coreDestroyed: true,
        territoryCellCount: 12,
        queuedBuildCount: 3,
        appliedBuildCount: 1,
        rejectedBuildCount: 2,
      },
      {
        teamId: 9,
        coreHp: 0,
        coreHpBeforeResolution: 0,
        coreDestroyed: true,
        territoryCellCount: 30,
        queuedBuildCount: 6,
        appliedBuildCount: 5,
        rejectedBuildCount: 0,
      },
    ]);

    expect(ranked.map((entry: { teamId: number }) => entry.teamId)).toEqual([
      2, 4, 7, 9,
    ]);
  });

  test('builds winner-first ranked outcomes with required per-team stats', () => {
    const snapshots: TeamOutcomeSnapshot[] = [
      {
        teamId: 2,
        coreHp: 2,
        coreHpBeforeResolution: 2,
        coreDestroyed: false,
        territoryCellCount: 18,
        queuedBuildCount: 5,
        appliedBuildCount: 4,
        rejectedBuildCount: 1,
      },
      {
        teamId: 1,
        coreHp: 0,
        coreHpBeforeResolution: 1,
        coreDestroyed: true,
        territoryCellCount: 10,
        queuedBuildCount: 5,
        appliedBuildCount: 3,
        rejectedBuildCount: 2,
      },
    ];

    const outcome = determineMatchOutcome(snapshots);
    expect(outcome).not.toBeNull();
    expect(outcome?.winner.teamId).toBe(2);

    expect(outcome?.ranked).toEqual([
      {
        rank: 1,
        teamId: 2,
        outcome: 'winner',
        finalCoreHp: 2,
        coreState: 'intact',
        territoryCellCount: 18,
        queuedBuildCount: 5,
        appliedBuildCount: 4,
        rejectedBuildCount: 1,
      },
      {
        rank: 2,
        teamId: 1,
        outcome: 'eliminated',
        finalCoreHp: 0,
        coreState: 'destroyed',
        territoryCellCount: 10,
        queuedBuildCount: 5,
        appliedBuildCount: 3,
        rejectedBuildCount: 2,
      },
    ]);
  });
});
