import type { RoomMembershipPayload } from '#rts-engine';

import {
  selectIsHost,
  selectSelfParticipant,
} from './player-identity-view-model.js';

export interface LobbyControlsViewModel {
  statusCopy: string;
  countdownCopy: string;
  readyButtonLabel: string;
  readyDisabled: boolean;
  startButtonLabel: string;
  startDisabled: boolean;
}

function countAssignedSeats(payload: RoomMembershipPayload): number {
  return payload.slotDefinitions.reduce(
    (seatCount, { slotId }) =>
      seatCount + (payload.slotMembers[slotId]?.length ?? 0),
    0,
  );
}

function countReadySeats(payload: RoomMembershipPayload): number {
  return payload.participants.filter(
    (participant) => participant.role === 'player' && participant.ready,
  ).length;
}

function countTotalSeats(payload: RoomMembershipPayload): number {
  return payload.slotDefinitions.reduce(
    (seatCount, { capacity }) => seatCount + capacity,
    0,
  );
}

function getCountdownCopy(
  payload: RoomMembershipPayload,
  readySeats: number,
  assignedSeats: number,
  totalSeats: number,
): string {
  if (payload.status === 'countdown') {
    return `Match starts in ${payload.countdownSecondsRemaining ?? 0}s`;
  }

  if (payload.status === 'active') {
    return 'Match active';
  }

  if (payload.status === 'finished') {
    return 'Match finished';
  }

  if (assignedSeats < totalSeats) {
    return `Waiting for teams to fill (${assignedSeats}/${totalSeats} seats claimed, ${readySeats} ready)`;
  }

  return `Waiting for commanders to ready up (${readySeats}/${totalSeats} ready)`;
}

export function deriveLobbyControlsViewModel(
  payload: RoomMembershipPayload,
  sessionId: string | null,
): LobbyControlsViewModel {
  const self = selectSelfParticipant(payload, sessionId);
  const isHost = selectIsHost(payload, sessionId);
  const ready = Boolean(self?.ready);
  const lifecycleLocked = payload.status !== 'lobby';
  const canHostStartOrRestart =
    payload.status === 'lobby' || payload.status === 'finished';
  const assignedSeats = countAssignedSeats(payload);
  const readySeats = countReadySeats(payload);
  const totalSeats = countTotalSeats(payload);

  return {
    statusCopy: `Host: ${payload.hostSessionId ?? 'none'} | rev ${payload.revision} | ${payload.status}`,
    countdownCopy: getCountdownCopy(
      payload,
      readySeats,
      assignedSeats,
      totalSeats,
    ),
    readyButtonLabel: ready ? 'Set Not Ready' : 'Set Ready',
    readyDisabled: self?.role !== 'player' || lifecycleLocked,
    startButtonLabel:
      payload.status === 'finished' ? 'Host Restart' : 'Host Start',
    startDisabled:
      !isHost ||
      !canHostStartOrRestart ||
      (payload.status === 'lobby' &&
        (assignedSeats !== totalSeats || readySeats !== totalSeats)),
  };
}
