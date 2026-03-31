---
phase: 15
slug: hash-checkpoint-protocol
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-29
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value               |
| ---------------------- | ------------------- |
| **Framework**          | vitest              |
| **Config file**        | vitest.config.ts    |
| **Quick run command**  | `npm run test:fast` |
| **Full suite command** | `npm test`          |
| **Estimated runtime**  | ~70 seconds         |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:fast`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 70 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement      | Test Type   | Automated Command                                                 | File Exists | Status     |
| -------- | ---- | ---- | ---------------- | ----------- | ----------------------------------------------------------------- | ----------- | ---------- |
| 15-01-01 | 01   | 1    | SYNC-01          | unit        | `npx vitest run tests/web/client-simulation.test.ts`              | ✅          | ⬜ pending |
| 15-01-02 | 01   | 1    | SYNC-02          | unit        | `npx vitest run tests/web/client-simulation.test.ts`              | ✅          | ⬜ pending |
| 15-02-01 | 02   | 2    | SYNC-01, SYNC-02 | integration | `npx vitest run tests/integration/server/hash-checkpoint.test.ts` | ❌ W0       | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `tests/integration/server/hash-checkpoint.test.ts` — integration test stubs for desync detection and resync

_Existing infrastructure covers unit test requirements._

---

## Manual-Only Verifications

| Behavior                 | Requirement | Why Manual               | Test Instructions                                                        |
| ------------------------ | ----------- | ------------------------ | ------------------------------------------------------------------------ |
| Visual resync in browser | SYNC-02     | Requires live dev server | Start match, inject console divergence, observe resync in console output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 70s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
