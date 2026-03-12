import type { StateRequestPayload, StateRequestSection } from '#rts-engine';

export type AuthoritativePreviewSection = Exclude<
  StateRequestSection,
  'membership'
>;

export type GameplayEventSyncKind =
  | 'build:queued'
  | 'build:outcome'
  | 'destroy:queued'
  | 'destroy:outcome';

export interface ScopedGameplayEventPayload {
  roomId: string;
  teamId: number;
}

export interface GameplayEventRoutingDecision {
  appliesToRoom: boolean;
  appliesToCurrentTeam: boolean;
  sections: StateRequestPayload['sections'];
}

export interface AuthoritativePreviewRefreshState {
  full: number | null;
  grid: number | null;
  structures: number | null;
}

export interface ShouldRefreshAuthoritativePreviewInput {
  section: AuthoritativePreviewSection;
  tick: number;
  hasSelectedPlacement: boolean;
  canMutateGameplay: boolean;
  previewPending: boolean;
  state: AuthoritativePreviewRefreshState;
}

export function createAuthoritativePreviewRefreshState(): AuthoritativePreviewRefreshState {
  return {
    full: null,
    grid: null,
    structures: null,
  };
}

export function shouldApplyRoomScopedPayload(
  activeRoomId: string,
  payloadRoomId: string | null,
): boolean {
  return payloadRoomId === null || payloadRoomId === activeRoomId;
}

export function shouldRefreshAuthoritativePreview(
  input: ShouldRefreshAuthoritativePreviewInput,
): boolean {
  return (
    input.hasSelectedPlacement &&
    input.canMutateGameplay &&
    !input.previewPending &&
    input.state[input.section] !== input.tick
  );
}

export function recordAuthoritativePreviewRefresh(
  state: AuthoritativePreviewRefreshState,
  section: AuthoritativePreviewSection,
  tick: number,
): AuthoritativePreviewRefreshState {
  return {
    ...state,
    [section]: tick,
  };
}

export function getStateRequestSectionsForGameplayEvent(
  _event: GameplayEventSyncKind,
): undefined {
  return undefined;
}

export function resolveGameplayEventRouting(
  event: GameplayEventSyncKind,
  payload: ScopedGameplayEventPayload,
  activeRoomId: string,
  activeTeamId: number | null,
): GameplayEventRoutingDecision {
  const appliesToRoom = payload.roomId === activeRoomId;
  return {
    appliesToRoom,
    appliesToCurrentTeam:
      appliesToRoom && activeTeamId !== null && payload.teamId === activeTeamId,
    sections: appliesToRoom
      ? getStateRequestSectionsForGameplayEvent(event)
      : undefined,
  };
}
