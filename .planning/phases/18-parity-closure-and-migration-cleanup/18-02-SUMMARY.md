---
phase: 18-parity-closure-and-migration-cleanup
plan: 02
subsystem: integration-parity
tags: [socket-parity, transform-equivalence, integrity, structure-key]

# Dependency graph
requires:
  - phase: 18-parity-closure-and-migration-cleanup
    plan: 01
    provides: migration-guard retirement and green unit parity gates
provides:
  - Hardened socket-level transformed preview/queue/apply parity evidence
  - Deterministic rejection cadence and no-side-effect checks for equivalent invalid transforms
  - Integration checkpoints for structure-key stability, reconnect integrity, and queued outcome ordering determinism
affects:
  [
    tests/integration/server/server.test.ts,
    tests/integration/server/quality-gate-loop.test.ts,
    tests/integration/server/destroy-determinism.test.ts,
    tests/integration/server/match-lifecycle.test.ts,
    phase-18-verification,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Compare equivalent transformed runtime behaviors using event-contract payload effects and deterministic state convergence checks.
    - Keep integration assertions targeted to parity gates to avoid broad-suite timeout noise.

key-files:
  created:
    - .planning/phases/18-parity-closure-and-migration-cleanup/18-02-SUMMARY.md
  modified:
    - tests/integration/server/server.test.ts
    - tests/integration/server/quality-gate-loop.test.ts
    - tests/integration/server/destroy-determinism.test.ts
    - tests/integration/server/match-lifecycle.test.ts

key-decisions:
  - Preserve contract-first assertions at socket boundaries (reason taxonomy, cadence, affordability metadata, footprint/key outcomes) rather than internal implementation details.
  - Treat targeted deterministic command set as phase blocker while keeping known broad-suite timeout debt out of scope.

patterns-established:
  - 'Pattern 1: assert equivalent transform invalid attempts keep reason cadence and no side effects at runtime boundaries.'
  - 'Pattern 2: verify structure-key and queued outcome ordering determinism through reconnect and rerun checkpoints.'

requirements-completed: [REF-08]

# Metrics
duration: in-session
completed: 2026-03-03
---

# Phase 18 Plan 02: Runtime Parity Closure Summary

**Integration parity gates now explicitly lock transformed preview/queue/apply behavior, rejection cadence, structure-key stability, reconnect convergence, and queued lifecycle outcome ordering after migration cleanup.**

## Performance

- **Duration:** in-session
- **Started:** 2026-03-03
- **Completed:** 2026-03-03
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Hardened `tests/integration/server/server.test.ts` with explicit structure-key parity and transformed invalid-preview equivalence assertions for rejection taxonomy and cadence scenarios.
- Tightened `tests/integration/server/quality-gate-loop.test.ts` applied-outcome ordering invariants for equivalent transformed legality probes.
- Added post-rejection structure-key uniqueness checkpoint in `tests/integration/server/destroy-determinism.test.ts` to prove occupied-site duplicate queues remain no-side-effect before destroy targeting.
- Added monotonic resolved-tick and team-target ordering assertions in `tests/integration/server/match-lifecycle.test.ts` for rerun-deterministic queued outcome sequencing.

## task Commits

Each task was committed atomically:

1. **task 1: Harden socket-level transformed preview/queue/apply parity and invalid-cadence assertions** - `27fd440` (test)
2. **task 2: Strengthen structure-key/integrity-adjacent parity checkpoints across destroy and reconnect flows** - `27fd440` (test)
3. **task 3: Confirm deterministic queued outcome ordering parity after migration cleanup** - `27fd440` (test)

## Verification Commands

- `npx vitest run tests/integration/server/server.test.ts -t "keeps transformed preview, queue, and applied footprint coordinates aligned"` (pass)
- `npx vitest run tests/integration/server/server.test.ts -t "preserves rejection taxonomy and cadence for equivalent transformed invalid queues"` (pass)
- `npx vitest run tests/integration/server/quality-gate-loop.test.ts -t "keeps equivalent transform legality parity and execute-time affordability rejections stable"` (pass)
- `npx vitest run tests/integration/server/quality-gate-loop.test.ts -t "keeps transformed structure overlays stable across repeated reconnect loops"` (pass)
- `npx vitest run tests/integration/server/destroy-determinism.test.ts -t "keeps transformed structure keys stable for occupied-site and destroy targeting checks"` (pass)
- `npx vitest run tests/integration/server/match-lifecycle.test.ts -t "keeps queued action outcome ordering deterministic across reruns"` (pass)

## Files Created/Modified

- `tests/integration/server/server.test.ts` - transformed parity assertions expanded for structure-key and invalid-preview equivalence checkpoints.
- `tests/integration/server/quality-gate-loop.test.ts` - equivalent-transform applied outcome invariants tightened.
- `tests/integration/server/destroy-determinism.test.ts` - post-occupied-site duplicate rejection structure-key uniqueness check added.
- `tests/integration/server/match-lifecycle.test.ts` - rerun ordering guards strengthened with team and tick monotonic assertions.

## Decisions Made

- Keep parity evidence deterministic with targeted suites and explicit event/state checkpoints.
- Avoid runtime code changes; phase remains test-and-proof closure only.

## Deviations from Plan

None - plan executed as intended.

## Issues Encountered

None within targeted parity command set.

## Next Phase Readiness

- Integration parity closure is complete across the required Phase 18 flows.
- Phase 18 can proceed to final verification/doc closure for milestone audit handoff.

---

_Phase: 18-parity-closure-and-migration-cleanup_
_Completed: 2026-03-03_
