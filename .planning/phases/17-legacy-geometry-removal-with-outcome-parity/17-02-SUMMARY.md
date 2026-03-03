---
phase: 17-legacy-geometry-removal-with-outcome-parity
plan: 02
subsystem: parity-verification
tags: [representative-parity, deterministic-reruns, socket-contract, cadence]

# Dependency graph
requires:
  - phase: 17-legacy-geometry-removal-with-outcome-parity
    provides: shared authoritative helper extraction and migrated RTS orchestration paths
provides:
  - Representative engine-level action timeline parity checkpoints
  - Socket-level rejection taxonomy and cadence parity assertions for transformed invalid queues
  - Deterministic rerun ordering checks for queued build outcomes across integration timelines
affects:
  [
    packages/rts-engine/rts.test.ts,
    tests/integration/server/server.test.ts,
    tests/integration/server/match-lifecycle.test.ts,
    tests/integration/server/quality-gate-loop.test.ts,
    tests/integration/server/destroy-determinism.test.ts,
    phase-18,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Compare deterministic timeline checkpoints across repeated runs, not only final state.
    - Assert rejection taxonomy and cadence parity at socket boundaries for equivalent invalid actions.

key-files:
  created:
    - .planning/phases/17-legacy-geometry-removal-with-outcome-parity/17-02-SUMMARY.md
  modified:
    - packages/rts-engine/rts.test.ts
    - tests/integration/server/server.test.ts
    - tests/integration/server/match-lifecycle.test.ts

key-decisions:
  - Keep quality-gate-loop and destroy-determinism suites as targeted parity signals where existing scenarios already cover required semantics.
  - Capture cadence parity with repeated invalid queue attempts and rerun ordering assertions instead of broad flake-prone full-suite gates.

patterns-established:
  - 'Pattern 1: normalize action-boundary outcomes and compare run-to-run snapshots for deterministic parity.'
  - 'Pattern 2: validate equivalent-transform invalid queue sequences produce identical rejection cadence and no build outcomes.'

requirements-completed: [REF-06]

# Metrics
duration: in-session
completed: 2026-03-03
---

# Phase 17 Plan 02: Representative Outcome Parity Summary

**Representative unit and integration scenarios now prove transformed accept/reject parity, rejection cadence stability, and deterministic queued-outcome ordering after legacy geometry cleanup.**

## Performance

- **Duration:** in-session
- **Started:** 2026-03-03
- **Completed:** 2026-03-03
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added `packages/rts-engine/rts.test.ts` representative action timeline parity coverage with deterministic reruns and repeated invalid attempts (`occupied-site` cadence plus execute-time `insufficient-resources` checkpoint guards).
- Added `tests/integration/server/server.test.ts` socket-level transformed invalid queue taxonomy/cadence parity assertions for equivalent transforms and no-side-effect guarantees.
- Added `tests/integration/server/match-lifecycle.test.ts` deterministic rerun coverage for queued build outcome ordering across repeated active-match timelines.
- Re-ran existing parity guards in `tests/integration/server/quality-gate-loop.test.ts` and `tests/integration/server/destroy-determinism.test.ts` to keep transformed legality, affordability, and structure-key determinism evidence current.

## task Commits

Each task was committed atomically:

1. **task 1: Expand representative engine parity scenarios with action checkpoints** - `7276aed` (test)
2. **task 2: Harden socket-level rejection taxonomy and cadence parity assertions** - `7276aed` (test)
3. **task 3: Prove deterministic rerun parity for ordering and checkpoints** - `7276aed` (test)

**Plan metadata:** pending

## Files Created/Modified

- `packages/rts-engine/rts.test.ts` - representative action timeline parity and repeated invalid-attempt checkpoint assertions.
- `tests/integration/server/server.test.ts` - transformed invalid queue rejection taxonomy/cadence parity scenario.
- `tests/integration/server/match-lifecycle.test.ts` - queued action outcome ordering determinism across reruns.

## Decisions Made

- Kept parity checks focused on deterministic targeted scenarios rather than expanding broad suites with known timeout debt.
- Reused existing transformed affordability and structure-key integration checks as sufficient evidence for those plan artifacts.

## Deviations from Plan

Minor scope adjustment: no runtime changes were required; parity evidence was achieved with test updates only.

## Issues Encountered

- Full `packages/rts-engine/rts.test.ts` still has pre-existing failures outside the representative parity scenarios for this phase.

## User Setup Required

None - no manual setup or credentials required.

## Next Phase Readiness

- Phase 17 now has sign-off-ready representative parity evidence at unit and runtime boundaries.
- Phase 18 can retire temporary migration assertions while preserving parity test coverage.

---

_Phase: 17-legacy-geometry-removal-with-outcome-parity_
_Completed: 2026-03-03_
