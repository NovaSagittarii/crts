import type {
  MembershipParticipant,
  RoomMembershipPayload,
  RoomStatePayload,
} from '#rts-engine';

export interface PlayerIdentityState {
  sessionId: string | null;
  name: string;
}

export interface AuthoritativePlayerIdentity {
  sessionId: string;
  name: string;
}

export function createPlayerIdentityState(
  sessionId: string | null,
  name = '',
): PlayerIdentityState {
  return {
    sessionId,
    name,
  };
}

export function applyAuthoritativeIdentity(
  state: PlayerIdentityState,
  payload: AuthoritativePlayerIdentity,
): PlayerIdentityState {
  return {
    ...state,
    sessionId: payload.sessionId,
    name: payload.name,
  };
}

export function selectSelfParticipant(
  membership: RoomMembershipPayload | null,
  sessionId: string | null,
): MembershipParticipant | null {
  if (!membership || !sessionId) {
    return null;
  }

  return (
    membership.participants.find(
      (participant) => participant.sessionId === sessionId,
    ) ?? null
  );
}

export function selectIsHost(
  membership: RoomMembershipPayload | null,
  sessionId: string | null,
): boolean {
  if (!membership || !sessionId) {
    return false;
  }

  return membership.hostSessionId === sessionId;
}

export function resolveTeamIdForSession(
  teams: RoomStatePayload['teams'],
  sessionId: string | null,
): number | null {
  if (!sessionId) {
    return null;
  }

  const nextTeam = teams.find(({ playerIds }) => playerIds.includes(sessionId));
  return nextTeam?.id ?? null;
}
