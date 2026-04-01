# Phase 20: PPO Training with Self-Play - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

PPO training pipeline producing policies that demonstrably improve over random play, using self-play with a historical opponent pool across parallel worker threads. This phase delivers the PPO training loop, self-play opponent pool, training CLI, and worker thread parallelization inside `packages/bot-harness`. It does NOT include balance analysis (Phase 21+), structure ratings (Phase 22), or the live game bot adapter (Phase 23).

</domain>

<decisions>
## Implementation Decisions

### Network Architecture
- **D-01:** Small CNN + MLP head. 2-3 conv layers on the spatial feature planes (from Phase 19's multi-channel 2D observation), flatten + concatenate with scalar features, shared MLP trunk, separate policy head (action logits) and value head (state value scalar).
- **D-02:** Shared trunk with separate heads — standard PPO approach. Game complexity is moderate (~32K obs dimensions, ~5K actions, 80×80 grid). Shared parameters are efficient; separate networks would double CPU cost with no representational benefit.
- **D-03:** Layer sizes are **configurable** via CLI flags (conv filter counts, MLP widths). Allows experimentation without code changes.
- **D-04:** Checkpoints saved in TF.js SavedModel format (tf.io.fileSystem handler — JSON topology + binary weights). Native TF.js format, loadable without conversion.

### Self-Play Opponent Pool
- **D-05:** Configurable three-way ratio mix for opponent sampling: latest checkpoint, random historical checkpoint, pure random bot. Default e.g. 50% latest / 30% historical / 20% random. Prevents mode collapse while maintaining pressure from strong opponents.
- **D-06:** New checkpoints added to pool every N episodes (e.g., every 50 or 100). Simple periodic cadence, configurable.
- **D-07:** Pool capped with FIFO eviction of oldest checkpoints. Max pool size configurable (e.g., 20-50). Bounds disk usage and keeps pool relevant to current training frontier.
- **D-08:** Pool seeded with RandomBot + NoOpBot from Phase 18. Training starts with diverse opponents from episode 0. The 'random' slot in the ratio mix uses these built-in bots directly.

### Training CLI & Config
- **D-09:** Live metrics to stdout (episode count, win rate vs pool, loss values, ETA) + structured NDJSON training log file (episode, reward, loss, win_rate, opponent) for post-hoc analysis.
- **D-10:** Run output: `runs/<run-id>/` directory containing config.json, training-log.ndjson, checkpoints/, final-model/. Run ID includes timestamp. Consistent with Phase 18's `matches/<run-id>/` pattern.
- **D-11:** Resume support: `--resume <run-id>` loads latest checkpoint, optimizer state, and episode count. Continues training from where it left off. Essential for long runs.
- **D-12:** TF.js decision gate: start with `@tensorflow/tfjs-node`. If a benchmark run (e.g., 1000 episodes) takes >8 hours wall clock, document and defer to Python/SB3. Per STATE.md decision.

### Worker Parallelism
- **D-13:** `@tensorflow/tfjs-node` backend (native TensorFlow C lib with Eigen multi-threading). Auto-parallelizes gradient ops across ~4-16 cores during PPO update phase. Required for acceptable CPU training speed.
- **D-14:** Actor-learner split: worker threads collect episodes (match simulation + inference with frozen policy weights). Main thread runs PPO gradient updates (Eigen parallelizes internally via native threads). The two phases naturally time-share CPU cores.
- **D-15:** Configurable worker count via `--workers` flag. Default: auto-detect available cores - 2. During collection, workers use all cores; during PPO update, Eigen's native threads use the idle cores. Target machine: 48 cores.
- **D-16:** Configurable episodes per collection round. Default: workers × 4 episodes. Larger batches amortize PPO update idle time and give Eigen more data to parallelize over. Configurable via `--batch-episodes`.
- **D-17:** Weight sync via postMessage with transferable Float32Arrays. Infrequent (once per PPO batch), negligible cost vs episode collection time. Workers load weights into local tfjs-node model.

### Claude's Discretion
- Exact default layer sizes (conv filter counts, MLP widths)
- PPO hyperparameter defaults (learning rate, clip epsilon, gamma, GAE lambda, number of PPO epochs per update)
- Default opponent pool sampling ratios and checkpoint promotion interval
- Default max pool size
- Default episodes per collection round multiplier
- Exact CLI flag names and help text
- GAE (Generalized Advantage Estimation) implementation details
- Entropy bonus coefficient
- Training log NDJSON field names
- How workers handle tfjs-node initialization (each worker loads its own tfjs-node instance)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 18-19 Context (Foundation)
- `.planning/phases/18-headless-match-runner/18-CONTEXT.md` — BotStrategy interface, match runner API, bot-harness package structure, NDJSON logging
- `.planning/phases/19-observation-action-and-reward-interface/19-CONTEXT.md` — ObservationEncoder, ActionDecoder, RewardSignal, BotEnvironment (reset/step), observation_space/action_space metadata, Float32Array format

### RTS Engine (Match Simulation)
- `packages/rts-engine/rts.ts` — `RtsRoom` class, `RoomState`, `RoomTickResult`, match lifecycle
- `packages/rts-engine/match-lifecycle.ts` — `MatchOutcome`, `TeamOutcomeSnapshot`

### Bot Harness (Phase 18-19 delivers)
- `packages/bot-harness/` — BotStrategy, RandomBot, NoOpBot, HeadlessMatchRunner, BotEnvironment, ObservationEncoder, ActionDecoder, RewardSignal

### Requirements
- `.planning/REQUIREMENTS.md` — TRAIN-01 (PPO loop), TRAIN-02 (self-play pool), TRAIN-03 (training CLI), TRAIN-04 (worker parallelism)

### Project Decisions
- `.planning/STATE.md` — "v0.0.4: TypeScript-native training via @tensorflow/tfjs (pure JS CPU backend) as default; decision gate in Phase 20 if throughput exceeds 8 hours"

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phases 18-19, not yet built)
- `BotEnvironment.reset()` / `.step(action)` — Gymnasium-style API that Phase 20's training loop consumes
- `observation_space` / `action_space` metadata — directly configures the neural network input/output shapes
- `HeadlessMatchRunner` — match execution without Socket.IO, reusable for episode collection workers
- `RandomBot` / `NoOpBot` — seed the opponent pool
- `RewardSignal` with per-component weights and linear annealing — consumed by the training loop

### Established Patterns
- `packages/bot-harness` is the home package for all v0.0.4 code
- Flat `Float32Array` observations wrap into `tf.tensor` at training time (Phase 19 D-04)
- Match runner with callbacks (Phase 18 D-12) — workers can report progress
- Sequential → parallel progression: Phase 18 sequential, Phase 20 adds worker_threads

### Integration Points
- Training loop creates `BotEnvironment` per worker, calls `reset()` / `step(action)` to collect trajectories
- `observation_space.shape` → configures CNN input layer dimensions
- `action_space.n` → configures policy head output dimension
- Checkpoints saved as TF.js SavedModel → loadable by Phase 23's live bot adapter
- NDJSON training log → consumable by Phase 21's balance analysis

### New Dependencies
- `@tensorflow/tfjs-node` — native TF.js backend with Eigen multi-threading (NOT pure JS `@tensorflow/tfjs`)
- Node.js `worker_threads` — for parallel episode collection

</code_context>

<specifics>
## Specific Ideas

- Target machine has 48 CPU cores — worker count should default to auto-detect, with diminishing returns expected around 16-32 workers for this game's model size.
- Two-phase CPU usage pattern: during collection, worker_threads use all cores for match sim + inference. During PPO update, Eigen's native threads use idle cores for gradient ops. These phases don't compete.
- The 8-hour decision gate for TF.js vs Python/SB3 should be a documented benchmark early in Phase 20 development, not discovered late.
- Success criterion #5 (trained policy beats random) is the key validation gate — if PPO isn't converging, everything downstream breaks.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 20-ppo-training-with-self-play*
*Context gathered: 2026-04-01*
