---
phase: 24
slug: tf-js-native-backend-with-dynamic-fallback
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-02
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npx vitest run packages/bot-harness/tf-backend.test.ts` |
| **Full suite command** | `npm run test:unit` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run packages/bot-harness/tf-backend.test.ts -x`
- **After every plan wave:** Run `npm run test:fast`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Wave 0 Requirements

All plans use inline TDD — no separate Wave 0 needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Native backend loads on glibc system | SC-3 | Requires non-Alpine platform | Run on Ubuntu/Debian and check log for "native" backend |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covered via inline TDD
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
