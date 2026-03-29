---
phase: 15-hash-checkpoint-protocol
plan: 01
subsystem: networking
tags: [lockstep, desync-detection, resync, determinism, socket.io]

# Dependency graph
requires:
  - phase: 13-client-simulation-foundation
    provides: ClientSimulation class with verifyCheckpoint() and initialize()
  - phase: 14-input-only-transport
    provides: Input-only mode, flushPrimaryTurnCommands, requestStateSnapshot
provides:
  - ClientSimulation.resync() convenience method for desync recovery
  - Client-side desync detection with pendingSimResync deduplication flag
  - Server flush guarantee before state snapshot in primary lockstep mode
affects: [15-02, 16-reconnect-replay]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "pendingSimResync flag prevents duplicate resync requests across rapid checkpoints"
    - "Server flushes turn-buffer before generating full state snapshot in primary lockstep mode"

key-files:
  created: []
  modified:
    - apps/web/src/client-simulation.ts
    - apps/web/src/client.ts
    - apps/server/src/server.ts
    - tests/web/client-simulation.test.ts

key-decisions:
  - "Used resync() convenience method (destroy + initialize) rather than separate reinitialize method for clarity"
  - "Guard server flush with isInputOnlyMode && sections.includes('full') to avoid unnecessary flush in legacy mode"

patterns-established:
  - "Desync recovery: set pendingSimResync flag, request full state, resync on receipt, clear flag"
  - "Server flush before snapshot: flushPrimaryTurnCommands before emitRequestedStateSections when full sections requested"

requirements-completed: [SYNC-01, SYNC-02]

# Metrics
duration: 15min
completed: 2026-03-29
---

# Phase 15 Plan 01: Desync Detection and State Resync Protocol Summary

**Client detects hash mismatch at lockstep checkpoints, requests full state snapshot, and reinitializes local simulation via ClientSimulation.resync(); server guarantees turn-buffer flush before snapshot in primary mode**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-29T21:19:30Z
- **Completed:** 2026-03-29T21:34:34Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `ClientSimulation.resync(payload, templates)` method with 4 unit tests covering reset semantics, idle-to-initialized, tick advance post-resync, and hash verification post-resync
- Wired complete desync detection flow in client: lockstep:checkpoint handler detects mismatch, requests full state, sets pendingSimResync flag to prevent duplicate requests
- Client state handler calls `clientSimulation.resync()` when pendingSimResync is true, completing the resync loop
- Server flushes buffered turn commands before generating state snapshot in primary lockstep mode (SYNC-02 guarantee)
- Reset pendingSimResync flag on room leave and match finish for clean state transitions
- Updated lockstep:fallback handler with pendingSimResync guard to prevent duplicate state requests

## Task Commits

Each task was committed atomically:

1. **Task 1: Add ClientSimulation.resync() method with unit tests** - `09ef193` (test: failing tests, TDD RED) + `e987c17` (feat: implementation, TDD GREEN)
2. **Task 2: Wire desync detection, resync flow in client.ts, and server flush guarantee** - `1224c36` (feat)

## Files Created/Modified
- `apps/web/src/client-simulation.ts` - Added resync() method (destroy + initialize convenience wrapper)
- `apps/web/src/client.ts` - Added pendingSimResync flag, updated lockstep:checkpoint/fallback/state handlers, cleanup on room:left and match-finished
- `apps/server/src/server.ts` - Added flushPrimaryTurnCommands call in state:request handler before snapshot when in primary lockstep mode
- `tests/web/client-simulation.test.ts` - Added 4 resync unit tests in new describe block

## Decisions Made
- Used `resync()` convenience method that calls `destroy()` then `initialize()` rather than a separate reinitialize path. This keeps the code simple and reuses tested lifecycle methods.
- Guarded server flush with `isInputOnlyMode(room) && sections.includes('full')` to only flush when in primary lockstep mode and a full snapshot is requested, avoiding unnecessary flush overhead in legacy mode or partial state requests.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Desync detection and resync protocol is complete for production code
- Ready for Phase 15 Plan 02: integration tests proving end-to-end desync detection and resync within one checkpoint interval
- All existing tests pass (174 unit + web tests)

## Self-Check: PASSED

All 4 modified/created files verified present. All 3 task commits verified in git log (09ef193, e987c17, 1224c36).

---
*Phase: 15-hash-checkpoint-protocol*
*Completed: 2026-03-29*
