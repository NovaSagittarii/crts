/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// The above disables are required because this test imports from apps/web/src/
// which is outside tsconfig.json's include boundary. The types are correct at
// runtime (vitest resolves them via its own alias config) but eslint's
// typescript-eslint parser cannot resolve the cross-project types.
import { describe, expect, it } from 'vitest';

import {
  type BuildQueuedPayload,
  type DestroyQueuedPayload,
  type PlacementTransformState,
  type RoomDeterminismCheckpoint,
  RtsRoom,
  createDefaultStructureTemplates,
} from '#rts-engine';

import { ClientSimulation } from '../../apps/web/src/client-simulation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createIdentityTransform(): PlacementTransformState {
  return {
    operations: [],
    matrix: { xx: 1, xy: 0, yx: 0, yy: 1 },
  };
}

function createRoom(): RtsRoom {
  return RtsRoom.create({
    id: 'room-1',
    name: 'Test Room',
    width: 80,
    height: 80,
  });
}

function createRoomWithPlayers(): {
  room: RtsRoom;
  templates: StructureTemplate[];
  player1TeamId: number;
} {
  const room = createRoom();
  const team = room.addPlayer('player-1', 'Player 1');
  room.addPlayer('player-2', 'Player 2');
  return {
    room,
    templates: createDefaultStructureTemplates(),
    player1TeamId: team.id,
  };
}

function payloadFromRoom(room: RtsRoom): RoomStatePayload {
  return room.createStatePayload();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClientSimulation', () => {
  describe('lifecycle', () => {
    it('starts in idle status with no active room', () => {
      const sim = new ClientSimulation();

      expect(sim.status).toBe('idle');
      expect(sim.isActive).toBe(false);
      expect(sim.currentTick).toBe(0);
      expect(sim.currentState).toBeNull();
    });

    it('initialize() creates local RtsRoom from RoomStatePayload and sets currentTick', () => {
      const { room, templates } = createRoomWithPlayers();

      // Tick a few times to get to non-zero tick
      room.tick();
      room.tick();
      room.tick();

      const payload = payloadFromRoom(room);
      const sim = new ClientSimulation();

      sim.initialize(payload, templates);

      expect(sim.status).toBe('initialized');
      expect(sim.isActive).toBe(true);
      expect(sim.currentTick).toBe(payload.tick);
      expect(sim.currentState).not.toBeNull();
      expect(sim.currentState!.tick).toBe(payload.tick);
    });

    it('isActive returns false in idle state and true after initialize', () => {
      const sim = new ClientSimulation();
      expect(sim.isActive).toBe(false);

      const { room, templates } = createRoomWithPlayers();
      const payload = payloadFromRoom(room);

      sim.initialize(payload, templates);
      expect(sim.isActive).toBe(true);
    });

    it('currentState returns null in idle and RoomState after initialize', () => {
      const sim = new ClientSimulation();
      expect(sim.currentState).toBeNull();

      const { room, templates } = createRoomWithPlayers();
      const payload = payloadFromRoom(room);

      sim.initialize(payload, templates);
      expect(sim.currentState).not.toBeNull();
      expect(sim.currentState!.generation).toBe(payload.generation);
    });

    it('destroy() resets state to idle, rtsRoom becomes null', () => {
      const { room, templates } = createRoomWithPlayers();
      const payload = payloadFromRoom(room);
      const sim = new ClientSimulation();

      sim.initialize(payload, templates);
      expect(sim.isActive).toBe(true);

      sim.destroy();

      expect(sim.status).toBe('idle');
      expect(sim.isActive).toBe(false);
      expect(sim.currentTick).toBe(0);
      expect(sim.currentState).toBeNull();
    });
  });

  describe('tick advance', () => {
    it('advanceToTick(N) ticks the local sim from currentTick to N', () => {
      const { room, templates } = createRoomWithPlayers();
      const payload = payloadFromRoom(room);
      const sim = new ClientSimulation();

      sim.initialize(payload, templates);
      const startTick = sim.currentTick;

      sim.advanceToTick(startTick + 5);

      expect(sim.currentTick).toBe(startTick + 5);
      expect(sim.status).toBe('running');
    });

    it('advanceToTick(N) where N <= currentTick does nothing', () => {
      const { room, templates } = createRoomWithPlayers();
      room.tick();
      room.tick();
      const payload = payloadFromRoom(room);
      const sim = new ClientSimulation();

      sim.initialize(payload, templates);
      const tickBefore = sim.currentTick;

      sim.advanceToTick(tickBefore - 1);
      expect(sim.currentTick).toBe(tickBefore);

      sim.advanceToTick(tickBefore);
      expect(sim.currentTick).toBe(tickBefore);
    });

    it('tick cadence derives from server checkpoint tick, not wall clock', () => {
      const { room, templates } = createRoomWithPlayers();
      const payload = payloadFromRoom(room);
      const sim = new ClientSimulation();

      sim.initialize(payload, templates);

      // Advance in specific increments simulating server checkpoint ticks
      sim.advanceToTick(4);
      expect(sim.currentTick).toBe(4);

      sim.advanceToTick(8);
      expect(sim.currentTick).toBe(8);

      // Skipping backwards does nothing
      sim.advanceToTick(6);
      expect(sim.currentTick).toBe(8);
    });

    it('transitions from initialized to running on first tick advance', () => {
      const { room, templates } = createRoomWithPlayers();
      const payload = payloadFromRoom(room);
      const sim = new ClientSimulation();

      sim.initialize(payload, templates);
      expect(sim.status).toBe('initialized');

      sim.advanceToTick(payload.tick + 1);
      expect(sim.status).toBe('running');
    });

    it('advanceToTick on idle (no room) is a safe no-op', () => {
      const sim = new ClientSimulation();
      sim.advanceToTick(10);
      expect(sim.currentTick).toBe(0);
    });
  });

  describe('input replay', () => {
    it('applyQueuedBuild() inserts a BuildEvent into the team pendingBuildEvents', () => {
      const { room, templates, player1TeamId } = createRoomWithPlayers();
      const payload = payloadFromRoom(room);
      const sim = new ClientSimulation();

      sim.initialize(payload, templates);

      const buildPayload: BuildQueuedPayload = {
        roomId: 'room-1',
        intentId: 'intent-1',
        playerId: 'player-1',
        teamId: player1TeamId,
        bufferedTurn: 0,
        scheduledByTurn: 0,
        templateId: 'block',
        x: 10,
        y: 10,
        transform: createIdentityTransform(),
        delayTicks: 4,
        eventId: 1,
        executeTick: payload.tick + 4,
        sequence: 0,
      };

      sim.applyQueuedBuild(buildPayload);

      const state = sim.currentState!;
      const team = state.teams.get(player1TeamId)!;
      const pending = team.pendingBuildEvents;

      expect(pending.length).toBeGreaterThanOrEqual(1);
      const inserted = pending.find((e) => e.id === 1);
      expect(inserted).toBeDefined();
      expect(inserted!.templateId).toBe('block');
      expect(inserted!.x).toBe(10);
      expect(inserted!.y).toBe(10);
      expect(inserted!.executeTick).toBe(payload.tick + 4);
    });

    it('applyQueuedDestroy() inserts a DestroyEvent into the team pendingDestroyEvents', () => {
      const { room, templates, player1TeamId } = createRoomWithPlayers();
      const payload = payloadFromRoom(room);
      const sim = new ClientSimulation();

      sim.initialize(payload, templates);

      const destroyPayload: DestroyQueuedPayload = {
        roomId: 'room-1',
        intentId: 'intent-2',
        playerId: 'player-1',
        teamId: player1TeamId,
        bufferedTurn: 0,
        scheduledByTurn: 0,
        delayTicks: 4,
        structureKey: 'team-1-core',
        eventId: 2,
        executeTick: payload.tick + 4,
        idempotent: false,
        sequence: 0,
      };

      sim.applyQueuedDestroy(destroyPayload);

      const state = sim.currentState!;
      const team = state.teams.get(player1TeamId)!;
      const pending = team.pendingDestroyEvents;

      expect(pending.length).toBeGreaterThanOrEqual(1);
      const inserted = pending.find((e) => e.id === 2);
      expect(inserted).toBeDefined();
      expect(inserted!.structureKey).toBe('team-1-core');
      expect(inserted!.executeTick).toBe(payload.tick + 4);
    });

    it('applyQueuedBuild on idle (no room) is a safe no-op', () => {
      const sim = new ClientSimulation();
      // Should not throw
      sim.applyQueuedBuild({
        roomId: 'room-1',
        intentId: 'i',
        playerId: 'p',
        teamId: 1,
        bufferedTurn: 0,
        scheduledByTurn: 0,
        templateId: 'block',
        x: 0,
        y: 0,
        transform: createIdentityTransform(),
        delayTicks: 4,
        eventId: 99,
        executeTick: 10,
        sequence: 0,
      });
      expect(sim.currentState).toBeNull();
    });

    it('applyQueuedDestroy with idempotent=true skips duplicate events', () => {
      const { room, templates, player1TeamId } = createRoomWithPlayers();
      const payload = payloadFromRoom(room);
      const sim = new ClientSimulation();

      sim.initialize(payload, templates);

      const destroyPayload: DestroyQueuedPayload = {
        roomId: 'room-1',
        intentId: 'intent-3',
        playerId: 'player-1',
        teamId: player1TeamId,
        bufferedTurn: 0,
        scheduledByTurn: 0,
        delayTicks: 4,
        structureKey: 'team-1-core',
        eventId: 5,
        executeTick: payload.tick + 4,
        idempotent: true,
        sequence: 0,
      };

      sim.applyQueuedDestroy(destroyPayload);
      sim.applyQueuedDestroy(destroyPayload); // duplicate

      const state = sim.currentState!;
      const team = state.teams.get(player1TeamId)!;
      const count = team.pendingDestroyEvents.filter((e) => e.id === 5).length;
      expect(count).toBe(1);
    });
  });

  describe('checkpoint verification', () => {
    it('verifyCheckpoint returns true when local hash matches server checkpoint', () => {
      const { room, templates } = createRoomWithPlayers();
      room.tick();
      room.tick();
      room.tick();

      const serverCheckpoint = room.createDeterminismCheckpoint();
      const payload = payloadFromRoom(room);

      const sim = new ClientSimulation();
      sim.initialize(payload, templates);

      // No ticks advanced; client is at the same state as the server
      const result = sim.verifyCheckpoint(serverCheckpoint);
      expect(result).toBe(true);
    });

    it('verifyCheckpoint returns false when hashes differ (simulated desync)', () => {
      const { room, templates } = createRoomWithPlayers();
      room.tick();
      room.tick();

      const payload = payloadFromRoom(room);
      const sim = new ClientSimulation();
      sim.initialize(payload, templates);

      // Create a fake checkpoint with a wrong hash
      const fakeCheckpoint: RoomDeterminismCheckpoint = {
        tick: payload.tick,
        generation: payload.generation,
        hashAlgorithm: 'fnv1a-32',
        hashHex: 'deadbeef',
      };

      const result = sim.verifyCheckpoint(fakeCheckpoint);
      expect(result).toBe(false);
    });

    it('after initialize + applyQueuedBuild + advanceToTick past executeTick, hash matches server', () => {
      const { room, templates } = createRoomWithPlayers();

      // Queue a build on the server
      const buildResult = room.queueBuildEvent('player-1', {
        templateId: 'block',
        x: 20,
        y: 20,
      });

      // Take a state snapshot at this point (before advancing)
      const payload = payloadFromRoom(room);

      // Now advance the server past the executeTick
      const targetTick = (buildResult.executeTick ?? 0) + 1;
      while (room.state.tick < targetTick) {
        room.tick();
      }

      const serverCheckpoint = room.createDeterminismCheckpoint();

      // Client: initialize from the snapshot, replay the build, advance
      const sim = new ClientSimulation();
      sim.initialize(payload, templates);

      // The build is already in the payload's pendingBuildEvents because
      // we took the snapshot after queueing. But verify hashes match
      // after advancing to the same tick.
      sim.advanceToTick(targetTick);

      const result = sim.verifyCheckpoint(serverCheckpoint);
      expect(result).toBe(true);
    });

    it('createLocalCheckpoint returns null when idle', () => {
      const sim = new ClientSimulation();
      expect(sim.createLocalCheckpoint()).toBeNull();
    });

    it('createLocalCheckpoint returns valid checkpoint when active', () => {
      const { room, templates } = createRoomWithPlayers();
      const payload = payloadFromRoom(room);
      const sim = new ClientSimulation();
      sim.initialize(payload, templates);

      const checkpoint = sim.createLocalCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.tick).toBe(payload.tick);
      expect(checkpoint!.hashHex).toBeDefined();
      expect(checkpoint!.hashAlgorithm).toBe('fnv1a-32');
    });

    it('verifyCheckpoint returns false when idle (no room)', () => {
      const sim = new ClientSimulation();
      const result = sim.verifyCheckpoint({
        tick: 0,
        generation: 0,
        hashAlgorithm: 'fnv1a-32',
        hashHex: 'abc',
      });
      expect(result).toBe(false);
    });
  });

  describe('resync', () => {
    it('resync() resets simulation to new payload state', () => {
      const { room, templates } = createRoomWithPlayers();

      // Tick server to non-zero state
      for (let i = 0; i < 5; i++) room.tick();
      const firstPayload = payloadFromRoom(room);

      const sim = new ClientSimulation();
      sim.initialize(firstPayload, templates);
      expect(sim.currentTick).toBe(firstPayload.tick);

      // Tick server 5 more times to create a different state
      for (let i = 0; i < 5; i++) room.tick();
      const secondPayload = payloadFromRoom(room);

      sim.resync(secondPayload, templates);

      expect(sim.currentTick).toBe(secondPayload.tick);
      expect(sim.status).toBe('initialized');
      expect(sim.currentState).not.toBeNull();
      expect(sim.currentState!.tick).toBe(secondPayload.tick);
    });

    it('resync() on idle sim initializes without error', () => {
      const sim = new ClientSimulation();
      expect(sim.status).toBe('idle');

      const { room, templates } = createRoomWithPlayers();
      const payload = payloadFromRoom(room);

      sim.resync(payload, templates);

      expect(sim.isActive).toBe(true);
      expect(sim.currentTick).toBe(payload.tick);
    });

    it('after resync, advanceToTick works from new baseline', () => {
      const { room, templates } = createRoomWithPlayers();

      // Tick 3 times, initialize sim
      for (let i = 0; i < 3; i++) room.tick();
      const firstPayload = payloadFromRoom(room);
      const sim = new ClientSimulation();
      sim.initialize(firstPayload, templates);

      // Tick server 5 more, take second payload
      for (let i = 0; i < 5; i++) room.tick();
      const secondPayload = payloadFromRoom(room);

      sim.resync(secondPayload, templates);

      // Advance from the new baseline
      sim.advanceToTick(secondPayload.tick + 3);

      expect(sim.currentTick).toBe(secondPayload.tick + 3);
      expect(sim.status).toBe('running');
    });

    it('after resync, verifyCheckpoint matches new state hash', () => {
      const { room, templates } = createRoomWithPlayers();

      // Tick 3 times, initialize sim
      for (let i = 0; i < 3; i++) room.tick();
      const firstPayload = payloadFromRoom(room);
      const sim = new ClientSimulation();
      sim.initialize(firstPayload, templates);

      // Tick server 5 more times
      for (let i = 0; i < 5; i++) room.tick();
      const secondPayload = payloadFromRoom(room);
      const serverCheckpoint = room.createDeterminismCheckpoint();

      sim.resync(secondPayload, templates);

      expect(sim.verifyCheckpoint(serverCheckpoint)).toBe(true);
    });
  });
});
