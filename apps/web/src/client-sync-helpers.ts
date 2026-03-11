export type AuthoritativePreviewSection = 'full' | 'grid' | 'structures';

export type GameplayEventSyncKind =
  | 'build:queued'
  | 'build:outcome'
  | 'destroy:queued'
  | 'destroy:outcome';

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
