# Requirements: Conway RTS TypeScript Prototype

**Defined:** 2026-03-01
**Core Value:** Two players can quickly get into a match and use Conway-based strategy to defend their safe cell and breach the opponent's.

## v1 Requirements

Requirements for milestone `v0.0.2 Gameplay Expansion`.

### Structure Systems

- [x] **STRUCT-01**: Player-owned structures run template-wide integrity checks every K ticks, and failed checks consume structure HP to restore integrity deterministically.
- [x] **STRUCT-02**: Player can destroy an owned structure from in-match controls and receive an authoritative destroy outcome.
- [x] **BASE-01**: Match starts with a canonical 5x5 base footprint composed of four 2x2 blocks (16 total base cells) that is used consistently for breach gameplay.

### Build Rules and Placement Controls

- [x] **BUILD-01**: Player can place structures only when the placement footprint lies within the union of build-radius zones from owned structures.
- [x] **BUILD-02**: Build-radius value for union-zone checks is fixed to 15 for this milestone.
- [x] **XFORM-01**: Player can rotate a structure template before preview/queue placement.
- [x] **XFORM-02**: Player can mirror a structure template before preview/queue placement.
- [x] **QUAL-03**: Player sees consistent placement legality between preview, queued result, and applied simulation outcome for standard and transformed placements.

### Match UI and Navigation

- [x] **UI-01**: Player transitions between lobby and in-game screens through explicit match-state transitions (no combined dual-purpose screen).
- [x] **UI-02**: Player can pan and zoom the map during a match without losing placement/control accuracy.
- [x] **UI-03**: Player can hover a structure to view details and available actions.
- [x] **UI-04**: Player can access economy, build options, and team information in grid-adjacent overlays while playing.
- [x] **UI-05**: Player sees the union build-radius outline while placing structures.
- [x] **QUAL-04**: Player gets deterministic outcomes for v0.0.2 structure/build/destroy behaviors across two-client integration scenarios and reconnect cases.

## v2 Requirements

Deferred to future milestones.

### Advanced UX and Meta Systems

- **UX2-01**: Player can use minimap and fog-of-war views for high-scale map awareness.
- **UX2-02**: Player can bulk destroy structures and use undo/redo timeline editing.
- **UX2-03**: Player can create and share custom structure templates.
- **BASE2-01**: Player can choose from multiple base archetypes or custom base geometry.
- **TECH2-01**: System supports replay/spectator and transport/runtime redesign work (if justified by scale).

## Out of Scope

Explicit exclusions for `v0.0.2`.

| Feature                                  | Reason                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Frontend framework migration (React/Vue) | High migration cost with low milestone value; UI modularization can ship on current stack |
| Renderer migration (Pixi/WebGL)          | Canvas 2D is sufficient for current map and overlay scope                                 |
| Client-predicted simulation outcomes     | Conflicts with server-authoritative deterministic model                                   |
| Bulk destroy and timeline editing        | Requires rollback/history semantics and increases desync risk                             |
| Multiple base archetypes                 | Expands balancing/test matrix while base geometry is being standardized                   |

## Traceability

Mapped during roadmap creation.

| Requirement | Phase    | Status   |
| ----------- | -------- | -------- |
| BASE-01     | Phase 6  | Complete |
| STRUCT-01   | Phase 6  | Complete |
| BUILD-01    | Phase 7  | Complete |
| BUILD-02    | Phase 7  | Complete |
| XFORM-01    | Phase 8  | Complete |
| XFORM-02    | Phase 8  | Complete |
| QUAL-03     | Phase 8  | Complete |
| STRUCT-02   | Phase 9  | Complete |
| QUAL-04     | Phase 9  | Complete |
| UI-01       | Phase 10 | Complete |
| UI-02       | Phase 11 | Complete |
| UI-05       | Phase 11 | Complete |
| UI-03       | Phase 12 | Complete |
| UI-04       | Phase 12 | Complete |

**Coverage:**

- v1 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0
- Coverage status: 100% mapped

---

_Requirements defined: 2026-03-01_
_Last updated: 2026-03-02 after completing Phase 11 execution_
