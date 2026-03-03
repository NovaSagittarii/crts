---
phase: 14-canonical-gridview-api-adoption
plan: 02
subsystem: rts-engine
tags: [template-grid, canonical-geometry, migration-guardrails, parity]

# Dependency graph
requires:
  - phase: 14-canonical-gridview-api-adoption
    provides: immutable GridView transform API and placement-safe matrix validation
provides:
  - Canonical runtime `template.grid()` entrypoint with fresh equivalent GridView instances
  - RTS geometry acquisition migration to `template.grid().applyTransform(...)`
  - Fail-fast legacy projection entrypoints with actionable migration messages
affects:
  [
    packages/rts-engine/rts.ts,
    packages/rts-engine/rts.test.ts,
    packages/rts-engine/placement-transform.ts,
    phase-15-read-path-and-cross-codebase-gridview-unification,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Normalize templates once and expose a canonical `grid()` factory that always returns fresh immutable views
    - Route projection/preview/integrity reads through one GridView transform helper before world wrapping

key-files:
  created:
    - .planning/phases/14-canonical-gridview-api-adoption/14-02-SUMMARY.md
  modified:
    - packages/rts-engine/rts.ts
    - packages/rts-engine/rts.test.ts
    - packages/rts-engine/placement-transform.ts
    - packages/rts-engine/placement-transform.test.ts

key-decisions:
  - 'Keep runtime compatibility for cloned/migrated template objects by re-normalizing templates if `grid()` is missing at call time.'
  - 'Retire `projectTemplateWithTransform` and `projectPlacementToWorld` as direct APIs and replace them with fail-fast migration guidance to canonical GridView usage.'

patterns-established:
  - 'Pattern 1: Build transformed template bytes from canonical GridView ordering so non-binary source byte parity is preserved.'
  - 'Pattern 2: Derive area/footprint/check world projections from canonical transformed GridView output, then wrap/sort deterministically.'

requirements-completed: [REF-01, REF-02]

# Metrics
duration: 39 min
completed: 2026-03-03
---

# Phase 14 Plan 02: Canonical `template.grid()` Migration Summary

**RTS template geometry paths now start from canonical `template.grid()` views, while legacy projection entrypoints fail fast with explicit migration guidance.**

## Performance

- **Duration:** 39 min
- **Started:** 2026-03-03T04:36:00Z
- **Completed:** 2026-03-03T05:15:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added runtime template normalization in `rts.ts` so every template instance exposes `grid()` and repeated calls return fresh equivalent GridView views.
- Migrated structure projection, build-zone contributor projection, preview/queue projection, and integrity mask reads to canonical GridView transform helpers.
- Retired `projectTemplateWithTransform` and `projectPlacementToWorld` from canonical usage; both now fail fast with actionable migration errors.
- Added regression coverage for canonical `grid()` freshness plus preview/queue parity on transformed payloads.

## task Commits

Each task was executed in one local working session (no per-task commits created in this run).

1. **task 1: Normalize templates with canonical grid() entrypoint** - pending commit
2. **task 2: Cut over engine geometry acquisition to template.grid transforms** - pending commit
3. **task 3: Retire legacy projection entrypoints with fail-fast migration errors** - pending commit

**Plan metadata:** pending

## Files Created/Modified

- `packages/rts-engine/rts.ts` - Adds template normalization, canonical GridView transform helper flow, and world projection helpers.
- `packages/rts-engine/rts.test.ts` - Adds canonical `grid()` freshness checks and transform preview/queue parity coverage.
- `packages/rts-engine/placement-transform.ts` - Keeps normalization APIs while converting legacy projection APIs to explicit fail-fast migration gates.
- `packages/rts-engine/placement-transform.test.ts` - Validates canonical normalization parity and legacy fail-fast behavior.

## Decisions Made

- Kept old transformed byte semantics by rebuilding transformed `cells` from canonical GridView coordinate ordering and original source bytes.
- Added `ensureTemplateGrid` fallback so cloned/dehydrated templates without a method are normalized on demand before transform usage.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `structuredClone(room)` compatibility after adding template `grid()` methods**

- **Found during:** task 2 (Cut over engine geometry acquisition to template.grid transforms)
- **Issue:** cloned template objects can lose callable `grid()` methods, which would block canonical projection helpers at runtime.
- **Fix:** added `ensureTemplateGrid` fallback normalization before transform usage and updated probe tests to use non-mutating preview probes.
- **Files modified:** `packages/rts-engine/rts.ts`, `packages/rts-engine/rts.test.ts`
- **Verification:** `npx vitest run packages/rts-engine/rts.test.ts -t "fresh grid\(\)|queue parity for canonical transformed placements"`
- **Committed in:** pending

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix preserved canonical API migration goals while avoiding runtime template-shape brittleness.

## Issues Encountered

- `npm run test:unit` continues to fail on pre-existing assertions in `packages/rts-engine/rts.test.ts` and `packages/rts-engine/build-zone.test.ts`; canonical GridView migration tests pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 15 can now migrate remaining read-path and cross-codebase geometry consumers onto the canonical GridView utilities.
- Legacy projection entrypoints are blocked with explicit guidance, reducing accidental fallback risk during subsequent migration phases.

---

_Phase: 14-canonical-gridview-api-adoption_
_Completed: 2026-03-03_
