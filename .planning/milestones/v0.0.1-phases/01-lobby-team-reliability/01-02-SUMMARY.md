---
phase: 01-lobby-team-reliability
plan: '02'
subsystem: api
tags: [socket.io, lobby, integration-tests, countdown, chat]

# Dependency graph
requires:
  - phase: 01-lobby-team-reliability
    provides: deterministic lobby slot/team primitives from 01-01
provides:
  - Server-authoritative spectator-first room lifecycle with slot claims and ready toggles
  - Host-guarded countdown start flow with explicit rejection reasons
  - Room-scoped chat fanout covering players and spectators
affects: [phase-01-plan-03, reconnect-flow, web-lobby-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Revisioned room membership snapshots emitted alongside room-scoped state updates
    - Spectator-first join flow requiring explicit slot claims before gameplay actions

key-files:
  created:
    - tests/integration/server/lobby-contract.test.ts
  modified:
    - apps/server/src/server.ts
    - apps/server/AGENTS.md
    - tests/integration/server/server.test.ts

key-decisions:
  - 'Expose room membership snapshots with monotonically increasing revisions for deterministic lobby visibility.'
  - 'Keep force-start disabled: host can start only when both player slots are explicitly ready.'
  - 'Emit room-scoped chat to all room participants (players + spectators) with server-assigned sender metadata.'

patterns-established:
  - 'Lobby Authority Pattern: Socket handlers mutate lobby + room domain state, then broadcast room:list + room:membership snapshots.'
  - 'Countdown Guardrail Pattern: Lock not-ready toggles during countdown and continue countdown despite disconnect churn.'

requirements-completed: [LOBBY-01, LOBBY-02]

# Metrics
duration: 12 min
completed: 2026-02-27
---

# Phase 1 Plan 2: Authoritative Lobby Lifecycle Summary

**Socket.IO lobby runtime now enforces deterministic spectator-first room membership, explicit slot claims/readiness, and guarded host countdown start semantics with spectator-inclusive chat.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-27T04:52:02Z
- **Completed:** 2026-02-27T05:04:39Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added RED integration contract coverage for deterministic room list/create/join/leave, slot claim rules, readiness, host transfer, countdown guardrails, and spectator chat.
- Refactored server lobby flow to spectator-first joins with explicit `room:claim-slot`, `room:set-ready`, `room:start`, `room:membership`, and `chat:*` lifecycle events.
- Updated server event contract docs and adapted legacy integration tests to validate gameplay behavior under explicit slot-claim model.

## task Commits

Each task was committed atomically:

1. **task 1: add failing integration tests for deterministic room and team contract** - `0c1850c` (test)
2. **task 2: implement server lobby lifecycle, start guardrails, and spectator chat** - `e4b040c` (feat)
3. **task 3: align runtime contract docs and run regression integration tests** - `d72373c` (fix)

## Files Created/Modified

- `tests/integration/server/lobby-contract.test.ts` - New integration contract suite for room lifecycle, slot policy, readiness, countdown, and chat behavior.
- `apps/server/src/server.ts` - Authoritative room runtime with revisioned membership snapshots, host/start policy checks, and room chat broadcasts.
- `apps/server/AGENTS.md` - Updated server event contract to include new lobby and chat event surface.
- `tests/integration/server/server.test.ts` - Regression tests updated for spectator-first join and explicit slot claim prerequisites.

## Decisions Made

- Added `room:membership` as the canonical room snapshot event containing revision, host, slots, participants, status, and countdown metadata.
- Kept room code support aliasing room id for now to satisfy room-code join requirements without introducing a separate code generator.
- Preserved existing `state` payload cadence while layering lobby lifecycle events instead of moving simulation logic into runtime handlers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added periodic membership resync to prevent missed snapshot races**

- **Found during:** task 2 (server lobby lifecycle implementation)
- **Issue:** Join/claim operations could emit `room:membership` before a client test listener was attached, causing intermittent contract visibility gaps.
- **Fix:** Re-emit authoritative room membership snapshots during tick broadcasts without incrementing revision, preserving monotonic revision semantics while enabling deterministic resync.
- **Files modified:** apps/server/src/server.ts
- **Verification:** `npx vitest run tests/integration/server/lobby-contract.test.ts`
- **Committed in:** e4b040c

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix stayed within lobby determinism scope and improved robustness without architectural drift.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Room/team contract baseline is stable and verified across both new and legacy integration suites.
- Ready for `01-03-PLAN.md` reconnect hold + reclaim-priority flow.

---

_Phase: 01-lobby-team-reliability_
_Completed: 2026-02-27_

## Self-Check: PASSED
