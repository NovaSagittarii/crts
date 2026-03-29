import type { RankedTeamOutcome } from './match-lifecycle.js';
import type { PlacementTransformState } from './placement-transform.js';
import type {
  BuildOutcome,
  BuildQueuePayload,
  DestroyOutcome,
  DestroyQueuePayload,
  RoomDeterminismCheckpoint,
  RoomGridStatePayload,
  RoomStateHashes,
  RoomStatePayload,
  RoomStructuresStatePayload,
} from './rts.js';
import type { StructureTemplatePayload } from './structure.js';

// Shared Socket.IO payload contracts.
//
// Goal: keep server, web client, and integration tests aligned on the wire
// shapes without re-declaring ad-hoc interfaces in each runtime.

export type RoomStatus = 'lobby' | 'countdown' | 'active' | 'finished';
export type ConnectionStatus = 'connected' | 'held';
export type LockstepMode = 'off' | 'shadow' | 'primary';
export type LockstepStatus = 'running' | 'fallback';
export type LockstepFallbackReason =
  | 'hash-mismatch'
  | 'shadow-unavailable'
  | 'turn-buffer-overflow'
  | 'manual';

export interface LockstepStatusPayload {
  mode: LockstepMode;
  status: LockstepStatus;
  turnLengthTicks: number;
  nextTurn: number;
  bufferedTurnCount: number;
  mismatchCount: number;
  lastFallbackReason?: LockstepFallbackReason;
  lastPrimaryHash?: string;
  lastShadowHash?: string;
}

export interface LockstepCheckpointPayload extends RoomDeterminismCheckpoint {
  roomId: string;
  mode: LockstepMode;
  turn: number;
}

export interface LockstepFallbackPayload {
  roomId: string;
  fromMode: Exclude<LockstepMode, 'off'>;
  reason: LockstepFallbackReason;
  checkpoint?: RoomDeterminismCheckpoint;
  mismatchCount?: number;
}

export type StateRequestSection = 'full' | 'grid' | 'structures' | 'membership';

export interface StateRequestPayload {
  sections?: StateRequestSection[];
}

export interface RoomStateHashesPayload extends RoomStateHashes {
  roomId: string;
  roomMembershipHash: string;
}

export interface BuildQueuedPayload {
  roomId: string;
  intentId: string;
  playerId: string;
  teamId: number;
  bufferedTurn: number;
  scheduledByTurn: number;
  templateId: string;
  x: number;
  y: number;
  transform: PlacementTransformState;
  delayTicks: number;
  eventId: number;
  executeTick: number;
  sequence: number;
}

export interface DestroyQueuedPayload {
  roomId: string;
  intentId: string;
  playerId: string;
  teamId: number;
  bufferedTurn: number;
  scheduledByTurn: number;
  delayTicks: number;
  structureKey: string;
  eventId: number;
  executeTick: number;
  idempotent: boolean;
  sequence: number;
}

export type BuildQueueRejectedReason = string;

export interface BuildQueueRejectedPayload {
  roomId: string;
  intentId: string;
  playerId: string;
  teamId: number;
  reason: BuildQueueRejectedReason;
  needed?: number;
  current?: number;
  deficit?: number;
}

export type DestroyQueueRejectedReason = string;

export interface DestroyQueueRejectedPayload {
  roomId: string;
  intentId: string;
  playerId: string;
  teamId: number;
  structureKey: string;
  reason: DestroyQueueRejectedReason;
}

export interface BuildOutcomePayload extends BuildOutcome {
  roomId: string;
}

export interface DestroyOutcomePayload extends DestroyOutcome {
  roomId: string;
}

export interface RoomErrorPayload {
  roomId: string | null;
  message: string;
  reason?: string;
  needed?: number;
  current?: number;
  deficit?: number;
}

export interface RoomListEntryPayload {
  roomId: string;
  roomCode: string;
  name: string;
  width: number;
  height: number;
  players: number;
  spectators: number;
  teams: number;
  status: RoomStatus;
}

export interface RoomJoinedPayload {
  roomId: string;
  roomCode: string;
  roomName: string;
  tickMs: number;
  playerId: string;
  playerName: string;
  teamId: number | null;
  templates: StructureTemplatePayload[];
  state: RoomStatePayload;
  stateHashes: RoomStateHashesPayload;
  lockstep?: LockstepStatusPayload;
}

export interface RoomLeftPayload {
  roomId: string | null;
}

export interface RoomSlotClaimedPayload {
  roomId: string;
  slotId: string;
  teamId: number | null;
}

export interface RoomCountdownPayload {
  roomId: string;
  secondsRemaining: number;
}

export interface MatchStartedPayload {
  roomId: string;
}

export interface MatchFinishedPayload {
  roomId: string;
  winner: RankedTeamOutcome;
  ranked: RankedTeamOutcome[];
  comparator: string;
}

export interface ChatMessagePayload {
  roomId: string;
  senderSessionId: string;
  senderName: string;
  message: string;
  timestamp: number;
}

export interface MembershipParticipant {
  sessionId: string;
  displayName: string;
  role: 'player' | 'spectator';
  slotId: string | null;
  ready: boolean;
  connectionStatus: ConnectionStatus;
  holdExpiresAt: number | null;
  disconnectReason: string | null;
}

export interface RoomSlotDefinitionPayload {
  slotId: string;
  capacity: number;
}

export interface HeldSlotMemberPayload {
  sessionId: string;
  holdExpiresAt: number;
  disconnectReason: string | null;
}

export interface RoomMembershipPayload {
  roomId: string;
  roomCode: string;
  roomName: string;
  revision: number;
  status: RoomStatus;
  hostSessionId: string | null;
  slotDefinitions: RoomSlotDefinitionPayload[];
  slots: Record<string, string | null>;
  slotMembers: Record<string, string[]>;
  participants: MembershipParticipant[];
  heldSlots: Record<string, HeldSlotMemberPayload | null>;
  heldSlotMembers: Record<string, HeldSlotMemberPayload[]>;
  countdownSecondsRemaining: number | null;
  hashAlgorithm: RoomStateHashes['hashAlgorithm'];
  membershipHash: string;
  lockstep?: LockstepStatusPayload;
}

export interface PlayerProfilePayload {
  playerId: string;
  name: string;
}

export interface PlayerSetNamePayload {
  name: string;
}

export interface RoomCreatePayload {
  name?: string;
  width?: number;
  height?: number;
  slots?: RoomSlotDefinitionPayload[];
}

export interface RoomJoinPayload {
  roomId?: string | number;
  roomCode?: string | number;
  slotId?: string;
}

export interface RoomClaimSlotPayload {
  slotId: string;
}

export interface RoomSetReadyPayload {
  ready: boolean;
}

export interface RoomStartPayload {
  force?: boolean;
}

export interface ChatSendPayload {
  message: string;
}

export interface ClientToServerEvents {
  'player:set-name': (payload: PlayerSetNamePayload) => void;
  'room:list': () => void;
  'room:create': (payload: RoomCreatePayload) => void;
  'room:join': (payload: RoomJoinPayload) => void;
  'room:leave': () => void;
  'room:claim-slot': (payload: RoomClaimSlotPayload) => void;
  'room:set-ready': (payload: RoomSetReadyPayload) => void;
  'room:start': (payload?: RoomStartPayload) => void;
  'room:cancel-countdown': () => void;
  'chat:send': (payload: ChatSendPayload) => void;
  'state:request': (payload?: StateRequestPayload) => void;
  'build:queue': (payload: BuildQueuePayload) => void;
  'destroy:queue': (payload: DestroyQueuePayload) => void;
}

export interface ServerToClientEvents {
  state: (payload: RoomStatePayload) => void;
  'state:grid': (payload: RoomGridStatePayload) => void;
  'state:structures': (payload: RoomStructuresStatePayload) => void;
  'state:hashes': (payload: RoomStateHashesPayload) => void;
  'room:list': (payload: RoomListEntryPayload[]) => void;
  'room:joined': (payload: RoomJoinedPayload) => void;
  'room:left': (payload: RoomLeftPayload) => void;
  'room:membership': (payload: RoomMembershipPayload) => void;
  'room:slot-claimed': (payload: RoomSlotClaimedPayload) => void;
  'room:countdown': (payload: RoomCountdownPayload) => void;
  'room:match-started': (payload: MatchStartedPayload) => void;
  'room:match-finished': (payload: MatchFinishedPayload) => void;
  'room:error': (payload: RoomErrorPayload) => void;
  'chat:message': (payload: ChatMessagePayload) => void;
  'build:queued': (payload: BuildQueuedPayload) => void;
  'build:queue-rejected': (payload: BuildQueueRejectedPayload) => void;
  'build:outcome': (payload: BuildOutcomePayload) => void;
  'destroy:queued': (payload: DestroyQueuedPayload) => void;
  'destroy:queue-rejected': (payload: DestroyQueueRejectedPayload) => void;
  'destroy:outcome': (payload: DestroyOutcomePayload) => void;
  'lockstep:checkpoint': (payload: LockstepCheckpointPayload) => void;
  'lockstep:fallback': (payload: LockstepFallbackPayload) => void;
  'player:profile': (payload: PlayerProfilePayload) => void;
}
