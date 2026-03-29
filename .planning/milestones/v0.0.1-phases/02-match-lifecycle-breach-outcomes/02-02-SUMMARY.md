---
phase: 02-match-lifecycle-breach-outcomes
plan: '02'
subsystem: api
tags: [socket.io, lifecycle, breach-outcomes, reconnect, integration-tests]

# Dependency graph
requires:
  - phase: 02-match-lifecycle-breach-outcomes
    provides: Engine lifecycle transition guards and canonical breach outcome ranking from 02-01.
provides:
  - Server-authoritative lifecycle transitions (`lobby -> countdown -> active -> finished`) with host start/cancel/restart controls.
  - Canonical `room:match-finished` winner-first standings payload with frozen post-match mutations.
  - Restart flow that resets runtime match internals while preserving slot assignments.
affects:
  [phase-02-plan-03-ui, phase-03-build-queue-validation, socket-contracts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Shared lifecycle guard usage from server runtime (`transitionMatchLifecycle`) for start/cancel/finish/restart.
    - Centralized gameplay mutation authorization gate with explicit `invalid-state` and `defeated` reasons.

key-files:
  created: []
  modified:
    - tests/integration/server/match-lifecycle.test.ts
    - apps/server/src/server.ts
    - apps/server/src/lobby-session.ts
    - packages/rts-engine/socket-contract.ts
    - apps/server/AGENTS.md

key-decisions:
  - 'Use `room:start` as a dual-purpose host-only action for initial start and restart from `finished`, with transition guards deciding legality.'
  - 'Keep active-match disconnect expiry non-terminal by preserving team/session membership and continuing simulation until breach outcome.'
  - 'Re-broadcast `room:match-finished` snapshots in finished state so reconnecting and late listeners receive authoritative standings.'

patterns-established:
  - 'Lifecycle Authority Pattern: Runtime transitions are accepted/rejected via engine guard output and surfaced with explicit reason codes.'
  - 'Mutation Lockout Pattern: Gameplay mutations pass through one gate enforcing active-only + defeated lockouts before any engine mutator call.'

requirements-completed: [MATCH-01, MATCH-02, MATCH-03]

# Metrics
duration: 9 min
completed: 2026-02-27
---

# Phase 2 Plan 2: Server lifecycle and breach outcome authority summary

**Socket runtime now enforces one canonical lifecycle with breach-only terminal outcomes, winner-first finished payloads, and deterministic host restart resets under explicit precondition guards.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-27T10:35:32Z
- **Completed:** 2026-02-27T10:44:41Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added RED integration assertions for host-only lifecycle controls, countdown sequencing, restart-invalid-state rejection, and stronger post-restart reset checks.
- Implemented server lifecycle authority wiring: guarded start/cancel/finish/restart transitions, canonical `room:match-finished` emission, and finished-state mutation freeze.
- Preserved active disconnect continuity by avoiding team removal on hold expiry and keeping reconnect-aware membership state for non-terminal disconnects.
- Added centralized gameplay mutation authorization and updated server event-contract guidance for finished outcomes and lifecycle reason codes.

## task Commits

Each task was committed atomically:

1. **task 1: add failing integration coverage for lifecycle, finish authority, and restart semantics** - `66ce059` (test)
2. **task 2: implement authoritative lifecycle transitions, finish freeze, and restart flow** - `f31d892` (feat)
3. **task 3: enforce defeat mutation lockouts and align runtime contract docs** - `323ce9d` (fix)

**Plan metadata:** pending

## Files Created/Modified

- `tests/integration/server/match-lifecycle.test.ts` - Expanded lifecycle contract assertions for host authority, countdown behavior, and restart reset expectations.
- `apps/server/src/server.ts` - Added lifecycle transition guards, finished/outcome emission, restart reset wiring, and centralized gameplay mutation lockouts.
- `apps/server/src/lobby-session.ts` - Exposed room hold/connection helpers and disconnect reason tracking used by lifecycle precondition checks.
- `packages/rts-engine/socket-contract.ts` - Extended typed socket contract with `finished` status and lifecycle events used by server/runtime tests.
- `apps/server/AGENTS.md` - Updated server event and reason-code contract documentation with multi-team-safe outcome wording.

## Decisions Made

- Reused engine lifecycle guards in server runtime instead of introducing ad-hoc status branching per handler.
- Kept lobby readiness checks for initial start compatibility while adding stronger lifecycle precondition enforcement for slot occupancy/connection/holds.
- Treated `room:match-finished` as an authoritative snapshot stream (initial emit + finished resync emits) to avoid result visibility races.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended shared socket contract to include finished lifecycle events**

- **Found during:** task 2
- **Issue:** Server runtime needed typed support for `finished` status plus `room:cancel-countdown` and `room:match-finished`; existing socket contract only allowed lobby/countdown/active events.
- **Fix:** Updated `packages/rts-engine/socket-contract.ts` with finished status and lifecycle event payloads.
- **Files modified:** `packages/rts-engine/socket-contract.ts`
- **Verification:** `npx vitest run tests/integration/server/match-lifecycle.test.ts`
- **Committed in:** `f31d892`

**2. [Rule 1 - Bug] Re-broadcast finished outcomes for late-listener and reconnect reliability**

- **Found during:** task 2
- **Issue:** Result consumers could miss one-shot `room:match-finished` emits when listener registration lagged the breach tick.
- **Fix:** Re-emitted canonical finished snapshot during finished-state tick broadcasts.
- **Files modified:** `apps/server/src/server.ts`
- **Verification:** `npx vitest run tests/integration/server/match-lifecycle.test.ts`
- **Committed in:** `f31d892`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes were required for contract correctness and deterministic runtime behavior; no scope creep.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Server lifecycle authority and finished/restart contracts are stable under integration coverage.
- Ready for `02-03-PLAN.md` client UX work that consumes countdown/finished/defeat signals.

---

_Phase: 02-match-lifecycle-breach-outcomes_
_Completed: 2026-02-27_

## Self-Check: PASSED

- FOUND: `.planning/phases/02-match-lifecycle-breach-outcomes/02-02-SUMMARY.md`
- FOUND: `tests/integration/server/match-lifecycle.test.ts`
- FOUND: `apps/server/src/server.ts`
- FOUND: `apps/server/src/lobby-session.ts`
- FOUND: `packages/rts-engine/socket-contract.ts`
- FOUND: `apps/server/AGENTS.md`
- FOUND COMMIT: `66ce059`
- FOUND COMMIT: `f31d892`
- FOUND COMMIT: `323ce9d`
