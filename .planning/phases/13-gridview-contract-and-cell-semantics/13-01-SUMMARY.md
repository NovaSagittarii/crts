---
phase: 13-gridview-contract-and-cell-semantics
plan: 01
subsystem: rts-engine
tags: [gridview, placement-transform, deterministic-geometry, vitest]

# Dependency graph
requires:
  - phase: 12-structure-hover-and-tactical-overlays
    provides: stable deterministic package testing baseline and prior geometry projection behavior to preserve
provides:
  - Canonical `GridView.cells()` contract with deterministic traversal order and duplicate-coordinate rejection
  - Placement transform integration that exposes `gridView` while preserving existing transformed cell values
  - Regression tests for dead-cell inclusion, negative coordinates, deterministic ordering, and duplicate failures
affects:
  [
    packages/rts-engine/placement-transform.ts,
    packages/rts-engine/index.ts,
    phase-14-gridview-api-adoption,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - OOP `GridView` object centralizes transformed-cell validation, traversal order, and lookup behavior
    - Placement transforms project all source cells into `GridView` entries and preserve raw template bytes for existing engine consumers

key-files:
  created:
    - packages/rts-engine/grid-view.ts
    - packages/rts-engine/grid-view.test.ts
  modified:
    - packages/rts-engine/index.ts
    - packages/rts-engine/placement-transform.ts
    - packages/rts-engine/placement-transform.test.ts

key-decisions:
  - 'Use `GridView.fromCells()` as the single duplicate-coordinate validation gate for transformed cell traversal output.'
  - 'Preserve `TransformedTemplate.cells` source byte semantics while exposing `GridView` alive/dead contract to avoid regressions in existing engine logic.'

patterns-established:
  - 'Pattern 1: Keep full transformed footprint in `GridView.cells()` and derive alive-only projections with dedicated helpers.'
  - 'Pattern 2: Assert duplicate-coordinate failure behavior in both direct GridView tests and placement-transform integration tests.'

requirements-completed: [REF-03]

# Metrics
duration: 7m 58s
completed: 2026-03-03
---

# Phase 13 Plan 01: GridView Contract and Cell Semantics Summary

**RTS geometry now exposes a deterministic `GridView.cells()` contract for every transformed cell while preserving prior transformed template byte behavior for downstream engine paths.**

## Performance

- **Duration:** 7m 58s
- **Started:** 2026-03-03T03:27:40Z
- **Completed:** 2026-03-03T03:35:38Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added `GridView` as an OOP domain contract exposing deterministic traversal-ordered `{ x, y, alive }` cells, bounds, lookup, occupied-cell projection, and duplicate-coordinate errors.
- Exported the new `GridView` API from the package entrypoint so downstream geometry consumers can use one canonical transformed-cell contract.
- Integrated placement transforms to build and return `gridView` alongside existing transformed template data without breaking existing `cells` semantics.
- Expanded unit coverage for dead-cell inclusion, deterministic ordering across repeated transforms, negative coordinate preservation, and duplicate-coordinate failure behavior.

## task Commits

Each task was committed atomically:

1. **task 1: create OOP GridView contract module** - `545b6cb` (feat)
2. **task 2: integrate GridView into placement transforms** - `13031d0` (feat)
3. **task 3: expand deterministic contract coverage tests** - `d84eddb` (fix)

**Plan metadata:** pending (created after state/roadmap updates)

## Files Created/Modified

- `packages/rts-engine/grid-view.ts` - Adds the canonical `GridView` class with deterministic `cells()` contract, bounds, occupancy, lookup, and duplicate validation.
- `packages/rts-engine/grid-view.test.ts` - Covers traversal ordering with dead cells, negative coordinate handling, and duplicate-coordinate rejection.
- `packages/rts-engine/placement-transform.ts` - Projects transformed template cells through `GridView` and returns `gridView` on `TransformedTemplate` while preserving raw transformed bytes.
- `packages/rts-engine/placement-transform.test.ts` - Adds contract assertions for deterministic `gridView.cells()` output and duplicate transform failures.
- `packages/rts-engine/index.ts` - Exports the `GridView` API from the package surface.

## Decisions Made

- Kept `GridView` focused on transformed-cell semantics (ordering, duplication, and alive/dead contract) so future read/write path migration can share one deterministic source.
- Preserved `TransformedTemplate.cells` raw values after integrating `GridView` to avoid changing existing engine logic that relies on template byte semantics.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved non-binary transformed template cell values during GridView integration**

- **Found during:** task 3 (Expand deterministic contract coverage tests)
- **Issue:** Initial integration rebuilt transformed cells from `alive` booleans, collapsing non-binary template bytes and risking engine behavior regressions.
- **Fix:** Restored transform-time assignment from source template bytes while keeping `GridView` contract generation and duplicate validation intact.
- **Files modified:** `packages/rts-engine/placement-transform.ts`, `packages/rts-engine/placement-transform.test.ts`
- **Verification:** `npx vitest run packages/rts-engine/grid-view.test.ts packages/rts-engine/placement-transform.test.ts`
- **Committed in:** `d84eddb`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix preserved backward compatibility and kept REF-03 contract guarantees intact.

## Issues Encountered

- `npm run test:unit` currently fails in pre-existing `packages/rts-engine/rts.test.ts` and `packages/rts-engine/build-zone.test.ts` cases unrelated to files changed in this plan; targeted phase tests pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 13 now exposes a deterministic transformed-cell contract that Phase 14 can adopt as the canonical template GridView API.
- No blockers identified for moving to Phase 14 planning/execution.

## Self-Check: PASSED

- Verified `packages/rts-engine/grid-view.ts` and `packages/rts-engine/grid-view.test.ts` exist on disk.
- Verified task commit hashes `545b6cb`, `13031d0`, and `d84eddb` exist in git history.

---

_Phase: 13-gridview-contract-and-cell-semantics_
_Completed: 2026-03-03_
