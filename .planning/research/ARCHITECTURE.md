# Architecture Research

**Domain:** Deterministic lockstep protocol integration — Conway RTS TypeScript prototype (v0.0.3)
**Researched:** 2026-03-29
**Confidence:** HIGH (direct codebase analysis + verified lockstep literature)

## Context: What Already Exists

This is a milestone research document for v0.0.3. The architecture below describes how a deterministic lockstep protocol integrates with an existing, fully-functioning system. The focus is integration points, new vs modified components, and data flow changes.

**Existing foundation confirmed by codebase analysis:**

- `packages/rts-engine/rts.ts`: `RtsRoom.tick()` is already deterministic with a fixed, documented tick order. `RtsRoom.createDeterminismCheckpoint()` produces FNV1a-32 hashes. `RtsEngine.createRoom()` and `RtsRoom.fromState()` allow rooms to be reconstructed from state. `queueBuildEvent()` and `queueDestroyEvent()` are the canonical queue entry points.
- `apps/server/src/server.ts`: Already has `LockstepRuntimeState` with `mode: 'off' | 'shadow' | 'primary'`, `turnBuffer`, `shadowRoom`, `flushPrimaryTurnCommands()`, `runShadowTick()`, and `emitLockstepCheckpointIfDue()`. The tick loop calls `room.rtsRoom.tick()` and emits `build:outcome` / `destroy:outcome` per tick. Full state is broadcast on a heartbeat (`emitActiveStateSnapshot` interval) and on queue events.
- `packages/rts-engine/socket-contract.ts`: Already defines `LockstepCheckpointPayload`, `LockstepFallbackPayload`, `LockstepStatusPayload`, `BuildQueuedPayload` (carrying `bufferedTurn`, `scheduledByTurn`, `executeTick`, `playerId`, `teamId`, `transform`), `DestroyQueuedPayload` (carrying `executeTick`, `playerId`, `teamId`, `structureKey`), and `RoomJoinedPayload` with full `state` snapshot.
- `apps/web/src/client.ts`: Already imports `RtsEngine`, `Grid`, and all socket contract types from `#rts-engine`. The client is currently state-broadcast-driven.

**What is NOT yet built:**

- Client-side deterministic simulation runner (clients receive full state broadcasts; they do not run `RtsRoom.tick()` locally)
- Input-only transport (server still emits full state on periodic heartbeat and after queue events)
- Client-side event rejection (clients accept all outcomes from server state updates)
- Reconnect via snapshot + bounded input log replay

---

## Standard Architecture: Server-Authoritative Lockstep With Input Relay

### System Overview

```
CLIENT (apps/web)                              SERVER (apps/server)

+------------------------------------------+   +------------------------------------------+
|  LockstepSimulationRunner (NEW)           |   |  RuntimeRoom.lockstepRuntime (EXISTS)     |
|  +--------------------------------------+ |   |  +--------------------------------------+ |
|  |  Local RtsRoom clone                 | |   |  |  Authoritative RtsRoom               | |
|  |  (runs tick() locally at tickMs)     |<-------|  (runs tick(), is ground truth)       | |
|  +--------------------------------------+ |   |  +------------------+-------------------+ |
|  +--------------------------------------+ |   |                     |                     |
|  |  InputLog (NEW)                      | |   |  +------------------v-------------------+ |
|  |  queued events indexed by executeTick| |   |  |  LockstepInputLog (NEW on server)     | |
|  +--------------------------------------+ |   |  |  bounded ring buffer of relayed       | |
|  +--------------------------------------+ |   |  |  build:queued + destroy:queued events | |
|  |  DesyncDetector (NEW)                | |   |  +--------------------------------------+ |
|  |  compare local hash to checkpoint    | |   |                                           |
|  +--------------------------------------+ |   |  Emits (MODIFIED):                        |
|  +--------------------------------------+ |   |    lockstep:checkpoint (hash + tick)      |
|  |  ReconnectReplayEngine (NEW)         | |   |    build:queued (relayed to all clients)  |
|  |  snapshot + input log replay         | |   |    destroy:queued (relayed to all)        |
|  +--------------------------------------+ |   |    state (snapshot on join / fallback)    |
+------------------------------------------+   |                                           |
                                                |  SUPPRESSED in lockstep primary mode:     |
                                                |    emitRoomState() heartbeat              |
                                                |    build:outcome (or scope to sender)     |
                                                |    destroy:outcome (or scope to sender)   |
                                                +------------------------------------------+
```

### Component Responsibilities

| Component | Layer | Responsibility | Status |
|-----------|-------|---------------|--------|
| `LockstepSimulationRunner` | `apps/web` | Owns local `RtsRoom` clone; drives `tick()` on `tickMs` interval; applies relayed events at `executeTick` | **New** |
| `InputLog` | `apps/web` | Ordered buffer of all accepted `build:queued` / `destroy:queued` events indexed by `executeTick`; used for local tick execution and reconnect replay | **New** |
| `DesyncDetector` | `apps/web` | Receives `lockstep:checkpoint`; calls `localRoom.createDeterminismCheckpoint()` at the matching tick; compares hashes; triggers resync on mismatch | **New** |
| `ReconnectReplayEngine` | `apps/web` | On reconnect: receives initial `state` snapshot from `room:joined` plus bounded input log; hydrates local room; replays events to advance to current tick | **New** |
| `LockstepRuntimeState` | `apps/server` | Already exists: turn buffer, shadow room, checkpoint emission, fallback logic. Needs: bounded input log for reconnect | **Existing + modified** |
| `RtsRoom` | `packages/rts-engine` | Already fully deterministic: `tick()`, `queueBuildEvent()`, `queueDestroyEvent()`, `createDeterminismCheckpoint()` | **Existing, no changes needed** |
| `socket-contract.ts` | `packages/rts-engine` | Already has all lockstep event types. Needs: `LockstepInputLogPayload` for reconnect; `kind` discriminant on queued event union | **Existing + minor additions** |
| `RoomBroadcastService` | `apps/server` | Already emits checkpoints. Needs: suppress periodic full-state broadcast when lockstep active; emit `build:queued`/`destroy:queued` to all clients unconditionally | **Existing + modified** |

---

## Recommended Structure (New Files Only)

```
apps/web/src/
  lockstep-simulation-runner.ts    # NEW: owns local RtsRoom, drives tick loop, applies events
  lockstep-input-log.ts            # NEW: ordered input buffer indexed by executeTick
  lockstep-desync-detector.ts      # NEW: hash comparison, desync signal, resync trigger
  lockstep-reconnect-engine.ts     # NEW: snapshot + input replay coordination

packages/rts-engine/
  socket-contract.ts               # MODIFIED: add LockstepInputLogPayload; add kind discriminant

apps/server/src/
  server.ts                        # MODIFIED: suppress state heartbeat in lockstep mode;
                                   #   maintain bounded input log; attach input log to room:joined

tests/integration/server/
  lockstep-client-sim.test.ts      # NEW: client simulation determinism contract
  lockstep-reconnect.test.ts       # NEW: snapshot + replay reconnect contract

tests/web/
  lockstep-simulation-runner.test.ts  # NEW: pure simulation logic tests
  lockstep-input-log.test.ts          # NEW: insert, dueAt, bounded ring
  lockstep-desync-detector.test.ts    # NEW: hash match, mismatch, trigger
```

---

## Architectural Patterns

### Pattern 1: Server Validates Inputs, Clients Execute Locally

**What:** The server continues to run `RtsRoom.tick()` authoritatively. Clients also run `RtsRoom.tick()` locally on the same `tickMs` interval. The server relays all accepted `build:queued`/`destroy:queued` events to all room clients — including the originating client. Clients apply these relayed events to their local room at `executeTick` and advance the simulation locally. The server sends full state only on: join/reconnect, desync recovery, and explicit `state:request`.

**When to use:** This is the v0.0.3 authority model — server validates at queue time; clients run deterministic simulation for rendering.

**Trade-offs:** Clients need the simulation engine code (already true — `#rts-engine` is imported by `apps/web`). Desyncs are caught by periodic hash comparison, not per-tick. Local simulation decouples client rendering from server round-trip latency. No client-side prediction or rollback needed because no local execution happens before server confirmation.

**Existing leverage:** `apps/web/src/client.ts` already imports `RtsEngine`. `room:joined` already includes a full `state` snapshot. `BuildQueuedPayload` and `DestroyQueuedPayload` already carry `executeTick`, `playerId`, `teamId`, `transform`, and all fields needed to reconstruct the queue event on the local room.

```typescript
// LockstepSimulationRunner — conceptual shape
class LockstepSimulationRunner {
  private localRoom: RtsRoom;
  private inputLog: InputLog;
  private tickIntervalId: ReturnType<typeof setInterval> | null = null;

  start(tickMs: number): void {
    this.tickIntervalId = setInterval(() => this.advanceTick(), tickMs);
  }

  applyQueuedEvent(event: BuildQueuedPayload | DestroyQueuedPayload): void {
    this.inputLog.insert(event);
  }

  private advanceTick(): void {
    const tick = this.localRoom.state.tick;
    for (const event of this.inputLog.dueAt(tick)) {
      if (isBuildQueued(event)) {
        this.localRoom.queueBuildEvent(event.playerId, toBuildQueuePayload(event));
      } else {
        this.localRoom.queueDestroyEvent(event.playerId, toDestroyQueuePayload(event));
      }
    }
    this.localRoom.tick();
  }
}
```

### Pattern 2: Bounded Input Log for Reconnect Replay

**What:** Every relayed `build:queued`/`destroy:queued` event accepted by the server is appended to a bounded ring buffer keyed by tick. On reconnect, the server sends the most recent `lockstep:checkpoint` snapshot tick plus all events from that tick forward. The client hydrates its local room from the snapshot and replays the input log to advance to the current server tick.

**When to use:** For reconnect within the hold window, and for desync recovery when a fallback full-state snapshot is received.

**Trade-offs:** The input log only needs to retain events from the last snapshot checkpoint tick forward, not the entire match history. Buffer size is bounded by `Math.ceil(reconnectHoldMs / tickMs) + checkpointIntervalTicks`.

**Existing leverage:** Server already maintains `lockstepRuntime.checkpoints[]` capped at 16 entries — the latest provides the snapshot anchor tick. `room:joined` already delivers full state.

```typescript
// New type in socket-contract.ts
export interface LockstepInputLogEntry {
  kind: 'build' | 'destroy';
  executeTick: number;
  payload: BuildQueuedPayload | DestroyQueuedPayload;
}

export interface LockstepInputLogPayload {
  roomId: string;
  fromTick: number;   // tick of the accompanying state snapshot
  toTick: number;     // current server tick at time of reconnect
  entries: LockstepInputLogEntry[];
}
```

### Pattern 3: Hash Checkpoint as Desync Circuit Breaker

**What:** Server emits `lockstep:checkpoint` at `checkpointIntervalTicks` (already wired). Client computes `localRoom.createDeterminismCheckpoint()` at the matching tick and compares the hash. On mismatch: client emits `state:request`; server sends full state; client resets its local room from the server snapshot and resumes.

**When to use:** Always active during lockstep mode. No per-tick hashing needed.

**Trade-offs:** Catch-and-recover is coarser than per-tick but avoids per-tick overhead. Mismatches indicate a bug, not normal operation — the checkpoint interval determines how far a desync can drift before detection.

**Existing leverage:** `RtsRoom.createDeterminismCheckpoint()` returns `{ tick, generation, hashAlgorithm, hashHex }`. The `DesyncDetector` is a thin module: receive checkpoint, call local room method, compare, signal if different.

### Pattern 4: Client-Side Event Rejection Via Local Engine

**What:** The local `LockstepSimulationRunner` applies each `build:queued` event by calling `localRoom.queueBuildEvent()` on the local room. The local room validates the event using the same deterministic engine rules as the server. If the local engine rejects an event that the server accepted (or vice versa), the client is desynced and requests a resync.

**When to use:** Standard operation. The `build:outcome`/`destroy:outcome` payloads (carrying `outcome: 'applied' | 'rejected'` and `eventId`) can be used to cross-validate the client's local decision against the server's authoritative outcome.

**Trade-offs:** Client simulation enforces legality rather than blindly applying events. This avoids displaying effects that the server would not have applied. The `build:outcome`/`destroy:outcome` events become cross-checks rather than the primary rendering trigger.

---

## Data Flow Changes

### Before Lockstep (Current v0.0.2 State-Broadcast Model)

```
[Player input]
     |
     v
build:queue / destroy:queue --> Server validates --> queueBuildEvent()
                                                          |
                                               build:queued (broadcast)
                                               build:outcome (broadcast)
                                                          |
                              Server tick() runs --> emitRoomState() (periodic heartbeat)
                                                          |
                                Client receives full state each heartbeat, renders
```

### After Lockstep (v0.0.3 Input-Relay Model)

```
[Player input]
     |
     v
build:queue / destroy:queue --> Server validates --> queueBuildEvent() + store in InputLog
                                                          |
                                    build:queued (broadcast to ALL clients including sender)
                                    [build:outcome SUPPRESSED in lockstep primary mode
                                     OR scoped to originating client only as confirmation]
                                    [emitRoomState() heartbeat SUPPRESSED in lockstep mode]
                                                          |
Client A receives build:queued --> InputLog.insert(event)
Client B receives build:queued --> InputLog.insert(event)
                                                          |
[Client tick loop: both clients call localRoom.tick() at tickMs interval]
[At executeTick: both call queueBuildEvent() on local room, then tick()]
[Both local rooms produce identical tick results deterministically]
                                                          |
Server tick() still runs authoritatively (no broadcast)
At checkpointIntervalTicks --> lockstep:checkpoint (hash broadcast)
                                                          |
Client A: DesyncDetector compares local hash to checkpoint hash
Client B: DesyncDetector compares local hash to checkpoint hash
If mismatch --> state:request --> server emits full state --> client resets local room
```

### Reconnect Flow

```
Client disconnects (hold timer starts on server)
     |
     v
Client reconnects within hold window
     |
     v
Server: room:joined with state snapshot at tick T
        + LockstepInputLogPayload (entries from tick T to current tick T_now)
     |
     v
Client: ReconnectReplayEngine.hydrate(state, inputLog)
  1. Reconstruct RtsRoom from state snapshot (Grid.fromPacked + team state)
  2. For each entry in inputLog from tick T to T_now:
       At entry.executeTick: queueBuildEvent() or queueDestroyEvent() on local room
       tick() forward one step
  3. At T_now: local room matches authoritative server state
     |
     v
Client resumes normal lockstep simulation loop
```

---

## Integration Points: New vs Modified

### New Components (Must Build)

| Component | Location | Depends On | Test Location |
|-----------|----------|------------|---------------|
| `LockstepSimulationRunner` | `apps/web/src/` | `RtsRoom` via `#rts-engine`, `InputLog` | `tests/web/lockstep-simulation-runner.test.ts` |
| `InputLog` | `apps/web/src/` | `BuildQueuedPayload`, `DestroyQueuedPayload` | `tests/web/lockstep-input-log.test.ts` |
| `DesyncDetector` | `apps/web/src/` | `LockstepCheckpointPayload`, `LockstepSimulationRunner` | `tests/web/lockstep-desync-detector.test.ts` |
| `ReconnectReplayEngine` | `apps/web/src/` | `LockstepSimulationRunner`, `InputLog`, `LockstepInputLogPayload` | `tests/integration/server/lockstep-reconnect.test.ts` |
| `LockstepInputLogPayload` | `packages/rts-engine/socket-contract.ts` | `BuildQueuedPayload`, `DestroyQueuedPayload` | Used in integration tests |
| Bounded input log in server | `apps/server/src/server.ts` | `LockstepRuntimeState` | `tests/integration/server/lockstep-reconnect.test.ts` |

### Modified Components (Existing, Targeted Changes)

| Component | What Changes | Risk |
|-----------|-------------|------|
| `server.ts` tick loop | Suppress `emitRoomState()` when lockstep primary mode is active. The conditional `emitActiveStateSnapshot` already exists — add a mode check. | LOW |
| `server.ts` build/destroy handlers | Already emit `build:queued`/`destroy:queued` to room channel. Decide: suppress `build:outcome`/`destroy:outcome` in lockstep primary mode, or scope to originating client only. | MEDIUM |
| `server.ts` reconnect join | Add `inputLog?: LockstepInputLogPayload` to the `room:joined` payload when lockstep is active. Server must maintain a bounded ring buffer of relayed events. | MEDIUM |
| `socket-contract.ts` | Add `LockstepInputLogPayload` interface. Add optional `kind: 'build' | 'destroy'` discriminant or a new union type for input log entries. Extend `RoomJoinedPayload` with optional `inputLog`. | LOW — additive only |
| `client.ts` | Wire `build:queued`/`destroy:queued` handlers to `InputLog` when lockstep active. Stop applying full state on every `build:outcome`/`destroy:outcome` when local simulation is running. Preserve non-lockstep state-broadcast path for fallback. | HIGH — largest web change |

### Untouched Components

- `packages/rts-engine/rts.ts` — No changes needed. All primitives (`tick()`, `queueBuildEvent()`, `queueDestroyEvent()`, `createDeterminismCheckpoint()`, `createStatePayload()`, `fromState()`) are already suitable.
- `packages/conway-core/` — No changes needed. `Grid.step()` and `Grid.toPacked()`/`fromPacked()` are already deterministic.
- Existing `socket-contract.ts` lockstep types — `LockstepCheckpointPayload`, `LockstepFallbackPayload`, `LockstepStatusPayload` are fully usable as-is.
- `apps/server/src/lobby-session.ts` — No changes needed.
- `apps/server/src/server-room-broadcast.ts` — No changes needed unless input log emission is added here.
- All existing non-lockstep integration tests — Must continue to pass unchanged.

---

## Build Order (Dependency-Driven)

**1. Package contract extension (additive, no behavior change)**
- Add `LockstepInputLogPayload` and `LockstepInputLogEntry` to `socket-contract.ts`
- Add optional `inputLog` field to `RoomJoinedPayload`
- Unit test: contracts compile and are exported via `#rts-engine`

**2. Client InputLog (pure module, testable in isolation)**
- `apps/web/src/lockstep-input-log.ts`: insert by `executeTick`, `dueAt(tick)`, bounded ring
- `tests/web/lockstep-input-log.test.ts`: sorted ordering, boundary correctness

**3. LockstepSimulationRunner (depends on InputLog + RtsRoom)**
- `apps/web/src/lockstep-simulation-runner.ts`: drives `tick()`, applies dueAt events, exposes local room state
- `tests/web/lockstep-simulation-runner.test.ts`: advance N ticks with known events, assert determinism matches `RtsEngine.tickRoom()`

**4. DesyncDetector (depends on LockstepSimulationRunner)**
- `apps/web/src/lockstep-desync-detector.ts`: receive checkpoint, compare hash, emit desync signal
- `tests/web/lockstep-desync-detector.test.ts`: matching hash passes silently; mismatched hash triggers signal

**5. Server-side bounded input log**
- Add ring buffer to `LockstepRuntimeState` accumulating relayed events
- On `build:queued`/`destroy:queued` emission: also append to log
- `tests/integration/server/lockstep-client-sim.test.ts`: server emits events; client simulation runner produces same hash as server checkpoint

**6. ReconnectReplayEngine + server reconnect payload**
- `apps/web/src/lockstep-reconnect-engine.ts`: hydrate from snapshot, replay log, resume
- Server: attach bounded input log to `room:joined` for reconnecting clients
- `tests/integration/server/lockstep-reconnect.test.ts`: disconnect mid-match; reconnect; local state converges

**7. State broadcast suppression**
- Suppress `emitRoomState()` heartbeat when lockstep primary mode active
- Decide and implement `build:outcome`/`destroy:outcome` scoping
- `tests/integration/server/lockstep-client-sim.test.ts`: no full-state broadcast during active lockstep ticks

**8. Client wiring in client.ts**
- Wire `build:queued`/`destroy:queued` to `InputLog` when lockstep active
- Stop applying state-update-on-outcome when local simulation is running
- Preserve non-lockstep fallback path
- Existing integration tests must remain green

---

## Anti-Patterns

### Anti-Pattern 1: Driving Client Tick Loop From Wall Clock Without Server tickMs

**What people do:** Create a `setInterval(() => tick(), 100)` hardcoded in the client.

**Why it is wrong:** Wall-clock drift between server and client means the client's local tick counter diverges from `executeTick` values in relayed events. Events applied at the wrong tick produce different game state and checkpoint mismatch on every comparison.

**Do this instead:** Initialize `LockstepSimulationRunner` with the `tickMs` value from `room:joined`. Start the interval on `room:match-started`. Stop and reset on `room:match-finished` or `room:left`. The interval drives local tick advancement, and `executeTick` from the server is the canonical gate for applying each event.

### Anti-Pattern 2: Embedding Simulation State Directly in client.ts

**What people do:** Add `localRoom`, `inputLog`, and `desyncDetector` as closures inside `client.ts`'s existing socket handler block.

**Why it is wrong:** `client.ts` already requires DOM, canvas, and Socket.IO to instantiate. Mixing simulation logic into it makes the simulation runner impossible to unit test in isolation. `tests/web/` tests run in Node.js without a browser.

**Do this instead:** Implement `LockstepSimulationRunner`, `InputLog`, `DesyncDetector`, and `ReconnectReplayEngine` as standalone, pure-logic modules. Test them in `tests/web/` with synthetic `RtsRoom` instances. Wire them into `client.ts` via simple function calls or constructor injection — `client.ts` stays as the orchestrator, not the simulation host.

### Anti-Pattern 3: Removing build:outcome / destroy:outcome Broadcasts Instead of Suppressing

**What people do:** Delete the `emitBuildOutcomes`/`emitDestroyOutcomes` calls from the server tick loop when enabling lockstep.

**Why it is wrong:** The existing handlers in `client.ts` support the non-lockstep fallback mode (`lockstepMode: 'off'` or after `lockstep:fallback`). Removing the emissions breaks fallback recovery. The `build:outcome` payload carries `resolvedTick` and `eventId` which the desync detector needs for cross-validation.

**Do this instead:** Suppress or scope (to originating client only) rather than remove. When `lockstep:fallback` is received, client reverts to the full-state-broadcast path, and `build:outcome` emissions resume their original role.

### Anti-Pattern 4: Unbounded Server Input Log

**What people do:** Accumulate all `build:queued`/`destroy:queued` events in an unbounded array on the server for the lifetime of the match.

**Why it is wrong:** Matches run for thousands of ticks. An unbounded log grows until the match ends. The log is only needed to cover the reconnect window.

**Do this instead:** Maintain a ring buffer bounded by `Math.ceil(reconnectHoldMs / tickMs) + checkpointIntervalTicks` entries. On reconnect, attach the most recent checkpoint snapshot tick and all events from that tick forward. The `checkpoints[]` array already retained in `lockstepRuntime` provides the anchor.

### Anti-Pattern 5: Testing Client Simulation Only Via Integration Tests

**What people do:** Test `LockstepSimulationRunner` correctness through full server + socket integration tests.

**Why it is wrong:** Determinism bugs in the client simulation are hard to reproduce in integration tests because they depend on exact event ordering and tick timing. Integration tests are also slow to iterate on.

**Do this instead:** Test the simulation runner in `tests/web/` with synthetic `RtsRoom` instances via `RtsEngine.createRoom()`. Advance both a server-side room and a local client room with the same event sequence and assert identical `createDeterminismCheckpoint()` outputs at each tick.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current prototype (2 players) | Input log ring buffer is tiny (reconnectHoldMs=30s, tickMs=100ms = 300 entries max). Full state snapshot on join is acceptable. |
| Larger maps or tick rates | Grid `toPacked()` / `fromPacked()` is already bit-packed; snapshot size is bounded by grid dimensions, not tick count. No changes needed for lockstep. |
| Spectators | Spectators can receive `build:queued`/`destroy:queued` relay events and run local simulation without queue write access. Requires no architecture changes — they just don't call `build:queue`. |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Existing server lockstep infrastructure | HIGH | Direct read of server.ts — turnBuffer, shadowRoom, checkpoints, checkpoint emission all confirmed |
| Existing RtsRoom determinism primitives | HIGH | Direct read of rts.ts — tick(), queueBuildEvent(), createDeterminismCheckpoint() all confirmed suitable |
| socket-contract.ts extensibility | HIGH | Direct read — all existing types confirmed; additions are purely additive |
| Client simulation runner pattern | HIGH | Standard lockstep literature pattern + `#rts-engine` already importable in web confirmed |
| Input log reconnect pattern | MEDIUM | Pattern is well-established; exact buffer sizing needs profiling in implementation |
| State broadcast suppression | HIGH | `emitActiveStateSnapshot` conditional already exists in server.ts tick loop |

---

## Sources

- [Deterministic Lockstep | Gaffer On Games](https://gafferongames.com/post/deterministic_lockstep/) — input delay buffer, acknowledgment pattern, redundant transmission
- [Netcode Architectures Part 1: Lockstep | SnapNet](https://www.snapnet.dev/blog/netcode-architectures-part-1-lockstep/) — bitwise determinism requirement, reconnect via snapshot vs input history
- [Game Networking Demystified, Part III: Lockstep | Ruoyusun](https://ruoyusun.com/2019/04/06/game-networking-3.html) — relay server role, input-only transport, anti-cheat via commitment
- [Deterministic Simulation for Lockstep Multiplayer Engines | Daydreamsoft](https://www.daydreamsoft.com/blog/deterministic-simulation-for-lockstep-multiplayer-engines) — bandwidth benefits, state checksum desync detection
- Direct codebase analysis: `apps/server/src/server.ts` (confirmed LockstepRuntimeState, tick loop, emitActiveStateSnapshot), `packages/rts-engine/rts.ts` (confirmed tick(), queueBuildEvent(), createDeterminismCheckpoint()), `packages/rts-engine/socket-contract.ts` (confirmed all lockstep payload types)

---

_Architecture research for: v0.0.3 Deterministic Lockstep Protocol, Conway RTS TypeScript prototype_
_Researched: 2026-03-29_
