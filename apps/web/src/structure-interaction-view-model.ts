export const DEFAULT_HOVER_LEAVE_GRACE_MS = 300;

export interface StructureInteractionState {
  hoverKey: string | null;
  pinnedKey: string | null;
  hoverLeaveExpiresAtMs: number | null;
}

export type StructureInteractionAction =
  | { type: 'hover-enter'; structureKey: string }
  | { type: 'hover-leave'; atMs: number; graceMs?: number }
  | { type: 'pin'; structureKey: string }
  | { type: 'pin-active'; atMs?: number }
  | { type: 'unpin' }
  | { type: 'clear' }
  | { type: 'tick'; atMs: number }
  | { type: 'reconcile'; availableStructureKeys: readonly string[] };

function normalizeStructureKey(key: string): string {
  return key.trim();
}

function normalizeGraceMs(graceMs: number | undefined): number {
  if (typeof graceMs !== 'number' || !Number.isFinite(graceMs)) {
    return DEFAULT_HOVER_LEAVE_GRACE_MS;
  }
  return Math.max(0, Math.trunc(graceMs));
}

function toAvailableKeySet(keys: readonly string[]): Set<string> {
  const available = new Set<string>();
  for (const key of keys) {
    const normalized = normalizeStructureKey(key);
    if (normalized) {
      available.add(normalized);
    }
  }
  return available;
}

function expireHoverIfNeeded(
  state: StructureInteractionState,
  atMs: number,
): StructureInteractionState {
  if (
    !state.hoverKey ||
    state.hoverLeaveExpiresAtMs === null ||
    atMs < state.hoverLeaveExpiresAtMs
  ) {
    return state;
  }

  return {
    ...state,
    hoverKey: null,
    hoverLeaveExpiresAtMs: null,
  };
}

export function createStructureInteractionState(): StructureInteractionState {
  return {
    hoverKey: null,
    pinnedKey: null,
    hoverLeaveExpiresAtMs: null,
  };
}

export function reduceStructureInteraction(
  state: StructureInteractionState,
  action: StructureInteractionAction,
): StructureInteractionState {
  if (action.type === 'hover-enter') {
    const structureKey = normalizeStructureKey(action.structureKey);
    if (!structureKey) {
      return state;
    }

    if (state.pinnedKey && state.pinnedKey !== structureKey) {
      return state;
    }

    if (
      state.hoverKey === structureKey &&
      state.hoverLeaveExpiresAtMs === null &&
      state.pinnedKey === null
    ) {
      return state;
    }

    return {
      ...state,
      hoverKey: structureKey,
      hoverLeaveExpiresAtMs: null,
    };
  }

  if (action.type === 'hover-leave') {
    if (!state.hoverKey) {
      return state;
    }

    return {
      ...state,
      hoverLeaveExpiresAtMs: action.atMs + normalizeGraceMs(action.graceMs),
    };
  }

  if (action.type === 'pin') {
    const structureKey = normalizeStructureKey(action.structureKey);
    if (!structureKey) {
      return state;
    }

    return {
      ...state,
      hoverKey: structureKey,
      pinnedKey: structureKey,
      hoverLeaveExpiresAtMs: null,
    };
  }

  if (action.type === 'pin-active') {
    const activeKey = selectActiveStructureKey(state, action.atMs ?? null);
    if (!activeKey) {
      return state;
    }

    return {
      ...state,
      hoverKey: activeKey,
      pinnedKey: activeKey,
      hoverLeaveExpiresAtMs: null,
    };
  }

  if (action.type === 'unpin') {
    if (!state.pinnedKey) {
      return state;
    }

    return {
      ...state,
      pinnedKey: null,
      hoverLeaveExpiresAtMs: null,
    };
  }

  if (action.type === 'clear') {
    return createStructureInteractionState();
  }

  if (action.type === 'tick') {
    return expireHoverIfNeeded(state, action.atMs);
  }

  const available = toAvailableKeySet(action.availableStructureKeys);
  const keepPinned = state.pinnedKey && available.has(state.pinnedKey);
  const keepHover = state.hoverKey && available.has(state.hoverKey);

  return {
    hoverKey: keepHover ? state.hoverKey : null,
    pinnedKey: keepPinned ? state.pinnedKey : null,
    hoverLeaveExpiresAtMs: keepHover ? state.hoverLeaveExpiresAtMs : null,
  };
}

export function selectActiveStructureKey(
  state: StructureInteractionState,
  nowMs: number | null = null,
): string | null {
  if (state.pinnedKey) {
    return state.pinnedKey;
  }

  if (!state.hoverKey) {
    return null;
  }

  if (
    nowMs !== null &&
    state.hoverLeaveExpiresAtMs !== null &&
    nowMs >= state.hoverLeaveExpiresAtMs
  ) {
    return null;
  }

  return state.hoverKey;
}

export function selectHoverPreviewStructureKey(
  state: StructureInteractionState,
  nowMs: number | null = null,
): string | null {
  if (state.pinnedKey) {
    return null;
  }

  return selectActiveStructureKey(state, nowMs);
}

export function selectStructureInteractionMode(
  state: StructureInteractionState,
  nowMs: number | null = null,
): 'idle' | 'hover' | 'pinned' {
  if (state.pinnedKey) {
    return 'pinned';
  }

  return selectActiveStructureKey(state, nowMs) ? 'hover' : 'idle';
}

export function canShowStructureActions(
  state: StructureInteractionState,
  nowMs: number | null = null,
): boolean {
  const activeKey = selectActiveStructureKey(state, nowMs);
  return Boolean(activeKey && state.pinnedKey === activeKey);
}

export function isStructurePinned(
  state: StructureInteractionState,
  structureKey: string,
): boolean {
  return state.pinnedKey === normalizeStructureKey(structureKey);
}
