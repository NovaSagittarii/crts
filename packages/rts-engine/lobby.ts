export type LobbySlotId = string;

export interface LobbySlotDefinition {
  id: LobbySlotId;
  capacity: number;
}

export interface LobbyParticipantAssignment {
  sessionId: string;
  displayName: string;
  role: 'player' | 'spectator';
  slotId: LobbySlotId | null;
  ready: boolean;
}

export interface LobbyParticipantState extends LobbyParticipantAssignment {
  joinOrder: number;
}

export interface CreateLobbyRoomOptions {
  roomId: string;
  slotIds?: LobbySlotId[];
  slots?: LobbySlotDefinition[];
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
  slotMembers: Record<string, string[]>;
  slotCapacities: Record<string, number>;
  participants: LobbyParticipantState[];
}

function normalizeSlotDefinitions(
  options: CreateLobbyRoomOptions,
): LobbySlotDefinition[] {
  const slots =
    options.slots ??
    options.slotIds?.map((slotId) => ({
      id: slotId,
      capacity: 1,
    })) ??
    [];

  if (slots.length === 0) {
    throw new Error('Lobby room must define at least one slot');
  }

  const dedupedSlots = new Set(slots.map(({ id }) => id));
  if (dedupedSlots.size !== slots.length) {
    throw new Error('Lobby room slot IDs must be unique');
  }

  for (const slot of slots) {
    if (!Number.isInteger(slot.capacity) || slot.capacity <= 0) {
      throw new Error(`Lobby room slot ${slot.id} must define capacity >= 1`);
    }
  }

  return slots.map((slot) => ({ ...slot }));
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
  private readonly slotDefinitions: Map<LobbySlotId, LobbySlotDefinition>;
  private hostSessionId: string | null;
  private readonly participants: Map<string, LobbyParticipantState>;
  private readonly slotAssignments: Map<LobbySlotId, string[]>;
  private joinOrder: string[];
  private nextJoinOrder: number;

  private constructor(options: CreateLobbyRoomOptions) {
    const slotDefinitions = normalizeSlotDefinitions(options);
    const slotAssignments = new Map<LobbySlotId, string[]>();
    for (const slot of slotDefinitions) {
      slotAssignments.set(slot.id, []);
    }

    this.roomId = options.roomId;
    this.slotIdsInternal = slotDefinitions.map(({ id }) => id);
    this.slotDefinitions = new Map(
      slotDefinitions.map((slot) => [slot.id, { ...slot }]),
    );
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

  slotCapacity(slotId: LobbySlotId): number {
    return this.slotDefinitions.get(slotId)?.capacity ?? 0;
  }

  slotMemberIds(slotId: LobbySlotId): string[] {
    return [...(this.slotAssignments.get(slotId) ?? [])];
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

    const currentOccupants = this.slotAssignments.get(slotId) ?? [];
    if (currentOccupants.length >= this.slotCapacity(slotId)) {
      return reject('slot-full', `Team slot ${slotId} is full`);
    }

    participant.role = 'player';
    participant.slotId = slotId;
    participant.ready = false;
    this.slotAssignments.set(slotId, [...currentOccupants, sessionId]);

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
      const remainingOccupants = (
        this.slotAssignments.get(participant.slotId) ?? []
      ).filter((occupantSessionId) => occupantSessionId !== sessionId);
      this.slotAssignments.set(participant.slotId, remainingOccupants);
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
    const slotMembers: Record<string, string[]> = {};
    const slotCapacities: Record<string, number> = {};
    for (const slotId of this.slotIdsInternal) {
      const members = this.slotAssignments.get(slotId) ?? [];
      slots[slotId] = members[0] ?? null;
      slotMembers[slotId] = [...members];
      slotCapacities[slotId] = this.slotCapacity(slotId);
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
      slotMembers,
      slotCapacities,
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
