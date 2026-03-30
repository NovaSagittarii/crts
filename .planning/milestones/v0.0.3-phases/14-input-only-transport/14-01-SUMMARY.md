---
phase: 14-input-only-transport
plan: 01
subsystem: engine
tags: [ring-buffer, socket-contract, lockstep, input-log, sequence]

# Dependency graph
requires:
  - phase: 13-client-simulation-foundation
    provides: ClientSimulation module consuming BuildQueuedPayload/DestroyQueuedPayload
provides:
  - InputEventLog ring buffer class for bounded input event storage
  - InputLogEntry interface and InputLogEventKind type
  - sequence field on BuildQueuedPayload and DestroyQueuedPayload
  - Server population of sequence from lockstep monotonic counter
affects: [14-02, reconnect-replay, broadcast-suppression]

# Tech tracking
tech-stack:
  added: []
  patterns: [ring-buffer with FIFO overwrite for bounded event storage]

key-files:
  created:
    - packages/rts-engine/input-event-log.ts
    - packages/rts-engine/input-event-log.test.ts
  modified:
    - packages/rts-engine/index.ts
    - packages/rts-engine/socket-contract.ts
    - apps/server/src/server.ts
    - tests/web/client-simulation.test.ts

key-decisions:
  - 'bufferLockstepCommand returns assigned sequence number instead of boolean for downstream payload population'
  - 'lastBufferedSequence stored at createServer scope level for access by payload creation functions'

patterns-established:
  - 'Ring buffer pattern: fixed-capacity array with head pointer and count, FIFO overwrite on overflow'
  - 'Sequence assignment: lockstep monotonic counter captured in bufferQueuedMutationCommand, consumed by create*QueuedPayload'

requirements-completed: [XPORT-02, XPORT-03]

# Metrics
duration: 16min
completed: 2026-03-29
---

# Phase 14 Plan 01: InputEventLog Ring Buffer and Sequence Field Summary

**InputEventLog ring buffer for bounded input event storage with TDD, plus sequence field on BuildQueuedPayload/DestroyQueuedPayload populated from lockstep monotonic counter**

## Performance

- **Duration:** 16 min
- **Started:** 2026-03-29T19:55:53Z
- **Completed:** 2026-03-29T20:12:15Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- InputEventLog ring buffer class with append, getEntriesFromTick, discardBefore, and clear operations, covered by 9 unit tests
- sequence field added to BuildQueuedPayload and DestroyQueuedPayload interfaces in socket-contract.ts
- Server payload creation functions (createBuildQueuedPayload, createDestroyQueuedPayload) now populate sequence from the lockstep runtime's monotonic counter
- bufferLockstepCommand refactored to return assigned sequence number for downstream use

## Task Commits

Each task was committed atomically:

1. **Task 1: InputEventLog ring buffer with TDD** - `f9ccb6b` (feat)
2. **Task 2: Add sequence field to queued payloads and populate in server** - `76064b9` (feat)

## Files Created/Modified

- `packages/rts-engine/input-event-log.ts` - Ring buffer class with InputLogEntry, InputLogEventKind exports
- `packages/rts-engine/input-event-log.test.ts` - 9 unit tests covering append, retrieve, discard, overflow, clear
- `packages/rts-engine/index.ts` - Re-export of input-event-log module
- `packages/rts-engine/socket-contract.ts` - Added sequence: number to BuildQueuedPayload and DestroyQueuedPayload
- `apps/server/src/server.ts` - bufferLockstepCommand returns sequence; payload creators populate it
- `tests/web/client-simulation.test.ts` - Updated test fixtures with sequence field

## Decisions Made

- bufferLockstepCommand return type changed from boolean to number (assigned sequence, or -1 if not buffered) to enable downstream payload population without additional state tracking
- lastBufferedSequence variable added at createServer scope level rather than modifying bufferQueuedMutationCommand signature, since both payload creation functions need access to the most recently assigned sequence

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect test expectation for ring buffer overflow behavior**

- **Found during:** Task 1 (InputEventLog ring buffer with TDD)
- **Issue:** Plan's test for "after overwrite, getEntriesFromTick still returns valid entries only" expected getEntriesFromTick(3) to return 2 entries, but with capacity 3 and 5 appends, the buffer holds [3,4,5] -- so entries with tick >= 3 should be 3 items, not 2
- **Fix:** Corrected the test to verify all entries in buffer after overflow (getEntriesFromTick(0) returns [3,4,5]) and added a separate filter assertion (getEntriesFromTick(4) returns [4,5])
- **Files modified:** packages/rts-engine/input-event-log.test.ts
- **Verification:** All 9 tests pass
- **Committed in:** f9ccb6b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test expectation)
**Impact on plan:** Test expectation corrected for accuracy. No scope creep.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all code is fully wired and functional.

## Next Phase Readiness

- InputEventLog is ready for Plan 02 (broadcast suppression wiring) to use for storing accepted input events
- sequence field is available on all queued payloads for deterministic ordering during reconnect replay
- No blockers for Plan 02

## Self-Check: PASSED

All files exist, all commits verified, all exports confirmed.

---

_Phase: 14-input-only-transport_
_Completed: 2026-03-29_
