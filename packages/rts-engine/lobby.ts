export type LobbySlotId = string;

export interface LobbyParticipantState {
  sessionId: string;
  displayName: string;
  joinOrder: number;
  role: 'player' | 'spectator';
  slotId: LobbySlotId | null;
  ready: boolean;
}

export interface LobbyRoomState {
  roomId: string;
  slotIds: LobbySlotId[];
  hostSessionId: string | null;
  participants: Map<string, LobbyParticipantState>;
  slotAssignments: Map<LobbySlotId, string | null>;
  joinOrder: string[];
  nextJoinOrder: number;
}

export interface CreateLobbyRoomOptions {
  roomId: string;
  slotIds: LobbySlotId[];
}

export interface JoinLobbyInput {
  sessionId: string;
  displayName: string;
}

export type LobbyRejectionReason =
  | 'invalid-slot'
  | 'not-player'
  | 'participant-not-found'
  | 'slot-full'
  | 'team-switch-locked';

export interface LobbyMutationResult {
  ok: boolean;
  message: string;
  reason?: LobbyRejectionReason;
}

export interface LobbySnapshot {
  roomId: string;
  hostSessionId: string | null;
  slots: Record<string, string | null>;
  participants: LobbyParticipantState[];
}

function cloneParticipant(
  participant: LobbyParticipantState,
): LobbyParticipantState {
  return {
    sessionId: participant.sessionId,
    displayName: participant.displayName,
    joinOrder: participant.joinOrder,
    role: participant.role,
    slotId: participant.slotId,
    ready: participant.ready,
  };
}

function reject(
  reason: LobbyRejectionReason,
  message: string,
): LobbyMutationResult {
  return {
    ok: false,
    reason,
    message,
  };
}

function chooseNextHost(room: LobbyRoomState): string | null {
  for (const sessionId of room.joinOrder) {
    if (room.participants.has(sessionId)) {
      return sessionId;
    }
  }
  return null;
}

export function createLobbyRoom(
  options: CreateLobbyRoomOptions,
): LobbyRoomState {
  if (options.slotIds.length === 0) {
    throw new Error('Lobby room must define at least one slot');
  }

  const dedupedSlots = new Set(options.slotIds);
  if (dedupedSlots.size !== options.slotIds.length) {
    throw new Error('Lobby room slot IDs must be unique');
  }

  const slotAssignments = new Map<LobbySlotId, string | null>();
  for (const slotId of options.slotIds) {
    slotAssignments.set(slotId, null);
  }

  return {
    roomId: options.roomId,
    slotIds: [...options.slotIds],
    hostSessionId: null,
    participants: new Map<string, LobbyParticipantState>(),
    slotAssignments,
    joinOrder: [],
    nextJoinOrder: 0,
  };
}

export function joinLobby(
  room: LobbyRoomState,
  input: JoinLobbyInput,
): LobbyParticipantState {
  const existing = room.participants.get(input.sessionId);
  if (existing) {
    existing.displayName = input.displayName;
    return cloneParticipant(existing);
  }

  const participant: LobbyParticipantState = {
    sessionId: input.sessionId,
    displayName: input.displayName,
    joinOrder: room.nextJoinOrder,
    role: 'spectator',
    slotId: null,
    ready: false,
  };
  room.nextJoinOrder += 1;

  room.participants.set(participant.sessionId, participant);
  room.joinOrder.push(participant.sessionId);

  if (!room.hostSessionId) {
    room.hostSessionId = participant.sessionId;
  }

  return cloneParticipant(participant);
}

export function claimLobbySlot(
  room: LobbyRoomState,
  sessionId: string,
  slotId: LobbySlotId,
): LobbyMutationResult {
  const participant = room.participants.get(sessionId);
  if (!participant) {
    return reject('participant-not-found', 'Participant is not in this lobby');
  }

  if (!room.slotAssignments.has(slotId)) {
    return reject('invalid-slot', `Team slot ${slotId} does not exist`);
  }

  const currentOccupant = room.slotAssignments.get(slotId);
  if (currentOccupant && currentOccupant !== sessionId) {
    return reject('slot-full', `Team slot ${slotId} is full`);
  }

  if (participant.role === 'player') {
    if (participant.slotId === slotId) {
      return {
        ok: true,
        message: `Already assigned to ${slotId}`,
      };
    }
    return reject(
      'team-switch-locked',
      `Team switching is locked after claiming ${participant.slotId}`,
    );
  }

  participant.role = 'player';
  participant.slotId = slotId;
  participant.ready = false;
  room.slotAssignments.set(slotId, sessionId);

  return {
    ok: true,
    message: `Claimed ${slotId}`,
  };
}

export function setLobbyReady(
  room: LobbyRoomState,
  sessionId: string,
  ready: boolean,
): LobbyMutationResult {
  const participant = room.participants.get(sessionId);
  if (!participant) {
    return reject('participant-not-found', 'Participant is not in this lobby');
  }

  if (participant.role !== 'player' || !participant.slotId) {
    return reject('not-player', 'Only assigned players can toggle readiness');
  }

  participant.ready = ready;
  return {
    ok: true,
    message: `Ready state set to ${ready}`,
  };
}

export function leaveLobby(
  room: LobbyRoomState,
  sessionId: string,
): LobbyMutationResult {
  const participant = room.participants.get(sessionId);
  if (!participant) {
    return reject('participant-not-found', 'Participant is not in this lobby');
  }

  if (participant.slotId) {
    const occupiedBy = room.slotAssignments.get(participant.slotId);
    if (occupiedBy === sessionId) {
      room.slotAssignments.set(participant.slotId, null);
    }
  }

  room.participants.delete(sessionId);
  room.joinOrder = room.joinOrder.filter(
    (candidate) => candidate !== sessionId,
  );

  if (room.hostSessionId === sessionId) {
    room.hostSessionId = chooseNextHost(room);
  }

  return {
    ok: true,
    message: `${sessionId} left the lobby`,
  };
}

export function getLobbySnapshot(room: LobbyRoomState): LobbySnapshot {
  const slots: Record<string, string | null> = {};
  for (const slotId of room.slotIds) {
    slots[slotId] = room.slotAssignments.get(slotId) ?? null;
  }

  const participants = room.joinOrder
    .map((sessionId) => room.participants.get(sessionId))
    .filter((participant): participant is LobbyParticipantState =>
      Boolean(participant),
    )
    .map((participant) => cloneParticipant(participant));

  return {
    roomId: room.roomId,
    hostSessionId: room.hostSessionId,
    slots,
    participants,
  };
}
