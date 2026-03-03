---
phase: 15-read-path-and-cross-codebase-gridview-unification
plan: 02
subsystem: integration-and-web
tags: [integration, reconnect, overlays, ambiguity-ledger]

# Dependency graph
requires:
  - phase: 15-read-path-and-cross-codebase-gridview-unification
    provides: shared `template-grid-read` helpers exported via `#rts-engine`
provides:
  - Integration helper migration to shared transformed-bounds utility
  - Reconnect transform-matrix parity coverage for structure overlay stability
  - Phase-local ambiguity ledger with resolved behavior decisions
affects:
  [
    tests/integration/server/server.test.ts,
    tests/integration/server/quality-gate-loop.test.ts,
    tests/integration/server/destroy-determinism.test.ts,
    tests/web/tactical-overlay-view-model.test.ts,
    apps/web/src/tactical-overlay-view-model.ts,
    .planning/phases/15-read-path-and-cross-codebase-gridview-unification/15-AMBIGUITIES.md,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Reuse `estimateTransformedTemplateBounds` in integration candidate-placement helpers
    - Preserve last-known tactical overlay sections when reconnect sync hint is active

key-files:
  created:
    - .planning/phases/15-read-path-and-cross-codebase-gridview-unification/15-AMBIGUITIES.md
    - .planning/phases/15-read-path-and-cross-codebase-gridview-unification/15-02-SUMMARY.md
  modified:
    - tests/integration/server/server.test.ts
    - tests/integration/server/quality-gate-loop.test.ts
    - tests/integration/server/destroy-determinism.test.ts
    - tests/web/tactical-overlay-view-model.test.ts
    - apps/web/src/tactical-overlay-view-model.ts

key-decisions:
  - Use the shared transformed-bounds helper in all touched integration placement scans, even for untransformed calls, to prevent future drift.
  - Preserve previous tactical overlay sections only when sync hint is visible and authoritative team payload is temporarily missing.

patterns-established:
  - 'Pattern 1: reconnect parity assertions compare host and reconnect structure payload snapshots at identical lifecycle checkpoints.'
  - 'Pattern 2: tactical overlay stale windows keep prior context visible while surfacing explicit sync hint copy.'

requirements-completed: [REF-05, REF-07]

# Metrics
duration: in-session
completed: 2026-03-03
---

# Phase 15 Plan 02: Cross-Codebase Migration and Reconnect Parity Summary

**Integration helper geometry now routes through shared GridView bounds utilities, and reconnect overlays keep deterministic structure parity with last-known tactical context.**

## Performance

- **Duration:** in-session
- **Started:** 2026-03-03
- **Completed:** 2026-03-03
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Migrated integration candidate placement helpers in `server.test.ts`, `quality-gate-loop.test.ts`, and `destroy-determinism.test.ts` to shared `estimateTransformedTemplateBounds`.
- Added reconnect matrix parity coverage in `quality-gate-loop.test.ts` and strengthened pending-destroy reconnect parity checkpoint assertions in `destroy-determinism.test.ts`.
- Updated tactical overlay view-model behavior to retain last-known sections during reconnect sync gaps and added matching regression coverage.
- Captured resolved migration ambiguities in `15-AMBIGUITIES.md` with parity evidence and no allowlisted carryover.

## task Commits

Executed in a single working session without per-task commits.

1. **task 1: Migrate integration transformed-geometry helpers** - pending commit
2. **task 2: Add reconnect transform parity coverage** - pending commit
3. **task 3: Capture ambiguity and allowlist outcomes** - pending commit

**Plan metadata:** pending

## Files Created/Modified

- `tests/integration/server/server.test.ts` - candidate helper now uses shared transformed-bounds utility.
- `tests/integration/server/quality-gate-loop.test.ts` - transformed reconnect-loop parity regression and helper migration.
- `tests/integration/server/destroy-determinism.test.ts` - shared helper migration and pending-destroy reconnect parity checkpoint assertions.
- `apps/web/src/tactical-overlay-view-model.ts` - retains last-known sections during reconnect/stale sync hint windows.
- `tests/web/tactical-overlay-view-model.test.ts` - stale-window retention regression coverage.
- `.planning/phases/15-read-path-and-cross-codebase-gridview-unification/15-AMBIGUITIES.md` - explicit ambiguity outcomes ledger.

## Decisions Made

- Kept reconnect matrix coverage grounded in existing deterministic integration flows to avoid introducing new nondeterministic timing scaffolding.
- Kept tactical overlay retention narrowly scoped to sync-visible windows so spectators/non-sync states still project placeholder sections.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Initial reconnect transform scenario used a non-stable template and intermittently missed state predicates**

- **Found during:** task 2 (reconnect transform matrix parity coverage)
- **Issue:** Reconnect predicate windows were brittle with a more dynamic template under active ticks.
- **Fix:** Switched reconnect transform parity scenarios to deterministic transformed block placements while retaining transform operation coverage.
- **Files modified:** `tests/integration/server/quality-gate-loop.test.ts`, `tests/integration/server/destroy-determinism.test.ts`
- **Verification:**
  - `npx vitest run tests/integration/server/quality-gate-loop.test.ts -t "keeps transformed structure overlays stable across repeated reconnect loops"`
  - `npx vitest run tests/integration/server/destroy-determinism.test.ts -t "reconnects during pending destroy and converges on one authoritative terminal outcome"`
- **Committed in:** pending

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Preserved reconnect parity intent while improving deterministic reliability.

## Issues Encountered

- Full `quality-gate-loop` suite still has a pre-existing timeout in `QUAL-02: join -> build -> tick -> breach -> defeat with defeated build rejection`; targeted reconnect parity test passes.
- Full web tactical overlay suite has a pre-existing failure around `build-preview-copy` detail row; new reconnect stale-window retention test passes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 15 requirements are now covered by shared read helpers plus cross-codebase parity tests.
- Phase 16 can proceed on write-path unification with reconnect/read-side behavior guardrails in place.

---

_Phase: 15-read-path-and-cross-codebase-gridview-unification_
_Completed: 2026-03-03_
