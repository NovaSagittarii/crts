# Pitfalls Research

**Domain:** Multiplayer server-authoritative Conway RTS prototype (lobby/team-first)
**Researched:** 2026-02-27
**Confidence:** MEDIUM

## Critical Pitfalls

### Pitfall 1: Lobby and team flow without an explicit room state machine

**What goes wrong:**
Players can be left in inconsistent lobby states (duplicate joins, unexpected leaves during transitions, match start while roster is unstable), which makes game start reliability the first blocker.

**Why it happens:**
Room lifecycle is event-driven (`room:create`, `room:join`, `room:leave`) but currently has no explicit lobby/match phase model or idempotency contract.

**How to avoid:**
Define a strict room lifecycle (`Lobby -> Starting -> InMatch -> Ended`) and enforce command validity per phase; make join/leave/start idempotent and host-gated.

**Warning signs:**
`room:list` and `state` team counts diverge, reconnecting users appear as new teams, start attempts succeed with missing/duplicate participants.

**Phase to address:**
Phase 1 - Lobby/Team Lifecycle Hardening.

**TDD focus:**
Integration tests for race sequences (`join+leave`, `disconnect during join`, repeated `start`), asserting exactly one team assignment per player and stable room occupancy.

---

### Pitfall 2: Assuming Socket.IO delivery is reliable enough for gameplay intents

**What goes wrong:**
Build intents or lobby actions are silently lost during transient disconnects, leaving client UI and server truth out of sync.

**Why it happens:**
Socket.IO is ordered but default delivery is "at most once"; disconnected clients miss server events unless recovery/replay is implemented.

**How to avoid:**
Add intent acknowledgements with timeouts for critical commands, enable connection state recovery where applicable, and always resync from authoritative room snapshot after reconnect.

**Warning signs:**
Users report "I queued it, then it vanished" after reconnects; jumps in generation/tick without expected intermediate outcomes.

**Phase to address:**
Phase 1 - Lobby/Team Lifecycle Hardening (reconnect contract), reinforced in Phase 5.

**TDD focus:**
Fault-injection integration tests that force disconnect/reconnect mid-action and assert eventual consistency (same room/team, same accepted/rejected command outcome).

---

### Pitfall 3: Queue acceptance without execution-time resolution events

**What goes wrong:**
Client receives `build:queued`, but build is skipped at execution time (territory/resource/duplicate checks) with no explicit rejection event.

**Why it happens:**
Execution checks in `applyTeamEconomyAndQueue()` drop invalid due events via `continue` branches, and transport currently emits only enqueue success.

**How to avoid:**
Model build events as `queued -> applied | rejected(reason)`; emit a terminal resolution event for every queued build ID; reserve resources on queue or explicitly revalidate with reason codes.

**Warning signs:**
Rising count of queued IDs with no visible outcome; support/debug messages like "queued but never built"; user retries same placement repeatedly.

**Phase to address:**
Phase 3 - Ghost Build Commit + Queue Guarantees.

**TDD focus:**
Unit tests for each rejection branch at execution tick, plus integration tests asserting every queued event reaches exactly one terminal state.

---

### Pitfall 4: Keeping legacy `cell:update` as a production gameplay path

**What goes wrong:**
Direct paint updates bypass team territory semantics and undermine the DESIGN.md ghost-cell batch/commit model, enabling griefing and rule drift.

**Why it happens:**
`cell:update` currently checks only coordinate bounds, not team ownership/territory/pending-commit rules.

**How to avoid:**
Restrict `cell:update` to debug-only mode (or remove it from multiplayer flow), and enforce all edits through server-validated ghost batch commits with atomic apply semantics.

**Warning signs:**
Players alter opponent areas using paint mode; behavior differs between template mode and paint mode; territory rules appear arbitrary to users.

**Phase to address:**
Phase 2 - Safe-Cell Rules and Territory Enforcement, completed in Phase 3.

**TDD focus:**
Adversarial integration tests that attempt out-of-territory or opponent-targeted edits and require deterministic rejection; unit tests for batch flip invariants.

---

### Pitfall 5: Spawn/territory exhaustion producing invalid matches

**What goes wrong:**
When spawn candidates are exhausted, fallback placement can overlap bases or create unfair starts, invalidating match results.

**Why it happens:**
Spawn selection has finite candidate logic and a hard fallback to `{ x: 0, y: 0 }` when no free slot is found.

**How to avoid:**
Track spawn occupancy explicitly, reject joins when no legal spawn exists (or auto-create overflow room), and add minimum-distance constraints between safe cells.

**Warning signs:**
Duplicate `baseTopLeft` values, immediate base interference at match start, sudden spike in first-minute defeats.

**Phase to address:**
Phase 1 - Lobby/Team Lifecycle Hardening.

**TDD focus:**
Unit tests for spawn-capacity boundaries and no-overlap invariant; integration tests for N+1 join behavior under full room conditions.

---

### Pitfall 6: Full-grid tick + full-grid broadcast + full redraw bottleneck

**What goes wrong:**
Prototype feels laggy as room size/player count grows: server CPU spikes, network payloads balloon, client frame rate drops.

**Why it happens:**
Each tick currently steps the whole grid, serializes full grid payload, emits `state`, and client decodes and redraws whole board (including repeated `resizeCanvas()` calls).

**How to avoid:**
Define budget targets now (tick time, payload bytes, render time); move to chunk/delta updates, resize only on dimension changes, and render on `requestAnimationFrame` cadence.

**Warning signs:**
Tick loop delay > target cadence, noticeable input lag at larger maps, sustained high CPU on server/client even with small player counts.

**Phase to address:**
Phase 5 - Performance Hardening for Playable Match Reliability.

**TDD focus:**
Performance regression tests (max bytes/tick, max tick duration under fixture loads) and integration benchmarks for map-size thresholds.

---

### Pitfall 7: No abuse controls on mutating socket events

**What goes wrong:**
One client can flood `build:queue`/`cell:update` and degrade room responsiveness or exploit unbounded queue growth.

**Why it happens:**
No per-socket rate limiting, no queue caps, and no authenticated authorization boundary around state-mutating intents.

**How to avoid:**
Use Socket.IO middleware for auth + rate limiting, enforce per-team queue limits/backpressure, and disconnect or quarantine abusive sessions.

**Warning signs:**
`pendingBuildEvents` lengths grow unbounded, same socket dominates event throughput, server memory/CPU climbs nonlinearly during playtests.

**Phase to address:**
Phase 5 - Abuse and Runtime Hardening (minimum controls can start in Phase 1).

**TDD focus:**
Adversarial integration tests that spam events and assert throttling, bounded queues, and stable server behavior under load.

---

### Pitfall 8: Over-expanding template catalog before economy balance is stable

**What goes wrong:**
Gameplay collapses into one dominant build order or unwinnable snowball loops, making feedback on "fun" inconclusive.

**Why it happens:**
Conway patterns have nonlinear interactions; adding many offensive/defensive/support templates before cost/territory/income tuning obscures root causes.

**How to avoid:**
Start with a minimal, role-balanced catalog (one offense, one defense, one support plus base), instrument win-rate/build-rate metrics, and gate new templates behind balance checkpoints.

**Warning signs:**
Single template dominates build share, average match duration collapses or stalls, comeback rate trends to near zero.

**Phase to address:**
Phase 4 - Template Catalog + Economy Loop Balancing.

**TDD focus:**
Simulation-style tests for economy invariants (no negative resources, bounded income growth) and scenario tests for mirrored starts to detect obvious first-order imbalance.

---

## Technical Debt Patterns

Shortcuts that look fast now but are expensive in this prototype.

| Shortcut                                                    | Immediate Benefit              | Long-term Cost                                              | When Acceptable                              |
| ----------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------- | -------------------------------------------- |
| Keep `cell:update` as user-facing build path                | Fast iteration for UI painting | Violates territory/ghost semantics and creates exploit path | Only behind explicit debug flag in local dev |
| Emit only `build:queued` (no terminal result)               | Simple socket contract         | "Phantom build" UX and hard-to-debug state divergence       | Never                                        |
| Keep socket DTO types duplicated across server/client/tests | Quick local edits              | Event contract drift and runtime-only failures              | Never                                        |
| Add many templates before instrumentation                   | Feels feature-rich quickly     | Balance chaos, unclear root causes, rewrites                | Only after metrics baseline exists           |

## Integration Gotchas

| Integration          | Common Mistake                                  | Correct Approach                                                          |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| Socket.IO reconnect  | Assume missed events are replayed automatically | Resync from authoritative snapshot; add ack/recovery for critical intents |
| Socket.IO rooms      | Treat client as source of room membership truth | Treat server room membership as canonical; test disconnect/rejoin flows   |
| Node tick scheduling | Assume `setInterval` fires exactly on cadence   | Track drift and process simulation based on measured elapsed time budget  |

## Performance Traps

| Trap                                     | Symptoms                                    | Prevention                                                     | When It Breaks                                   |
| ---------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| Full-grid state emission every tick      | Bandwidth spikes and high serialization CPU | Delta/chunk updates and rate control                           | Medium map sizes + multiple active rooms         |
| Full-canvas decode/draw on every `state` | Client FPS drop and input latency           | Diff rendering + `requestAnimationFrame` + no redundant resize | As grid dimensions and update frequency increase |
| Build queue sort/scan per tick           | Tick cost scales with queued events         | Tick-indexed buckets/min-heap + queue caps                     | Under spam or many delayed builds                |

## Security Mistakes

| Mistake                                          | Risk                                   | Prevention                                                       |
| ------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------- |
| No authenticated identity on socket connect      | Impersonation and untrusted mutations  | Add auth handshake and bind player identity to session           |
| No per-event authorization (team/room ownership) | Cross-team griefing/modification       | Enforce team ownership and territory checks at server boundary   |
| No rate limiting on mutating events              | Event flood DoS against room tick loop | Socket middleware throttles + bounded queues + disconnect policy |

## UX Pitfalls

| Pitfall                                       | User Impact                             | Better Approach                                            |
| --------------------------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| "Build queued" without "applied/rejected"     | Confusing, feels random or buggy        | Show per-build lifecycle with reasoned failures            |
| No explicit lobby readiness/start constraints | Matches start in broken states          | Show lobby readiness and host-controlled start gate        |
| Weak safe-cell breach feedback                | Players do not understand why they lost | Add explicit breach animation/message + post-match summary |

## "Looks Done But Isn't" Checklist

- [ ] **Lobby flow:** Works in happy path but not after disconnect/reconnect - verify team identity and room re-assignment stability.
- [ ] **Build queue:** Accepts requests but does not emit terminal outcomes - verify every queued ID resolves once.
- [ ] **Territory rules:** Enforced for templates but bypassed by legacy updates - verify no mutating path bypasses server territory checks.
- [ ] **Playable match:** Win condition triggers, but defeated teams can still affect play - verify post-defeat action lockout and clear UX.
- [ ] **Performance:** Feels smooth at 1 room only - verify tick and render budgets at target room/map settings.

## Recovery Strategies

| Pitfall                               | Recovery Cost | Recovery Steps                                                                                          |
| ------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| Queue events silently dropped         | MEDIUM        | Add terminal event state machine, backfill client UX, write migration tests for old/new event contracts |
| Spawn overlap in live matches         | LOW           | Hotfix join rejection on no legal spawn, invalidate affected matches, add spawn-cap tests               |
| Reconnect desync                      | HIGH          | Force authoritative resync on reconnect, invalidate stale local intents, add disconnect fault tests     |
| Performance collapse under map growth | HIGH          | Reduce tick/payload budget immediately, ship diff pipeline incrementally, add performance gates in CI   |

## Pitfall-to-Phase Mapping

| Pitfall                        | Prevention Phase          | Verification                                                            |
| ------------------------------ | ------------------------- | ----------------------------------------------------------------------- |
| Lobby/team state machine drift | Phase 1                   | Integration race tests pass for join/leave/start/disconnect sequences   |
| Delivery/reconnect assumptions | Phase 1 (and 5 hardening) | Fault-injection reconnect tests preserve room/team/action consistency   |
| Queue accepted but unresolved  | Phase 3                   | Every queued build ID reaches `applied` or `rejected(reason)` in tests  |
| Legacy `cell:update` bypass    | Phase 2-3                 | Unauthorized/out-of-territory updates are rejected in adversarial tests |
| Spawn exhaustion overlap       | Phase 1                   | No-overlap invariant holds across max-capacity join tests               |
| Full-grid perf bottleneck      | Phase 5                   | Tick/payload/render budgets enforced by automated performance checks    |
| Event spam and abuse           | Phase 5                   | Throttle/disconnect behavior validated under spam scenarios             |
| Template/economy imbalance     | Phase 4                   | Balance metrics and simulation invariants stay within agreed thresholds |

## Sources

- [HIGH] Project context and active requirements: `/workspace/.planning/PROJECT.md` (updated 2026-02-27).
- [HIGH] Original game design constraints (safe cell, territory, ghost batch commits): `/workspace/conway-rts/DESIGN.md`.
- [HIGH] Current code behavior and known concerns: `/workspace/.planning/codebase/CONCERNS.md`, `/workspace/apps/server/src/server.ts`, `/workspace/apps/web/src/client.ts`, `/workspace/packages/rts-engine/src/rts.ts`, `/workspace/tests/integration/server/server.test.ts`.
- [HIGH] Socket.IO disconnection semantics (client not always connected; server does not store events): https://socket.io/docs/v4/tutorial/handling-disconnections (last updated Jan 22, 2026).
- [HIGH] Socket.IO delivery guarantees and retries/acks: https://socket.io/docs/v4/delivery-guarantees and https://socket.io/docs/v4/tutorial/step-8 (last updated Jan 22, 2026).
- [HIGH] Socket.IO connection state recovery limits and configuration: https://socket.io/docs/v4/connection-state-recovery (last updated Jan 22, 2026).
- [HIGH] Socket.IO room/disconnect behavior: https://socket.io/docs/v4/rooms/ (last updated Jan 22, 2026).
- [HIGH] Socket.IO middleware for auth/rate limiting hooks: https://socket.io/docs/v4/middlewares/ (last updated Jan 22, 2026).
- [HIGH] Socket.IO offline buffering and burst risk: https://socket.io/docs/v4/client-offline-behavior/ and volatile events docs https://socket.io/docs/v4/emitting-events/ (last updated Jan 22, 2026).
- [MEDIUM] Node timer scheduling caveats for tick cadence (`setTimeout`/event loop timing not exact): https://nodejs.org/api/timers.html (v25 docs).
- [MEDIUM] Browser render-loop guidance for smooth repaint cadence (`requestAnimationFrame`): https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame (last modified Dec 26, 2025).

---

_Pitfalls research for: Multiplayer Conway RTS lobby/team-first prototype_
_Researched: 2026-02-27_
