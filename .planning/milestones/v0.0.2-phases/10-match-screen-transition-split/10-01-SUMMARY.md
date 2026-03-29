---
phase: 10-match-screen-transition-split
plan: 01
subsystem: ui
tags: [web-client, room-status, reconnect, vitest, lifecycle-routing]

# Dependency graph
requires:
  - phase: 09-03
    provides: destroy interaction UX and reconnect-safe authoritative state handling patterns in the web client
provides:
  - authoritative room-status-to-screen routing through a dedicated match-screen view-model
  - split lobby and in-game web layouts with shared edge status surfaces and right-docked chat
  - reconnect syncing and confirmation messaging that resolves on first authoritative lifecycle status
affects: [phase-11-camera-ui, UI-01, web-client-navigation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      pure status-to-screen view-model reducers,
      deduped status-delta transition banners,
      reconnect syncing notice that resolves on authoritative membership/lifecycle updates,
    ]

key-files:
  created:
    [
      apps/web/src/match-screen-view-model.ts,
      tests/web/match-screen-view-model.test.ts,
      .planning/phases/10-match-screen-transition-split/10-01-SUMMARY.md,
    ]
  modified: [apps/web/index.html, apps/web/src/client.ts]

key-decisions:
  - 'Use one match-screen view-model pathway (`applyAuthoritativeStatus`) to dedupe lifecycle transition banners across `room:membership` and explicit lifecycle events.'
  - 'Keep a single shared chat surface outside lobby/in-game screen containers so unsent drafts survive authoritative screen transitions.'
  - 'Remove finished-state local lobby override controls so `finished` always maps to the in-game results context until host restart changes authoritative status.'

patterns-established:
  - 'Authoritative screen routing pattern: `RoomStatus` -> `resolveScreenForStatus` -> DOM screen toggle.'
  - 'Reconnect UX pattern: mark syncing on disconnect, then swap to neutral synced notice after first authoritative status.'

requirements-completed: [UI-01]

# Metrics
duration: 13m 22s
completed: 2026-03-02
---

# Phase 10 Plan 01: Match Screen Transition Split Summary

**The web client now routes lobby vs in-game screens strictly from authoritative room lifecycle status, with reconnect sync messaging and shared chat/status surfaces that persist across transitions.**

## Performance

- **Duration:** 13m 22s
- **Started:** 2026-03-02T07:26:38Z
- **Completed:** 2026-03-02T07:40:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added a dedicated `match-screen-view-model` module with deterministic helpers for status mapping, transition dedupe, and reconnect notice state progression.
- Split `apps/web/index.html` into explicit lobby and in-game containers with short fade transitions, shared edge status/banners, and one persistent right-docked chat shell.
- Rewired `client.ts` so screen switches occur only from authoritative status events and removed local finished "Return to Lobby View" override pathways.

## task Commits

Each task was committed atomically:

1. **task 1: add authoritative match-screen view-model and deterministic tests** - `18b975b` (feat)
2. **task 2: split layout into lobby and in-game screens with shared chat/status shell** - `6cbdf43` (feat)
3. **task 3: rewire client transitions to authoritative status only and remove local override paths** - `01d3a63` (feat)

**Plan metadata:** pending

## Files Created/Modified

- `apps/web/src/match-screen-view-model.ts` - Pure lifecycle-to-screen mapping and reconnect notice state helpers.
- `tests/web/match-screen-view-model.test.ts` - Regression coverage for mapping, status dedupe, and reconnect notice sequencing.
- `apps/web/index.html` - Dedicated lobby/in-game screen containers plus shared edge status strip and persistent chat shell.
- `apps/web/src/client.ts` - Authoritative lifecycle routing integration, reconnect indicator handling, and local override removal.

## Decisions Made

- Centralized lifecycle transition handling in match-screen view-model helpers so duplicate authoritative events do not create duplicate screen-transition banners.
- Preserved one chat input node outside screen containers to keep draft messages intact during authoritative status-driven screen switches.
- Removed local finished-state view toggles to keep `finished` locked to in-game results until host restart transitions status back to pre-match lifecycle states.

## Deviations from Plan

None - plan executed exactly as written.

## Auth Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UI-01 is satisfied with authoritative-only lobby/in-game routing and reconnect-safe screen resolution.
- Phase 11 can build camera controls and build-zone visualization on top of the new split-screen shell and shared edge status surfaces.

---

_Phase: 10-match-screen-transition-split_
_Completed: 2026-03-02_

## Self-Check: PASSED

- FOUND: `.planning/phases/10-match-screen-transition-split/10-01-SUMMARY.md`
- FOUND: `apps/web/src/match-screen-view-model.ts`
- FOUND: `tests/web/match-screen-view-model.test.ts`
- FOUND: `18b975b`
- FOUND: `6cbdf43`
- FOUND: `01d3a63`
