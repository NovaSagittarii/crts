# Phase 16: Reconnect via Snapshot + Input Replay - Research

**Researched:** 2026-03-29
**Domain:** Socket.IO reconnect protocol, deterministic state reconstruction, input log replay
**Confidence:** HIGH

## Summary

Phase 16 closes the last gap in the v0.0.3 lockstep protocol: reconnecting a disconnected player mid-match without a full state re-broadcast to all clients. The foundational infrastructure is already in place from Phases 13-15:

- **Phase 13** built `ClientSimulation` with `initialize()`, `advanceToTick()`, `applyQueuedBuild()`, `applyQueuedDestroy()`, and `resync()`.
- **Phase 14** added the server-side `InputEventLog` ring buffer that accumulates all confirmed input events (build:queued, destroy:queued payloads) keyed by execution tick and sequence number. The server already discards entries older than `reconnectHoldMs / tickMs` ticks on each tick advance. However, the log's `getEntriesFromTick()` method is **never called** -- the log accumulates data but nobody reads it.
- **Phase 15** implemented `lockstep:checkpoint` verification and the `SYNC-02` resync path (request full state on desync, reinitialize ClientSimulation).

The remaining work is:

1. **Server side**: When a reconnecting player joins an active room (the `joinRoom()` function at line 1764 of `server.ts`), the server must send a post-tick state snapshot (it already does via `room.rtsRoom.createStatePayload()`) **plus** the input log entries from that snapshot's tick forward. This requires a new socket event or piggybacking on the existing `room:joined` payload.

2. **Client side**: On receiving the reconnect data, the client must initialize `ClientSimulation` from the snapshot, then replay the input log entries in sequence order (applying builds/destroys to the local RtsRoom), then advance ticks to catch up to the live tick, and finally resume the normal live tick loop. The resulting state hash must match the server's checkpoint hash.

3. **Integration tests**: Prove the full reconnect-replay-verify cycle works end-to-end.

**Primary recommendation:** Add an `inputLog` field to the `RoomJoinedPayload` (populated only when the room is in input-only mode and the player is reconnecting to an active match). On the client side, add a `replayInputLog()` method to `ClientSimulation` that applies entries in sequence order and advances ticks appropriately. Wire this into the `room:joined` handler when the match is active.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

None -- discuss phase was skipped per user setting.

### Claude's Discretion

All implementation choices are at Claude's discretion. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Deferred Ideas (OUT OF SCOPE)

None.
</user_constraints>

<phase_requirements>

## Phase Requirements

| ID       | Description                                                                                                            | Research Support                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RECON-01 | Disconnected player rejoins mid-match by receiving a state snapshot plus the input log from that snapshot tick forward | Server already sends `RoomStatePayload` in `room:joined`; `InputEventLog.getEntriesFromTick()` exists but is never called. Client already has `ClientSimulation.initialize()` and `applyQueuedBuild()`/`applyQueuedDestroy()`. The gap is: (a) server must include log entries in the reconnect payload, (b) client must replay them in order, (c) client must verify hash after replay. |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Strict TypeScript, no `any`, explicit `.js` extensions in relative imports
- Explicit return types for exported functions
- Interfaces for object shapes; type aliases for unions
- Runtime payload validation at socket/network boundaries
- Socket event payload shapes come from `socket-contract.ts` exclusively
- Keep `npm run lint` passing (ESLint + `typescript-eslint` `recommendedTypeChecked`)
- `packages/*` must never import from `apps/*` or use Socket.IO/DOM APIs
- Prefer `RtsRoom` instance methods over static `RtsEngine` for room-scoped behavior
- Tick order is deterministic and must be preserved
- Conventional Commits
- Integration tests use fixture builders from `tests/integration/server/fixtures.ts` and siblings
- Ephemeral ports (`port: 0`) for tests; teardown: clients first, then server
- Import aliases: `#conway-core`, `#rts-engine`

## Standard Stack

### Core (already in project)

| Library                      | Version           | Purpose                                                  | Why Standard                                 |
| ---------------------------- | ----------------- | -------------------------------------------------------- | -------------------------------------------- |
| vitest                       | (project version) | Test framework                                           | Already used across all test suites          |
| socket.io / socket.io-client | (project version) | Transport                                                | Already wired for all event types            |
| #rts-engine                  | local             | RtsRoom, RtsEngine, InputEventLog, socket-contract types | Domain logic, determinism hashing, input log |
| #conway-core                 | local             | Grid                                                     | Grid reconstruction from packed bytes        |

### Supporting

No new libraries needed. All required functionality exists in the current codebase.

## Architecture Patterns

### Current Reconnect Flow (before Phase 16)

```
Player disconnects
  --> Socket.IO fires 'disconnect' event
  --> Server calls leaveCurrentRoom(socket, session, { preserveHold: true })
  --> For active matches: markSocketDisconnected + scheduleActiveDisconnectExpiry (30s timer)
  --> Player's slot is HELD, not released
  --> Session remains in room.lobby, room.rtsRoom.state.players

Player reconnects (within 30s)
  --> Socket.IO 'connection' event fires
  --> sessionCoordinator.attachSocket() matches by sessionId
  --> getRoomOrNull(session.roomId) finds the active room
  --> joinRoom(socket, session, resumeRoom) is called
  --> Server sends room:joined with FULL current RoomStatePayload
  --> Client initializes ClientSimulation from the snapshot
  --> Client resumes receiving live build:queued / destroy:queued events
  --> BUT: any inputs that occurred between snapshot tick and live tick are LOST
```

**The gap**: Between when the snapshot is taken and when the client starts receiving live events, there may be inputs that were already processed by the server. The snapshot includes their effects in the state (pending events, resources deducted), but the client does not know about them as discrete events. In input-only mode, the client needs to replay the input log to reconstruct the exact same state the server is at.

More precisely: the `joinRoom()` function sends a `RoomStatePayload` at the server's current tick. If the server is at tick 100, the snapshot is at tick 100. But between when the client receives this snapshot and when it starts receiving live `build:queued` events, the server may have advanced to tick 103. The input events for ticks 101-103 are in the `InputEventLog` but were broadcast to the room channel before the reconnecting client rejoined it. The client misses those events.

### Proposed Reconnect Flow (Phase 16)

```
Player reconnects (within 30s)
  --> sessionCoordinator.attachSocket() matches by sessionId
  --> joinRoom(socket, session, resumeRoom) is called
  --> Server creates snapshot: room.rtsRoom.createStatePayload()
  --> Server retrieves input log: room.lockstepRuntime.inputEventLog.getEntriesFromTick(snapshotTick)
  --> Server sends room:joined with snapshot + inputLog entries
  --> Client receives room:joined
  --> Client calls clientSimulation.initialize(payload.state, templates)
  --> Client replays input log entries in sequence order:
      for each entry sorted by (tick, sequence):
        if entry.kind === 'build': clientSimulation.applyQueuedBuild(entry.payload)
        if entry.kind === 'destroy': clientSimulation.applyQueuedDestroy(entry.payload)
      then advance to the tick of each group of inputs before applying the next group
  --> Client verifies hash against server checkpoint
  --> Client resumes live tick loop
```

### Key Design Decision: Where to Include the Input Log

**Option A: Extend `RoomJoinedPayload` with optional `inputLog` field** (Recommended)

```typescript
// In socket-contract.ts
export interface RoomJoinedPayload {
  // ... existing fields ...
  inputLog?: InputLogEntry[]; // Only populated for active-match reconnect in input-only mode
}
```

Advantages:

- Single atomic payload -- client gets everything it needs in one event
- No race conditions between receiving the snapshot and receiving the log
- Minimal new surface area (one optional field)
- Follows existing pattern: `lockstep` field on `RoomJoinedPayload` is already optional

**Option B: New dedicated `reconnect:state` event**

Disadvantages:

- Requires new event type in the contract
- Race condition risk: client might receive live `build:queued` events between `room:joined` and `reconnect:state`
- More complex ordering logic

**Recommendation: Option A.** Add `inputLog?: InputLogEntry[]` to `RoomJoinedPayload`. The server populates it only when `isInputOnlyMode(room)` is true and the player is reconnecting to an active match.

### Key Design Decision: How to Replay the Log on Client

The `InputLogEntry` contains `{ tick, sequence, kind, payload }` where `payload` is `unknown` (at runtime it's `BuildQueuedPayload | DestroyQueuedPayload`). The client must:

1. Sort entries by `(tick, sequence)` -- they should already be in order from `getEntriesFromTick()`, but sorting is a defensive measure.
2. Group entries by tick.
3. For each tick group:
   a. Apply all input events (applyQueuedBuild / applyQueuedDestroy) for that tick.
   b. Advance the simulation to that tick (the inputs are applied BEFORE the tick processes them).
4. After all log entries are replayed, advance to the current server tick.

**Critical detail**: Input events have an `executeTick` field. They are applied to `pendingBuildEvents` / `pendingDestroyEvents` arrays when received, and the tick processing executes them when `room.tick()` reaches their `executeTick`. So the replay order is:

1. Initialize from snapshot at tick T.
2. Apply all log entries (they add to pending arrays, deduct resources, etc.).
3. The snapshot already includes the state at tick T including any pending events that were queued before T.
4. The input log entries are those queued AFTER tick T.
5. Advance to the target tick, which processes the pending events at their respective execution ticks.

Wait -- there is a subtlety. The snapshot is taken at the server's current tick (post-tick state). The input log entries from that tick forward include entries whose `executeTick` is in the future relative to the snapshot tick. These entries need to be applied to the local sim's pending queues BEFORE advancing ticks, so they are processed at the correct tick.

Actually, looking more carefully at the existing code: `getEntriesFromTick(snapshotTick)` returns entries with `entry.tick >= snapshotTick`. The `entry.tick` is the `executeTick` from the payload. But wait -- an entry logged at server tick 50 might have `executeTick = 54` (4-tick build delay). The `InputEventLog.append()` call in `emitBuildQueued` uses `payload.executeTick` as the entry's tick. So `getEntriesFromTick(50)` will return entries whose executeTick >= 50, which includes entries that will fire at ticks 50, 51, 52, etc.

The snapshot at tick 50 includes the state after tick 50 has run. Events with executeTick <= 50 have already been processed (their builds/destroys have been applied to the game state). So we should NOT re-apply those events. We only want events with executeTick > snapshotTick.

**Correction**: Use `getEntriesFromTick(snapshotTick + 1)` to get only entries that have NOT yet been executed. But there's another issue: events whose executeTick has passed but the event was queued after the snapshot was taken (impossible in a synchronized system, but worth considering). In practice, the snapshot is taken at the current server tick, and any events in the log with executeTick <= currentTick have already been processed in the snapshot state. So `getEntriesFromTick(snapshotTick + 1)` is correct for events not yet applied.

Actually, wait. Let me re-examine. The `InputEventLog` stores entries with their `executeTick` as the key tick. But what about events that are still PENDING (executeTick in the future)? Those events are ALREADY included in the snapshot's `pendingBuildEvents` / `pendingDestroyEvents` arrays. So replaying them would cause duplicates.

**The real flow is**:

1. Server snapshot at tick T includes ALL pending events (both executed and pending).
2. The input log has entries from some older tick up to the current tick.
3. After taking the snapshot, the server continues ticking. Between the snapshot and when the client fully catches up, new inputs may arrive.
4. The input log captures ALL inputs including those already reflected in the snapshot.

So the correct approach is: **DO NOT replay inputs that are already in the snapshot**. Only replay inputs that arrived AFTER the snapshot was taken.

But how do we know which inputs arrived after the snapshot? The snapshot is taken at a specific tick, and the input log entries have tick + sequence numbers. All entries with executeTick <= snapshotTick are already reflected in the snapshot state (either executed or pending). Entries with executeTick > snapshotTick might or might not be in the snapshot's pending arrays.

Actually, let me look at this more carefully. The snapshot includes `pendingBuildEvents` which has all events whose `executeTick` is in the future. So if the snapshot is at tick 50, and there's a pending build with executeTick 54, that build IS in `payload.teams[i].pendingBuilds`. If we then replay the input log entry for that same build, we'd add it TWICE to the pending array.

**Resolution**: The input log entries that need replaying are ONLY those that were appended to the log AFTER the snapshot was created. Since the snapshot is created synchronously in `joinRoom()` and the input log is appended to in `emitBuildQueued()` / `emitDestroyQueued()` (which happen during tick processing), we need to be careful.

The simplest correct approach: **Use the snapshot tick as the boundary, but DO NOT include entries already in the snapshot.** Since `InputEventLog` entries use `executeTick` as the tick key, and the snapshot includes all pending events up to the current tick, we should use `getEntriesFromTick(snapshotTick + 1)` BUT also include entries at `snapshotTick` that have a sequence number higher than the last processed sequence.

**Simplest correct approach**: Let the `joinRoom` function:

1. Flush any pending turn buffer commands (like the SYNC-02 state:request handler does).
2. Create the snapshot.
3. Get entries from `getEntriesFromTick(snapshot.tick + 1)` -- these are future-tick events not yet processed.
4. But wait -- pending events with executeTick > snapshot.tick are ALREADY in the snapshot's pending arrays.

**The fundamental insight**: In the current architecture, ALL pending events are included in the snapshot payload. The `createStatePayload()` method serializes `team.pendingBuildEvents` and `team.pendingDestroyEvents`. So ANY event that has been queued (via `build:queued` / `destroy:queued`) but not yet executed IS in the snapshot. The input log is therefore redundant for the snapshot state.

The input log is needed for events that happen AFTER the snapshot is taken, while the server continues ticking and the client is still catching up. Once the client initializes from the snapshot, it starts receiving live `build:queued` events. The gap is: events broadcast between snapshot creation and the client joining the room's Socket.IO channel.

But looking at `joinRoom()`, the client is added to the room channel (`socket.join(roomChannel(...))`) BEFORE the snapshot is created and sent. So the client WILL receive any `build:queued` events broadcast after this point. The race condition is:

1. `socket.join(roomChannel)` -- client joins room channel
2. `room.rtsRoom.createStatePayload()` -- snapshot created
3. `socket.emit('room:joined', ...)` -- sent to reconnecting client
4. Meanwhile, server tick runs and broadcasts `build:queued` to room channel
5. Client receives `room:joined` but also receives `build:queued` from step 4

In step 4-5, the client receives a `build:queued` event BEFORE it has processed `room:joined`. Since `room:joined` resets the client state, any `build:queued` received before processing `room:joined` would be lost (the client processes events in order).

Actually, Socket.IO delivers events in order per socket. So the client would receive:

1. `room:joined` (from `socket.emit`)
2. `build:queued` (from room broadcast, delivered after because it was emitted after)

But there's a subtle issue: `socket.emit('room:joined', ...)` is a targeted emit, while `io.to(roomChannel).emit('build:queued', ...)` is a room broadcast. If a tick runs between the `socket.emit` and the broadcast, the broadcast goes to the room channel which now includes the reconnecting client. So the client would receive the build:queued after room:joined. This is correct.

However, if a tick runs BETWEEN `socket.join()` and `socket.emit('room:joined')`, the client would receive a `build:queued` BEFORE `room:joined`. The client would drop it (different roomId or not yet initialized). This is a lost event.

**The actual solution**: The input log captures events that happened during the match. On reconnect, the server should:

1. Take the snapshot.
2. Include the input log entries from snapshot tick forward.
3. The client replays these, which will include some events that are already in the snapshot's pending arrays. These duplicates must be handled.

Looking at the existing code for `applyQueuedBuild` in `ClientSimulation`, it blindly pushes to `team.pendingBuildEvents`. There's no deduplication for builds. But `applyQueuedDestroy` with `idempotent: true` does skip duplicates.

**Revised simplest approach**: After the client initializes from the snapshot and replays the input log, it advances ticks. The input log entries whose effects are already in the snapshot are redundant -- they would add duplicate pending events. This would cause incorrect behavior (double builds, double resource deductions).

**Correct approach**: The server should ONLY send input log entries that are NOT reflected in the snapshot. Since the snapshot is at tick T and includes all pending events, the server needs to send entries that were appended to the log AFTER the snapshot was created. Since snapshot creation and log appending both happen within the synchronous tick loop, and the snapshot is created in `joinRoom()` (which runs outside the tick loop, in the Socket.IO event handler), we can reliably say:

- The snapshot reflects the state at the last completed tick.
- The input log may contain entries from the current tick that were buffered but not yet executed.

Actually, let me simplify. The server creates the snapshot at its current tick T. The snapshot includes:

- The grid state at tick T
- All pending build/destroy events (executeTick > T)
- All team resources (already deducted for pending events)

The input log contains entries from older ticks (discarded periodically) through the current tick. Entries with executeTick <= T have already been applied to the game state. Entries with executeTick > T are in the snapshot's pending arrays AND in the input log.

So if we send the full input log from tick T+1 onward, we'd be sending events that are ALREADY in the snapshot. The client would double-apply them.

**The real solution is one of**:

**A) Don't send the input log at all for the reconnect snapshot; rely on the snapshot being complete.**

The snapshot already contains the full state including all pending events. The client initializes from it and resumes. Any new events after the snapshot are received live. The only gap is events broadcast to the room channel between `socket.join()` and client processing `room:joined`.

But this doesn't satisfy the success criteria: "The reconnect engine replays the input log against the local RtsRoom in insertion-sorted order and the resulting state hash matches the server checkpoint hash."

**B) Send input log entries that have executeTick > snapshotTick, but have the client handle them as "already pending" events -- i.e., the client should NOT re-apply them to the pending arrays but should just advance ticks.**

This doesn't make sense either.

**C) The correct interpretation**: The snapshot tick is chosen to be a PAST checkpoint, not the current tick. The server sends:

- A snapshot at checkpoint tick C (e.g., tick 50)
- The input log from tick C+1 forward (events that happened between the checkpoint and now)

The client:

1. Initializes from the checkpoint snapshot at tick C
2. Replays input log entries (these are events that the server processed between C and the current tick)
3. Advances ticks from C to the current tick
4. Verifies hash matches

**This is the standard lockstep reconnect pattern.** The checkpoint is a known-good state, and the input log bridges from that checkpoint to the current tick.

Looking at the existing server code, `room.lockstepRuntime.checkpoints` stores checkpoint payloads (hash + tick). The server already sends the latest checkpoint to reconnecting clients (line 1804-1807 in joinRoom).

So the correct architecture is:

1. Server finds the latest checkpoint (or uses the current post-tick state as the snapshot).
2. Server sends the snapshot at that checkpoint tick.
3. Server sends input log entries from checkpoint tick + 1 forward.
4. Client replays and catches up.

But wait -- the server doesn't store historical snapshots at checkpoint ticks. It only stores the checkpoint hashes, not the full state at each checkpoint. And `InputEventLog` entries with `executeTick <= currentTick` may have already been discarded by `discardBefore()`.

**Let me re-examine the discard logic**:

```typescript
const oldestNeededTick = Math.max(
  0,
  room.rtsRoom.state.tick - Math.ceil(reconnectHoldMs / tickMs),
);
room.lockstepRuntime.inputEventLog.discardBefore(oldestNeededTick);
```

With `reconnectHoldMs = 30000` and `tickMs = 40`, that's `30000/40 = 750` ticks retained. The buffer capacity is 2048 entries. So the log retains entries going back 750 ticks (~30 seconds).

**Revised correct architecture**:

The server sends the current post-tick snapshot (tick T). The input log entries with `executeTick > T` are events that have been QUEUED but NOT YET EXECUTED. These are already in the snapshot's pending arrays. So the input log entries from tick T+1 are redundant.

But entries at exactly tick T were just executed this tick. And entries before T are historical.

**Wait -- I need to reconsider the problem statement.** Let me re-read success criteria:

> 1. A player who disconnects mid-match receives a post-tick state snapshot and the server input log from that snapshot tick forward upon reconnecting

This says "from that snapshot tick forward" -- meaning the input log entries from the snapshot tick onward. Since the snapshot is the post-tick state at tick T, "from tick T forward" means entries at tick T and later.

> 2. The reconnect engine replays the input log against the local RtsRoom in insertion-sorted order and the resulting state hash matches the server checkpoint hash

The client replays the input log against the local RtsRoom. The local RtsRoom was initialized from the snapshot. After replay, the hash should match.

> 3. The client resumes the live tick loop from the correct tick after replay completes without a full state re-broadcast

No full state broadcast needed.

**New understanding**: The input log replay purpose is NOT to bridge a gap between an old checkpoint and the current tick. It's to ensure the client has all pending events that the server knows about. The snapshot includes pending events, so there is no gap.

The real purpose is for the case where events are broadcast WHILE the reconnect is happening. Between the snapshot and the client processing it, new events might be broadcast. The input log ensures the client doesn't miss those.

**Final correct architecture (after careful analysis)**:

1. Server takes snapshot at current tick T.
2. Server sends snapshot + input log entries with `executeTick > T` (future pending events not yet executed). BUT these are already in the snapshot pending arrays. So they are redundant for initialization.
3. The real value of the input log is: between the snapshot being sent and the client finishing initialization, the server might process more ticks and generate new events. The input log from the snapshot tick captures those events retroactively.

Actually, I think the simplest and most correct interpretation is:

1. **The snapshot IS the baseline** -- it includes everything up to and including tick T.
2. **The input log from T+1 captures nothing** because no future events have happened yet at the time the snapshot is created (synchronous operation).
3. **After the snapshot is sent**, the server continues ticking. New `build:queued` events are broadcast to the room. The reconnecting client IS in the room channel (joined before the snapshot was created), so it WILL receive these.
4. **The problem**: the client receives `build:queued` events BEFORE it has finished processing `room:joined`. Or more precisely, the events arrive interleaved. But Socket.IO guarantees in-order delivery, so `room:joined` arrives first, then any subsequent broadcasts.

**So what's the actual problem this phase solves?** Looking at it from a timing perspective:

```
Time 0: Client disconnects
Time 1-29s: Server continues ticking, broadcasting events to room (client is not in room channel)
Time 15s: Client reconnects
  --> socket.join(roomChannel) -- client now in room
  --> snapshot at tick T (current tick)
  --> Events from Time 1-15s are LOST for this client (they were broadcast before socket.join)
  --> BUT the snapshot at tick T includes the cumulative effect of all those events
  --> The snapshot is complete and correct
  --> Client initializes from snapshot, resumes
```

The snapshot is always at the CURRENT tick, so it includes all effects of all past events. The input log is useful for a different scenario: if we want to use an OLDER snapshot (e.g., a cached checkpoint) rather than computing a fresh one. But `createStatePayload()` always creates a fresh snapshot of the current state.

**Given the success criteria explicitly require input log replay**, the design should be:

1. Use the current state snapshot as the baseline.
2. Include input log entries from the snapshot tick forward (which will be empty or near-empty at the exact moment of snapshot creation).
3. After the client initializes and starts receiving live events, any events broadcast after `socket.join()` will be received normally.
4. The input log ensures that if there's any gap between the snapshot and live events, the client can fill it.

In practice, the input log will have entries from before the snapshot tick (already applied in the snapshot, not needed) and entries at/after the snapshot tick (may include events that just got buffered in the current turn). The client should only apply entries with executeTick > snapshot tick, or better yet, filter by sequence number against what's already in the pending arrays.

**Simplest correct implementation**:

The server populates `inputLog` with `getEntriesFromTick(snapshotTick + 1)`. In most cases this will be empty or have very few entries (events buffered in the current turn cycle). The client:

1. Initializes from snapshot.
2. For each inputLog entry in sequence order: apply to pending arrays if not already present (check eventId).
3. Hash should match the server checkpoint.

The deduplication check is important: if an event is already in the snapshot's pending arrays, don't add it again. This can be done by checking if `team.pendingBuildEvents.some(e => e.id === payload.eventId)` before applying.

### Proposed Code Changes

#### 1. socket-contract.ts (MODIFY)

Add optional `inputLog` field to `RoomJoinedPayload`:

```typescript
import type { InputLogEntry } from './input-event-log.js';

export interface RoomJoinedPayload {
  // ... existing fields ...
  inputLog?: InputLogEntry[];
}
```

#### 2. server.ts (MODIFY)

In `joinRoom()`, after creating the state payload, retrieve and include the input log:

```typescript
function joinRoom(socket, session, room) {
  // ... existing code ...
  const statePayload = room.rtsRoom.createStatePayload();

  // Include input log for reconnecting players in input-only mode
  let inputLog: InputLogEntry[] | undefined;
  if (isInputOnlyMode(room) && room.status === 'active') {
    inputLog = room.lockstepRuntime.inputEventLog.getEntriesFromTick(
      statePayload.tick + 1,
    );
  }

  socket.emit('room:joined', {
    // ... existing fields ...
    state: statePayload,
    inputLog,
  });
  // ... rest ...
}
```

Note: Flush primary turn commands before creating the snapshot, similar to the `state:request` handler.

#### 3. client-simulation.ts (MODIFY)

Add a `replayInputLog()` method:

```typescript
replayInputLog(entries: InputLogEntry[]): void {
  if (!this.rtsRoom) return;

  // Sort by tick, then sequence for deterministic order
  const sorted = [...entries].sort(
    (a, b) => a.tick - b.tick || a.sequence - b.sequence
  );

  for (const entry of sorted) {
    if (entry.kind === 'build') {
      this.applyQueuedBuild(entry.payload as BuildQueuedPayload);
    } else if (entry.kind === 'destroy') {
      this.applyQueuedDestroy(entry.payload as DestroyQueuedPayload);
    }
  }
}
```

Note: The `InputLogEntry.payload` is typed as `unknown` at the interface level. The server stores the actual `BuildQueuedPayload` / `DestroyQueuedPayload` objects. When serialized over Socket.IO (JSON), they will arrive as plain objects matching those interfaces.

#### 4. client.ts (MODIFY)

In the `room:joined` handler, after initializing the simulation, replay the input log:

```typescript
// Initialize client simulation if match is already active (reconnect / mid-match join)
if (currentRoomStatus === 'active' || payload.state.tick > 0) {
  clientSimulation.initialize(payload.state, joinedTemplates);

  // Replay input log for reconnect catchup (RECON-01)
  if (payload.inputLog && payload.inputLog.length > 0) {
    clientSimulation.replayInputLog(payload.inputLog);
  }

  pendingSimInit = false;
}
```

### Anti-Patterns to Avoid

- **Replaying events already in the snapshot**: If the server sends events with `executeTick <= snapshotTick`, the client would corrupt state by double-applying them. Always use `getEntriesFromTick(snapshotTick + 1)`.
- **Not flushing the turn buffer before snapshot**: If the server has buffered commands that haven't been flushed to the RtsRoom, the snapshot won't include their effects. Always call `flushPrimaryTurnCommands(room)` before `createStatePayload()` for reconnect.
- **Sorting by tick alone**: Events at the same tick need secondary sort by `sequence` for deterministic ordering (matches XPORT-03).
- **Blocking the tick loop during replay**: The replay should happen synchronously during the `room:joined` handler, before the next tick event arrives.

## Don't Hand-Roll

| Problem              | Don't Build                   | Use Instead                                                 | Why                                                                |
| -------------------- | ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| State snapshot       | Custom serialization          | `room.rtsRoom.createStatePayload()`                         | Already handles bit-packed grid, pending events, team state        |
| Input log retrieval  | Manual array iteration        | `InputEventLog.getEntriesFromTick()`                        | Already implements efficient ring buffer scan                      |
| State reconstruction | Manual field-by-field rebuild | `RtsRoom.fromPayload()` via `ClientSimulation.initialize()` | Already handles WeakMap attachment, template map, sorted insertion |
| Determinism hash     | Custom hash function          | `RtsRoom.createDeterminismCheckpoint()`                     | FNV1a-32 already proven across all phases                          |
| Deduplication        | Custom event tracking         | `applyQueuedDestroy` idempotent flag                        | Already handles duplicate destroy events                           |

## Common Pitfalls

### Pitfall 1: Double-Applying Pending Events

**What goes wrong:** Events in the input log with executeTick <= snapshot tick are already reflected in the snapshot's pending arrays. Replaying them adds duplicates, causing double resource deductions and double builds.
**Why it happens:** The snapshot and input log overlap -- the snapshot captures the current state including all queued events.
**How to avoid:** Server uses `getEntriesFromTick(snapshotTick + 1)` to exclude events already in the snapshot. Client-side deduplication by eventId is a defense-in-depth measure.
**Warning signs:** Resources going negative unexpectedly, duplicate structures appearing.

### Pitfall 2: Turn Buffer Not Flushed Before Snapshot

**What goes wrong:** Buffered lockstep commands haven't been flushed to the RtsRoom, so the snapshot misses their effects. The input log includes these events, but when the client replays them, the state diverges.
**Why it happens:** The `flushPrimaryTurnCommands()` call is forgotten in the reconnect path.
**How to avoid:** Call `flushPrimaryTurnCommands(room)` before `createStatePayload()` in the reconnect path, mirroring the `state:request` handler (SYNC-02 pattern).
**Warning signs:** Hash mismatch immediately after reconnect replay.

### Pitfall 3: Race Between room:joined and build:queued

**What goes wrong:** After `socket.join(roomChannel)`, a tick runs and broadcasts `build:queued` to the room. The client receives this before processing `room:joined`, or the client processes it before initializing the simulation.
**Why it happens:** Socket.IO room join is instant, but `room:joined` hasn't been processed yet.
**How to avoid:** Socket.IO guarantees per-socket event ordering for targeted emits (`socket.emit`), but room broadcasts go through a different path. The client should buffer or ignore `build:queued` events when the simulation is not yet initialized (the existing guard `if (clientSimulation.isActive)` already handles this). Events received after initialization are the normal flow.
**Warning signs:** Lost events during the reconnect window.

### Pitfall 4: InputLogEntry.payload Type Safety

**What goes wrong:** `InputLogEntry.payload` is typed as `unknown`. After JSON serialization/deserialization over Socket.IO, the payload arrives as a plain object. The client casts it to `BuildQueuedPayload` or `DestroyQueuedPayload` based on the `kind` field.
**Why it happens:** The `InputEventLog` is a generic data structure in `packages/rts-engine` and doesn't import Socket.IO contract types.
**How to avoid:** Validate or cast based on `kind` field. The existing `applyQueuedBuild` and `applyQueuedDestroy` methods are defensive (check for team existence, etc.).
**Warning signs:** TypeScript lint errors about unsafe `any` usage.

### Pitfall 5: WeakMap Reattachment (from STATE.md)

**What goes wrong:** `RtsRoom.fromPayload()` creates a new `RoomState` object and attaches it to the `roomRuntimeByState` WeakMap via `attachRoomRuntime()`. If the reconstituted state is not properly attached, subsequent `tick()` calls will throw "RoomState must come from RtsEngine.createRoomState".
**Why it happens:** The WeakMap attachment depends on the exact object reference returned by `fromPayload()`.
**How to avoid:** Phase 13 already implemented and tested `RtsRoom.fromPayload()`. The `ClientSimulation.initialize()` method calls it correctly. Verify with existing tests.
**Warning signs:** Error thrown on first `advanceToTick()` after reconnect.

## Code Examples

### Server: Including input log in reconnect payload

```typescript
// Source: apps/server/src/server.ts - joinRoom() function
function joinRoom(
  socket: GameSocket,
  session: PlayerSession,
  room: RuntimeRoom,
): void {
  clearActiveDisconnectExpiry(session.id);

  if (session.roomId && session.roomId !== room.rtsRoom.id) {
    leaveCurrentRoom(socket, session, { emitLeft: true, preserveHold: false });
  }

  void socket.join(roomChannel(room.rtsRoom.id));
  sessionCoordinator.clearHold(session.id);
  room.lobby.join({ sessionId: session.id, displayName: session.name });
  sessionCoordinator.setRoom(session.id, room.rtsRoom.id);

  // RECON-01: flush turn buffer and create snapshot for reconnect
  if (isInputOnlyMode(room) && room.status === 'active') {
    flushPrimaryTurnCommands(room);
  }

  const statePayload = room.rtsRoom.createStatePayload();
  const teamId = room.rtsRoom.state.players.get(session.id)?.teamId ?? null;

  // RECON-01: include input log for reconnect replay
  let inputLog: InputLogEntry[] | undefined;
  if (isInputOnlyMode(room) && room.status === 'active') {
    inputLog = room.lockstepRuntime.inputEventLog.getEntriesFromTick(
      statePayload.tick + 1,
    );
  }

  socket.emit('room:joined', {
    roomId: room.rtsRoom.id,
    roomCode: room.roomCode,
    roomName: room.rtsRoom.name,
    tickMs,
    playerId: session.id,
    playerName: session.name,
    teamId,
    templates: room.rtsRoom.state.templates.map((t) => t.toPayload()),
    state: statePayload,
    stateHashes: createStateHashesPayload(room),
    lockstep: room.lockstep,
    inputLog,
  });

  // ... rest unchanged ...
}
```

### Client: Replaying input log on reconnect

```typescript
// Source: apps/web/src/client-simulation.ts
replayInputLog(entries: InputLogEntry[]): void {
  if (!this.rtsRoom) {
    return;
  }

  const sorted = [...entries].sort(
    (a, b) => a.tick - b.tick || a.sequence - b.sequence,
  );

  for (const entry of sorted) {
    if (entry.kind === 'build') {
      this.applyQueuedBuild(entry.payload as BuildQueuedPayload);
    } else if (entry.kind === 'destroy') {
      this.applyQueuedDestroy(entry.payload as DestroyQueuedPayload);
    }
  }
}
```

### Client: Wiring in room:joined handler

```typescript
// Source: apps/web/src/client.ts - room:joined handler
// Initialize client simulation if match is already active
if (currentRoomStatus === 'active' || payload.state.tick > 0) {
  clientSimulation.initialize(payload.state, joinedTemplates);

  // RECON-01: replay input log for reconnect catchup
  if (payload.inputLog && payload.inputLog.length > 0) {
    clientSimulation.replayInputLog(payload.inputLog);
  }

  pendingSimInit = false;
}
```

### Integration Test: Reconnect with input replay

```typescript
// Source: tests/integration/server/ - reconnect replay test
test('reconnecting player receives snapshot + input log and resumes in sync', async ({
  connectedRoom,
  startLockstepMatch,
  connectClient,
}) => {
  const match = await startLockstepMatch(connectedRoom);

  // Queue a build while both players connected
  match.host.emit('build:queue', buildPayload);
  await waitForEvent(match.host, 'build:queued');

  // Advance several ticks
  await connectedRoom.clock.advanceTicks(10);

  // Guest disconnects
  match.guest.close();

  // Advance more ticks (server continues, guest misses events)
  await connectedRoom.clock.advanceTicks(5);

  // Guest reconnects
  const guest2 = connectClient({ sessionId: 'guest-session' });
  const rejoined = await waitForEvent<RoomJoinedPayload>(guest2, 'room:joined');

  // Verify reconnect payload includes inputLog
  expect(rejoined.state.tick).toBeGreaterThan(0);
  // inputLog may be empty if no events between snapshot and reconnect
  expect(rejoined.inputLog).toBeDefined();

  // Verify hash matches after replay
  // (client-side: initialize + replayInputLog should produce matching hash)
});
```

## State of the Art

| Old Approach                                | Current Approach                    | When Changed      | Impact                                                      |
| ------------------------------------------- | ----------------------------------- | ----------------- | ----------------------------------------------------------- |
| Full state broadcast on every tick          | Input-only relay in lockstep mode   | Phase 14 (v0.0.3) | Reduced bandwidth; requires input log for reconnect         |
| No resync mechanism                         | Hash checkpoint + full state resync | Phase 15 (v0.0.3) | Desync detection and recovery; partial reconnect foundation |
| Reconnect = full state at current tick only | Snapshot + input log replay         | Phase 16 (v0.0.3) | Deterministic reconnect without full re-broadcast           |

## Open Questions

1. **Empty input log edge case**
   - What we know: In most reconnect scenarios within input-only mode, the input log from `snapshotTick + 1` will be empty or have very few entries (events buffered in the current turn cycle).
   - What's unclear: Is there value in the input log when it's typically empty? The snapshot already captures all state.
   - Recommendation: Include the inputLog field regardless (empty array is fine). It handles the edge case where turn-buffered commands exist at snapshot time. It also future-proofs for when snapshots might be taken at a past checkpoint rather than the current tick.

2. **Idempotent build event replay**
   - What we know: `applyQueuedDestroy` has an `idempotent` flag that prevents duplicate insertions. `applyQueuedBuild` does not have deduplication.
   - What's unclear: Can the same build event appear in both the snapshot pending array and the input log?
   - Recommendation: Using `getEntriesFromTick(snapshotTick + 1)` should prevent this. Add an eventId deduplication check in `replayInputLog` as defense-in-depth.

3. **Non-input-only mode reconnect**
   - What we know: The input log is only populated and the `isInputOnlyMode` gate only opens in `primary` lockstep `running` mode. In fallback or legacy mode, full state broadcasts handle reconnect.
   - What's unclear: Should the input log field be included for non-input-only reconnects?
   - Recommendation: Only populate `inputLog` when `isInputOnlyMode(room)`. In other modes, the existing full-state broadcast mechanism handles reconnect correctly.

## Validation Architecture

### Test Framework

| Property           | Value                    |
| ------------------ | ------------------------ |
| Framework          | vitest (project version) |
| Config file        | `vitest.config.ts`       |
| Quick run command  | `npm run test:fast`      |
| Full suite command | `npm test`               |

### Phase Requirements to Test Map

| Req ID   | Behavior                                                             | Test Type   | Automated Command                                                           | File Exists?    |
| -------- | -------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------- | --------------- |
| RECON-01 | Server includes inputLog in room:joined for active-match reconnect   | integration | `npx vitest run tests/integration/server/reconnect-input-replay.test.ts -x` | Wave 0          |
| RECON-01 | ClientSimulation.replayInputLog applies entries in sequence order    | unit (web)  | `npx vitest run tests/web/client-simulation.test.ts -x`                     | Extend existing |
| RECON-01 | After replay, client hash matches server checkpoint hash             | integration | `npx vitest run tests/integration/server/reconnect-input-replay.test.ts -x` | Wave 0          |
| RECON-01 | Client resumes live tick loop after replay without full re-broadcast | integration | `npx vitest run tests/integration/server/reconnect-input-replay.test.ts -x` | Wave 0          |

### Sampling Rate

- **Per task commit:** `npm run test:fast`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/integration/server/reconnect-input-replay.test.ts` -- covers RECON-01 end-to-end reconnect-replay-verify cycle
- [ ] Extend `tests/web/client-simulation.test.ts` -- covers `replayInputLog()` unit behavior

## Sources

### Primary (HIGH confidence)

- Direct codebase analysis of `apps/server/src/server.ts` -- `joinRoom()`, `leaveCurrentRoom()`, tick loop, `InputEventLog` integration
- Direct codebase analysis of `packages/rts-engine/input-event-log.ts` -- `getEntriesFromTick()`, `discardBefore()`, ring buffer semantics
- Direct codebase analysis of `packages/rts-engine/socket-contract.ts` -- `RoomJoinedPayload`, `BuildQueuedPayload`, `DestroyQueuedPayload`
- Direct codebase analysis of `apps/web/src/client-simulation.ts` -- `initialize()`, `applyQueuedBuild()`, `applyQueuedDestroy()`, `resync()`
- Direct codebase analysis of `apps/web/src/client.ts` -- `room:joined` handler, reconnect flow, `lockstep:checkpoint` handler
- Direct codebase analysis of `apps/server/src/lobby-session.ts` -- `LobbySessionCoordinator`, hold system, reconnect scheduling

### Secondary (MEDIUM confidence)

- Phase 14 RESEARCH.md -- InputEventLog design intent, reconnect window calculation
- Phase 15 RESEARCH.md -- Hash checkpoint/resync architecture
- `.planning/STATE.md` -- WeakMap reattachment concern, accumulated decisions

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - no new libraries, all existing infrastructure
- Architecture: HIGH - deeply analyzed existing reconnect flow, input log, and client simulation
- Pitfalls: HIGH - derived from concrete code analysis of race conditions and state overlap
- Integration approach: HIGH - existing test fixture infrastructure (createLockstepTest, manual clock) supports this exactly

**Research date:** 2026-03-29
**Valid until:** 2026-04-28 (stable internal architecture, no external dependencies)
