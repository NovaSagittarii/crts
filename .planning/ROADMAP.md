# Roadmap: Conway RTS TypeScript Prototype

## Milestones

- ✅ **v0.0.1 Prototype Baseline** — shipped 2026-03-01 (Phases 1-5). Archive: `.planning/milestones/v0.0.1-ROADMAP.md`
- ✅ **v0.0.2 Gameplay Expansion** — shipped 2026-03-03 (Phases 6-12). Archive: `.planning/milestones/v0.0.2-ROADMAP.md`
- 🚧 **v0.0.3 Template Grid Unification** — planned as Phases 13-18

## Overview

`v0.0.3` unifies transformed template handling behind one canonical `GridView` pipeline so preview, queue, apply, projection, and integrity paths all consume the same geometry contract while preserving deterministic authoritative outcomes.

## Phases

- [x] **Phase 13: GridView Contract and Cell Semantics** - Freeze deterministic transformed cell output used by all downstream geometry consumers. (completed 2026-03-03)
- [ ] **Phase 14: Canonical GridView API Adoption** - Make `template.grid()` and shared transform operations the standard template entrypoint.
- [ ] **Phase 15: Read-Path and Cross-Codebase GridView Unification** - Move read-side geometry and other duplicated transformed-grid paths onto shared GridView utilities.
- [ ] **Phase 16: Write-Path GridView Unification** - Use one GridView-backed geometry flow for preview, queue validation, and build apply.
- [ ] **Phase 17: Legacy Geometry Removal with Outcome Parity** - Remove duplicate template/offset-template logic while preserving authoritative outcomes.
- [ ] **Phase 18: Parity Closure and Migration Cleanup** - Lock parity with tests and retire temporary migration-only assertions.

## Phase Details

### Phase 13: GridView Contract and Cell Semantics

**Goal**: Developers and runtime consumers can rely on one deterministic transformed-cell contract from `GridView.cells()`.
**Depends on**: Nothing (milestone start after Phase 12)
**Requirements**: REF-03
**Success Criteria** (what must be TRUE):

1. Developers can inspect transformed `GridView.cells()` output and see deterministic `{ x, y, alive }` entries covering every transformed cell.
2. Re-running the same transform sequence yields identical `cells()` ordering and coordinates across runs.
3. Geometry consumers observe no dropped dead-cells or duplicate coordinates when deriving transformed bounds.

**Plans**: 13-01-PLAN.md

### Phase 14: Canonical GridView API Adoption

**Goal**: `template.grid()` plus shared GridView transforms become the canonical way to obtain transformed template geometry.
**Depends on**: Phase 13
**Requirements**: REF-01, REF-02
**Success Criteria** (what must be TRUE):

1. Engine callers can access transformable template geometry through `template.grid()` without relying on legacy offset-template entrypoints.
2. `GridView.translate`, `GridView.rotate`, and `GridView.applyTransform` produce the same placement semantics users already expect.
3. Rotated/translated placement previews remain behaviorally unchanged for equivalent user inputs.

**Plans**: TBD

### Phase 15: Read-Path and Cross-Codebase GridView Unification

**Goal**: Read-side geometry and other applicable duplicated transformed-grid code paths are unified on shared GridView utilities.
**Depends on**: Phase 14
**Requirements**: REF-05, REF-07
**Success Criteria** (what must be TRUE):

1. Structure projection, build-zone contributor projection, and integrity-mask reads show the same transformed cells as before migration.
2. Players continue seeing stable structure/build-zone overlays across reconnects and repeated transform scenarios.
3. Other applicable duplicate transformed-grid code paths (including integration helper size estimation paths) now use shared GridView/transform utilities and return matching results.

**Plans**: TBD

### Phase 16: Write-Path GridView Unification

**Goal**: Preview, queue validation, and build apply behavior all flow through one GridView-backed geometry pipeline.
**Depends on**: Phase 15
**Requirements**: REF-04
**Success Criteria** (what must be TRUE):

1. For the same placement input, preview legality and queue validation return matching accept/reject outcomes in every transform orientation.
2. Accepted builds apply to the same transformed coordinates shown during preview.
3. Players observe unchanged rejection reasons and resource-cost outcomes while write paths share one geometry source.

**Plans**: TBD

### Phase 17: Legacy Geometry Removal with Outcome Parity

**Goal**: Duplicate template/offset-template logic in authoritative engine paths is removed without changing gameplay outcomes.
**Depends on**: Phase 16
**Requirements**: REF-06
**Success Criteria** (what must be TRUE):

1. Representative match flows produce the same authoritative accept/reject outcomes after duplicate path removal.
2. Clients continue receiving the same rejection taxonomy and outcome behavior for equivalent invalid actions.
3. Deterministic reruns of the same action timelines end in the same structure/resource state as pre-cleanup baselines.

**Plans**: TBD

### Phase 18: Parity Closure and Migration Cleanup

**Goal**: Parity is proven across core gameplay flows and temporary migration assertions are fully retired before milestone close.
**Depends on**: Phase 17
**Requirements**: REF-08, REF-09
**Success Criteria** (what must be TRUE):

1. Unit and integration test runs demonstrate parity for preview, queue, apply, integrity, and structure-key stability across representative transform sequences.
2. Temporary old-vs-new migration assertions are absent from shipped code while parity suites continue to pass.
3. Developers can verify milestone completion without gameplay drift or authoritative contract changes.

**Plans**: TBD

## Progress

| Phase                                                 | Plans Complete | Status      | Completed |
| ----------------------------------------------------- | -------------- | ----------- | --------- |
| 13. GridView Contract and Cell Semantics              | 1/1 | Complete   | 2026-03-03 |
| 14. Canonical GridView API Adoption                   | 0/TBD          | Not started | -         |
| 15. Read-Path and Cross-Codebase GridView Unification | 0/TBD          | Not started | -         |
| 16. Write-Path GridView Unification                   | 0/TBD          | Not started | -         |
| 17. Legacy Geometry Removal with Outcome Parity       | 0/TBD          | Not started | -         |
| 18. Parity Closure and Migration Cleanup              | 0/TBD          | Not started | -         |

## Requirement Coverage

| Requirement | Phase    |
| ----------- | -------- |
| REF-01      | Phase 14 |
| REF-02      | Phase 14 |
| REF-03      | Phase 13 |
| REF-04      | Phase 16 |
| REF-05      | Phase 15 |
| REF-06      | Phase 17 |
| REF-07      | Phase 15 |
| REF-08      | Phase 18 |
| REF-09      | Phase 18 |

Coverage: 9/9 v0.0.3 requirements mapped (0 unmapped).
