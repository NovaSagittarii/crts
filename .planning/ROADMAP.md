# Roadmap: Conway RTS TypeScript Prototype

## Milestones

- ✅ **v0.0.1 Prototype Baseline** — shipped 2026-03-01 (Phases 1-5). Archive: `.planning/milestones/v0.0.1-ROADMAP.md`
- ✅ **v0.0.2 Gameplay Expansion** — shipped 2026-03-03 (Phases 6-12). Archive: `.planning/milestones/v0.0.2-ROADMAP.md`
- ✅ **v0.0.3 Deterministic Lockstep Protocol** — shipped 2026-03-30 (Phases 13-17). Archive: `.planning/milestones/v0.0.3-ROADMAP.md`
- 🚧 **v0.0.4 RL Bot Harness & Balance Analysis** — Phases 18-23 (in progress)

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3, ...): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

<details>
<summary>✅ v0.0.1 Prototype Baseline (Phases 1-5) — SHIPPED 2026-03-01</summary>

See archive: `.planning/milestones/v0.0.1-ROADMAP.md`

</details>

<details>
<summary>✅ v0.0.2 Gameplay Expansion (Phases 6-12) — SHIPPED 2026-03-03</summary>

See archive: `.planning/milestones/v0.0.2-ROADMAP.md`

</details>

<details>
<summary>✅ v0.0.3 Deterministic Lockstep Protocol (Phases 13-17) — SHIPPED 2026-03-30</summary>

See archive: `.planning/milestones/v0.0.3-ROADMAP.md`

</details>

### 🚧 v0.0.4 RL Bot Harness & Balance Analysis (In Progress)

**Milestone Goal:** Build a headless bot harness against the RtsEngine API with PPO-based RL training, use self-play for balance analysis, and rate individual structures/combos via a Glicko-like strength system.

- [x] **Phase 18: Headless Match Runner** - Bot agents execute full matches via RtsRoom without Socket.IO, with match results persisted for analysis (completed 2026-04-01)
- [x] **Phase 19: Observation, Action, and Reward Interface** - Bot environment exposes structured observations, masked actions, and shaped rewards in a Gymnasium-style API (completed 2026-04-01)
- [ ] **Phase 20: PPO Training with Self-Play** - Training pipeline produces improving policies via PPO with self-play opponent pool across parallel workers
- [ ] **Phase 21: Balance Analysis** - Win rates and strategy distributions are computable from accumulated match data
- [ ] **Phase 22: Structure Strength Ratings** - Individual structure templates have Glicko-2 ratings with a CLI balance report
- [ ] **Phase 23: Playable In-Game Bot** - A trained bot joins a live game server as a virtual player via Socket.IO

## Phase Details

### Phase 18: Headless Match Runner
**Goal**: Bot agents can execute full matches against the RtsRoom API without Socket.IO, with match results logged for downstream analysis
**Depends on**: Nothing (first phase of v0.0.4; builds on shipped v0.0.3 RtsRoom API)
**Requirements**: HARN-01, BAL-01
**Success Criteria** (what must be TRUE):
  1. Two bot agents can play a complete match (lobby -> active -> finished) using only the RtsRoom API with no Socket.IO dependency
  2. Match outcomes, build orders, and per-tick snapshots are persisted to NDJSON files after each headless match
  3. Headless matches produce identical results given the same PRNG seed (determinism preserved)
  4. Multiple matches can run in a single Node.js process without resource leaks
**Plans:** 3/3 plans complete
Plans:
- [x] 18-01-PLAN.md — Package scaffolding, BotStrategy interface, NoOpBot, RandomBot
- [x] 18-02-PLAN.md — HeadlessMatchRunner tick loop and NDJSON MatchLogger
- [x] 18-03-PLAN.md — CLI entry point and determinism integration tests

### Phase 19: Observation, Action, and Reward Interface
**Goal**: The bot environment wraps RtsRoom in a Gymnasium-style API with structured observations, masked actions, and configurable reward shaping
**Depends on**: Phase 18
**Requirements**: HARN-02, HARN-03, HARN-04
**Success Criteria** (what must be TRUE):
  1. ObservationEncoder produces identical tensor-compatible output for identical RoomState and teamId inputs (deterministic encoding)
  2. ActionDecoder maps discrete action indices to valid build/destroy queue calls, and the action mask correctly excludes all placements that RtsRoom would reject
  3. RewardSignal computes terminal win/loss reward plus shaped intermediate rewards (economy, territory, structure health) with a configurable annealing coefficient
  4. BotEnvironment exposes reset()/step() interface that a training loop can consume without knowledge of RtsRoom internals
**Plans:** 3/3 plans complete
Plans:
- [x] 19-01-PLAN.md — ObservationEncoder and RewardSignal with tests
- [x] 19-02-PLAN.md — ActionDecoder with territory enumeration and action masking
- [x] 19-03-PLAN.md — BotEnvironment Gymnasium API and index.ts re-exports

### Phase 20: PPO Training with Self-Play
**Goal**: A PPO training pipeline produces policies that demonstrably improve over random play, using self-play with a historical opponent pool across parallel worker threads
**Depends on**: Phase 19
**Requirements**: TRAIN-01, TRAIN-02, TRAIN-03, TRAIN-04
**Success Criteria** (what must be TRUE):
  1. PPO training loop runs policy gradient updates using TF.js and produces checkpoint files loadable for inference
  2. Self-play opponent pool maintains historical checkpoints and samples opponents with configurable latest/historical/random ratios to prevent mode collapse
  3. Training CLI launches configurable runs from the command line (episodes, learning rate, opponent pool size, worker count)
  4. Match simulations parallelize across worker threads, utilizing multiple CPU cores during episode collection
  5. A policy trained for N episodes achieves a measurably higher win rate against random play than an untrained policy
**Plans:** 3/5 plans executed
Plans:
- [x] 20-01-PLAN.md — TF.js installation, training config types, PPO network builder
- [x] 20-02-PLAN.md — Trajectory buffer with GAE and PPO trainer with clipped surrogate loss
- [x] 20-03-PLAN.md — Self-play opponent pool and structured training logger
- [ ] 20-04-PLAN.md — Training worker threads and training coordinator
- [ ] 20-05-PLAN.md — Training CLI entry point and pipeline verification

### Phase 21: Balance Analysis
**Goal**: Win rates and strategy distributions are computable from accumulated match data, revealing per-template and per-strategy balance insights
**Depends on**: Phase 18 (needs match database from BAL-01); can begin alongside Phase 20 using early match data
**Requirements**: BAL-02, BAL-03
**Success Criteria** (what must be TRUE):
  1. Per-template and per-strategy win rates are computed from the match database with 95% confidence intervals
  2. Strategy distribution classifier identifies build-order archetypes and tracks their frequency across training generations
  3. Analysis runs against any NDJSON match log directory and produces structured output (not coupled to a live training run)
**Plans**: TBD

### Phase 22: Structure Strength Ratings
**Goal**: Individual structure templates and template combinations have quantified strength ratings derived from match outcomes, with a CLI report summarizing the competitive meta
**Depends on**: Phase 21 (needs match data volume and analysis infrastructure)
**Requirements**: BAL-04, BAL-05
**Success Criteria** (what must be TRUE):
  1. Glicko-2 rating engine assigns ratings with RD/confidence intervals to each structure template based on match outcomes
  2. Templates with insufficient data (RD > 150) are flagged rather than reported as definitive ratings
  3. Balance report CLI generates summary reports covering win rates, ratings, strategy meta, and identifies balance outliers from match data
**Plans**: TBD

### Phase 23: Playable In-Game Bot
**Goal**: A trained model can join a live game server as a virtual player, making decisions within the tick budget
**Depends on**: Phase 20 (needs trained model), Phase 18 (needs harness infrastructure)
**Requirements**: DEPLOY-01
**Success Criteria** (what must be TRUE):
  1. Socket.IO bot adapter connects a trained model to a live game server as a virtual player that appears identical to a human player from the opponent's perspective
  2. Bot completes a full match lifecycle (join lobby, play active match, handle match finish) without server errors
  3. Bot decision pipeline (observe + infer + act) completes within the per-tick budget, leaving headroom for game simulation
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 18 -> 19 -> 20 -> 21 -> 22 -> 23
Note: Phase 21 can begin alongside Phase 20 using early match data.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-5 (archived) | v0.0.1 | -- | Complete | 2026-03-01 |
| 6-12 (archived) | v0.0.2 | -- | Complete | 2026-03-03 |
| 13-17 (archived) | v0.0.3 | -- | Complete | 2026-03-30 |
| 18. Headless Match Runner | v0.0.4 | 3/3 | Complete    | 2026-04-01 |
| 19. Observation, Action, and Reward Interface | v0.0.4 | 3/3 | Complete    | 2026-04-01 |
| 20. PPO Training with Self-Play | v0.0.4 | 3/5 | In Progress|  |
| 21. Balance Analysis | v0.0.4 | 0/? | Not started | - |
| 22. Structure Strength Ratings | v0.0.4 | 0/? | Not started | - |
| 23. Playable In-Game Bot | v0.0.4 | 0/? | Not started | - |
