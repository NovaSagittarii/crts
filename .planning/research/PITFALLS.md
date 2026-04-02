# Domain Pitfalls

**Domain:** RL Bot Harness, PPO Training, Balance Analysis & Structure Ratings -- Conway RTS v0.0.4
**Researched:** 2026-03-30
**Confidence:** HIGH (codebase audit) / MEDIUM (RL integration patterns) / MEDIUM (Glicko-2 for non-player entities)

## Context: This Milestone's Specific Risk Profile

This milestone adds AI training infrastructure and balance analysis to an existing deterministic multiplayer RTS built on Conway's Game of Life. The project already has:

- A fully deterministic engine (`RtsRoom.tick()` with fixed 5-step tick order)
- Validated lockstep protocol with hash-based desync detection
- Server-authoritative input validation (`queueBuildEvent`, `queueDestroyEvent` return rejection reasons)
- Structure templates with activation costs, income, health, and build radii
- A 52x52 torus grid with B3/S23 Conway rules and `Grid.step()` mutating in place
- Economy system with income ticks, resource reservation, and build queues with delay

The risk profile concentrates around: (1) designing observation/action spaces that respect the engine's validation API rather than bypassing it, (2) avoiding reward functions that teach the bot to exploit Conway dynamics rather than play strategically, (3) running thousands of headless matches without killing Node.js event loop or GC, (4) applying Glicko-like ratings to structures/combos where transitivity assumptions break down, and (5) connecting a trained model back to live gameplay without breaking the deterministic tick loop.

## Assumed Phase Structure (for placement guidance)

1. **Phase 1** - Headless match runner and bot harness interface
2. **Phase 2** - Observation space, action space, reward signal design
3. **Phase 3** - PPO training loop with self-play
4. **Phase 4** - Balance analysis: win rates, strategy distributions, per-map metrics
5. **Phase 5** - Structure/combo strength ratings (Glicko-like)
6. **Phase 6** - Playable in-game bot via Socket.IO adapter

---

## Critical Pitfalls

Mistakes that cause rewrites, wasted training compute, or fundamentally broken systems.

### Pitfall 1: Bot bypasses RtsRoom validation, creating actions the real game would reject

**What goes wrong:**
The bot harness calls `Grid.setCell()` directly or manipulates `TeamState.resources` to place structures, bypassing the `RtsRoom.queueBuildEvent()` / `queueDestroyEvent()` validation pipeline. The bot learns strategies that depend on placements the server would reject: building outside territory, building without resources, building on occupied cells. When the trained model is deployed to live gameplay (Phase 6), every action it takes gets rejected by the server.

**Why it happens:**
Performance pressure. `queueBuildEvent` runs placement projection, build zone validation, affordability checks, and territory radius calculations per action. Developers see this as overhead for training and try to create a "fast path" that skips validation. They reason that the bot should learn what is valid through negative rewards. But negative rewards for invalid actions scale poorly (see Pitfall 5) and the bot learns a fundamentally different game than what real players experience.

**Consequences:**
Complete waste of training compute. The trained policy produces actions that are 80%+ invalid in live play. Retraining required from scratch.

**Prevention:**
The bot harness MUST use `RtsRoom.queueBuildEvent()` and `RtsRoom.queueDestroyEvent()` as the sole action interface. The harness receives the `QueueBuildResult` / `QueueDestroyResult` and translates rejection reasons into the observation for the next step. If `queueBuildEvent` is too slow for training throughput, optimize the engine (profile first), do not bypass it.

**Detection:**
Log the rejection rate during the first 100 training episodes. If it exceeds 50%, the action space design is wrong (Pitfall 4). If it is 0%, the harness is probably bypassing validation.

**Phase to address:**
Phase 1 (headless match runner) -- this is a foundational architectural decision that cannot be deferred.

---

### Pitfall 2: Conway grid evolution dominates tick time, making training 100x slower than expected

**What goes wrong:**
Each `Grid.step()` on a 52x52 torus grid iterates all 2,704 cells with 8-neighbor lookups. This is O(width \* height) per tick. A match that runs for 500 ticks calls `Grid.step()` 500 times per match. Training 10,000 matches requires 5,000,000 grid steps. At the current implementation speed (~0.1ms per step for 52x52 on Node.js), that is 500 seconds of pure grid computation -- not counting economy, build validation, or structure integrity checks. Developers expect training to take minutes but it takes hours.

**Why it happens:**
The `Grid.step()` implementation in `grid.ts` is correct but not optimized for bulk simulation. It uses a `Uint8Array` per cell (8 bits for 1 bit of information), creates a scratch buffer per step, and performs individual array lookups. For interactive play at 25 ticks/second, this is fine. For training throughput at maximum speed, it becomes the bottleneck.

**Consequences:**
Training feedback loops take hours instead of minutes. Hyperparameter tuning becomes impractical. Developers give up on self-play or reduce match length to the point where games are not strategically meaningful.

**Prevention:**

1. Profile `RtsRoom.tick()` before optimizing. Measure: what percentage of tick time is `Grid.step()` vs. economy vs. build validation vs. integrity checks?
2. For training, use a smaller grid (e.g., 32x32 or even 20x20). The structure templates still fit; the game dynamics are similar but faster. Make grid size a configurable parameter in the headless match runner.
3. Consider bit-packing the grid for the training runner: `Grid.toPacked()` already exists and stores 8 cells per byte. A step function operating on packed representation would process 8 cells at once via bitwise operations. This is a significant optimization but should only be pursued after profiling confirms grid step is the bottleneck.
4. Do NOT rewrite the Grid in WASM/Rust yet -- the TypeScript-only constraint is a project decision. Worker threads are the better scaling path.

**Detection:**
Measure wall-clock time for 100 complete matches with no bot logic (just random actions). If it exceeds 60 seconds on a modern machine, grid step optimization is needed before training begins.

**Phase to address:**
Phase 1 (headless match runner performance baseline).

---

### Pitfall 3: Self-play training collapses to a single degenerate strategy

**What goes wrong:**
The bot discovers that placing a Gosper glider gun near the opponent's core is overwhelmingly effective. Both sides of self-play converge on "rush Gosper gun" within 200 training iterations. The policy entropy drops to near zero. The bot cannot beat a human who uses a defensive strategy the bot has never encountered. Balance analysis (Phase 4) shows 50/50 win rates and declares the game "balanced" -- but it has only measured one strategy vs. itself.

**Why it happens:**
Self-play without diversity preservation suffers from mode collapse. PPO with self-play naturally converges toward Nash equilibria in theory, but in practice it converges to the best response against the current opponent, not the best response against all possible opponents. If the training opponent is always the latest policy checkpoint, the training loop becomes a narrow arms race between two identical strategies.

Research shows this is a well-documented problem: "the training procedure for self-play reinforcement learning is unstable and more sample-inefficient than general reinforcement learning" (Survey of Self-Play in RL, 2021/2024). Diversity collapse in RL is characterized by improvements in single-attempt accuracy while losing the ability to produce diverse strategies.

**Consequences:**
The trained bot is a one-trick pony. Balance analysis based on self-play data is useless because it only reflects one meta-strategy. Structure ratings converge incorrectly (all structures used by the dominant strategy get high ratings; all others get low ratings regardless of actual strength).

**Prevention:**

1. Maintain a population of opponent policies, not just the latest checkpoint. Every N training iterations, snapshot the current policy and add it to an opponent pool. Sample training opponents from the pool with probability proportional to recency but with a minimum sampling floor for older policies.
2. Track policy entropy as a training metric. If entropy drops below a threshold, increase the entropy coefficient in PPO.
3. Add evaluation games against scripted baselines (random, greedy-economy, defensive-only) alongside self-play. If win rate against random drops, the policy is overfitting to self-play dynamics.
4. For balance analysis specifically, run the final evaluation with the entire population of checkpoints, not just the final policy.

**Detection:**
Monitor: (a) unique structure templates used per game over training time -- if this decreases monotonically, diversity is collapsing; (b) policy entropy; (c) win rate against a frozen early-training checkpoint -- if this drops, catastrophic forgetting is occurring.

**Phase to address:**
Phase 3 (PPO training loop) and Phase 4 (balance analysis methodology).

---

### Pitfall 4: Observation space includes raw grid cells, making the neural network unable to learn anything useful

**What goes wrong:**
The observation space is defined as the full 52x52 grid (2,704 binary values) plus economy numbers. The neural network receives a flattened vector of 2,704+ features. With PPO's sample efficiency, the agent cannot learn meaningful spatial patterns from this high-dimensional input within a reasonable number of training games. The agent performs no better than random after 10,000 games.

**Why it happens:**
Developers assume that "the model will figure it out" given enough data. But Conway grids are spatially complex -- a 52x52 binary grid has 2^2704 possible states. Unlike Atari frames where nearby pixels are correlated and a CNN can extract local features, Conway grid states have long-range dependencies (a glider gun 30 cells away determines your core's fate in 100 ticks). A small MLP cannot capture these relationships; a CNN can capture local patterns but misses the long-range interactions.

Prior work on RL for Conway's Game of Life confirms this: "the RL agent typically generated still-life and then avoided interacting with the system" when given raw grid observations. The agent learns to create stable patterns (which preserve its score) but never learns offensive or defensive strategy.

**Consequences:**
Training produces an agent that either does nothing (places no structures) or places structures randomly. Weeks of compute wasted.

**Prevention:**
Design a compact, engineered observation space that captures strategic information rather than raw cell state:

- **Per-team summary features**: resources, income, core HP, number of active structures, territory cell count
- **Spatial features at reduced resolution**: divide the 52x52 grid into 4x4 or 8x8 macro-cells and report alive-cell density per macro-cell (reduces 2,704 features to 169 or 42)
- **Structure-relative features**: for each placed structure, report distance to enemy core, whether it is in enemy territory, HP, and template type
- **Build zone mask**: which macro-cells are valid build locations (binary mask at reduced resolution)
- **Temporal features**: ticks since match start, ticks since last build, current pending queue size

Start with this compact representation. If the agent learns successfully, consider adding a CNN channel for a downsampled grid image as an additional input. Do not start with raw grid.

**Detection:**
Run 1,000 training games. If the average reward per episode is not improving and build actions are either 0 per game or uniformly random, the observation space is too large or uninformative.

**Phase to address:**
Phase 2 (observation space design) -- this decision is load-bearing and must be made correctly before Phase 3 begins.

---

### Pitfall 5: Using negative rewards for invalid actions instead of action masking

**What goes wrong:**
The action space includes all possible (templateId, x, y) combinations -- potentially thousands of actions. The bot receives a -1 reward for each invalid placement. 90% of the action space is invalid at any given time (outside territory, on occupied cells, insufficient resources). The bot spends most of its training learning what NOT to do rather than learning strategy. Convergence takes 10-100x longer than necessary.

**Why it happens:**
Action masking requires computing the set of valid actions at each step, which means checking build zone validity for every possible placement. Developers see this as expensive and opt for negative rewards instead. But research is unambiguous: "invalid action masking scales well when the space of invalid actions is large, while the common approach of giving negative rewards for invalid actions will fail" (Huang et al., 2022). PPO agents without action masking in RTS environments "fail to achieve any win rates" while masked agents reach 82%+.

**Consequences:**
Training is sample-inefficient. The agent learns to avoid invalid actions but never learns to choose good valid actions. In the worst case, the agent learns to take no actions at all (safest way to avoid negative rewards).

**Prevention:**
Implement action masking in the bot harness:

1. At each decision step, compute the set of valid (templateId, x, y) tuples by querying `RtsRoom.previewBuildPlacement()` or a lighter validity check.
2. Pass the valid action mask to PPO so that the policy network's softmax is restricted to valid actions only.
3. If computing the full valid action set is too expensive, use a coarse mask: filter by (a) affordability (can the team afford any template?), (b) territory (which macro-cells are in build zone?), (c) occupancy (which macro-cells have room?). The coarse mask removes 80%+ of invalid actions cheaply.
4. Include a "no-op" action that is always valid (skip this decision step).

**Detection:**
During the first 100 training episodes, log the fraction of actions that are invalid. If it exceeds 30%, the action space or masking is insufficient.

**Phase to address:**
Phase 2 (action space design) -- must be resolved before Phase 3 training begins.

---

### Pitfall 6: Headless match runner blocks Node.js event loop, preventing parallel training

**What goes wrong:**
The headless match runner calls `room.tick()` in a tight synchronous loop to simulate a full match as fast as possible. A 500-tick match takes ~200ms of continuous synchronous execution. During this time, the Node.js event loop is blocked. If training runs matches sequentially, throughput is limited to ~5 matches/second on a single core. If multiple matches are run via `setImmediate` interleaving, they interfere with each other's timing. No I/O callbacks, timers, or other operations can execute during the blocked periods.

**Why it happens:**
`RtsRoom.tick()` is synchronous by design -- the deterministic tick loop must execute atomically (economy, builds, grid step, integrity, outcome -- see CLAUDE.md tick order). There is no async break point within a tick. Running 500 ticks means 500 synchronous function calls with no yielding.

**Consequences:**
Training is single-threaded and slow. Cannot serve HTTP health checks, cannot collect metrics, cannot respond to shutdown signals during training. If using the same Node.js process for both training and a live server, the server becomes unresponsive during training batches.

**Prevention:**

1. Use `worker_threads` to run headless matches in parallel. Each worker gets its own V8 isolate with its own event loop. The main thread coordinates match assignment and result collection.
2. Use a worker pool (e.g., `piscina` or a simple custom pool) sized to CPU core count minus 1.
3. Each worker runs one match at a time synchronously (tight loop is fine inside a worker -- it does not block the main event loop).
4. Transfer match results back to the main thread via `postMessage` with transferable `ArrayBuffer` objects to avoid copying.
5. NEVER run training matches on the same thread as the live game server.

**Detection:**
Measure event loop delay (via `perf_hooks.monitorEventLoopDelay()`) during a training batch. If p99 exceeds 100ms, matches are blocking the event loop.

**Phase to address:**
Phase 1 (headless match runner architecture).

---

### Pitfall 7: GC pressure from per-tick allocations kills training throughput

**What goes wrong:**
Each `RtsRoom.tick()` allocates: a scratch `Uint8Array` for `Grid.step()` (already pre-allocated, so this is okay), but also creates `BuildOutcome[]`, `DestroyOutcome[]`, `RoomTickResult` objects, `Vector2` objects for placement projection, and potentially `IntegrityMaskCell` arrays for health checks. Over 500 ticks per match and 10,000 matches, this creates millions of short-lived objects. V8's garbage collector triggers mark-sweep pauses that stall training.

**Why it happens:**
The engine was designed for interactive play at 25 ticks/second where allocation rate is manageable. Training runs the engine at maximum speed (thousands of ticks/second), multiplying allocation pressure by 100x. The `Uint8Array` allocation pattern is particularly problematic: V8 allocates typed arrays in external memory, which triggers expensive mark-sweep GC rather than cheap scavenge GC (documented Node.js performance issue #173).

**Consequences:**
Training throughput degrades over time as the Old Space fills with promoted short-lived objects. GC pauses of 50-200ms occur every few seconds, adding 10-30% overhead to total training time.

**Prevention:**

1. Pre-allocate and reuse `RoomTickResult`-like objects in the headless runner. The runner does not need the full `BuildOutcome[]` detail -- it only needs: did the match end? who won? what was the final state?
2. Create a "training tick" variant that returns minimal data: `{ done: boolean, winner: number | null }` rather than full outcome arrays. The full outcome data is only needed for the final tick.
3. Tune V8 GC for training processes: `node --max-semi-space-size=64` increases the young generation size, reducing premature promotion. This can reduce GC overhead by 50%+ for allocation-heavy workloads.
4. Pool `Vector2` objects in hot paths (placement projection). A simple array-based pool avoids creating millions of `{x, y}` objects.
5. Profile with `--prof` or `clinic.js` to identify the actual top allocators before optimizing blindly.

**Detection:**
Run `node --trace-gc` during a training batch. If scavenge frequency exceeds 10/second or mark-sweep occurs more than once per 5 seconds, GC tuning is needed.

**Phase to address:**
Phase 1 (headless match runner) and Phase 3 (training loop performance).

---

## Moderate Pitfalls

### Pitfall 8: Reward shaping teaches the bot to farm economy instead of winning

**What goes wrong:**
The reward function includes per-tick rewards for resource accumulation, structure placement, and territory growth. The bot learns to maximize income by placing generators in safe locations and never attacks. Games go to maximum tick limit. The bot has high reward but terrible win rate in evaluation.

**Why it happens:**
Dense reward shaping is recommended for RL training to provide learning signal before the bot can achieve wins. But shaped rewards create a proxy objective that may not align with the actual objective (winning). Research shows: "agents sometimes overfit to the shaped rewards instead of learning to win -- there is little difference in the shaped return when the sparse (win/loss) return could be drastically different."

In this game specifically, the economy system rewards conservative play: generators produce steady income, blocks extend build radius, and the core has 500 HP. A bot that builds generators and blocks in safe positions earns high shaped rewards while never engaging with the Conway dynamics that determine victory.

**Prevention:**

1. Use sparse win/loss reward as the primary signal: +1 for win, -1 for loss, 0 for draw/timeout.
2. Add a small shaped reward component (10x smaller than win/loss) for strategic milestones: first structure in enemy territory (+0.05), enemy core HP reduced (+0.1 \* damage fraction), own core HP preserved (+0.02 per checkpoint).
3. Penalize timeouts: if the match reaches maximum ticks without resolution, both sides get -0.5 (worse than a loss). This prevents the bot from learning to stall.
4. Track shaped reward and win rate as separate metrics during training. If shaped reward increases but win rate plateaus, the shaped rewards are misaligned.

**Phase to address:**
Phase 2 (reward signal design).

---

### Pitfall 9: Glicko-2 volatility and RD mechanics produce misleading structure ratings

**What goes wrong:**
Structures are rated using Glicko-2 where each "match" is a game where one side used Structure A and the other used Structure B. After 500 games, the Block has a rating of 1600 and the Gosper Glider Gun has 1400. Developers conclude the Block is stronger. In reality, the Block was paired with strong bot policies while the Gosper was paired with weak ones -- the ratings reflect policy strength, not structure strength.

**Why it happens:**
Glicko-2 assumes that the entity being rated is the primary determinant of match outcome. But in an RTS, the outcome depends on: (a) the structure used, (b) all other structures placed, (c) the placement strategy (positions, timing), (d) the opponent's entire strategy. A single scalar rating cannot capture these confounding factors. Additionally, Glicko-2's volatility parameter assumes entity strength changes over time -- structures are static, so volatility introduces noise rather than capturing real changes.

The intransitivity problem is critical: Structure A (defensive walls) beats Structure B (gliders), Structure B beats Structure C (guns), but Structure C beats Structure A. A scalar rating system cannot represent this rock-paper-scissors dynamic. Research confirms: "scenarios such as C > A illustrate the intransitivity of strength relationships, which scalar ratings struggle to model."

**Consequences:**
Balance analysis produces incorrect conclusions. Developers nerf/buff structures based on ratings that reflect bot policy quality rather than structure strength. The game becomes less balanced.

**Prevention:**

1. Rate structures via win-rate matrices, not scalar ratings. For N structure templates, compute an N x N win-rate matrix where entry (i,j) is the win rate of strategies that include structure i against strategies that include structure j.
2. If scalar ratings are required, use Bradley-Terry model instead of Glicko-2. Bradley-Terry does not have time-decay or volatility mechanics that are inappropriate for static entities. It also produces more stable ratings from the same data.
3. Control for confounding: when rating a structure, hold the bot policy constant. Compare games where both sides use the same policy but one side has access to Structure A and the other does not.
4. Report confidence intervals, not point estimates. Glicko-2's RD is useful here -- report the full (rating, RD) pair and flag any structure where RD > 100 as "insufficient data."

**Detection:**
After 500 games, check if any structure's rating has RD > 150 (Glicko-2 scale). If so, more games are needed. Check the win-rate matrix for intransitive cycles. If cycles exist, scalar ratings are misleading.

**Phase to address:**
Phase 5 (structure strength ratings).

---

### Pitfall 10: PPO hyperparameters tuned for other domains fail catastrophically for this game

**What goes wrong:**
Developers use PPO defaults from Stable Baselines 3 or a tutorial (learning rate 3e-4, clip 0.2, 10 epochs per update, batch size 64). Training loss decreases but the policy oscillates: it improves for 100 iterations, then collapses, then partially recovers. After 5,000 iterations the policy is no better than after 500.

**Why it happens:**
PPO is sensitive to hyperparameters. "Good results in RL generally depend on finding appropriate hyperparameters. Don't expect the default ones to work in every environment" (Stable Baselines 3 docs). This game has specific characteristics that interact badly with common defaults:

- **Discrete, large action space**: requires smaller learning rates and more conservative clip values than continuous-action environments.
- **Sparse rewards**: win/loss only at episode end means high variance in advantage estimates; requires larger batch sizes.
- **Long episodes**: 500-tick matches with actions every N ticks means long trajectories; PPO's GAE lambda must be tuned for long horizons.
- **Self-play non-stationarity**: the opponent changes every iteration, making the environment non-stationary from the agent's perspective; too many PPO epochs per update causes overfitting to stale data.

**Consequences:**
Training instability wastes compute. Developers add more shaped rewards to compensate (see Pitfall 8), creating a cascading problem.

**Prevention:**
Start with conservative hyperparameters for this domain:

- Learning rate: 1e-4 (lower than default due to non-stationarity)
- Clip range: 0.1-0.15 (tighter than default 0.2 for stability)
- PPO epochs per update: 3-4 (fewer than default due to self-play non-stationarity)
- Batch size: 2048+ (large to reduce variance from sparse rewards)
- GAE lambda: 0.98 (high for long-horizon episodes)
- Entropy coefficient: 0.01-0.02 (maintain exploration in large action space)
- Discount factor: 0.995-0.999 (long episodes need high discount)

Monitor KL divergence between old and new policies. If KL exceeds 0.05, the learning rate is too high or the clip range is too wide.

**Phase to address:**
Phase 3 (PPO training loop).

---

### Pitfall 11: Glicko-2 rating periods misconfigured for batch training data

**What goes wrong:**
Glicko-2 requires grouping games into "rating periods" where all games in a period are processed together. Developers feed all 10,000 training games as a single rating period. The algorithm processes them as if they all happened simultaneously, losing temporal information. Or they feed games one-by-one as individual rating periods, which causes excessive RD inflation between periods and unstable ratings.

**Why it happens:**
Glicko-2 was designed for human chess players who play 5-10 games per rating period (typically 1-2 weeks). The "rating period" concept maps poorly to batch simulation. If games are generated in batches of 500, should each batch be a period? Each game? The answer matters significantly for rating quality.

Mark Glickman's recommendation: "the typical player is assumed to play at least 5 to 10 games per rating period." When rating structures, each structure "plays" in hundreds of games per batch. Using very short periods causes the RD to inflate unnecessarily between periods; using very long periods loses the ability to detect rating changes.

**Consequences:**
Ratings are either noisy (too-short periods) or unresponsive (too-long periods). The RD values are meaningless because they do not reflect actual uncertainty but rather misconfigured period boundaries.

**Prevention:**

1. For static entities (structures that do not change), use a single rating period containing all games. The Bradley-Terry model is more appropriate here since it processes all data at once without temporal assumptions.
2. If using Glicko-2 for tracking how structure effectiveness changes across bot training iterations, use one rating period per training iteration (e.g., every 100 self-play games). This captures how structure value changes as the meta-strategy evolves.
3. Ensure each structure appears in at least 10 games per rating period. If some structures are rarely selected by the bot, inject forced diversity: in 10% of training games, assign random structure loadouts.

**Phase to address:**
Phase 5 (structure strength ratings).

---

### Pitfall 12: Trained bot model exceeds tick budget when deployed to live game

**What goes wrong:**
The trained PPO policy network has 3 hidden layers of 256 units each. During training, inference takes 2ms per decision. In live gameplay, the bot must make a decision within the tick interval (40ms). But the decision involves: encoding the observation (reading grid state, computing macro-cell densities, gathering economy features), running the forward pass, decoding the action, calling `queueBuildEvent`, and handling the response. Total time exceeds 40ms per tick on the server, causing the tick loop to stall.

**Why it happens:**
During training, the bot's compute time does not matter -- the simulation waits for the bot. In live gameplay, the bot must fit within the server's tick budget alongside all other server operations (Socket.IO broadcasts, hash checkpoints, etc.). Developers benchmark the forward pass in isolation but forget about observation encoding and action decoding overhead.

**Consequences:**
The server tick loop stalls, causing lag for all players in the match. If the bot decision takes 80ms, every other tick is delayed by 40ms, effectively halving the game speed.

**Prevention:**

1. Budget: the bot's total decision time (observe + infer + act) must be under 10ms to leave 30ms headroom for engine tick and network I/O.
2. Use a small network: 2 hidden layers of 64-128 units. For this game's complexity, a larger network provides diminishing returns.
3. Pre-compute observation features between ticks rather than assembling them on-demand. Cache the macro-cell density map and update it incrementally after each grid step.
4. The bot does NOT need to make a decision every tick. Decide every 5-10 ticks (200-400ms real time). The engine tick loop runs without bot involvement between decision points.
5. Run the bot's inference in a separate `worker_thread` that communicates decisions asynchronously. The main server thread continues the tick loop; bot actions are queued via `postMessage` and applied at the next decision tick.

**Detection:**
Benchmark the full observation-encode -> inference -> action-decode pipeline in isolation. If it exceeds 5ms for a single decision, the network is too large or the observation encoding is too expensive.

**Phase to address:**
Phase 6 (playable in-game bot) -- but the network architecture decision in Phase 3 determines feasibility.

---

### Pitfall 13: In-game bot Socket.IO adapter introduces non-determinism by injecting actions at wrong tick

**What goes wrong:**
The Socket.IO adapter for the in-game bot receives game state via socket events, computes an action, and emits it back. Due to network event loop scheduling, the action arrives at the server one tick after the bot computed it. The server queues the action for tick T+delay, but the bot computed it based on tick T-1 state. In lockstep mode, this means the bot's action is applied against a different state than it was computed for. While this does not break determinism (the server validates and queues correctly), it causes the bot to make suboptimal decisions because it is always acting on stale state.

**Why it happens:**
In lockstep mode, the server broadcasts input events and the bot must respond within the same tick window. But Socket.IO event delivery is asynchronous -- the bot receives tick T's state, processes it, emits an action, and the action arrives at the server during tick T+1 or T+2. Human players have the same latency, but the bot was trained in a zero-latency environment where actions were applied to the tick they were computed for.

**Consequences:**
The bot performs significantly worse in live play than in training. Actions that were optimal at tick T are suboptimal at tick T+2. Build placements that would succeed at tick T are rejected at tick T+2 because the grid state has changed (Conway evolution altered the territory). The bot's effective skill level drops by 100-300 Elo equivalent.

**Prevention:**

1. During training (Phase 3), add a configurable action delay (1-3 ticks) so the bot learns to account for latency. Train with delay=2 so the bot's policy is robust to stale observations.
2. In the Socket.IO adapter, use the server-side bot integration pattern: the bot runs as a "virtual player" in the same process as the server, calling `room.queueBuildEvent()` directly rather than going through Socket.IO. This eliminates network latency entirely.
3. If the bot must use Socket.IO (for testing or fairness), have it compute actions based on predicted future state (current state + 2 Conway steps) rather than current state. This requires running `Grid.step()` twice in the bot's observation encoder, which is cheap for a single grid.

**Detection:**
Compare bot win rate in headless mode (zero latency) vs. Socket.IO mode. If the delta exceeds 10 percentage points, latency compensation is needed.

**Phase to address:**
Phase 6 (Socket.IO adapter) and Phase 3 (training with action delay).

---

## Minor Pitfalls

### Pitfall 14: Training data not reproducible due to unseeded randomness

**What goes wrong:**
Training results vary between runs. A configuration that produced 60% win rate yesterday produces 45% today. Developers cannot debug training failures because they cannot reproduce them.

**Prevention:**
Seed ALL randomness: `Math.random()` replacement (use a seeded PRNG like `mulberry32`), spawn position orientation (`spawnOrientationSeed` already exists -- use it consistently), action exploration noise in PPO, opponent selection from the policy pool. Pass a master seed to the training runner that derives all sub-seeds deterministically.

**Phase to address:**
Phase 1 (headless match runner) and Phase 3 (training loop).

---

### Pitfall 15: Balance analysis sample sizes too small for statistical significance

**What goes wrong:**
After 100 self-play games, the report says "Glider has 55% win rate, Block has 45% win rate." Developers conclude Glider is stronger. But with 100 games, the 95% confidence interval for a 55% win rate is [45%, 65%] -- the difference is not statistically significant.

**Prevention:**
Use proper statistical testing for balance claims. For a two-sided proportion test with alpha=0.05 and power=0.8, detecting a 5% win rate difference (52.5% vs 47.5%) requires ~1,600 games per matchup. Detecting a 10% difference requires ~400 games. Report confidence intervals with every win rate statistic. Do not claim balance differences without p < 0.05.

**Phase to address:**
Phase 4 (balance analysis).

---

### Pitfall 16: Structure combo ratings produce combinatorial explosion

**What goes wrong:**
With 6 structure templates, there are 2^6 - 1 = 63 possible structure combinations. Rating each combination via Glicko-2 requires sufficient games for each combo. With 63 combos, the pairwise matchup matrix has 63 \* 62 / 2 = 1,953 entries. Getting 100 games per entry requires 195,300 games. Training at 5 matches/second takes 10+ hours just for rating convergence.

**Prevention:**

1. Rate individual structures, not combinations. Use a linear model: combo strength = sum of individual structure strengths + interaction terms for known synergies.
2. If combo ratings are essential, limit to top-K combos observed in self-play (typically 5-10 dominant combos emerge). Rate only those.
3. Use Bayesian methods that share information across similar combos (hierarchical model) rather than rating each independently.

**Phase to address:**
Phase 5 (structure strength ratings).

---

### Pitfall 17: `RtsRoom.fromState` WeakMap runtime not preserved across worker thread boundaries

**What goes wrong:**
The headless match runner uses worker threads. The main thread creates an `RtsRoom` and tries to send it to a worker via `postMessage`. The `RoomState` object arrives in the worker, but the `WeakMap`-backed runtime (which stores `templateMap`, room dimensions, and counters) is not transferred. Calling `RtsRoom.fromState(state)` in the worker throws `"RoomState must come from RtsEngine.createRoomState or RtsEngine.createRoom"`.

**Why it happens:**
`WeakMap` entries are not serializable. `postMessage` uses the structured clone algorithm, which does not preserve `WeakMap` associations. The `roomRuntimeByState` WeakMap in `room-runtime.ts` is per-isolate -- it exists only in the thread that created it.

**Prevention:**
Each worker must create its own `RtsRoom` via `RtsRoom.create()` or `RtsRoom.fromPayload()`. Do not attempt to transfer `RtsRoom` instances between threads. Send configuration (room options, player info) to the worker and let it construct the room locally. This is consistent with how the existing codebase handles room reconstruction from payloads.

**Phase to address:**
Phase 1 (headless match runner with worker threads).

---

## Phase-Specific Warnings

| Phase Topic                | Likely Pitfall                                                                 | Mitigation                                                                     |
| -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Phase 1: Headless runner   | Event loop blocking (P6), WeakMap serialization (P17), Grid performance (P2)   | Worker thread pool, create rooms in-worker, profile before optimizing          |
| Phase 2: Obs/Action design | Raw grid observation (P4), no action masking (P5)                              | Engineered features at reduced resolution, coarse-then-fine action mask        |
| Phase 3: PPO training      | Mode collapse (P3), hyperparameter sensitivity (P10), reward misalignment (P8) | Opponent pool, conservative hyperparameters, sparse primary reward             |
| Phase 4: Balance analysis  | Sample size (P15), self-play bias (P3)                                         | Statistical significance tests, diverse opponent pool for evaluation           |
| Phase 5: Structure ratings | Glicko-2 misapplication (P9), rating periods (P11), combo explosion (P16)      | Bradley-Terry over Glicko-2, hold policy constant, rate individuals not combos |
| Phase 6: In-game bot       | Tick budget (P12), latency mismatch (P13), validation bypass (P1)              | Small network, server-side integration, action delay in training               |

---

## "Looks Done But Isn't" Checklist

- [ ] **Bot validation integrity**: Bot actions flow through `RtsRoom.queueBuildEvent()` / `queueDestroyEvent()` -- verified by logging rejection rates during training (should be 10-30%, not 0% and not 90%).
- [ ] **Training throughput**: 100 complete 500-tick matches finish in under 30 seconds on a single core -- measured before training begins.
- [ ] **Observation sanity**: Agent's win rate exceeds 55% against random play within 500 training iterations -- if not, observation/action design is broken.
- [ ] **Reward alignment**: Shaped reward and sparse win rate move in the same direction over training -- tracked on the same plot.
- [ ] **Self-play diversity**: At least 3 distinct structure templates appear in the top-10 most-played games at every point in training -- monitored continuously.
- [ ] **Rating convergence**: All rated structures have Glicko-2 RD < 100 (or Bradley-Terry CI width < 10%) before balance conclusions are drawn.
- [ ] **Live bot latency**: Full observe-infer-act cycle completes in < 10ms per decision -- benchmarked in the Socket.IO adapter.
- [ ] **Reproducibility**: Two training runs with the same seed produce identical match outcomes for the first 100 games -- verified with hash comparison.
- [ ] **Worker isolation**: Headless matches in worker threads produce identical results to single-threaded execution -- verified by running the same seeded match in both modes and comparing final state hashes.

---

## Technical Debt Patterns

| Shortcut                                                         | Immediate Benefit         | Long-term Cost                                | When Acceptable                                                             |
| ---------------------------------------------------------------- | ------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| Bot calls `Grid.setCell()` directly instead of `queueBuildEvent` | 10x faster training       | Trained model is useless in live play         | Never                                                                       |
| Raw 52x52 grid as observation                                    | Simple implementation     | Agent cannot learn; wasted compute            | Never                                                                       |
| Negative rewards for invalid actions instead of masking          | Simple implementation     | 10-100x slower convergence                    | Never                                                                       |
| Single-threaded training (no workers)                            | Simple implementation     | Training takes days instead of hours          | Only for initial debugging (<100 games)                                     |
| Glicko-2 for static entity ratings                               | Familiar algorithm        | Volatility/RD mechanics introduce noise       | Only if treating as "good enough" approximation with documented limitations |
| Bot makes decisions every tick                                   | Maximum responsiveness    | Exceeds tick budget; wastes inference compute | Never; decide every 5-10 ticks                                              |
| Self-play with only latest policy                                | Simple opponent selection | Mode collapse; brittle policy                 | Only for first 100 iterations to establish baseline                         |

---

## Sources

- [HIGH confidence] Codebase audit: `packages/rts-engine/rts.ts` -- tick order, `RtsRoom.tick()`, `queueBuildEvent()`, `queueDestroyEvent()`, validation pipeline, `RoomTickResult` structure.
- [HIGH confidence] Codebase audit: `packages/conway-core/grid.ts` -- `Grid.step()` implementation, `Uint8Array` allocation pattern, `toPacked()`/`fromPacked()` methods, torus topology.
- [HIGH confidence] Codebase audit: `packages/rts-engine/structure.ts` -- template definitions (Block, Generator, Glider, Eater, Gosper), activation costs, build radii.
- [HIGH confidence] Codebase audit: `packages/rts-engine/room-runtime.ts` -- `WeakMap`-backed runtime, `INVALID_ROOM_STATE_ERROR_MESSAGE`, non-serializable state.
- [HIGH confidence] Codebase audit: `packages/rts-engine/gameplay-rules.ts` -- `INTEGRITY_CHECK_INTERVAL_TICKS=4`, `DEFAULT_QUEUE_DELAY_TICKS=10`, `DEFAULT_STARTING_RESOURCES=40`.
- [MEDIUM confidence] [Exploring the Use of Invalid Action Masking in RL: RTS Games](https://www.mdpi.com/2076-3417/13/14/8283) -- PPO without action masking fails to achieve any win rates in RTS; with masking reaches 82%+.
- [MEDIUM confidence] [Gym-uRTS: Toward Affordable Full Game RL](https://arxiv.org/pdf/2105.13807v3) -- observation encoding as (h, w, n_f) tensor, action masking implementation for RTS.
- [MEDIUM confidence] [Survey of Self-Play in RL](https://arxiv.org/pdf/2107.02850) -- self-play training is unstable and sample-inefficient; population-based approaches mitigate collapse.
- [MEDIUM confidence] [Simulation-Driven Balancing with RL](https://arxiv.org/html/2503.18748v1) -- decomposed architecture converges faster; millions of steps needed for balance convergence.
- [MEDIUM confidence] [Stable Baselines 3 Tips and Tricks](https://stable-baselines3.readthedocs.io/en/master/guide/rl_tips.html) -- hyperparameter sensitivity, input normalization, environment-specific tuning required.
- [MEDIUM confidence] [Glicko-2 Practical Pitfalls](https://gist.github.com/gpluscb/302d6b71a8d0fe9f4350d45bc828f802) -- volatility farming, counter-intuitive rating changes, non-conservation, RD mechanics.
- [MEDIUM confidence] [Reward design and hyperparameter tuning for RL agents](https://www.nature.com/articles/s41598-025-27702-6) -- PPO with optimized hyperparameters (batch=128, lr=0.0003, gamma=0.99, entropy=0.01).
- [MEDIUM confidence] [Node.js Buffer/Uint8Array GC issues](https://github.com/nodejs/performance/issues/173) -- typed arrays in external memory trigger mark-sweep; `--max-semi-space-size` tuning.
- [MEDIUM confidence] [Piscina worker thread pool](https://github.com/piscinajs/piscina) -- efficient worker pool pattern for CPU-intensive tasks.
- [LOW confidence] [Conway's Game of Life RL Agent](https://github.com/lkwilson/Conways-Game-Of-Life-AI) -- RL agent on Conway grid "typically generated still-life and avoided interacting"; raw grid observations insufficient.
- [LOW confidence] [Online Learning of Counter Categories in PvP Games](https://arxiv.org/html/2502.03998) -- intransitivity in game balance; Neural Rating Tables for non-transitive relationships.
- [LOW confidence] [The Choice of Divergence for Mitigating Diversity Collapse](https://arxiv.org/html/2509.07430v1) -- mode-covering divergences prevent diversity collapse in RL training.

---

_Pitfalls research for: Conway RTS v0.0.4 RL Bot Harness & Balance Analysis_
_Researched: 2026-03-30_
