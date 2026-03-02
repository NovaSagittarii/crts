---
phase: 07-authoritative-union-build-zones
plan: '01'
subsystem: engine+runtime
tags: [rts-engine, build-zones, queue-validation, build-01, build-02]

# Dependency graph
requires:
  - phase: 06-base-geometry-and-integrity-core
    provides: Canonical 5x5 base helpers and deterministic integrity lifecycle used by zone contributors.
provides:
  - Authoritative full-footprint union-zone legality using fixed radius-15 contributor checks.
  - Queue resolve-time revalidation with post-apply contributor activation semantics.
  - Runtime feedback alignment for build-zone rejection wording and deduped invalid-toast UX.
affects:
  [phase-08-transform-placement-consistency, phase-11-build-zone-visualization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Structure-contributor union checks run in engine queue + resolve phases.
    - Integration placement fixtures pre-filter full footprints against radius checks.

key-files:
  created:
    - .planning/phases/07-authoritative-union-build-zones/07-01-SUMMARY.md
  modified:
    - packages/rts-engine/gameplay-rules.ts
    - packages/rts-engine/rts.ts
    - packages/rts-engine/rts.test.ts
    - apps/server/src/server.ts
    - apps/web/src/client.ts
    - tests/integration/server/server.test.ts
    - tests/integration/server/quality-gate-loop.test.ts

key-decisions:
  - Keep `outside-territory` as the stable machine reason code, but update user-facing copy to build-zone wording.
  - Enforce out-of-zone reason priority before bounds checks when multiple legality checks fail.
  - Delay structure contribution activation until authoritative apply succeeds (not at queue acceptance).

patterns-established:
  - 'BUILD-01 Pattern: Footprint legality is checked per cell against union contributors, not template center against team territory.'
  - 'BUILD-02 Pattern: Radius-15 edge is inclusive via squared-distance checks with deterministic contributor ordering.'

requirements-completed: [BUILD-01, BUILD-02]

# Metrics
duration: 73 min
completed: 2026-03-02
---

# Phase 07 Plan 01: Authoritative Union Build Zones Summary

**Placement legality now uses a deterministic radius-15 union zone from owned structures, and queue/preview/runtime feedback are aligned to this authoritative behavior.**

## Performance

- **Duration:** 73 min
- **Started:** 2026-03-02T02:31:00Z
- **Completed:** 2026-03-02T03:44:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `BUILD_ZONE_RADIUS` + distance-shape config in `packages/rts-engine/gameplay-rules.ts` and migrated queue legality to full-footprint union-zone checks in `packages/rts-engine/rts.ts`.
- Updated resolve-time queue validation to use union checks and delayed structure contributor activation until apply success.
- Added BUILD-01/BUILD-02 unit coverage in `packages/rts-engine/rts.test.ts` for inclusive edge semantics and zone expansion/shrink after apply/destruction.
- Updated runtime messaging path in `apps/server/src/server.ts` + `apps/web/src/client.ts` (build-zone wording, deduped invalid-toast cooldown).
- Updated integration placement helpers in `tests/integration/server/server.test.ts` and `tests/integration/server/quality-gate-loop.test.ts` to generate full-footprint in-zone candidates under radius-15 rules.

## Files Created/Modified

- `packages/rts-engine/gameplay-rules.ts` - Added fixed build-zone constants.
- `packages/rts-engine/rts.ts` - Replaced territory-center legality with union-zone full-footprint checks and apply-time contributor activation.
- `packages/rts-engine/rts.test.ts` - Added BUILD-01/BUILD-02 deterministic unit tests.
- `apps/server/src/server.ts` - Added build-zone rejection message mapping compatibility.
- `apps/web/src/client.ts` - Updated rejection copy and short cooldown dedupe for repeated invalid build toasts.
- `tests/integration/server/server.test.ts` - Updated placement helper + out-of-zone expectation semantics.
- `tests/integration/server/quality-gate-loop.test.ts` - Updated placement helper and stabilized breach queue timing.

## Verification

- `npx vitest run packages/rts-engine/rts.test.ts packages/rts-engine/spawn.test.ts`
- `npx vitest run tests/integration/server/server.test.ts tests/integration/server/match-lifecycle.test.ts tests/integration/server/quality-gate-loop.test.ts`
- `npm run test:quality`

All verification commands passed.

## Deviations from Plan

- Added client-side toast dedupe in `apps/web/src/client.ts` to satisfy rejection-spam cooldown behavior without suppressing authoritative server `room:error` events.

## Next Phase Readiness

- BUILD-01 and BUILD-02 are implemented and covered by unit/integration suites.
- Ready to plan Phase 8 (`Transform Placement Consistency`) on top of union-zone legality.

---

_Phase: 07-authoritative-union-build-zones_
_Completed: 2026-03-02_

## Self-Check: PASSED

- Found authoritative union-zone checks in `packages/rts-engine/rts.ts` for both queue submit and resolve-time validation.
- Found BUILD-01/BUILD-02 tests in `packages/rts-engine/rts.test.ts`.
- Found full quality suite pass (`npm run test:quality`).
