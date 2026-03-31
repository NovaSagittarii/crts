---
phase: 09-destroy-flow-and-determinism-gates
plan: 03
subsystem: ui
tags: [web-client, destroy-flow, reconnect, socket.io, vitest]

# Dependency graph
requires:
  - phase: 09-02
    provides: destroy queue runtime events and reconnect-safe authoritative state projection
provides:
  - owned-structure destroy controls with inline confirmation gating in the web gameplay panel
  - deterministic destroy interaction view-model transitions for selection, confirmation, pending, and completion
  - acting-player destroy queued/outcome feedback and reconnect synced notice UX in the client runtime
affects: [phase-10-ui-navigation, STRUCT-02, QUAL-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      authoritative destroy selection projection from state snapshots,
      acting-player-only destroy feedback via team-gated socket handlers,
      one-shot reconnect sync toast after first post-reconnect state payload,
    ]

key-files:
  created:
    [
      apps/web/src/destroy-view-model.ts,
      tests/web/destroy-view-model.test.ts,
      .planning/phases/09-destroy-flow-and-determinism-gates/09-03-SUMMARY.md,
    ]
  modified: [apps/web/index.html, apps/web/src/client.ts]

key-decisions:
  - 'Drive destroy ownership, confirmation, and pending projection from authoritative structure and pendingDestroys state payloads instead of client-local rule simulation.'
  - 'Gate destroy queued/outcome feedback by acting team id so opponents infer destroy changes from authoritative board updates only.'
  - 'Show reconnect sync confirmation once, immediately after the first post-reconnect authoritative state payload.'

patterns-established:
  - 'Destroy UI projection pattern: board selection -> ownership gate -> optional confirm arm -> queue emit, while pending state remains retargetable.'
  - 'Destroy feedback pattern: inline status plus toast for the acting player, with rejected reasons surfaced from authoritative payloads.'

requirements-completed: [STRUCT-02, QUAL-04]

# Metrics
duration: 7m 2s
completed: 2026-03-02
---

# Phase 9 Plan 03: Web Destroy Controls and Reconnect UX Summary

**The web client now ships owned-only destroy controls with confirmation-aware state transitions, acting-player destroy outcome feedback, and reconnect sync notice behavior that converges from authoritative state payloads.**

## Performance

- **Duration:** 7m 2s
- **Started:** 2026-03-02T06:47:33Z
- **Completed:** 2026-03-02T06:54:35Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added gameplay-panel destroy controls and a dedicated destroy view-model that enforces owned-selection gating, core confirmation arm/cancel flow, pending tracking, and deterministic clear-on-destroy transitions.
- Wired destroy selection and pending projection in `client.ts` from authoritative `state.teams[].structures` and `state.teams[].pendingDestroys`, preserving retargeting while suppressing same-target duplicate pending rows.
- Added acting-player-only destroy queue/outcome handlers plus reconnect synced toast feedback, and validated web destroy regressions with focused Vitest coverage and a production build.

## task Commits

Each task was committed atomically:

1. **task 1: add owned-structure selection and destroy controls with confirmation state** - `040a420` (feat)
2. **task 2: wire destroy socket events, pending and rejection feedback, and reconnect synced notice** - `6f6c71c` (feat)

**Plan metadata:** pending

## Files Created/Modified

- `apps/web/index.html` - Adds destroy action controls, inline confirmation panel, and feedback slots in the gameplay panel.
- `apps/web/src/destroy-view-model.ts` - Implements deterministic destroy UI state helpers for selection ownership, confirmation, pending synchronization, queue registration, and outcome cleanup.
- `apps/web/src/client.ts` - Wires destroy interaction rendering, queue emits, acting-player destroy queued/outcome handlers, and reconnect synced notice behavior.
- `tests/web/destroy-view-model.test.ts` - Adds regression tests for owned-vs-non-owned selection, confirmation gating, pending idempotency, and successful-destroy reset.

## Decisions Made

- Keep destroy interaction truth derived from authoritative `state` payloads (`structures`, `pendingDestroys`) and only use local view-model state for presentation transitions.
- Preserve opponent UX parity by scoping explicit destroy queued/outcome notices to the acting team while leaving opponents to infer via state updates.
- Surface reconnect recovery with a subtle one-shot `Reconnected, state synced.` toast on first post-reconnect state resync.

## Deviations from Plan

None - plan executed exactly as written.

## Auth Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Web destroy controls now align with Phase 9 server destroy contracts and deterministic reconnect convergence expectations.
- Phase 10 can proceed with lobby/in-game transition split work on top of stable in-match destroy interaction surfaces.

---

_Phase: 09-destroy-flow-and-determinism-gates_
_Completed: 2026-03-02_

## Self-Check: PASSED

- FOUND: `.planning/phases/09-destroy-flow-and-determinism-gates/09-03-SUMMARY.md`
- FOUND: `apps/web/src/destroy-view-model.ts`
- FOUND: `tests/web/destroy-view-model.test.ts`
- FOUND: `040a420`
- FOUND: `6f6c71c`
