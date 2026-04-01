import type { RoomMembershipPayload } from '#rts-engine';

type MembershipParticipant = RoomMembershipPayload['participants'][number];
type HeldSlot = NonNullable<RoomMembershipPayload['heldSlots'][string]>;
type HeldSlotMember = RoomMembershipPayload['heldSlotMembers'][string][number];

export function createSlotDefinition(
  slotId: string,
  capacity: number,
): RoomMembershipPayload['slotDefinitions'][number] {
  return { slotId, capacity };
}

export function createMembershipParticipant(
  overrides: Partial<MembershipParticipant> = {},
): MembershipParticipant {
  return {
    sessionId: 'player-1',
    displayName: 'Player',
    role: 'spectator',
    slotId: null,
    ready: false,
    connectionStatus: 'connected',
    holdExpiresAt: null,
    disconnectReason: null,
    isBot: false,
    ...overrides,
  };
}

export function createHeldSlot(overrides: Partial<HeldSlot> = {}): HeldSlot {
  return {
    sessionId: 'player-1',
    holdExpiresAt: 0,
    disconnectReason: null,
    ...overrides,
  };
}

export function createHeldSlotMember(
  overrides: Partial<HeldSlotMember> = {},
): HeldSlotMember {
  return {
    sessionId: 'player-1',
    holdExpiresAt: 0,
    disconnectReason: null,
    ...overrides,
  };
}

export function createMembershipPayload(
  overrides: Partial<RoomMembershipPayload> = {},
): RoomMembershipPayload {
  return {
    roomId: 'room-1',
    roomCode: 'ROOM1',
    roomName: 'Test Room',
    revision: 1,
    status: 'lobby',
    hostSessionId: 'host-1',
    slotDefinitions: [],
    slots: {},
    slotMembers: {},
    participants: [],
    heldSlots: {},
    heldSlotMembers: {},
    countdownSecondsRemaining: null,
    hashAlgorithm: 'fnv1a-32',
    membershipHash: 'membership-1',
    ...overrides,
  };
}
