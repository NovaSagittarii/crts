---
phase: 17-legacy-geometry-removal-with-outcome-parity
plan: 01
subsystem: rts-engine
tags: [authoritative-geometry, parity, build-evaluation, migration]

# Dependency graph
requires:
  - phase: 16-write-path-gridview-unification
    provides: shared transformed write projection/diff/apply helpers and baseline parity checks
provides:
  - Shared authoritative build-evaluation helper module for projection, legality, diff, and affordability checks
  - RTS runtime orchestration wired to one canonical authoritative geometry helper surface
  - Temporary migration parity checkpoints for preview, queue, and execute-time boundaries
affects:
  [
    packages/rts-engine/template-grid-authoritative.ts,
    packages/rts-engine/template-grid-authoritative.test.ts,
    packages/rts-engine/rts.ts,
    packages/rts-engine/rts.test.ts,
    packages/rts-engine/index.ts,
    phase-17-plan-02,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Route transformed authoritative placement evaluation through one helper module shared by preview and execute-time revalidation.
    - Keep rejection ordering orchestration in `rts.ts` while deleting duplicate projection/compare/apply glue.

key-files:
  created:
    - packages/rts-engine/template-grid-authoritative.ts
    - packages/rts-engine/template-grid-authoritative.test.ts
    - .planning/phases/17-legacy-geometry-removal-with-outcome-parity/17-01-SUMMARY.md
  modified:
    - packages/rts-engine/rts.ts
    - packages/rts-engine/rts.test.ts
    - packages/rts-engine/index.ts

key-decisions:
  - Keep helper-level legacy-vs-new parity checks in tests only, not runtime paths.
  - Keep temporary migration guards explicit and tagged for Phase 18 cleanup.

patterns-established:
  - 'Pattern 1: evaluate authoritative transformed placements through a single projection+diff+affordability surface.'
  - 'Pattern 2: preserve rejection precedence by reusing helper output while leaving orchestration guard ordering intact.'

requirements-completed: [REF-06]

# Metrics
duration: in-session
completed: 2026-03-03
---

# Phase 17 Plan 01: Authoritative Geometry Helper Extraction Summary

**Authoritative build placement evaluation now runs through one shared helper module, and duplicate transformed traversal glue has been removed from `rts.ts` without changing rejection or resource semantics.**

## Performance

- **Duration:** in-session
- **Started:** 2026-03-03
- **Completed:** 2026-03-03
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added `packages/rts-engine/template-grid-authoritative.ts` with canonical transformed projection, legality, diff, affordability, and apply helper APIs for authoritative build evaluation.
- Added `packages/rts-engine/template-grid-authoritative.test.ts` with deterministic helper parity checks against legacy evaluation glue, template-size rejection coverage, and apply-mutation parity assertions.
- Rewired `packages/rts-engine/rts.ts` preview, queue revalidation, and execute-time apply paths to call shared authoritative helpers instead of local duplicate glue.
- Added temporary migration parity checkpoints in `packages/rts-engine/rts.test.ts` to guard representative preview/queue/execute boundary behavior until Phase 18 cleanup.
- Exported the authoritative helper module from `packages/rts-engine/index.ts` for package-level consumers and tests.

## task Commits

Each task was committed atomically:

1. **task 1: Create shared authoritative build-evaluation helper module** - `4d9bfd9` (feat)
2. **task 2: Rewire `rts.ts` preview and execute-time build evaluation** - `21dbafb` (refactor)
3. **task 3: Add temporary migration parity assertions** - `7276aed` (test)

**Plan metadata:** pending

## Files Created/Modified

- `packages/rts-engine/template-grid-authoritative.ts` - authoritative transformed placement evaluation helper surface.
- `packages/rts-engine/template-grid-authoritative.test.ts` - helper-level deterministic parity and rejection-order regression coverage.
- `packages/rts-engine/rts.ts` - preview/queue/execute orchestration routed to shared authoritative helper APIs.
- `packages/rts-engine/rts.test.ts` - temporary migration parity checkpoints for representative action boundaries.
- `packages/rts-engine/index.ts` - package export surface includes `template-grid-authoritative`.

## Decisions Made

- Keep helper extraction focused on geometry/evaluation logic while preserving orchestration order in `rts.ts`.
- Keep temporary migration guards in tests only, with explicit Phase 18 retirement intent.

## Deviations from Plan

None - plan executed as intended.

## Issues Encountered

- Full `npx vitest run packages/rts-engine/template-grid-authoritative.test.ts packages/rts-engine/rts.test.ts` still reports 16 pre-existing failures in legacy `rts.test.ts` cases outside Phase 17 scope.

## User Setup Required

None - no external services or credentials required.

## Next Phase Readiness

- Authoritative helper extraction is complete and parity-guarded.
- Phase 17 Plan 02 can focus on representative runtime boundary parity evidence and deterministic rerun checkpoints.

---

_Phase: 17-legacy-geometry-removal-with-outcome-parity_
_Completed: 2026-03-03_
