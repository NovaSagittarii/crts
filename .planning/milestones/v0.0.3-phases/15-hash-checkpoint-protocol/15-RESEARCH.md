# Phase 15: Hash Checkpoint Protocol - Research

**Researched:** 2026-03-29
**Domain:** Client-side determinism verification, state resynchronization, lockstep checkpoint protocol
**Confidence:** HIGH

## Summary

Phase 15 completes the lockstep consistency verification loop. The server already broadcasts `lockstep:checkpoint` events containing a determinism hash at configurable intervals, and `ClientSimulation` already has `verifyCheckpoint()` and `advanceToTick()` methods. The client currently logs mismatches and falls back to requesting `state:grid` -- the "Phase 15 will handle resync" TODO comment at line 4067 of `client.ts`. This phase must:

1. Replace the placeholder desync handling with proper resync: on mismatch, request a full state snapshot, reinitialize the ClientSimulation from it, and resume ticking from the correct tick boundary.
2. Ensure the server provides the fallback snapshot only after all buffered turn commands due at or before that tick have been flushed (already documented as a STATE.md concern).
3. Add integration tests proving that a deliberate divergence triggers detection and successful resync within one checkpoint interval.

The existing infrastructure is remarkably complete. The `lockstep:checkpoint` event, `lockstep:fallback` event, `state:request` mechanism, `RtsRoom.fromPayload()`, and `ClientSimulation.initialize()` all exist. The main work is wiring these together correctly in the client checkpoint handler and adding a `reinitialize()` method to `ClientSimulation` (or reusing `destroy()` + `initialize()`), plus adding the server-side guarantee that the snapshot is post-flush.

**Primary recommendation:** Implement client-side desync detection and resync as a thin protocol layer in `client.ts` using existing `ClientSimulation.verifyCheckpoint()` -> `state:request` -> `ClientSimulation.initialize()`, plus add a new integration test using `forceFallbackReason` or direct hash perturbation to prove the resync loop works end-to-end.

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

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-01 | Client computes a determinism hash at checkpoint intervals and compares it with the server-broadcast hash | `ClientSimulation.verifyCheckpoint()` already exists and compares local vs server `hashHex`. The `lockstep:checkpoint` handler in `client.ts` (line 4055) already calls this. Needs: proper desync response instead of console.warn + grid request. |
| SYNC-02 | On hash mismatch the client receives a full state snapshot and resynchronizes its local simulation | Client already has `requestStateSnapshot(true)` and `ClientSimulation.initialize()`. Needs: on mismatch, request full state, re-initialize ClientSimulation from the returned payload, resume ticking from that tick. Server must flush buffered commands before generating the snapshot. |
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

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | (project version) | Test framework | Already used across all test suites |
| socket.io / socket.io-client | (project version) | Transport | Already wired for all event types |
| #rts-engine | local | RtsRoom, RtsEngine, socket-contract types | Domain logic, determinism hashing |
| #conway-core | local | Grid | Grid reconstruction from packed bytes |

### Supporting
No new libraries needed. All required functionality exists in the current codebase.

## Architecture Patterns

### Existing Code Locations (Modify/Extend)

```
apps/web/src/
  client.ts                          # MODIFY: lockstep:checkpoint handler, lockstep:fallback handler, state event handler
  client-simulation.ts               # MODIFY: add reinitialize() or resync-from-payload method

apps/server/src/
  server.ts                          # MODIFY: ensure snapshot is post-flush in state:request during primary mode

tests/
  web/client-simulation.test.ts      # EXTEND: resync/reinitialize tests
  integration/server/                 # ADD: hash-checkpoint-resync.test.ts
```

### Pattern 1: Client Desync Detection and Resync Flow

**What:** When `lockstep:checkpoint` arrives, advance sim to checkpoint tick, verify hash. On mismatch, request full state, reinitialize sim from snapshot.

**When to use:** Every `lockstep:checkpoint` event while `clientSimulation.isActive`.

**Current code (client.ts line 4055-4078):**
```typescript
socket.on('lockstep:checkpoint', (payload: LockstepCheckpointPayload) => {
  if (payload.roomId !== currentRoomId) return;
  if (clientSimulation.isActive) {
    clientSimulation.advanceToTick(payload.tick);
    const match = clientSimulation.verifyCheckpoint(payload);
    if (!match) {
      console.warn(`[lockstep] Desync detected...`);
      // Phase 15 will handle resync; for now just log
      requestStateSections(['grid']);
    }
  } else {
    if (payload.tick % 50 === 0) {
      requestStateSections(['grid']);
    }
  }
});
```

**Target code pattern:**
```typescript
socket.on('lockstep:checkpoint', (payload: LockstepCheckpointPayload) => {
  if (payload.roomId !== currentRoomId) return;
  if (clientSimulation.isActive) {
    clientSimulation.advanceToTick(payload.tick);
    const match = clientSimulation.verifyCheckpoint(payload);
    if (!match) {
      console.warn(
        `[lockstep] Desync detected at tick ${String(payload.tick)}: requesting resync`
      );
      // Request full state snapshot for resync
      requestStateSnapshot(true);
      pendingSimResync = true;
    }
    // In input-only mode with matching hash: no state request needed
  } else {
    if (payload.tick % 50 === 0) {
      requestStateSections(['grid']);
    }
  }
});
```

### Pattern 2: ClientSimulation Resync via Full State

**What:** On receiving a full `state` payload after a desync, reinitialize the ClientSimulation from the payload.

**Current code (client.ts state handler around line 4297-4310):**
```typescript
socket.on('state', (payload: RoomStatePayload) => {
  // ...
  stateHashResyncState = markAwaitingHashesAfterFullState(stateHashResyncState);
  applyStatePayload(payload);
  // Deferred sim initialization for match start
  if (pendingSimInit && currentRoomStatus === 'active' && joinedTemplates) {
    clientSimulation.initialize(payload, joinedTemplates);
    pendingSimInit = false;
  }
});
```

**Target code pattern:**
```typescript
socket.on('state', (payload: RoomStatePayload) => {
  // ...
  stateHashResyncState = markAwaitingHashesAfterFullState(stateHashResyncState);
  applyStatePayload(payload);
  // Deferred sim initialization for match start
  if (pendingSimInit && currentRoomStatus === 'active' && joinedTemplates) {
    clientSimulation.initialize(payload, joinedTemplates);
    pendingSimInit = false;
  }
  // Resync after desync detection
  if (pendingSimResync && currentRoomStatus === 'active' && joinedTemplates) {
    clientSimulation.destroy();
    clientSimulation.initialize(payload, joinedTemplates);
    pendingSimResync = false;
  }
});
```

### Pattern 3: Server Flush Guarantee Before Snapshot

**What:** When the server handles `state:request` during primary lockstep mode, it must ensure all buffered turn-buffer commands due at or before the current tick have been flushed before generating the snapshot payload.

**Context:** The `flushPrimaryTurnCommands(room)` call happens in the tick loop before `room.rtsRoom.tick()`. This means at any given server tick, buffered commands for the *previous* turn have already been flushed into the RtsRoom state. However, if a `state:request` arrives mid-tick (between the `setInterval` tick callback invocations), there may be commands buffered for the current turn that haven't been flushed yet.

**Key insight:** In `primary` mode, `flushPrimaryTurnCommands` flushes commands for `currentTurn - 1`, meaning commands are always one turn behind. The snapshot at any given tick should reflect all commands that were supposed to execute at or before that tick. Since the tick loop already calls flush before tick, the standard `state:request` handler should produce a consistent snapshot. The critical edge case is: what if the client requests state at a tick boundary where commands are still buffered? The safest approach is to call `flushPrimaryTurnCommands` explicitly before generating the snapshot in the `state:request` handler when in primary mode.

### Anti-Patterns to Avoid

- **Requesting only `grid` on desync:** Grid-only resync misses structure/economy state divergence. Always request full state on desync.
- **Not destroying+reinitializing ClientSimulation on resync:** Just updating the visual state without resetting the simulation leaves the local sim in a diverged state. Must fully reinitialize.
- **Trusting the client's tick number after resync:** After resync, the client MUST use the `tick` from the server's `RoomStatePayload`, not any locally tracked tick.
- **Multiple concurrent resync requests:** If two checkpoints detect desync in quick succession, the client should not double-request. Use a `pendingSimResync` flag to gate.
- **Resync during non-active match:** Only attempt resync when `currentRoomStatus === 'active'` and `clientSimulation.isActive`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Determinism hashing | Custom hash function | `RtsRoom.createDeterminismCheckpoint()` / `RtsEngine.createDeterminismCheckpoint()` | Already implements FNV-1a-32, proven deterministic |
| State serialization/deserialization | Custom state marshalling | `RtsRoom.createStatePayload()` / `RtsRoom.fromPayload()` | Handles all structure/team/pending-event reconstruction |
| State request debouncing | Custom timer logic | Existing `requestStateSnapshot(force)` / `requestStateSections()` with `pendingStateRequestTimerId` | Already handles debouncing and consolidation |
| Shadow room for verification | Client-side shadow room | Server-side `lockstep:checkpoint` broadcasts | Server already does shadow/primary hash comparison |

## Common Pitfalls

### Pitfall 1: Race Between Checkpoint and State Response
**What goes wrong:** Client detects desync at tick N, requests full state. Before the state response arrives, another checkpoint at tick N+interval also detects a desync and requests again.
**Why it happens:** Network latency means state response is not instant.
**How to avoid:** Use a `pendingSimResync` boolean flag. Set it on desync detection. Clear it when the state response is processed and sim is reinitialized. While flag is set, skip checkpoint verification.
**Warning signs:** Multiple rapid full-state requests in logs.

### Pitfall 2: Resync Payload Tick vs Client Tick Mismatch
**What goes wrong:** After resync, the client uses its old `currentTick` and misses ticks or double-ticks.
**Why it happens:** The server snapshot's tick may differ from what the client expected.
**How to avoid:** `ClientSimulation.initialize()` already sets `_currentTick = payload.tick`. After reinitializing, the next `advanceToTick()` call from the next checkpoint will advance from the correct baseline.
**Warning signs:** Client tick jumps backward or large forward gaps.

### Pitfall 3: Turn-Buffer Flush Ordering on Snapshot
**What goes wrong:** Server generates snapshot before flushing buffered commands, resulting in a snapshot that doesn't include commands the client already applied.
**Why it happens:** `state:request` handler doesn't call `flushPrimaryTurnCommands` before generating the payload.
**How to avoid:** In the `state:request` handler, when in primary lockstep mode, call `flushPrimaryTurnCommands(room)` before generating the state payload. This is the STATE.md concern: "Fallback state broadcast must be delayed until all turn-buffer commands for ticks at or before the fallback tick have executed."
**Warning signs:** Client resyncs but immediately detects another desync because the snapshot was stale.

### Pitfall 4: Visual State and Simulation State Diverge After Resync
**What goes wrong:** The visual rendering (canvas grid, structure overlays) doesn't update after sim reinitialization.
**Why it happens:** `applyStatePayload()` updates the visual state, but if `clientSimulation.initialize()` is called without the visual update, they diverge.
**How to avoid:** The resync flow should: (1) receive full `state` payload, (2) call `applyStatePayload()` (visual update), (3) call `clientSimulation.destroy()` + `clientSimulation.initialize()` (simulation reset). Since both happen in the same `state` event handler, this is naturally ordered.
**Warning signs:** Canvas shows old state while sim has new state.

### Pitfall 5: ClientSimulation.initialize() Called Without joinedTemplates
**What goes wrong:** After resync, `joinedTemplates` is null, causing initialization failure.
**Why it happens:** Edge case where room is left and rejoined, or templates aren't cached.
**How to avoid:** Guard resync with `joinedTemplates !== null` check (already present in the pattern above).
**Warning signs:** Runtime error on `RtsRoom.fromPayload()`.

## Code Examples

### ClientSimulation reinitialize pattern
```typescript
// In ClientSimulation class (client-simulation.ts)
// Option A: Just use destroy() + initialize()
// This is cleaner than a separate reinitialize() method since
// destroy() already resets all state.

// In client.ts state handler:
if (pendingSimResync && currentRoomStatus === 'active' && joinedTemplates) {
  clientSimulation.destroy();
  clientSimulation.initialize(payload, joinedTemplates);
  pendingSimResync = false;
}
```

### Server-side flush before snapshot (server.ts)
```typescript
// In state:request handler, before generating payload:
socket.on('state:request', (payload?: StateRequestPayload) => {
  // ... existing validation ...
  const sections = normalizeStateRequestSections(payload);
  if (!shouldServeStateRequest(session.id, room, sections)) {
    return;
  }

  // Ensure buffered commands are flushed before generating snapshot
  if (isInputOnlyMode(room) && sections.includes('full')) {
    flushPrimaryTurnCommands(room);
  }

  emitRequestedStateSections(room, socket, sections);
});
```

### Integration test: deliberate desync detection and resync
```typescript
// Pattern for hash-checkpoint-resync.test.ts
const resyncTest = createLockstepTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 40,
    lockstepMode: 'primary',
    lockstepCheckpointIntervalTicks: 5, // Checkpoint every 5 ticks
  },
  {
    roomName: 'Resync Test Room',
    hostSessionId: 'resync-host',
    guestSessionId: 'resync-guest',
  },
  {},
  { clockMode: 'manual' },
);

// Test: inject divergence, observe resync
// The test would need to either:
// 1. Use the existing server testHooks.lockstep.forceFallbackReason
// 2. Modify client simulation state directly to cause hash mismatch
// 3. Use a new client-side test hook for hash perturbation
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full state broadcast every tick | Input-only mode (Phase 14) | Phase 14 | Bandwidth reduction; client sim is authoritative for rendering |
| No desync detection | Console.warn + grid request (Phase 13 placeholder) | Phase 13 | Placeholder that Phase 15 replaces |
| Shadow room server-side verification | Primary mode with client-side verification | Phase 14 | Clients verify their own hashes against server checkpoints |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (project version) |
| Config file | `vitest.config.ts` |
| Quick run command | `npm run test:fast` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-01 | Client computes determinism hash at checkpoint intervals and compares against server hash | unit + integration | `npx vitest run tests/web/client-simulation.test.ts -x` | Partially (checkpoint verification tests exist; resync flow tests needed) |
| SYNC-02 | On mismatch, client receives full state snapshot and resynchronizes | integration | `npx vitest run tests/integration/server/hash-checkpoint-resync.test.ts -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:fast`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/integration/server/hash-checkpoint-resync.test.ts` -- covers SYNC-01 end-to-end and SYNC-02 resync
- [ ] Additional `tests/web/client-simulation.test.ts` cases for resync-from-payload behavior (destroy+reinitialize)

## Open Questions

1. **How to inject a deliberate desync in integration tests?**
   - What we know: Server has `testHooks.lockstep.forceFallbackReason` which can force `hash-mismatch`, but this causes the server-side shadow room to detect mismatch and fall back to legacy mode -- which is not the same as a client-side desync. The success criteria require the *client* to detect the mismatch, not the server.
   - What's unclear: Whether we need a new test hook mechanism for client-side hash perturbation, or if we can test this at the unit level by manually creating a diverged ClientSimulation.
   - Recommendation: For the integration test, use a two-pronged approach: (a) unit test with a fake/perturbed checkpoint hash proves `verifyCheckpoint()` returns false and the client requests resync, (b) integration test uses a connected match and verifies that after a full-state request, the client can reinitialize successfully. The unit test in `client-simulation.test.ts` already has a "verifyCheckpoint returns false when hashes differ" test. The integration test should focus on the end-to-end flow: checkpoint -> mismatch detection -> state request -> state received -> sim reinitialized. One approach: have the test client manually advance its sim by an extra tick (creating real divergence) before the next checkpoint arrives.

2. **Should `ClientSimulation` have an explicit `resync(payload, templates)` method?**
   - What we know: `destroy()` + `initialize()` achieves the same result.
   - What's unclear: Whether a dedicated method improves clarity.
   - Recommendation: Add a `resync(payload: RoomStatePayload, templates: StructureTemplate[]): void` convenience method that calls `destroy()` then `initialize()`. This makes the intent clearer in `client.ts` and is trivially testable.

3. **Should the server proactively send a full state snapshot with `lockstep:fallback` for client-detected desync?**
   - What we know: The `LockstepFallbackPayload` has an optional `checkpoint` field but no full state. Currently on `lockstep:fallback`, the client does `requestStateSnapshot(true)`.
   - What's unclear: Whether a new event/payload variant should bundle the full state with the fallback notification.
   - Recommendation: Keep the current pattern -- client requests state on demand. Adding a new payload would be a protocol change. The existing `state:request` -> `state` flow is sufficient and already debounced.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all referenced files:
  - `apps/web/src/client-simulation.ts` -- ClientSimulation class with verifyCheckpoint(), initialize(), destroy()
  - `apps/web/src/client.ts` -- lockstep:checkpoint handler (line 4055), lockstep:fallback handler (line 4080), state handler (line 4297)
  - `apps/server/src/server.ts` -- emitLockstepCheckpointIfDue(), flushPrimaryTurnCommands(), isInputOnlyMode(), state:request handler
  - `packages/rts-engine/socket-contract.ts` -- LockstepCheckpointPayload, LockstepFallbackPayload, RoomStatePayload
  - `packages/rts-engine/rts.ts` -- RtsRoom.fromPayload(), RtsEngine.createDeterminismCheckpoint()
  - `tests/web/client-simulation.test.ts` -- existing checkpoint verification tests
  - `tests/integration/server/lockstep-primary.test.ts` -- lockstep integration test patterns
  - `tests/integration/server/input-only-transport.test.ts` -- input-only transport test patterns

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` -- blocker about fallback snapshot needing turn-buffer flush first
- `.planning/REQUIREMENTS.md` -- SYNC-01 and SYNC-02 requirement definitions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all required code already exists in the project, no new dependencies
- Architecture: HIGH -- the desync detection path is already partially implemented (placeholder TODO); the resync path uses existing `state:request` -> `state` -> `initialize()` flow
- Pitfalls: HIGH -- identified from direct analysis of tick ordering, turn-buffer flush timing, and race conditions in the existing event handlers

**Research date:** 2026-03-29
**Valid until:** 2026-04-28 (stable -- no external dependency changes expected)
