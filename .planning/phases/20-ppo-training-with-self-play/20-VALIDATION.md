---
phase: 20
slug: ppo-training-with-self-play
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-01
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npx vitest run --dir packages/bot-harness` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds (excluding convergence test) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --dir packages/bot-harness`
- **After every plan wave:** Run `npm run test:fast`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 20-01-01 | 01 | 1 | TRAIN-01, TRAIN-03 | unit | `npx vitest run packages/bot-harness/training/training-config.test.ts` | ⬜ pending |
| 20-01-02 | 01 | 1 | TRAIN-01 | unit (TDD) | `npx vitest run packages/bot-harness/training/ppo-network.test.ts` | ⬜ pending |
| 20-02-01 | 02 | 2 | TRAIN-01 | unit (TDD) | `npx vitest run packages/bot-harness/training/trajectory-buffer.test.ts` | ⬜ pending |
| 20-02-02 | 02 | 2 | TRAIN-01 | unit (TDD) | `npx vitest run packages/bot-harness/training/ppo-trainer.test.ts` | ⬜ pending |
| 20-03-01 | 03 | 2 | TRAIN-02 | unit (TDD) | `npx vitest run packages/bot-harness/training/opponent-pool.test.ts` | ⬜ pending |
| 20-03-02 | 03 | 2 | TRAIN-03 | unit (TDD) | `npx vitest run packages/bot-harness/training/training-logger.test.ts` | ⬜ pending |
| 20-04-01 | 04 | 3 | TRAIN-01, TRAIN-04 | integration (via coordinator) | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts --timeout 120000` | ⬜ pending |
| 20-04-02 | 04 | 3 | TRAIN-01, TRAIN-02, TRAIN-04 | integration | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts --timeout 120000` | ⬜ pending |
| 20-05-01 | 05 | 4 | TRAIN-03 | smoke | `NODE_OPTIONS=--conditions=development npx tsx bin/train.ts --help \| head -5` | ⬜ pending |
| 20-05-02 | 05 | 4 | TRAIN-01 | convergence | `npx vitest run packages/bot-harness/training/convergence.test.ts --timeout 300000` | ⬜ pending |
| 20-05-03 | 05 | 4 | TRAIN-01, TRAIN-03 | checkpoint:human-verify | Manual: short training run produces outputs | ⬜ pending |

*Status: ⬜ pending -- ✅ green -- ❌ red -- ⚠️ flaky*

---

## Wave 0 Requirements

All plans use inline TDD (tests created within the same task as implementation). No separate Wave 0 test scaffold step is needed.

- [x] TDD tasks in Plans 01-03 create test files inline with implementation (ppo-network.test.ts, trajectory-buffer.test.ts, ppo-trainer.test.ts, opponent-pool.test.ts, training-logger.test.ts, training-config.test.ts)
- [x] Plan 04 Task 2 creates training-coordinator.test.ts as part of coordinator implementation
- [x] Plan 05 Task 2 creates convergence.test.ts
- [x] TF.js installation verified in Plan 01 Task 1

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TF.js native backend loads on Alpine Linux | TRAIN-01 | Platform-specific binary | Run `node -e "require('@tensorflow/tfjs-node')"` |

---

## Requirement Coverage

| Requirement | Plans | Tests |
|-------------|-------|-------|
| TRAIN-01 (PPO loop) | 01, 02, 04, 05 | ppo-network.test, trajectory-buffer.test, ppo-trainer.test, training-coordinator.test, convergence.test |
| TRAIN-02 (Self-play pool) | 03, 04 | opponent-pool.test, training-coordinator.test (opponent variety) |
| TRAIN-03 (Training CLI) | 01, 03, 05 | training-config.test, training-logger.test, `bin/train.ts --help` smoke |
| TRAIN-04 (Worker parallelism) | 04, 05 | training-coordinator.test (spawns real workers) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covered via inline TDD
- [x] No watch-mode flags
- [x] Feedback latency < 30s (excluding convergence test)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
