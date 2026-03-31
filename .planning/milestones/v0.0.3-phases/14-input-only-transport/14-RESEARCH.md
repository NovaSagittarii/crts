# Phase 14: Input-Only Transport - Research

**Researched:** 2026-03-29
**Domain:** Lockstep transport protocol -- eliminating full-state broadcasts in favour of input relay
**Confidence:** HIGH

## Summary

Phase 14 transforms the active match transport from periodic full-state broadcasts to an input-only relay model. The codebase is well-prepared: Phase 13 already established `ClientSimulation` with `applyQueuedBuild` / `applyQueuedDestroy` methods, the server already broadcasts `build:queued` and `destroy:queued` events to all room clients, and the lockstep turn buffer already assigns a monotonic `sequence` number to each command.

The three requirements (XPORT-01, XPORT-02, XPORT-03) decompose into: (1) conditionally suppressing full-state and outcome broadcasts when the room is in `primary` lockstep mode, (2) adding a bounded ring buffer of accepted input events keyed by tick for reconnect replay, and (3) ensuring the existing per-command `sequence` assignment is formalized as the canonical relay ordering. All changes are server-side except the client must stop requesting `state:grid` on lockstep checkpoints.

**Primary recommendation:** Gate the existing `emitRoomState`, `emitBuildOutcomes`, and `emitDestroyOutcomes` calls behind a lockstep-mode check so they are suppressed when the room is in `primary` lockstep `running` status. Add an `InputEventLog` ring buffer data structure alongside the existing `turnBuffer`. Make the sequence-ordered relay the single source of truth for input ordering.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

None -- discuss phase was skipped per user setting. All implementation choices are at Claude's discretion.

### Claude's Discretion

All implementation choices are at Claude's discretion -- discuss phase was skipped per user setting. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Deferred Ideas (OUT OF SCOPE)

None -- discuss phase skipped.
</user_constraints>

<phase_requirements>

## Phase Requirements

| ID       | Description                                                                                                                                                                    | Research Support                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| XPORT-01 | Server relays confirmed input events instead of per-tick full state broadcasts; steady-state active match traffic consists only of input events and periodic checkpoint hashes | Conditional suppression of `emitRoomState`, `emitBuildOutcomes`, `emitDestroyOutcomes` in the tick loop when lockstep mode is `primary` and status is `running`. The `build:queued`/`destroy:queued` relay and `lockstep:checkpoint` emission already exist. Client must stop requesting `state:grid` during lockstep checkpoints.                                                   |
| XPORT-02 | Server retains a bounded input log (ring buffer) covering the reconnect window for replay delivery                                                                             | New `InputEventLog` class: array-backed ring buffer storing serialized `BuildQueuedPayload` / `DestroyQueuedPayload` keyed by tick number with a configurable capacity derived from `reconnectHoldMs / tickMs`. Entries older than the window are discarded on each tick advance.                                                                                                    |
| XPORT-03 | Server assigns deterministic ordering to inputs received in the same tick window before relaying to all clients                                                                | The existing `BufferedLockstepCommand.sequence` field provides monotonic insertion order. Formalize this: when multiple commands arrive in the same tick window, they are relayed to clients in ascending `sequence` order. The `sequence` number is already emitted indirectly via `eventId` in payloads. Add explicit `sequence` to `BuildQueuedPayload` / `DestroyQueuedPayload`. |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Layer boundaries**: `packages/*` must not import from `apps/*` or use Socket.IO/Express/DOM APIs. The ring buffer should live in `packages/rts-engine` or as a pure utility; transport wiring belongs in `apps/server`.
- **Socket contract**: `socket-contract.ts` is the canonical source of all event names and payload shapes. New fields must be added there.
- **Import style**: Explicit `.js` extensions in relative imports; package aliases `#conway-core` / `#rts-engine`.
- **TypeScript strict**: No `any`, explicit return types on exports, interfaces for object shapes.
- **Runtime payload validation**: Validate at socket/network boundaries.
- **Testing**: Unit tests co-located in packages; integration tests in `tests/integration/server/`; web view-model tests in `tests/web/`.
- **Conventional Commits**: Commit after each coherent phase of changes.
- **Tick order is deterministic and must be preserved** (economy -> builds -> grid step -> integrity -> match outcome).
- **Prefer `RtsRoom` instance methods** over static `RtsEngine` APIs.

## Architecture Patterns

### Current Active Match Tick Loop (server.ts lines 2759-2843)

Each server tick for an `active` room currently does:

1. `flushPrimaryTurnCommands(room)` -- process buffered lockstep commands
2. `room.rtsRoom.tick()` -- deterministic game tick
3. `emitBuildOutcomes(room, buildOutcomes)` -- broadcast build execution results **[SUPPRESS in XPORT-01]**
4. `emitDestroyOutcomes(room, destroyOutcomes)` -- broadcast destroy execution results **[SUPPRESS in XPORT-01]**
5. `runShadowTick(room)` -- shadow room verification (shadow mode only)
6. `emitLockstepCheckpointIfDue(room)` -- periodic hash checkpoint **[KEEP]**
7. (Periodically) `emitRoomState(room)` every `activeStateSnapshotIntervalTicks` **[SUPPRESS in XPORT-01]**

### Target Active Match Tick Loop (after Phase 14)

When lockstep mode is `primary` and status is `running`:

1. `flushPrimaryTurnCommands(room)` -- unchanged
2. `room.rtsRoom.tick()` -- unchanged
3. (build:outcome / destroy:outcome emission SKIPPED)
4. `runShadowTick(room)` -- unchanged
5. `emitLockstepCheckpointIfDue(room)` -- unchanged (hash broadcast KEPT)
6. `advanceInputLog(room)` -- discard ring buffer entries older than reconnect window **[NEW]**
7. (periodic full-state broadcast SKIPPED)

When lockstep mode is `off` or `shadow`, or status is `fallback`, the existing broadcast behavior is preserved unchanged as a fallback path.

### Input Event Flow

```
Client sends build:queue / destroy:queue
  --> server validates, calls rtsRoom.queueBuildEvent()
  --> server broadcasts build:queued / destroy:queued to room (ALREADY EXISTS)
  --> server records event in InputEventLog ring buffer (NEW for XPORT-02)
  --> all clients receive build:queued / destroy:queued
  --> ClientSimulation.applyQueuedBuild() / applyQueuedDestroy() (ALREADY EXISTS from Phase 13)
  --> On next tick, clients advance simulation locally (Phase 13)
```

### Ring Buffer Design (XPORT-02)

```typescript
interface InputLogEntry {
  tick: number;
  sequence: number;
  kind: 'build' | 'destroy';
  payload: BuildQueuedPayload | DestroyQueuedPayload;
}

class InputEventLog {
  private readonly buffer: (InputLogEntry | null)[];
  private head: number = 0;
  private count: number = 0;

  constructor(capacity: number) { ... }

  append(entry: InputLogEntry): void { ... }

  // Retrieve all entries from startTick onward (for reconnect replay)
  getEntriesFrom(startTick: number): InputLogEntry[] { ... }

  // Discard entries older than the given tick
  discardBefore(tick: number): void { ... }
}
```

**Capacity calculation**: `reconnectHoldMs / tickMs` gives the number of ticks in the reconnect window. Multiply by a generous per-tick command estimate (e.g., 4 commands/tick max) to size the buffer. Default: `reconnectHoldMs=30000, tickMs=100` -> 300 ticks -> 1200 entry capacity. A fixed capacity of 2048 is simpler and sufficient.

### Deterministic Ordering (XPORT-03)

The server already assigns `BufferedLockstepCommand.sequence` as a monotonic counter per room. This is the canonical ordering. The existing `createBuildQueuedPayload` and `createDestroyQueuedPayload` functions already include `eventId` in the payload. To make ordering explicit:

1. Add a `sequence` field to `BuildQueuedPayload` and `DestroyQueuedPayload` in `socket-contract.ts`.
2. Populate it from the lockstep runtime's `nextSequence` counter when creating the payload.
3. Client processes queued events in arrival order (Socket.IO preserves message ordering per connection), but the `sequence` field enables verification and replay ordering.

### Recommended Project Structure Changes

```
packages/rts-engine/
  input-event-log.ts           # NEW: InputEventLog ring buffer class
  input-event-log.test.ts      # NEW: Unit tests for ring buffer
  socket-contract.ts           # MODIFY: Add sequence field to payload types

apps/server/src/
  server.ts                    # MODIFY: Gate broadcasts, integrate InputEventLog

apps/web/src/
  client.ts                    # MODIFY: Stop requesting state:grid on checkpoint
  client-simulation.ts         # MINOR: Potential adjustment if needed

tests/integration/server/
  input-only-transport.test.ts # NEW: Integration tests for XPORT-01/02/03
```

### Anti-Patterns to Avoid

- **Removing full-state broadcast entirely**: The fallback path (lockstep `off` or `fallback` status) MUST continue to broadcast full state. Only suppress in `primary` lockstep `running` mode.
- **Breaking the existing `state:request` mechanism**: Clients must still be able to explicitly request full state via `state:request` even during input-only mode. This is needed for late joiners and reconnect.
- **Coupling ring buffer to Socket.IO**: The `InputEventLog` should be a pure data structure in `packages/rts-engine`, not dependent on Socket.IO types. It stores serialized payloads.
- **Changing tick determinism**: No changes to the `rtsRoom.tick()` call or its order. Only the broadcast/emission layer changes.

## Don't Hand-Roll

| Problem          | Don't Build                  | Use Instead                                  | Why                                                                               |
| ---------------- | ---------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| Ring buffer      | Linked list or dynamic array | Fixed-capacity array with head/tail pointers | O(1) append/discard, bounded memory, no GC pressure                               |
| Message ordering | Custom ordering protocol     | Monotonic sequence counter (already exists)  | Socket.IO guarantees per-connection FIFO; sequence is for verification and replay |
| Reconnect replay | Custom state diff mechanism  | Full replay from ring buffer + snapshot      | Simpler, deterministic, matches lockstep model                                    |

## Common Pitfalls

### Pitfall 1: Forgetting to suppress `state:hashes` alongside `emitRoomState`

**What goes wrong:** `emitRoomState` calls both `roomBroadcast.emitRoomState()` and `roomBroadcast.emitStateHashes()`. If only the `emitRoomState` call in the tick loop is suppressed but `state:hashes` emissions from `emitBuildQueued`/`emitDestroyQueued` remain, clients will still request full state via the hash-based resync mechanism.

**Why it happens:** The `emitBuildQueued` and `emitDestroyQueued` wrappers (lines 1149-1170) also call `roomBroadcast.emitStateHashes()`. In input-only mode, these hash emissions after each queued event are wasteful since the client simulation computes state locally.

**How to avoid:** In primary lockstep running mode, suppress `emitStateHashes` calls from the per-event wrappers. Only emit hashes at checkpoint intervals.

**Warning signs:** Client making `state:request` calls during steady-state match despite input-only mode being active.

### Pitfall 2: Ring buffer capacity too small

**What goes wrong:** If the ring buffer is sized exactly to `reconnectHoldMs / tickMs`, a burst of commands near the buffer boundary could push out entries that a reconnecting player still needs.

**Why it happens:** Multiple commands can arrive per tick; the buffer needs to account for command density, not just tick count.

**How to avoid:** Size the buffer generously. Use `(reconnectHoldMs / tickMs) * maxCommandsPerTick` or a fixed generous size like 2048. Track the oldest tick in the buffer and reject reconnect requests for ticks older than what the buffer holds.

**Warning signs:** Ring buffer wrapping discards entries that reconnecting players need.

### Pitfall 3: Client still requesting `state:grid` on lockstep checkpoint

**What goes wrong:** The current client code (client.ts line 4060-4062) calls `requestStateSections(['grid'])` every 50 ticks on lockstep checkpoint. In input-only mode, this is unnecessary and defeats the purpose.

**Why it happens:** The code was written before input-only transport existed, as a safety measure to keep the grid visually synced.

**How to avoid:** Guard the `requestStateSections` call with a check: if the client simulation is active and the checkpoint hash matches, skip the request.

**Warning signs:** Network traffic monitor showing periodic `state:request` messages during an active lockstep match.

### Pitfall 4: Not handling fallback transition correctly

**What goes wrong:** If the server falls back from primary lockstep to `off` mode (e.g., due to hash mismatch or buffer overflow), the client needs to resume receiving full-state broadcasts. If the broadcast suppression doesn't check lockstep status dynamically, the client will stop receiving updates.

**Why it happens:** The fallback transition changes `lockstepRuntime.mode` to `off` and `status` to `fallback`. If the broadcast suppression only checks `mode` at match start, it won't re-enable broadcasts.

**How to avoid:** Check `lockstepRuntime.mode === 'primary' && lockstepRuntime.status === 'running'` on every tick, not once at match start.

**Warning signs:** Client freezing after a desync event triggers fallback.

### Pitfall 5: Breaking existing integration tests

**What goes wrong:** Existing integration tests for `build:outcome`/`destroy:outcome` events may fail if those events are no longer broadcast in primary lockstep mode.

**Why it happens:** Tests may be running with `lockstepMode: 'primary'` and expecting `build:outcome` events.

**How to avoid:** Audit existing tests. Tests using `lockstepMode: 'off'` (or not setting it) will be unaffected. Tests using `lockstepMode: 'primary'` need to be checked -- they should still pass since outcome events are still computed, just not broadcast.

**Warning signs:** Test suite failures after implementing broadcast suppression.

## Code Examples

### Broadcast suppression in tick loop

```typescript
// Source: apps/server/src/server.ts tick() function modification
// In the active room tick loop:
const isInputOnlyMode =
  room.lockstepRuntime.mode === 'primary' &&
  room.lockstepRuntime.status === 'running';

flushPrimaryTurnCommands(room);
const tickResult = room.rtsRoom.tick();

if (!isInputOnlyMode) {
  // Legacy broadcast path: emit outcomes and periodic state
  const buildOutcomes: BuildOutcomePayload[] = tickResult.buildOutcomes.map(
    (outcome) => ({ ...outcome, roomId: room.rtsRoom.id }),
  );
  const destroyOutcomes: DestroyOutcomePayload[] =
    tickResult.destroyOutcomes.map((outcome) => ({
      ...outcome,
      roomId: room.rtsRoom.id,
    }));
  emitBuildOutcomes(room, buildOutcomes);
  emitDestroyOutcomes(room, destroyOutcomes);
}

runShadowTick(room);
emitLockstepCheckpointIfDue(room);

// Also in the periodic state broadcast section:
if (room.lobby.participantCount() > 0) {
  if (room.status === 'active' && emitActiveStateSnapshot && !isInputOnlyMode) {
    emitRoomState(room);
  }
  // ...
}
```

### InputEventLog ring buffer (pure data structure)

```typescript
// Source: packages/rts-engine/input-event-log.ts
export type InputLogEventKind = 'build' | 'destroy';

export interface InputLogEntry {
  tick: number;
  sequence: number;
  kind: InputLogEventKind;
  payload: unknown; // BuildQueuedPayload | DestroyQueuedPayload at runtime
}

export class InputEventLog {
  private readonly buffer: (InputLogEntry | null)[];
  private head: number = 0;
  private _count: number = 0;

  public constructor(capacity: number) {
    this.buffer = new Array<InputLogEntry | null>(capacity).fill(null);
  }

  public get count(): number {
    return this._count;
  }

  public get capacity(): number {
    return this.buffer.length;
  }

  public append(entry: InputLogEntry): void {
    const index = (this.head + this._count) % this.buffer.length;
    if (this._count === this.buffer.length) {
      // Overwrite oldest entry
      this.head = (this.head + 1) % this.buffer.length;
    } else {
      this._count += 1;
    }
    this.buffer[index] = entry;
  }

  public getEntriesFromTick(startTick: number): InputLogEntry[] {
    const result: InputLogEntry[] = [];
    for (let i = 0; i < this._count; i++) {
      const entry = this.buffer[(this.head + i) % this.buffer.length];
      if (entry && entry.tick >= startTick) {
        result.push(entry);
      }
    }
    return result;
  }

  public discardBefore(tick: number): void {
    while (this._count > 0) {
      const entry = this.buffer[this.head];
      if (!entry || entry.tick >= tick) break;
      this.buffer[this.head] = null;
      this.head = (this.head + 1) % this.buffer.length;
      this._count -= 1;
    }
  }

  public clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this._count = 0;
  }
}
```

### Sequence field addition to socket contract

```typescript
// Source: packages/rts-engine/socket-contract.ts additions
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
  sequence: number; // NEW: deterministic ordering within tick window
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
  sequence: number; // NEW: deterministic ordering within tick window
}
```

### Client checkpoint handler update

```typescript
// Source: apps/web/src/client.ts lockstep:checkpoint handler modification
socket.on('lockstep:checkpoint', (payload: LockstepCheckpointPayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  if (clientSimulation.isActive) {
    clientSimulation.advanceToTick(payload.tick);
    const match = clientSimulation.verifyCheckpoint(payload);
    if (!match) {
      console.warn(
        `[lockstep] Desync detected at tick ${String(payload.tick)}`,
      );
      // Phase 15 will handle resync
    }
    // In input-only mode, do NOT request state:grid -- simulation is authoritative
  } else {
    // Fallback: no active simulation, request grid for visual sync
    if (payload.tick % 50 === 0) {
      requestStateSections(['grid']);
    }
  }
});
```

## State of the Art

| Old Approach          | Current Approach                              | When Changed       | Impact                                          |
| --------------------- | --------------------------------------------- | ------------------ | ----------------------------------------------- |
| Full state every tick | Periodic state (every 50 ticks) + input relay | Phase 13 (partial) | Reduced bandwidth but still periodic full state |
| No client simulation  | Client runs parallel `RtsRoom`                | Phase 13           | Foundation for input-only transport             |
| No lockstep mode      | Shadow + Primary lockstep modes               | v0.0.2             | Server validates inputs via shadow room         |

**This phase transitions from "periodic state + input relay" to "input-only relay + periodic hash verification" for primary lockstep mode.**

## Validation Architecture

### Test Framework

| Property           | Value               |
| ------------------ | ------------------- |
| Framework          | vitest 4.0.18       |
| Config file        | `vitest.config.ts`  |
| Quick run command  | `npm run test:fast` |
| Full suite command | `npm test`          |

### Phase Requirements to Test Map

| Req ID   | Behavior                                                                                   | Test Type   | Automated Command                                                         | File Exists?    |
| -------- | ------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------- | --------------- |
| XPORT-01 | No full-state broadcast during active lockstep match; only input relay + checkpoint hashes | integration | `npx vitest run tests/integration/server/input-only-transport.test.ts -x` | Wave 0          |
| XPORT-01 | Fallback path still broadcasts full state                                                  | integration | `npx vitest run tests/integration/server/input-only-transport.test.ts -x` | Wave 0          |
| XPORT-01 | Client does not request state:grid during active lockstep                                  | web (unit)  | `npx vitest run tests/web/client-simulation.test.ts -x`                   | Exists (extend) |
| XPORT-02 | Ring buffer stores input events, retrieves from tick, discards old                         | unit        | `npx vitest run packages/rts-engine/input-event-log.test.ts -x`           | Wave 0          |
| XPORT-02 | Ring buffer capacity bounds are respected                                                  | unit        | `npx vitest run packages/rts-engine/input-event-log.test.ts -x`           | Wave 0          |
| XPORT-03 | Inputs in same tick window are relayed in sequence order                                   | integration | `npx vitest run tests/integration/server/input-only-transport.test.ts -x` | Wave 0          |
| XPORT-03 | Sequence field present in BuildQueuedPayload / DestroyQueuedPayload                        | unit        | `npx vitest run packages/rts-engine/rts.test.ts -x`                       | Exists (extend) |

### Sampling Rate

- **Per task commit:** `npm run test:fast`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `packages/rts-engine/input-event-log.test.ts` -- covers XPORT-02 ring buffer behavior
- [ ] `tests/integration/server/input-only-transport.test.ts` -- covers XPORT-01 broadcast suppression and XPORT-03 ordering

## Open Questions

1. **Should `build:outcome` / `destroy:outcome` be suppressed or kept as optional hints?**
   - What we know: In input-only mode, clients compute outcomes locally via simulation. Broadcasting them is redundant.
   - What's unclear: Some UI feedback currently depends on `build:outcome` events (e.g., toast notifications). The client already has this info from the simulation tick result though.
   - Recommendation: Suppress them. The client can derive outcome feedback from simulation state. This is the cleaner approach and matches the phase goal of "only input events and periodic checkpoint hashes cross the wire."

2. **Should `emitStateHashes` calls from `emitBuildQueued`/`emitDestroyQueued` be suppressed?**
   - What we know: Currently every `build:queued` / `destroy:queued` emission also triggers `emitStateHashes`. In input-only mode this triggers the client-side hash reconciliation that requests state sections.
   - What's unclear: Whether the hash-based resync mechanism should remain active as a safety net or be fully replaced by checkpoint-based verification.
   - Recommendation: Suppress per-event `emitStateHashes` in input-only mode. The `lockstep:checkpoint` mechanism already provides periodic hash verification. Per-event hashes are a pre-lockstep safety mechanism that conflicts with the input-only model.

3. **Ring buffer in `packages/rts-engine` vs `apps/server`?**
   - What we know: The ring buffer is a pure data structure with no runtime dependencies. It stores typed payloads.
   - What's unclear: Whether it should be in the engine package (reusable) or server-only (it's a transport concern).
   - Recommendation: Place it in `packages/rts-engine` since the payload types live there and it's a pure data structure. The wiring into server lifetime management stays in `apps/server`.

## Sources

### Primary (HIGH confidence)

- Direct codebase analysis of `apps/server/src/server.ts` (tick loop, lockstep runtime, broadcast functions)
- Direct codebase analysis of `packages/rts-engine/socket-contract.ts` (payload type definitions)
- Direct codebase analysis of `apps/web/src/client-simulation.ts` (Phase 13 client simulation)
- Direct codebase analysis of `apps/web/src/client.ts` (socket event handlers)
- Direct codebase analysis of `packages/rts-engine/rts.ts` (RtsRoom, tick result, determinism checkpoint)

### Secondary (MEDIUM confidence)

- Ring buffer sizing heuristics based on `RECONNECT_HOLD_MS` (30s) and typical `tickMs` (100ms) defaults

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH -- no new libraries needed, all changes are within existing codebase patterns
- Architecture: HIGH -- clear mapping from current code to required changes, well-understood codebase
- Pitfalls: HIGH -- identified from direct code inspection of broadcast paths and client handlers

**Research date:** 2026-03-29
**Valid until:** 2026-04-28 (30 days -- stable domain, no external dependency changes)
