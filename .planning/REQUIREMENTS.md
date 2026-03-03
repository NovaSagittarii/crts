# Requirements: Conway RTS TypeScript Prototype

**Defined:** 2026-03-03
**Core Value:** Two players can quickly get into a match and use Conway-based strategy to defend their safe cell and breach the opponent's.

## v0.0.3 Requirements

Requirements for milestone `v0.0.3 Template Grid Unification`.

### GridView Core API

- [ ] **REF-01**: Engine exposes `template.grid()` as the canonical transformable template entrypoint.
- [ ] **REF-02**: `GridView` supports `translate`, `rotate`, and `applyTransform` with semantics equivalent to existing placement transforms.
- [x] **REF-03**: `GridView.cells()` emits deterministic transformed `{ x, y, alive }` entries for every cell in transformed bounds (not alive-only and no duplicates).

### Engine Path Unification

- [ ] **REF-04**: Build preview, queue validation, and build apply flows use the same `GridView`-backed geometry pipeline.
- [ ] **REF-05**: Structure projection, build-zone contributor projection, and integrity-mask checks use the same `GridView`-backed geometry pipeline.
- [ ] **REF-06**: Duplicate template/offset-template logic in `packages/rts-engine/rts.ts` is removed without changing authoritative rejection reasons, resource costs, or applied outcomes.
- [ ] **REF-07**: Other applicable code paths that duplicate transformed-grid logic (for example integration test helpers that estimate transformed template size) are migrated to shared transform/`GridView` utilities.

### Verification and Migration Safety

- [ ] **REF-08**: Unit and integration tests prove parity for preview, queue, apply, integrity, and structure-key stability across representative transform sequences.
- [ ] **REF-09**: Temporary old-vs-new assertions are used during migration and removed before milestone close once parity is proven.

## v0.0.4+ Requirements

Deferred requirements not included in the v0.0.3 roadmap.

### Gameplay Expansion Candidates

- **UX2-01**: Minimap and fog-of-war map awareness.
- **UX2-02**: Bulk destroy and undo/redo timeline controls.
- **UX2-03**: Custom structure template authoring/sharing.
- **BASE2-01**: Multiple base archetypes or configurable base geometry.
- **TECH2-01**: Replay/spectator plus transport/runtime redesign if justified.

### Refactor Follow-ups

- **REF-10**: Add transform projection caching only when profiling demonstrates a hotspot and deterministic cache keys are verified.

## Out of Scope

| Feature                                                                | Reason                                                                           |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Expanded transform model (arbitrary-angle rotation, scaling, shearing) | Increases transform validation risk and is not required for v0.0.3 cleanup goals |
| Socket payload contract changes for build transforms                   | Milestone focuses on internal engine unification, not wire protocol evolution    |
| New external geometry/schema dependencies                              | Existing shared transform utilities already cover required semantics             |
| Frontend framework or renderer migration                               | Unrelated architecture churn during deterministic refactor work                  |
| Account/auth system and persistent profiles                            | Not part of current prototype validation scope                                   |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase    | Status   |
| ----------- | -------- | -------- |
| REF-01      | Phase 14 | Pending  |
| REF-02      | Phase 14 | Pending  |
| REF-03      | Phase 13 | Complete |
| REF-04      | Phase 16 | Pending  |
| REF-05      | Phase 15 | Pending  |
| REF-06      | Phase 17 | Pending  |
| REF-07      | Phase 15 | Pending  |
| REF-08      | Phase 18 | Pending  |
| REF-09      | Phase 18 | Pending  |

**Coverage:**

- v0.0.3 requirements: 9 total
- Mapped to phases: 9 ✅
- Unmapped: 0

---

_Requirements defined: 2026-03-03_
_Last updated: 2026-03-03 after Phase 13 execution_
