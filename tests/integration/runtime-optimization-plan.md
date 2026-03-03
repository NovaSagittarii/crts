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

## Progress Snapshot

Measured on this branch with `/usr/bin/time -p`.

| Phase              | `npm run test:integration` real (s) | Delta vs baseline (s) | Delta vs baseline (%) | `npm run test:integration:serial` real (s) | Delta vs baseline (s) | Delta vs baseline (%) |
| ------------------ | ----------------------------------: | --------------------: | --------------------: | -----------------------------------------: | --------------------: | --------------------: |
| Phase 0 (baseline) |                              116.71 |                   n/a |                   n/a |                                     231.45 |                   n/a |                   n/a |
| Phase 1            |                               77.28 |                -39.43 |               -33.78% |                                     132.51 |                -98.94 |               -42.75% |
| Phase 2            |                               71.84 |                -44.87 |               -38.45% |                                     127.94 |               -103.51 |               -44.72% |
| Phase 3            |                               96.22 |                -20.49 |               -17.56% |                                     125.30 |               -106.15 |               -45.86% |

Interpretation notes:

- Serial lane improved every phase (231.45s -> 125.30s, -106.15s, -45.86% vs baseline).
- Non-serial lane improved strongly through Phase 2; the Phase 3 reading (96.22s) is a noisy regression run and likely variance.
- Non-serial still beats baseline in Phase 3 (-20.49s, -17.56%), so Phase 4 tuning should use repeated-run medians before calling regressions.

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
- CI lane wiring

Approach:

- Keep lane split script-first so CI can schedule lanes independently:
  - Fast lane: `npm run test:fast` (`test:unit` + `test:web`)
  - Integration lane (default): `npm run test:integration`
  - Integration split lane: `npm run test:integration:split` (`test:integration:heavy` + `test:integration:light`)
  - Deterministic fallback lane: `npm run test:integration:serial`
- Keep worker tuning isolated to `test:integration:heavy` (currently `--minWorkers=1 --maxWorkers=2`), then re-measure.
- Keep `test:quality` as the local combined gate (`test:fast` + `test:integration`) while CI runs fast + integration lanes in parallel.

Expected gain:

- 20% to 45% CI wall-clock reduction through lane parallelization and tuning.

## Validation Guardrails

Run after each phase before commit:

1. Parity checks: run impacted suites with expected behavior assertions unchanged.
2. Runtime checks: compare baseline vs current `real` times for touched lanes.
3. Stability checks: repeat heavy integration suites (10x to 20x) after major timer changes.
4. Fallback rule: if fake timers affect correctness, keep hybrid mode for that test region.

### Phase 4 Split-Lane Validation Checklist

- [ ] Verify lane coverage mapping: `test:fast`, `test:integration`, `test:integration:split`, and `test:integration:serial` each run intended files only.
- [ ] Confirm `test:integration:heavy` + `test:integration:light` match the same scenario set covered by `test:integration`.
- [ ] Capture at least 5 runs per lane and compare medians against current Phase 3 numbers.
- [ ] Apply `test:integration:heavy` worker tuning one knob at a time and re-check runtime + pass/fail parity.
- [ ] Run `npm run test:integration:split` 10x and `npm run test:integration:serial` 3x with zero flakes.
- [ ] Confirm CI runs fast + integration lanes in parallel and reports failures independently.
