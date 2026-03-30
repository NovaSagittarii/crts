---
phase: 14-input-only-transport
plan: 02
subsystem: server
tags:
  [broadcast-suppression, input-only, lockstep, transport-protocol, ring-buffer]

# Dependency graph
requires:
  - phase: 14-input-only-transport
    plan: 01
    provides: InputEventLog ring buffer, sequence field on BuildQueuedPayload/DestroyQueuedPayload
  - phase: 13-client-simulation-foundation
    provides: ClientSimulation module with isActive flag for checkpoint handling
provides:
  - Broadcast suppression for input-only lockstep mode (no build:outcome, destroy:outcome, state, state:hashes)
  - InputEventLog wired into server room lifecycle (populate on queue, discard on tick, clear on reset)
  - Client checkpoint handler guards requestStateSections behind clientSimulation.isActive
  - Integration tests proving XPORT-01 and XPORT-03 end-to-end
affects: [reconnect-replay, desync-handling, fallback-broadcast]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      isInputOnlyMode guard pattern for broadcast suppression,
      ring buffer lifecycle (create/populate/discard/clear),
    ]

key-files:
  created:
    - tests/integration/server/input-only-transport.test.ts
  modified:
    - apps/server/src/server.ts
    - apps/web/src/client.ts

key-decisions:
  - 'isInputOnlyMode checks both mode=primary AND status=running, so fallback mode continues full broadcasts'
  - 'InputEventLog discard window based on reconnectHoldMs / tickMs for reconnect replay support'
  - 'Client requests grid only on desync (not periodically) when simulation is active'

patterns-established:
  - 'Broadcast suppression pattern: isInputOnlyMode helper evaluated at tick start, gates outcome/state emissions'
  - 'Input log lifecycle: created in lockstepRuntimeState, populated in emitBuildQueued/emitDestroyQueued, discarded per-tick, cleared on match reset'

requirements-completed: [XPORT-01, XPORT-02, XPORT-03]

# Metrics
duration: 15min
completed: 2026-03-29
---

# Phase 14 Plan 02: Broadcast Suppression and Input-Only Transport Wiring Summary

**Broadcast suppression gating on isInputOnlyMode, InputEventLog lifecycle wiring, and client checkpoint guard with 6 integration tests**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-29T20:18:55Z
- **Completed:** 2026-03-29T20:33:49Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Server suppresses build:outcome, destroy:outcome, periodic full-state, and per-event state:hashes broadcasts when lockstep mode is primary and status is running
- InputEventLog ring buffer wired into server room lifecycle: populated on build:queued/destroy:queued, discarded per-tick based on reconnect window, cleared on match reset
- Client lockstep:checkpoint handler restructured so requestStateSections is only called when simulation is inactive or on desync
- 6 integration tests proving broadcast suppression, checkpoint continuity, state:hashes suppression, and sequence field ordering

## Task Commits

Each task was committed atomically:

1. **Task 1: Server broadcast suppression + InputEventLog wiring + client checkpoint update** - `56f0dd5` (feat)
2. **Task 2: Integration tests for input-only transport** - `6257993` (test)

## Files Created/Modified

- `apps/server/src/server.ts` - isInputOnlyMode helper, broadcast gating in tick loop and emit functions, InputEventLog wiring
- `apps/web/src/client.ts` - Restructured lockstep:checkpoint handler to guard requestStateSections behind clientSimulation.isActive
- `tests/integration/server/input-only-transport.test.ts` - 6 integration tests for XPORT-01 and XPORT-03

## Decisions Made

- isInputOnlyMode checks both `mode === 'primary'` AND `status === 'running'`, ensuring fallback mode continues full broadcasts unchanged
- InputEventLog discard window calculated as `reconnectHoldMs / tickMs` to retain entries long enough for reconnect replay
- Client grid requests on desync serve as a fallback visual resync until Phase 15 implements full resync handling

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all code is fully wired and functional.

## Next Phase Readiness

- Input-only transport protocol is complete: active lockstep matches send only input events and hash checkpoints
- Ready for Phase 15 (desync detection / fallback) to build on the checkpoint verification infrastructure
- Ready for Phase 16 (reconnect replay) to use the InputEventLog ring buffer for replaying events to reconnecting clients
- No blockers

## Self-Check: PASSED

All files exist, all commits verified.

---

_Phase: 14-input-only-transport_
_Completed: 2026-03-29_
