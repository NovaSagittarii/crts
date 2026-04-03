# Phase 26: Training Pipeline CPU Utilization Optimization - Research

**Researched:** 2026-04-01
**Domain:** Node.js worker_threads pipeline optimization, async PPO actor-learner overlap
**Confidence:** HIGH

## Summary

The training coordinator (`training-coordinator.ts`) currently runs a fully synchronous generation loop where workers sit idle during PPO gradient descent (the single biggest idle window), trajectory deserialization, GAE computation, logging, and checkpointing. The optimization goal is to restructure this into a double-buffered pipeline where workers begin collecting the next batch of episodes while the main thread processes the current batch.

The codebase is well-structured for this refactor. The key insight is that the `run()` method's steps 4-8 (deserialize, GAE, PPO update, log, checkpoint) are pure main-thread operations that do not touch workers at all. Meanwhile `collectBatch()` (step 3) is a pure worker operation where the main thread only awaits results. These two workloads can overlap perfectly by launching the next batch's `collectBatch()` before starting the current batch's processing, then awaiting it only when processing is complete.

**Primary recommendation:** Restructure the `run()` loop into a pipelined design where `collectBatch(gen+1)` runs concurrently with `processCurrentBatch(gen)`, using a simple Promise-based overlap pattern. No new libraries needed -- this is a pure control-flow restructuring using native `Promise` and `worker_threads` APIs already in use.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all optimization decisions are at Claude's discretion.

### Claude's Discretion
All optimization decisions are at Claude's discretion. User directive: "focus on speed without compromising correctness." Key constraints:

- **Correctness first:** PPO updates must use trajectories collected under the correct policy weights. Stale-by-one-generation weights in workers are acceptable (standard in async PPO) but stale-by-two is not.
- **Double-buffering:** Workers should begin collecting the next batch while main thread runs PPO update on the current batch. The exact mechanism (pre-fetch, pipeline stages, async dispatch) is Claude's choice.
- **Weight broadcast:** Timing and method for sending updated weights to workers is Claude's choice. Overlapping broadcast with late-finishing workers from the previous batch is encouraged.
- **I/O overlap:** Checkpointing, NDJSON logging, and model saving should overlap with episode collection where possible.
- **Measurement:** Include a built-in throughput metric (episodes/sec, CPU utilization %) so improvement is quantifiable. Method is Claude's choice.
- **Backward compatibility:** `onProgress`, `togglePause`, `requestStop` callbacks must continue to work. TUI dashboard integration must not break.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:worker_threads` | (Node 24.13.0 built-in) | Worker thread management | Already used for episode collection |
| `node:perf_hooks` | (Node 24.13.0 built-in) | Performance timing via `performance.now()` | Sub-millisecond precision, monotonic clock |
| `node:os` | (Node 24.13.0 built-in) | `cpus()` for CPU count | Already used for worker count auto-detect |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `process.cpuUsage()` | (Node built-in) | Main thread CPU time (user + system microseconds) | For CPU utilization % measurement on main thread |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual Promise overlap | SharedArrayBuffer + Atomics | SharedArrayBuffer requires more complex synchronization; overkill for this use case where Promise-based coordination suffices |
| `performance.eventLoopUtilization()` | `process.cpuUsage()` | ELU measures event loop saturation, not CPU utilization; misleading for CPU-bound TF.js work that blocks the event loop |
| External queue library (bull, etc.) | Native Promises | Adding a dependency for what is a simple two-stage pipeline is unjustified overhead |

**Installation:**
```bash
# No new packages needed -- all dependencies are Node.js built-ins
```

## Architecture Patterns

### Current Synchronous Pipeline (BEFORE)
```
Generation N:
  [extractWeights] -> [broadcastWeights] -> [collectBatch] -> [deserialize] -> [GAE] -> [PPO update] -> [log] -> [checkpoint]
  main              main                  WORKERS RUN       main            main      main (BIG)      main     main
                                          main IDLE
```

### Target Double-Buffered Pipeline (AFTER)
```
Gen 0:
  [extractWeights] -> [broadcastWeights] -> [collectBatch_0] -> [processCurrentBatch_0 + START collectBatch_1] -> ...

Gen N (steady state):
  [AWAIT collectBatch_N] -> [processCurrentBatch_N + START collectBatch_N+1] -> ...

  Where processCurrentBatch includes:
    deserialize, GAE, PPO update, log metrics, checkpoint, extractWeights, broadcastWeights
    (all main-thread work while workers collect next batch)
```

### Pattern 1: Promise-Based Double Buffering
**What:** Launch the next batch collection as a detached Promise before processing the current batch. Await the next-batch Promise only after current-batch processing completes.
**When to use:** When two workloads are independent (workers vs main thread) and can overlap.
**Example:**
```typescript
// Pseudocode for the restructured run() loop
async run(): Promise<void> {
  // -- Bootstrap: first generation is fully synchronous --
  const weights0 = extractWeights(this.model);
  await this.broadcastWeights(weights0);
  let currentBatchPromise = this.collectBatch(batchSize);
  let currentResults = await currentBatchPromise;

  while (hasMoreEpisodes) {
    // (1) Start next batch collection (workers run in background)
    //     Workers still have the CURRENT generation's weights
    //     (stale-by-one is acceptable per CONTEXT.md)
    const nextBatchPromise = this.startNextBatchCollection();

    // (2) Process current batch on main thread
    //     (deserialize, GAE, PPO update, log, checkpoint)
    //     This runs concurrently with workers collecting next batch
    this.processCurrentBatch(currentResults);

    // (3) Extract new weights and prepare for broadcast
    const newWeights = extractWeights(this.model);

    // (4) Await next batch completion
    const nextResults = await nextBatchPromise;

    // (5) Broadcast new weights (overlaps with any late-finishing workers)
    await this.broadcastWeights(newWeights);

    currentResults = nextResults;
  }
}
```

### Pattern 2: Weight Broadcast Overlap with Late Workers
**What:** Begin broadcasting updated weights to workers that have already finished their episodes, while still awaiting late-finishing workers from the current batch. Workers that finish their episode receive the weight update immediately.
**When to use:** When workers finish at different times and we want to minimize idle time on fast workers.
**Example:**
```typescript
// When starting next batch, workers already have weights from
// the previous generation. This is acceptable (stale-by-one).
// After PPO update completes, we extract new weights and broadcast.
// Workers that finished early and are idle receive weights immediately.
// Workers still running finish their episode with old weights (acceptable).
```

### Pattern 3: Fire-and-Forget I/O
**What:** Run logging and checkpointing as non-blocking Promises that are not awaited until the next convenient synchronization point.
**When to use:** For disk I/O (NDJSON append, checkpoint save) that does not block the pipeline's critical path.
**Example:**
```typescript
// Instead of:
await this.logger.logEpisode(entry);       // blocks
await this.opponentPool.saveCheckpoint(model, ep);  // blocks

// Use:
const pendingIO: Promise<void>[] = [];
pendingIO.push(this.logger.logEpisode(entry));     // non-blocking
pendingIO.push(this.opponentPool.saveCheckpoint(model, ep));
// Await at end of generation or at next safe point:
await Promise.all(pendingIO);
```

### Pattern 4: Throughput Metrics via Stage Timing
**What:** Measure wall-clock time for each pipeline stage using `performance.now()`, compute episodes/sec, and report CPU utilization as fraction of wall time spent doing useful work vs idle.
**When to use:** Always -- this is the measurement mechanism for success criteria 3 and 4.
**Example:**
```typescript
interface GenerationMetrics {
  collectMs: number;    // Wall time for episode collection
  processMs: number;    // Wall time for main-thread processing (deser + GAE + PPO)
  overlapMs: number;    // Time saved by overlapping
  episodesPerSec: number;
  mainThreadUtilization: number; // processMs / totalGenerationMs
}
```

### Anti-Patterns to Avoid
- **Awaiting collectBatch before starting processing:** This is the current synchronous pattern. The entire point of the refactor is to NOT await the next batch until processing is done.
- **Stale-by-two weights:** Workers must never be more than one generation behind. The pipeline design ensures workers always receive weights from generation N before collecting episodes for generation N+1 or N+2.
- **Blocking main thread on I/O during PPO:** Checkpoint saving and NDJSON logging should not block the PPO update path. Use fire-and-forget with error collection.
- **Breaking onProgress callback ordering:** The TUI dashboard expects per-episode callbacks in order. Even with pipelining, `onProgress` must be called with correct episode numbers.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pipeline stage timing | Custom Date.now() math | `performance.now()` from `node:perf_hooks` | Monotonic, sub-ms precision, not affected by system clock changes |
| CPU utilization % | Manual thread polling | `process.cpuUsage()` diffs over measured intervals | Built-in, microsecond precision, returns user + system time |
| Promise-based concurrency | Custom event emitter pipeline | Native Promise + Promise.all | The pattern is simple two-stage; no framework needed |
| Worker message protocol | New message types beyond existing | Extend existing `WorkerMessage` union | The existing init/set-weights/collect-episode/terminate protocol is sufficient |

**Key insight:** This optimization is primarily a control-flow restructuring of the `run()` method. The worker protocol, PPO trainer, trajectory buffer, and opponent pool do not need modification. The complexity is in getting the pipeline stages right without introducing correctness bugs (stale weights, misordered callbacks, race conditions in shared state).

## Common Pitfalls

### Pitfall 1: Stale-by-Two Weight Violation
**What goes wrong:** If the pipeline runs too aggressively, workers could collect episodes using weights from generation N-2 instead of N-1, violating the correctness constraint.
**Why it happens:** Starting a new batch before broadcasting updated weights from the most recent PPO update.
**How to avoid:** Ensure the pipeline invariant: workers receive weights from generation N before collecting episodes that will be used for PPO update in generation N+1. In the double-buffer design, workers collect with N-1 weights (one gen stale = acceptable).
**Warning signs:** Episodes collected with weights that are 2+ PPO updates behind, causing training instability.

### Pitfall 2: Race Condition in Worker Message Handlers
**What goes wrong:** If `set-weights` and `collect-episode` messages arrive at a worker simultaneously, the worker might start collecting with old weights.
**Why it happens:** The worker's message handler is async (`void (async () => { ... })()`), so messages are processed via microtask queue. A `set-weights` followed immediately by `collect-episode` could interleave.
**How to avoid:** The current protocol already handles this correctly -- `broadcastWeights()` awaits `weights-applied` from all workers before any `collect-episode` can be sent. The pipeline must preserve this ordering for each generation's first batch.
**Warning signs:** Workers reporting episode results with unexpected weight checksums.

### Pitfall 3: onProgress Callback Misordering
**What goes wrong:** If two batches are being processed concurrently (current + next), `onProgress` callbacks could fire out of order, confusing the TUI dashboard.
**Why it happens:** Processing and logging happen for the current batch while the next batch is being collected. If the next batch finishes first and both try to call `onProgress`, order is broken.
**How to avoid:** Only the current batch's processing calls `onProgress`. The next batch's processing waits until the current batch is fully logged. The pipeline is only two stages deep, so at most one batch is being processed at any time.
**Warning signs:** TUI showing decreasing episode numbers, duplicate entries, or missing episodes.

### Pitfall 4: Memory Pressure from Double Buffering
**What goes wrong:** Holding two full batches of trajectory data in memory simultaneously (current being processed + next being collected) doubles peak memory usage.
**Why it happens:** Each batch contains Float32Array planes, scalars, action masks for every step of every episode. With large grids and long episodes, this adds up.
**How to avoid:** Clear the current batch's trajectory data (`buffer.clear()`) as soon as PPO update completes, before the next batch's data arrives. Monitor memory with `process.memoryUsage()` if needed. For typical configurations (15x15 grid, 100-tick episodes, 8-16 batch episodes), this is not a concern.
**Warning signs:** Node.js heap growing linearly per generation, eventual OOM.

### Pitfall 5: Error Propagation from Background Promises
**What goes wrong:** If a detached `collectBatch()` Promise rejects (worker crash, OOM), the error is lost because nothing is awaiting it at the time of rejection.
**Why it happens:** The Promise is created at the start of processing but awaited later. If it rejects before being awaited, Node.js may flag an unhandled rejection.
**How to avoid:** Attach a `.catch()` handler immediately to the background Promise to capture errors, then re-throw when the Promise is finally awaited. Or use a wrapper that stores errors and checks them at await time.
**Warning signs:** `UnhandledPromiseRejection` warnings in Node.js output.

### Pitfall 6: Pause/Stop During Pipeline Transition
**What goes wrong:** If `togglePause()` or `requestStop()` is called while a background batch is being collected, the coordinator might hang waiting for workers or skip the pause entirely.
**Why it happens:** The pause check is currently at the top of the loop. With pipelining, there are new points where pause/stop must be checked.
**How to avoid:** Check `this.paused` and `this.stopRequested` after awaiting the next batch, not just at loop top. If stop is requested, await the background batch (to prevent dangling Promises) and then break.
**Warning signs:** Training appears to ignore stop commands, or hangs after stop.

## Code Examples

### Current run() Loop Structure (BEFORE)
```typescript
// Source: packages/bot-harness/training/training-coordinator.ts lines 164-277
while (this.episodeCounter < totalEpisodes) {
  // Pause check
  while (this.paused && !this.stopRequested) { await delay(100); }
  if (this.stopRequested) break;

  const weights = extractWeights(this.model);        // main thread
  await this.broadcastWeights(weights);               // main thread -> workers
  const episodeResults = await this.collectBatch(bs); // workers run, main IDLE
  // ... deserialize, GAE, PPO update, log, checkpoint (main thread, workers IDLE)
}
```

### Restructured run() Loop (AFTER - Recommended Pattern)
```typescript
// Pseudocode for the pipelined design
async run(): Promise<void> {
  // ... guards ...
  const startTime = Date.now();

  // Bootstrap: first generation is fully synchronous
  let genStartTime = Date.now();
  const weights0 = extractWeights(this.model);
  await this.broadcastWeights(weights0);
  const batchSize0 = this.computeBatchSize();
  let pendingResults = await this.collectBatch(batchSize0);

  while (this.episodeCounter < totalEpisodes) {
    // Pause/stop check
    while (this.paused && !this.stopRequested) { await delay(100); }
    if (this.stopRequested) break;

    genStartTime = Date.now();
    const batchSize = this.computeBatchSize();

    // ----- PIPELINE: Start next batch while processing current -----
    // Workers still have current-gen weights (stale-by-one is OK)
    const hasMore = this.episodeCounter + pendingResults.length < totalEpisodes;
    let nextBatchPromise: Promise<EpisodeResult[]> | null = null;
    if (hasMore) {
      nextBatchPromise = this.collectBatch(batchSize).catch((err) => {
        // Store error for later re-throw
        throw err;
      });
    }

    // ----- PROCESS: Main thread work on current batch -----
    const processStart = performance.now();

    // Deserialize trajectories
    const buffer = new TrajectoryBuffer();
    for (const result of pendingResults) { /* add steps */ }
    buffer.finalize(avgFinalValue, gamma, gaeLambda);

    // PPO update (the big CPU-heavy step)
    let updateResult: PPOUpdateResult | null = null;
    if (buffer.size() > 0) {
      updateResult = this.trainer.update(buffer);
    }

    // Log metrics + onProgress callbacks
    for (const result of pendingResults) {
      this.episodeCounter++;
      // ... logging ...
      if (this.onProgress) { this.onProgress({ ... }); }
    }

    // Checkpoint (fire-and-forget, await before next processing)
    let checkpointPromise: Promise<void> | null = null;
    if (this.opponentPool.shouldCheckpoint(this.episodeCounter)) {
      checkpointPromise = this.saveCheckpointAsync();
    }

    const processEnd = performance.now();
    buffer.clear();

    // ----- SYNC: Wait for next batch + extract/broadcast new weights -----
    const newWeights = extractWeights(this.model);

    if (nextBatchPromise) {
      pendingResults = await nextBatchPromise;
      // Broadcast new weights (workers finished collecting, now idle)
      await this.broadcastWeights(newWeights);
    }

    // Await any pending checkpoint I/O
    if (checkpointPromise) await checkpointPromise;

    this.generationCounter++;
  }

  // Save final model
  // ...
}
```

### CPU Utilization Measurement
```typescript
// Source: Node.js built-in APIs
import { performance } from 'node:perf_hooks';

interface PipelineMetrics {
  generationWallMs: number;
  collectWallMs: number;
  processWallMs: number;
  overlapMs: number;
  episodesPerSec: number;
  pipelineEfficiency: number; // 1.0 = perfect overlap
}

function computeMetrics(
  genStart: number,
  genEnd: number,
  collectMs: number,
  processMs: number,
  episodesInBatch: number,
): PipelineMetrics {
  const wallMs = genEnd - genStart;
  const overlapMs = Math.max(0, collectMs + processMs - wallMs);
  return {
    generationWallMs: wallMs,
    collectWallMs: collectMs,
    processWallMs: processMs,
    overlapMs,
    episodesPerSec: (episodesInBatch / wallMs) * 1000,
    pipelineEfficiency: overlapMs / Math.min(collectMs, processMs),
  };
}
```

### process.cpuUsage() for Main Thread Utilization
```typescript
// Measure main thread CPU utilization over a generation
const cpuBefore = process.cpuUsage();
const wallBefore = performance.now();

// ... do work ...

const cpuAfter = process.cpuUsage(cpuBefore); // diff
const wallAfter = performance.now();

// CPU time in microseconds -> milliseconds
const cpuMs = (cpuAfter.user + cpuAfter.system) / 1000;
const wallMs = wallAfter - wallBefore;
const utilization = cpuMs / wallMs; // 0.0 to ~1.0 (can exceed 1.0 on multi-core)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Synchronous PPO (collect all, then update) | Async/pipelined PPO (IMPALA-style) | ~2018 (IMPALA paper) | Standard in production RL; 2-3x throughput improvement |
| `process.hrtime()` | `performance.now()` (stable since Node 16) | Node 16+ | Cleaner API, same precision, works cross-platform |
| `Date.now()` for metrics | `performance.now()` monotonic clock | Always preferred | Not affected by system clock adjustments |

**Deprecated/outdated:**
- `process.hrtime()` (bigint version `process.hrtime.bigint()`): Still works but `performance.now()` is the modern standard per Node.js docs.

## Correctness Analysis: Staleness Guarantees

The key correctness constraint is that PPO updates use trajectories collected under the correct policy weights, with at most one generation of staleness.

### Current (Synchronous) Flow
```
Gen N: extract(N) -> broadcast(N) -> collect_with(N) -> PPO_update_using(N_trajectories) -> weights become N+1
Gen N+1: extract(N+1) -> broadcast(N+1) -> collect_with(N+1) -> ...
```
Workers always use exactly-current weights. Zero staleness.

### Proposed (Pipelined) Flow
```
Gen 0: extract(0) -> broadcast(0) -> collect_with(0) -> [results ready]
Gen 1: START collect_with(0_weights) || PPO_update(gen0_trajectories) -> weights=1 -> AWAIT collect -> broadcast(1)
Gen 2: START collect_with(1_weights) || PPO_update(gen1_trajectories) -> weights=2 -> AWAIT collect -> broadcast(2)
```

In steady state, workers collect episodes using weights from generation N-1 while the main thread runs PPO update N, producing weights N. After the PPO update, new weights are broadcast before the next collection starts. Workers are at most **one generation stale**, which is explicitly acceptable per CONTEXT.md.

The critical invariant to maintain: `broadcastWeights(N)` must complete before any worker begins collecting episodes that will be used for PPO update N+1. The pipeline design ensures this because:
1. Workers finish collecting gen-N batch.
2. Main thread broadcasts weights N (awaiting `weights-applied` from all workers).
3. Only then can the next `collectBatch()` be called.

## Open Questions

1. **Memory budget for double buffering**
   - What we know: Each batch's trajectory data includes per-step Float32Array buffers. With default config (workers*4 episodes, ~100 ticks each, 15x15 grid), each batch is modest.
   - What's unclear: Whether very large grid sizes or long episodes could cause memory pressure when holding two batches simultaneously.
   - Recommendation: Implement and monitor `process.memoryUsage().heapUsed`. Add a warning log if heap exceeds a configurable threshold. Not a blocker.

2. **TUI metrics integration**
   - What we know: `onProgress` callback fires per-episode in `TrainingProgressData`. Phase 25 TUI reads `generationStartTime` and `generationEpisodeCount`.
   - What's unclear: Whether the TUI should display pipeline-specific metrics (overlap %, pipeline efficiency) or just the existing metrics.
   - Recommendation: Add `episodesPerSec` to onProgress data. TUI already displays throughput (TUI-02). Pipeline metrics can be logged to NDJSON without TUI changes.

3. **Integration with TrainingProgressData for timing**
   - What we know: `TrainingProgressData.generationStartTime` is used by TUI for ETA calculation. Pipelining changes when a "generation" starts and ends.
   - What's unclear: Whether ETA calculation needs adjustment for pipelined generations.
   - Recommendation: Keep `generationStartTime` as the wall-clock start of the processing phase (not the collection phase). This preserves ETA accuracy since the user cares about wall-clock throughput.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts` |
| Full suite command | `npm run test:unit` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-01 | Workers collect next batch while main thread runs PPO update (double-buffering) | integration | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts -t "double-buffer"` | Wave 0 |
| SC-02 | Weight broadcast overlaps with late-finishing episode collection | integration | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts -t "overlap"` | Wave 0 |
| SC-03 | CPU utilization above 80% during steady-state training | integration | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts -t "utilization"` | Wave 0 |
| SC-04 | Training throughput (episodes/sec) improves vs synchronous baseline | integration | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts -t "throughput"` | Wave 0 |
| BC-01 | onProgress, togglePause, requestStop callbacks continue to work | unit | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts -t "onProgress\|togglePause\|requestStop"` | Existing tests |
| BC-02 | Existing coordinator tests pass unmodified | integration | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts` | Existing tests |
| CORR-01 | Workers use at most stale-by-one weights (not stale-by-two) | integration | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts -t "staleness"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run packages/bot-harness/training/training-coordinator.test.ts`
- **Per wave merge:** `npm run test:unit`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test cases for double-buffering behavior (SC-01)
- [ ] New test case verifying pipeline timing improvement (SC-04)
- [ ] Throughput measurement assertion (before/after comparison)
- [ ] Weight staleness invariant test (CORR-01)

Note: The existing 5 test cases in `training-coordinator.test.ts` (full cycle, clean termination, win rate, opponent variety, resume) must continue passing unchanged.

## Sources

### Primary (HIGH confidence)
- Direct code reading: `training-coordinator.ts`, `training-worker.ts`, `ppo-trainer.ts`, `trajectory-buffer.ts`, `ppo-network.ts`, `opponent-pool.ts`, `training-logger.ts`, `tui/types.ts`, `tui/plain-logger.ts`, `bin/train.ts`
- [Node.js v25 worker_threads documentation](https://nodejs.org/api/worker_threads.html) - message protocol, postMessage with transferables
- [Node.js v25 perf_hooks documentation](https://nodejs.org/api/perf_hooks.html) - performance.now(), eventLoopUtilization
- [Node.js v25 process documentation](https://nodejs.org/api/process.html) - process.cpuUsage()

### Secondary (MEDIUM confidence)
- [IMPALA/APPO architecture in Ray RLlib](https://docs.ray.io/en/latest/rllib/rllib-algorithms.html) - async actor-learner pattern reference
- [37 Implementation Details of PPO](https://iclr-blog-track.github.io/2022/03/25/ppo-implementation-details/) - PPO implementation best practices
- [A-3PO: Asynchronous PPO with staleness-aware proximal policy](https://arxiv.org/html/2512.06547) - staleness management in async PPO

### Tertiary (LOW confidence)
- None -- all findings are from primary sources (direct code reading) or verified against official documentation.

## Project Constraints (from CLAUDE.md)

- **Strict TypeScript:** Avoid `any`, explicit return types for exported functions, explicit `.js` extensions in relative imports
- **Testing:** Co-located unit tests in `packages/*`, vitest framework, `npm run test:unit` for package tests
- **Layer boundaries:** `packages/*` must not import from `apps/*`. All training code lives in `packages/bot-harness/training/`
- **Import aliases:** Use `#bot-harness` for bot-harness imports
- **Lint:** Must pass `npm run lint` (ESLint + typescript-eslint recommendedTypeChecked)
- **Commits:** Conventional Commits format
- **TF.js:** Use shared backend loader via `getTf()`, no hardcoded `@tensorflow/tfjs` imports
- **Worker threads:** Use tsx `tsImport()` shim for worker loading (Node 24 incompatibility)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries needed; all APIs are Node.js built-ins already in use
- Architecture: HIGH - The double-buffer pattern is well-understood and the codebase structure makes it straightforward
- Pitfalls: HIGH - All pitfalls identified from direct code reading of the existing message protocol and state management
- Correctness: HIGH - Staleness guarantees analyzed from first principles against the actual code flow

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable -- Node.js built-in APIs, no external dependencies)
