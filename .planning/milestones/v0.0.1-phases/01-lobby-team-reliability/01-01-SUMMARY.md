---
phase: 01-lobby-team-reliability
plan: 01
subsystem: api
tags: [lobby, spawn, deterministic, vitest]

# Dependency graph
requires: []
provides:
  - Deterministic lobby slot/team/ready state transitions with typed rejection reasons
  - Deterministic equal-angle torus spawn generation with overlap validation
  - RTS base assignment wired to torus spawn layout instead of ad hoc candidates
affects: [01-02-PLAN, lobby lifecycle, team assignment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    ['Server-agnostic lobby aggregate', 'Seeded torus spawn layout selection']

key-files:
  created:
    [
      packages/rts-engine/src/lobby.ts,
      packages/rts-engine/src/spawn.ts,
      packages/rts-engine/test/lobby.test.ts,
      packages/rts-engine/test/spawn.test.ts,
    ]
  modified: [packages/rts-engine/src/rts.ts]

key-decisions:
  - 'Lobby participants enter as spectators and must explicitly claim one of two player slots.'
  - 'Spawn orientation seed is derived from room identity for deterministic base placement in runtime.'
  - 'Default torus spawn radius stays within quarter-span to preserve wrapped-distance separation.'

patterns-established:
  - 'Slot claim rejections return typed reasons plus user-facing messages.'
  - 'Spawn generation uses equal-angle steps with pairwise wrapped-distance validation.'

requirements-completed: [LOBBY-02, LOBBY-03]

# Metrics
duration: 7 min
completed: 2026-02-27
---

# Phase 1 Plan 01: Lobby Slot and Torus Spawn Primitives Summary

**Deterministic lobby slot ownership and torus spawn fairness now run through reusable package APIs, with RTS base assignment consuming the same spawn model.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-27T04:40:32Z
- **Completed:** 2026-02-27T04:47:36Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added RED specs for slot claim constraints, host transfer order, ready toggles, and torus fairness/rematch behavior.
- Implemented `lobby.ts` and `spawn.ts` deterministic domain modules with explicit typed outcomes.
- Replaced RTS candidate spawn selection with torus layout selection seeded from room identity.

## task Commits

Each task was committed atomically:

1. **task 1: add failing unit specs for lobby slot and torus spawn invariants** - `f4daac0` (test)
2. **task 2: implement deterministic lobby room and spawn domain modules** - `85db96c` (feat)
3. **task 3: wire lobby/spawn outputs into RTS room base assignment** - `5a3bb31` (feat)

**Plan metadata:** pending (created after state updates)

## Files Created/Modified

- `packages/rts-engine/test/lobby.test.ts` - RED coverage for slot assignment, ready toggles, and host transfer invariants.
- `packages/rts-engine/test/spawn.test.ts` - RED coverage for deterministic spacing, overlap safety, and rematch reseeding.
- `packages/rts-engine/src/lobby.ts` - Deterministic lobby aggregate with explicit slot claim and readiness transitions.
- `packages/rts-engine/src/spawn.ts` - Equal-angle torus spawn generation and rematch seed progression.
- `packages/rts-engine/src/rts.ts` - Runtime base assignment now uses torus spawn layout outputs.

## Decisions Made

- Players always join lobby as spectators and can only become players through explicit slot claims.
- Team switching is rejected once a player claims a slot to preserve one-player-one-team mapping.
- RTS room spawn orientation is deterministic per room via hashed seed, aligning runtime placement with lobby preview math.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed wrapped-distance spawn overlap from oversized default radius**

- **Found during:** task 2 (implement deterministic lobby room and spawn domain modules)
- **Issue:** Default spawn radius near half-map caused opposite teams to collide under torus wrapped-distance checks.
- **Fix:** Reduced default radius envelope to quarter-span to preserve non-overlap guarantees with wrapped-distance validation.
- **Files modified:** `packages/rts-engine/src/spawn.ts`
- **Verification:** `npx vitest run packages/rts-engine/test/lobby.test.ts packages/rts-engine/test/spawn.test.ts`
- **Committed in:** `85db96c` (part of task commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix was required to satisfy LOBBY-03 non-overlap fairness and kept scope within planned spawn work.

## Issues Encountered

- Initial spawn implementation failed overlap checks for opposite teams on torus wrap; resolved via radius constraint update.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Lobby/spawn domain primitives are ready for server lifecycle wiring in `01-02-PLAN.md`.
- Runtime now consumes deterministic spawn outputs, so server and client can share one fairness model.

---

_Phase: 01-lobby-team-reliability_
_Completed: 2026-02-27_

## Self-Check: PASSED

- Verified summary and key implementation files exist on disk.
- Verified all task commits are present in repository history (`f4daac0`, `85db96c`, `5a3bb31`).
