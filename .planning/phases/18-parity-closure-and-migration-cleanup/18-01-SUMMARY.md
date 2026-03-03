---
phase: 18-parity-closure-and-migration-cleanup
plan: 01
subsystem: rts-engine
tags: [parity-closure, migration-cleanup, authoritative-tests]

# Dependency graph
requires:
  - phase: 17-legacy-geometry-removal-with-outcome-parity
    provides: temporary migration guards and representative transformed parity checkpoints
provides:
  - Canonical expected-outcome assertions for authoritative transformed evaluation scenarios
  - Representative runtime timeline parity test retained as a permanent contract gate
  - Removal of temporary migration-only guard markers from unit suites
affects:
  [
    packages/rts-engine/template-grid-authoritative.test.ts,
    packages/rts-engine/rts.test.ts,
    phase-18-plan-02,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Replace old-vs-new mirrors with explicit expected outcomes for transformed success and rejection paths.
    - Keep deterministic rerun comparison while asserting canonical resource and structure checkpoints.

key-files:
  created:
    - .planning/phases/18-parity-closure-and-migration-cleanup/18-01-SUMMARY.md
  modified:
    - packages/rts-engine/template-grid-authoritative.test.ts
    - packages/rts-engine/rts.test.ts

key-decisions:
  - Keep representative transformed projection invariants explicit (`bounds`, `footprint`, `checks`, `worldCells`, `illegalCells`) instead of comparing against legacy helper scaffolding.
  - Retain action-boundary rerun equivalence and add explicit resource/structure checkpoints without widening runtime scope.

patterns-established:
  - 'Pattern 1: prove transformed parity with canonical expected outcomes, not historical implementation mirrors.'
  - 'Pattern 2: keep representative preview/queue/execute timeline checkpoints as deterministic contract gates.'

requirements-completed: [REF-08, REF-09]

# Metrics
duration: in-session
completed: 2026-03-03
---

# Phase 18 Plan 01: Unit Migration Guard Retirement Summary

**Temporary migration-only unit parity scaffolding was removed and replaced with canonical transformed outcome assertions while preserving deterministic preview/queue/execute timeline parity gates.**

## Performance

- **Duration:** in-session
- **Started:** 2026-03-03
- **Completed:** 2026-03-03
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Replaced the legacy mirror harness in `packages/rts-engine/template-grid-authoritative.test.ts` with explicit transformed expected outcomes for success, `insufficient-resources`, `outside-territory`, and `template-exceeds-map-size` scenarios.
- Removed migration-marker language and promoted representative timeline parity in `packages/rts-engine/rts.test.ts` to a permanent transformed preview/queue/execute checkpoint.
- Added explicit resource and structure-key stability assertions to keep parity drift diagnosable without reintroducing old-vs-new comparators.

## task Commits

Each task was committed atomically:

1. **task 1: Replace authoritative legacy mirror harness with canonical expected outcomes** - `1cf867f` (test)
2. **task 2: Promote representative runtime timeline parity guard to permanent contract language** - `1cf867f` (test)
3. **task 3: Re-run targeted unit parity gates after migration cleanup** - `1cf867f` (test)

## Verification Commands

- `npx vitest run packages/rts-engine/template-grid-authoritative.test.ts` (pass)
- `npx vitest run packages/rts-engine/rts.test.ts -t "keeps representative transformed action-timeline parity across preview, queue, and execute checkpoints"` (pass)
- `npx vitest run packages/rts-engine/rts.test.ts -t "preserves occupied-site precedence over insufficient resources at execute time"` (pass)

## Files Created/Modified

- `packages/rts-engine/template-grid-authoritative.test.ts` - canonical transformed expected-outcome assertions replace migration-only old-vs-new checks.
- `packages/rts-engine/rts.test.ts` - representative timeline parity guard wording and checkpoints finalized for permanent coverage.

## Decisions Made

- Keep assertions centered on observable contract data (reasons, affordability metadata, transformed projection outputs) rather than implementation parity mirrors.
- Keep phase scope strictly test-only; no authoritative runtime behavior changes.

## Deviations from Plan

None - plan executed as intended.

## Issues Encountered

None within plan scope.

## Next Phase Readiness

- Unit migration guard retirement is complete and parity gates are green.
- Phase 18 Plan 02 can finalize runtime-boundary parity evidence and milestone-level verification.

---

_Phase: 18-parity-closure-and-migration-cleanup_
_Completed: 2026-03-03_
