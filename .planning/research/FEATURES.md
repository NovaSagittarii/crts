# Feature Research

**Domain:** Deterministic lockstep networking protocol — Conway RTS prototype v0.0.3
**Researched:** 2026-03-29
**Confidence:** HIGH (v0.0.3 scope is defined in PROJECT.md; server-side lockstep infrastructure already exists and was inspected; domain research from authoritative sources confirmed)

## Context

This milestone migrates the existing full-state-broadcast protocol to deterministic lockstep. The server already has a substantial lockstep infrastructure (`LockstepMode`, turn buffering, shadow simulation, checkpoint events, fallback reasons). The gaps are on the **client side**: clients currently receive full state every tick and render from it. v0.0.3 makes clients run the simulation locally and only exchange inputs.

Existing features NOT re-implemented in v0.0.3 (already shipped):

- Server-side turn buffering and turn boundary tracking
- `lockstep:checkpoint` and `lockstep:fallback` socket events
- Shadow simulation mode (server runs a second RTS room to verify hash parity)
- Periodic authoritative state snapshots at configurable intervals
- Reconnect-safe full state snapshot on `room:joined`
- Hash-based desync detection with FNV1a-32 hashing for grid, structures, and economy

## Feature Landscape

### Table Stakes (Protocol Correctness — Must Have)

These behaviors define whether lockstep is "working." Missing any makes the migration non-functional.

| Feature                                                                     | Why Expected                                                                                                                                                                                                                          | Complexity | Notes                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLIENT-SIM`: Client-side deterministic simulation                          | Core lockstep requirement: clients run `Grid.step()`, economy tick, build/destroy processing locally each tick. Without this, input-only transport has no consumer on the client side.                                                | HIGH       | Engine is already deterministic in `packages/rts-engine`. Client needs to import and invoke `RtsRoom` tick locally. Must preserve existing tick order (economy → build apply → grid step → integrity → outcome).                                                   |
| `INPUT-TRANSPORT`: Input-only transport — no full-state broadcasts per tick | Lockstep's primary bandwidth benefit. Server relays queued events only (`build:queued`, `destroy:queued`, `build:outcome`, `destroy:outcome`) and suppresses per-tick `state` broadcasts during active matches.                       | HIGH       | Server already has `state` emission on every tick. Active match tick handler must gate `state` broadcast on lockstep mode. Clients must use their local simulation state for rendering instead of waiting for server state.                                        |
| `HASH-CHECKPOINT`: Hash-based desync detection at lockstep checkpoints      | Standard lockstep practice since Age of Empires. Clients compute state hash at checkpoint turns and verify against server's `lockstep:checkpoint` broadcasts. Mismatch = desync.                                                      | MEDIUM     | Server already emits `lockstep:checkpoint` with `hashHex`. Client needs to compute the same `RoomDeterminismCheckpoint` hash locally and compare. Infrastructure (FNV1a-32 hash over grid+structures+economy) is already in `rts.ts`.                              |
| `DESYNC-FALLBACK`: Fallback to authoritative state on hash mismatch         | When desync is detected, client must re-sync from server's authoritative state. Prevents silent divergence.                                                                                                                           | MEDIUM     | Server already broadcasts `lockstep:fallback` with reason. Client must handle `lockstep:fallback` by requesting a full state resync (`state:request`) and resetting local simulation from that snapshot.                                                           |
| `RECONNECT-SNAPSHOT`: Reconnect via state snapshot + input replay           | Reconnecting player gets full state snapshot at join time, then replays any buffered inputs to reach current turn.                                                                                                                    | MEDIUM     | Server already sends full `state` in `room:joined`. The new requirement is that the client must reconstitute a live `RtsRoom` from that snapshot and continue running locally rather than waiting for per-tick broadcasts.                                         |
| `CLIENT-REJECT`: Client-side event rejection                                | Clients independently reject queued events that are no longer valid at process time (e.g., build rejected because another event consumed the resources first). Prevents clients from applying stale accepted-then-invalidated events. | MEDIUM     | Server already sends `build:outcome` and `destroy:outcome` with accepted/rejected status. Client simulation must apply these outcomes at the correct tick using `executeTick` from `BuildQueuedPayload`/`DestroyQueuedPayload`.                                    |
| `TICK-ALIGN`: Client tick clock aligned to server turn boundaries           | Clients must advance their local simulation on the same logical ticks as the server. Without this, local simulation diverges purely from timing.                                                                                      | HIGH       | Server tracks `nextTurn`, `turnLengthTicks`, `bufferedTurn`, `scheduledByTurn` per queued event. Client must receive these values and use them to sequence local simulation steps. `LockstepStatusPayload` is already sent in `room:joined` and `room:membership`. |

### Differentiators (Valuable but Not Required for Correctness)

These make the lockstep experience noticeably better but the protocol still works without them.

| Feature                                                                          | Value Proposition                                                                                                                                                                                                              | Complexity | Notes                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SHADOW-VERIFY`: Shadow simulation mode (server runs a parallel RTS room)        | Allows server to detect hash mismatches without waiting for client-reported hashes. Catches desyncs that a client would silently absorb.                                                                                       | HIGH       | Already implemented server-side (`shadowRoom` in `LockstepRuntimeState`, `shadow-unavailable` fallback reason). Client value is in the fallback signal quality — shadow provides mismatches proactively rather than reactively. Client-side: handle `fromMode: 'shadow'` in `lockstep:fallback`. |
| `INPUT-ACK`: Input confirmation round-trip with `bufferedTurn`/`scheduledByTurn` | Clients can show "queued but not yet confirmed" state precisely rather than optimistically applying immediately. Prevents misleading preview states when an event is accepted at queue time but executed several turns later.  | MEDIUM     | Already present in `BuildQueuedPayload` and `DestroyQueuedPayload` via `bufferedTurn`, `scheduledByTurn`, `executeTick`. Client just needs to render pending-until-turn states correctly.                                                                                                        |
| `STATE-REQUEST-GATE`: Hash-gated state request deduplication                     | Server already deduplicates `state:request` responses by hash so unchanged sections aren't re-sent. Reduces bandwidth on reconnect where client re-requests sections that haven't changed.                                     | LOW        | Already implemented in `shouldServeStateRequest` in `server.ts`. Client benefit: safe to call `state:request` aggressively on reconnect without worrying about flooding.                                                                                                                         |
| `CHECKPOINT-REPLAY`: Checkpoint replayed to reconnecting client                  | Reconnecting clients receive the last confirmed checkpoint hash immediately in `room:joined.lockstep.lastPrimaryHash`, then receive the next checkpoint event shortly after. Makes client hash comparison easier to bootstrap. | LOW        | Already implemented (integration test `lockstep-reconnect-diagnostics.test.ts` verifies this). Client benefit: can immediately validate local simulation state after reconnect by comparing against the first received checkpoint.                                                               |
| `TURN-BUFFER-OVERFLOW`: Graceful degradation on turn buffer overflow             | If the server's command buffer fills (e.g., a bot or test flooding inputs), the server falls back cleanly rather than corrupting state.                                                                                        | LOW        | Already implemented server-side (`turn-buffer-overflow` fallback reason). Client benefit: receive `lockstep:fallback` and resync rather than experiencing silent corruption.                                                                                                                     |

### Anti-Features (Explicitly Out of Scope for v0.0.3)

| Feature                                                                    | Why Requested                                                                                            | Why Problematic                                                                                                                                                                                                   | Alternative                                                                                                                                                        |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Client-predicted simulation (optimistic local apply before server confirm) | Faster perceived responsiveness — input effects appear immediately rather than after next confirmed turn | Violates lockstep's authority model: local prediction + server correction = rollback/reconciliation complexity that is explicitly excluded from scope in PROJECT.md. Also contradicts queue-only mutation design. | Keep server-authoritative queue model. Accept that build/destroy effects apply at `executeTick`, not at queue time. Use "pending" UI indicators to mask the delay. |
| Rollback netcode                                                           | Compensates for high latency without input delay                                                         | Orthogonal architecture to lockstep; requires rewinding/replaying simulation state; incompatible with the existing queue-based mutation model                                                                     | Not for this prototype at this scale; lockstep with reasonable turn delay is sufficient                                                                            |
| Peer-to-peer lockstep (direct client-to-client input relay)                | Eliminates server as relay bottleneck                                                                    | NAT traversal complexity, fog-of-war cheating vulnerability, and lag switch attacks. Project already uses server-relay model which is superior for a two-player TypeScript web game.                              | Keep server as the relay and validator. P2P adds no benefit here.                                                                                                  |
| Replay/spectator mode                                                      | Observers want to watch matches; recordings enable post-game analysis                                    | Transport redesign (input-only) enables it technically, but it requires additional client state management and is explicitly deferred in PROJECT.md to a future milestone.                                        | Deferred. The input log structure will already support it once implemented.                                                                                        |
| Dynamic input delay adjustment based on RTT                                | Smoother experience under variable latency                                                               | Adds adaptive clock management complexity. The current prototype runs two players locally or on low-latency connections. Not worth the complexity for the prototype scope.                                        | Use a fixed turn delay. This can be tuned as a server config value if needed.                                                                                      |
| Full desync recovery (auto-resync without user-visible interruption)       | Seamless experience when hash mismatch occurs                                                            | State resync requires a full snapshot transfer which briefly freezes the simulation. Hard to make invisible. Supreme Commander and similar games show error dialogs and require quit.                             | Implement `lockstep:fallback` → `state:request` → resync cycle. Accept a brief visible pause. This is standard lockstep behavior.                                  |
| Binary/protobuf transport encoding                                         | Reduced wire size for high-frequency input messages                                                      | Input-only lockstep with queue-based gameplay already uses very low bandwidth. JSON over Socket.IO is sufficient for a two-player prototype. Premature optimization.                                              | Keep JSON/Socket.IO. Revisit only if profiling identifies bandwidth as a bottleneck.                                                                               |

## Feature Dependencies

```
[Server lockstep infrastructure] (already exists: turn buffer, shadow sim, checkpoints, fallback)
    └──required-by──> [CLIENT-SIM: client-side deterministic simulation]
                           └──required-by──> [INPUT-TRANSPORT: suppress per-tick state broadcast]
                           └──required-by──> [HASH-CHECKPOINT: client computes hash, compares to checkpoint]
                           └──required-by──> [CLIENT-REJECT: client applies outcomes at executeTick]

[CLIENT-SIM]
    └──required-by──> [TICK-ALIGN: client clock follows server turn boundaries]

[HASH-CHECKPOINT]
    └──required-by──> [DESYNC-FALLBACK: fallback triggers state:request + simulation reset]

[RECONNECT-SNAPSHOT]
    └──depends-on──> [CLIENT-SIM] (reconnect only works if client can run simulation locally from snapshot)
    └──depends-on──> [TICK-ALIGN] (must re-align clock to current turn after snapshot)

[INPUT-TRANSPORT]
    └──enhances──> [INPUT-ACK] (bufferedTurn/scheduledByTurn values become meaningful once client uses local sim)

[SHADOW-VERIFY] (server-side, already exists)
    └──observed-by──> [DESYNC-FALLBACK] (shadow mismatch triggers lockstep:fallback to client)
```

### Dependency Notes

- **`CLIENT-SIM` is the critical path**: all other v0.0.3 features depend on clients running simulation locally. Ship this first.
- **`INPUT-TRANSPORT` must follow `CLIENT-SIM`**: suppressing `state` broadcasts before the client can simulate locally would break the client entirely.
- **`HASH-CHECKPOINT` and `DESYNC-FALLBACK` are a pair**: detection without recovery leaves clients stuck in a diverged state. Implement together.
- **`RECONNECT-SNAPSHOT` depends on `CLIENT-SIM` being correct**: reconnect bootstraps a local simulation from snapshot; if local sim is wrong, reconnect is also wrong.
- **`TICK-ALIGN` is a precondition for correctness**: misaligned clocks will cause the local simulation to produce different results than the server, producing false desync signals.

## MVP Definition

### Launch With (v0.0.3)

- [ ] `CLIENT-SIM` — client imports `RtsRoom`/`RtsEngine` from `#rts-engine`, runs full tick locally (economy → build apply → grid step → integrity → match outcome). Engine is already deterministic; this is a new execution site in `apps/web/`.
- [ ] `TICK-ALIGN` — client tick clock initialized from `room:joined.lockstep` (`turnLengthTicks`, `nextTurn`) and advanced per server turn boundary signals.
- [ ] `INPUT-TRANSPORT` — server gates `state` broadcast on lockstep mode during active matches. Client renders from local simulation state instead of server-sent state.
- [ ] `CLIENT-REJECT` — client applies `build:outcome` and `destroy:outcome` at `executeTick` using the event pipeline already in `socket-contract.ts`.
- [ ] `HASH-CHECKPOINT` — client computes `RoomDeterminismCheckpoint` hash on checkpoint turns and compares to `lockstep:checkpoint` payload.
- [ ] `DESYNC-FALLBACK` — client handles `lockstep:fallback` by calling `state:request`, resetting local simulation from response, and re-aligning clock.
- [ ] `RECONNECT-SNAPSHOT` — client reconstitutes a live `RtsRoom` from `room:joined.state` snapshot, applies any buffered pending events, and resumes local simulation.

### Add After Validation (v0.0.3.x)

- [ ] `INPUT-ACK` rendering — display pending-until-turn states using `bufferedTurn`/`scheduledByTurn` values in queued event payloads. Trigger: players report confusing "did my build register?" feedback.
- [ ] Checkpoint diagnostics UI — surface mismatch count and last hash in a developer overlay. Trigger: debugging desync issues in manual testing.

### Future Consideration (v0.0.4+)

- [ ] Dynamic input delay tuning based on measured round-trip time (requires adaptive clock management).
- [ ] Replay/spectator mode (input log already captured; needs separate client consumer).
- [ ] Binary transport encoding if profiling shows bandwidth pressure at scale.
- [ ] Multiple concurrent rooms with per-room lockstep configuration.

## Feature Prioritization Matrix

| Feature               | User Value                                | Implementation Cost                                   | Priority |
| --------------------- | ----------------------------------------- | ----------------------------------------------------- | -------- |
| `CLIENT-SIM`          | HIGH — enables entire protocol            | HIGH — new execution site in web client               | P1       |
| `TICK-ALIGN`          | HIGH — correctness precondition           | MEDIUM — clock wiring from existing payloads          | P1       |
| `INPUT-TRANSPORT`     | HIGH — bandwidth goal                     | MEDIUM — gate on lockstep mode in server tick handler | P1       |
| `CLIENT-REJECT`       | HIGH — correctness                        | MEDIUM — apply outcomes at executeTick in client      | P1       |
| `HASH-CHECKPOINT`     | HIGH — desync detection                   | MEDIUM — client hash computation already available    | P1       |
| `DESYNC-FALLBACK`     | HIGH — recovery path                      | MEDIUM — state:request + simulation reset             | P1       |
| `RECONNECT-SNAPSHOT`  | HIGH — existing reconnect must still work | MEDIUM — reconstruct RtsRoom from snapshot            | P1       |
| `INPUT-ACK` rendering | MEDIUM — UX polish                        | LOW — reuse existing payload fields                   | P2       |
| `CHECKPOINT-REPLAY`   | MEDIUM — reconnect diagnostics            | LOW — already server-side, client just reads it       | P2       |
| Shadow mode awareness | LOW — server-side already works           | LOW — client handles fallback from shadow mode        | P2       |
| Replay/spectator      | LOW — not in scope                        | HIGH — separate client architecture                   | P3       |
| Dynamic input delay   | LOW — not at prototype scale              | HIGH — adaptive clock management                      | P3       |

**Priority key:**

- P1: Must have for v0.0.3 milestone closure
- P2: Add once P1 behaviors are validated in integration tests
- P3: Explicitly deferred to future milestones

## Complexity Notes

**Where implementation is genuinely hard:**

- `CLIENT-SIM` tick ordering must exactly match `RtsRoom.tick()` in `packages/rts-engine`. Any divergence in tick order (even re-ordering economy before build apply) produces immediate desync. Existing tick order from CLAUDE.md must be treated as a contract.
- `TICK-ALIGN` is subtle: the server assigns `bufferedTurn` and `scheduledByTurn` to events, and the client must apply those events at `executeTick`. If the client clock runs at a different phase than the server, events will apply on the wrong local tick.
- `RECONNECT-SNAPSHOT` requires constructing an `RtsRoom` from a `RoomStatePayload` using `RtsEngine.createRoomState` / `RtsRoom.fromState` — the engine already enforces this constructor constraint. The web client will need to call these directly.
- `DESYNC-FALLBACK` must handle the case where the client receives a fallback mid-tick. It must wait for a clean tick boundary before resetting, or risk corrupting in-progress state.

**Where implementation is straightforward given existing infrastructure:**

- `HASH-CHECKPOINT`: the `createStateHashes()` method already exists on `RtsRoom`. The client just needs to call it at the right tick and compare.
- `CLIENT-REJECT`: event outcomes already have `accepted: boolean` and `executeTick`. Client just needs to check at that tick whether to apply or skip.
- `INPUT-TRANSPORT`: the server already has lockstep mode as a concept. Gating `state` broadcast on `lockstepRuntime.mode !== 'off'` is a targeted change in the tick handler.

## Sources

- `/home/alpine/crts-opencode/.planning/PROJECT.md` (HIGH — defines v0.0.3 feature scope)
- `/home/alpine/crts-opencode/packages/rts-engine/socket-contract.ts` (HIGH — canonical wire protocol)
- `/home/alpine/crts-opencode/apps/server/src/server.ts` (HIGH — existing lockstep runtime state)
- [Gaffer on Games: Deterministic Lockstep](https://gafferongames.com/post/deterministic_lockstep/) (HIGH — authoritative reference)
- [SnapNet: Netcode Architectures Part 1: Lockstep](https://www.snapnet.dev/blog/netcode-architectures-part-1-lockstep/) (MEDIUM — practical survey)
- [Game Networking Demystified, Part III: Lockstep](https://ruoyusun.com/2019/04/06/game-networking-3.html) (MEDIUM — input buffering patterns)
- [ForrestTheWoods: Synchronous RTS Engines and a Tale of Desyncs](https://www.forrestthewoods.com/blog/synchronous_rts_engines_and_a_tale_of_desyncs/) (MEDIUM — desync detection in practice, Supreme Commander reference)
- [Game Developer: Minimizing the Pain of Lockstep Multiplayer](https://www.gamedeveloper.com/programming/minimizing-the-pain-of-lockstep-multiplayer) (MEDIUM — determinism requirements, fixed-point math)
- [GameDev.net: Client-server RTS lockstep](https://gamedev.net/forums/topic/644053-client-server-rts-lockstep/) (MEDIUM — server relay vs P2P tradeoffs)

---

_Feature research for: deterministic lockstep networking protocol — Conway RTS prototype v0.0.3_
_Researched: 2026-03-29_
