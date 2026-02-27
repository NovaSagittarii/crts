# Project Research Summary

**Project:** Conway RTS TypeScript Prototype
**Domain:** Browser-based multiplayer Conway RTS prototype (server-authoritative, lobby/team-first)
**Researched:** 2026-02-27
**Confidence:** MEDIUM

## Executive Summary

This project is a browser multiplayer strategy prototype where the core product value is a fast path from lobby to a deterministic 1v1 Conway RTS match. Across the research set, the strongest consensus is to keep a server-authoritative TypeScript architecture (Node + Socket.IO + deterministic package reducers), treat the client as intent-only, and harden room/team reliability before adding strategic depth. Experts build this kind of system by making protocol contracts explicit, gating all actions through match phases, and validating every inbound event at runtime.

The recommended approach is a dependency-first roadmap: lock protocol and lobby/team lifecycle first, then enforce match lifecycle and win/loss semantics, then make build queue outcomes fully deterministic (`queued -> applied | rejected(reason)`). This sequence matches both feature dependencies and architecture constraints, and it aligns with project constraints (no wasm, no protobuf, TDD-first). The MVP target should remain a full end-to-end path: join room, assign teams, queue builds, execute ticks, resolve breach, and lock defeated players out.

The biggest risks are not framework choice; they are state correctness and player trust failures: lost intents on reconnect, queued builds with no terminal outcome, and room/team drift under race conditions. Mitigation is clear: explicit lifecycle reducers, acknowledgements + reconnect resync, and exhaustive integration tests around race/disconnect scenarios. Performance and scale work should be intentionally deferred until the core loop is consistently playable and test-verified.

## Key Findings

### Recommended Stack

The stack is already directionally correct for this milestone: Node/TypeScript/Socket.IO/Vite/Vitest with strict typing and runtime payload validation. Research strongly recommends incremental upgrades over rewrites, prioritizing delivery risk reduction over speculative performance architecture.

Critical version floors matter: Node 22.12+ (target 24.x LTS in CI), TypeScript 5.9.x, Socket.IO 4.8.3 parity server/client, Vite 7.3.0, and Vitest 4.0.16. Keep wasm/protobuf out of scope until gameplay contracts stabilize.

**Core technologies:**

- **Node.js 22.12+ (target 24.x LTS):** authoritative server tick runtime with low migration risk in the current repo.
- **TypeScript 5.9.3:** strict shared typing across server/client/packages for contract safety.
- **Socket.IO 4.8.3:** room orchestration, ordered events, typed contracts, and reconnect tooling.
- **Express 4.22.1:** pragmatic HTTP wrapper/static hosting without a framework migration tax.
- **Vite 7.3.0 + Vitest 4.0.16:** fast iteration and TDD coverage for deterministic logic and socket integration.
- **Zod 4.x:** runtime schema enforcement at all inbound socket boundaries.

### Expected Features

Feature research is explicit that v1 success is operational, not cosmetic: players must reliably reach a match and complete a coherent win/loss loop. Differentiators should be staged after the base command/economy/territory path is trustworthy.

**Must have (table stakes):**

- Reliable `room:list/create/join/leave` lifecycle with deterministic membership.
- Deterministic team assignment and non-overlapping base spawn.
- Server-authoritative tick + state synchronization for desync prevention.
- Build queue with delay/validation/ack/rejection feedback.
- Economy visibility (resources + income) and territory-constrained construction.
- Canonical breach win/lose flow with explicit end-state UX and defeated lockout.

**Should have (competitive):**

- Ghost-cell batch planner with commit semantics (single-batch first).
- Curated offense/defense/support pattern deck expansion.
- Queue timeline inspector and clearer pending-build UX.
- Conway-specific near-safe-cell threat indicators.

**Defer (v2+):**

- Accounts/profiles/ranked matchmaking.
- Large-room scaling and transport-level optimization programs.
- Replay/spectator/time-travel tooling.
- High-player diplomacy/complex team systems.

### Architecture Approach

Architecture research converges on a clean split: impure runtime orchestration in `apps/*`, pure deterministic reducers in `packages/*`, and a shared protocol layer to prevent event drift. Three patterns are central: authoritative intent pipeline, explicit lifecycle state machine (`lobby -> countdown -> active -> finished`), and snapshot+delta sync with monotonic tick ordering and resync fallback.

**Major components:**

1. **Socket Gateway + Validation:** own event contracts, runtime validation, and ack/reject behavior.
2. **Lobby/Team + Lifecycle Coordinator:** enforce room/team/start invariants and legal phase transitions.
3. **Tick Scheduler + RTS Engine Reducers:** deterministic queue execution and Conway stepping.
4. **State Broadcaster:** room-scoped deltas/snapshots with tick metadata for ordering/recovery.
5. **Client Store + rAF Renderer:** reconcile authoritative state while isolating rendering cadence from network bursts.

### Critical Pitfalls

1. **No explicit lobby/match state machine** - implement strict room phases and idempotent join/leave/start transitions.
2. **Assuming default Socket.IO delivery is sufficient** - require ack/timeout contracts for critical intents and authoritative resync on reconnect.
3. **Queue accepted but never resolved** - enforce terminal build outcomes for every queued ID (`applied` or `rejected(reason)`).
4. **Legacy `cell:update` bypasses gameplay rules** - remove from production flow or gate to debug-only; route all gameplay mutations through validated queue/commit paths.
5. **Full-grid tick/broadcast/redraw bottleneck** - define tick/payload/render budgets and move to delta + rAF-driven rendering.

## Implications for Roadmap

Based on combined research, use a 5-phase plan aligned to dependency order and risk reduction.

### Phase 1: Protocol + Lobby/Team Lifecycle Hardening

**Rationale:** Lobby reliability is the critical path; every gameplay signal is noisy until room/team state is deterministic.
**Delivers:** Shared protocol contracts, typed socket handlers, room lifecycle invariants, deterministic spawn assignment, reconnect resync baseline.
**Addresses:** Room lifecycle, team assignment/base spawn, identity clarity.
**Avoids:** Pitfalls 1, 2, and 5 (state drift, delivery assumptions, spawn overlap).

### Phase 2: Match Lifecycle + Canonical Win/Loss Loop

**Rationale:** Actions need legal phase boundaries before deep build/economy work.
**Delivers:** Explicit lifecycle reducer (`lobby/countdown/active/finished`), start gating, canonical breach rule implementation, defeated-team lockout, victory/defeat UX.
**Addresses:** Breach end-state UX, authoritative timeline clarity, playable session completion.
**Implements:** Architecture lifecycle coordinator + authority model.

### Phase 3: Deterministic Build Queue Guarantees

**Rationale:** The core player action must produce predictable outcomes to make strategy testable.
**Delivers:** `build:queued -> build:applied|build:rejected(reason)` terminal contract, territory/resource validation hardening, `cell:update` gameplay-path removal, end-to-end integration path (join -> build -> tick -> breach).
**Addresses:** Build loop, territory enforcement, economy spend correctness.
**Avoids:** Pitfalls 3 and 4 (phantom queues, rule bypass).

### Phase 4: Differentiators + Balance Checkpoint (v1.x)

**Rationale:** Strategic depth should follow a stable deterministic core, not precede it.
**Delivers:** Single-batch ghost planner, curated template deck expansion, queue timeline UX, basic balance instrumentation (win-rate/build-share/match-length).
**Addresses:** Main differentiators from feature research.
**Avoids:** Pitfall 8 (template over-expansion before economy balance).

### Phase 5: Reliability/Performance/Abuse Hardening

**Rationale:** Harden once core loop is proven, then optimize the real bottlenecks.
**Delivers:** Snapshot+delta sync, reconnect recovery test matrix, per-socket rate limits + queue caps, tick/payload/render budgets in CI, optional Redis Streams adapter for multi-node.
**Addresses:** Playtest stability, performance, and operational safety.
**Avoids:** Pitfalls 2, 6, and 7 (reconnect desync, full-grid bottlenecks, event spam).

### Phase Ordering Rationale

- Feature dependency chain requires stable room/team state before match actions and before differentiators.
- Architecture dependency chain requires protocol contracts and lifecycle guards before queue semantics and sync hardening.
- Pitfall mapping shows most severe correctness issues cluster in Phases 1-3; shipping those early reduces rework risk later.

### Research Flags

Phases likely needing deeper `/gsd-research-phase` during planning:

- **Phase 4 (Differentiators + Balance):** Conway template interactions are nonlinear; balance thresholds and instrumentation targets need tighter validation.
- **Phase 5 (Reliability/Performance/Abuse):** requires benchmark-driven decisions (delta encoding shape, queue data structures, rate-limit policy, optional multi-node topology).

Phases with standard patterns (can usually skip extra research):

- **Phase 1 (Protocol + Lobby/Team):** well-documented Socket.IO room/ack patterns and clear in-repo constraints.
- **Phase 2 (Lifecycle + Win/Loss):** established reducer/state-machine pattern and straightforward dependency structure.
- **Phase 3 (Queue Guarantees):** requirements are concrete and testable from existing engine behavior and known gaps.

## Confidence Assessment

| Area         | Confidence | Notes                                                                                                                     |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| Stack        | HIGH       | Strong official-doc support and direct fit to current repo; only scale-out path remains less proven.                      |
| Features     | MEDIUM     | Core MVP requirements are clear, but differentiator depth and final UX expectations need live playtest validation.        |
| Architecture | MEDIUM     | Pattern choices are sound and documented, but replay/recovery/perf behavior needs confirmation in this specific codebase. |
| Pitfalls     | MEDIUM     | Risks are concrete and code-informed, but severity ordering for performance/abuse needs empirical load data.              |

**Overall confidence:** MEDIUM

### Gaps to Address

- **Canonical breach rule alignment:** finalize one authoritative win-condition definition (safe-cell breach vs base-integrity phrasing) before Phase 2 implementation.
- **Reconnect strategy specifics:** define exact fallback contract when recovery is unavailable (authoritative snapshot bootstrap + pending intent invalidation policy).
- **Spawn and room capacity policy:** set hard limits and overflow behavior for N+1 joins to prevent invalid match starts.
- **Balance success thresholds:** define numeric acceptance targets (match length, template pick share, comeback rate) before Phase 4 expansion.
- **Abuse-control baseline for prototype:** choose minimum auth/rate-limit policy early so Phase 5 is hardening, not first introduction.

## Sources

### Primary (HIGH confidence)

- `.planning/research/STACK.md` - runtime/tooling versions, compatibility floors, scale-path constraints.
- `.planning/research/FEATURES.md` - table stakes, differentiators, anti-features, dependency graph.
- `.planning/research/ARCHITECTURE.md` - authority model, component boundaries, build-order dependencies.
- `.planning/research/PITFALLS.md` - critical failure modes, phase mapping, prevention/test strategy.
- `.planning/PROJECT.md` - milestone scope, constraints, and product priorities.
- Socket.IO official docs (rooms, delivery guarantees, connection recovery, adapters, middleware) - transport and reliability semantics.
- Node.js timers API + MDN `requestAnimationFrame` - tick/render cadence constraints.

### Secondary (MEDIUM confidence)

- Conway pattern taxonomy references used to shape template-differentiator direction and onboarding assumptions.
- Historical fixed-timestep/networking guidance (Gaffer on Games) used as directional architecture support.

### Tertiary (LOW confidence)

- Competitor landing-page feature claims used only for lightweight positioning context.

---

_Research completed: 2026-02-27_
_Ready for roadmap: yes_
