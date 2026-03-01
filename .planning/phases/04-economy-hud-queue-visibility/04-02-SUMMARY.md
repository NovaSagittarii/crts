---
phase: 04-economy-hud-queue-visibility
plan: '02'
subsystem: api
tags: [socket.io, build-preview, affordability, queue-visibility]

# Dependency graph
requires:
  - phase: 04-economy-hud-queue-visibility
    provides: Engine-authored affordability metadata, preview DTOs, and pending queue projection rows from 04-01.
provides:
  - Runtime `build:preview` handling that returns authoritative affordability fields before queue submission.
  - Structured `room:error` rejection payloads with exact `needed/current/deficit` metadata for unaffordable queue attempts.
  - Integration coverage that locks preview, queue rejection, and pending queue state projection behavior.
affects: [phase-04-03, apps/web/src/client.ts, tests/integration/server]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Derive runtime preview responses by probing `queueBuildEvent` on cloned room state.
    - Forward canonical rejection metadata from engine outputs directly to socket payloads.

key-files:
  created: []
  modified:
    - apps/server/src/server.ts
    - tests/integration/server/server.test.ts
    - apps/server/AGENTS.md

key-decisions:
  - Use `queueBuildEvent` probes on cloned room state for `build:preview` to avoid duplicating affordability/cost logic in runtime code.
  - Preserve canonical queue rejection reasons from engine `result.reason` and attach deficit fields to `room:error` for `insufficient-resources`.
  - Keep `state` and `build:outcome` payloads as room-scoped pass-throughs of engine metadata, including pending queue and affordability fields.

patterns-established:
  - 'Preview Probe Pattern: server computes affordability preview by running engine queue validation against a cloned room snapshot.'
  - 'Deficit Rejection Pattern: queue-time insufficient resources are surfaced as `room:error` with structured `needed/current/deficit` fields.'

requirements-completed: [ECON-02, ECON-03, UX-01]

# Metrics
duration: 19 min
completed: 2026-03-01
---

# Phase 4 Plan 02: Economy HUD Queue Visibility Summary

**Socket runtime now emits authoritative affordability preview payloads, deficit-rich queue rejection errors, and deterministic pending-queue state projections required by Phase-4 HUD and timeline UX.**

## Performance

- **Duration:** 19 min
- **Started:** 2026-02-28T23:59:03Z
- **Completed:** 2026-03-01T00:18:08Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added RED integration contracts for `build:preview`, insufficient-resource queue rejections, and pending queue projection ordering/removal in room state.
- Implemented server-side `build:preview` handling via engine queue probes and updated `build:queue` rejection mapping to emit canonical reasons plus deficit metadata.
- Updated server AGENTS contract docs to describe preview request/response events, `room:error` deficit fields, and enriched queue/outcome/state payload expectations.

## task Commits

Each task was committed atomically:

1. **task 1: add RED integration coverage for preview contract, deficit rejections, and pending queue state projection** - `28f77ab` (test)
2. **task 2: implement server preview handler and structured affordability rejection mapping** - `30d3e59` (feat)
3. **task 3: align server AGENTS contract docs and rerun lifecycle integration guardrails** - `823a444` (docs)

**Plan metadata:** pending

## Files Created/Modified

- `tests/integration/server/server.test.ts` - Added runtime contract assertions for preview payload fields, queue-time deficit rejection metadata, and pending queue ordering/removal behavior.
- `apps/server/src/server.ts` - Added `build:preview` runtime handler backed by engine probes and extended queue rejection mapping to emit canonical reasons and affordability deficits.
- `apps/server/AGENTS.md` - Documented Phase-4 preview/rejection/state/outcome server socket contract surfaces.

## Decisions Made

- Runtime preview responses are computed through engine-authoritative queue probes on cloned room state, not duplicated cost math in the Socket.IO layer.
- Queue rejection mapping prefers engine `reason` codes and only falls back to message mapping for non-canonical legacy paths.
- Insufficient-resource queue rejections expose numeric `needed/current/deficit` fields at the socket boundary for deterministic HUD copy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stabilized insufficient-resource integration path with non-income template selection**

- **Found during:** task 2 verification (`tests/integration/server/server.test.ts`)
- **Issue:** The initial unaffordable rejection test used the `generator` template, whose income side effects made queue-time resource depletion non-deterministic.
- **Fix:** Switched that test path to `eater-1` (non-income) and kept the repeated placement drain loop to ensure deterministic queue-time `insufficient-resources` rejection.
- **Files modified:** `tests/integration/server/server.test.ts`
- **Verification:** `npx vitest run tests/integration/server/server.test.ts`
- **Committed in:** `30d3e59` (task 2 commit)

**2. [Rule 3 - Blocking] Corrected roadmap phase progress after updater no-op**

- **Found during:** state/roadmap metadata finalization
- **Issue:** `roadmap update-plan-progress "04"` reported `summary_count: 2` but left the Phase 4 plan checklist/progress row unchanged.
- **Fix:** Manually checked off `04-02-PLAN.md` and updated the Phase 4 progress row from `1/3` to `2/3`.
- **Files modified:** `.planning/ROADMAP.md`
- **Verification:** Re-read `ROADMAP.md` phase checklist and progress table entries.
- **Committed in:** metadata follow-up commit

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes were scope-contained and required to keep contract verification deterministic and planning metadata accurate.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Server runtime now emits preview and rejection metadata required for HUD affordability gating and inline deficit feedback.
- Pending queue projection behavior is locked at integration level and ready for client timeline/HUD consumption in `04-03-PLAN.md`.

---

_Phase: 04-economy-hud-queue-visibility_
_Completed: 2026-03-01_

## Self-Check: PASSED

- FOUND: `.planning/phases/04-economy-hud-queue-visibility/04-02-SUMMARY.md`
- FOUND COMMIT: `28f77ab`
- FOUND COMMIT: `30d3e59`
- FOUND COMMIT: `823a444`
