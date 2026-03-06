import type { RoomStateHashesPayload, StateRequestSection } from '#rts-engine';

export interface AppliedStateHashes {
  gridHash: string | null;
  structuresHash: string | null;
  membershipHash: string | null;
}

export interface StateHashResyncState {
  applied: AppliedStateHashes;
  awaitingHashesAfterFullState: boolean;
}

export interface StateHashResyncResult {
  state: StateHashResyncState;
  requestSections: StateRequestSection[];
}

const EMPTY_APPLIED_HASHES: AppliedStateHashes = {
  gridHash: null,
  structuresHash: null,
  membershipHash: null,
};

export function createStateHashResyncState(): StateHashResyncState {
  return {
    applied: { ...EMPTY_APPLIED_HASHES },
    awaitingHashesAfterFullState: false,
  };
}

export function resetStateHashResyncState(): StateHashResyncState {
  return createStateHashResyncState();
}

export function applyJoinedHashes(
  _state: StateHashResyncState,
  payload: RoomStateHashesPayload,
): StateHashResyncState {
  return {
    applied: {
      gridHash: payload.gridHash,
      structuresHash: payload.structuresHash,
      membershipHash: payload.roomMembershipHash,
    },
    awaitingHashesAfterFullState: false,
  };
}

export function noteAppliedGridHash(
  state: StateHashResyncState,
  hashHex: string,
): StateHashResyncState {
  return {
    ...state,
    applied: {
      ...state.applied,
      gridHash: hashHex,
    },
  };
}

export function noteAppliedStructuresHash(
  state: StateHashResyncState,
  hashHex: string,
): StateHashResyncState {
  return {
    ...state,
    applied: {
      ...state.applied,
      structuresHash: hashHex,
    },
  };
}

export function noteAppliedMembershipHash(
  state: StateHashResyncState,
  membershipHash: string,
): StateHashResyncState {
  return {
    ...state,
    applied: {
      ...state.applied,
      membershipHash,
    },
  };
}

export function markAwaitingHashesAfterFullState(
  state: StateHashResyncState,
): StateHashResyncState {
  if (state.awaitingHashesAfterFullState) {
    return state;
  }

  return {
    ...state,
    awaitingHashesAfterFullState: true,
  };
}

export function reconcileIncomingHashes(
  state: StateHashResyncState,
  payload: RoomStateHashesPayload,
): StateHashResyncResult {
  if (state.awaitingHashesAfterFullState) {
    return {
      state: applyJoinedHashes(state, payload),
      requestSections: [],
    };
  }

  const requestSections: StateRequestSection[] = [];
  if (state.applied.gridHash !== payload.gridHash) {
    requestSections.push('grid');
  }
  if (state.applied.structuresHash !== payload.structuresHash) {
    requestSections.push('structures');
  }
  if (state.applied.membershipHash !== payload.roomMembershipHash) {
    requestSections.push('membership');
  }

  return {
    state,
    requestSections,
  };
}
