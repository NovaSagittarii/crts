import type {
  BuildOutcome,
  BuildRejectionReason,
  BuildQueuePayload,
  RoomStatePayload,
  StructureTemplateSummary,
} from './rts.js';
import type { RankedTeamOutcome } from './match-lifecycle.js';

// Shared Socket.IO payload contracts.
//
// Goal: keep server, web client, and integration tests aligned on the wire
// shapes without re-declaring ad-hoc interfaces in each runtime.

export type RoomStatus = 'lobby' | 'countdown' | 'active' | 'finished';
export type ConnectionStatus = 'connected' | 'held';

export interface BuildQueuedPayload {
  eventId: number;
  executeTick: number;
}

export type BuildOutcomeRejectionReason = BuildRejectionReason;

export interface BuildOutcomePayload extends BuildOutcome {
  roomId: string;
}

export interface RoomErrorPayload {
  message: string;
  reason?: string;
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
  playerId: string;
  playerName: string;
  teamId: number | null;
  templates: StructureTemplateSummary[];
  state: RoomStatePayload;
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

export interface RoomMembershipPayload {
  roomId: string;
  roomCode: string;
  roomName: string;
  revision: number;
  status: RoomStatus;
  hostSessionId: string | null;
  slots: Record<string, string | null>;
  participants: MembershipParticipant[];
  heldSlots: Record<
    string,
    {
      sessionId: string;
      holdExpiresAt: number;
      disconnectReason: string | null;
    } | null
  >;
  countdownSecondsRemaining: number | null;
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

export interface CellUpdatePayload {
  x: number;
  y: number;
  alive: boolean;
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
  'build:queue': (payload: BuildQueuePayload) => void;
  'cell:update': (payload: CellUpdatePayload) => void;
}

export interface ServerToClientEvents {
  state: (payload: RoomStatePayload) => void;
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
  'build:outcome': (payload: BuildOutcomePayload) => void;
  'player:profile': (payload: PlayerProfilePayload) => void;
}
