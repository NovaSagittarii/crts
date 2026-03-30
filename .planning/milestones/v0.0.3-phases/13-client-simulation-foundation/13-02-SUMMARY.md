---
phase: 13-client-simulation-foundation
plan: 02
subsystem: web-client
tags: [client-simulation, lockstep, determinism, dual-path-rendering]

# Dependency graph
requires:
  - phase: 13-01
    provides: 'RtsRoom.fromPayload() for initializing local simulation from server state'
provides:
  - 'ClientSimulation class managing client-side local RtsRoom lifecycle'
  - 'templateFromPayload helper for converting wire-format template payloads'
  - 'Dual-path rendering wiring in client.ts (local sim + server broadcasts)'
affects:
  [14-input-only-transport, 15-hash-checkpoint-protocol, 16-reconnect-replay]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'Server-driven tick cadence via advanceToTick (no setInterval)'
    - 'Force-insert pattern for server-confirmed events (bypass local validation)'
    - 'Dual-path rendering: local sim runs in parallel with server state broadcasts'

key-files:
  created:
    - apps/web/src/client-simulation.ts
    - tests/web/client-simulation.test.ts
  modified:
    - apps/web/src/client.ts

key-decisions:
  - 'Force-insert server-confirmed build/destroy events directly into team pending lists, bypassing local validation to avoid false desync'
  - 'templateFromPayload helper reconstructs Grid from flat cell array for StructureTemplate.from()'
  - 'Dual-path rendering: local sim runs but rendering still uses server state broadcasts (Phase 14 switches to local sim)'
  - 'pendingSimInit flag handles deferred initialization when match starts while in lobby'

patterns-established:
  - 'ClientSimulation lifecycle: idle -> initialized -> running -> idle'
  - 'advanceToTick loop pattern: while currentTick < targetTick, call rtsRoom.tick()'
  - 'Checkpoint verification: compare local hashHex against server checkpoint hashHex'

requirements-completed: [SIM-01, SIM-02]

# Metrics
duration: 45min
completed: 2026-03-29
---

# Phase 13 Plan 02: ClientSimulation Module + Client Wiring Summary

**ClientSimulation class with server-driven tick advance, input replay, and hash checkpoint verification wired into client.ts socket handlers via dual-path rendering**

## Performance

- **Duration:** 45 min
- **Started:** 2026-03-29T17:45:00Z
- **Completed:** 2026-03-29T18:30:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `ClientSimulation` class with full lifecycle management (idle/initialized/running), server-driven tick advance via `advanceToTick()`, input replay via `applyQueuedBuild()`/`applyQueuedDestroy()`, and hash checkpoint verification
- 20 unit tests covering initialization, tick advance, input replay, hash verification, destroy lifecycle, edge cases (double-tick prevention, idempotent destroy), and end-to-end hash equivalence
- Wired ClientSimulation into client.ts: initializes on room:joined (active match) or deferred via state event (lobby->match), replays build:queued/destroy:queued events, advances and verifies hash on lockstep:checkpoint, destroys on match-finished/room:left
- Added `templateFromPayload` helper to convert wire-format `StructureTemplatePayload` into `StructureTemplate` instances

## Task Commits

Each task was committed atomically:

1. **Task 1: ClientSimulation module with unit tests (TDD)** - `f492221` (feat)
2. **Task 2: Wire ClientSimulation into client.ts** - `0b4f53a` (feat)

## Files Created/Modified

- `apps/web/src/client-simulation.ts` - ClientSimulation class with lifecycle, tick advance, input replay, checkpoint verification; templateFromPayload helper
- `tests/web/client-simulation.test.ts` - 20 unit tests for ClientSimulation covering all behaviors
- `apps/web/src/client.ts` - Wired ClientSimulation into socket event handlers: room:joined, room:left, room:match-started, room:match-finished, lockstep:checkpoint, build:queued, destroy:queued, state

## Decisions Made

- **Force-insert pattern:** Server-confirmed build/destroy events are force-inserted directly into team pending event lists, bypassing `queueBuildEvent`/`queueDestroyEvent` validation. Server already validated these — re-validating locally could cause false desync due to timing differences.
- **templateFromPayload helper:** Added to client-simulation.ts rather than the engine package since it's a client-side concern (converting wire payloads to domain objects). Uses Grid constructor to rebuild from flat cell array.
- **pendingSimInit flag:** Handles the case where match starts while player is in lobby. The flag triggers initialization on the next 'state' event when room status is active.
- **Desync logging only:** Hash mismatches are logged as console warnings. Phase 15 will implement actual resync handling.

## Deviations from Plan

None - plan executed as specified.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ClientSimulation runs in parallel with server state broadcasts (dual-path)
- Phase 14 (Input-Only Transport) can switch rendering from server broadcasts to local sim state
- Phase 15 (Hash Checkpoint Protocol) can build on the existing `verifyCheckpoint` + desync detection logging
- Phase 16 (Reconnect) can use the initialize path for state restoration after reconnect

---

_Phase: 13-client-simulation-foundation_
_Completed: 2026-03-29_
