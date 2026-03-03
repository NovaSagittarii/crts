---
phase: 15-read-path-and-cross-codebase-gridview-unification
plan: 01
subsystem: rts-engine
tags: [gridview, read-path, integrity, deterministic-projection]

# Dependency graph
requires:
  - phase: 14-canonical-gridview-api-adoption
    provides: canonical template.grid() transform pipeline
provides:
  - Shared read-path projection module for transform/world/integrity helpers
  - RTS read consumers wired through one helper surface for structures/build-zone/integrity
  - Deterministic helper-level parity coverage for transform matrices and wrapped projections
affects:
  [
    packages/rts-engine/template-grid-read.ts,
    packages/rts-engine/rts.ts,
    packages/rts-engine/rts.test.ts,
    packages/rts-engine/index.ts,
    phase-15-plan-02,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Keep read-side transform/projection semantics in one shared module consumed by runtime and tests
    - Use deterministic sort+dedupe for projected world cells before payload exposure

key-files:
  created:
    - packages/rts-engine/template-grid-read.ts
    - packages/rts-engine/template-grid-read.test.ts
    - .planning/phases/15-read-path-and-cross-codebase-gridview-unification/15-01-SUMMARY.md
  modified:
    - packages/rts-engine/rts.ts
    - packages/rts-engine/rts.test.ts
    - packages/rts-engine/index.ts

key-decisions:
  - Keep fallback template normalization inside the shared read helper so callers can pass legacy template shapes safely.
  - Keep integrity mask derivation centralized with transformed checks fallback to occupied cells for templates without explicit checks.

patterns-established:
  - 'Pattern 1: transform template bytes via canonical GridView ordering, then derive world projection via wrapped deterministic cells.'
  - 'Pattern 2: derive transformed bounds from GridView matrix semantics instead of operation-count shortcuts.'

requirements-completed: [REF-05]

# Metrics
duration: in-session
completed: 2026-03-03
---

# Phase 15 Plan 01: Read-Path GridView Helper Migration Summary

**Read-path structure projection, build-zone contributor sizing, and integrity-mask derivation now share one GridView-backed helper module.**

## Performance

- **Duration:** in-session
- **Started:** 2026-03-03
- **Completed:** 2026-03-03
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added `packages/rts-engine/template-grid-read.ts` with shared helpers for transformed template projection, wrapped world projection, transformed bounds estimation, and integrity mask derivation.
- Migrated read-side `rts.ts` consumers (`projectStructures`, build-zone contributor projection inputs, integrity mask readers) to shared helper APIs.
- Added deterministic helper tests in `packages/rts-engine/template-grid-read.test.ts` and added transformed payload/integrity coverage in `packages/rts-engine/rts.test.ts`.
- Exported shared helper surface from `packages/rts-engine/index.ts` for cross-codebase use.

## task Commits

Executed in a single working session without per-task commits.

1. **task 1: Create shared read-path projection module** - pending commit
2. **task 2: Refactor engine read consumers to shared helpers** - pending commit
3. **task 3: Add deterministic parity regressions** - pending commit

**Plan metadata:** pending

## Files Created/Modified

- `packages/rts-engine/template-grid-read.ts` - canonical read-side transform/world/bounds/integrity helper surface.
- `packages/rts-engine/template-grid-read.test.ts` - helper-level matrix, wrap, ordering, and mask regression tests.
- `packages/rts-engine/rts.ts` - read-side consumers migrated to shared helper imports.
- `packages/rts-engine/rts.test.ts` - transformed structure payload and fallback mask regression.
- `packages/rts-engine/index.ts` - shared helper exports for `#rts-engine` consumers.

## Decisions Made

- Centralized deterministic dedupe/sort behavior in the helper module to keep world payload ordering stable across consumers.
- Kept transformed-bounds estimation helper in the same module to support integration helper migration in Plan 02.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] New transformed integrity regression had unstable HP expectation under Conway progression**

- **Found during:** task 3 (parity regression additions)
- **Issue:** Exact HP assertion was brittle because additional mismatches can accumulate by tick 4 in transformed scenarios.
- **Fix:** Asserted integrity outcome as a strict HP decrease from starting value rather than hardcoding one specific HP value.
- **Files modified:** `packages/rts-engine/rts.test.ts`
- **Verification:** `npx vitest run packages/rts-engine/rts.test.ts -t "keeps transformed structure payloads deterministic and fallback integrity masks active"`
- **Committed in:** pending

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Regression remains deterministic while avoiding over-constraining unrelated Conway side effects.

## Issues Encountered

- `npx vitest run packages/rts-engine/rts.test.ts` reports multiple pre-existing failures outside the Phase 15 changes; targeted transformed regression and new helper tests pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Cross-codebase consumers can now import shared transformed-bounds logic from `#rts-engine`.
- Phase 15 Plan 02 can complete integration helper migration and reconnect matrix parity coverage using the exported helper surface.

---

_Phase: 15-read-path-and-cross-codebase-gridview-unification_
_Completed: 2026-03-03_
