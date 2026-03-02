---
phase: 06-base-geometry-and-integrity-core
plan: '02'
subsystem: engine
tags: [rts-engine, integrity, hp, determinism, struct-01]

# Dependency graph
requires:
  - phase: 06-base-geometry-and-integrity-core
    provides: Canonical 5x5 base helpers and shared gameplay constants from Plan 01.
provides:
  - Template-wide integrity resolution with deterministic ordering and full restoration-cost HP accounting.
  - Core defeat remains the only defeat trigger while queue drain and match outcome ordering stay deterministic.
  - Unit + integration fixtures updated for canonical base footprint placement behavior and integrity outcomes.
affects: [phase-07-build-zones, phase-09-destroy-flow, reconnect-quality-gates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Deterministic integrity traversal (`team.id` ascending, then `structure.key` ascending).
    - Integrity masks default to template live cells when explicit `checks` are absent.

key-files:
  created:
    - .planning/phases/06-base-geometry-and-integrity-core/06-02-SUMMARY.md
  modified:
    - packages/rts-engine/rts.ts
    - packages/rts-engine/rts.test.ts
    - tests/integration/server/server.test.ts
    - tests/integration/server/match-lifecycle.test.ts
    - tests/integration/server/quality-gate-loop.test.ts

key-decisions:
  - Apply full restoration cost (`1 HP` per mismatched integrity cell) with underflow preserved, then destroy when HP is non-positive.
  - Keep destroyed structures in state as inert debris entries (no active/buildRadius effects) so Conway grid remains untouched.

patterns-established:
  - 'STRUCT-01 Pattern: Integrity masks are explicit (`checks`) or derived from template live cells, never skipped.'
  - 'Integration Pattern: Candidate placement helpers exclude canonical base footprint overlap for stable queue acceptance across tests.'

requirements-completed: [STRUCT-01, BASE-01]

# Metrics
duration: 31 min
completed: 2026-03-02
---

# Phase 06 Plan 02: Template-Wide Integrity Summary

**Integrity resolution now runs deterministically for every player-owned structure, charging full cell-repair HP cost and preserving canonical core-defeat + queue-drain outcomes.**

## Performance

- **Duration:** 31 min
- **Started:** 2026-03-02T01:46:00Z
- **Completed:** 2026-03-02T02:17:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Replaced core-only restore logic in `packages/rts-engine/rts.ts` with template-wide integrity resolution on shared cadence constants.
- Added STRUCT-01 unit coverage in `packages/rts-engine/rts.test.ts` for default integrity masks, full-cost destruction, and core underflow defeat.
- Updated server integration fixtures to select canonical-footprint-safe placements and keep lifecycle assertions deterministic under the new rules.

## task Commits

Implementation was delivered in one cross-cutting engine commit because Plan 01 and Plan 02 both require coordinated `rts.ts` and test-suite updates:

1. **task 1: generalize integrity resolution across all player-owned templates** - `bcc1266` (feat)
2. **task 2: extend unit and integration fixtures for base-intact and deterministic outcomes** - `bcc1266` (test)

## Files Created/Modified

- `packages/rts-engine/rts.ts` - Deterministic template-wide integrity pass, full-cost HP handling, and integrity outcome timeline events.
- `packages/rts-engine/rts.test.ts` - STRUCT-01 assertions for default masks, debris-state outcomes, and core defeat accounting.
- `tests/integration/server/server.test.ts` - Placement helpers and affordability/resource tests aligned with canonical 5x5 base footprint.
- `tests/integration/server/match-lifecycle.test.ts` - Breach helper updated to tolerate queue rejection and still produce deterministic match-finished outcomes.
- `tests/integration/server/quality-gate-loop.test.ts` - Candidate placement helper updated for canonical footprint exclusions.

## Decisions Made

- Keep integrity mutations in one post-step authoritative phase and preserve deterministic ordering through explicit sorting.
- Treat destroyed structures as inert debris entries so future destroy-flow phases can build on stable structure-state history.

## Deviations from Plan

None - plan goals were met without functional scope changes.

## Issues Encountered

- Integration tests that reused a single placement now hit `occupied-site` after debris-state tracking; tests were updated to iterate valid placements deterministically.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- STRUCT-01 and BASE-01 are now covered in both package and server integration suites.
- Ready to start Phase 7 union build-zone enforcement on top of deterministic integrity/base foundations.

---

_Phase: 06-base-geometry-and-integrity-core_
_Completed: 2026-03-02_

## Self-Check: PASSED

- Found template-wide integrity resolver in `packages/rts-engine/rts.ts`.
- Found updated integration fixtures in `tests/integration/server/server.test.ts` and related lifecycle suites.
- Found commit `bcc1266` with engine + unit + integration updates.
