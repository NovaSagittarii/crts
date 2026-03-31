---
phase: 06-base-geometry-and-integrity-core
verified: 2026-03-02T02:12:00Z
status: passed
score: 6/6 must-haves verified
---

# Phase 6: Base Geometry and Integrity Core Verification Report

**Phase Goal:** Players spawn on canonical 5x5 bases and all player-owned structures resolve integrity damage/repair deterministically.
**Verified:** 2026-03-02T02:12:00Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                               | Status     | Evidence                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | New matches seed canonical 5x5 bases with exactly 16 occupied cells.                                | ✓ VERIFIED | `packages/rts-engine/geometry.ts` defines canonical occupancy; `packages/rts-engine/rts.test.ts` asserts 16 occupied cells and empty center cross in seeded base footprint.                               |
| 2   | Territory and placement center math uses canonical `baseTopLeft + 2` semantics.                     | ✓ VERIFIED | `packages/rts-engine/geometry.ts` exposes `getBaseCenter`; `packages/rts-engine/rts.ts` routes territory validation/counting through this helper.                                                         |
| 3   | Spawn footprint and spacing follow the 5x5 contract with deterministic fallback behavior.           | ✓ VERIFIED | `packages/rts-engine/rts.ts` uses `BASE_FOOTPRINT_WIDTH/HEIGHT` and `SPAWN_MIN_WRAPPED_DISTANCE` with deterministic fallback scan; `packages/rts-engine/spawn.test.ts` verifies 5x5 spacing checks.       |
| 4   | Integrity checks run for all player-owned templates, including templates without explicit `checks`. | ✓ VERIFIED | `packages/rts-engine/rts.ts` derives integrity masks from `checks` or template live cells; `packages/rts-engine/rts.test.ts` includes `[STRUCT-01]` sentinel template test with empty checks.             |
| 5   | Failed integrity checks charge full restore cost and can underflow HP before destruction/defeat.    | ✓ VERIFIED | `packages/rts-engine/rts.ts` applies `restoreCost = mismatches * INTEGRITY_HP_COST_PER_CELL` with no clamp; `packages/rts-engine/rts.test.ts` verifies non-core `hp = -2` and core `hp = initialHp - 16`. |
| 6   | Core defeat remains the only defeat trigger and pending queue entries drain deterministically.      | ✓ VERIFIED | `packages/rts-engine/rts.ts` still marks defeat from core HP <= 0 and drains `team-defeated` rejections; unit/integration assertions cover outcome ordering and queue drain behavior.                     |

## Required Artifacts

| Artifact                                | Expected                                                                        | Status     | Details                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/rts-engine/geometry.ts`       | Canonical 5x5 footprint helpers and center math.                                | ✓ VERIFIED | Exports base dimensions, occupancy predicate, center helper, and canonical base-cell projection helpers.             |
| `packages/rts-engine/gameplay-rules.ts` | Shared deterministic constants for integrity cadence and spawn/base dimensions. | ✓ VERIFIED | Exports shared values consumed by `rts.ts` and tests.                                                                |
| `packages/rts-engine/rts.ts`            | Deterministic template-wide integrity resolver and canonical base wiring.       | ✓ VERIFIED | Includes sorted integrity traversal, full-cost HP accounting, core defeat flow, and canonical territory/spawn logic. |
| `packages/rts-engine/rts.test.ts`       | BASE-01 + STRUCT-01 unit coverage.                                              | ✓ VERIFIED | Adds canonical base shape assertions and template-wide integrity/destroy behavior tests.                             |
| `tests/integration/server/*.test.ts`    | Server contract stability under updated base/integrity rules.                   | ✓ VERIFIED | Placement helper updates and breach flow assertions pass in server, lifecycle, and quality-loop suites.              |

## Commands Run

- `npx vitest run packages/rts-engine/spawn.test.ts packages/rts-engine/rts.test.ts`
- `npx vitest run tests/integration/server/server.test.ts tests/integration/server/match-lifecycle.test.ts tests/integration/server/quality-gate-loop.test.ts`
- `npm run test:quality`

All commands passed.

## Requirements Coverage

| Requirement | Source Plan                      | Status      | Evidence                                                                                                  |
| ----------- | -------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| BASE-01     | `06-01-PLAN.md`, `06-02-PLAN.md` | ✓ SATISFIED | Canonical helper + seeded footprint assertions + integration fixture updates for 5x5 footprint behavior.  |
| STRUCT-01   | `06-02-PLAN.md`                  | ✓ SATISFIED | Template-wide integrity mask logic and full restoration-cost tests in unit and server integration suites. |

## Human Verification Required

None for phase-goal sign-off.

## Gaps Summary

No gaps found.

---

_Verified: 2026-03-02T02:12:00Z_
_Verifier: OpenCode (manual execution)_
