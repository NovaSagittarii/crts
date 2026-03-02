---
phase: 11-camera-and-build-zone-visualization
plan: 01
subsystem: ui
tags: [camera-controls, build-zone, deterministic-helpers, vitest, rts-engine]

# Dependency graph
requires:
  - phase: 10-01
    provides: authoritative lobby/in-game screen split and reconnect-safe in-match shell for camera/overlay integration
provides:
  - shared build-zone contributor and coverage helpers consumed by engine legality and future web overlays
  - pure camera reducers and inverse coordinate conversion helpers for cursor-anchored pan/zoom wiring
  - deterministic unit and web regression coverage for contributor union semantics and camera precision guarantees
affects: [phase-11-runtime-camera, UI-02, UI-05, pointer-hit-testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      shared build-zone projection helper reuse across authoritative and UI layers,
      pure camera reducers with explicit screen-to-world inversion,
      focused helper tests for geometry boundaries and zoom-anchor invariants,
    ]

key-files:
  created:
    [
      packages/rts-engine/build-zone.ts,
      packages/rts-engine/build-zone.test.ts,
      apps/web/src/camera-view-model.ts,
      tests/web/camera-view-model.test.ts,
      .planning/phases/11-camera-and-build-zone-visualization/11-01-SUMMARY.md,
    ]
  modified: [packages/rts-engine/rts.ts, packages/rts-engine/index.ts]

key-decisions:
  - 'Extracted build-zone contributor projection and radius coverage into `packages/rts-engine/build-zone.ts` so legality and overlay math stay on one canonical implementation.'
  - 'Kept camera behavior in pure reducers (`applyWheelZoomAtPoint`, `applyKeyboardPan`, `screenPointToCell`, `resetCameraToBase`) to prevent runtime event-handler drift.'
  - 'Used local-base reset with spectator map-center fallback in camera helpers to support both active-player and spectator flows in upcoming runtime wiring.'

patterns-established:
  - 'Shared build-zone semantics pattern: runtime inputs -> `collectBuildZoneContributors` -> `collectIllegalBuildZoneCells`.'
  - 'Camera precision pattern: cursor-anchored zoom + inverse point mapping in helper functions before any gameplay hit-testing.'

requirements-completed: [UI-02, UI-05]

# Metrics
duration: 9m
completed: 2026-03-02
---

# Phase 11 Plan 01: Camera and Build-Zone Visualization Summary

**Shared build-zone and camera math foundations now ship as deterministic helper modules, giving Phase 11 runtime wiring a parity-safe path for union coverage and precise pan/zoom hit-testing.**

## Performance

- **Duration:** 9m
- **Started:** 2026-03-02T08:25:10Z
- **Completed:** 2026-03-02T08:34:22Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added `packages/rts-engine/build-zone.ts` and rewired `rts.ts` legality to consume shared contributor and illegal-cell helpers instead of local duplicate math.
- Added `packages/rts-engine/build-zone.test.ts` to lock radius-boundary inclusivity, multi-contributor union behavior, and contributor-removal shrink regression coverage.
- Added `apps/web/src/camera-view-model.ts` with pure pan/zoom/reset reducers and inverse screen/world/cell conversion helpers for runtime camera integration.
- Added `tests/web/camera-view-model.test.ts` to validate zoom clamps, cursor-anchor invariance, pan behavior, and base-reset/spectator fallback targeting.

## task Commits

Each task was committed atomically:

1. **task 1: extract shared union build-zone projection helpers and rewire engine legality usage** - `87f9c4c` (feat)
2. **task 2: add pure camera state helpers and deterministic precision tests** - `96bb385` (feat)

**Plan metadata:** pending

## Files Created/Modified

- `packages/rts-engine/build-zone.ts` - Canonical contributor projection and build-zone coverage/illegal-cell helpers.
- `packages/rts-engine/build-zone.test.ts` - Deterministic helper tests for contributor centers, boundary inclusivity, union coverage, and removal shrink behavior.
- `packages/rts-engine/rts.ts` - Replaced embedded build-zone legality helpers with shared module usage.
- `packages/rts-engine/index.ts` - Re-exported build-zone helpers through `#rts-engine`.
- `apps/web/src/camera-view-model.ts` - Pure camera reducers and inverse coordinate conversion helpers.
- `tests/web/camera-view-model.test.ts` - Web-facing deterministic camera precision regression coverage.

## Decisions Made

- Centralized build-zone projection and legality helpers in `#rts-engine` so upcoming visualization code can consume identical contributor and radius semantics.
- Chose explicit camera helper APIs for pan, cursor-anchored zoom, point inversion, and reset targeting to keep runtime input wiring deterministic and testable.
- Used local-base center reset with spectator map-center fallback to align with Phase 11 context while supporting non-team participants.

## Deviations from Plan

None - plan executed exactly as written.

## Auth Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Runtime camera input wiring can now consume tested reducers without duplicating transform math in `client.ts`.
- Authoritative local-team build-zone overlay rendering can reuse shared contributor and coverage helpers directly in Phase 11 Plan 02.

---

_Phase: 11-camera-and-build-zone-visualization_
_Completed: 2026-03-02_

## Self-Check: PASSED

- FOUND: `.planning/phases/11-camera-and-build-zone-visualization/11-01-SUMMARY.md`
- FOUND: `packages/rts-engine/build-zone.ts`
- FOUND: `packages/rts-engine/build-zone.test.ts`
- FOUND: `apps/web/src/camera-view-model.ts`
- FOUND: `tests/web/camera-view-model.test.ts`
- FOUND: `87f9c4c`
- FOUND: `96bb385`
