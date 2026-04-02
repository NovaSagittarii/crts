// The above disables are required because this test imports from apps/web/src/
// which is outside tsconfig.json's include boundary.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { RtsRoom, createDefaultStructureTemplates } from '#rts-engine';

import { ClientSimulation } from '../../apps/web/src/client-simulation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SetupResult {
  room: RtsRoom;
  templates: ReturnType<typeof createDefaultStructureTemplates>;
  team1: { id: number; baseTopLeft: { x: number; y: number } };
  team2: { id: number; baseTopLeft: { x: number; y: number } };
}

function setupServerAndClient(width: number, height: number): SetupResult {
  const room = RtsRoom.create({
    id: 'prop-room',
    name: 'Property Test',
    width,
    height,
  });
  const t1 = room.addPlayer('player-1', 'Player 1');
  const t2 = room.addPlayer('player-2', 'Player 2');
  const templates = createDefaultStructureTemplates();
  return {
    room,
    templates,
    team1: { id: t1.id, baseTopLeft: t1.baseTopLeft },
    team2: { id: t2.id, baseTopLeft: t2.baseTopLeft },
  };
}

function initClientFromServer(
  room: RtsRoom,
  templates: ReturnType<typeof createDefaultStructureTemplates>,
): ClientSimulation {
  const payload = room.createStatePayload();
  const sim = new ClientSimulation();
  sim.initialize(payload, templates);
  return sim;
}

// ---------------------------------------------------------------------------
// Property-based determinism (QUAL-01)
//
// Strategy: Queue inputs on the server, then snapshot (so pending events are
// embedded in the payload). Initialize the client from that snapshot. Advance
// both by the same number of ticks and compare determinism checkpoint hashes.
// This proves: identical initial state + identical tick count = identical
// final state, across diverse random inputs.
// ---------------------------------------------------------------------------

describe('Property-based determinism (QUAL-01)', () => {
  it('identical inputs produce identical hashes after 500+ ticks (QUAL-01)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.array(
          fc.record({
            offsetX: fc.integer({ min: 4, max: 14 }),
            offsetY: fc.integer({ min: 4, max: 14 }),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        fc.integer({ min: 500, max: 600 }),
        (ticksBefore, buildPlacements, ticksAfter) => {
          // 1. Create server room with 2 players (52x52 for performance)
          const { room, templates, team1 } = setupServerAndClient(52, 52);

          // 2. Tick the server ticksBefore times
          for (let i = 0; i < ticksBefore; i++) {
            room.tick();
          }

          // 3. Queue builds on the server (skip rejected ones gracefully)
          for (const placement of buildPlacements) {
            const x = team1.baseTopLeft.x + placement.offsetX;
            const y = team1.baseTopLeft.y + placement.offsetY;
            room.queueBuildEvent('player-1', {
              templateId: 'block',
              x,
              y,
            });
            // Rejection is fine -- the build simply isn't in the state
          }

          // 4. Snapshot AFTER builds are queued (pending events are
          //    embedded in the payload) and initialize the client
          const sim = initClientFromServer(room, templates);

          // 5. Advance both by ticksAfter ticks
          for (let i = 0; i < ticksAfter; i++) {
            room.tick();
          }
          sim.advanceToTick(room.state.tick);

          // 6. Compare hashes
          const serverHash = room.createDeterminismCheckpoint().hashHex;
          const clientHash = sim.createLocalCheckpoint()!.hashHex;

          expect(clientHash).toBe(serverHash);
        },
      ),
      { numRuns: 200 },
    );
  }, 300_000);

  it('determinism holds with interleaved builds from both teams', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.array(
          fc.record({
            team: fc.integer({ min: 0, max: 1 }),
            offsetX: fc.integer({ min: 4, max: 14 }),
            offsetY: fc.integer({ min: 4, max: 14 }),
          }),
          { minLength: 0, maxLength: 6 },
        ),
        fc.integer({ min: 500, max: 550 }),
        (ticksBefore, buildPlacements, ticksAfter) => {
          const { room, templates, team1, team2 } = setupServerAndClient(
            52,
            52,
          );

          for (let i = 0; i < ticksBefore; i++) {
            room.tick();
          }

          // Queue builds from alternating teams on the server
          const teams = [
            {
              playerId: 'player-1',
              base: team1.baseTopLeft,
            },
            {
              playerId: 'player-2',
              base: team2.baseTopLeft,
            },
          ];

          for (const placement of buildPlacements) {
            const t = teams[placement.team];
            const x = t.base.x + placement.offsetX;
            const y = t.base.y + placement.offsetY;
            room.queueBuildEvent(t.playerId, {
              templateId: 'block',
              x,
              y,
            });
          }

          // Snapshot after all builds queued, init client
          const sim = initClientFromServer(room, templates);

          for (let i = 0; i < ticksAfter; i++) {
            room.tick();
          }
          sim.advanceToTick(room.state.tick);

          const serverHash = room.createDeterminismCheckpoint().hashHex;
          const clientHash = sim.createLocalCheckpoint()!.hashHex;

          expect(clientHash).toBe(serverHash);
        },
      ),
      { numRuns: 100 },
    );
  }, 300_000);

  it('determinism holds with destroy inputs', () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 550 }), (ticksAfter) => {
        // 1. Create room with 2 players (52x52 for performance)
        const { room, templates, team1 } = setupServerAndClient(52, 52);

        // 2. Queue a build on server at a known valid position
        const buildX = team1.baseTopLeft.x + 8;
        const buildY = team1.baseTopLeft.y + 8;
        const buildResult = room.queueBuildEvent('player-1', {
          templateId: 'block',
          x: buildX,
          y: buildY,
        });

        if (!buildResult.accepted) {
          // Build rejected -- property is vacuously true
          return;
        }

        // 3. Advance past executeTick so the structure materializes
        const ticksToMaterialize =
          buildResult.executeTick! - room.state.tick + 2;
        for (let i = 0; i < ticksToMaterialize; i++) {
          room.tick();
        }

        // 4. Find the built structure's key
        const teamState = room.state.teams.get(team1.id)!;
        const structureKeys = [...teamState.structures.keys()].filter(
          (k) => !k.includes('core'),
        );

        if (structureKeys.length === 0) {
          // Structure didn't materialize -- vacuously true
          return;
        }

        const structureKey = structureKeys[0];

        // 5. Queue destroy on server
        const destroyResult = room.queueDestroyEvent('player-1', {
          structureKey,
        });

        if (!destroyResult.accepted) {
          // Destroy rejected -- vacuously true
          return;
        }

        // 6. Snapshot AFTER destroy queued (pending destroy is in state)
        const sim = initClientFromServer(room, templates);

        // 7. Advance both ticksAfter more ticks
        for (let i = 0; i < ticksAfter; i++) {
          room.tick();
        }
        sim.advanceToTick(room.state.tick);

        // 8. Compare hashes
        const serverHash = room.createDeterminismCheckpoint().hashHex;
        const clientHash = sim.createLocalCheckpoint()!.hashHex;

        expect(clientHash).toBe(serverHash);
      }),
      { numRuns: 50 },
    );
  }, 300_000);
});
