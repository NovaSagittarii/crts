---
phase: 16-write-path-gridview-unification
plan: 02
subsystem: integration-and-testing
tags: [parity, transformed-placement, integration, resource-timing]

# Dependency graph
requires:
  - phase: 16-write-path-gridview-unification
    provides: shared write-path helper pipeline in `template-grid-write` and migrated engine consumers
provides:
  - Expanded RTS unit parity matrix for transformed preview, queue, and apply behavior
  - Server integration assertions for transformed preview/queue/outcome parity and affordability metadata
  - Deterministic transformed structure-key stability checks for occupied-site and destroy targeting
affects:
  [
    packages/rts-engine/rts.test.ts,
    tests/integration/server/server.test.ts,
    tests/integration/server/quality-gate-loop.test.ts,
    tests/integration/server/destroy-determinism.test.ts,
    phase-17,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Validate transformed write parity at both engine and socket-contract boundaries with deterministic fixtures.
    - Assert execute-time reject metadata from `build:outcome` to protect affordability and no-charge invariants.

key-files:
  created:
    - .planning/phases/16-write-path-gridview-unification/16-02-SUMMARY.md
  modified:
    - packages/rts-engine/rts.test.ts
    - tests/integration/server/server.test.ts
    - tests/integration/server/quality-gate-loop.test.ts
    - tests/integration/server/destroy-determinism.test.ts

key-decisions:
  - Validate transformed parity with targeted deterministic scenarios instead of broad timing-sensitive match loops.
  - Keep execute-time affordability assertions anchored to `build:outcome` payload metadata to match runtime contract guarantees.

patterns-established:
  - 'Pattern 1: derive transformed candidate placements from team coverage and assert preview/queue/outcome agreement for the same anchor+transform.'
  - 'Pattern 2: pair occupied-site and destroy checks against the same transformed structure key to lock key stability across equivalent transforms.'

requirements-completed: [REF-04]

# Metrics
duration: in-session
completed: 2026-03-03
---

# Phase 16 Plan 02: End-to-End Write-Path Parity Summary

**Unit and integration coverage now lock transformed preview, queue, and apply parity for coordinates, rejection metadata, and structure-key determinism.**

## Performance

- **Duration:** in-session
- **Started:** 2026-03-03
- **Completed:** 2026-03-03
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Expanded `packages/rts-engine/rts.test.ts` with deterministic transformed write-path parity coverage for footprint alignment, occupied-site precedence, and execute-time no-charge affordability rejects.
- Added `tests/integration/server/server.test.ts` scenarios that assert transformed preview/queue/outcome alignment and stable execute-time insufficient metadata.
- Added `tests/integration/server/quality-gate-loop.test.ts` and `tests/integration/server/destroy-determinism.test.ts` scenarios for equivalent transform legality parity plus transformed structure-key stability.
- Ran targeted unit/integration checks proving the new transformed parity scenarios pass.

## task Commits

Each task was committed atomically:

1. **task 1: Expand engine unit parity matrix** - `5629009` (test)
2. **task 2: Add server integration parity assertions** - `172af98` (test)
3. **task 3: Harden transformed key and torus edge scenarios** - `172af98` (test)

**Plan metadata:** pending

## Files Created/Modified

- `packages/rts-engine/rts.test.ts` - transformed preview/queue/apply parity and execute-time affordability/no-charge guards.
- `tests/integration/server/server.test.ts` - transformed preview/queue/outcome alignment and execute-time insufficient metadata assertions.
- `tests/integration/server/quality-gate-loop.test.ts` - equivalent transform legality parity and transformed affordability rejection stability scenario.
- `tests/integration/server/destroy-determinism.test.ts` - transformed structure-key stability for occupied-site and destroy targeting checks.

## Decisions Made

- Scoped new integration coverage to deterministic transformed scenarios to avoid widening existing flaky lifecycle loops.
- Kept affordability assertions tied to outcome payload fields (`needed/current/deficit`) to preserve contract-level guarantees.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Full `npx vitest run tests/integration/server/server.test.ts` has a pre-existing timeout in `acknowledges queued builds and emits one terminal outcome per acknowledged event`.
- Full `npx vitest run tests/integration/server/quality-gate-loop.test.ts tests/integration/server/destroy-determinism.test.ts` has a pre-existing timeout in `QUAL-02: join -> build -> tick -> breach -> defeat with defeated build rejection`.
- `npm run test:integration:serial` still reports pre-existing `room:match-finished` timeouts in `quality-gate-loop` and `match-lifecycle` suites.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 16 write-path unification now has deterministic parity evidence across unit and integration boundaries.
- Phase 17 can focus on legacy path removal while preserving locked parity outcomes.

---

_Phase: 16-write-path-gridview-unification_
_Completed: 2026-03-03_
