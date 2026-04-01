---
phase: 19
slug: observation-action-and-reward-interface
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-01
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npx vitest run packages/bot-harness/observation-encoder.test.ts packages/bot-harness/action-decoder.test.ts packages/bot-harness/reward-signal.test.ts packages/bot-harness/bot-environment.test.ts` |
| **Full suite command** | `npm run test:unit` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run packages/bot-harness/{changed-file}.test.ts`
- **After every plan wave:** Run `npm run test:unit`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | HARN-02 | unit | `npx vitest run packages/bot-harness/observation-encoder.test.ts` | ❌ W0 | ⬜ pending |
| 19-01-02 | 01 | 1 | HARN-03 | unit | `npx vitest run packages/bot-harness/action-decoder.test.ts` | ❌ W0 | ⬜ pending |
| 19-02-01 | 02 | 2 | HARN-04 | unit | `npx vitest run packages/bot-harness/reward-signal.test.ts` | ❌ W0 | ⬜ pending |
| 19-02-02 | 02 | 2 | HARN-02,03,04 | unit | `npx vitest run packages/bot-harness/bot-environment.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/bot-harness/observation-encoder.test.ts` — stubs for HARN-02
- [ ] `packages/bot-harness/action-decoder.test.ts` — stubs for HARN-03
- [ ] `packages/bot-harness/reward-signal.test.ts` — stubs for HARN-04
- [ ] `packages/bot-harness/bot-environment.test.ts` — stubs for ENV-01 through ENV-04

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
