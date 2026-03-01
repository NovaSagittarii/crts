---
phase: 04-economy-hud-queue-visibility
plan: '03'
subsystem: ui
tags: [economy-hud, queue-visibility, build-preview, web-client]

# Dependency graph
requires:
  - phase: 04-economy-hud-queue-visibility
    provides: Authoritative affordability preview/rejection payloads and pending queue projection from 04-01/04-02.
provides:
  - In-match build-panel economy HUD with resources, net income, pulse cues, and delta chip rendering.
  - Queue action gating tied to authoritative `build:preview` affordability metadata with inline deficit copy.
  - Pending queue timeline rendering grouped by execute tick with deterministic ordering and relative ETA labels.
  - Web client helper module + tests that lock deterministic timeline grouping and per-tick delta aggregation behavior.
affects: [phase-05-quality-gate-validation, apps/web, tests/web]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Keep queue affordability gating server-authoritative by requiring `build:preview` before queue action enablement.
    - Delegate deterministic queue grouping/eta/delta projection to pure helper functions consumed by client rendering.

key-files:
  created:
    - apps/web/src/economy-view-model.ts
    - tests/web/economy-view-model.test.ts
  modified:
    - apps/web/index.html
    - apps/web/src/client.ts
    - apps/web/AGENTS.md

key-decisions:
  - Queueing now uses explicit placement selection plus `build:preview` gating instead of immediate click-to-queue submission.
  - Pending timeline UI consumes `state.teams[].pendingBuilds` and helper sorting/grouping to keep executeTick/eventId ordering deterministic.
  - Economy feedback combines pulse cues and one aggregated chip per tick while using color-only negative-net indication.

patterns-established:
  - 'Preview-Gated Queue Pattern: selected placement emits `build:preview`; queue action stays disabled until preview reports affordable.'
  - 'Deterministic Timeline Pattern: `groupPendingByExecuteTick` + `formatRelativeEta` drive pending-only grouped rendering.'
  - 'Economy Delta Pattern: client aggregates per-tick economy deltas via `aggregateIncomeDelta` for low-noise HUD chips.'

requirements-completed: [ECON-01, ECON-02, ECON-03, UX-01]

# Metrics
duration: 23 min
completed: 2026-03-01
---

# Phase 4 Plan 03: Economy HUD Queue Visibility Summary

**Build controls now show authoritative resources/income, preview-gated queue affordability with exact deficit copy, and a deterministic pending timeline grouped by execute tick.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-03-01T00:22:43Z
- **Completed:** 2026-03-01T00:46:20Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added deterministic web view-model helpers and regression tests for execute-tick grouping, relative ETA copy, and per-tick economy delta aggregation.
- Implemented build-panel HUD UX that surfaces resources/net income near queue controls, animates subtle pulses, and shows one aggregated delta cue per tick.
- Replaced template click-to-queue behavior with explicit placement selection + `build:preview` affordability gating, including inline `needed/current/deficit` feedback when unaffordable.
- Rendered pending queue timeline from authoritative `state` payloads (pending-only, grouped by execute tick, sorted by eventId, relative ETA labels).
- Updated web AGENTS guidance to codify Phase-4 preview/rejection/outcome/state payload consumption rules.

## task Commits

Each task was committed atomically:

1. **task 1: add deterministic web view-model helpers and RED tests for timeline + delta aggregation** - `a577a1c` (feat)
2. **task 2: implement HUD affordability gating, inline deficit feedback, and pending timeline rendering** - `e7f8854` (feat)
3. **task 3: align web AGENTS contract docs and run combined web + integration verification** - `866c81a` (docs)

**Plan metadata:** pending

## Files Created/Modified

- `apps/web/src/economy-view-model.ts` - Pure deterministic helpers for pending grouping, relative ETA labels, and per-tick delta aggregation.
- `tests/web/economy-view-model.test.ts` - Regression coverage locking helper ordering/label/aggregation behavior.
- `apps/web/index.html` - Build-panel HUD markup/styles for resources, income breakdown, queue feedback, and pending timeline containers.
- `apps/web/src/client.ts` - Runtime wiring for preview-gated queue actions, inline deficit messaging, HUD pulse/delta cues, and pending timeline rendering.
- `apps/web/AGENTS.md` - Updated client event usage contract for preview, outcome reconciliation, and enriched economy payload handling.

## Decisions Made

- Use explicit queue action control gated by authoritative preview payloads to prevent unaffordable submissions before emit.
- Keep timeline/delta formatting deterministic by routing all grouping/label rules through `apps/web/src/economy-view-model.ts`.
- Treat `room:error` deficit metadata and `build:outcome` as reconciliation sources for inline queue feedback copy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected roadmap plan progress after updater no-op**

- **Found during:** state/roadmap metadata finalization
- **Issue:** `roadmap update-plan-progress "04"` reported success but left the Phase 4 checklist/progress row unchanged (`2/3` and unchecked `04-03-PLAN.md`).
- **Fix:** Manually checked off `04-03-PLAN.md`, marked Phase 4 complete in phase list, and updated progress row to `3/3 Complete (2026-03-01)`.
- **Files modified:** `.planning/ROADMAP.md`
- **Verification:** Re-read Phase 4 plan checklist and progress table values after patch.
- **Committed in:** metadata follow-up commit

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Metadata now matches executed work; implementation scope remained unchanged.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 4 plan set is complete (`3/3`) with client economy HUD and queue visibility behavior implemented and verified.
- Ready for Phase 5 quality-gate planning/execution.

---

_Phase: 04-economy-hud-queue-visibility_
_Completed: 2026-03-01_

## Self-Check: PASSED

- FOUND: `.planning/phases/04-economy-hud-queue-visibility/04-03-SUMMARY.md`
- FOUND COMMIT: `a577a1c`
- FOUND COMMIT: `e7f8854`
- FOUND COMMIT: `866c81a`
