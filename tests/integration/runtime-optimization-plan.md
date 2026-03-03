# Test Runtime Optimization Plan (Vitest Timers)

This plan follows a speed-first strategy with correctness guardrails.

## Baseline (Phase 0)

Measured on Tue Mar 03 2026 in this repository using `/usr/bin/time -p`.

| Suite Command                                              | real (s) | Key Notes                                                                              |
| ---------------------------------------------------------- | -------: | -------------------------------------------------------------------------------------- |
| `npm run test:unit`                                        |    36.71 | Includes `packages/**`; `packages/rts-engine/rts.test.ts` is the biggest unit hotspot. |
| `npx vitest run --config vitest.config.ts --dir tests/web` |    40.04 | Web view-model lane is small in test runtime, but has startup/collect overhead.        |
| `npm run test:integration`                                 |   116.71 | Main bottleneck lane; real-time countdown/hold waits dominate.                         |
| `npm run test:integration:serial`                          |   231.45 | Worst-case wall-clock for deterministic debugging.                                     |

Primary integration hotspots from baseline run:

- `tests/integration/server/server.test.ts` (~46.3s)
- `tests/integration/server/lobby-reliability.test.ts` (~36.9s)
- `tests/integration/server/lobby-reconnect.test.ts` (~32.3s)
- `tests/integration/server/match-lifecycle.test.ts` (~14.1s)

## Rollout Phases

### Phase 1 - Fake timers on countdown and reconnect-hold paths

Scope:

- `tests/integration/server/server.test.ts`
- `tests/integration/server/match-lifecycle.test.ts`
- `tests/integration/server/lobby-reconnect.test.ts`
- `tests/integration/server/lobby-reliability.test.ts`

Approach:

- Use `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync(...)` in timer-heavy test flows.
- Keep a small real-time canary subset if any correctness drift appears.

Expected gain:

- ~90s to 130s total integration runtime reduction (largest phase impact).

### Phase 2 - Helper refactors to remove avoidable waits

Scope:

- Integration wait helpers and outcome collectors.

Approach:

- Replace retry-by-timeout loops with predicate+deadline helpers.
- Remove fixed settle sleeps where not required by contract behavior.

Expected gain:

- ~10s to 25s pass-case improvement; much faster failure feedback.

### Phase 3 - Injectable clock hooks for hybrid safety

Scope:

- `apps/server/src/server.ts`
- `apps/server/src/lobby-session.ts`

Approach:

- Inject timer/clock hooks so test-controlled time affects app timers precisely.
- Keep Socket.IO/event-loop behavior on real execution where needed.

Expected gain:

- Preserves Phase 1/2 speedups with lower correctness risk.

### Phase 4 - Runner lane split and tuning

Scope:

- `vitest.config.ts`
- `package.json` scripts

Approach:

- Add explicit fast lane (`packages + tests/web`) and separate integration lane.
- Tune worker strategy for heavy integration files.

Expected gain:

- 20% to 45% CI wall-clock reduction through lane parallelization and tuning.

## Validation Guardrails

Run after each phase before commit:

1. Parity checks: run impacted suites with expected behavior assertions unchanged.
2. Runtime checks: compare baseline vs current `real` times for touched lanes.
3. Stability checks: repeat heavy integration suites (10x to 20x) after major timer changes.
4. Fallback rule: if fake timers affect correctness, keep hybrid mode for that test region.
