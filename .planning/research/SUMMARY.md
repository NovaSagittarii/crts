# Project Research Summary

**Project:** v0.0.4 RL Bot Harness & Balance Analysis
**Domain:** Reinforcement learning agent training, headless simulation, and competitive balance analysis for a TypeScript multiplayer Conway RTS
**Researched:** 2026-03-30
**Confidence:** MEDIUM-HIGH

## Executive Summary

This milestone adds an RL training pipeline and balance analysis layer on top of an already-solid deterministic multiplayer RTS engine. The core architectural insight is that the existing `RtsRoom` API — deterministic, runtime-agnostic, synchronous — is already a near-perfect headless simulation environment. Almost no engine changes are required; what is needed is a thin harness package (`packages/bot-harness`) that wraps `RtsRoom` in a Gymnasium-style interface, extracts structured observations, maps model outputs to valid game actions, and computes shaped reward signals. The `HeadlessMatchRunner` is the dependency root for everything in this milestone: nothing trains, nothing analyzes, nothing deploys without it.

The single most consequential decision — where PPO training happens — produces a conflict between research files. STACK.md argues for TypeScript-native training via `@tensorflow/tfjs` (pure JS CPU backend), citing Node.js 24 compatibility breakage of `@tensorflow/tfjs-node`, small model scale, and the project's explicit TypeScript-only constraint. ARCHITECTURE.md and FEATURES.md argue for Python (Stable Baselines3) with NDJSON stdio IPC and ONNX export to Node.js for inference. The Python path offers a more mature training ecosystem; the TypeScript path avoids a second language and cross-language debugging. Given the project's explicit TypeScript-only constraint and the small network sizes required (2-3 hidden layers, 64-128 units), the TypeScript-native path is the recommended default — but the team must benchmark training throughput in Phase 3 and define an explicit decision gate: if pure JS CPU training exceeds 8 hours for a target training run, adopt the Python/ONNX path.

The top three risks are (1) bypassing `RtsRoom` validation in the bot harness, which trains a policy that cannot operate in live play and requires full retraining from scratch; (2) feeding raw 52x52 grid cells as observations, which makes learning infeasible per prior Conway RL research; and (3) self-play collapse to a single dominant strategy, which renders all balance analysis meaningless. All three are preventable with known techniques documented in the research.

---

## Key Findings

### Recommended Stack

The base stack (TypeScript, Node.js 24, Socket.IO, Vite, Vitest) is unchanged. For v0.0.4 specifically, only one new production dependency is required; all other new capabilities are custom TypeScript code.

**Core technologies:**
- `@tensorflow/tfjs@4.22.0` (pure JS CPU backend): Neural network training and inference for PPO actor-critic — the only production-grade tensor library that works on Node.js 24 without native compilation. `@tensorflow/tfjs-node` is broken on Node 24 (GitHub issue #8609, no binary releases since October 2024).
- Custom Glicko-2 (~150 LOC TypeScript): Structure template rating system — all available npm packages are either GPL-3.0 (`glicko2.ts`, hard license conflict that would force project to adopt copyleft), JavaScript-only, or unmaintained. The algorithm is compact and fully specified by Glickman's reference paper.
- `RtsRoom.tick()` (existing, no changes): Headless match runner foundation — the engine is already runtime-agnostic and deterministic; the harness is a pure wrapper loop with no new dependencies.
- `worker_threads` (Node.js built-in): Parallel match execution during training — native since Node 12, no library needed, essential for multi-core training throughput and event loop isolation.
- NDJSON files: Match result and rating persistence — zero dependencies, human-readable, append-only, git-trackable, sufficient for <100K matches.

**Optional upgrade paths (add only if benchmarks justify):**
- `@tensorflow/tfjs-backend-wasm@4.22.0`: 2-5x CPU training speedup, drop-in backend swap, no native compilation.
- `onnxruntime-node@1.24.3` (Microsoft, actively maintained, Node 24 compatible): Fast inference for ONNX models — relevant only if switching to Python/SB3 training path.

### Expected Features

**Must have (table stakes):**
- Headless match runner — the root dependency; `RtsRoom` already supports it with no engine changes
- Observation encoder (12 spatial planes + 7 economy scalars, downsampled grid) — structured numeric input for ML model; raw grid is not viable
- Action decoder with masking — maps model output to `queueBuildEvent`/`queueDestroyEvent`; masking via `previewBuildPlacement()` is non-negotiable for RTS action spaces
- Reward signal (terminal win/loss + annealed shaped rewards) — sparse alone is too slow to converge; shaping must anneal to zero to prevent reward hacking
- Gym-like environment wrapper (`reset()`/`step()`) — standard interface consumed by training pipeline
- Self-play loop with opponent snapshot pool — prevents strategy collapse; requires historical sampling (50% latest / 30% historical / 20% random)
- PPO training loop (TypeScript via `@tensorflow/tfjs`) — core learning algorithm
- Match result logging (NDJSON) — prerequisite for all balance analysis
- Win rate computation per template with confidence intervals — most fundamental balance metric
- Glicko-2 structure template ratings — key analytical output unique to this milestone
- Playable in-game bot via Socket.IO virtual player adapter — milestone's user-facing deliverable

**Should have (differentiators):**
- Action masking in policy network using `previewBuildPlacement()` — dramatically improves sample efficiency; research confirms unmasked PPO in RTS "fails to achieve any win rates" while masked agents reach 82%+
- Strategy distribution analysis (Shannon entropy over combo frequencies) — detects meta collapse before it becomes a reporting problem
- Determinism hash verification in headless matches — reuses `createDeterminismCheckpoint()` at zero incremental cost
- Replay/trajectory storage via `InputLogEntry` + `TimelineEvent` — enables offline debugging of surprising bot behavior
- Configurable reward weights — iterate on reward design without code changes
- Curriculum training schedule — phases reward shaping out as the policy matures

**Defer to later milestone:**
- Glicko-2 combo ratings — requires >1000 matches and validated template ratings first
- Intransitivity detection — depends on sufficient combo data volume
- Snowball curve analysis — secondary to template balance
- Visual replay viewer — deferred per PROJECT.md to spectator milestone
- Nash equilibrium approximation — research-level complexity, unclear ROI for 5-template game

### Architecture Approach

The architecture introduces one new package (`packages/bot-harness`) that consumes `#rts-engine` and `#conway-core` while following the existing strict layer boundary rule: packages are deterministic and runtime-agnostic, apps are runtime-specific. The `BotSocketAdapter` (live in-game bot) lives in `apps/server` because it touches Socket.IO. Balance analysis can live in a second new package (`packages/balance-analysis`) or be co-located in `packages/rl-training` — the boundary is the import rule, not the directory count.

**Major components:**
1. `HeadlessMatchRunner` in `packages/bot-harness` — creates `RtsRoom`, manages lobby-to-active-to-finished lifecycle without Socket.IO, runs tick loop until `RoomTickResult.outcome` is non-null, runs in `worker_threads` for parallelism.
2. `BotEnvironment` + `ObservationEncoder` + `ActionDecoder` + `RewardSignal` in `packages/bot-harness` — Gymnasium-style wrapper; the boundary between game engine and ML training.
3. `ppo.ts` + `glicko2.ts` + `trainer.ts` + `balance-analysis.ts` in `packages/rl-training` — pure-TypeScript ML and rating logic with zero external dependencies except `@tensorflow/tfjs`.
4. `MatchDatabase` + `GlickoRatingEngine` + `BalanceReport` in `packages/balance-analysis` — aggregates NDJSON match logs into structured balance insights.
5. `BotSocketAdapter` in `apps/server` — loads trained model, plays as virtual player by calling `room.queueBuildEvent()` directly (same-process, no Socket.IO round-trip) to eliminate the training/inference latency gap.

**Observation space:** 12 spatial feature planes on the grid (alive cells, territory masks, structure footprints, HP, build zones, pending builds) + 7 scalar economy features. Total ~200 floats after downsampling to 8x8 macro-cells. Raw 52x52 grid cells must NOT be used.

**Action space:** MultiDiscrete (action\_type x template\_id x quantized\_x x quantized\_y x transform\_index) with invalid action masking via `previewBuildPlacement()`. Full unmasked space on a 256x256 map is ~2.6M actions; masking reduces to hundreds of valid options per decision step.

### Critical Pitfalls

1. **Bot bypasses `RtsRoom` validation (Phase 1)** — the harness MUST use `queueBuildEvent`/`queueDestroyEvent` as the sole action interface with no "fast path." Bypassing validation trains a policy that produces 80%+ invalid actions in live play and requires full retraining from scratch.

2. **Raw grid cells in observation space (Phase 2)** — a 2,704-element binary grid is intractable for an MLP. Prior Conway RL research confirms agents trained on raw grid input "typically generate still-life and then avoid interacting with the system." Use downsampled macro-cell density bins (8x8 = 64 spatial features) plus per-team economy scalars.

3. **No action masking (Phase 2)** — research (Huang et al., 2022) is unambiguous: "PPO agents without action masking in RTS environments fail to achieve any win rates" while masked agents reach 82%+. Negative rewards for invalid actions are not a substitute and require 10-100x more samples to converge.

4. **Self-play strategy collapse (Phase 3)** — without a historical opponent pool, self-play converges to a single degenerate strategy within 200 iterations, and balance analysis built on that data is meaningless. Maintain a snapshot pool, track policy entropy as a health metric, and run evaluation games against scripted baselines (random, greedy-economy).

5. **Glicko-2 ratings confounded by bot policy quality, not structure strength (Phase 5)** — a structure's rating reflects the strength of the policy that used it, not the structure's intrinsic value. Supplement scalar Glicko-2 with a pairwise win-rate matrix; flag any structure with RD > 150 as "insufficient data." Consider Bradley-Terry for static entities since Glicko-2's volatility mechanics assume changing strength over time.

---

## Implications for Roadmap

The dependency chain is strict and the phase order follows directly from it. `HeadlessMatchRunner` is the root node; nothing else can begin without it. Observation/action/reward design is load-bearing and cannot be changed after training starts without discarding training results. Balance analysis is partially parallelizable with Phase 3 execution. The live bot is always last because it requires a trained model.

### Phase 1: Headless Match Runner and Harness Foundation

**Rationale:** The dependency root for the entire milestone. Low implementation risk (wraps existing `RtsRoom` API) but the architectural decisions made here — `queueBuildEvent` as sole action interface, `worker_threads` for parallelism, minimal per-tick allocations — cannot be undone without rewrites. Establishes the performance baseline that determines whether parallel training is feasible.

**Delivers:** `packages/bot-harness` scaffold, `HeadlessMatchRunner`, `BotAgent` interface, `worker_threads` parallel match pool, performance benchmark (matches/second on target map sizes), seeded PRNG for reproducible training, match result NDJSON logger.

**Addresses:** Headless runner (table stakes), match result logging (table stakes).

**Avoids:** Pitfall 1 (validation bypass — foundational decision made here), Pitfall 6 (event loop blocking — worker_threads from the start), Pitfall 7 (GC pressure — pre-allocate result objects, avoid per-tick allocation), Pitfall 14 (unseeded randomness — seed all randomness in Phase 1).

### Phase 2: Observation Space, Action Space, and Reward Signal

**Rationale:** These three components define the interface between game engine and ML model. They are load-bearing: a bad observation space wastes all training compute, and adding action masking after training starts requires restarting. Must be fully tested and validated before Phase 3 begins.

**Delivers:** `ObservationEncoder` (12 spatial planes + 7 scalars, 8x8 macro-cell downsampling), `ActionDecoder` (MultiDiscrete with masking via `previewBuildPlacement()`), `RewardSignal` (configurable win/loss + shaped rewards with annealing coefficient), `BotEnvironment` Gymnasium wrapper, property-based unit tests verifying observation determinism (same `RoomState` + `teamId` = same output) and reward invariants.

**Uses:** `@tensorflow/tfjs@4.22.0` for tensor shape validation; `fast-check` (existing) for property tests.

**Avoids:** Pitfall 4 (raw grid observation), Pitfall 5 (negative rewards instead of masking), Pitfall 8 (economy farming via misaligned shaped rewards — ensure shaping coefficient defaults to anneal to 0).

### Phase 3: PPO Training Loop with Self-Play

**Rationale:** With the environment interface validated, this phase runs the first real training experiments. A working (even poorly trained) policy validates the entire pipeline. Self-play infrastructure must be built alongside the training loop because the opponent pool design affects dynamics from iteration 1.

**Delivers:** `ppo.ts` (PPO-Clip implementation: actor-critic networks, GAE advantage estimation, clipped surrogate loss, entropy bonus), self-play training loop with opponent snapshot pool, curriculum reward annealing schedule, training metrics dashboard (policy entropy, KL divergence, win rate vs. random baseline, unique templates used per game), checkpoint saving via `model.save('file://./data/models/...')`.

**Uses:** `@tensorflow/tfjs@4.22.0` (actor-critic networks, Adam optimizer); `worker_threads` for parallel episode collection; NDJSON for checkpoint manifests and match logs.

**Decision gate:** Benchmark CPU training throughput after first 100 matches. If projecting >8 hours for target training run, escalate decision to adopt Python/SB3 path with NDJSON stdio IPC bridge and ONNX export.

**Avoids:** Pitfall 3 (mode collapse — opponent pool with historical sampling mandatory from start), Pitfall 10 (wrong hyperparameter defaults — start with lr=1e-4, clip=0.1-0.15, epochs=3-4, batch=2048+, GAE lambda=0.98, entropy=0.01), Pitfall 13 (train with configurable action delay 1-3 ticks to match live-game latency), Pitfall 14 (seeded training from Phase 1 infrastructure).

### Phase 4: Balance Analysis — Win Rates and Strategy Distribution

**Rationale:** Can begin with random-vs-random data while Phase 3 training runs in parallel. Balance analysis does not require a well-trained agent — any match data is analyzable. Running Phase 4 alongside Phase 3 validates the analysis pipeline early.

**Delivers:** `MatchDatabase` (NDJSON reader/aggregator), win rate computation per template with 95% confidence intervals (minimum 400 games for 10% effect, 1600 for 5%), strategy distribution analysis (Shannon entropy, pick rates), per-map balance metrics across grid sizes (64x64, 128x128, 256x256), balance report generator.

**Avoids:** Pitfall 15 (insufficient sample sizes — require p < 0.05 for all balance claims, report confidence intervals on every win rate statistic).

### Phase 5: Glicko-2 Structure Ratings

**Rationale:** Requires Phase 4's match data (1000+ matches for statistical validity). The Glicko-2 custom implementation is compact (~150 LOC), but the methodology — period configuration, intransitivity handling, confounding mitigation — requires careful design to avoid producing misleading ratings.

**Delivers:** Custom `glicko2.ts` (zero external dependencies, full TypeScript types, property-tested), `GlickoRatingEngine` with per-template ratings and RD/confidence intervals, pairwise win-rate matrix for intransitivity detection, one rating period per training iteration batch for tracking meta evolution over time.

**Avoids:** Pitfall 9 (policy-confounded ratings — use win-rate matrix as primary truth, scalar rating as secondary; flag RD > 150 as "insufficient data"), Pitfall 11 (period misconfiguration — one period per 100-game training batch, not per-game or all-at-once).

### Phase 6: Playable In-Game Bot (Socket.IO Adapter)

**Rationale:** The final user-facing deliverable. Requires a trained model from Phase 3. The bot runs as a same-process virtual player in `apps/server`, calling `room.queueBuildEvent()` directly to eliminate the training/inference latency gap.

**Delivers:** `BotSocketAdapter` in `apps/server`, trained model loading (TF.js `loadLayersModel` or ONNX via `onnxruntime-node`), bot difficulty levels from different training checkpoints, benchmarked full decision pipeline (observe + infer + act must complete in <10ms leaving 30ms headroom per tick).

**Avoids:** Pitfall 12 (inference exceeds tick budget — small network architecture, pre-computed observation features, decide every 5-10 ticks not every tick), Pitfall 13 (stale-state latency — same-process virtual player eliminates Socket.IO round-trip).

### Phase Ordering Rationale

The critical path is Phases 1 → 2 → 3 → 6 (sequential, no shortcuts). Phase 4 can begin alongside Phase 3 execution using early match log data. Phase 5 gates on Phase 4 match volume accumulation.

```
Phase 1 (foundation) → Phase 2 (interface) → Phase 3 (training) → Phase 6 (live bot)
                                                      |
                                                      v
                                               Phase 4 (analysis) → Phase 5 (ratings)
```

Phase 2 before Phase 3 is non-negotiable: observation/action/reward design errors require full retraining to fix, making them the most expensive mistakes in the milestone. Phase 5 after Phase 4 is also non-negotiable: Glicko-2 with fewer than 500 matches per structure produces RD values that are meaningless.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3:** PPO hyperparameter tuning for this specific domain (long episodes, large discrete action space, self-play non-stationarity, sparse rewards). The research identifies conservative starting values but empirical calibration is required. May benefit from a `/gsd:research-phase` pass specifically on hyperparameter configurations for discrete-action RTS RL.
- **Phase 5:** Glicko-2 period configuration for batch simulation data lacks established precedent. The mapping from "training iteration" to "rating period" needs validation against actual data distributions; consider the Bradley-Terry model as a fallback for static entities.

Phases with standard patterns (skip research-phase):
- **Phase 1:** Wrapping a synchronous deterministic tick loop in `worker_threads` is a standard Node.js pattern.
- **Phase 2:** Observation/action/reward design patterns are thoroughly documented in Gym-MicroRTS and GridNet literature and map directly to the existing `RtsRoom` API surface.
- **Phase 4:** Win rate computation and strategy distribution metrics are standard RTS balance analysis with well-established statistical methods.
- **Phase 6:** Virtual player adapter follows the existing server architecture patterns directly; the main work is connecting already-built components.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | npm registry versions verified against Node 24; `@tensorflow/tfjs-node` breakage confirmed via live GitHub issues; Glicko-2 license analysis verified against npm registry metadata |
| Features | HIGH | Derived from PROJECT.md requirements and validated against `RtsRoom` API surface; observation/action design cross-referenced with Gym-MicroRTS and GridNet literature |
| Architecture — integration | HIGH | Direct codebase analysis; layer boundary rules are explicit and consistent; `RtsRoom` API provides every method needed for headless simulation |
| Architecture — training pipeline | MEDIUM | NDJSON stdio IPC pattern is well-established; TypeScript PPO implementation is unproven at scale for this domain |
| Pitfalls | HIGH for engine-specific risks (pitfalls 1, 2, 6, 7); MEDIUM for RL-domain risks (3, 4, 5, 8, 10) | Engine pitfalls confirmed by direct code analysis; RL pitfalls sourced from multi-paper consensus with documented RTS-specific evidence |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **TypeScript vs. Python training throughput:** STACK.md recommends TypeScript/TF.js; ARCHITECTURE.md recommends Python/SB3. Resolve empirically in Phase 3 with a defined decision gate (benchmark after first 1000 training matches; if projecting >8 hours wall-clock time, adopt Python/ONNX path). Document the gate criteria explicitly in the Phase 3 plan.

- **Exact observation feature count:** Research recommends 12 spatial planes + 7 scalars (~200 floats). A simpler representation (economy scalars only + 8x8 macro-cell density) may be sufficient for a 5-template game and train faster. Phase 2 should run a quick ablation: train for 500 episodes with minimal features vs. full features, compare learning curves.

- **Action space quantization scheme:** FEATURES.md suggests 16x16 region coarsening for large maps; ARCHITECTURE.md uses every-4-cell quantization. The interaction with `DEFAULT_QUEUE_DELAY_TICKS=10` is non-obvious. Phase 2 plan must define a fixed quantization scheme, document the precision/action-space-size tradeoff, and test it against `previewBuildPlacement()` acceptance rates.

- **Glicko-2 vs. Bradley-Terry for structure ratings:** PITFALLS.md recommends Bradley-Terry over Glicko-2 for static entities (structures do not change over time, making volatility mechanics inappropriate). Phase 5 plan should evaluate both models against the actual match data distribution from Phase 4 and document the selection rationale.

---

## Sources

### Primary (HIGH confidence)

- Direct codebase analysis: `packages/rts-engine/rts.ts`, `packages/conway-core/grid.ts`, `packages/rts-engine/structure.ts`, `packages/rts-engine/socket-contract.ts`, `packages/rts-engine/match-lifecycle.ts`, `packages/rts-engine/gameplay-rules.ts`, `apps/server/src/server.ts`
- `@tensorflow/tfjs` npm registry (4.22.0, October 2024) — https://www.npmjs.com/package/@tensorflow/tfjs
- TensorFlow.js Node 24 breakage — https://github.com/tensorflow/tfjs/issues/8609
- `onnxruntime-node` npm registry (1.24.3, March 2026 dev builds) — https://www.npmjs.com/package/onnxruntime-node
- Glicko-2 algorithm reference paper (Glickman, revised March 2022) — https://www.glicko.net/glicko/glicko2.pdf
- `glicko2.ts` npm GPL-3.0 license — verified via `npm view glicko2.ts`

### Secondary (MEDIUM confidence)

- Gym-MicroRTS (Farama Foundation) — observation/action space design for grid RTS RL — https://github.com/Farama-Foundation/MicroRTS-Py
- GridNet: Grid-Wise Control for Multi-Agent RL (Han et al., ICML 2019) — encoder-decoder CNN for grid observation spaces
- SIMPLE Self-Play Framework — opponent pool design with historical sampling — https://github.com/davidADSP/SIMPLE
- "The 37 Implementation Details of PPO" (ICLR Blog Track 2022) — PPO hyperparameter guidance — https://iclr-blog-track.github.io/2022/03/25/ppo-implementation-details/
- "Action Guidance: Sparse + Shaped Rewards for RTS" (OpenReview) — curriculum anneal from shaped to sparse rewards
- "Invalid Action Masking for Discrete Action Spaces" (Huang et al., 2022) — masking vs. negative rewards in large discrete action spaces
- "From Ratings to Balance: Glicko in Competitive Gaming" (IEEE 2025) — https://ieeexplore.ieee.org/document/10959302/
- SB3 ONNX Export Guide — https://stable-baselines3.readthedocs.io/en/master/guide/export.html

### Tertiary (LOW confidence)

- Training speed estimates (JS CPU ~10-100x slower than native) — https://www.tensorflow.org/js/guide/nodejs — unverified for this model scale; empirical benchmark in Phase 3 is the authoritative source
- Conway RL raw-grid failure mode ("generates still-life and avoids interaction") — https://github.com/lkwilson/Conways-Game-of-Life-AI — single project, not peer-reviewed; consistent with broader RL observation space literature

---

*Research completed: 2026-03-30*
*Ready for roadmap: yes*
