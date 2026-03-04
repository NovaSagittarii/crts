import { Server as SocketIOServer, Socket } from 'socket.io';

import { LobbySessionCoordinator } from './lobby-session.js';

import {
  type BuildOutcomePayload,
  type ClientToServerEvents,
  type DestroyOutcomePayload,
  type LobbyRoom,
  type MatchFinishedPayload,
  type RoomListEntryPayload,
  type RoomMembershipPayload,
  type RtsRoom,
  type RoomStatus,
  type ServerToClientEvents,
} from '#rts-engine';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface RuntimeBroadcastRoom {
  rtsRoom: RtsRoom;
  lobby: LobbyRoom;
  roomCode: string;
  revision: number;
  status: RoomStatus;
  countdownSecondsRemaining: number | null;
  matchOutcome: MatchFinishedPayload | null;
}

interface RoomBroadcastServiceOptions {
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  sessionCoordinator: LobbySessionCoordinator;
  roomChannel: (roomId: string) => string;
  listRooms: () => Iterable<RuntimeBroadcastRoom>;
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

  public buildMembershipPayload(
    room: RuntimeBroadcastRoom,
  ): RoomMembershipPayload {
    const roomId = room.rtsRoom.id;
    const snapshot = room.lobby.snapshot();
    const slotIds = room.lobby.slotIds();
    const heldSlots: RoomMembershipPayload['heldSlots'] = {};

    for (const slotId of slotIds) {
      const sessionId = snapshot.slots[slotId];
      if (!sessionId) {
        heldSlots[slotId] = null;
        continue;
      }

      const hold = this.sessionCoordinator.getHold(sessionId);
      if (hold && hold.roomId === roomId && hold.slotId === slotId) {
        heldSlots[slotId] = {
          sessionId,
          holdExpiresAt: hold.expiresAt,
          disconnectReason: hold.disconnectReason,
        };
        continue;
      }

      heldSlots[slotId] = null;
    }

    return {
      roomId,
      roomCode: room.roomCode,
      roomName: room.rtsRoom.name,
      revision: room.revision,
      status: room.status,
      hostSessionId: snapshot.hostSessionId,
      slots: snapshot.slots,
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
      countdownSecondsRemaining: room.countdownSecondsRemaining,
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

  public emitBuildOutcomes(
    room: RuntimeBroadcastRoom,
    outcomes: BuildOutcomePayload[],
  ): void {
    const roomIo = this.io.to(this.roomChannel(room.rtsRoom.id));
    for (const outcome of outcomes) {
      roomIo.emit('build:outcome', outcome);
    }
  }

  public emitDestroyOutcomes(
    room: RuntimeBroadcastRoom,
    outcomes: DestroyOutcomePayload[],
  ): void {
    const roomIo = this.io.to(this.roomChannel(room.rtsRoom.id));
    for (const outcome of outcomes) {
      roomIo.emit('destroy:outcome', outcome);
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
}
