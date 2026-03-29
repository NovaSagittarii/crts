---
phase: 03-deterministic-build-queue-validation
plan: '02'
subsystem: api
tags: [socket.io, build-queue, deterministic-outcomes, integration-tests]

# Dependency graph
requires:
  - phase: 03-deterministic-build-queue-validation
    provides: Engine-authored `buildOutcomes` and pending-event drain reasons from 03-01.
provides:
  - Queue-only gameplay mutation enforcement at Socket.IO boundary.
  - Immediate `build:queued` acknowledgements paired with room-scoped terminal `build:outcome` emissions.
  - Explicit socket-visible rejection reasons for queue validation and direct mutation bypass attempts.
affects:
  [phase-04-economy-hud-queue-visibility, apps/server, tests/integration/server]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Server runtime maps deterministic engine outcome records directly into typed `build:outcome` payloads.
    - Gameplay mutations are accepted only through `build:queue`; `cell:update` is an explicit rejection path.

key-files:
  created: []
  modified:
    - tests/integration/server/server.test.ts
    - tests/integration/server/match-lifecycle.test.ts
    - apps/server/src/server.ts
    - apps/server/AGENTS.md

key-decisions:
  - 'Emit `build:outcome` room-wide from `tickRoom()` outputs so each acknowledged event has observable closure.'
  - 'Translate queue validation failures to canonical `room:error.reason` codes instead of generic `build-rejected` responses.'
  - 'Reject `cell:update` in active play with `queue-only-mutation-path` to remove direct gameplay bypass mutations.'

patterns-established:
  - 'Queue Closure Pattern: accepted queue events must emit one terminal outcome payload with execute/resolved tick context.'
  - 'Runtime Mutation Gate Pattern: server boundary allows gameplay mutations only through validated queue intents.'

requirements-completed: [BUILD-01, BUILD-02, BUILD-03, BUILD-04]

# Metrics
duration: 12 min
completed: 2026-02-27
---

# Phase 3 Plan 02: Deterministic Build Queue Validation Summary

**Socket runtime now enforces queue-only gameplay mutations and emits deterministic `build:queued` + terminal `build:outcome` contracts with explicit rejection reasons.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-27T12:10:15Z
- **Completed:** 2026-02-27T12:22:42Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added RED integration coverage for queue acknowledgement/outcome closure, explicit validation reasons, and direct mutation bypass rejection.
- Implemented server runtime queue gate enforcement: `build:queue` remains the mutation entry point, `cell:update` is explicitly rejected, and `tickRoom()` outcomes are emitted via room-scoped `build:outcome` events.
- Aligned lifecycle integration helpers with queue-driven breach behavior and updated server runtime contract docs for outcome payloads and canonical reason strings.
- Ran full Phase-3 integration regression command (`server`, `match-lifecycle`, `lobby-contract`, `lobby-reconnect`) with all suites passing.

## task Commits

Each task was committed atomically:

1. **task 1: add RED integration specs for queue ack/outcome contract and bypass rejection** - `1e3aa51` (test)
2. **task 2: implement queue-only runtime mutation gate and terminal outcome emission** - `6a30de6` (feat)
3. **task 3: align server contract documentation and run full phase regression set** - `bb2d860` (docs)

Additional task-1 stabilization commit:

- `a20c3af` (test) - hardened outcome event collection in integration specs to avoid same-tick listener misses.

**Plan metadata:** pending

## Files Created/Modified

- `tests/integration/server/server.test.ts` - Added queue contract RED specs, active-match helpers, explicit rejection reason assertions, and robust `build:outcome` collection.
- `tests/integration/server/match-lifecycle.test.ts` - Switched breach helper from direct cell edits to queue-driven build intents and aligned lifecycle expectations.
- `apps/server/src/server.ts` - Emitted room-scoped terminal build outcomes, mapped queue validation failures to explicit reasons, and blocked direct `cell:update` gameplay mutations.
- `apps/server/AGENTS.md` - Documented `build:outcome` payload contract, queue-only mutation policy, and canonical room error reasons.

## Decisions Made

- Reused engine-authored deterministic outcomes (`tickRoom().buildOutcomes`) rather than recalculating runtime terminal states in server handlers.
- Standardized socket rejection reason mapping so bounds/territory and payload validation errors are contract-visible.
- Kept queue acknowledgement semantics (`build:queued`) unchanged while adding room-scoped terminal closure (`build:outcome`) for every accepted event.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed integration listener race for same-tick outcome bursts**

- **Found during:** task 1/task 2 verification
- **Issue:** Sequential one-shot listeners missed `build:outcome` bursts emitted in the same tick, causing false timeout failures despite correct runtime behavior.
- **Fix:** Added buffered `collectBuildOutcomes` helper and queued high-delay test events so acknowledgements are observed before terminal outcomes are collected.
- **Files modified:** `tests/integration/server/server.test.ts`
- **Verification:** `npx vitest run tests/integration/server/server.test.ts tests/integration/server/match-lifecycle.test.ts`
- **Committed in:** `a20c3af`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix improved integration determinism and did not change planned runtime scope.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 3 queue validation contract is complete and passing regression coverage.
- Ready to start Phase 4 economy HUD and queue visibility work on top of stable queue ack/outcome semantics.

---

_Phase: 03-deterministic-build-queue-validation_
_Completed: 2026-02-27_

## Self-Check: PASSED

- FOUND: `.planning/phases/03-deterministic-build-queue-validation/03-02-SUMMARY.md`
- FOUND: `tests/integration/server/server.test.ts`
- FOUND: `tests/integration/server/match-lifecycle.test.ts`
- FOUND: `apps/server/src/server.ts`
- FOUND: `apps/server/AGENTS.md`
- FOUND COMMIT: `1e3aa51`
- FOUND COMMIT: `a20c3af`
- FOUND COMMIT: `6a30de6`
- FOUND COMMIT: `bb2d860`
