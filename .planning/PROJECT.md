# Conway RTS TypeScript Prototype

## What This Is

This is a shipped TypeScript multiplayer Conway RTS prototype: two players can form a room, run a deterministic Conway-based match, queue authoritative build and destroy actions, and use tactical overlays to make structure and economy decisions during play.

## Core Value

Two players can quickly get into a match and use Conway-based strategy to defend their safe cell and breach the opponent's.

## Current Milestone: v0.0.3 Template Grid Unification

**Goal:** Consolidate duplicated template and offset-template code into a single transformable `GridView` flow while preserving deterministic gameplay behavior.

**Target features:**

- Add `template.grid()` to return a transform-ready `GridView`.
- Support `translate`, `rotate`, and `applyTransform` on `GridView` via shared grid transform utilities.
- Make `GridView.cells()` yield transformed `{ x, y, alive }` entries for every cell.
- Remove duplicated template/offset-template methods without changing authoritative outcomes.
- Research additional code simplification opportunities to fold into this milestone if low risk.

## Current State

**Shipped version:** `v0.0.2` (2026-03-03)

- Canonical 5x5 base geometry and template-wide integrity handling are now deterministic and shared across runtime + tests.
- Placement legality uses full-footprint union build zones with fixed radius-15 behavior for this milestone.
- Transform-aware placement (rotate/mirror) is wired through engine, server, and web with preview/queue/apply parity.
- Authoritative destroy queue flow now includes deterministic rejection taxonomy and reconnect-safe projection behavior.
- Web runtime now has dedicated lobby/in-game screens, pan/zoom map controls, and tactical overlays with pinned structure inspector.
- Milestone artifacts are archived in `.planning/milestones/`, and active planning docs are reset for the next cycle.

## Next Milestone Goals

- [ ] Replace template/offset-template duplication with a unified `GridView` abstraction.
- [ ] Route template transforms through shared grid transform utilities.
- [ ] Keep tests and runtime behavior stable while removing duplicate pathways.
- [ ] Capture and prioritize any additional low-risk simplification opportunities discovered via research.
- [ ] Run milestone audit checks earlier in the cycle to avoid closeout-time audit debt.

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

- [ ] `REF-01`: Template APIs expose `template.grid()` as the canonical transformable shape entrypoint.
- [ ] `REF-02`: `GridView` applies `translate`, `rotate`, and `applyTransform` using shared transform helpers.
- [ ] `REF-03`: `GridView.cells()` yields transformed `{ x, y, alive }` values for every cell consistently across call sites.
- [ ] `REF-04`: Duplicate template/offset-template methods are removed while preserving deterministic match behavior.
- [ ] `REF-05`: At least one additional simplification opportunity is identified and scoped if it can ship safely in this milestone.

### Out of Scope

- Gameplay expansion candidates (`UX2-01`, `UX2-02`, `UX2-03`, `BASE2-01`) stay deferred until post-cleanup milestones.
- Replay/spectator and transport/runtime redesign (`TECH2-01`) are deferred unless cleanup work uncovers a hard blocker.
- Account/auth system and persistent profile storage remain out of scope for current prototype validation.
- Frontend framework migration and renderer migration stay deferred until scale/performance requirements demand them.
- Client-predicted simulation remains out of scope while server-authoritative determinism is a hard constraint.

## Context

- Milestones shipped: `v0.0.1`, `v0.0.2`.
- Delivery model remains backend + deterministic tests first, then runtime/UI integration.
- `v0.0.3` focuses on refactoring shared template/grid primitives before returning to larger gameplay feature expansion.
- Archive-first planning keeps `.planning/ROADMAP.md` compact and milestone-scoped details in `.planning/milestones/`.

## Constraints

- **Tech stack:** TypeScript + Node.js + Socket.IO + Vite.
- **Architecture:** Keep deterministic reusable logic in `packages/*`; keep runtime/socket lifecycle in `apps/*`.
- **Quality gate:** Maintain requirement-traceable unit + integration coverage for each active milestone requirement.
- **Authority model:** Server-authoritative payloads remain the sole source for client gameplay state.

## Key Decisions

| Decision                                                    | Rationale                                                             | Outcome |
| ----------------------------------------------------------- | --------------------------------------------------------------------- | ------- |
| Build as TypeScript-only prototype (no wasm, no protobuf)   | Reduces integration complexity and keeps iteration fast               | ✓ Good  |
| Prioritize lobby/team reliability before deeper strategy    | Setup friction blocks all gameplay validation if left unresolved      | ✓ Good  |
| Treat playable end-to-end match as milestone completion bar | Ensures delivery reflects real player flow, not disconnected features | ✓ Good  |
| Keep server-authoritative deterministic simulation model    | Preserves consistency across runtime layers and tests                 | ✓ Good  |
| Prioritize backend + tests before UI-heavy milestone slices | Reduced UI churn and caught game-rule regressions early in v0.0.2     | ✓ Good  |
| Keep milestone docs archived by version                     | Keeps planning context bounded and historically traceable             | ✓ Good  |

---

_Last updated: 2026-03-03 after v0.0.3 milestone kickoff_
