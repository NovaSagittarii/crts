export interface DestroySelectableStructure {
  key: string;
  teamId: number;
  templateName: string;
  requiresDestroyConfirm: boolean;
}

export interface DestroyOutcomeLike {
  structureKey: string;
  outcome: 'destroyed' | 'rejected';
}

export interface DestroyViewModelState {
  selectedKey: string | null;
  selectedTeamId: number | null;
  selectedTemplateName: string | null;
  selectedOwned: boolean;
  requiresConfirm: boolean;
  confirmArmed: boolean;
  pendingStructureKeys: string[];
}

function dedupeStructureKeys(keys: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const key of keys) {
    const normalized = key.trim();
    if (normalized) {
      unique.add(normalized);
    }
  }

  return [...unique].sort((left, right) => left.localeCompare(right));
}

export function createDestroyViewModelState(): DestroyViewModelState {
  return {
    selectedKey: null,
    selectedTeamId: null,
    selectedTemplateName: null,
    selectedOwned: false,
    requiresConfirm: false,
    confirmArmed: false,
    pendingStructureKeys: [],
  };
}

export function selectDestroyStructure(
  state: DestroyViewModelState,
  structure: DestroySelectableStructure,
  currentTeamId: number | null,
): DestroyViewModelState {
  const selectedOwned =
    currentTeamId !== null && structure.teamId === currentTeamId;

  return {
    ...state,
    selectedKey: structure.key,
    selectedTeamId: structure.teamId,
    selectedTemplateName: structure.templateName,
    selectedOwned,
    requiresConfirm: selectedOwned && structure.requiresDestroyConfirm,
    confirmArmed: false,
  };
}

export function refreshDestroySelection(
  state: DestroyViewModelState,
  structure: DestroySelectableStructure | null,
  currentTeamId: number | null,
): DestroyViewModelState {
  if (!structure) {
    return {
      ...state,
      selectedKey: null,
      selectedTeamId: null,
      selectedTemplateName: null,
      selectedOwned: false,
      requiresConfirm: false,
      confirmArmed: false,
    };
  }

  const selectedOwned =
    currentTeamId !== null && structure.teamId === currentTeamId;
  const nextRequiresConfirm = selectedOwned && structure.requiresDestroyConfirm;

  return {
    ...state,
    selectedKey: structure.key,
    selectedTeamId: structure.teamId,
    selectedTemplateName: structure.templateName,
    selectedOwned,
    requiresConfirm: nextRequiresConfirm,
    confirmArmed: nextRequiresConfirm ? state.confirmArmed : false,
  };
}

export function clearDestroySelection(
  state: DestroyViewModelState,
): DestroyViewModelState {
  return {
    ...state,
    selectedKey: null,
    selectedTeamId: null,
    selectedTemplateName: null,
    selectedOwned: false,
    requiresConfirm: false,
    confirmArmed: false,
  };
}

export function armDestroyConfirm(
  state: DestroyViewModelState,
): DestroyViewModelState {
  if (!state.selectedKey || !state.selectedOwned || !state.requiresConfirm) {
    return state;
  }

  return {
    ...state,
    confirmArmed: true,
  };
}

export function cancelDestroyConfirm(
  state: DestroyViewModelState,
): DestroyViewModelState {
  if (!state.confirmArmed) {
    return state;
  }

  return {
    ...state,
    confirmArmed: false,
  };
}

export function syncDestroyPending(
  state: DestroyViewModelState,
  pendingStructureKeys: readonly string[],
): DestroyViewModelState {
  const nextPending = dedupeStructureKeys(pendingStructureKeys);
  return {
    ...state,
    pendingStructureKeys: nextPending,
  };
}

export function registerDestroyQueued(
  state: DestroyViewModelState,
  structureKey: string,
): DestroyViewModelState {
  const normalized = structureKey.trim();
  if (!normalized) {
    return state;
  }

  const nextPending = dedupeStructureKeys([
    ...state.pendingStructureKeys,
    normalized,
  ]);
  return {
    ...state,
    pendingStructureKeys: nextPending,
    confirmArmed:
      state.selectedKey === normalized && state.requiresConfirm
        ? false
        : state.confirmArmed,
  };
}

export function registerDestroyOutcome(
  state: DestroyViewModelState,
  outcome: DestroyOutcomeLike,
): DestroyViewModelState {
  const nextPending = state.pendingStructureKeys.filter(
    (key) => key !== outcome.structureKey,
  );

  const withoutPending = {
    ...state,
    pendingStructureKeys: nextPending,
  };

  if (
    outcome.outcome !== 'destroyed' ||
    state.selectedKey !== outcome.structureKey
  ) {
    return withoutPending;
  }

  return clearDestroySelection(withoutPending);
}

export function isSelectedDestroyPending(
  state: DestroyViewModelState,
): boolean {
  return Boolean(
    state.selectedKey && state.pendingStructureKeys.includes(state.selectedKey),
  );
}

export function canQueueDestroy(state: DestroyViewModelState): boolean {
  if (!state.selectedKey || !state.selectedOwned) {
    return false;
  }
  if (isSelectedDestroyPending(state)) {
    return false;
  }
  if (state.requiresConfirm && !state.confirmArmed) {
    return false;
  }
  return true;
}
