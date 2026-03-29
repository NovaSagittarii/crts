# Phase 13: Client Simulation Foundation - Research

**Researched:** 2026-03-29
**Domain:** Client-side deterministic simulation, lockstep tick synchronization, RtsRoom state reconstruction
**Confidence:** HIGH

## Summary

Phase 13 requires the browser client to initialize and run a local `RtsRoom` simulation that produces identical state to the server on every tick. Today the client is "dumb" -- it receives full `RoomStatePayload` broadcasts from the server and renders them. The goal is for the client to receive the initial state at match start (via `RoomJoinedPayload.state`), reconstruct a live `RtsRoom` instance from that payload, then advance it on every server tick, applying queued build/destroy events as they arrive via `build:queued` / `destroy:queued` socket events. The client simulation must produce the same determinism hash as the server at checkpoint intervals.

The core challenge is **state reconstruction**: `RtsRoom` and `RoomState` are designed to be created by `RtsEngine.createRoomState()` with a `RoomRuntime` attached via `WeakMap`. There is no existing `RtsRoom.fromPayload()` method. The client receives `RoomStatePayload` (serialized `TeamPayload[]`, packed grid `ArrayBuffer`), not a live `RoomState` object. A new factory function must be added to `packages/rts-engine` that reconstructs a fully functional `RtsRoom` from a `RoomStatePayload` plus template list, with proper `RoomRuntime` attachment, sorted `Map` insertion order, and correct `nextTeamId`/`nextBuildEventId` counters. This function is runtime-agnostic and belongs in `packages/rts-engine`, not in `apps/web`.

**Primary recommendation:** Add `RtsRoom.fromPayload(payload, templates)` to `packages/rts-engine/rts.ts` that reconstructs a tickable `RtsRoom` from wire-format data. Build a thin `ClientSimulation` module in `apps/web` that owns the local `RtsRoom`, subscribes to `build:queued`/`destroy:queued` events to replay them locally, ticks on server cadence, and exposes the current state for rendering.

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

| ID | Description | Research Support |
|----|-------------|------------------|
| SIM-01 | Client initializes a local RtsRoom from the server-provided starting state and tick number at match start, then processes ticks identically to the server during active match | `RtsRoom.fromPayload()` factory in rts-engine; `ClientSimulation` module in apps/web that calls `rtsRoom.tick()` per server executeTick |
| SIM-02 | Client tick cadence aligns to the server clock with drift correction so both advance in lockstep | Client tick counter derived from server `lockstep:checkpoint` ticks and `build:queued`/`destroy:queued` `executeTick` values; no local setInterval -- advance happens on server events |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Layer boundaries enforced**: `packages/*` must never import from `apps/*` or use Socket.IO/Express/DOM APIs. The `RtsRoom.fromPayload()` factory belongs in `packages/rts-engine`.
- **Import aliases**: Use `#conway-core` and `#rts-engine` for cross-package imports.
- **Explicit `.js` extensions** in relative imports.
- **Explicit return types** for exported functions.
- **Strict mode; avoid `any`**.
- **Interfaces for object shapes; type aliases for unions**.
- **Runtime payload validation at socket/network boundaries**.
- **Tick order is deterministic and must be preserved** (economy -> builds -> Conway step -> integrity -> defeat).
- **`RtsRoom.fromState` only accepts states created by `RtsEngine.createRoomState` / `RtsEngine.createRoom`** -- the new factory must ensure a valid `RoomRuntime` is attached.
- **Prefer `RtsRoom` instance methods** over static `RtsEngine` room APIs.
- **Socket event payload shapes come from `socket-contract.ts`** -- do not re-declare them.
- **Conventional Commits**.
- **Testing placement**: Deterministic unit tests co-located in `packages/*`; view-model/controller tests in `tests/web/`; integration tests in `tests/integration/server/`.

## Standard Stack

### Core (existing -- no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| packages/rts-engine | in-tree | Deterministic simulation, RtsRoom, tick pipeline | Already canonical; shared between server and client |
| packages/conway-core | in-tree | Grid, Conway B3/S23 step, toPacked/fromPacked | Shared game logic |
| socket.io-client | ^4.8.3 | Existing client transport | Already in devDependencies |
| vitest | ^3.1.1 | Test framework | Already configured |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | -- | -- | No new dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-tree fromPayload | Separate npm package for shared sim | Over-engineering for a two-file prototype |
| Client setInterval tick | Server-event-driven tick | setInterval drifts; contradicts SIM-02 requirement |

**Installation:** No new packages needed. All required code is in-tree.

## Architecture Patterns

### Recommended Project Structure
```
packages/rts-engine/
  rts.ts               # Add RtsRoom.fromPayload() static factory
  rts.test.ts          # Add fromPayload unit tests

apps/web/src/
  client-simulation.ts # NEW: ClientSimulation class - owns local RtsRoom
  client.ts            # Modified: wire ClientSimulation into match lifecycle

tests/web/
  client-simulation.test.ts # NEW: unit tests for ClientSimulation
```

### Pattern 1: RtsRoom.fromPayload() -- State Reconstruction Factory
**What:** A new static method on `RtsRoom` (or `RtsEngine`) that takes a `RoomStatePayload` + `StructureTemplate[]` and reconstructs a fully tickable `RtsRoom` with proper `RoomRuntime` attachment.

**When to use:** Client match initialization; future reconnect replay (Phase 16).

**Why it must live in rts-engine:** The reconstruction logic needs access to `RoomRuntime` internals (`createRoomRuntime`, `defineRoomRuntimeProperties`, `attachRoomRuntime`, `reserveTeamId`, `allocateBuildEventId`). These are private to `packages/rts-engine`. Putting reconstruction in `apps/web` would violate layer boundaries.

**Key implementation details:**
1. Create a new `RoomState` via `RtsEngine.createRoomState()` with the same `id`, `name`, `width`, `height`, `templates`.
2. Restore the Grid from the packed `ArrayBuffer` via `Grid.fromPacked()`.
3. Set `room.tick` and `room.generation` from the payload values.
4. For each `TeamPayload` (sorted by `id`), reconstruct the `TeamState`:
   - Create the team via `addPlayerToRoom()` for the first player, then add remaining players.
   - **Critical:** Override the spawn position with `team.baseTopLeft` from the payload rather than letting `pickSpawnPosition` choose a new one. This means the reconstruction must either (a) build the team manually without calling `addPlayerToRoom`, or (b) add a `baseTopLeft` option to `AddPlayerToRoomOptions`.
   - Reconstruct `structures` Map from `StructurePayload[]`, rehydrating each `Structure` instance.
   - Reconstruct `pendingBuildEvents` from `PendingBuildPayload[]`.
   - Reconstruct `pendingDestroyEvents` from `PendingDestroyPayload[]`.
   - Restore `resources`, `income`, `incomeBreakdown`, `defeated`, `lastIncomeTick`, `buildStats`.
5. Set `RoomRuntime.nextTeamId` to `max(teamId) + 1`.
6. Set `RoomRuntime.nextBuildEventId` to `max(eventId across all pending events) + 1`.
7. **Map insertion order must be canonical** (sorted by key) to match `createShadowRoom` behavior per STATE.md blocker note.

**Example signature:**
```typescript
// In packages/rts-engine/rts.ts
public static fromPayload(
  payload: RoomStatePayload,
  templates: StructureTemplate[],
): RtsRoom;
```

### Pattern 2: ClientSimulation -- Server-Driven Tick Consumer
**What:** A module in `apps/web/src/` that manages the client's local simulation lifecycle.

**When to use:** Active match phase only (status === 'active').

**State machine:**
```
idle -> initialized (on match-start + state snapshot)
initialized -> running (first tick event)
running -> idle (on match-finished or room-left)
```

**Responsibilities:**
1. On `room:match-started` + initial state: create local `RtsRoom` via `RtsRoom.fromPayload()`.
2. On `build:queued` / `destroy:queued` events: replay the queue mutation on the local `RtsRoom` using the same `queueBuildEvent` / `queueDestroyEvent` calls.
3. On server tick signal: call `rtsRoom.tick()` locally. The tick signal currently comes implicitly from `state` broadcasts (each has a `tick` field). In Phase 13, the client should advance its local sim when `lockstep:checkpoint` events arrive (they carry a `tick` field), or infer ticks from the periodic state broadcasts that the server already sends every `activeStateSnapshotIntervalTicks` (default 50 ticks).
4. Expose the current `RoomState` (or a derived payload) for the rendering pipeline.
5. On `lockstep:checkpoint`: compute local `createDeterminismCheckpoint()` and compare with server hash.

**Key decision -- tick cadence (SIM-02):**
The server tick loop runs on `setInterval(tick, tickMs)` where `tickMs` defaults to 100ms. The client currently has no tick loop -- it just renders on `requestAnimationFrame`. For Phase 13, the client should NOT create its own `setInterval`. Instead:
- The server already broadcasts `state` payloads every `activeStateSnapshotIntervalTicks` (50 ticks). Each carries the current `tick` number.
- The server emits `lockstep:checkpoint` events at `checkpointIntervalTicks` intervals (default 50). Each carries a `tick`.
- The client knows `tickMs` from `RoomJoinedPayload.tickMs`.
- **Recommended approach:** After initialization, the client runs a local `setInterval` at `tickMs` cadence to advance the simulation, but uses checkpoint/state tick numbers from the server to detect and correct drift. If the client falls behind, it catches up by ticking multiple times. If ahead, it pauses until the next server signal. This is simpler than pure event-driven ticking and avoids requiring protocol changes.
- **Alternative event-driven approach:** The server could emit a new `tick:advance` event each tick. But this would be a transport change belonging to Phase 14. For Phase 13, the client can safely use its own interval with server checkpoint correction.

**Actually, re-reading the success criteria more carefully:**
> "The client tick counter derives from server-emitted `executeTick` and checkpoint values, not from a local setInterval count."

This explicitly forbids a local setInterval as the primary tick source. The client tick must be **derived from server signals**. So the approach should be:
- Use `lockstep:checkpoint` events (which carry `tick`) as the primary clock source.
- Use `build:queued`/`destroy:queued` `executeTick` fields to know what tick events land on.
- Between checkpoints, advance the local sim to catch up to the checkpoint tick.
- The client does NOT tick ahead of the server's last-known tick.

This means: when a checkpoint arrives at tick N, if the client is at tick M < N, it ticks (N - M) times to catch up.

### Pattern 3: Replay Queued Events Before Ticking
**What:** When `build:queued` or `destroy:queued` arrives, the client must queue the event on its local `RtsRoom` at the right time relative to the tick counter.

**Critical ordering:** The server processes queue requests **before** the tick that executes them. A `build:queued` event with `executeTick: 5` means:
1. Server accepted the queue at some tick <= 5 - delayTicks.
2. The build event sits in `pendingBuildEvents` with `executeTick: 5`.
3. On tick 5, during `applyTeamEconomyAndQueue`, the event is processed.

The client receives `build:queued` asynchronously. The client must:
1. Reconstruct a `BuildEvent` from the `BuildQueuedPayload` fields (`eventId`, `templateId`, `x`, `y`, `transform`, `executeTick`, `teamId`, `playerId`).
2. Insert it into the appropriate team's `pendingBuildEvents` array.
3. Reserve the cost (deduct `resources`) to match server behavior.
4. When the client ticks to `executeTick`, the standard tick pipeline will process it.

**Key concern:** The client may receive `build:queued` events for ticks that are in the past relative to the client's current tick. This can happen if the client ticked ahead before the event arrived. For Phase 13, this should not occur if the client only ticks up to server-confirmed ticks. But it must be handled gracefully -- log a warning and skip, or apply retroactively in the next checkpoint resync.

### Pattern 4: Client-Side Event Rejection Mirroring
**What:** The client simulation must reject events the same way the server does, using the same validation in `queueBuildEvent`/`queueDestroyEvent`.

**Why:** Success criterion 4 says "Client-side event rejection at `executeTick` mirrors server rejection without suppressing server-accepted events."

**Implementation:** Since the client calls the same `RtsRoom.queueBuildEvent()` and `RtsRoom.queueDestroyEvent()` methods (from the shared package), rejection logic is automatically identical. The key is that the client must **not** pre-filter events that the server accepted. If the server sends `build:queued`, the client should attempt to queue it locally. If the local queue rejects it (which would indicate a desync), log a warning but do NOT suppress it -- instead, force-insert it to stay in sync with the server.

**Recommended approach:** For server-confirmed events (`build:queued`), bypass local validation and directly insert into `pendingBuildEvents`. The server has already validated. Local rejection mirroring applies only to **locally-initiated** events (the player's own build/destroy attempts), where the client can show immediate UI feedback before the server confirms.

### Anti-Patterns to Avoid
- **Anti-pattern: Client ticking on requestAnimationFrame.** rAF runs at display refresh rate (60/144Hz), not game tick rate (10Hz at 100ms). Using rAF for simulation ticks would desync immediately.
- **Anti-pattern: Creating RoomState without RoomRuntime.** The WeakMap pattern means a plain object literal will fail `hasRoomRuntime()` checks. All state creation must go through `createRoomState` + runtime attachment.
- **Anti-pattern: Relying on Map insertion order matching spontaneously.** JavaScript Maps iterate in insertion order. If the client inserts teams/structures in a different order than the server, iteration-dependent hashing will produce different results. Always sort by canonical key before insertion.
- **Anti-pattern: Using `addPlayerToRoom` for reconstruction.** This method calls `pickSpawnPosition` which uses randomized layout logic. For reconstruction, base positions must be restored from the payload, not recalculated.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State hashing | Custom client hash | `RtsRoom.createDeterminismCheckpoint()` | Already deterministic; shared code ensures bit-identical hashing |
| Conway step | Client-side grid evolution | `Grid.step()` from conway-core | Must be bit-identical to server |
| Event queue processing | Custom tick pipeline | `RtsRoom.tick()` | The 5-step tick order is already encoded; duplicating it guarantees divergence |
| Grid serialization | Custom pack/unpack | `Grid.fromPacked()` / `Grid.toPacked()` | Bit-packing logic is tricky; shared code is canonical |
| Template reconstruction | Parsing template JSON manually | `StructureTemplate.from()` | Handles all template normalization |

**Key insight:** The entire value of this phase is that the client runs **the exact same code** as the server. Every piece of simulation logic already exists in `packages/rts-engine` and `packages/conway-core`. The only new code needed is (1) a factory to reconstruct `RtsRoom` from a wire payload, (2) a thin orchestrator in the client to wire socket events to the local sim, and (3) tests to prove hash equivalence.

## Common Pitfalls

### Pitfall 1: Wrong-Tick Initialization
**What goes wrong:** Client initializes simulation at tick 0 instead of the tick from the payload.
**Why it happens:** `RtsEngine.createRoomState()` initializes `tick: 0`. If reconstruction doesn't override this, the client starts N ticks behind.
**How to avoid:** `fromPayload()` must set `room.tick = payload.tick` and `room.generation = payload.generation` after creating the room.
**Warning signs:** Determinism hash mismatch on the very first checkpoint.

### Pitfall 2: Map Insertion Order Divergence
**What goes wrong:** Client's `teams` Map or `structures` Map has different insertion order than server, causing hash mismatch.
**Why it happens:** Server inserts teams as players join (time-ordered). Reconstruction inserts from payload (array-ordered). If array order differs from join order, Maps diverge.
**How to avoid:** Sort `TeamPayload[]` by `id` before inserting. Sort `StructurePayload[]` by key before inserting into team's `structures` Map. This matches `createShadowRoom` behavior (STATE.md explicitly warns about this).
**Warning signs:** Hash mismatch that appears only with 2+ teams or 2+ structures.

### Pitfall 3: Missing RoomRuntime Fields
**What goes wrong:** `nextBuildEventId` or `nextTeamId` in `RoomRuntime` is wrong, causing duplicate IDs or skipped IDs.
**Why it happens:** `createRoomRuntime` defaults `nextTeamId: 1` and `nextBuildEventId: 1`. If the room already has teams/events, these counters are wrong.
**How to avoid:** After reconstruction, scan all existing teams for max `teamId` and all pending events for max `eventId`, then set `runtime.nextTeamId = maxTeamId + 1` and `runtime.nextBuildEventId = maxEventId + 1`.
**Warning signs:** Duplicate event IDs when the client queues a new build locally; server rejects with different eventId.

### Pitfall 4: Pending Event Reconstruction Data Loss
**What goes wrong:** `PendingBuildPayload` has fewer fields than `BuildEvent`. Reconstruction loses `reservedCost`, `transform`, or other internal fields.
**Why it happens:** `PendingBuildPayload` is the wire format (UI-facing), while `BuildEvent` is the internal format. The payload omits `reservedCost` (the pre-deducted resource amount).
**How to avoid:** Either (a) extend `PendingBuildPayload` to include `reservedCost` in the wire format, or (b) look up the template's `activationCost` during reconstruction and use it as `reservedCost`. Option (b) is more backwards-compatible. Also, the `transform` field is present in `PendingBuildPayload` so that's fine.
**Warning signs:** Economy hash mismatch after a build event resolves (resources don't match because refund amount was wrong).

### Pitfall 5: lastIncomeTick Not Restored
**What goes wrong:** After reconstruction, `lastIncomeTick` defaults to the reconstruction tick, causing income to be applied twice or skipped.
**Why it happens:** `addPlayerToRoom` sets `lastIncomeTick: room.tick`. If the original `lastIncomeTick` was different (income was applied mid-tick-range), the next economy step produces different resource values.
**How to avoid:** `lastIncomeTick` is NOT currently in `TeamPayload`. It must either (a) be added to the wire payload, or (b) be set to `room.tick` during reconstruction (which is correct if the snapshot is taken immediately after a tick). The server snapshot is created at tick N, and `lastIncomeTick` was just updated to N during that tick's economy step. So setting `lastIncomeTick = payload.tick` during reconstruction is correct for snapshots taken post-tick.
**Warning signs:** Resource count drifts by a small amount after several ticks.

### Pitfall 6: buildStats Not Restored
**What goes wrong:** `buildStats` (queued/applied/rejected counts) are not in `TeamPayload`, so they reset to zero on reconstruction.
**Why it happens:** These are tracking counters, not game-affecting state. But they ARE included in timeline events and may affect hash if they influence any deterministic path.
**How to avoid:** Check whether `buildStats` is included in any hash computation. Looking at the code: `buildStats` is NOT hashed in `hashStructuresSection` or `hashEconomySection`. It's only used for `TeamOutcomeSnapshot` (match outcome). So zeroing it on reconstruction is safe for determinism. But it should be noted.
**Warning signs:** None for hash matching. But match outcome might differ if it uses buildStats for tiebreaking.

## Code Examples

### Reconstructing RtsRoom from Payload
```typescript
// Source: Derived from server createShadowRoom pattern + RtsEngine.createRoomState
public static fromPayload(
  payload: RoomStatePayload,
  templates: StructureTemplate[],
): RtsRoom {
  // 1. Create base room with correct dimensions and templates
  const room = RtsEngine.createRoomState({
    id: payload.roomId,
    name: payload.roomName,
    width: payload.width,
    height: payload.height,
    templates,
  });

  // 2. Restore grid from packed bytes
  const restoredGrid = Grid.fromPacked(payload.grid, payload.width, payload.height);
  room.grid = restoredGrid;

  // 3. Restore tick/generation
  room.tick = payload.tick;
  room.generation = payload.generation;

  // 4. Restore teams in sorted order
  const sortedTeams = [...payload.teams].sort((a, b) => a.id - b.id);
  for (const teamPayload of sortedTeams) {
    // Reconstruct team with correct baseTopLeft, structures, pending events...
    // (detailed implementation in plan)
  }

  // 5. Fix runtime counters
  const runtime = getRoomRuntime(room);
  // ... set nextTeamId, nextBuildEventId

  return RtsRoom.fromState(room);
}
```

### ClientSimulation Lifecycle
```typescript
// Source: Derived from codebase patterns
export class ClientSimulation {
  private rtsRoom: RtsRoom | null = null;
  private currentTick: number = 0;

  initialize(payload: RoomStatePayload, templates: StructureTemplate[]): void {
    this.rtsRoom = RtsRoom.fromPayload(payload, templates);
    this.currentTick = payload.tick;
  }

  applyQueuedBuild(payload: BuildQueuedPayload): void {
    if (!this.rtsRoom) return;
    // Insert build event into local simulation
    this.rtsRoom.queueBuildEvent(payload.playerId, {
      templateId: payload.templateId,
      x: payload.x,
      y: payload.y,
      transform: payload.transform,
      delayTicks: payload.delayTicks,
    });
  }

  advanceToTick(targetTick: number): void {
    if (!this.rtsRoom) return;
    while (this.currentTick < targetTick) {
      this.rtsRoom.tick();
      this.currentTick = this.rtsRoom.state.tick;
    }
  }

  verifyCheckpoint(serverCheckpoint: RoomDeterminismCheckpoint): boolean {
    if (!this.rtsRoom) return false;
    const local = this.rtsRoom.createDeterminismCheckpoint();
    return local.hashHex === serverCheckpoint.hashHex;
  }

  destroy(): void {
    this.rtsRoom = null;
    this.currentTick = 0;
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full state broadcast every tick | Shadow room verification (server-only) | Phase 10-12 (v0.0.2) | Server already has lockstep infrastructure; client just needs to participate |
| Client renders server-sent state | Client runs local sim | Phase 13 (this phase) | Reduces bandwidth; enables client-side prediction in future |

**Current state:** The server already has a complete lockstep infrastructure with shadow rooms, turn buffers, checkpoint hashing, and fallback logic. The client currently ignores all of this and requests full state snapshots. Phase 13 is the client catching up to what the server already supports.

## Open Questions

1. **How should `reservedCost` be reconstructed for pending build events?**
   - What we know: `PendingBuildPayload` does not include `reservedCost`. `BuildEvent` requires it.
   - What's unclear: Whether we should extend the wire payload or compute it from the template.
   - Recommendation: Compute from template `activationCost` at reconstruction time. This is what the server does when creating the event, and the cost cannot change after queuing.

2. **Should `lastIncomeTick` be added to the wire payload?**
   - What we know: It's not in `TeamPayload`. Setting it to `payload.tick` is correct for post-tick snapshots.
   - What's unclear: Whether there are edge cases where the snapshot is NOT taken post-tick.
   - Recommendation: Set to `payload.tick` for now. The server creates state payloads after `tickRoom()` completes, so `lastIncomeTick === tick` is invariant. If edge cases emerge, add it to the payload later.

3. **Should the client sim replace or coexist with the current state-broadcast rendering path?**
   - What we know: Phase 14 will remove full-state broadcasts. Phase 13 should prepare for this.
   - What's unclear: Whether to keep dual-path (sim + broadcast) in Phase 13 for safety.
   - Recommendation: **Dual-path.** The client simulation runs in parallel. The existing state broadcast path continues to work. Rendering reads from the local sim when available, falls back to broadcast state otherwise. This provides a safe rollout path and makes Phase 14 simpler (just stop sending broadcasts).

4. **What is the precise tick signal for the client to advance its simulation?**
   - What we know: Success criteria say "derives from server-emitted `executeTick` and checkpoint values." The server currently emits `lockstep:checkpoint` at every `checkpointIntervalTicks` (default 50) ticks, and full `state` broadcasts every `activeStateSnapshotIntervalTicks` (default 50) ticks.
   - What's unclear: Whether a new per-tick server event is needed, or whether the client can extrapolate.
   - Recommendation: For Phase 13, use the existing `lockstep:checkpoint` as the authoritative tick source. Between checkpoints, use a local timer at `tickMs` cadence, bounded by the last known server tick. The checkpoint corrects any drift. Phase 14 may add a dedicated tick signal, but Phase 13 should work with existing protocol.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.1.1 |
| Config file | `vitest.config.ts` |
| Quick run command | `npm run test:fast` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SIM-01 | RtsRoom.fromPayload reconstructs tickable room from wire payload | unit | `npx vitest run packages/rts-engine/rts.test.ts -t "fromPayload"` | Exists (file), tests needed (Wave 0) |
| SIM-01 | fromPayload produces same hash as source room at same tick | unit | `npx vitest run packages/rts-engine/rts.test.ts -t "fromPayload"` | Exists (file), tests needed (Wave 0) |
| SIM-01 | ClientSimulation initializes from RoomJoinedPayload and ticks | unit | `npx vitest run tests/web/client-simulation.test.ts` | Does not exist (Wave 0) |
| SIM-02 | Client tick counter tracks server checkpoint ticks | unit | `npx vitest run tests/web/client-simulation.test.ts -t "tick cadence"` | Does not exist (Wave 0) |
| SIM-01 | After N ticks + M inputs, client hash matches server hash | integration | `npx vitest run tests/integration/server/lockstep-shadow.test.ts` | Exists (file), new tests needed |
| SIM-01 | Client-side rejection mirrors server rejection | unit | `npx vitest run tests/web/client-simulation.test.ts -t "rejection"` | Does not exist (Wave 0) |

### Sampling Rate
- **Per task commit:** `npm run test:fast`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/web/client-simulation.test.ts` -- covers SIM-01 (client sim lifecycle), SIM-02 (tick cadence)
- [ ] `packages/rts-engine/rts.test.ts` additions -- covers SIM-01 (fromPayload hash equivalence)
- [ ] Framework install: none needed -- vitest is already configured

## Sources

### Primary (HIGH confidence)
- `packages/rts-engine/rts.ts` -- RtsEngine, RtsRoom, RoomState, TeamState, tick pipeline, hash computation
- `packages/rts-engine/room-runtime.ts` -- RoomRuntime WeakMap pattern, createRoomRuntime, attachRoomRuntime
- `packages/rts-engine/socket-contract.ts` -- All wire payload types including BuildQueuedPayload, LockstepCheckpointPayload
- `packages/conway-core/grid.ts` -- Grid.fromPacked, Grid.step, Grid.toPacked
- `apps/server/src/server.ts` -- Server tick loop, createShadowRoom pattern, lockstep runtime state, turn buffer
- `apps/web/src/client.ts` -- Current client state handling, socket event listeners
- `.planning/STATE.md` -- Blocker notes about Map insertion order and fromState WeakMap behavior

### Secondary (MEDIUM confidence)
- `apps/server/src/server-room-broadcast.ts` -- Broadcast patterns, state hashing
- `tests/integration/server/lockstep-shadow.test.ts` -- Existing lockstep test patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies; all code is in-tree and verified
- Architecture: HIGH -- direct code inspection of all relevant modules; patterns derived from existing createShadowRoom
- Pitfalls: HIGH -- identified from actual code paths and explicit STATE.md blocker notes

**Research date:** 2026-03-29
**Valid until:** 2026-04-28 (stable -- in-tree code, no external dependency churn)
