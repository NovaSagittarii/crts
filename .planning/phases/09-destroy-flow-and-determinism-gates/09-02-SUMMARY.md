---
phase: 09-destroy-flow-and-determinism-gates
plan: 02
subsystem: api
tags: [socket.io, destroy-flow, integration-tests, reconnect, determinism]

# Dependency graph
requires:
  - phase: 09-01
    provides: deterministic destroy queue primitives, reason taxonomy, and state projection fields in #rts-engine
provides:
  - server destroy queue runtime handlers with authoritative payload parsing and gameplay mutation gates
  - room-scoped destroy queued/outcome transport wiring that preserves engine rejection reasons
  - two-client and reconnect integration gates proving destroy/build convergence for QUAL-04
affects: [09-03-web-destroy-controls, STRUCT-02, QUAL-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      runtime reason passthrough from engine to room:error,
      deterministic destroy queued idempotency acknowledgements,
      reconnect parity assertions based on authoritative state snapshots,
    ]

key-files:
  created:
    [
      tests/integration/server/destroy-determinism.test.ts,
      .planning/phases/09-destroy-flow-and-determinism-gates/09-02-SUMMARY.md,
    ]
  modified:
    [
      apps/server/src/server.ts,
      tests/integration/server/server.test.ts,
      tests/integration/server/quality-gate-loop.test.ts,
    ]

key-decisions:
  - 'Keep runtime destroy validation aligned with existing gameplay mutation gates and preserve engine-produced reason codes without remapping.'
  - 'Treat reconnect determinism as state-plus-outcome parity, asserting pending destroy projection before resolution and structure convergence after resolution.'

patterns-established:
  - 'Destroy runtime parity: queue request -> queued ack -> single room-scoped terminal outcome observed identically by both clients.'
  - 'Reconnect destroy gate: rejoined client must match host pending destroy rows and settled structure snapshots through authoritative state feeds.'

requirements-completed: [STRUCT-02, QUAL-04]

# Metrics
duration: 14m 1s
completed: 2026-03-02
---

# Phase 9 Plan 02: Server Destroy Runtime and Determinism Gates Summary

**Socket runtime destroy handlers now enqueue authoritative actions, emit stable queued/outcome payloads, and pass integration gates that prove two-client and reconnect destroy determinism.**

## Performance

- **Duration:** 14m 1s
- **Started:** 2026-03-02T06:27:53Z
- **Completed:** 2026-03-02T06:41:54Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `destroy:queue` runtime handling with payload parsing, gameplay gating, idempotent queued acknowledgements, and room-scoped terminal outcome emission.
- Extended core server integration coverage to assert accepted owned destroys, deterministic rejection reasons (`wrong-owner`, `invalid-target`, `invalid-lifecycle-state`), and one terminal outcome parity across both clients.
- Added focused reconnect destroy determinism suites and extended quality-gate loop coverage with a QUAL-04 build-plus-destroy reconnect checkpoint scenario.

## task Commits

Each task was committed atomically:

1. **task 1: implement destroy queue socket handlers with deterministic runtime gates** - `f865c21` (feat)
2. **task 2: add two-client and reconnect integration determinism gates for destroy flow** - `b381066` (test)

**Plan metadata:** pending

## Files Created/Modified

- `apps/server/src/server.ts` - Adds destroy payload parsing, queue handler wiring, reason passthrough rejection handling, and tick-driven destroy outcome emissions.
- `tests/integration/server/server.test.ts` - Adds two-client destroy acceptance/rejection/idempotency coverage and terminal outcome parity assertions.
- `tests/integration/server/destroy-determinism.test.ts` - Adds reconnect determinism scenarios for pending and resolved destroy flows.
- `tests/integration/server/quality-gate-loop.test.ts` - Adds QUAL-04 build-plus-destroy reconnect parity gate.
- `.planning/phases/09-destroy-flow-and-determinism-gates/09-02-SUMMARY.md` - Captures execution metadata, decisions, and verification outcomes.

## Decisions Made

- Keep destroy queue payload parsing/runtime gating in `apps/server` while preserving engine authority for reject reasons (`QueueDestroyResult.reason`) to prevent taxonomy drift.
- Assert reconnect determinism on authoritative state parity (`pendingDestroys`, structure snapshots) in addition to destroy outcome event equality.

## Deviations from Plan

None - plan executed exactly as written.

## Auth Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Runtime destroy contracts and integration determinism gates are in place for Phase 09-03 web destroy controls.
- No blockers identified for continuing to owned-selection UI, confirmation UX, and pending destroy feedback work.

---

_Phase: 09-destroy-flow-and-determinism-gates_
_Completed: 2026-03-02_

## Self-Check: PASSED

- FOUND: `.planning/phases/09-destroy-flow-and-determinism-gates/09-02-SUMMARY.md`
- FOUND: `tests/integration/server/destroy-determinism.test.ts`
- FOUND: `f865c21`
- FOUND: `b381066`
