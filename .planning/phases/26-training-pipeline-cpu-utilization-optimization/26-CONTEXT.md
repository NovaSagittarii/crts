# Phase 26: Training Pipeline CPU Utilization Optimization - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Restructure the training coordinator's generation loop to maximize CPU utilization by overlapping episode collection with PPO gradient updates and I/O operations. Workers should never sit idle waiting for the main thread to finish gradient descent, checkpointing, or weight serialization.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All optimization decisions are at Claude's discretion. User directive: "focus on speed without compromising correctness." Key constraints:

- **Correctness first:** PPO updates must use trajectories collected under the correct policy weights. Stale-by-one-generation weights in workers are acceptable (standard in async PPO) but stale-by-two is not.
- **Double-buffering:** Workers should begin collecting the next batch while main thread runs PPO update on the current batch. The exact mechanism (pre-fetch, pipeline stages, async dispatch) is Claude's choice.
- **Weight broadcast:** Timing and method for sending updated weights to workers is Claude's choice. Overlapping broadcast with late-finishing workers from the previous batch is encouraged.
- **I/O overlap:** Checkpointing, NDJSON logging, and model saving should overlap with episode collection where possible.
- **Measurement:** Include a built-in throughput metric (episodes/sec, CPU utilization %) so improvement is quantifiable. Method is Claude's choice.
- **Backward compatibility:** `onProgress`, `togglePause`, `requestStop` callbacks must continue to work. TUI dashboard integration must not break.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Training Coordinator
- `packages/bot-harness/training/training-coordinator.ts` — The main file to optimize. Contains the synchronous generation loop (run method), collectBatch, broadcastWeights, spawnWorkers, runWorkerQueue.
- `packages/bot-harness/training/training-worker.ts` — Worker thread entry point. Message protocol: init, set-weights, collect-episode, terminate.
- `packages/bot-harness/training/training-coordinator.test.ts` — Existing integration tests that must continue passing.

### Dependencies
- `packages/bot-harness/training/ppo-trainer.ts` — PPOTrainer.update() runs gradient descent (the main CPU-heavy main-thread operation during worker idle time).
- `packages/bot-harness/training/trajectory-buffer.ts` — TrajectoryBuffer.finalize() computes GAE (another main-thread operation during idle time).
- `packages/bot-harness/training/ppo-network.ts` — extractWeights/applyWeights for weight serialization.
- `packages/bot-harness/training/opponent-pool.ts` — saveCheckpoint for I/O during idle time.

</canonical_refs>

<code_context>
## Existing Code Insights

### Current Bottleneck Pattern
The run() loop in training-coordinator.ts is fully synchronous per generation:
1. extractWeights — main thread, workers IDLE
2. broadcastWeights — main thread sends, workers rebuild model
3. collectBatch — workers RUN, main thread IDLE
4. deserialize trajectories — main thread, workers IDLE
5. GAE finalize — main thread, workers IDLE
6. PPO update — main thread (multi-epoch gradient descent), workers IDLE ← BIGGEST gap
7. log metrics — main thread I/O, workers IDLE
8. checkpoint save — main thread disk I/O, workers IDLE

Steps 4-8 are the primary optimization target. Workers should be collecting the next batch during these steps.

### Integration Points
- `bin/train.ts` — Sets up coordinator and calls `coordinator.run()`. Should not need changes.
- `packages/bot-harness/training/tui/` — Dashboard receives `onProgress` callbacks. Must continue to receive per-episode updates.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — optimize based on profiling and bottleneck analysis.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 26-training-pipeline-cpu-utilization-optimization*
*Context gathered: 2026-04-03*
