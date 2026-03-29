---
phase: 02-match-lifecycle-breach-outcomes
plan: '01'
subsystem: api
tags: [lifecycle, breach-outcome, deterministic-ranking, vitest, rts-engine]

requires:
  - phase: 01-lobby-team-reliability
    provides: Authoritative player-slot readiness and reconnect-hold semantics used by lifecycle preconditions.
provides:
  - Pure lifecycle transition guards for start/cancel/finish/restart paths.
  - Canonical winner-first outcome ranking with deterministic same-tick tie-break ordering.
  - Core structure HP restore/destruction model with per-team build and territory outcome stats.
affects: [phase-02-server-lifecycle, phase-03-build-queue-validation]

tech-stack:
  added: []
  patterns:
    [
      pure lifecycle reducer helpers,
      deterministic comparator chain,
      core HP restore checks,
    ]

key-files:
  created:
    - packages/rts-engine/match-lifecycle.ts
    - packages/rts-engine/match-lifecycle.test.ts
  modified:
    - packages/rts-engine/rts.ts
    - packages/rts-engine/rts.test.ts
    - packages/rts-engine/index.ts

key-decisions:
  - 'Use explicit transitionMatchLifecycle guards so start/restart legality is one reusable authority path.'
  - 'Lock same-tick ranking comparator to coreHpBeforeResolution desc -> territoryCellCount desc -> appliedBuildCount desc -> teamId asc.'
  - 'Model core defeat through HP-consuming restore checks and only mark teams defeated when core HP reaches zero.'

patterns-established:
  - 'Canonical results are built from engine snapshots and emitted winner-first with multi-team-safe outcome wording.'
  - 'Structure instances always project buildRadius from active template buildArea and drop to 0 when inactive.'

requirements-completed: [MATCH-01, MATCH-02]

duration: 8 min
completed: 2026-02-27
---

# Phase 2 Plan 01: Match lifecycle authority summary

**Engine-level lifecycle guards, deterministic breach ranking, and HP-based core destruction now produce one canonical winner-first match outcome path.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-27T10:14:14Z
- **Completed:** 2026-02-27T10:22:45Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added `packages/rts-engine/match-lifecycle.ts` with reusable lifecycle transition guards and canonical outcome ranking helpers.
- Extended RTS engine state with core `hp`/`isCore`/`buildRadius`, deterministic restore-to-destruction checks, and internal timeline event tracking.
- Added/updated unit tests that lock lifecycle transitions, tie-break ordering, winner-first standings, core HP behavior, and buildRadius semantics.
- Exposed lifecycle helpers through `#rts-engine` entrypoint for upcoming server runtime lifecycle wiring.

## task Commits

Each task was committed atomically:

1. **task 1: codify RED unit specs for lifecycle transitions and canonical breach ranking** - `0a8c522` (test)
2. **task 2: implement engine lifecycle and breach outcome authorities** - `7e72bf9` (feat)
3. **task 3: stabilize package exports and run rts-engine unit gate** - `28bf3db` (feat)

**Plan metadata:** Pending (added after state/roadmap updates)

## Files Created/Modified

- `packages/rts-engine/match-lifecycle.ts` - pure lifecycle transition + deterministic ranking/outcome helpers.
- `packages/rts-engine/match-lifecycle.test.ts` - lifecycle legality, restart guard, comparator, and result contract tests.
- `packages/rts-engine/rts.ts` - core HP restore/destruction model, structure buildRadius projection, build stats, and outcome snapshot builders.
- `packages/rts-engine/rts.test.ts` - tests for buildRadius semantics and HP-based core defeat behavior.
- `packages/rts-engine/index.ts` - package entrypoint export for lifecycle/outcome APIs.

## Decisions Made

- Use one explicit lifecycle transition function (`transitionMatchLifecycle`) for legal state progression and restart gating.
- Resolve same-tick elimination ordering with a fixed total-order comparator that ends with `teamId asc` fallback.
- Keep internal timeline event tracking in `RoomState` for future UI use while excluding timeline display fields from payload contracts in this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Non-core structures were initialized with zero HP and never became active**

- **Found during:** task 2
- **Issue:** Generator structures stayed inactive, causing income/buildRadius assertions to fail.
- **Fix:** Initialize non-core structures with HP `1` so integrity checks can activate them and project template build area.
- **Files modified:** `packages/rts-engine/rts.ts`
- **Verification:** `npx vitest run packages/rts-engine/match-lifecycle.test.ts packages/rts-engine/rts.test.ts`
- **Committed in:** `7e72bf9`

**2. [Rule 1 - Bug] Legacy immediate-defeat test conflicted with HP-based core destruction contract**

- **Found during:** task 2
- **Issue:** Existing test expected defeat after one breach tick, which contradicted the new restore-until-HP-zero behavior.
- **Fix:** Updated the legacy defeat assertion to exhaust core HP through repeated breach cycles before expecting defeat.
- **Files modified:** `packages/rts-engine/rts.test.ts`
- **Verification:** `npx vitest run packages/rts-engine/match-lifecycle.test.ts packages/rts-engine/rts.test.ts`
- **Committed in:** `7e72bf9`

---

**Total deviations:** 2 auto-fixed (2 bug fixes)
**Impact on plan:** Both fixes were required for correctness and consistency with locked MATCH-02 core HP semantics; no scope creep.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- MATCH-01/MATCH-02 engine primitives are in place for server lifecycle integration.
- Ready for `02-02-PLAN.md` to wire runtime handlers and defeat lockout enforcement to these package APIs.

---

_Phase: 02-match-lifecycle-breach-outcomes_
_Completed: 2026-02-27_

## Self-Check: PASSED

- Verified summary and key created files exist on disk.
- Verified task commits `0a8c522`, `7e72bf9`, and `28bf3db` are present in git history.
