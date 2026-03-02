# Roadmap: Conway RTS TypeScript Prototype

## Milestones

- ✅ **v0.0.1 Prototype Baseline** — shipped 2026-03-01 (Phases 1-5). Archive: `.planning/milestones/v0.0.1-ROADMAP.md`
- 🚧 **v0.0.2 Gameplay Expansion** — planned in this roadmap (Phases 6-12)

## Overview

v0.0.2 expands deterministic gameplay through structure integrity rules, base-geometry pressure updates, union build zones, transform-aware placement, destroy interactions, and focused match UI improvements. Phase order follows the milestone constraint: backend and test coverage first, then UI-heavy integration work.

## Phases

**Phase Numbering:**

- Integer phases (6, 7, 8...) are planned milestone work.
- Decimal phases (for example 8.1) are reserved for urgent insertions.

- [x] **Phase 6: Base Geometry and Integrity Core** - Ship canonical 5x5 base behavior and deterministic template-wide integrity repair. (completed 2026-03-02)
- [x] **Phase 7: Authoritative Union Build Zones** - Enforce radius-15 union-zone build eligibility from owned structures. (completed 2026-03-02)
- [x] **Phase 8: Transform Placement Consistency** - Add rotate/mirror placement with preview, queue, and simulation parity. (completed 2026-03-02)
- [ ] **Phase 9: Destroy Flow and Determinism Gates** - Deliver authoritative destroy outcomes and two-client/reconnect determinism coverage.
- [ ] **Phase 10: Match Screen Transition Split** - Separate lobby and in-game screens with explicit match-state navigation.
- [ ] **Phase 11: Camera and Build-Zone Visualization** - Add pan/zoom with accurate controls and live union-zone outlines.
- [ ] **Phase 12: Structure Hover and Tactical Overlays** - Provide structure details/actions plus grid-adjacent economy/build/team overlays.

## Phase Details

### Phase 6: Base Geometry and Integrity Core

**Goal**: Players start on the new 5x5 base geometry and structures self-repair integrity deterministically over time.
**Depends on**: Nothing (milestone start; follows shipped Phase 5)
**Requirements**: BASE-01, STRUCT-01
**Success Criteria** (what must be TRUE):

1. New matches spawn each team's base using the same canonical 5x5 footprint with exactly 16 base cells.
2. Breach pressure and base-related outcomes behave consistently with the new 5x5 footprint.
3. All player-owned structure templates run integrity checks on a fixed K-tick cadence during active matches.
4. When an integrity check fails, the structure loses HP and integrity is restored with deterministic outcomes across identical runs.

**Plans**: 2/2 plans complete

Plans:

- [x] 06-01-PLAN.md — Canonicalize 5x5 base geometry helpers and wire spawn/territory/breach math to shared footprint logic.
- [x] 06-02-PLAN.md — Implement template-wide integrity HP/repair rules and lock deterministic defeat/base-intact behavior with integration coverage.

### Phase 7: Authoritative Union Build Zones

**Goal**: Placement legality is controlled by the union of build-radius zones from owned structures.
**Depends on**: Phase 6
**Requirements**: BUILD-01, BUILD-02
**Success Criteria** (what must be TRUE):

1. A player can queue a structure only when its full footprint is inside the union of that player's build zones.
2. Any placement outside the union zone is rejected with an authoritative result.
3. Build-zone eligibility uses a fixed radius of 15 for all union-zone checks in this milestone.
4. Build eligibility updates after structure creation and structure destruction events.

**Plans**: 1/1 plans complete

Plans:

- [x] 07-01-PLAN.md — Replace territory-center legality with authoritative full-footprint union-zone checks (radius 15), then align runtime feedback and deterministic integration fixtures.

### Phase 8: Transform Placement Consistency

**Goal**: Players can use rotate and mirror controls while keeping legality and outcomes consistent across systems.
**Depends on**: Phase 7
**Requirements**: XFORM-01, XFORM-02, QUAL-03
**Success Criteria** (what must be TRUE):

1. A player can rotate a template before preview and queueing placement.
2. A player can mirror a template before preview and queueing placement.
3. Preview legality for transformed and non-transformed placements matches queue acceptance or rejection.
4. Accepted transformed placements resolve in simulation using the same footprint and orientation the player previewed.

**Plans**: 3 plans

Plans:

- [x] 08-01-PLAN.md — Build canonical transform-aware engine placement pipeline with matrix composition, wrapped-footprint legality, and persisted transform metadata.
- [x] 08-02-PLAN.md — Extend server preview/queue runtime to transform-aware payloads and lock authoritative parity with integration coverage.
- [x] 08-03-PLAN.md — Implement web rotate/mirror/cancel placement controls with transformed preview rendering and queue feedback parity.

### Phase 9: Destroy Flow and Determinism Gates

**Goal**: Players can destroy owned structures through authoritative controls, and v0.0.2 gameplay stays deterministic across multiplayer and reconnect flows.
**Depends on**: Phase 8
**Requirements**: STRUCT-02, QUAL-04
**Success Criteria** (what must be TRUE):

1. A player can issue an in-match destroy command for an owned structure and receive one authoritative destroy outcome.
2. Invalid destroy attempts (wrong owner, invalid target, or invalid lifecycle state) are rejected deterministically.
3. After an accepted destroy, both connected players observe the same structure removal and updated build eligibility.
4. Two-client and reconnect scenarios preserve deterministic structure/build/destroy outcomes without client divergence.

**Plans**: 3 plans

Plans:

- [x] 09-01-PLAN.md — Build deterministic engine destroy queue primitives, rejection taxonomy, and reconnect-safe structure projection.
- [x] 09-02-PLAN.md — Wire server destroy runtime and add two-client plus reconnect determinism integration gates.
- [ ] 09-03-PLAN.md — Add web destroy controls with owned-selection gating, base confirmation, pending feedback, and reconnect sync UX.

### Phase 10: Match Screen Transition Split

**Goal**: Navigation cleanly separates lobby and in-game experiences through explicit match-state transitions.
**Depends on**: Phase 9
**Requirements**: UI-01
**Success Criteria** (what must be TRUE):

1. Players see a dedicated lobby screen before active gameplay and a dedicated in-game screen during matches.
2. Screen transitions happen only from authoritative match-state changes.
3. Reconnecting players land on the correct screen for the current match state.

**Plans**: TBD

### Phase 11: Camera and Build-Zone Visualization

**Goal**: Players can move around the map with pan/zoom while preserving precise placement and control interactions.
**Depends on**: Phase 10
**Requirements**: UI-02, UI-05
**Success Criteria** (what must be TRUE):

1. Players can pan and zoom the map during matches using supported inputs.
2. Placement and control targeting stays accurate at supported zoom levels.
3. While placing structures, the player sees the authoritative union build-radius outline.
4. The union-zone outline updates when structures are added or destroyed.

**Plans**: TBD

### Phase 12: Structure Hover and Tactical Overlays

**Goal**: Players can inspect structures and use nearby overlays for economy, build, and team decision-making.
**Depends on**: Phase 11
**Requirements**: UI-03, UI-04
**Success Criteria** (what must be TRUE):

1. Hovering a structure shows actionable details and available interactions for that structure.
2. Players can access economy, build, and team overlays adjacent to the grid while continuing normal gameplay.
3. Overlay and hover data remain synchronized with authoritative match updates.
4. Structure actions selected from interaction surfaces provide immediate authoritative feedback to the player.

**Plans**: TBD

## Progress

| Phase                                     | Plans Complete | Status      | Completed  |
| ----------------------------------------- | -------------- | ----------- | ---------- |
| 6. Base Geometry and Integrity Core       | 2/2            | Complete    | 2026-03-02 |
| 7. Authoritative Union Build Zones        | 1/1            | Complete    | 2026-03-02 |
| 8. Transform Placement Consistency        | 3/3            | Complete    | 2026-03-02 |
| 9. Destroy Flow and Determinism Gates     | 2/3            | In Progress |            |
| 10. Match Screen Transition Split         | 0/TBD          | Not started | -          |
| 11. Camera and Build-Zone Visualization   | 0/TBD          | Not started | -          |
| 12. Structure Hover and Tactical Overlays | 0/TBD          | Not started | -          |
