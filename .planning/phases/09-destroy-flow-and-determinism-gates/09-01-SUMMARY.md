---
phase: 09-destroy-flow-and-determinism-gates
plan: 01
subsystem: gameplay-engine
tags: [rts-engine, destroy-queue, determinism, socket-contract, vitest]

# Dependency graph
requires:
  - phase: 08-transform-placement-consistency
    provides: transform-aware placement/projection metadata and deterministic queue foundations
provides:
  - authoritative destroy queue payloads, rejection taxonomy, and idempotent same-target behavior
  - deterministic destroy execution outcomes with reconnect-safe pending/structure projection data
  - unit determinism coverage for accepted/rejected destroy flows and equal-run replay parity
affects:
  [09-02-server-runtime-wiring, 09-03-web-destroy-controls, STRUCT-02, QUAL-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      engine-owned destroy reason taxonomy,
      same-target destroy idempotency,
      deterministic tick destroy outcome sorting,
    ]

key-files:
  created:
    [.planning/phases/09-destroy-flow-and-determinism-gates/09-01-SUMMARY.md]
  modified:
    [
      packages/rts-engine/rts.ts,
      packages/rts-engine/socket-contract.ts,
      packages/rts-engine/rts.test.ts,
    ]

key-decisions:
  - 'Keep destroy validation and reason production in #rts-engine and forward reasons unchanged through socket contracts.'
  - 'Treat same-team same-target pending destroy requests as idempotent while allowing different-target retargets during pending state.'

patterns-established:
  - 'Destroy queue parity: queue validation and terminal outcomes share stable reason codes from engine to transport.'
  - 'Reconnect-safe projection: pending destroys and structure requiresDestroyConfirm metadata are emitted from authoritative room payloads.'

requirements-completed: [STRUCT-02, QUAL-04]

# Metrics
duration: 3m 16s
completed: 2026-03-02
---

# Phase 9 Plan 01: Destroy Queue Engine Foundation Summary

**Deterministic destroy queue validation and execution now live in shared RTS engine logic with stable rejection taxonomy, idempotent duplicate handling, and replay-safe unit coverage.**

## Performance

- **Duration:** 3m 16s
- **Started:** 2026-03-02T06:19:03Z
- **Completed:** 2026-03-02T06:22:29Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added engine destroy payload/outcome primitives and shared socket contract exports for queued/terminal destroy transport typing.
- Implemented authoritative destroy queue validation for ownership, target existence, lifecycle state, and delay constraints with idempotent same-target duplicate handling.
- Added deterministic unit coverage for destroy acceptance/rejection, contributor build-zone shrink after destroy, and equal-run destroy replay parity assertions.

## task Commits

Each task was committed atomically:

1. **task 1: add deterministic destroy queue model and rejection taxonomy in engine contracts** - `f23b927` (feat)
2. **task 2: execute destroy events in deterministic tick flow and lock unit replay coverage** - `636119c` (test)

**Plan metadata:** pending

## Files Created/Modified

- `.planning/phases/09-destroy-flow-and-determinism-gates/09-01-SUMMARY.md` - Plan execution record and dependency metadata for future context assembly.
- `packages/rts-engine/rts.ts` - Destroy queue types, validation, deterministic execution, outcome recording, and reconnect-safe structure/pending projection.
- `packages/rts-engine/socket-contract.ts` - Shared destroy queue request/ack/outcome payload typing for runtime and client parity.
- `packages/rts-engine/rts.test.ts` - Deterministic destroy acceptance/rejection/idempotency/build-zone/replay unit coverage.

## Decisions Made

- Keep destroy reason taxonomy centralized in engine (`DestroyRejectionReason`) and reuse it directly in socket contracts to avoid runtime/client drift.
- Project `requiresDestroyConfirm` from structure templates into authoritative state and pending destroy payloads so future UI confirmation policy stays data-driven.

## Deviations from Plan

None - plan executed exactly as written.

## Auth Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Engine destroy primitives and deterministic unit gates are in place for Phase 09-02 server runtime event wiring and integration determinism coverage.
- No blockers identified for continuing to runtime/web destroy flow plans.

---

_Phase: 09-destroy-flow-and-determinism-gates_
_Completed: 2026-03-02_

## Self-Check: PASSED

- FOUND: `.planning/phases/09-destroy-flow-and-determinism-gates/09-01-SUMMARY.md`
- FOUND: `f23b927`
- FOUND: `636119c`
