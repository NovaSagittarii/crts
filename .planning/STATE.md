---
gsd_state_version: 1.0
milestone: v0.0.4
milestone_name: RL Bot Harness & Balance Analysis
status: executing
stopped_at: Completed 25-01-PLAN.md
last_updated: "2026-04-02T09:28:57.402Z"
last_activity: 2026-04-02
progress:
  total_phases: 8
  completed_phases: 7
  total_plans: 26
  completed_plans: 24
  percent: 0
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-03-30)

**Core value:** Two players can quickly get into a match and use Conway-based strategy to defend their safe cell and breach the opponent's.
**Current focus:** Phase 25 — training-tui-dashboard

## Current Position

Phase: 25 (training-tui-dashboard) — EXECUTING
Plan: 2 of 3
Status: Ready to execute
Last activity: 2026-04-02

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
- [Phase 21]: Positional matching for build outcome correlation: build outcomes from RtsRoom arrive in same order as queued bot actions per team
- [Phase 21]: Seeded LCG PRNG (multiplier 1664525, increment 1013904223) for deterministic bootstrap CI tests
- [Phase 21]: NDJSON readline streaming for match log parsing to handle large files efficiently
- [Phase 21]: Presence-based counts each (match, team) pair where template appears as 1 observation
- [Phase 21]: Usage-weighted weights by build count per (match, team) pair
- [Phase 21]: First-build applies presence logic on subset of first N builds per team per match
- [Phase 21]: classifyStrategy accepts buildCounts Record and totalTicks separately, keeping StrategyFeatureVector purely numeric for clustering
- [Phase 21]: Conway-appropriate strategy labels (early-builder, diverse-placer, template-heavy, economy-saver, balanced) per D-08 -- no rush/turtle/macro
- [Phase 21]: PrefixSpan projected-database approach for sequence mining with per-sequence deduplication for support counting
- [Phase 21]: Multi-run k-means (10 runs default) with lowest-WCSS selection for stable clustering without external libraries
- [Phase 21]: Generation boundary discovery reads checkpoint-<N> directory names directly (no training module coupling)
- [Phase 21]: CLI uses stderr for status messages and stdout for report output, enabling piping
- [Phase 22-structure-strength-ratings]: Glicko-2 Step 5 uses Illinois algorithm with 100-iteration cap and 1e-6 tolerance
- [Phase 22-structure-strength-ratings]: Game-phase tick boundaries: early=0-200, mid=200-600, late=600+Infinity per economy curve
- [Phase 22-structure-strength-ratings]: Combination encounter weight uses min(member counts) to penalize imbalanced combos
- [Phase 22-structure-strength-ratings]: Batch update snapshots all entity ratings before update loop to prevent cross-entity contamination
- [Phase 22-structure-strength-ratings]: Direct enumeration for frequent-set mining (5-template vocabulary yields 31 subsets max)
- [Phase 22-structure-strength-ratings]: Usage-matrix outlier detection uses median of non-provisional entities for threshold boundaries
- [Phase 22]: Worker threads spawn one worker per pool (no intra-pool D-05b) -- overhead not justified for 5-9 pools
- [Phase 22]: CLI subcommand routing uses strict:false with allowPositionals for backward compatibility with existing no-subcommand usage
- [Phase 23]: PayloadObservationEncoder computes territoryRadius as DEFAULT_TEAM_TERRITORY_RADIUS + sum of non-core buildRadius, matching RtsRoom formula without RtsRoom dependency
- [Phase 23]: TickBudgetTracker uses manual startTick/endTick bracketing for caller-controlled timing
- [Phase 23]: Bot session IDs tracked in module-level Set in server.ts, passed to RoomBroadcastService for isBot population
- [Phase 23]: canAddBot prevents duplicate bots per slot; bot session IDs use bot- prefix with truncated UUID
- [Phase 23]: LiveBotStrategy transposes [C,H,W] to [H,W,C] per Phase 20 PPO network input convention
- [Phase 23]: Simplified action mask checks resources >= 5 (min template cost) rather than full per-action validation; server validates all builds
- [Phase 23]: teamId tracked as number|null with explicit null guard in state handler per socket contract nullability
- [Phase 24]: Promise-based caching (_promise variable) for getTf() to prevent duplicate imports during concurrent calls
- [Phase 24]: 15s test timeout for first getTf() invocation to accommodate @tensorflow/tfjs-node failure latency on Alpine musl
- [Phase 24]: @tensorflow/tfjs-node@4.22.0 pinned as optionalDependency; @tensorflow/tfjs remains at ^4.23.0-rc.0 in dependencies
- [Phase 24]: Module-level _tf with initTfBackend() export pattern for lazy TF.js initialization across all bot-harness modules
- [Phase 24]: Barrel re-exports use aliased names (initPpoNetworkTf, initPpoTrainerTf) to avoid initTfBackend collisions
- [Phase 25]: Ink 6 + React 19 for TUI rendering framework
- [Phase 25]: onProgress callback pattern (not EventEmitter) for coordinator-to-TUI data flow
- [Phase 25]: Pause via 100ms polling loop in async training loop to avoid event loop blocking

### Pending Todos

- Optionally run `/gsd-audit-milestone` retroactively for `v0.0.2` to close audit debt.

### Roadmap Evolution

- Phase 24 added: TF.js Native Backend with Dynamic Fallback — dynamic import tfjs-node with pure JS fallback
- Phase 25 added: Training TUI Dashboard — live terminal dashboard for training metrics, generation timing, ETA

### Blockers/Concerns

(None for new milestone)

## Session Continuity

**Last session:** 2026-04-02T09:28:57.279Z
**Stopped At:** Completed 25-01-PLAN.md
**Resume File:** None
