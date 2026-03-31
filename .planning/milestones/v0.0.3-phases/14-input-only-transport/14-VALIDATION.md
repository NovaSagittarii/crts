---
phase: 14
slug: input-only-transport
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-29
---

# Phase 14 — Validation Strategy

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

| Task ID  | Plan | Wave | Requirement | Test Type        | Automated Command                                            | File Exists | Status     |
| -------- | ---- | ---- | ----------- | ---------------- | ------------------------------------------------------------ | ----------- | ---------- |
| 14-01-01 | 01   | 1    | XPORT-02    | unit             | `npx vitest run packages/rts-engine/input-event-log.test.ts` | ❌ W0       | ⬜ pending |
| 14-02-01 | 02   | 2    | XPORT-01    | unit+integration | `npm run test:fast`                                          | ✅          | ⬜ pending |
| 14-02-02 | 02   | 2    | XPORT-03    | unit             | `npm run test:fast`                                          | ✅          | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `packages/rts-engine/input-event-log.test.ts` — stubs for XPORT-02 ring buffer
- [ ] Test fixtures for input event sequences

_If none: "Existing infrastructure covers all phase requirements."_

---

## Manual-Only Verifications

| Behavior                                             | Requirement | Why Manual                              | Test Instructions                                                           |
| ---------------------------------------------------- | ----------- | --------------------------------------- | --------------------------------------------------------------------------- |
| No full-state broadcast during active lockstep match | XPORT-01    | Requires live socket traffic inspection | Start match, observe network tab — no `state` events after match active     |
| Checkpoint hash verification in browser console      | XPORT-01    | Requires running dev server             | Start match, check console for `[lockstep]` messages with hash verification |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 70s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
