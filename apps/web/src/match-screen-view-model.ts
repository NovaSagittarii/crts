import type { RoomStatus } from '#rts-engine';

export type MatchScreen = 'lobby' | 'ingame';

export type ReconnectNoticeMode = 'hidden' | 'syncing' | 'synced';

export interface MatchScreenViewState {
  status: RoomStatus;
  screen: MatchScreen;
  pendingReconnect: boolean;
  reconnectNotice: ReconnectNoticeMode;
}

export interface AuthoritativeStatusResult {
  state: MatchScreenViewState;
  statusChanged: boolean;
  screenChanged: boolean;
  transitionBannerCopy: string | null;
  reconnectCopy: string | null;
}

export const SCREEN_TRANSITION_NOTICE_MS = 2400;
export const RECONNECT_NOTICE_MS = 2400;
export const RECONNECT_SYNCING_COPY = 'Reconnecting / syncing...';
export const RECONNECT_SYNCED_COPY = 'Reconnected. Synced to match state.';

function formatStatusLabel(status: RoomStatus): string {
  if (status === 'countdown') {
    return 'Countdown';
  }
  if (status === 'active') {
    return 'Active';
  }
  if (status === 'finished') {
    return 'Finished';
  }
  return 'Lobby';
}

export function resolveScreenForStatus(status: RoomStatus): MatchScreen {
  if (status === 'active' || status === 'finished') {
    return 'ingame';
  }
  return 'lobby';
}

export function createMatchScreenViewState(
  initialStatus: RoomStatus = 'lobby',
): MatchScreenViewState {
  return {
    status: initialStatus,
    screen: resolveScreenForStatus(initialStatus),
    pendingReconnect: false,
    reconnectNotice: 'hidden',
  };
}

export function markReconnectPending(
  state: MatchScreenViewState,
): MatchScreenViewState {
  return {
    ...state,
    pendingReconnect: true,
    reconnectNotice: 'syncing',
  };
}

export function getReconnectNoticeCopy(
  state: MatchScreenViewState,
): string | null {
  if (state.reconnectNotice === 'syncing') {
    return RECONNECT_SYNCING_COPY;
  }
  if (state.reconnectNotice === 'synced') {
    return RECONNECT_SYNCED_COPY;
  }
  return null;
}

export function isReconnectSyncing(state: MatchScreenViewState): boolean {
  return state.reconnectNotice === 'syncing';
}

export function hasVisibleReconnectNotice(
  state: MatchScreenViewState,
): boolean {
  return state.reconnectNotice !== 'hidden';
}

export function clearReconnectNotice(
  state: MatchScreenViewState,
): MatchScreenViewState {
  if (state.reconnectNotice === 'hidden') {
    return state;
  }
  return {
    ...state,
    reconnectNotice: 'hidden',
  };
}

export function applyAuthoritativeStatus(
  state: MatchScreenViewState,
  nextStatus: RoomStatus,
): AuthoritativeStatusResult {
  const nextScreen = resolveScreenForStatus(nextStatus);
  const statusChanged = state.status !== nextStatus;
  const screenChanged = state.screen !== nextScreen;
  const resolvingReconnect =
    state.pendingReconnect || state.reconnectNotice === 'syncing';

  const nextState: MatchScreenViewState = {
    status: nextStatus,
    screen: nextScreen,
    pendingReconnect: false,
    reconnectNotice: resolvingReconnect ? 'synced' : state.reconnectNotice,
  };

  return {
    state: nextState,
    statusChanged,
    screenChanged,
    transitionBannerCopy: statusChanged
      ? `Lifecycle update: ${formatStatusLabel(nextStatus)}.`
      : null,
    reconnectCopy: resolvingReconnect ? RECONNECT_SYNCED_COPY : null,
  };
}
