---
phase: 19-observation-action-and-reward-interface
plan: 02
subsystem: bot-harness
tags: [action-space, action-masking, rl, ppo, discrete-action, build-zone, territory]

# Dependency graph
requires:
  - phase: 18-headless-match-runner
    provides: bot-harness package, RtsRoom, match-runner, BotStrategy
provides:
  - ActionDecoder class mapping discrete action indices to BuildQueuePayload
  - ActionSpaceInfo descriptor for PPO network builders
  - Territory position enumeration via build-zone contributors
  - Exhaustive action masking via RtsRoom.previewBuildPlacement
affects: [19-03, 20-ppo-training]

# Tech tracking
tech-stack:
  added: []
  patterns: [discrete-action-space, action-masking-via-preview, full-grid-position-space]

key-files:
  created:
    - packages/bot-harness/action-decoder.ts
    - packages/bot-harness/action-decoder.test.ts
  modified:
    - packages/bot-harness/index.ts

key-decisions:
  - "Full grid (width * height) as position space upper bound -- mask narrows valid set each tick, action space size is fixed for episode duration"
  - "Templates sorted alphabetically by id for deterministic action-to-template mapping"
  - "Canonical fallback template list in decode() enables decode without room reference"

patterns-established:
  - "Action space layout: index 0 = no-op, index 1..N = templateIdx * numPositions + posIdx + 1"
  - "Territory enumeration: collectBuildZoneContributors + isBuildZoneCoveredByContributor over full grid"
  - "Mask validity: previewBuildPlacement(playerId, payload) for each territory position per template"

requirements-completed: [HARN-03]

# Metrics
duration: 8min
completed: 2026-04-01
---

# Phase 19 Plan 02: ActionDecoder Summary

**Discrete action decoder mapping integer indices to BuildQueuePayload with territory-bounded enumeration and exhaustive action masking via previewBuildPlacement**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-01T10:13:00Z
- **Completed:** 2026-04-01T10:21:00Z
- **Tasks:** 1 (TDD: RED-GREEN-REFACTOR)
- **Files modified:** 3

## Accomplishments
- ActionDecoder class with decode(), computeActionMask(), enumerateTerritoryPositions(), getBuildableTemplates(), getActionSpaceInfo()
- Action space: 5 templates * (width * height) + 1 = 2001 actions on 20x20 grid (no-op at index 0)
- Mask correctness verified: every valid-masked action succeeds via previewBuildPlacement, every invalid-masked action is genuinely rejected
- 11 comprehensive test cases covering no-op, template filtering/sorting, roundtrip encoding, mask validity, territory enumeration, and determinism

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests for ActionDecoder** - `6821ad2` (test)
2. **Task 1 (GREEN): Implement ActionDecoder** - `fe9ef64` (feat)
3. **Task 1 (REFACTOR): Clean up imports, add package export** - `d715d2d` (refactor)

## Files Created/Modified
- `packages/bot-harness/action-decoder.ts` - ActionDecoder class with Discrete action space, territory enumeration, masking, and decode
- `packages/bot-harness/action-decoder.test.ts` - 11 unit tests for action decoder correctness
- `packages/bot-harness/index.ts` - Added action-decoder.js re-export

## Decisions Made
- Full grid (width * height) used as numPositions upper bound so action space size is fixed for the episode duration; mask handles which positions are actually valid each tick as territory grows
- Templates sorted alphabetically by id for deterministic index mapping: block, eater-1, generator, glider, gosper
- decode() includes a canonical fallback template list for calls without a room reference
- Test timeouts increased to 30s for mask validation tests due to exhaustive previewBuildPlacement calls on 20x20 grid

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Test timeout on mask validation tests: computeActionMask + exhaustive preview checking on 20x20 grid (2001 actions) takes ~4-5 seconds. Resolved by increasing test timeout to 15-30 seconds for affected tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ActionDecoder ready for Plan 19-03 (RewardSignal) to integrate action outcomes
- ActionSpaceInfo descriptor ready for Phase 20 PPO network builder
- Action masking pattern established for RL training loop integration

---
*Phase: 19-observation-action-and-reward-interface*
*Completed: 2026-04-01*
