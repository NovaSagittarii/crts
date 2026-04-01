---
phase: 20
slug: ppo-training-with-self-play
status: draft
nyquist_compliant: false
wave_0_complete: false
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

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 20-01-01 | 01 | 1 | TRAIN-01 | unit | `npx vitest run packages/bot-harness/training/ppo-network.test.ts` | ❌ W0 | ⬜ pending |
| 20-01-02 | 01 | 1 | TRAIN-01 | unit | `npx vitest run packages/bot-harness/training/trajectory-buffer.test.ts` | ❌ W0 | ⬜ pending |
| 20-02-01 | 02 | 2 | TRAIN-01 | unit | `npx vitest run packages/bot-harness/training/ppo-trainer.test.ts` | ❌ W0 | ⬜ pending |
| 20-02-02 | 02 | 2 | TRAIN-02 | unit | `npx vitest run packages/bot-harness/training/opponent-pool.test.ts` | ❌ W0 | ⬜ pending |
| 20-03-01 | 03 | 3 | TRAIN-04 | integration | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts` | ❌ W0 | ⬜ pending |
| 20-03-02 | 03 | 3 | TRAIN-03 | unit | `npx vitest run packages/bot-harness/training/training-config.test.ts` | ❌ W0 | ⬜ pending |
| 20-04-01 | 04 | 4 | TRAIN-01 | integration | `npx vitest run packages/bot-harness/training/convergence.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/bot-harness/training/ppo-network.test.ts` — stubs for TRAIN-01 (network builds)
- [ ] `packages/bot-harness/training/trajectory-buffer.test.ts` — stubs for TRAIN-01 (GAE computation)
- [ ] `packages/bot-harness/training/ppo-trainer.test.ts` — stubs for TRAIN-01 (PPO update logic)
- [ ] `packages/bot-harness/training/opponent-pool.test.ts` — stubs for TRAIN-02 (pool management)
- [ ] `packages/bot-harness/training/training-coordinator.test.ts` — stubs for TRAIN-04 (worker coordination)
- [ ] `packages/bot-harness/training/training-config.test.ts` — stubs for TRAIN-03 (CLI config)
- [ ] `packages/bot-harness/training/convergence.test.ts` — stubs for convergence validation
- [ ] TF.js installation verification (blocking prerequisite)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TF.js native backend loads on Alpine Linux | TRAIN-01 | Platform-specific binary | Run `node -e "require('@tensorflow/tfjs-node')"` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
