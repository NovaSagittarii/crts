---
gsd_state_version: 1.0
milestone: v0.0.4
milestone_name: RL Bot Harness & Balance Analysis
status: verifying
stopped_at: Completed 20-05-PLAN.md
last_updated: "2026-04-01T14:34:23.223Z"
last_activity: 2026-04-01
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 11
  completed_plans: 11
  percent: 0
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-03-30)

**Core value:** Two players can quickly get into a match and use Conway-based strategy to defend their safe cell and breach the opponent's.
**Current focus:** Phase 20 — ppo-training-with-self-play

## Current Position

Phase: 20 (ppo-training-with-self-play) — EXECUTING
Plan: 5 of 5
Status: Phase complete — ready for verification
Last activity: 2026-04-01

Progress: [░░░░░░░░░░] 0% (v0.0.4)

## Performance Metrics

**Velocity:**

- Completed phases: 17 (across v0.0.1-v0.0.3)
- Completed plans: 40
- Completed tasks: 91
- Shipped milestones: 3 (`v0.0.1`, `v0.0.2`, `v0.0.3`)

## Accumulated Context

### Decisions

- Keep continuous phase numbering across milestones.
- Keep deterministic game logic in shared `packages/*` and runtime/socket boundaries in `apps/*`.
- Front-load backend rule changes + deterministic tests before UI-heavy integration work.
- Keep server-authoritative state as the only gameplay source of truth for clients.
- Archive milestone roadmap/requirements artifacts to keep active planning files small.
- Migrate to lockstep: server validates inputs, clients run simulation locally, periodic hash verification for desync detection.
- v0.0.4: TypeScript-native training via `@tensorflow/tfjs` (pure JS CPU backend) as default; decision gate in Phase 20 if throughput exceeds 8 hours.
- [Phase 18-headless-match-runner]: BotView exposes full Grid + own-team-only TeamStateView (per D-02 fog-of-war constraint)
- [Phase 18-headless-match-runner]: RandomBot uses Math.floor(buildRadius) for integer coordinate generation in build-zone scanning
- [Phase 18]: BuildOutcome from RtsRoom lacks templateId/x/y/transform; TickActionRecord maps from outcome status fields only for builds
- [Phase 18]: Hash checkpoint fires at tick 0 to establish baseline determinism anchor
- [Phase 18]: Used node:util parseArgs for zero-dependency CLI argument parsing
- [Phase 18]: Added bin/ to tsconfig.json include and eslint node globals for full type-checking coverage of CLI files
- [Phase 19]: Full grid (width * height) as action space position upper bound -- mask narrows valid set, action space size fixed per episode
- [Phase 19]: Templates sorted alphabetically by id for deterministic action-to-template index mapping
- [Phase 19]: ObservationEncoder uses createStatePayload() for both own and enemy data; territoryRadius read directly from RoomState.teams
- [Phase 19]: computeReward is a pure function with no internal state; episodeNumber for annealing passed in externally
- [Phase 19]: Static actionSpace computed eagerly from grid dimensions for Phase 20 PPO network builders
- [Phase 19]: BotEnvironment is single entry point for Phase 20: reset(seed, opponent) -> step(action) -> (observation, reward, terminated, truncated, info)
- [Phase 20]: Used @tensorflow/tfjs pure JS backend instead of tfjs-node -- native addon fails on Alpine Linux musl libc
- [Phase 20]: PPO network accepts channels-last [H,W,C] input; callers transpose from ObservationEncoder channels-first [C,H,W]
- [Phase 20]: Weight transfer uses cloned ArrayBuffer per tensor for safe cross-thread postMessage
- [Phase 20]: Custom TF.js file IO (saveModelToDir/loadWeightsFromDir) instead of file:// handler -- pure JS backend lacks it
- [Phase 20]: loadWeightsFromDir reads raw weight data without creating TF.js model -- avoids variable name collisions
- [Phase 20]: Weight save uses Float32Array clone to standalone ArrayBuffer for SharedArrayBuffer type safety
- [Phase 20]: Float32 precision tolerance: GAE tests use toBeCloseTo(x, 3) due to Float32Array accumulated rounding
- [Phase 20]: Advantages normalized across full buffer before mini-batching, not per-batch
- [Phase 20]: Worker shim using tsx tsImport() for Node 24 worker_threads TS loading (tsx --import flag broken for .js->.ts resolution)
- [Phase 20]: Queue-based sequential episode dispatch per worker to avoid message listener race conditions
- [Phase 20]: Minimum grid size 15x15 for BotEnvironment: RtsRoom spawn footprint requires at least this size
- [Phase 20]: Renamed generateRunId to generateTrainingRunId to avoid barrel export name collision with match-logger
- [Phase 20]: Convergence test validates gradient flow (weights change, losses finite) rather than absolute win rate -- pure JS TF.js too slow for CI-feasible 55% threshold
- [Phase 20]: TF.js D-12 gate passed: pure JS CPU backend runs PPO training on Alpine Linux musl, producing checkpoints and training logs

### Pending Todos

- Optionally run `/gsd-audit-milestone` retroactively for `v0.0.2` to close audit debt.

### Blockers/Concerns

(None for new milestone)

## Session Continuity

**Last session:** 2026-04-01T14:34:23.113Z
**Stopped At:** Completed 20-05-PLAN.md
**Resume File:** None
