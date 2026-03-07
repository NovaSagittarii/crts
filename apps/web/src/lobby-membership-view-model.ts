import type { MembershipParticipant, RoomMembershipPayload } from '#rts-engine';

import {
  getLobbySlotColor,
  getLobbySlotLabel,
} from './lobby-slot-presentation.js';
import { selectSelfParticipant } from './player-identity-view-model.js';

export interface LobbySlotMemberViewModel {
  sessionId: string;
  displayName: string;
  metaCopy: string;
  readyCopy: string;
  isHost: boolean;
  isHeld: boolean;
  heldLabel: string | null;
}

export interface LobbySlotViewModel {
  slotId: string;
  label: string;
  color: string;
  capacity: number;
  openSeatCount: number;
  canClaim: boolean;
  claimLabel: string;
  members: LobbySlotMemberViewModel[];
}

export interface LobbySpectatorViewModel {
  sessionId: string;
  displayName: string;
}

export interface LobbyMembershipViewModel {
  slots: LobbySlotViewModel[];
  spectators: LobbySpectatorViewModel[];
}

function formatHeldLabel(
  participant: MembershipParticipant | undefined,
  holdExpiresAt: number | null,
  nowMs: number,
): string | null {
  const isHeld =
    participant?.connectionStatus === 'held' || holdExpiresAt !== null;
  if (!isHeld) {
    return null;
  }

  const heldRemainingMs =
    holdExpiresAt === null ? 0 : Math.max(0, holdExpiresAt - nowMs);
  const heldRemainingSec = Math.ceil(heldRemainingMs / 1000);
  return `Disconnected (${heldRemainingSec}s hold)`;
}

export function deriveLobbyMembershipViewModel(
  payload: RoomMembershipPayload,
  sessionId: string | null,
  nowMs = Date.now(),
): LobbyMembershipViewModel {
  const participantBySession = new Map(
    payload.participants.map((participant) => [
      participant.sessionId,
      participant,
    ]),
  );
  const heldBySession = new Map(
    Object.values(payload.heldSlotMembers)
      .flatMap((holds) => holds)
      .map((hold) => [hold.sessionId, hold]),
  );
  const self = selectSelfParticipant(payload, sessionId);
  const canClaimAnySlot = payload.status === 'lobby' && self?.role !== 'player';

  const slots = payload.slotDefinitions.map(
    ({ slotId, capacity }, slotIndex) => {
      const memberIds = payload.slotMembers[slotId] ?? [];
      const members = memberIds.map((memberId) => {
        const participant = participantBySession.get(memberId);
        const hold = heldBySession.get(memberId) ?? null;
        return {
          sessionId: memberId,
          displayName: participant?.displayName ?? memberId,
          metaCopy: `session: ${memberId}`,
          readyCopy: participant?.ready ? 'Ready' : 'Not Ready',
          isHost: payload.hostSessionId === memberId,
          isHeld: hold !== null || participant?.connectionStatus === 'held',
          heldLabel: formatHeldLabel(
            participant,
            hold?.holdExpiresAt ?? participant?.holdExpiresAt ?? null,
            nowMs,
          ),
        } satisfies LobbySlotMemberViewModel;
      });

      const openSeatCount = Math.max(0, capacity - members.length);
      return {
        slotId,
        label: getLobbySlotLabel(slotId),
        color: getLobbySlotColor(slotId, slotIndex),
        capacity,
        openSeatCount,
        canClaim: canClaimAnySlot && openSeatCount > 0,
        claimLabel: `Join ${getLobbySlotLabel(slotId)}`,
        members,
      } satisfies LobbySlotViewModel;
    },
  );

  const spectators = payload.participants
    .filter((participant) => participant.role === 'spectator')
    .map((participant) => ({
      sessionId: participant.sessionId,
      displayName: participant.displayName,
    }));

  return {
    slots,
    spectators,
  };
}
