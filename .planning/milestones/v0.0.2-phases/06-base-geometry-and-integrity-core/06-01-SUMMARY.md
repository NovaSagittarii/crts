---
phase: 06-base-geometry-and-integrity-core
plan: '01'
subsystem: engine
tags: [rts-engine, geometry, spawn, territory, base-01]

# Dependency graph
requires:
  - phase: 05-quality-gate-validation
    provides: Stable deterministic unit/integration harness used to lock geometry behavior.
provides:
  - Canonical 5x5 base footprint helpers and center semantics shared by engine and tests.
  - Spawn, territory, and payload logic wired to the same base geometry contract.
  - BASE-01 unit assertions for seeded footprint occupancy and empty center cross cells.
affects: [06-02-plan, phase-07-build-zones, integration-fixtures]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Shared geometry source-of-truth (`geometry.ts`) for base occupancy and center calculations.
    - Shared gameplay constants module (`gameplay-rules.ts`) for spawn spacing and integrity cadence config.

key-files:
  created:
    - packages/rts-engine/gameplay-rules.ts
    - .planning/phases/06-base-geometry-and-integrity-core/06-01-SUMMARY.md
  modified:
    - packages/rts-engine/geometry.ts
    - packages/rts-engine/rts.ts
    - packages/rts-engine/spawn.test.ts
    - packages/rts-engine/rts.test.ts
    - packages/rts-engine/index.ts

key-decisions:
  - Replace hardcoded 2x2/+1 math with canonical helpers (`isCanonicalBaseCell`, `getBaseCenter`) used by seeding, territory checks, and snapshots.
  - Enforce 5x5 spawn dimensions and `3 * baseWidth` separation, with deterministic seeded fallback when torus layout constraints fail.

patterns-established:
  - 'BASE-01 Pattern: Canonical base logic is helper-driven and referenced by both runtime and tests.'
  - 'Determinism Pattern: Spawn fallback scans positions in seeded deterministic order with stable wrapped-distance checks.'

requirements-completed: [BASE-01]

# Metrics
duration: 24 min
completed: 2026-03-02
---

# Phase 06 Plan 01: Canonical Base Geometry Summary

**RTS engine base behavior now uses one canonical 5x5 contract, so spawn, territory, and seeded base occupancy all agree on the same 16-cell footprint.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-03-02T01:22:00Z
- **Completed:** 2026-03-02T01:46:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added shared base helpers in `packages/rts-engine/geometry.ts` for canonical occupancy, base center offset, and absolute base-cell projection.
- Added shared gameplay constants in `packages/rts-engine/gameplay-rules.ts` and wired RTS spawn logic to 5x5 footprint sizing and spacing constraints.
- Reworked unit assertions in `packages/rts-engine/rts.test.ts` and `packages/rts-engine/spawn.test.ts` to lock BASE-01 behavior.

## task Commits

Implementation was delivered in one cross-cutting engine commit because `packages/rts-engine/rts.ts` carries both geometry and integrity pipeline wiring:

1. **task 1: implement canonical 5x5 base helper and engine wiring** - `bcc1266` (feat)
2. **task 2: lock BASE-01 with deterministic unit fixtures** - `bcc1266` (test)

## Files Created/Modified

- `packages/rts-engine/geometry.ts` - Canonical 5x5 footprint helpers and center helper.
- `packages/rts-engine/gameplay-rules.ts` - Shared gameplay constants for spawn spacing and integrity cadence.
- `packages/rts-engine/rts.ts` - 5x5 seeding, territory center math, and deterministic spawn fallback wiring.
- `packages/rts-engine/spawn.test.ts` - Spawn-layout checks aligned to 5x5 footprint constraints.
- `packages/rts-engine/rts.test.ts` - BASE-01 shape assertions for 16 occupied cells and empty center cross.

## Decisions Made

- Keep canonical footprint semantics in `geometry.ts` and import from engine/tests to prevent future drift.
- Keep spawn-layout generation unchanged and add deterministic fallback selection only when strict torus layout generation fails.

## Deviations from Plan

None - plan goals were met without scope creep.

## Issues Encountered

- Existing integration fixtures assumed base-adjacent placements that now overlap the 5x5 footprint; helper-based candidate filtering was added in Plan 02 test updates.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- BASE-01 geometry contract is now fixed in runtime and unit tests.
- Ready for template-wide integrity and server-facing deterministic outcome coverage in `06-02-PLAN.md`.

---

_Phase: 06-base-geometry-and-integrity-core_
_Completed: 2026-03-02_

## Self-Check: PASSED

- Found `packages/rts-engine/geometry.ts` canonical helper exports.
- Found `packages/rts-engine/gameplay-rules.ts` shared constants.
- Found commit `bcc1266` containing geometry + spawn + unit assertions.
