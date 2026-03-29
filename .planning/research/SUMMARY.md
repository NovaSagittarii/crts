# Research Summary

**Project:** Conway RTS — v0.0.3 Deterministic Lockstep Protocol Migration
**Synthesized:** 2026-03-29
**Confidence:** HIGH across all research domains

---

## Executive Summary

This milestone migrates the Conway RTS prototype from a server-authoritative full-state broadcast protocol to a deterministic lockstep model where clients run the game simulation locally and exchange only inputs. The project already has a complete server-side lockstep infrastructure — turn buffering, shadow-room hash verification, checkpoint events, fallback signaling, and FNV1a-32 hashing — so the migration is strictly a client-side gap closure, not a server redesign. The authoritative engine (`packages/rts-engine`) is already fully deterministic with a documented tick order, runtime-agnostic construction, and all primitives (`tick()`, `queueBuildEvent()`, `createDeterminismCheckpoint()`) needed by a local client simulation.

The recommended approach follows the standard server-authoritative lockstep pattern: the server validates inputs and relays `build:queued`/`destroy:queued` events to all clients; clients apply those events to a local `RtsRoom` clone at the assigned `executeTick` and advance their simulation on the same `tickMs` interval; periodic hash checkpoints catch divergence; and a bounded server-side input log supports reconnect replay. Four new modules are needed in `apps/web/`: `LockstepSimulationRunner`, `InputLog`, `DesyncDetector`, and `ReconnectReplayEngine`. The server requires one targeted change: suppressing the periodic full-state broadcast during active lockstep matches and maintaining a bounded input log for reconnecting clients.

The critical path is `CLIENT-SIM` (client-side deterministic simulation) because every other v0.0.3 feature — input-only transport, hash checkpoints, desync fallback, reconnect replay — depends on clients running the simulation locally. The most dangerous pitfalls are not about engine determinism (already solved) but about snapshot timing, Map insertion order during state reconstruction, tick clock authority, and in-flight input events lost during desync fallback. All identified pitfalls have clear prevention strategies rooted in existing infrastructure.

---

## Key Findings

### From STACK.md

- **Base stack is unchanged.** TypeScript 5.4.5, Socket.IO 4.8.3, Vite 8.0.3, Vitest 4.1.2, Express 4.19.2 require no updates.
- **Two optional native add-ons:** `bufferutil@4.1.0` and `utf-8-validate@6.0.6` (both Socket.IO team maintained, December 2025) reduce WebSocket CPU overhead for binary grid snapshot payloads. Install as `--save-optional`; server degrades gracefully without them.
- **One required dev dependency:** `fast-check@4.6.0` for property-based testing of lockstep invariants. Integrates natively with Vitest 4.x via `fc.test()`. Promoted from optional (v0.0.2) to required — lockstep correctness is only verifiable with invariant testing across random input sequences.
- **No new serialization libraries.** `socket.io-msgpack-parser` (stale, 2022), `@msgpack/msgpack`, `flatbuffers`, and `protobuf` are all explicitly rejected. Socket.IO 4.8.3 native binary framing with `ArrayBuffer` (already used via `Grid.toPacked()`) is sufficient. Mixed binary+JSON payloads work correctly as of the 4.8.1 bug fix.
- **No new lockstep framework.** `netplayjs` and similar libraries would require replacing the existing turn-buffer and shadow-room infrastructure. The project already has more lockstep infrastructure than these libraries provide.
- **No Zod.** Existing manual socket boundary guards are sufficient for the current payload surface area.

New integration points introduced by this milestone:
- `input-log.ts` in `packages/rts-engine/` — pure data structure, no I/O
- 3-4 new event types in `socket-contract.ts` (`lockstep:input-turn`, `lockstep:snapshot`, `lockstep:input-log-replay`)
- Bounded ring buffer in `LockstepRuntimeState` on the server
- Client tick loop in `apps/web/`

### From FEATURES.md

**Table stakes — all P1, must ship for v0.0.3 to be functional:**

| ID | Feature | Status of Dependencies |
|----|---------|----------------------|
| `CLIENT-SIM` | Client-side deterministic simulation | Engine ready; new execution site in `apps/web/` |
| `TICK-ALIGN` | Client tick clock aligned to server turn boundaries | Clock values already in `LockstepStatusPayload` |
| `INPUT-TRANSPORT` | Suppress full-state broadcasts during active lockstep match | One conditional in server tick handler |
| `CLIENT-REJECT` | Client applies `build:outcome`/`destroy:outcome` at `executeTick` | Payloads already carry `executeTick` and `accepted` |
| `HASH-CHECKPOINT` | Client computes and verifies hash at checkpoint turns | `createDeterminismCheckpoint()` already exists |
| `DESYNC-FALLBACK` | Client handles `lockstep:fallback` by requesting state resync | Server already emits `lockstep:fallback` |
| `RECONNECT-SNAPSHOT` | Client reconstitutes `RtsRoom` from `room:joined` snapshot | `RtsRoom.fromState()` already exists |

**Differentiators — P2, add after P1 is validated:**
- `INPUT-ACK` rendering: show "pending until turn N" states using `bufferedTurn`/`scheduledByTurn` already in payloads
- Checkpoint diagnostics overlay for debugging desync
- Shadow mode awareness in client fallback handler

**Anti-features — explicitly out of scope:**
- Client-side prediction/optimistic apply: violates the queue-only authority model
- Rollback netcode: orthogonal architecture, incompatible with queue-based mutations
- P2P lockstep: no benefit over server relay for two-player web game
- Replay/spectator: deferred to v0.0.4+; input log structure will support it

**Critical path dependency:** `CLIENT-SIM` must be built and verified before `INPUT-TRANSPORT`. Suppressing state broadcasts before clients can simulate locally would break rendering entirely.

### From ARCHITECTURE.md

**Four new modules required in `apps/web/src/`:**

| Module | Responsibility |
|--------|---------------|
| `lockstep-simulation-runner.ts` | Owns local `RtsRoom` clone; drives `tick()` at `tickMs`; applies relayed events at `executeTick` |
| `lockstep-input-log.ts` | Ordered buffer of accepted events indexed by `executeTick`; supplies `dueAt(tick)` |
| `lockstep-desync-detector.ts` | Receives `lockstep:checkpoint`; computes local hash; triggers resync signal on mismatch |
| `lockstep-reconnect-engine.ts` | Hydrates local room from snapshot + input log on reconnect; replays to current tick |

**Key architectural constraints:**
- Simulation modules must be standalone pure-logic classes testable in `tests/web/` without DOM or Socket.IO. `client.ts` remains the orchestrator.
- Server tick loop change is targeted: add a lockstep-mode guard to the existing `emitActiveStateSnapshot` conditional. No structural refactoring needed.
- `socket-contract.ts` changes are additive only: `LockstepInputLogPayload`, `LockstepInputLogEntry`, optional `inputLog` field on `RoomJoinedPayload`.
- `packages/rts-engine/rts.ts` and `packages/conway-core/` require zero changes.

**Data flow after migration:**
- Server relays `build:queued`/`destroy:queued` to all clients (including originator)
- Server suppresses periodic `emitRoomState()` heartbeat during active lockstep
- Clients apply events to local `RtsRoom` at `executeTick`; render from local state
- Server sends full state only on: join/reconnect, desync recovery, explicit `state:request`
- Hash checkpoint is the consistency mechanism; fallback to `state:request` to resync is the recovery path

**Dependency-driven build order:**
1. `socket-contract.ts` additive extensions (no behavior change)
2. `InputLog` (pure module, testable in isolation)
3. `LockstepSimulationRunner` (depends on `InputLog` + `RtsRoom`)
4. `DesyncDetector` (depends on `LockstepSimulationRunner`)
5. Server-side bounded input log
6. `ReconnectReplayEngine` + server reconnect payload
7. State broadcast suppression
8. `client.ts` wiring

### From PITFALLS.md

**Top critical pitfalls with prevention strategies:**

1. **Client starts from wrong initial tick** (affects Phase 1 and Phase 4)
   Client must use the `tick` field from `RoomJoinedPayload.state` as its starting point — not wall-clock time. Do not begin local simulation until the canonical snapshot tick is known.

2. **Map insertion-order divergence during state reconstruction** (affects Phase 1 and Phase 4)
   `Map` iteration is insertion-order in JS. The server populates team/structure maps in arrival order; the client reconstructs from JSON. `fromState` must re-insert entries in a canonical sorted order. The existing `createShadowRoom` already sorts by `player.id` — extend this principle to all client-side state restoration.

3. **Tick counter authority** (affects Phase 1 and Phase 2)
   The client timer is for rendering only. The simulation tick counter must always derive from server-emitted `tick` fields (`executeTick`, `lockstep:checkpoint.tick`). Never advance the simulation tick counter from a client-side `setInterval` count.

4. **Fallback drains in-flight buffered commands** (affects Phase 2 and Phase 3)
   When `lockstep:fallback` fires, in-flight commands already in the turn buffer must execute before the server emits the authoritative snapshot. Delay the fallback state broadcast until all buffered commands for ticks at or before the fallback tick have executed.

5. **Reconnect snapshot taken mid-tick** (affects Phase 4)
   Snapshot delivery must occur post-tick only. Add a `snapshotTick` field so the client can verify which tick the snapshot represents. Never deliver a snapshot assembled from partial tick state.

6. **ArrayBuffer Socket.IO serialization** (affects Phase 1)
   Socket.IO JSON-encodes `ArrayBuffer` as `{type: 'Buffer', data: [...]}` if not sent as a binary attachment. Send grid snapshots as Socket.IO binary events. Verify `Grid.toPacked()` round-trip in integration tests.

7. **Unbounded server input log** (affects Phase 2 and Phase 4)
   Ring buffer must be bounded: `Math.ceil(reconnectHoldMs / tickMs) + checkpointIntervalTicks` entries. At defaults (30s hold, 40ms tick, 50-tick checkpoint interval) this is approximately 800 entries — trivially small.

8. **Client-side rejection as blocking authority** (affects Phase 5)
   Client rejection is advisory only. A server-emitted `build:outcome applied` must always render, even if client predicted rejection. Never suppress a server-accepted event based on client-local state.

Additional pitfalls tracked:
- Integer overflow in FNV1a-32 hash if client re-implements hash logic (prevent by always calling `createDeterminismCheckpoint()` from `#rts-engine`)
- Shadow room divergence from primary room due to player insertion order
- `intentId` namespace collision after room restart (scope rejection caches to `(roomId, generation)`)
- No catchup path for missed ticks before the input log is implemented

---

## Implications for Roadmap

The dependency graph from FEATURES.md, the build order from ARCHITECTURE.md, and the pitfall-to-phase mapping from PITFALLS.md converge on a 6-phase structure.

### Phase 1 — Client Simulation Foundation

**Rationale:** `CLIENT-SIM` is the critical path for every other feature. Must be built and verified in isolation before any transport changes. Building simulation logic as standalone modules (not embedded in `client.ts`) enables fast unit testing in `tests/web/`.

**Delivers:**
- `lockstep-input-log.ts` — pure module, fully unit-tested
- `lockstep-simulation-runner.ts` — drives local `RtsRoom.tick()`, applies events at `executeTick`
- `socket-contract.ts` additive extensions (`LockstepInputLogPayload`, `LockstepInputLogEntry`)
- Property-based test confirming local simulation produces identical checkpoint hash as server simulation after N ticks with M random inputs

**Features:** `CLIENT-SIM`, `TICK-ALIGN`

**Pitfalls to prevent:** Client starts from wrong initial tick, Map insertion-order divergence, tick counter authority, integer overflow in hash

**Research flag:** Standard patterns. No additional research needed.

---

### Phase 2 — Input-Only Transport

**Rationale:** Can only ship after Phase 1 confirms client simulation is correct. Suppressing state broadcasts before clients can simulate locally would break all rendering. Transport change is a targeted server modification.

**Delivers:**
- Server suppresses `emitRoomState()` heartbeat during active lockstep match (one conditional)
- Server-side bounded input log ring buffer in `LockstepRuntimeState`
- `build:outcome`/`destroy:outcome` scoped to originating client only in lockstep primary mode (not removed — needed for fallback recovery)
- Integration test confirming no full-state broadcast during active lockstep ticks

**Features:** `INPUT-TRANSPORT`, `CLIENT-REJECT` (basic)

**Pitfalls to prevent:** No catchup path for missed ticks (bounded input log retention), fallback drains in-flight buffered commands

**Research flag:** Standard patterns. Existing `emitActiveStateSnapshot` conditional is the targeted change point.

---

### Phase 3 — Hash Checkpoint Protocol

**Rationale:** Hash checkpoints become the primary consistency mechanism only after input-only transport is active. With full-state broadcast still running (pre-Phase 2), checkpoints are diagnostic. In Phase 3 they become authoritative.

**Delivers:**
- `lockstep-desync-detector.ts` — receives `lockstep:checkpoint`, computes local hash, signals mismatch
- Client handles `lockstep:fallback` → emits `state:request` → resets local simulation from response → re-aligns clock (`DESYNC-FALLBACK`)
- Fallback payload extended to include the tick at which the snapshot is valid
- Fallback state broadcast delayed until all in-flight turn buffer commands execute
- Shadow-vs-primary hash parity test at tick 0

**Features:** `HASH-CHECKPOINT`, `DESYNC-FALLBACK`, shadow mode awareness

**Pitfalls to prevent:** Fallback drains in-flight buffered commands, shadow room diverges from primary at tick 1, persistent hash mismatch with no recovery path

**Research flag:** Consider a targeted review of the fallback-delay implementation against the existing `rejectPendingBufferedCommandsOnFinish` code path to avoid duplicating logic.

---

### Phase 4 — Reconnect via Snapshot + Input Replay

**Rationale:** Reconnect depends on Phase 1 (client simulation must work), Phase 2 (bounded input log must exist), and Phase 3 (snapshot must be taken post-tick at a known tick boundary). All prerequisites satisfied.

**Delivers:**
- `lockstep-reconnect-engine.ts` — hydrates `RtsRoom` from snapshot, replays input log, resumes tick loop
- Server attaches bounded input log to `room:joined` payload for reconnecting clients
- `snapshotTick` field in reconnect payload
- `RtsRoom.fromState()` invocation with canonical sorted Map insertion order
- Integration test: disconnect mid-match, reconnect, local state hash-verifies against server checkpoint

**Features:** `RECONNECT-SNAPSHOT`, `CHECKPOINT-REPLAY`

**Pitfalls to prevent:** Reconnect snapshot taken mid-tick, client starts from wrong initial tick, Map insertion-order divergence, Socket.IO delivery gap (turn buffer replay)

**Research flag:** Verify `RtsRoom.fromState()` behavior with WeakMap runtime reattachment before implementation begins (see integration gotcha in PITFALLS.md).

---

### Phase 5 — Client-Side Event Rejection

**Rationale:** Rejection is the most subtle feature because it adds a second validation authority. Must be built last — it requires Phase 3 (hash checkpoint as consistency mechanism) and Phase 4 (reconnect correctness) to be solid first, since any pre-existing state drift would cause false rejections.

**Delivers:**
- Client applies `build:outcome`/`destroy:outcome` at `executeTick` as cross-validation (not as the primary rendering trigger)
- Client-side rejection is advisory only: server-accepted events always render
- `intentId` rejection cache scoped to `(roomId, generation)` and flushed on `room:match-started`
- `INPUT-ACK` rendering: pending-until-turn UI using `bufferedTurn`/`scheduledByTurn` values

**Features:** `CLIENT-REJECT` (hardened), `INPUT-ACK`

**Pitfalls to prevent:** Client-side rejection diverges from server, `intentId` collision after room restart, client rejection suppressing server-accepted events

**Research flag:** Standard patterns with existing `build:outcome` infrastructure. No additional research needed.

---

### Phase 6 — Integration Hardening + Quality Gate

**Rationale:** Property-based tests and full integration coverage are needed to verify the lockstep contract holds across random input sequences. This phase closes the milestone.

**Delivers:**
- `fast-check` property tests: same inputs + same snapshot produces same final hash (invariant holds over 500+ ticks)
- `ArrayBuffer` round-trip integration test (`Grid.toPacked()` through Socket.IO binary attachment)
- All items from the PITFALLS.md "looks done but isn't" checklist verified green
- All existing non-lockstep integration tests continue passing
- Optional native add-ons (`bufferutil`, `utf-8-validate`) installed and verified on deployment target

**Features:** All P1 features validated end-to-end; P2 features assessed for inclusion

**Pitfalls to prevent:** Silent determinism bugs that only appear after 100+ ticks, ArrayBuffer serialization corruption, checkpoint interval misconfiguration in production

**Research flag:** No additional research needed. Property-based testing patterns with `fast-check` are well-documented.

---

### Feature-to-Phase Matrix

| Feature | Phase | Priority |
|---------|-------|----------|
| `CLIENT-SIM` | 1 | P1 |
| `TICK-ALIGN` | 1 | P1 |
| `INPUT-TRANSPORT` | 2 | P1 |
| `CLIENT-REJECT` (basic) | 2 | P1 |
| `HASH-CHECKPOINT` | 3 | P1 |
| `DESYNC-FALLBACK` | 3 | P1 |
| `RECONNECT-SNAPSHOT` | 4 | P1 |
| `CLIENT-REJECT` (hardened) | 5 | P1 |
| `INPUT-ACK` rendering | 5 | P2 |
| `CHECKPOINT-REPLAY` | 5 | P2 |
| Quality gate and property tests | 6 | P1 |

### Phase Ordering Rationale

- `CLIENT-SIM` first because it is the prerequisite for every other feature.
- `INPUT-TRANSPORT` second because it cannot safely ship without a working client simulation.
- Hash checkpoint third because it becomes authoritative only after full-state broadcasts are suppressed.
- Reconnect fourth because it depends on client simulation correctness, the bounded input log, and post-tick snapshot semantics all being established.
- Client rejection last because false positives from pre-existing state drift would make it impossible to distinguish real bugs from implementation errors.
- Quality gate closes the milestone with property-based confidence rather than just example-based test coverage.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All decisions verified against npm registry (2026-03-29) and Socket.IO official docs. No version uncertainty. |
| Features | HIGH | Feature scope defined in PROJECT.md; server-side infrastructure confirmed by direct codebase inspection. Feature dependencies are explicit. |
| Architecture | HIGH | All component interactions verified against actual source files (`server.ts`, `rts.ts`, `socket-contract.ts`). New module shapes derived from existing patterns. |
| Pitfalls | HIGH | Pitfalls derived from direct codebase audit and authoritative external references (Gaffer on Games, Socket.IO delivery guarantees, MDN Map spec). Each pitfall has a confirmed code location. |

**Overall confidence: HIGH**

### Gaps to Address During Implementation

1. **Bounded input log exact sizing:** The formula is `Math.ceil(reconnectHoldMs / tickMs) + checkpointIntervalTicks`. Exact default values for `reconnectHoldMs` in the server need confirming against `server.ts` constants before Phase 2 implementation.

2. **`RtsRoom.fromState()` WeakMap reattachment:** PITFALLS.md flags that `fromState` must re-attach runtime via `attachRoomRuntime` because snapshot JSON does not carry WeakMap entries. Verify the actual `fromState` implementation before Phase 4 begins.

3. **`build:outcome`/`destroy:outcome` suppression vs. scoping decision:** ARCHITECTURE.md marks this as MEDIUM risk. Phase 2 must make the call. Research indicates scoping to the originating client is safer for fallback recovery (PITFALLS.md Anti-Pattern 3).

4. **Shadow room player-insertion order:** PITFALLS.md Pitfall 9 flags a potential divergence between primary room (arrival-order insertion) and shadow room (sorted insertion). Verify `createTorusSpawnLayout` determinism before Phase 3 work begins.

---

## Research Flags

| Phase | Research Needed | Rationale |
|-------|----------------|-----------|
| Phase 1 | No | Standard lockstep simulation runner pattern; existing engine primitives are sufficient |
| Phase 2 | No | Targeted server change; `emitActiveStateSnapshot` conditional is the entry point |
| Phase 3 | Consider | Fallback-delay implementation should be verified against `rejectPendingBufferedCommandsOnFinish` to avoid logic duplication |
| Phase 4 | No | Reconnect pattern is well-established; verify `fromState` WeakMap behavior at implementation start |
| Phase 5 | No | Client rejection advisory model is clear; `intentId` scoping is straightforward |
| Phase 6 | No | `fast-check` patterns well-documented; closing criteria defined in PITFALLS.md checklist |

---

## Sources (Aggregated)

**HIGH confidence:**
- `apps/server/src/server.ts` — lockstep runtime, turn buffer, fallback, snapshot interval, tick loop (direct codebase analysis)
- `packages/rts-engine/rts.ts` — hash implementation, determinism checkpoint, tick order (direct codebase analysis)
- `packages/rts-engine/socket-contract.ts` — canonical wire protocol (direct codebase analysis)
- `.planning/PROJECT.md` — v0.0.3 feature scope definition
- Socket.IO performance tuning guide: https://socket.io/docs/v4/performance-tuning/
- Socket.IO delivery guarantees: https://socket.io/docs/v4/delivery-guarantees
- Socket.IO 4.8.1 changelog (binary data bug patched): https://socket.io/docs/v4/changelog/4.8.1
- npm registry version checks (2026-03-29): socket.io@4.8.3, fast-check@4.6.0, bufferutil@4.1.0, utf-8-validate@6.0.6
- MDN: Map insertion-order iteration (spec-guaranteed)

**MEDIUM confidence:**
- Gaffer On Games — Deterministic Lockstep: https://gafferongames.com/post/deterministic_lockstep/
- Gaffer On Games — Floating Point Determinism: https://gafferongames.com/post/floating_point_determinism/
- Game Networking Demystified, Part III: Lockstep: https://ruoyusun.com/2019/04/06/game-networking-3.html
- SnapNet: Netcode Architectures Part 1: https://www.snapnet.dev/blog/netcode-architectures-part-1-lockstep/
- ForrestTheWoods: Synchronous RTS Engines and a Tale of Desyncs: https://www.forrestthewoods.com/blog/synchronous_rts_engines_and_a_tale_of_desyncs/
- Factorio Friday Facts #188: Bug, Bug, Desync: https://factorio.com/blog/post/fff-188
- Game Developer Magazine: Minimizing the Pain of Lockstep Multiplayer
- Node.js event loop timers documentation (setInterval drift)

---

_Research completed: 2026-03-29_
_Ready for roadmap: yes_
