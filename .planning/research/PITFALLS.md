# Pitfalls Research

**Domain:** Deterministic lockstep protocol migration — Conway RTS v0.0.3
**Researched:** 2026-03-29
**Confidence:** HIGH

## Context: This Migration's Specific Risk Profile

This milestone migrates an existing server-authoritative full-state broadcast system to a deterministic lockstep model where clients run the simulation locally. The project already has:

- A fully deterministic engine (`packages/rts-engine`) with integer-only arithmetic and fixed tick order
- An FNV1a-32 hash infrastructure (`RtsEngine.createDeterminismCheckpoint`, `createStateHashes`)
- A shadow-room lockstep mode already exercised in tests
- A turn-buffer and `bufferedTurn`/`scheduledByTurn` protocol in the server
- Reconnect hold infrastructure already working

The risk profile is therefore **not** about making the engine deterministic — that is already done. The risks concentrate around: (1) migrating clients to run the simulation without breaking existing behaviors, (2) preserving reconnect semantics under a new transport model, (3) ensuring hash verification becomes the consistency mechanism rather than a diagnostic add-on, and (4) Socket.IO-specific delivery semantics.

## Assumed Phase Structure (for placement guidance)

1. **Phase 1** - Client simulation wiring + engine export surface
2. **Phase 2** - Input-only transport (suppress full-state broadcasts during active match)
3. **Phase 3** - Hash checkpoint protocol as primary consistency mechanism
4. **Phase 4** - Reconnect via snapshot + input replay
5. **Phase 5** - Client-side event rejection
6. **Phase 6** - Integration hardening + quality gate

---

## Critical Pitfalls

### Pitfall 1: Client simulation starts from a different initial state than the server

**What goes wrong:**
The client starts running `Grid.step()` and economy locally, but its initial state snapshot was delivered while the server was mid-tick. After a few ticks, the client and server states diverge silently. Hash mismatches appear immediately at the first checkpoint, but because they appear immediately, developers assume the checkpoint mechanism is broken rather than the snapshot delivery.

**Why it happens:**
The server currently emits `state` events from within the tick loop at arbitrary points — during tick, at intervals, and on reconnect. The client receives a snapshot that captures grid+structures+economy at one tick but the server applies the next tick before the client has processed the snapshot. If `tickMs` is fast (40ms in tests), two ticks can arrive before the client has initialized its local room.

**How to avoid:**
Define a single atomic snapshot moment: the snapshot delivered to a joining client must carry a canonical `tick` and `generation` value, and the client must not begin local simulation until it has received the snapshot for tick N and then waits for the server's "start simulation at tick N+1" signal. The `RoomJoinedPayload.state` already includes `tick` — the client initialization must use that tick, not wall-clock time, as the starting point. Use the existing `lockstep:checkpoint` event as the "simulation is live at tick T" signal.

**Warning signs:**
Hash mismatches on tick 1 or tick 2 after match start; desync on first build event before any simulation steps; client and server state diverge consistently by exactly `N` ticks.

**Phase to address:**
Phase 1 (client simulation wiring) and Phase 4 (reconnect snapshot delivery).

---

### Pitfall 2: JavaScript integer overflow in FNV1a-32 hash produces platform-dependent results

**What goes wrong:**
The existing `RtsEngine` hash uses `Math.imul` and `>>> 0` (unsigned right-shift) to constrain values to 32-bit unsigned integers. If any new client-side hash path omits the `>>> 0` mask or uses standard `*` multiplication instead of `Math.imul`, hash values silently overflow to IEEE-754 doubles and become non-deterministic between V8 versions or JS engine JIT tiers.

**Why it happens:**
JavaScript has no native integer type. `Math.imul` is available but not the default multiplication operator. When porting hash logic from server to client, developers copy the hash formula but miss that `Math.imul` treats its arguments as 32-bit integers while `*` promotes to floating point. The overflow behavior looks correct for small values but diverges once accumulated hash values exceed 2^31.

**How to avoid:**
The engine already uses `Math.imul` in `RtsEngine` hash methods. When clients call `RtsEngine.createDeterminismCheckpoint()` directly (since the engine is a shared package), they use the same hash path — this is safe. The pitfall is if any client code tries to re-implement hashing rather than reuse the package. Enforce: clients MUST call `RtsRoom.createDeterminismCheckpoint()` from `#rts-engine` — no independent hash implementations.

**Warning signs:**
Hash matches on low-tick states but diverges after ~100 ticks; hash diverges only in release/minified builds; hash values larger than `0xffffffff` appearing in logs.

**Phase to address:**
Phase 3 (hash checkpoint protocol).

---

### Pitfall 3: JavaScript `Map` and `Set` iteration order is insertion-order, not sorted — this creates desync when maps are populated in different orders on server vs. client

**What goes wrong:**
The engine uses `Map<number, TeamState>` and `Map<string, Structure>` extensively. The server populates these maps in a specific order during `createRoom` and `addPlayer`. The client reconstructs these maps from a snapshot payload (which uses JSON/arrays). If the client re-inserts entries in a different order — for example, iterating teams alphabetically by name vs. by insertion — iteration-dependent operations produce different results.

**Why it happens:**
`Map` in JavaScript/V8 guarantees insertion-order iteration (HIGH confidence — verified by MDN spec). However, when reconstructing state from a JSON snapshot on the client, the order of iteration over `Object.entries()` or array deserialization may differ from the original insertion order on the server. The engine's `teams.values()` is called in tick processing — if two clients iterate teams in different orders, outcomes depending on iteration order (e.g., economy processing, integrity checks) will diverge.

**How to avoid:**
Verify that `RtsEngine.fromState` (or equivalent snapshot reconstruction) repopulates `Map` keys in a canonical, sorted order — not in JSON parse order. The server already sorts teams by `team.id` in `createShadowRoom` when reconstructing for the shadow room. Extend this principle to all client-side state restoration. Add a unit test that asserts `RtsRoom` produces identical hash after reconstructing from snapshot regardless of JSON field order.

**Warning signs:**
Hash matches on rooms with one team but diverges with two teams; desyncs that only appear when players join in different orders; economy or defeat resolution order disagreements.

**Phase to address:**
Phase 1 (engine export and client simulation wiring) and Phase 4 (reconnect snapshot restoration).

---

### Pitfall 4: Server suppresses full-state broadcasts but clients have no catchup path for missed ticks

**What goes wrong:**
In Phase 2, the server stops broadcasting full state every tick. A client that lags one tick — or whose socket delivery is delayed by a few milliseconds — misses the inputs for ticks it should have processed. Its local simulation now leads or lags the authoritative tick count. The client has no way to recover without a full snapshot, but the server is no longer sending snapshots on every tick.

**Why it happens:**
The existing `emitActiveStateSnapshot` fires every 50 ticks by default as a periodic reconciliation. In full-state mode this is a resync heartbeat. In lockstep mode, it becomes the only recovery mechanism. If the client misses inputs that span more than 50 ticks, its simulation is now 50+ ticks behind. In 40ms-per-tick matches, that is 2 seconds of irrecoverable drift.

**How to avoid:**
Maintain a server-side input log (turn buffer with a retention window) so that a slightly-behind client can request the inputs it missed and fast-forward. The `turnBuffer: Map<number, BufferedLockstepCommand[]>` in `LockstepRuntimeState` already buffers commands per turn — extend its retention to cover the snapshot interval. A client that receives a hash checkpoint mismatch should be able to request a resync snapshot, which the server delivers and the client uses to reset its local state.

**Warning signs:**
Client falls progressively further behind the server tick counter with no recovery; hash mismatches that grow in magnitude over time; `lockstep:fallback` emitted without triggering client state reset.

**Phase to address:**
Phase 2 (transport suppression) and Phase 4 (reconnect/catchup path).

---

### Pitfall 5: `setInterval` drift causes server tick counter to diverge from wall-clock expectations — clients using `performance.now()` for their simulation loop drift independently

**What goes wrong:**
The server runs its tick loop via `setInterval` (injected as `setIntervalHook`). Node.js `setInterval` fires as early as possible after the delay, but OS scheduling and event loop saturation cause cumulative drift of 1–5ms per tick. Over a 10-minute match at 40ms tick rate (~15,000 ticks), accumulated drift can reach several seconds. A client using `requestAnimationFrame` or its own `setTimeout` loop runs on a different clock. The two diverge in tick counter at the same wall-clock time.

**Why it happens:**
Lockstep requires all simulation participants to agree on which tick corresponds to which wall-clock moment. In the current server-authoritative model, only the server counts ticks — clients render whatever tick they receive. Once clients simulate locally, they need their own tick counter, and that counter must stay phase-aligned with the server's counter.

**How to avoid:**
The server is the authoritative tick clock. Clients must not maintain an independent tick counter driven by their own timer. Instead: the server includes the current `tick` in every message that triggers a simulation step (already present in `BuildQueuedPayload.executeTick`, `LockstepCheckpointPayload.tick`). Clients advance their simulation to the tick indicated by the server-emitted event, not by counting elapsed frames. The client timer is for rendering only — never for advancing the simulation tick counter.

**Warning signs:**
Client and server tick counters agree at match start but diverge after 5+ minutes; `executeTick` values in queued events appear to be in the past from the client's perspective; build events applied one tick early or late.

**Phase to address:**
Phase 1 (client simulation design) and Phase 2 (transport).

---

### Pitfall 6: Input event ordering is preserved by Socket.IO within a connection but NOT across reconnect

**What goes wrong:**
Socket.IO guarantees in-order delivery within a TCP connection (HIGH confidence — verified by Socket.IO docs). However, if a client disconnects and reconnects, any events emitted by the server between the disconnect and reconnect are lost — Socket.IO has no server-side buffer for disconnected clients by default. The client rejoins at tick T, but ticks N..T-1 are missing. Any build/destroy events the server broadcast during that window are never delivered to the reconnecting client.

**Why it happens:**
The server currently uses `io.to(roomChannel).emit(...)` which broadcasts to all currently-connected sockets. Disconnected sockets receive nothing. The client reconnects and receives the next periodic state snapshot (every 50 ticks), but that snapshot does not include the inputs from the missed window.

**How to avoid:**
On reconnect, send the reconnecting client a state snapshot (current `RtsRoom` state) AND the buffered input events from the turn buffer for ticks after the snapshot tick. The client restores from snapshot, then replays buffered inputs to reach the current tick. This is the `Reconnect via state snapshot + input replay` requirement in the project spec. The `activeStateSnapshotIntervalTicks` setting in the server defines how stale the snapshot can be — the turn buffer must retain at least that many ticks of inputs.

**Warning signs:**
Reconnecting client shows stale structure positions that get corrected only at the next 50-tick snapshot; build events placed before disconnect are not visible after reconnect; reconnecting client's hash diverges immediately from the checkpoint emitted after reconnect.

**Phase to address:**
Phase 4 (reconnect via snapshot + input replay).

---

### Pitfall 7: Client-side event rejection diverges from server-side rejection due to stale state

**What goes wrong:**
The client runs event rejection locally (Phase 5 requirement). A client rejects a build event at tick T+5 because the territory is no longer valid. But the server, which processed the same event at tick T+5 with the same simulation state, accepts it. Now the client thinks the build was rejected while the server broadcast `build:outcome` with `applied`. The two states diverge.

**Why it happens:**
Client-side rejection requires the client's local simulation to be bit-identical to the server's simulation at the tick when the event executes. Any drift in the local state (from Pitfall 1, 3, or 5) means the rejection decision is made against a different state, producing different outcomes. Unlike server-authoritative rejection (where the server is always right), client-side rejection adds a second authority whose correctness depends on perfect state parity.

**How to avoid:**
Client-side rejection must be treated as a display optimization only — a "fast reject" that prevents the client from rendering a queued build that is clearly invalid. The server remains authoritative. When the server broadcasts `build:queue-rejected` or `build:outcome`, the client must update its local state to match. Client-side rejection must never cause the client to suppress a server-broadcast `build:outcome applied` — it may only suppress display of events the client expects to be rejected. Any divergence detected via checkpoint hash must trigger a state resync before client-side rejection is re-enabled.

**Warning signs:**
Client UI shows a build as rejected while server shows it applied; client's pending queue diverges from server's pending queue after a hash mismatch; client-side rejection fires on events that later appear in server `build:outcome applied` broadcasts.

**Phase to address:**
Phase 5 (client-side event rejection), with prerequisite from Phase 3 (hash consistency as primary mechanism).

---

### Pitfall 8: Hash checkpoint reveals desync but fallback to full-state broadcast loses in-flight inputs

**What goes wrong:**
The server detects a hash mismatch and emits `lockstep:fallback`. The server then resumes full-state broadcast. But there are already 3–5 build/destroy events in the `turnBuffer` that were broadcast to clients while lockstep was `primary`. The client, on receiving `lockstep:fallback`, resets to the next state broadcast — but that state broadcast was computed before those in-flight events executed. The events execute on the server at their `executeTick` but the client never reapplies them, creating a permanent divergence.

**Why it happens:**
The fallback path transitions transport mode but does not drain or replay the buffered turn commands relative to the new snapshot. The `rejectPendingBufferedCommandsOnFinish` function handles match finish, but fallback is a different code path.

**How to avoid:**
When emitting `lockstep:fallback`, the server must either: (a) include the pending buffered commands in the fallback payload so clients can reapply them, or (b) delay the fallback state broadcast until after all buffered commands have executed, so the snapshot captures a post-execution state. Option (b) is simpler and avoids client-side replay complexity. The `lastFallbackReason` and checkpoint fields in `LockstepFallbackPayload` already carry context — extend the payload to include the tick at which the snapshot will be valid.

**Warning signs:**
Post-fallback state shows missing structures that were queued before fallback; `build:outcome` broadcasts arrive but the structure never appears in the subsequent `state` broadcast; players report structures "disappearing" after a desync.

**Phase to address:**
Phase 3 (hash checkpoint protocol) and Phase 2 (transport suppression/restore).

---

### Pitfall 9: Shadow room diverges from primary room due to player-ordering differences during construction

**What goes wrong:**
`createShadowRoom` reconstructs an `RtsRoom` by sorting players by `playerId` string order. The primary room adds players in arrival order. If the engine's initial state depends on player-insertion order (e.g., spawn position assignment, team territory seeding), the shadow room starts with different initial conditions and diverges from the primary room immediately. The shadow hash will never match the primary hash, causing permanent `hash-mismatch` fallbacks.

**Why it happens:**
`createShadowRoom` sorts players by `player.id.localeCompare(right.id)` to ensure reproducibility. But spawn positions in the primary room were assigned in arrival order. If two players produce different spawn layouts depending on insertion order, the shadow room will always have a different grid.

**How to avoid:**
Verify that `RtsEngine.createRoom` + `addPlayer` produces a deterministic initial grid regardless of `addPlayer` call order for a given set of players. The `spawnOrientationSeed` is already deterministic (derived from room id). Check `createTorusSpawnLayout` to confirm spawn positions are determined by `teamId` (which is sorted) not `addPlayer` call order. If spawn depends on insertion order, fix it to depend on `teamId` sort order instead.

**Warning signs:**
Shadow mode shows immediate hash mismatches on tick 1; `lastPrimaryHash` and `lastShadowHash` are never equal in logs; shadow fallback triggered at match start before any input has been processed.

**Phase to address:**
Phase 3 (hash checkpoint as primary mechanism) — the shadow room test coverage already exercises this, but the invariant must be explicitly asserted.

---

### Pitfall 10: Reconnect snapshot sent while server is mid-tick creates a partially-applied state

**What goes wrong:**
The server emits a reconnect snapshot during the tick loop, after `tick()` has been called but before outcomes are broadcast. The snapshot captures grid state after Conway step but economy before distribution, or structures after one team's builds but before another team's. The client restores from this snapshot, applies the same inputs, and reaches a different state than if it had received the pre-tick or post-tick snapshot cleanly.

**Why it happens:**
The current tick loop calls `room.rtsRoom.tick()` and then individually broadcasts outcomes, checkpoints, and periodic snapshots. A reconnect joining during this sequence receives whatever partial state exists at that moment. The `RoomStatePayload` is not an atomic snapshot — it is assembled from separate `createStatePayload()` calls.

**How to avoid:**
Establish a clear "snapshot point" in the tick loop: the state snapshot used for reconnect must always be taken either before `tick()` or after all tick processing and outcome broadcasts are complete. The existing `DEFAULT_ACTIVE_STATE_SNAPSHOT_INTERVAL_TICKS` interval fires post-tick — validate that the reconnect snapshot path in `emitRoomStateToSocket` is also called post-tick and never mid-tick. Add a `snapshotTick` field to the reconnect payload so the client knows exactly which tick the snapshot represents.

**Warning signs:**
Client restores from snapshot but economy values are inconsistent (e.g., team A has spent resources that are not reflected in team B's territory cells); structures present in snapshot do not match structures that the tick's `build:outcome applied` events indicate were applied.

**Phase to address:**
Phase 4 (reconnect via snapshot + input replay).

---

### Pitfall 11: The `intentId` / `eventId` namespace is server-local but clients need it for deduplication

**What goes wrong:**
`intentId` is allocated by the server (`allocateIntentId`) and is scoped to the server's session. Clients use `intentId` to correlate a queued command with its outcome. If a client reconnects and the server's `nextIntentId` counter continues from where it left off, the client may receive `intentId` values that collide with ones it saw before disconnect. The client's deduplication / rejection logic fires incorrectly.

**Why it happens:**
`nextIntentId` is incremented per room, per session, per command. After reconnect, the server issues new `intentId` values for new commands, but those values may numerically overlap with old ones if the counter resets (e.g., room restart) or if the client's local rejection cache is keyed on `intentId` alone.

**How to avoid:**
Client-side rejection caches must key on `(roomId, intentId)` pairs, not `intentId` alone. On room restart (status transitions to `active` after `finished`), the client must flush all cached rejection state. The `generation` field already exists in `RoomStateHashes` and `RoomDeterminismCheckpoint` — use it as a generation marker to scope intent caches.

**Warning signs:**
Client rejects a new build command because its `intentId` matches a previously-rejected one from an earlier match in the same room; spurious rejection UI appears after room restart; `build:outcome applied` arrives but client still shows `rejected`.

**Phase to address:**
Phase 5 (client-side event rejection).

---

## Technical Debt Patterns

| Shortcut                                                                                     | Immediate Benefit                        | Long-term Cost                                                   | When Acceptable                             |
| -------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| Client drives simulation tick counter from its own `requestAnimationFrame` loop              | Simple rendering integration             | Tick counter drifts from server; executeTick comparisons break   | Never                                       |
| Client re-implements hash logic instead of calling `#rts-engine`                             | Avoids package import in browser context | Hash diverges from server in production builds; integer overflow | Never                                       |
| Fallback to full-state broadcast permanently (no primary mode recovery)                      | Simplifies transport                     | Locks out bandwidth savings; reconnect stays expensive           | Only as first milestone step; must not ship |
| Skip the snapshotTick field in reconnect payload                                             | Fewer payload changes                    | Client cannot verify which tick the snapshot was taken at        | Never                                       |
| Client-side rejection as blocking authority (prevents server-accepted events from rendering) | Snappy UX for invalid inputs             | Permanent divergence when client state lags server               | Never                                       |
| Use turn buffer without retention window (discard old turns immediately)                     | Lower memory footprint                   | Reconnecting clients cannot replay missed ticks                  | Never                                       |

---

## Integration Gotchas

| Integration                                        | Common Mistake                                                                  | Correct Approach                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#rts-engine` in browser                           | Assuming tree-shaking removes Node.js-only code                                 | Audit package for `process.env`, `fs`, `crypto` — none should be present in `packages/rts-engine`; it is already runtime-agnostic per CLAUDE.md                              |
| `RtsRoom.fromState` on client                      | Calling with a snapshot that includes `WeakMap`-backed runtime metadata         | `fromState` must re-attach runtime via `attachRoomRuntime`; the snapshot JSON does not carry `WeakMap` entries — reconstruct runtime explicitly                              |
| `Grid.toPacked()` round-trip                       | Sending packed grid as `ArrayBuffer` through Socket.IO JSON serialization       | Socket.IO JSON-encodes `ArrayBuffer` as an object `{type: 'Buffer', data: [...]}` — use base64 or send as Socket.IO binary attachment; verify round-trip in integration test |
| Lockstep checkpoint interval vs. snapshot interval | Setting checkpoint interval to 1 (every tick) in production                     | At 40ms/tick this is 25 hash broadcasts per second; keep default 50-tick interval for production, 1 for tests only                                                           |
| Socket.IO delivery on disconnect                   | Expecting server-buffered events to reach reconnecting client                   | Socket.IO has no server-side event buffer for disconnected clients — all missed events must be replayed from the server's turn buffer on reconnect                           |
| `build:queued` broadcast and lockstep mode         | Broadcasting `build:queued` immediately in primary mode then also in turn-flush | The existing code already handles this — do not add a second broadcast path during client simulation wiring                                                                  |

---

## Performance Traps

| Trap                                                                                        | Symptoms                                               | Prevention                                                                                                                          | When It Breaks                                                                                       |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Running full `RtsEngine.createDeterminismCheckpoint()` every tick on both client and server | CPU spike in JS main thread; dropped frames on client  | Keep checkpoint interval at 50 ticks (default) for production; checkpoint is O(grid_cells)                                          | At 52x52 grid (2,704 cells), every-tick hashing at 40ms = ~67 hashes/sec; acceptable but unnecessary |
| `Grid.toPacked()` called during reconnect snapshot assembly while tick is in progress       | Partial grid state encoded; snapshot inconsistency     | Assemble snapshot once per tick in post-tick phase only; use `grid.clone()` if snapshot must be async                               | Any reconnect while tick is executing                                                                |
| Client rendering calling `grid.cells()` iterator on every animation frame                   | GC pressure from repeated iterator allocation at 60fps | Cache `grid.toUnpacked()` as `Uint8Array` for renderer; only update after each new tick, not each frame                             | Mid-game with large grids; noticeable on mobile                                                      |
| Turn buffer growing unbounded if `lastFlushedTurn` never advances (primary mode stalled)    | Server memory grows proportionally to match duration   | Cap turn buffer at `maxBufferedCommands` (already implemented); add assertion that buffer never exceeds twice the snapshot interval | Long matches with high command frequency                                                             |

---

## Security Mistakes

| Mistake                                                        | Risk                                                                                          | Prevention                                                                                                                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusting client-reported tick in input events                  | Client advances its simulation faster to gain economic advantage                              | Server ignores client-reported tick; uses server-authoritative `room.rtsRoom.state.tick` for all `executeTick` assignments                                       |
| Trusting client hash in checkpoint response                    | Client spoofs a matching hash to suppress desync detection                                    | Server computes its own hash independently via `createDeterminismCheckpoint()`; client hash is never used as the canonical value                                 |
| Accepting `state:request` at tick rate from misbehaving client | State request spam forces expensive snapshot assembly on every tick                           | The existing `STATE_REQUEST_MIN_INTERVAL_MS = 100` budget guard already prevents this — verify it is not bypassed by reconnect path                              |
| Reconnect snapshot contains opponent's hidden state            | Spectator or reconnecting player receives state that reveals information they should not have | Current design shares full state with all room participants — fog-of-war is out of scope; document this explicitly so future fog-of-war work knows to address it |

---

## UX Pitfalls

| Pitfall                                                                                | User Impact                                                                | Better Approach                                                                                           |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Client shows "pending" build animation for ticks before server confirms `build:queued` | Phantom builds appear and disappear; user confused                         | Show pending state only after `build:queued` is received; do not speculate on local acceptance            |
| Hash mismatch triggers fallback but no UI feedback                                     | User sees stutter or structure state change with no explanation            | Show subtle "re-syncing" indicator on `lockstep:fallback`; clear it when next checkpoint matches          |
| Reconnect restores from snapshot but tick counter jumps forward                        | Build placements appear to teleport; economy numbers jump                  | Animate or fade state on reconnect resync; suppress mid-animation user inputs during snapshot restoration |
| Client-side rejection fires before `build:queue-rejected` arrives                      | Double rejection feedback (local "invalid" flash + server rejection toast) | Route all rejection feedback through server response; local validation is silent (no UI)                  |

---

## "Looks Done But Isn't" Checklist

- [ ] **Client simulation**: Local `Grid.step()` runs — verify the hash at tick T on the client equals the server's checkpoint hash at tick T for at least 500 ticks without inputs.
- [ ] **Input-only transport**: Server stops sending `state` every tick during active match — verify `state` events are NOT received in the integration test tick loop (only periodic snapshots every N ticks).
- [ ] **Hash checkpoint**: Server emits `lockstep:checkpoint` — verify client receives it AND computes the same `hashHex` locally before claiming hash-based consistency is working.
- [ ] **Reconnect snapshot**: Client reconnects and shows correct state — verify the `tick` in `RoomJoinedPayload.state` matches the tick from which the client resumes local simulation.
- [ ] **Client-side rejection**: Client rejects invalid events — verify a server-accepted `build:outcome applied` is NEVER suppressed by client rejection logic (client rejection is advisory only).
- [ ] **ArrayBuffer round-trip**: Grid packed data survives Socket.IO serialization — verify `Grid.fromPacked(Grid.toPacked())` produces identical hash as the original grid.
- [ ] **Map insertion order**: Client-reconstructed `RtsRoom` from snapshot produces identical hash to server's `RtsRoom` at the same tick — test with two teams in both join orders.

---

## Recovery Strategies

| Pitfall                                                  | Recovery Cost | Recovery Steps                                                                                                                         |
| -------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Client simulation starts from wrong tick                 | HIGH          | Define `snapshotTick` in join payload; client delays simulation start until first `lockstep:checkpoint` after the snapshot tick        |
| Hash mismatch that is persistent (client never recovers) | HIGH          | Trigger full state resync: emit `state` + all turn buffer inputs for the last snapshot window; client resets from snapshot and replays |
| Shadow room diverges from primary at tick 1              | MEDIUM        | Audit `createShadowRoom` player-insertion order vs. primary room; add shadow-vs-primary hash assertion in test at tick 0               |
| `ArrayBuffer` serialization corruption                   | MEDIUM        | Switch to base64 encoded string for grid pack/unpack in socket payloads; add round-trip test to integration suite                      |
| Intent ID collision after room restart                   | LOW           | Scope all client-side rejection caches to `(roomId, generation)`; flush on `room:match-started`                                        |

---

## Pitfall-to-Phase Mapping

| Pitfall                                     | Prevention Phase  | Verification                                                                                          |
| ------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| Client starts from wrong initial tick       | Phase 1 + Phase 4 | Hash matches at tick 1 in new client simulation integration test                                      |
| Integer overflow in client-side hash        | Phase 1           | Client calls `createDeterminismCheckpoint()` from `#rts-engine`; no independent hash path             |
| Map iteration order divergence              | Phase 1 + Phase 4 | `RtsRoom` reconstructed from snapshot produces same hash regardless of JSON field order               |
| No catchup path for missed ticks            | Phase 2 + Phase 4 | Client that misses 10 ticks recovers within the turn buffer retention window                          |
| Tick counter drift (server vs client)       | Phase 1 + Phase 2 | Client tick counter is always derived from server-emitted `tick` field, never from client timer       |
| Socket.IO delivery gap on reconnect         | Phase 4           | Reconnecting client receives turn buffer replay and hash-verifies against server checkpoint           |
| Client-side rejection diverges from server  | Phase 5           | Server-accepted `build:outcome applied` always renders on client even when client predicted rejection |
| Fallback drains in-flight buffered commands | Phase 3 + Phase 2 | Post-fallback state broadcast issued after all buffered commands for ticks <= fallback tick execute   |
| Shadow room diverges from primary           | Phase 3           | Shadow-vs-primary hash parity test at tick 0 with sorted player insertion                             |
| Reconnect snapshot taken mid-tick           | Phase 4           | Integration test reconnects during tick and verifies snapshot `tick` field matches post-tick state    |
| intentId collision across room restarts     | Phase 5           | Client rejection cache keyed on `(roomId, generation)`; no false rejections after room restart        |

---

## Sources

- [HIGH confidence] Codebase audit: `apps/server/src/server.ts` — lockstep runtime, turn buffer, fallback, snapshot interval, tick loop.
- [HIGH confidence] Codebase audit: `packages/rts-engine/rts.ts` — hash implementation, determinism checkpoint, tick order.
- [HIGH confidence] Codebase audit: `packages/conway-core/grid.ts` — integer-only arithmetic, packed grid, step loop.
- [HIGH confidence] Codebase audit: `packages/rts-engine/socket-contract.ts` — lockstep event shapes, checkpoint/fallback payloads.
- [HIGH confidence] Codebase audit: `tests/integration/server/lockstep-primary.test.ts`, `lockstep-reconnect-diagnostics.test.ts` — existing coverage and gaps.
- [HIGH confidence] Socket.IO official docs: [Delivery guarantees](https://socket.io/docs/v4/delivery-guarantees) — "at most once" default; no server-side buffer for disconnected clients; in-order delivery within connection guaranteed.
- [HIGH confidence] MDN: [Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) — insertion-order iteration guaranteed by spec.
- [MEDIUM confidence] Gaffer On Games: [Deterministic Lockstep](https://gafferongames.com/post/deterministic_lockstep/) — canonical reference on input ordering, buffer depth, and desync detection patterns.
- [MEDIUM confidence] Gaffer On Games: [Floating Point Determinism](https://gafferongames.com/post/floating_point_determinism/) — integer-only arithmetic is the reliable path; JS JIT can introduce subtle float differences.
- [MEDIUM confidence] Node.js docs: [Event Loop, Timers](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) — `setInterval` is "at least N ms", not "exactly N ms"; timer drift is real.
- [MEDIUM confidence] Game Developer Magazine: [Minimizing the Pain of Lockstep Multiplayer](https://www.gamedeveloper.com/programming/minimizing-the-pain-of-lockstep-multiplayer) — overnight automated simulation runs for determinism bugs; separate simulation from rendering code.
- [MEDIUM confidence] Factorio Friday Facts #188: [Bug, Bug, Desync](https://factorio.com/blog/post/fff-188) — desync report methodology, reconnect via state download + replay.
- [LOW confidence] GitHub: [nodejs/node #21822 — setInterval drifts](https://github.com/nodejs/node/issues/21822) — confirms timer drift in production; use `performance.now()` for elapsed time measurement.

---

_Pitfalls research for: Conway RTS v0.0.3 Deterministic Lockstep Protocol Migration_
_Researched: 2026-03-29_
