# Conway RTS TypeScript Prototype

## What This Is

This is a shipped TypeScript multiplayer Conway RTS prototype: two players can form a room, run a deterministic Conway-based match, queue authoritative build and destroy actions, and use tactical overlays to make structure and economy decisions during play.

## Core Value

Two players can quickly get into a match and use Conway-based strategy to defend their safe cell and breach the opponent's.

## Current Milestone: v0.0.3 Deterministic Lockstep Protocol

**Goal:** Migrate the network protocol from full-state broadcast to deterministic lockstep, where clients run the simulation locally and the server acts as a thin input validator + relay.

**Target features:**
- Client-side deterministic simulation (clients run Grid.step(), economy, build/destroy processing locally)
- Input-only transport (server validates and relays queued events; no full state broadcasts per tick)
- Hash-based desync detection (periodic lockstep checkpoints with hash verification across clients)
- Reconnect via state snapshot + input replay (disconnected players rejoin by receiving a snapshot and replaying inputs)
- Client-side event rejection (clients independently reject queued events that are no longer valid at process time)

## Current State

**Shipped version:** `v0.0.2` (2026-03-03)

- Canonical 5x5 base geometry and template-wide integrity handling are now deterministic and shared across runtime + tests.
- Placement legality uses full-footprint union build zones with fixed radius-15 behavior for this milestone.
- Transform-aware placement (rotate/mirror) is wired through engine, server, and web with preview/queue/apply parity.
- Authoritative destroy queue flow now includes deterministic rejection taxonomy and reconnect-safe projection behavior.
- Web runtime now has dedicated lobby/in-game screens, pan/zoom map controls, and tactical overlays with pinned structure inspector.
- Milestone artifacts are archived in `.planning/milestones/`, and active planning docs are reset for the next cycle.

## Requirements

### Validated in v0.0.1

- ✓ Lobby and reconnect reliability (`LOBBY-01`, `LOBBY-03`, `LOBBY-04`)
- ✓ Match lifecycle and breach outcomes (`MATCH-01`, `MATCH-02`, `MATCH-03`)
- ✓ Deterministic build queue validation (`BUILD-01`, `BUILD-02`, `BUILD-03`, `BUILD-04`)
- ✓ Economy + queue visibility (`ECON-01`, `ECON-02`, `ECON-03`, `UX-01`)
- ✓ Quality gates (`QUAL-01`, `QUAL-02`)
- Delivered capability (excluded from closure accounting): `LOBBY-02`

### Validated in v0.0.2

- ✓ Structure systems (`STRUCT-01`, `STRUCT-02`, `BASE-01`)
- ✓ Build rules and transforms (`BUILD-01`, `BUILD-02`, `XFORM-01`, `XFORM-02`, `QUAL-03`)
- ✓ Match UI navigation and overlays (`UI-01`, `UI-02`, `UI-03`, `UI-04`, `UI-05`, `QUAL-04`)

### Active (v0.0.3)

- [ ] Client-side deterministic simulation
- [ ] Input-only transport protocol
- [ ] Hash-based desync detection
- [ ] Reconnect via state snapshot + input replay
- [ ] Client-side event rejection

### Future Candidates

- [ ] `UX2-01`: Minimap and fog-of-war map awareness
- [ ] `UX2-02`: Bulk destroy and undo/redo timeline controls
- [ ] `UX2-03`: Custom structure template authoring/sharing
- [ ] `BASE2-01`: Multiple base archetypes or configurable base geometry

### Out of Scope

- Account/auth system and persistent profile storage remain out of scope for current prototype validation.
- Frontend framework migration and renderer migration stay deferred until scale/performance requirements demand them.
- Client-predicted simulation remains out of scope — lockstep replaces prediction with local authoritative execution.
- Replay/spectator mode deferred to a future milestone (transport redesign enables it but it's not in v0.0.3 scope).

## Context

- Milestones shipped: `v0.0.1`, `v0.0.2`.
- Delivery model remains backend + deterministic tests first, then runtime/UI integration.
- Archive-first planning keeps `.planning/ROADMAP.md` compact and milestone-scoped details in `.planning/milestones/`.
- The simulation engine (`packages/rts-engine`) is already fully deterministic with fixed tick order and no randomness, making it suitable for client-side execution.
- Existing lockstep infrastructure (`determinism-hash.ts`, `lockstep:checkpoint`/`lockstep:fallback` events) provides a foundation for the protocol migration.

## Constraints

- **Tech stack:** TypeScript + Node.js + Socket.IO + Vite.
- **Architecture:** Keep deterministic reusable logic in `packages/*`; keep runtime/socket lifecycle in `apps/*`.
- **Quality gate:** Maintain requirement-traceable unit + integration coverage for each active milestone requirement.
- **Authority model:** Server validates inputs at queue time; clients run deterministic simulation locally. Server remains the arbiter for desync resolution.

## Key Decisions

| Decision                                                    | Rationale                                                             | Outcome |
| ----------------------------------------------------------- | --------------------------------------------------------------------- | ------- |
| Build as TypeScript-only prototype (no wasm, no protobuf)   | Reduces integration complexity and keeps iteration fast               | ✓ Good  |
| Prioritize lobby/team reliability before deeper strategy    | Setup friction blocks all gameplay validation if left unresolved      | ✓ Good  |
| Treat playable end-to-end match as milestone completion bar | Ensures delivery reflects real player flow, not disconnected features | ✓ Good  |
| Keep server-authoritative deterministic simulation model    | Preserves consistency across runtime layers and tests                 | ✓ Good  |
| Prioritize backend + tests before UI-heavy milestone slices | Reduced UI churn and caught game-rule regressions early in v0.0.2     | ✓ Good  |
| Keep milestone docs archived by version                     | Keeps planning context bounded and historically traceable             | ✓ Good  |
| Migrate to lockstep with server as input validator + relay  | Reduces bandwidth from full-state to inputs-only; enables scaling     | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

_Last updated: 2026-03-29 after v0.0.3 milestone start_
