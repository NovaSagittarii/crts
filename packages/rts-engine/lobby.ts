export type LobbySlotId = string;

export interface LobbyParticipantState {
  sessionId: string;
  displayName: string;
  joinOrder: number;
  role: 'player' | 'spectator';
  slotId: LobbySlotId | null;
  ready: boolean;
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

export class LobbyRoom {
  public readonly roomId: string;
  private readonly slotIdsInternal: LobbySlotId[];
  private hostSessionId: string | null;
  private readonly participants: Map<string, LobbyParticipantState>;
  private readonly slotAssignments: Map<LobbySlotId, string | null>;
  private joinOrder: string[];
  private nextJoinOrder: number;

  private constructor(options: CreateLobbyRoomOptions) {
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

    this.roomId = options.roomId;
    this.slotIdsInternal = [...options.slotIds];
    this.hostSessionId = null;
    this.participants = new Map<string, LobbyParticipantState>();
    this.slotAssignments = slotAssignments;
    this.joinOrder = [];
    this.nextJoinOrder = 0;
  }

  static create(options: CreateLobbyRoomOptions): LobbyRoom {
    return new LobbyRoom(options);
  }

  slotIds(): LobbySlotId[] {
    return [...this.slotIdsInternal];
  }

  participantCount(): number {
    return this.participants.size;
  }

  getParticipant(sessionId: string): LobbyParticipantState | null {
    const participant = this.participants.get(sessionId);
    if (!participant) {
      return null;
    }
    return cloneParticipant(participant);
  }

  join(input: JoinLobbyInput): LobbyParticipantState {
    const existing = this.participants.get(input.sessionId);
    if (existing) {
      existing.displayName = input.displayName;
      return cloneParticipant(existing);
    }

    const participant: LobbyParticipantState = {
      sessionId: input.sessionId,
      displayName: input.displayName,
      joinOrder: this.nextJoinOrder,
      role: 'spectator',
      slotId: null,
      ready: false,
    };
    this.nextJoinOrder += 1;

    this.participants.set(participant.sessionId, participant);
    this.joinOrder.push(participant.sessionId);

    if (!this.hostSessionId) {
      this.hostSessionId = participant.sessionId;
    }

    return cloneParticipant(participant);
  }

  claimSlot(sessionId: string, slotId: LobbySlotId): LobbyMutationResult {
    const participant = this.participants.get(sessionId);
    if (!participant) {
      return reject(
        'participant-not-found',
        'Participant is not in this lobby',
      );
    }

    if (!this.slotAssignments.has(slotId)) {
      return reject('invalid-slot', `Team slot ${slotId} does not exist`);
    }

    const currentOccupant = this.slotAssignments.get(slotId);
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
    this.slotAssignments.set(slotId, sessionId);

    return {
      ok: true,
      message: `Claimed ${slotId}`,
    };
  }

  setReady(sessionId: string, ready: boolean): LobbyMutationResult {
    const participant = this.participants.get(sessionId);
    if (!participant) {
      return reject(
        'participant-not-found',
        'Participant is not in this lobby',
      );
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

  leave(sessionId: string): LobbyMutationResult {
    const participant = this.participants.get(sessionId);
    if (!participant) {
      return reject(
        'participant-not-found',
        'Participant is not in this lobby',
      );
    }

    if (participant.slotId) {
      const occupiedBy = this.slotAssignments.get(participant.slotId);
      if (occupiedBy === sessionId) {
        this.slotAssignments.set(participant.slotId, null);
      }
    }

    this.participants.delete(sessionId);
    this.joinOrder = this.joinOrder.filter(
      (candidate) => candidate !== sessionId,
    );

    if (this.hostSessionId === sessionId) {
      this.hostSessionId = this.chooseNextHost();
    }

    return {
      ok: true,
      message: `${sessionId} left the lobby`,
    };
  }

  snapshot(): LobbySnapshot {
    const slots: Record<string, string | null> = {};
    for (const slotId of this.slotIdsInternal) {
      slots[slotId] = this.slotAssignments.get(slotId) ?? null;
    }

    const participants = this.joinOrder
      .map((sessionId) => this.participants.get(sessionId))
      .filter((participant): participant is LobbyParticipantState =>
        Boolean(participant),
      )
      .map((participant) => cloneParticipant(participant));

    return {
      roomId: this.roomId,
      hostSessionId: this.hostSessionId,
      slots,
      participants,
    };
  }

  private chooseNextHost(): string | null {
    for (const sessionId of this.joinOrder) {
      if (this.participants.has(sessionId)) {
        return sessionId;
      }
    }
    return null;
  }
}
