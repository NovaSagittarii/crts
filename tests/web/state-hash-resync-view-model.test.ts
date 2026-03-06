import { describe, expect, test } from 'vitest';

import type { RoomStateHashesPayload } from '#rts-engine';

import {
  applyJoinedHashes,
  createStateHashResyncState,
  markAwaitingHashesAfterFullState,
  noteAppliedGridHash,
  noteAppliedMembershipHash,
  noteAppliedStructuresHash,
  reconcileIncomingHashes,
  resetStateHashResyncState,
} from '../../apps/web/src/state-hash-resync-view-model.js';

function createHashes(
  overrides: Partial<RoomStateHashesPayload> = {},
): RoomStateHashesPayload {
  return {
    roomId: 'room-1',
    tick: 12,
    generation: 3,
    hashAlgorithm: 'fnv1a-32',
    gridHash: 'grid-a',
    structuresHash: 'structures-a',
    roomMembershipHash: 'membership-a',
    ...overrides,
  };
}

describe('state hash resync view model', () => {
  test('requests only the sections whose hashes changed after the joined baseline', () => {
    const state = applyJoinedHashes(
      createStateHashResyncState(),
      createHashes(),
    );

    const result = reconcileIncomingHashes(
      state,
      createHashes({
        structuresHash: 'structures-b',
        roomMembershipHash: 'membership-b',
      }),
    );

    expect(result.requestSections).toEqual(['structures', 'membership']);
    expect(result.state).toBe(state);
  });

  test('treats the first hash snapshot after a full-state apply as a new baseline', () => {
    const awaitingState = markAwaitingHashesAfterFullState(
      applyJoinedHashes(createStateHashResyncState(), createHashes()),
    );

    const result = reconcileIncomingHashes(
      awaitingState,
      createHashes({
        gridHash: 'grid-b',
        structuresHash: 'structures-b',
        roomMembershipHash: 'membership-b',
      }),
    );

    expect(result.requestSections).toEqual([]);
    expect(result.state).toEqual({
      applied: {
        gridHash: 'grid-b',
        structuresHash: 'structures-b',
        membershipHash: 'membership-b',
      },
      awaitingHashesAfterFullState: false,
    });
  });

  test('tracks applied partial sections so later diffs request only stale data', () => {
    let state = applyJoinedHashes(createStateHashResyncState(), createHashes());
    state = noteAppliedGridHash(state, 'grid-b');
    state = noteAppliedStructuresHash(state, 'structures-b');
    state = noteAppliedMembershipHash(state, 'membership-a');

    const result = reconcileIncomingHashes(
      state,
      createHashes({
        gridHash: 'grid-b',
        structuresHash: 'structures-b',
        roomMembershipHash: 'membership-c',
      }),
    );

    expect(result.requestSections).toEqual(['membership']);
  });

  test('resets all remembered hashes on room leave', () => {
    const state = resetStateHashResyncState();

    expect(state).toEqual({
      applied: {
        gridHash: null,
        structuresHash: null,
        membershipHash: null,
      },
      awaitingHashesAfterFullState: false,
    });
  });
});
