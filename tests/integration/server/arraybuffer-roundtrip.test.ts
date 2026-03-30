import { describe, expect } from 'vitest';

import { Grid } from '#conway-core';
import type { RoomStatePayload } from '#rts-engine';

import { createLockstepTest } from './lockstep-fixtures.js';
import { waitForState } from './test-support.js';

const GRID_WIDTH = 52;
const GRID_HEIGHT = 52;
const EXPECTED_PACKED_BYTES = Math.ceil((GRID_WIDTH * GRID_HEIGHT) / 8);

/**
 * Extract a plain Uint8Array from a binary payload that may arrive as
 * an ArrayBuffer (browser) or a Node.js Buffer (Socket.IO in Node).
 * Both are valid binary representations; the key property we verify is
 * that the data was NOT transmitted as a JSON-serialised string.
 *
 * Returns a *plain* Uint8Array (not a Buffer subclass) so that vitest's
 * toEqual comparison works reliably across types.
 */
function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) {
    // Buffer extends Uint8Array; copy into a plain Uint8Array to avoid
    // vitest toEqual type mismatch between Buffer and Uint8Array.
    return new Uint8Array(data);
  }
  return new Uint8Array(data);
}

const test = createLockstepTest(
  {
    port: 0,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    tickMs: 100,
    countdownSeconds: 0,
    lockstepMode: 'primary',
    lockstepCheckpointIntervalTicks: 5,
  },
  {
    roomName: 'ArrayBuffer Round-Trip',
    hostSessionId: 'ab-roundtrip-host',
    guestSessionId: 'ab-roundtrip-guest',
  },
  { waitForActiveMembership: true },
  { clockMode: 'manual' },
);

describe('ArrayBuffer round-trip (QUAL-01)', () => {
  test(
    'Grid.toPacked() ArrayBuffer survives Socket.IO binary attachment path',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);

      // The room:joined payload contains state.grid as binary data that
      // has traversed the Socket.IO binary attachment path.
      // In Node.js Socket.IO delivers Buffer (extends Uint8Array); in the
      // browser it arrives as ArrayBuffer.  Both prove binary transport.
      const receivedGrid = match.hostJoined.state.grid;

      // Verify Socket.IO transmitted it as binary, not JSON-mangled string
      expect(
        receivedGrid instanceof ArrayBuffer ||
          receivedGrid instanceof Uint8Array,
      ).toBe(true);

      // Verify the correct byte length for a 52x52 packed grid
      const receivedBytes = toUint8Array(receivedGrid);
      expect(receivedBytes.byteLength).toBe(EXPECTED_PACKED_BYTES);

      // Unpack the received binary data into a Grid
      const unpacked = Grid.fromPacked(receivedBytes, GRID_WIDTH, GRID_HEIGHT);

      // Verify all cells are valid (0 or 1)
      for (const cell of unpacked.cells()) {
        expect(cell.alive === 0 || cell.alive === 1).toBe(true);
      }

      // Round-trip: unpack -> repack -> compare bytes via Uint8Array
      // This proves: Socket.IO binary attachment -> client receives binary
      //   -> Grid.fromPacked -> Grid.toPacked round-trips perfectly
      const repacked = unpacked.toPacked();
      expect(new Uint8Array(repacked)).toEqual(receivedBytes);
    },
  );

  test(
    'Grid ArrayBuffer received after ticks has expected alive cells',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Advance the manual clock by 5 ticks so the grid evolves
      await connectedRoom.clock.advanceTicks(5);

      // Request full state from the server after ticks have advanced
      const state = await waitForState(
        match.host,
        (payload: RoomStatePayload) =>
          payload.roomId === match.roomId && payload.tick >= 5,
        {
          roomId: match.roomId,
          attempts: 30,
          timeoutMs: 5000,
        },
      );

      // Verify the received grid is binary data (Buffer or ArrayBuffer)
      expect(
        state.grid instanceof ArrayBuffer ||
          state.grid instanceof Uint8Array,
      ).toBe(true);

      const receivedBytes = toUint8Array(state.grid);
      expect(receivedBytes.byteLength).toBe(EXPECTED_PACKED_BYTES);

      // Unpack with Grid.fromPacked
      const unpacked = Grid.fromPacked(
        receivedBytes,
        GRID_WIDTH,
        GRID_HEIGHT,
      );

      // The core structures seed alive cells at match start, so after
      // 5 generations of Conway evolution there should still be alive cells
      let aliveCount = 0;
      for (const cell of unpacked.cells()) {
        if (cell.alive === 1) {
          aliveCount += 1;
        }
      }
      expect(aliveCount).toBeGreaterThan(0);

      // Round-trip: unpack -> repack -> compare bytes via Uint8Array
      const repacked = unpacked.toPacked();
      expect(new Uint8Array(repacked)).toEqual(receivedBytes);
    },
  );
});
