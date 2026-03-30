---
phase: 13-client-simulation-foundation
plan: 01
subsystem: engine
tags: [rts-engine, determinism, payload-reconstruction, lockstep]

# Dependency graph
requires: []
provides:
  - 'RtsRoom.fromPayload() static factory for reconstructing tickable rooms from wire payloads'
  - 'reservedCost field on PendingBuildPayload for hash-faithful build event reconstruction'
affects:
  [13-02, 14-lockstep-transport, 15-desync-detection, 16-reconnect-replay]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'Payload-to-room reconstruction with canonical Map insertion order'
    - 'Core template auto-injection into templateMap for fromPayload'

key-files:
  created: []
  modified:
    - packages/rts-engine/rts.ts
    - packages/rts-engine/rts.test.ts

key-decisions:
  - 'Added reservedCost as optional field on PendingBuildPayload to preserve hash fidelity without breaking existing consumers'
  - 'Core template auto-included in templateMap when not present in provided templates array'
  - 'Method added to both RtsEngine (static) and RtsRoom (delegation) following existing delegation pattern'

patterns-established:
  - 'fromPayload reconstruction pattern: Grid.fromPacked -> sorted teams -> sorted structures -> rebuild pending events -> set nextBuildEventId'

requirements-completed: [SIM-01]

# Metrics
duration: 40min
completed: 2026-03-29
---

# Phase 13 Plan 01: RtsRoom.fromPayload Summary

**RtsRoom.fromPayload() factory for reconstructing fully tickable rooms from RoomStatePayload with bit-identical determinism hashes**

## Performance

- **Duration:** 40 min
- **Started:** 2026-03-29T17:04:19Z
- **Completed:** 2026-03-29T17:44:00Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments

- Implemented `RtsRoom.fromPayload(payload, templates)` static factory that reconstructs a fully tickable `RtsRoom` from a `RoomStatePayload` and template list
- Grid reconstructed via `Grid.fromPacked`; teams sorted by id and structures sorted by key ensure canonical Map insertion order for deterministic hashing
- 8 unit tests proving hash equivalence across: zero-tick, multi-tick, pending build events, pending destroy events, multi-team rooms, damaged structure HP, defeated teams, and tick/generation preservation
- Added `reservedCost` (optional) to `PendingBuildPayload` to preserve build event cost fidelity across serialization boundaries

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add failing tests for RtsRoom.fromPayload** - `e90bed1` (test)
2. **Task 1 (GREEN): Implement RtsRoom.fromPayload() factory** - `a2747a4` (feat)

_TDD task: test commit followed by implementation commit._

## Files Created/Modified

- `packages/rts-engine/rts.ts` - Added `RtsEngine.fromPayload()` static method (120+ lines) and `RtsRoom.fromPayload()` delegation; added `reservedCost` to `PendingBuildPayload`; added `reservedCost` to `projectPendingBuilds` output
- `packages/rts-engine/rts.test.ts` - Added `describe('RtsRoom.fromPayload')` block with 8 test cases; updated existing QUAL-04 test to use `objectContaining` for the new `reservedCost` field

## Decisions Made

- **reservedCost as optional field:** `PendingBuildPayload.reservedCost` was made optional to avoid breaking existing consumers (web UI code, web tests) that construct payloads without it. The `fromPayload` method defaults to 0 when not present. This preserves backward compatibility while enabling hash-faithful reconstruction.
- **Core template auto-injection:** The core template (`__core__`) is not part of `createDefaultStructureTemplates()`, so `fromPayload` auto-adds it to the templateMap when missing. Without this, core structures would be silently skipped during reconstruction, causing hash divergence.
- **Delegation pattern:** `RtsRoom.fromPayload()` delegates to `RtsEngine.fromPayload()` following the existing `RtsRoom.create -> RtsEngine.createRoom` delegation pattern. This keeps `hashSpawnSeed` (private) accessible within the same module scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Core template missing from templateMap**

- **Found during:** Task 1 (GREEN phase - hash mismatch debugging)
- **Issue:** The plan's `templateMap` construction only used the provided `templates` array, but `__core__` (used for core structures) is not included in `createDefaultStructureTemplates()`. Reconstructed rooms had zero structures and completely different hashes.
- **Fix:** Added auto-injection of `RtsEngine.CORE_STRUCTURE_TEMPLATE` into `templateMap` when not already present.
- **Files modified:** `packages/rts-engine/rts.ts`
- **Verification:** All 8 fromPayload tests pass with matching hashes.
- **Committed in:** a2747a4

**2. [Rule 2 - Missing Critical] reservedCost not carried in PendingBuildPayload**

- **Found during:** Task 1 (GREEN phase - hash mismatch on pending build events test)
- **Issue:** The plan used `templateMap.get(pb.templateId)?.activationCost` for `reservedCost`, but the actual value includes grid diff cells (`diffCells + activationCost`). The hash includes `reservedCost`, so the wrong value caused determinism hash divergence.
- **Fix:** Added `reservedCost` (optional) to `PendingBuildPayload` interface; updated `projectPendingBuilds` to include it from the source `BuildEvent`; updated `fromPayload` to read `pb.reservedCost ?? 0`.
- **Files modified:** `packages/rts-engine/rts.ts`, `packages/rts-engine/rts.test.ts`
- **Verification:** Pending build event test passes with exact hash match.
- **Committed in:** a2747a4

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both auto-fixes were essential for correct hash equivalence. No scope creep.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all data paths are fully wired.

## Next Phase Readiness

- `RtsRoom.fromPayload()` is ready for use by Phase 13 Plan 02 (client-side simulation controller)
- The method can be called from the browser client to initialize a local simulation from a server-provided state snapshot
- `reservedCost` on `PendingBuildPayload` ensures future lockstep hash verification will work correctly
- Future reconnect replay (Phase 16) can also use this factory for state reconstruction

---

_Phase: 13-client-simulation-foundation_
_Completed: 2026-03-29_
