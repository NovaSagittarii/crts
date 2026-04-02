# Feature Landscape

**Domain:** RL Bot Harness, Balance Analysis & Structure Ratings for Conway RTS
**Researched:** 2026-03-30
**Confidence:** HIGH (features derived from PROJECT.md requirements; observation/action/reward design informed by Gym-MicroRTS, AlphaGo, GridNet, and SB3 documentation; Glicko-2 application validated by IEEE gaming analytics literature; all mapped to existing RtsEngine API surface)

---

## Table Stakes

Features that developers running balance analysis and training bots expect. Missing any = the milestone deliverable is non-functional.

| Feature                                   | Why Expected                                                                                                                   | Complexity | RtsEngine API Dependency                                                                                                                                                                                    | Notes                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headless match runner                     | Cannot train bots without rendering-free game execution at max speed                                                           | Low        | `RtsRoom.create()`, `RtsRoom.tick()`, `addPlayer()`, `RoomTickResult.outcome`                                                                                                                               | RtsRoom already supports headless deterministic ticks. Wrap in a match-runner loop that handles lobby-to-active-to-finished lifecycle without Socket.IO. No tick timer during training (run as fast as CPU allows). |
| Observation encoder                       | RL agent needs structured numeric input representing game state; must be deterministic (same RoomState + teamId = same output) | Medium     | `RoomState.grid` (Uint8Array via `Grid.toUnpacked()`), `TeamState.resources/income/structures/defeated`, `pendingBuildEvents`, `pendingDestroyEvents`, `TeamState.baseTopLeft`, `TeamState.territoryRadius` | Encode as multi-plane tensor `(H, W, C)` following AlphaGo/Gym-MicroRTS conventions. See detailed design below.                                                                                                     |
| Action decoder                            | ML model outputs must map to game actions (`BuildQueuePayload` / `DestroyQueuePayload`)                                        | Medium     | `RtsRoom.queueBuildEvent()`, `RtsRoom.queueDestroyEvent()`, `RoomState.templateMap` (5 templates: block, generator, glider, eater-1, gosper), `PlacementTransformState`                                     | MultiDiscrete: (action_type, template_id, grid_x, grid_y, transform_index) for builds + (structure_index) for destroys + no-op. Must mask invalid actions per decision step.                                        |
| Reward signal (terminal: win/loss)        | Terminal reward is the minimum viable signal for competitive training                                                          | Low        | `RoomTickResult.outcome`, `MatchOutcome.winner`, `RankedTeamOutcome`                                                                                                                                        | +1.0 win, -1.0 loss. Sparse but essential baseline.                                                                                                                                                                 |
| Reward shaping (economy/territory/damage) | Sparse win/loss alone makes PPO training prohibitively slow for RTS games due to delayed credit assignment                     | Medium     | `TeamState.resources`, `TeamState.income`, `TeamIncomeBreakdown`, `TeamOutcomeSnapshot.territoryCellCount`, core `Structure.hp`                                                                             | Economy delta, territory delta, opponent core damage per tick. Anneal shaping coefficient from 1.0 to 0.0 over training to prevent reward hacking. See detailed design below.                                       |
| Gym-like environment wrapper              | Standard `reset()`/`step()` interface that the training pipeline consumes                                                      | Low        | Thin orchestration over HeadlessMatchRunner + ObservationEncoder + ActionDecoder + RewardSignal                                                                                                             | Follows Gymnasium pattern. `reset()` creates new match, `step(action)` advances N ticks. Returns `(obs, reward, terminated, truncated, info)`.                                                                      |
| Self-play match loop                      | Standard method for competitive RL without requiring external opponents                                                        | Medium     | Headless match runner + environment wrapper                                                                                                                                                                 | Pit current policy vs. frozen snapshot from opponent pool. Minimum: play current vs. latest frozen. Use SIMPLE framework pattern.                                                                                   |
| PPO training loop (Python)                | PPO is the standard algorithm; Python ecosystem (SB3/CleanRL/gymnasium) is vastly more mature than any JS alternative          | High       | None directly; consumes observation/reward from Gym environment via IPC                                                                                                                                     | Train in Python with Stable-Baselines3 (`PPO("MlpPolicy", env)`). TypeScript headless env communicates via stdin/stdout JSON lines or subprocess pipe.                                                              |
| ONNX model export                         | Bridge between Python training and TypeScript inference                                                                        | Low        | None                                                                                                                                                                                                        | `torch.onnx.export()` from SB3's `OnnxableSB3Policy` wrapper. Produces `.onnx` file. Well-documented in SB3 export guide (opset 17).                                                                                |
| ONNX inference in Node.js                 | Bot must run in the existing Node.js server ecosystem                                                                          | Low-Medium | `onnxruntime-node` npm package (native C++ bindings, Node.js v16+)                                                                                                                                          | Load `.onnx` model, feed observation Float32Array, get action logits. Apply action mask, argmax or sample.                                                                                                          |
| Playable in-game bot (Socket.IO adapter)  | Bots must be indistinguishable from human players on the wire                                                                  | Medium     | Full `ClientToServerEvents`/`ServerToClientEvents` socket contract: `room:join`, `room:claim-slot`, `room:set-ready`, `build:queue`, `destroy:queue`, `room:joined`, `state`, `build:queued`                | Bot connects as a `socket.io-client`, receives game events, runs inference each decision interval, emits actions. Wraps inference runtime with socket lifecycle.                                                    |
| Match result logging                      | Cannot analyze balance without persistent match outcome data                                                                   | Low        | `MatchOutcome`, `RankedTeamOutcome`, `TeamOutcomeSnapshot`, `TimelineEvent` via `RtsRoom.getTimelineEvents()`                                                                                               | Store per-match: teams, templates used, build sequences, tick count, winner, core HP at end. NDJSON file or SQLite.                                                                                                 |
| Win rate computation                      | Most fundamental balance metric                                                                                                | Low        | Match result logs (no direct engine dependency)                                                                                                                                                             | Aggregate win rates by template usage, opening strategy, map size. Filter by minimum sample size for significance.                                                                                                  |

---

## Differentiators

Features that elevate this from "basic bot" to "balance analysis platform." Not strictly required for a working bot, but deliver high analytical value.

| Feature                                           | Value Proposition                                                                                                                                                      | Complexity | RtsEngine API Dependency                                                                                                                                                                           | Notes                                                                                                                                                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action masking in policy network                  | Prevents agent from wasting samples on illegal actions (out-of-zone placements, unaffordable templates), dramatically improving sample efficiency                      | Medium     | `RtsRoom.previewBuildPlacement()` (`accepted` + `reason`), `TeamState.resources` for affordability check, `collectBuildZoneContributors()` + `isBuildZoneCoveredByContributor()` for zone coverage | Without masking, raw build action space is ~2.6M on a 256x256 map (5 templates _ 256 _ 256 \* 8 transforms). Masking reduces to hundreds of valid options per step.                                                                 |
| Glicko-2 structure template ratings               | Rate individual structure templates (block, generator, glider, eater-1, gosper) by competitive strength using a principled probabilistic system, not just raw win rate | Medium     | `TeamState.structures` (template IDs per team), match outcomes                                                                                                                                     | Use `glicko2.ts` npm package (TypeScript-native). Each template becomes a Glicko-2 entity. Rating Deviation reveals how well-tested each template is. Volatility reveals context-dependence.                                        |
| Glicko-2 combo ratings                            | Rate specific template combinations as composite entities, revealing emergent synergies and dominated strategies                                                       | High       | Same as above but requires defining combo identifiers from build sequences                                                                                                                         | Map each team's build history to a canonical combo signature (order-independent multiset, e.g., `block:3,generator:2`). Only rate combos appearing >= 5 times.                                                                      |
| Strategy distribution analysis                    | Identify whether the metagame is diverse or collapsed to a single dominant strategy                                                                                    | Medium     | Match logs + template/combo frequencies                                                                                                                                                            | Compute pick rate, usage-weighted win rate, Shannon entropy over combo frequencies. High entropy = healthy diverse meta. Low entropy = degenerate.                                                                                  |
| Self-play opponent pool with prioritized sampling | Training against mixed opponent strengths prevents catastrophic forgetting and promotes robust play                                                                    | Medium     | Self-play loop                                                                                                                                                                                     | Maintain pool of frozen policy snapshots with Glicko-2 ratings. Sample proportional to rating (stronger = more likely). Standard practice from AlphaZero/SIMPLE. 50% latest + 30% historical + 20% random is a good starting split. |
| Intransitivity detection                          | Discover rock-paper-scissors dynamics among templates/combos (desirable for strategic depth)                                                                           | High       | Pairwise win rate matrix from match logs                                                                                                                                                           | Build pairwise win rate matrix. Detect directed cycles. Some intransitivity is good (creates metagame cycling); extreme intransitivity is opaque.                                                                                   |
| Snowball curve analysis                           | Measure whether early economic advantages are insurmountable                                                                                                           | Medium     | `TeamState.resources` time series, `TimelineEvent` timestamps, match outcomes                                                                                                                      | Pearson correlation between "resource lead at tick N" and final outcome. High correlation at low N = steep snowball. Current economy: `DEFAULT_STARTING_RESOURCES=40`, generator income 1/tick.                                     |
| Per-map balance metrics                           | Ensure balance holds across different grid sizes since spawn distance varies                                                                                           | Low        | `CreateRoomOptions.width/height`, `SPAWN_MIN_WRAPPED_DISTANCE = 25`                                                                                                                                | Run tournaments at multiple map sizes (64x64, 128x128, 256x256). Report win rates and distributions per map.                                                                                                                        |
| Configurable reward weights                       | Iterate on reward design without code changes. Different reward configs produce different play styles.                                                                 | Low        | Reward config is a plain object passed to RewardSignal class                                                                                                                                       | Enables rapid experimentation.                                                                                                                                                                                                      |
| Curriculum training schedule                      | Progressively increase opponent difficulty and fade out reward shaping                                                                                                 | Medium     | Training pipeline configuration                                                                                                                                                                    | Phase 1: random opponents + full shaping. Phase 2: weak snapshots + declining shaping. Phase 3: recent snapshots + pure win/loss.                                                                                                   |
| Determinism hash verification for bot matches     | Ensure bot-driven headless matches maintain identical determinism guarantees as human lockstep matches                                                                 | Low        | `RtsRoom.createDeterminismCheckpoint()`, `RoomDeterminismCheckpoint`                                                                                                                               | Reuses existing FNV1a-32 hashing infrastructure. Critical for reproducible balance analysis.                                                                                                                                        |
| Replay/trajectory storage                         | Save full action sequences for offline analysis and debugging of surprising bot behavior                                                                               | Low-Medium | `InputLogEntry` from `input-event-log.ts`, `TimelineEvent`                                                                                                                                         | Store complete input log per match. Enables deterministic replay and counterfactual analysis.                                                                                                                                       |
| Bot difficulty levels                             | Multiple ONNX models from different training checkpoints (early = easy, late = hard)                                                                                   | Low        | Just load different `.onnx` files                                                                                                                                                                  | No code changes needed. Natural byproduct of checkpoint-based training.                                                                                                                                                             |
| Strategy profile extraction                       | Classify each match's play style (e.g., "generator rush", "defensive block", "gosper push") for richer Glicko-2 analysis                                               | Medium     | Build order, timing, template distribution from match logs                                                                                                                                         | Heuristic classification. Enriches balance reports beyond raw template counts.                                                                                                                                                      |

---

## Anti-Features

Features to explicitly NOT build in v0.0.4.

| Anti-Feature                                             | Why Avoid                                                                                                                                                                                                                                                        | What to Do Instead                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| All-TypeScript PPO training                              | No viable TypeScript PPO library exists. TensorFlow.js supports basic RL but the Python ecosystem (SB3, CleanRL, gymnasium, PyTorch) is vastly more mature, better documented, and orders of magnitude faster. Would require months of ML framework development. | Train in Python (SB3 + PPO), export to ONNX, infer in Node.js via `onnxruntime-node`.                                                            |
| Full client-side bot (browser inference)                 | `onnxruntime-web` is 11-17x slower than native per GitHub issue #11181. Adds WASM/WebGPU complexity, increases bundle size, provides no balance-analysis value.                                                                                                  | Bot runs server-side in Node.js only. Browser bots are a future milestone if needed for single-player.                                           |
| Real-time training during live matches                   | Training requires thousands of episodes and gradient updates. Running updates during live matches would lag the server catastrophically.                                                                                                                         | Train offline in batch, deploy frozen ONNX model for live play.                                                                                  |
| Visual replay viewer                                     | High UI effort, low balance-analysis ROI.                                                                                                                                                                                                                        | Store replay data (input logs + timeline events). Viewer deferred to spectator mode milestone (already identified as `UX2-01` future candidate). |
| Multi-agent training (>2 players per match)              | The game is effectively 1v1 (one player per team). Multi-agent adds massive non-stationarity and credit assignment complexity.                                                                                                                                   | Keep 1v1 self-play. HeadlessMatchRunner takes exactly 2 agents.                                                                                  |
| Fog-of-war for bots                                      | The game does not have fog-of-war yet (future candidate `UX2-01`). Simulating partial observability is premature.                                                                                                                                                | Bots see full state, same as human players. Add fog support when the feature ships.                                                              |
| GPU training support in Node.js                          | `@tensorflow/tfjs-node-gpu` has documented inconsistencies. Not worth the debugging effort.                                                                                                                                                                      | Train in Python where CUDA support is reliable. Conway RTS is computationally cheap; CPU PPO is sufficient.                                      |
| Automated balance patching                               | Automatically adjusting game parameters (template costs, HP, income rates) based on balance metrics.                                                                                                                                                             | Produce analysis reports and recommendations. Human decides what to change. Automated patching risks unintended cascading effects.               |
| Neural architecture search / hyperparameter optimization | Premature optimization before basic PPO self-play is validated.                                                                                                                                                                                                  | Use SB3 defaults: 2 hidden layers, 64 neurons each, tanh activation. Tune manually only if training clearly fails.                               |
| Persistent player ELO leaderboard                        | No auth system exists. No persistent player identities to track.                                                                                                                                                                                                 | Glicko-2 ratings are for structures/strategies, not players. Player ratings are out of scope per PROJECT.md.                                     |

---

## Feature Dependencies

```
HeadlessMatchRunner (foundation)
  |
  |-> ObservationEncoder (needs runner to provide RoomState)
  |-> ActionDecoder (needs runner to submit actions via queueBuildEvent/queueDestroyEvent)
  |-> RewardSignal (needs runner to provide RoomTickResult)
  |     |
  |     v
  |   BotEnvironment [Gym-like wrapper] (wraps runner + encoder + decoder + reward)
  |     |
  |     |-> Python IPC Bridge (wraps BotEnvironment for SB3 consumption)
  |     |     |
  |     |     v
  |     |   PPO Training Loop (consumes bridge, produces policy checkpoints)
  |     |     |
  |     |     |-> Curriculum Training Schedule (configures opponent difficulty + reward annealing)
  |     |     |-> Self-Play Opponent Pool (stores/samples frozen snapshots)
  |     |     |
  |     |     v
  |     |   ONNX Export (consumes trained PyTorch model)
  |     |         |
  |     |         v
  |     |   TypeScript Inference Runtime (onnxruntime-node loads .onnx)
  |     |         |
  |     |         v
  |     |   BotSocketAdapter (wraps inference + ObservationEncoder + ActionDecoder)
  |     |
  |     |-> Action Masking (enhances BotEnvironment, needs previewBuildPlacement + buildZone)
  |
  |-> MatchResultLogger (stores match outcomes from runner)
  |     |
  |     v
  |   Win Rate Computation (aggregates match logs)
  |     |
  |     |-> Glicko-2 Template Ratings (rates individual templates from pairwise match data)
  |     |     |
  |     |     |-> Glicko-2 Combo Ratings (rates template combinations, needs sufficient volume)
  |     |
  |     |-> Strategy Distribution Analysis (entropy, pick rates)
  |     |     |
  |     |     |-> Intransitivity Detection (pairwise matrix cycles)
  |     |
  |     |-> Snowball Curve Analysis (resource trajectory correlation)
  |     |-> Per-Map Balance Metrics (win rates per grid size)
  |     |-> Balance Report (aggregates all analysis outputs)
  |
  |-> Determinism Hash Verification (reuses createDeterminismCheckpoint)
  |-> Replay/Trajectory Storage (reuses InputLogEntry + TimelineEvent)
```

**Key dependency chains:**

1. **HeadlessMatchRunner is the root.** Everything depends on running matches without Socket.IO.
2. **Observation + action + reward -> BotEnvironment** must exist before any training can start.
3. **Python training -> ONNX export -> TS inference -> Socket.IO adapter** is the deployment chain.
4. **MatchResultLogger** feeds all balance analysis features (Glicko-2, win rates, distributions, snowball).
5. **Action masking** is technically independent but should be built alongside action space for practical training.
6. **Glicko-2 combo ratings** depend on template ratings being validated first and sufficient match volume (>1000 matches).

---

## Observation Space Design

The observation space should be a 3D tensor of shape `(H, W, C)` where H and W are the grid dimensions and C is the number of feature channels. This follows the standard established by AlphaGo (19x19x48 planes), Gym-MicroRTS (h x w x 29 planes), and GridNet (global grid feature map with encoder-decoder CNN).

**Recommended feature planes for Conway RTS:**

| Channel | Type        | Description                                                    | Engine Source                                                              |
| ------- | ----------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 0       | Binary      | Grid cell alive/dead                                           | `RoomState.grid` via `Grid.toUnpacked()`                                   |
| 1       | Binary      | Own team territory mask                                        | Derived from `TeamState.baseTopLeft` + `TeamState.territoryRadius`         |
| 2       | Binary      | Opponent team territory mask                                   | Same derivation for opponent                                               |
| 3       | Binary      | Own structure footprint (all cells occupied by own structures) | `TeamState.structures` -> each `Structure.projectPlacement(width, height)` |
| 4       | Binary      | Opponent structure footprint                                   | Same for opponent structures                                               |
| 5       | Float [0,1] | Own structure HP normalized (per cell, by template startingHp) | `Structure.hp / Structure.template.startingHp` projected onto footprint    |
| 6       | Float [0,1] | Opponent structure HP normalized                               | Same for opponent                                                          |
| 7       | Binary      | Own build zone coverage                                        | `collectBuildZoneContributors()` + `isBuildZoneCoveredByContributor()`     |
| 8       | Binary      | Own core footprint                                             | Core structure cells (from `CORE_STRUCTURE_TEMPLATE`, 11x11 with padding)  |
| 9       | Binary      | Opponent core footprint                                        | Same for opponent                                                          |
| 10      | Binary      | Pending own build locations                                    | `TeamState.pendingBuildEvents` projected via template footprints           |
| 11      | Binary      | Pending opponent build locations                               | Same for opponent                                                          |

**Scalar features (appended as uniform-value planes or as a separate flat vector):**

| Feature                  | Normalization                      | Engine Source                        |
| ------------------------ | ---------------------------------- | ------------------------------------ |
| Own resources            | `resources / 200` (reasonable cap) | `TeamState.resources`                |
| Opponent resources       | Same                               | Opponent `TeamState.resources`       |
| Own income per tick      | `incomeBreakdown.total / 10`       | `TeamIncomeBreakdown.total`          |
| Opponent income per tick | Same                               | Opponent `TeamIncomeBreakdown.total` |
| Current tick             | `tick / MAX_TICKS`                 | `RoomState.tick`                     |
| Own core HP              | `coreHp / 500`                     | Core `Structure.hp` (startingHp=500) |
| Opponent core HP         | Same                               | Opponent core `Structure.hp`         |

**Total: 12 spatial planes + 7 scalar features.**

For smaller observation space (faster training), consider downsampling the grid to a fixed size (e.g., 32x32) using max-pooling or nearest-neighbor. This trades spatial precision for reduced model input size.

**Confidence:** MEDIUM. Feature plane design is well-established in literature. The specific channels are derived from what `RoomState` and `TeamState` expose. Exact plane count needs empirical tuning.

---

## Action Space Design

MultiDiscrete action space, evaluated once per N ticks (decision frequency is a tunable hyperparameter; recommend starting at every 5 ticks since `DEFAULT_QUEUE_DELAY_TICKS = 10`).

**Action dimensions:**

| Dimension       | Range       | Description                                              |
| --------------- | ----------- | -------------------------------------------------------- |
| action_type     | Discrete(3) | 0=no-op, 1=build, 2=destroy                              |
| template_id     | Discrete(5) | block(0), generator(1), glider(2), eater-1(3), gosper(4) |
| grid_x          | Discrete(W) | X coordinate for placement                               |
| grid_y          | Discrete(H) | Y coordinate for placement                               |
| transform_index | Discrete(8) | Identity + 3 rotations + 4 reflections                   |
| structure_index | Discrete(S) | Index into own non-core structures (only for destroy)    |

**Action masking is critical.** Without masking, raw build action space is 5 _ W _ H \* 8 = 2,621,440 on a 256x256 map. With masking, this reduces to a few hundred valid options per step.

**Mask computation per decision step:**

1. If `TeamState.defeated`, mask everything except no-op
2. Filter templates by `template.activationCost <= TeamState.resources` (uses `AffordabilityResult`)
3. For affordable templates, valid cells = build zone cells (from `BuildZoneContributor`) AND unoccupied
4. For destroy, valid targets = own structures where `isCore === false`
5. Optional: use `RtsRoom.previewBuildPlacement()` for authoritative validation

**Alternative for large maps:** Coarsen action space to regions (e.g., 16x16 blocks) and snap to nearest valid cell within the selected region. Reduces action space by ~256x.

**Confidence:** MEDIUM. Follows Gym-MicroRTS patterns closely. Maps cleanly to existing engine APIs.

---

## Reward Signal Design

Based on research on reward shaping for RTS games, particularly the "Action Guidance" approach (NeurIPS) and curriculum-based reward annealing:

**Terminal rewards (always active):**

| Signal       | Value | Trigger                                    | Engine Source            |
| ------------ | ----- | ------------------------------------------ | ------------------------ |
| Win          | +1.0  | `MatchOutcome.winner.teamId === ownTeamId` | `RoomTickResult.outcome` |
| Loss         | -1.0  | Match finished, not winner                 | `RoomTickResult.outcome` |
| Draw/timeout | 0.0   | Match exceeds max ticks without outcome    | Custom timeout in runner |

**Shaped rewards (annealed during training via configurable coefficient):**

| Signal                    | Value                                      | Per           | Engine Source                  | Risk                                  |
| ------------------------- | ------------------------------------------ | ------------- | ------------------------------ | ------------------------------------- |
| Economy delta             | `+0.01 * (income_t - income_{t-1})`        | Tick          | `TeamIncomeBreakdown.total`    | Agent farms generators, never attacks |
| Territory delta           | `+0.005 * (territory_t - territory_{t-1})` | Tick          | Territory cell count delta     | Agent spreads without defending core  |
| Structure HP preservation | `-0.01 * own_hp_damage`                    | Tick          | HP deltas on own structures    | Overly defensive play                 |
| Opponent core damage      | `+0.02 * opponent_core_hp_damage`          | Tick          | Opponent core HP delta         | Well-aligned incentive                |
| Invalid action penalty    | `-0.001`                                   | Decision step | Build rejected / masked action | Teaches valid action selection fast   |

**Curriculum annealing schedule:**

| Training Phase       | Range   | Shaping Coefficient     | Opponent Source                    |
| -------------------- | ------- | ----------------------- | ---------------------------------- |
| Phase 1: Exploration | 0-30%   | 1.0 (full shaping)      | Random actions / weakest snapshots |
| Phase 2: Transition  | 30-70%  | Linear decay 1.0 -> 0.0 | Mix of weak + recent snapshots     |
| Phase 3: Competition | 70-100% | 0.0 (pure win/loss)     | Recent strong snapshots only       |

**Confidence:** MEDIUM. Reward shaping for RTS is well-studied. Action Guidance validates the anneal-to-sparse approach. Exact coefficients need empirical tuning. The configurable-weights pattern enables rapid iteration.

---

## Glicko-2 for Structure/Combo Ratings

### How Glicko-2 Works

Glicko-2 (Mark Glickman, Boston University) extends Elo with two additional parameters per rated entity:

- **Rating (r):** Estimated strength (default 1500)
- **Rating Deviation (RD):** Uncertainty in the rating (default 350; decreases with more data)
- **Volatility (sigma):** Expected fluctuation in performance (default 0.06)

95% confidence interval: `[r - 2*RD, r + 2*RD]`. System constant tau (constrains volatility change speed) should be 0.3-1.2.

### Application to Structure Templates

Each of the 5 structure templates becomes a Glicko-2 entity. After each self-play match:

1. Identify templates used by the winning team and losing team
2. Each winning-team template records a "win" against each losing-team template
3. Batch Glicko-2 updates in rating periods of 10-50 matches
4. Use `glicko2.ts` npm package (TypeScript-native, MIT license, supports multi-competitor matches)

**Interpretation matrix:**

| Rating | RD   | Volatility | Meaning                                                                                                                                 |
| ------ | ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| High   | Low  | Low        | Reliably strong template                                                                                                                |
| High   | High | Any        | Possibly strong but under-tested                                                                                                        |
| Low    | Low  | Low        | Reliably weak (candidate for cost reduction / buff)                                                                                     |
| Any    | Any  | High       | Context-dependent — strong in some matchups, weak in others. This is actually desirable for game health (rock-paper-scissors dynamics). |

### Application to Template Combos

Define a combo as the canonical multiset of templates built during a match (e.g., `block:3,generator:2`). Each unique combo becomes its own Glicko-2 entity.

**Mitigations for combinatorial explosion:**

- Only rate combos appearing >= 5 times in the match corpus
- Order-independent: count template frequencies, not build order
- Truncate to first N builds if sequences are very long
- Cross-reference combo rating with component template ratings to detect synergy (combo >> sum of parts) and anti-synergy (combo << sum of parts)

**Confidence:** MEDIUM. Glicko-2 for non-player entities is validated in classifier benchmarking (entity -> player, evaluation -> match). IEEE 2025 paper confirms its adoption across gaming genres for balance analysis. Application to RTS structure templates is a direct mapping of the same formalism.

---

## Balance Metrics Taxonomy

### Tier 1: Essential (Must Have for Milestone)

| Metric                    | Computation                      | Healthy Range                                                     |
| ------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| First-mover win rate      | `wins_team1 / total_matches`     | 45-55%                                                            |
| Per-template usage rate   | `matches_using_template / total` | No single template > 80%                                          |
| Per-template win rate     | `wins_using_template / uses`     | 40-60% per template                                               |
| Average match length      | `mean(match_ticks)`              | 50-500 ticks (too short = rushes dominate, too long = stalemates) |
| Glicko-2 template ratings | Algorithm output per template    | Rating spread < 300 between best and worst                        |

### Tier 2: Diagnostic (Should Have)

| Metric                                     | What It Reveals                                       |
| ------------------------------------------ | ----------------------------------------------------- |
| Strategy entropy (`-sum(p_i * log(p_i))`)  | Meta diversity; low = collapsed to dominant strategy  |
| Snowball coefficient (Pearson r at tick N) | How deterministic early advantages are                |
| Pairwise counter-rate matrix               | Hard counters and dominated strategies                |
| Glicko-2 rating distribution histogram     | Tight = balanced; wide spread = imbalanced            |
| Economy divergence tick                    | When winner/loser resource curves separate decisively |

### Tier 3: Advanced (Nice to Have, Likely Deferred)

| Metric                                    | Complexity                | What It Reveals                                  |
| ----------------------------------------- | ------------------------- | ------------------------------------------------ |
| Nash equilibrium approximation            | High (linear programming) | Theoretically optimal strategy mix               |
| Effective strategy count (`exp(entropy)`) | Low                       | Practical number of viable strategies            |
| Build order timing analysis               | Medium                    | Rush vs economy vs defensive strategy prevalence |
| Core HP trajectory percentiles            | Medium                    | How quickly cores are typically threatened       |

**Confidence:** HIGH for Tier 1 (standard RTS metrics). MEDIUM for Tier 2 (sound methodology, needs adaptation). LOW for Tier 3 (research-level, may exceed milestone scope).

---

## MVP Recommendation

Build these features in priority order:

1. **HeadlessMatchRunner** (Table stakes, Low) -- foundation; unlocks everything else. Testable immediately with random agents.
2. **ObservationEncoder + ActionDecoder + RewardSignal** (Table stakes, Medium) -- completes bot harness. Unit testable against known game states.
3. **BotEnvironment (Gym-like wrapper)** (Table stakes, Low) -- enables training. Testable with scripted agent.
4. **Action masking** (Differentiator, Medium) -- add alongside action decoder; without it, training on grid games is impractically slow.
5. **Python IPC bridge + PPO training + self-play** (Table stakes, High) -- first real training run. Even a poorly trained agent validates the pipeline.
6. **Match result logging + win rate computation** (Table stakes, Low) -- can run against random-vs-random data while PPO trains in parallel.
7. **Glicko-2 template ratings** (Table stakes, Medium) -- key balance insight unique to this milestone.
8. **ONNX export + TypeScript inference** (Table stakes, Low-Medium) -- bridge to production.
9. **BotSocketAdapter (playable in-game bot)** (Table stakes, Medium) -- milestone's user-facing deliverable.
10. **Balance analysis reports (strategy distribution, per-map)** (Table stakes/Differentiator, Low-Medium) -- final analytical output.

**Defer to later iterations or milestone extensions:**

- **Glicko-2 combo ratings:** Requires significant match volume (1000+ matches) and validated template ratings
- **Intransitivity detection:** Depends on combo ratings and large pairwise matrix
- **Snowball curve analysis:** Valuable but secondary to template balance
- **Nash equilibrium:** Research-level complexity, unclear ROI for 5-template game
- **Visual replay:** Deferred per PROJECT.md to spectator milestone
- **Strategy profile extraction:** Add after basic Glicko ratings work

---

## Sources

- [Gym-MicroRTS (Farama Foundation)](https://github.com/Farama-Foundation/MicroRTS-Py) -- observation/action space design patterns for grid-based RTS RL (29 feature planes, MultiDiscrete action space)
- [Deep RTS](https://github.com/cair/deep-rts) -- headless RTS RL environment architecture, >6M steps/sec
- [GridNet: Grid-Wise Control for Multi-Agent RL (ICML 2019)](https://proceedings.mlr.press/v97/han19a/han19a.pdf) -- encoder-decoder CNN for grid observation spaces
- [SIMPLE: Selfplay In MultiPlayer Environments](https://github.com/davidADSP/SIMPLE) -- PPO self-play opponent pool design with historical sampling
- [PPO with Elo-based Opponent Selection (IEEE CoG 2021)](https://ieee-cog.org/2021/assets/papers/paper_299.pdf) -- Elo-based opponent sampling during training
- [Hugging Face Deep RL Course: Self-Play](https://huggingface.co/learn/deep-rl-course/unit7/self-play) -- self-play variants (vanilla, fictitious, prioritized)
- [Reward Shaping for RTS Games (arXiv 2311.16339)](https://ar5iv.labs.arxiv.org/html/2311.16339) -- PPO + reward shaping effectiveness in CTF RTS
- [Action Guidance: Sparse + Shaped Rewards for RTS](https://openreview.net/forum?id=1OQ90khuUGZ) -- curriculum anneal from shaped to sparse rewards
- [Glicko-2 System Specification (Mark Glickman)](https://www.glicko.net/glicko/glicko2.pdf) -- rating algorithm with RD and volatility
- [glicko2.ts TypeScript Library](https://github.com/animafps/glicko2.ts) -- TypeScript-native Glicko-2, team/race support, MIT
- [From Ratings to Balance: Glicko in Competitive Gaming (IEEE 2025)](https://ieeexplore.ieee.org/document/10959302/) -- Glicko for game balance analysis across genres
- [Abstracting Glicko-2 for Team Games (Rhetoric Studios)](https://rhetoricstudios.com/downloads/AbstractingGlicko2ForTeamGames.pdf) -- composite opponent method
- [SB3 ONNX Export Guide](https://stable-baselines3.readthedocs.io/en/master/guide/export.html) -- Python-to-ONNX pipeline with OnnxableSB3Policy (opset 17)
- [SB3 Custom Environments Guide](https://stable-baselines3.readthedocs.io/en/master/guide/custom_env.html) -- Gymnasium interface for custom envs
- [onnxruntime-node npm](https://www.npmjs.com/package/onnxruntime-node) -- native Node.js ONNX inference (C++ bindings, v16+)
- [37 Implementation Details of PPO (ICLR Blog Track)](https://iclr-blog-track.github.io/2022/03/25/ppo-implementation-details/) -- PPO implementation reference
- [CleanRL PPO Reference](https://docs.cleanrl.dev/rl-algorithms/ppo/) -- battle-tested PPO implementation
- [RTS Balancing Research](https://valdiviadev.github.io/RTS-balancing-research/) -- balance metrics taxonomy for RTS games
- [The Balance of Power (Game Developer)](https://www.gamedeveloper.com/design/the-balance-of-power-progression-and-equilibrium-in-real-time-strategy-games) -- snowball curves and power progression in RTS
- [Conway's Game of Life AI (lkwilson/cgolai)](https://github.com/lkwilson/Conways-Game-of-Life-AI) -- RL agent for Game of Life grid control
- [Predicting Impact of Game Balance Changes (arXiv 2409.07340)](https://arxiv.org/pdf/2409.07340) -- AI-driven balance prediction framework

---

_Feature research for: RL Bot Harness, Balance Analysis & Structure Ratings -- Conway RTS v0.0.4_
_Researched: 2026-03-30_
