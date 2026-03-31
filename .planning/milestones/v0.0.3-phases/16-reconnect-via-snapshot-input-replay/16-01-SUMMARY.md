---
phase: 16-reconnect-via-snapshot-input-replay
plan: 01
subsystem: networking
tags: [socket.io, reconnect, lockstep, input-replay, determinism]

# Dependency graph
requires:
  - phase: 14-input-only-transport
    provides: InputEventLog ring buffer and sequence field on queued payloads
  - phase: 15-hash-checkpoint-resync
    provides: ClientSimulation resync, server flush guard for snapshot consistency
provides:
  - RoomJoinedPayload with optional inputLog field for reconnect delivery
  - Server joinRoom flushes turn buffer and includes input log entries for active lockstep rooms
  - ClientSimulation.replayInputLog() method for reconnect catchup
  - Client room:joined handler wires input log replay after simulation init
affects: [16-02-integration-tests, reconnect-flow, lockstep-protocol]

# Tech tracking
tech-stack:
  added: []
  patterns: [input-log-replay-on-reconnect, flush-before-snapshot-in-joinRoom]

key-files:
  created: []
  modified:
    - packages/rts-engine/socket-contract.ts
    - apps/server/src/server.ts
    - apps/web/src/client-simulation.ts
    - apps/web/src/client.ts
    - tests/web/client-simulation.test.ts

key-decisions:
  - 'Removed unused InputLogEntry import from client.ts since payload.inputLog type is inferred from RoomJoinedPayload'

patterns-established:
  - 'flush-before-joinRoom-snapshot: Server flushes turn buffer before creating state snapshot in joinRoom, matching the existing state:request flush pattern'
  - 'input-log-boundary: getEntriesFromTick(statePayload.tick + 1) excludes already-processed events from the replay log'

requirements-completed: [RECON-01]

# Metrics
duration: 12min
completed: 2026-03-29
---

# Phase 16 Plan 01: Reconnect Input-Log Delivery and Replay Summary

**Input log delivery via room:joined payload with sorted client-side replay for deterministic reconnect catchup**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-29T22:51:18Z
- **Completed:** 2026-03-29T23:03:10Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Extended RoomJoinedPayload with optional `inputLog?: InputLogEntry[]` field in the canonical socket contract
- Implemented `ClientSimulation.replayInputLog()` that sorts entries by tick+sequence and applies builds/destroys for reconnect catchup
- Server joinRoom now flushes turn buffer and retrieves input log entries from snapshot tick + 1 for active lockstep rooms
- Client room:joined handler calls replayInputLog when inputLog is present and non-empty
- 5 new unit tests covering build replay, destroy replay, sort order, idle safety, and empty array no-op

## Task Commits

Each task was committed atomically:

1. **Task 1: Contract update + ClientSimulation.replayInputLog with TDD** - `6e2b940` (feat)
2. **Task 2: Server joinRoom input log delivery + client room:joined wiring** - `440ed24` (feat)

## Files Created/Modified

- `packages/rts-engine/socket-contract.ts` - Added InputLogEntry import and inputLog field to RoomJoinedPayload
- `apps/web/src/client-simulation.ts` - Added replayInputLog() method with tick+sequence sorting
- `tests/web/client-simulation.test.ts` - Added 5 unit tests for replayInputLog behavior
- `apps/server/src/server.ts` - Updated joinRoom to flush turn buffer, extract statePayload, retrieve input log, include in emit
- `apps/web/src/client.ts` - Added replayInputLog call in room:joined handler for reconnect catchup

## Decisions Made

- Removed unused `InputLogEntry` import from client.ts since `payload.inputLog` type is inferred from `RoomJoinedPayload` -- avoids lint error for unused import

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused InputLogEntry import from client.ts**

- **Found during:** Task 2 (client wiring)
- **Issue:** Plan instructed adding `InputLogEntry` to client.ts imports, but the type is never directly referenced (used via `payload.inputLog` type inference from `RoomJoinedPayload`)
- **Fix:** Removed the unused import to pass ESLint `no-unused-vars` rule
- **Files modified:** apps/web/src/client.ts
- **Verification:** `npx eslint apps/web/src/client.ts` passes with no errors
- **Committed in:** 440ed24 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Minor lint compliance fix. No scope creep.

## Issues Encountered

- Pre-existing test timeout in `packages/rts-engine/rts.test.ts` QUAL-04 test (unrelated to changes, not modified by this plan)

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all data flows are fully wired.

## Next Phase Readiness

- Input log delivery and replay are wired end-to-end
- Ready for Phase 16 Plan 02: integration tests for the reconnect flow

---

_Phase: 16-reconnect-via-snapshot-input-replay_
_Completed: 2026-03-29_
