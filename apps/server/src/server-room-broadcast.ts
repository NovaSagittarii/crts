import { Socket, Server as SocketIOServer } from 'socket.io';

import {
  type BuildOutcomePayload,
  type BuildQueueRejectedPayload,
  type BuildQueuedPayload,
  type ClientToServerEvents,
  type DestroyOutcomePayload,
  type DestroyQueueRejectedPayload,
  type DestroyQueuedPayload,
  type DeterminismHashAlgorithm,
  type LobbyRoom,
  type LockstepCheckpointPayload,
  type LockstepFallbackPayload,
  type LockstepStatusPayload,
  type MatchFinishedPayload,
  type RoomListEntryPayload,
  type RoomMembershipPayload,
  type RoomStateHashesPayload,
  type RoomStatus,
  type RtsRoom,
  type ServerToClientEvents,
} from '#rts-engine';

import { LobbySessionCoordinator } from './lobby-session.js';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface RuntimeBroadcastRoom {
  rtsRoom: RtsRoom;
  lobby: LobbyRoom;
  roomCode: string;
  revision: number;
  status: RoomStatus;
  countdownSecondsRemaining: number | null;
  matchOutcome: MatchFinishedPayload | null;
  lockstep: LockstepStatusPayload;
}

interface RoomBroadcastServiceOptions {
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  sessionCoordinator: LobbySessionCoordinator;
  roomChannel: (roomId: string) => string;
  listRooms: () => Iterable<RuntimeBroadcastRoom>;
}

export interface RoomMembershipHash {
  hashAlgorithm: DeterminismHashAlgorithm;
  hashHex: string;
}

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

function hashMembershipString(value: string): string {
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hash = Math.imul((hash ^ (code & 0xff)) >>> 0, FNV_PRIME) >>> 0;
    hash = Math.imul((hash ^ ((code >>> 8) & 0xff)) >>> 0, FNV_PRIME) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function compareKeys(left: string, right: string): number {
  return left.localeCompare(right);
}

export class RoomBroadcastService {
  private readonly io: SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents
  >;

  private readonly sessionCoordinator: LobbySessionCoordinator;

  private readonly roomChannel: (roomId: string) => string;

  private readonly listRooms: () => Iterable<RuntimeBroadcastRoom>;

  public constructor(options: RoomBroadcastServiceOptions) {
    this.io = options.io;
    this.sessionCoordinator = options.sessionCoordinator;
    this.roomChannel = options.roomChannel;
    this.listRooms = options.listRooms;
  }

  private buildMembershipPayloadBase(
    room: RuntimeBroadcastRoom,
  ): Omit<RoomMembershipPayload, 'hashAlgorithm' | 'membershipHash'> {
    const roomId = room.rtsRoom.id;
    const snapshot = room.lobby.snapshot();
    const slotIds = room.lobby.slotIds();
    const slotDefinitions: RoomMembershipPayload['slotDefinitions'] =
      slotIds.map((slotId) => ({
        slotId,
        capacity: room.lobby.slotCapacity(slotId),
      }));
    const heldSlots: RoomMembershipPayload['heldSlots'] = {};
    const heldSlotMembers: RoomMembershipPayload['heldSlotMembers'] = {};

    for (const slotId of slotIds) {
      const holds = this.sessionCoordinator
        .getHeldSessionsForSlot(roomId, slotId)
        .map((sessionId) => this.sessionCoordinator.getHold(sessionId))
        .filter(
          (
            hold,
          ): hold is NonNullable<
            ReturnType<LobbySessionCoordinator['getHold']>
          > => hold !== null,
        )
        .map((hold) => ({
          sessionId: hold.sessionId,
          holdExpiresAt: hold.expiresAt,
          disconnectReason: hold.disconnectReason,
        }));

      heldSlots[slotId] = holds[0] ?? null;
      heldSlotMembers[slotId] = holds;
    }

    return {
      roomId,
      roomCode: room.roomCode,
      roomName: room.rtsRoom.name,
      revision: room.revision,
      status: room.status,
      hostSessionId: snapshot.hostSessionId,
      slotDefinitions,
      slots: snapshot.slots,
      slotMembers: snapshot.slotMembers,
      participants: snapshot.participants.map((participant) => {
        const participantSession = this.sessionCoordinator.getSession(
          participant.sessionId,
        );
        const hold = this.sessionCoordinator.getHold(participant.sessionId);
        const disconnected =
          participantSession !== null && !participantSession.connected;

        return {
          sessionId: participant.sessionId,
          displayName: participant.displayName,
          role: participant.role,
          slotId: participant.slotId,
          ready: participant.ready,
          connectionStatus: disconnected ? 'held' : 'connected',
          holdExpiresAt: disconnected ? (hold?.expiresAt ?? null) : null,
          disconnectReason: disconnected
            ? (participantSession?.disconnectReason ??
              hold?.disconnectReason ??
              null)
            : null,
        };
      }),
      heldSlots,
      heldSlotMembers,
      countdownSecondsRemaining: room.countdownSecondsRemaining,
      lockstep: room.lockstep,
    };
  }

  private buildMembershipHashFromPayload(
    payload: Omit<RoomMembershipPayload, 'hashAlgorithm' | 'membershipHash'>,
  ): RoomMembershipHash {
    const normalized = {
      roomId: payload.roomId,
      roomCode: payload.roomCode,
      roomName: payload.roomName,
      status: payload.status,
      hostSessionId: payload.hostSessionId,
      slotDefinitions: [...payload.slotDefinitions].sort((left, right) =>
        compareKeys(left.slotId, right.slotId),
      ),
      slots: Object.fromEntries(
        Object.entries(payload.slots).sort(([left], [right]) =>
          compareKeys(left, right),
        ),
      ),
      slotMembers: Object.fromEntries(
        Object.entries(payload.slotMembers)
          .sort(([left], [right]) => compareKeys(left, right))
          .map(([slotId, sessionIds]) => [slotId, [...sessionIds]]),
      ),
      participants: [...payload.participants]
        .sort((left, right) => compareKeys(left.sessionId, right.sessionId))
        .map((participant) => ({
          sessionId: participant.sessionId,
          displayName: participant.displayName,
          role: participant.role,
          slotId: participant.slotId,
          ready: participant.ready,
          connectionStatus: participant.connectionStatus,
          holdExpiresAt: participant.holdExpiresAt,
          disconnectReason: participant.disconnectReason,
        })),
      heldSlots: Object.fromEntries(
        Object.entries(payload.heldSlots).sort(([left], [right]) =>
          compareKeys(left, right),
        ),
      ),
      heldSlotMembers: Object.fromEntries(
        Object.entries(payload.heldSlotMembers)
          .sort(([left], [right]) => compareKeys(left, right))
          .map(([slotId, holds]) => [
            slotId,
            [...holds].sort((left, right) =>
              compareKeys(left.sessionId, right.sessionId),
            ),
          ]),
      ),
      countdownSecondsRemaining: payload.countdownSecondsRemaining,
      lockstep: payload.lockstep
        ? {
            mode: payload.lockstep.mode,
            status: payload.lockstep.status,
            turnLengthTicks: payload.lockstep.turnLengthTicks,
            nextTurn: payload.lockstep.nextTurn,
            bufferedTurnCount: payload.lockstep.bufferedTurnCount,
            mismatchCount: payload.lockstep.mismatchCount,
            lastFallbackReason: payload.lockstep.lastFallbackReason ?? null,
            lastPrimaryHash: payload.lockstep.lastPrimaryHash ?? null,
            lastShadowHash: payload.lockstep.lastShadowHash ?? null,
          }
        : null,
    };

    return {
      hashAlgorithm: 'fnv1a-32',
      hashHex: hashMembershipString(JSON.stringify(normalized)),
    };
  }

  public buildMembershipPayload(
    room: RuntimeBroadcastRoom,
  ): RoomMembershipPayload {
    const payload = this.buildMembershipPayloadBase(room);
    const membershipHash = this.buildMembershipHashFromPayload(payload);

    return {
      ...payload,
      hashAlgorithm: membershipHash.hashAlgorithm,
      membershipHash: membershipHash.hashHex,
    };
  }

  public buildMembershipHash(room: RuntimeBroadcastRoom): RoomMembershipHash {
    return this.buildMembershipHashFromPayload(
      this.buildMembershipPayloadBase(room),
    );
  }

  public buildStateHashesPayload(
    room: RuntimeBroadcastRoom,
  ): RoomStateHashesPayload {
    const stateHashes = room.rtsRoom.createStateHashes();
    const membershipHash = this.buildMembershipHash(room);

    return {
      roomId: room.rtsRoom.id,
      ...stateHashes,
      roomMembershipHash: membershipHash.hashHex,
    };
  }

  public emitRoomList(target?: GameSocket): void {
    const payload = [...this.listRooms()]
      .map((room): RoomListEntryPayload => {
        const snapshot = room.lobby.snapshot();
        const players = snapshot.participants.filter(
          ({ role }) => role === 'player',
        ).length;

        return {
          roomId: room.rtsRoom.id,
          roomCode: room.roomCode,
          name: room.rtsRoom.name,
          width: room.rtsRoom.width,
          height: room.rtsRoom.height,
          players,
          spectators: snapshot.participants.length - players,
          teams: room.rtsRoom.state.teams.size,
          status: room.status,
        };
      })
      .sort((a, b) =>
        a.roomId.localeCompare(b.roomId, undefined, { numeric: true }),
      );

    if (target) {
      target.emit('room:list', payload);
      return;
    }

    this.io.emit('room:list', payload);
  }

  public emitRoomState(room: RuntimeBroadcastRoom): void {
    this.io
      .to(this.roomChannel(room.rtsRoom.id))
      .emit('state', room.rtsRoom.createStatePayload());
  }

  public emitStateHashes(
    room: RuntimeBroadcastRoom,
    target?: GameSocket,
  ): void {
    const payload = this.buildStateHashesPayload(room);

    if (target) {
      target.emit('state:hashes', payload);
      return;
    }

    this.io.to(this.roomChannel(room.rtsRoom.id)).emit('state:hashes', payload);
  }

  public emitBuildQueued(
    room: RuntimeBroadcastRoom,
    payload: BuildQueuedPayload,
  ): void {
    this.io.to(this.roomChannel(room.rtsRoom.id)).emit('build:queued', payload);
  }

  public emitBuildQueueRejected(
    room: RuntimeBroadcastRoom,
    payload: BuildQueueRejectedPayload,
  ): void {
    this.io
      .to(this.roomChannel(room.rtsRoom.id))
      .emit('build:queue-rejected', payload);
  }

  public emitDestroyQueued(
    room: RuntimeBroadcastRoom,
    payload: DestroyQueuedPayload,
  ): void {
    this.io
      .to(this.roomChannel(room.rtsRoom.id))
      .emit('destroy:queued', payload);
  }

  public emitDestroyQueueRejected(
    room: RuntimeBroadcastRoom,
    payload: DestroyQueueRejectedPayload,
  ): void {
    this.io
      .to(this.roomChannel(room.rtsRoom.id))
      .emit('destroy:queue-rejected', payload);
  }

  public emitBuildOutcomes(
    room: RuntimeBroadcastRoom,
    outcomes: BuildOutcomePayload[],
  ): void {
    this.emitOutcomes(room, outcomes, 'build:outcome');
  }

  public emitDestroyOutcomes(
    room: RuntimeBroadcastRoom,
    outcomes: DestroyOutcomePayload[],
  ): void {
    this.emitOutcomes(room, outcomes, 'destroy:outcome');
  }

  private emitOutcomes<T>(
    room: RuntimeBroadcastRoom,
    outcomes: T[],
    event: string,
  ): void {
    const roomIo = this.io.to(this.roomChannel(room.rtsRoom.id));
    for (const outcome of outcomes) {
      roomIo.emit(event, outcome);
    }
  }

  public emitMembership(room: RuntimeBroadcastRoom, bumpRevision = true): void {
    if (bumpRevision) {
      room.revision += 1;
    }

    this.io
      .to(this.roomChannel(room.rtsRoom.id))
      .emit('room:membership', this.buildMembershipPayload(room));
  }

  public emitMatchFinished(room: RuntimeBroadcastRoom): void {
    if (!room.matchOutcome) {
      return;
    }

    this.io.to(this.roomChannel(room.rtsRoom.id)).emit('room:match-finished', {
      roomId: room.rtsRoom.id,
      winner: room.matchOutcome.winner,
      ranked: room.matchOutcome.ranked,
      comparator: room.matchOutcome.comparator,
    });
  }

  public emitLockstepCheckpoint(
    room: RuntimeBroadcastRoom,
    payload: Omit<LockstepCheckpointPayload, 'roomId'>,
  ): void {
    this.io.to(this.roomChannel(room.rtsRoom.id)).emit('lockstep:checkpoint', {
      roomId: room.rtsRoom.id,
      ...payload,
    });
  }

  public emitLockstepFallback(
    room: RuntimeBroadcastRoom,
    payload: Omit<LockstepFallbackPayload, 'roomId'>,
  ): void {
    this.io.to(this.roomChannel(room.rtsRoom.id)).emit('lockstep:fallback', {
      roomId: room.rtsRoom.id,
      ...payload,
    });
  }
}
